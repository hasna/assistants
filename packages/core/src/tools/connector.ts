import type { Tool, Connector, ConnectorCommand, ConnectorsConfigShared } from '@hasna/assistants-shared';
import type { ToolExecutor, ToolRegistry } from './registry';
import type { JobManager } from '../jobs';
import { homedir } from 'os';
import { join, delimiter, dirname, extname } from 'path';
import { readdirSync, statSync, existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { ConnectorError, ErrorCodes } from '../errors';
import { getRuntime } from '../runtime';
import { buildCommandArgs, splitCommandLine } from '../utils/command-line';
import { ConnectorAutoRefreshManager } from '../connectors/auto-refresh';

/**
 * Normalize connectors config to the object format
 */
function normalizeConnectorsConfig(config?: string[] | ConnectorsConfigShared): ConnectorsConfigShared {
  if (!config) {
    return {};
  }
  if (Array.isArray(config)) {
    return { enabled: config };
  }
  return config;
}

type TimeoutResolve = (value: { exitCode: number }) => void;

function resolveTimeout(resolve: TimeoutResolve): void {
  resolve({ exitCode: 1 });
}

interface DiskCache {
  version: number;
  timestamp: number;
  connectors: Record<string, Connector | null>;
}

const CACHE_VERSION = 1;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Connector bridge - wraps connect-* CLIs as tools
 */
export class ConnectorBridge {
  private connectors: Map<string, Connector> = new Map();
  private static cache: Map<string, Connector | null> = new Map();
  private static diskCacheLoaded = false;
  private cwd?: string;
  private jobManagerGetter: (() => JobManager | null) | null = null;

  constructor(cwd?: string) {
    this.cwd = cwd;
    // Load disk cache on first instantiation
    if (!ConnectorBridge.diskCacheLoaded) {
      ConnectorBridge.loadDiskCache();
    }
  }

  /**
   * Set the job manager getter for async job support
   */
  setJobManagerGetter(getter: () => JobManager | null): void {
    this.jobManagerGetter = getter;
  }

  private getHomeDir(): string {
    const envHome = process.env.HOME || process.env.USERPROFILE;
    return envHome && envHome.trim().length > 0 ? envHome : homedir();
  }

  private static getCachePath(): string {
    const envHome = process.env.HOME || process.env.USERPROFILE;
    const home = envHome && envHome.trim().length > 0 ? envHome : homedir();
    return join(home, '.assistants', 'cache', 'connectors.json');
  }

  private static loadDiskCache(): void {
    ConnectorBridge.diskCacheLoaded = true;
    try {
      const cachePath = ConnectorBridge.getCachePath();
      if (!existsSync(cachePath)) return;

      const data = JSON.parse(readFileSync(cachePath, 'utf-8')) as DiskCache;

      // Check version and TTL
      if (data.version !== CACHE_VERSION) return;
      if (Date.now() - data.timestamp > CACHE_TTL_MS) return;

      // Load into memory cache
      for (const [name, connector] of Object.entries(data.connectors)) {
        ConnectorBridge.cache.set(name, connector);
      }
    } catch {
      // Cache read failed, will rediscover
    }
  }

  private static saveDiskCache(): void {
    try {
      const cachePath = ConnectorBridge.getCachePath();
      const cacheDir = dirname(cachePath);
      if (!existsSync(cacheDir)) {
        mkdirSync(cacheDir, { recursive: true });
      }

      const data: DiskCache = {
        version: CACHE_VERSION,
        timestamp: Date.now(),
        connectors: Object.fromEntries(ConnectorBridge.cache),
      };

      writeFileSync(cachePath, JSON.stringify(data));
    } catch {
      // Cache write failed, non-critical
    }
  }

  /**
   * Auto-discover all connect-* CLIs in PATH
   */
  private autoDiscoverConnectorNames(): string[] {
    const connectorNames = new Set<string>();
    const pathDirs = (process.env.PATH || '').split(delimiter);
    const baseCwd = this.cwd || process.cwd();

    // Also check common bun/npm global bin locations
    const homeDir = this.getHomeDir();
    const extraDirs = [
      join(baseCwd, 'node_modules', '.bin'),
      join(homeDir, '.bun', 'bin'),
      join(homeDir, '.npm-global', 'bin'),
      '/usr/local/bin',
    ];

    const allDirs = [...new Set([...pathDirs, ...extraDirs])];

    for (const dir of allDirs) {
      try {
        const files = readdirSync(dir);
        for (const file of files) {
          if (!file.startsWith('connect-')) {
            continue;
          }

          const fullPath = join(dir, file);
          let stats;
          try {
            stats = statSync(fullPath);
          } catch {
            continue;
          }

          if (!stats.isFile()) {
            continue;
          }

          const ext = extname(file);
          let name = file.replace('connect-', '');
          if (ext && ['.exe', '.cmd', '.bat', '.ps1'].includes(ext.toLowerCase())) {
            name = name.slice(0, -ext.length);
          }
          // Skip if it's a common non-connector (like connect.js or similar)
          if (name && !name.includes('.')) {
            connectorNames.add(name);
          }
        }
      } catch {
        // Directory doesn't exist or can't be read, skip
      }
    }

    return Array.from(connectorNames);
  }

  /**
   * Fast discovery: use disk cache if available, otherwise scan PATH.
   * This avoids slower per-connector checks and allows tools to be available right away.
   */
  fastDiscover(connectorNames?: string[]): Connector[] {
    this.connectors.clear();
    // If we have cached connectors from disk, use those immediately
    if (ConnectorBridge.cache.size > 0) {
      const connectors: Connector[] = [];
      const allowList = connectorNames && connectorNames.length > 0
        ? new Set(connectorNames)
        : null;

      for (const [name, connector] of ConnectorBridge.cache) {
        if (connector && (!allowList || allowList.has(name))) {
          this.connectors.set(connector.name, connector);
          connectors.push(connector);
        }
      }

      if (connectors.length > 0) {
        return connectors;
      }
    }

    // Fallback: scan PATH for connector names
    const discoveredNames = this.autoDiscoverConnectorNames();
    const allowList = connectorNames && connectorNames.length > 0
      ? new Set(connectorNames)
      : null;
    const names = allowList
      ? discoveredNames.filter((name) => allowList.has(name))
      : discoveredNames;

    if (names.length === 0) {
      return [];
    }

    const connectors: Connector[] = [];
    for (const name of names) {
      const cached = ConnectorBridge.cache.get(name);
      if (cached) {
        this.connectors.set(cached.name, cached);
        connectors.push(cached);
        continue;
      }
      if (cached === null) {
        continue;
      }
      const connector = this.createMinimalConnector(name, `connect-${name}`);
      ConnectorBridge.cache.set(name, connector);
      this.connectors.set(connector.name, connector);
      connectors.push(connector);
    }

    // Save to disk if we created new minimal connectors
    if (connectors.length > 0) {
      ConnectorBridge.saveDiskCache();
    }

    return connectors;
  }

  /**
   * Discover available connectors (auto-discovers if no names provided)
   */
  async discover(connectorNames?: string[]): Promise<Connector[]> {
    // Auto-discover if no names provided, or use provided list
    const names = connectorNames && connectorNames.length > 0
      ? connectorNames
      : this.autoDiscoverConnectorNames();

    if (names.length === 0) {
      // No connectors found
      this.connectors = new Map();
      return [];
    }

    // Check cache first - also re-discover minimal connectors (only have 'help')
    const uncached: string[] = [];
    for (const name of names) {
      const cached = ConnectorBridge.cache.get(name);
      if (!cached) {
        uncached.push(name);
      } else if (this.isMinimalConnector(cached)) {
        // Minimal connector from fastDiscover - needs full discovery
        uncached.push(name);
      }
    }

    if (uncached.length > 0) {
      // Discover uncached connectors in parallel (with timeout)
      const tasks: Array<Promise<void>> = [];
      for (const name of uncached) {
        tasks.push(this.populateCache(name));
      }
      await Promise.all(tasks);

      // Save to disk after discovery
      ConnectorBridge.saveDiskCache();
    }

    // Return all cached connectors
    const discovered: Connector[] = [];
    const nextConnectors = new Map<string, Connector>();
    for (const name of names) {
      const connector = ConnectorBridge.cache.get(name);
      if (connector) {
        discovered.push(connector);
        nextConnectors.set(connector.name, connector);
      }
    }

    this.connectors = nextConnectors;
    return discovered;
  }

  /**
   * Check if a connector is minimal (only has 'help' command, needs full discovery)
   */
  private isMinimalConnector(connector: Connector): boolean {
    return connector.commands.length <= 1 &&
      (connector.commands.length === 0 || connector.commands[0].name === 'help');
  }

  /**
   * Create minimal connector without running --help (lazy discovery)
   */
  private createMinimalConnector(name: string, cli: string): Connector {
    return {
      name,
      cli,
      description: `${name} connector`,
      commands: [
        { name: 'help', description: 'Show available commands', args: [], options: [] },
      ],
      auth: {
        type: 'oauth2',
        statusCommand: `${cli} auth status`,
      },
    };
  }

  private async populateCache(name: string): Promise<void> {
    const cli = await this.resolveConnectorCli(name);
    const whichCommand = process.platform === 'win32' ? 'where' : 'which';

    try {
      // Quick existence check with timeout
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      const timeoutPromise = new Promise<{ exitCode: number }>((resolve) => {
        timeoutId = setTimeout(resolveTimeout, 500, resolve);
      });

      if (!cli) {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        ConnectorBridge.cache.set(name, null);
        return;
      }

      const runtime = getRuntime();
      const shouldSkipWhich = cli.includes('/') || cli.includes('\\');
      const result = shouldSkipWhich
        ? ({ exitCode: 0 } as { exitCode: number })
        : await Promise.race([runtime.shell`${whichCommand} ${cli}`.quiet().nothrow(), timeoutPromise]);

      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      if (result.exitCode !== 0) {
        ConnectorBridge.cache.set(name, null);
        return;
      }

      // Run full discovery: execute --help and parse commands
      const connector = await this.discoverConnector(name, cli);
      if (connector) {
        ConnectorBridge.cache.set(name, connector);
      } else {
        // Discovery failed, fall back to minimal connector
        ConnectorBridge.cache.set(name, this.createMinimalConnector(name, cli));
      }
    } catch {
      ConnectorBridge.cache.set(name, null);
    }
  }

  private async resolveConnectorCli(name: string): Promise<string | null> {
    const base = `connect-${name}`;
    const candidates = [base];
    const extCandidates = ['.exe', '.cmd', '.bat', '.ps1'];
    const whichCommand = process.platform === 'win32' ? 'where' : 'which';
    for (const ext of extCandidates) {
      candidates.push(`${base}${ext}`);
    }

    for (const candidate of candidates) {
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      try {
        const timeoutPromise = new Promise<{ exitCode: number }>((resolve) => {
          timeoutId = setTimeout(resolveTimeout, 500, resolve);
        });
        const runtime = getRuntime();
        const result = await Promise.race([
          runtime.shell`${whichCommand} ${candidate}`.quiet().nothrow(),
          timeoutPromise,
        ]);
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        if (result.exitCode === 0) {
          if ('stdout' in result) {
            const resolved = result.stdout
              .toString()
              .split(/\r?\n/)
              .find((line: string) => line.trim())
              ?.trim();
            return resolved && resolved.length > 0 ? resolved : candidate;
          }
          return candidate;
        }
      } catch {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        // ignore and try next candidate
      }
    }

    return null;
  }

  /**
   * Discover a single connector's commands from its CLI help
   */
  private async discoverConnector(name: string, cli: string): Promise<Connector | null> {
    try {
      const runtime = getRuntime();
      const cmdParts = buildCommandArgs(cli, ['--help']);
      const proc = runtime.spawn(cmdParts, {
        cwd: this.cwd || process.cwd(),
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const helpText = proc.stdout ? await new Response(proc.stdout).text() : '';
      await proc.exited;

      // Parse commands from help output
      const commands = this.parseHelpOutput(helpText, name);

      // Try to load manifest if available
      const manifestPath = join(this.getHomeDir(), `.connect-${name}`, 'manifest.json');
      let description = `${name} connector`;

      try {
        const manifest = await runtime.file(manifestPath).json<{ description?: string }>();
        if (manifest.description) {
          description = manifest.description;
        }
      } catch {
        // No manifest, use default description
      }

      return {
        name,
        cli,
        description,
        commands,
        auth: {
          type: 'oauth2',
          statusCommand: `${cli} auth status`,
        },
      };
    } catch {
      return null;
    }
  }

  /**
   * Parse help output to discover commands
   * Handles multiple common help output formats:
   * - Standard format: "  command-name    Description"
   * - Oclif format: "  connect-foo:command    Description"
   * - Cobra/Go format: "  command-name" followed by description
   * - List format: "  - command-name: description"
   * - Tabular format: "command-name     description text"
   */
  private parseHelpOutput(helpText: string, _name: string): ConnectorCommand[] {
    const commands: ConnectorCommand[] = [];
    const seenCommands = new Set<string>();
    const lines = helpText.split('\n');

    // Section headers that indicate a commands section
    const commandsSectionHeaders = [
      'commands:',
      'available commands:',
      'subcommands:',
      'topics:',
    ];

    // Section headers that indicate end of commands section
    const nonCommandSections = [
      'flags:',
      'options:',
      'global options:',
      'global flags:',
      'examples:',
      'environment:',
      'learn more:',
      'see more help:',
    ];

    // Skip patterns - commands to exclude
    const skipPatterns = [
      /^help$/i,
      /^version$/i,
      /^-h$/,
      /^--help$/,
      /^-v$/,
      /^--version$/,
      /^plugins$/i,
      /^update$/i,
      /^autocomplete$/i,
    ];

    let inCommands = false;
    let prevLineEmpty = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim().toLowerCase();

      // Check for section headers
      if (commandsSectionHeaders.some((h) => trimmed.includes(h))) {
        inCommands = true;
        prevLineEmpty = false;
        continue;
      }

      // Check for end of commands section
      if (nonCommandSections.some((h) => trimmed.includes(h))) {
        inCommands = false;
        continue;
      }

      // Empty line might indicate section end, or just formatting
      if (!line.trim()) {
        prevLineEmpty = true;
        continue;
      }

      // If we had empty line followed by non-indented text, might be new section
      if (prevLineEmpty && !line.match(/^\s/) && inCommands) {
        inCommands = false;
      }
      prevLineEmpty = false;

      const originalLine = line;

      // Pattern 1: Indented command with multiple spaces before description
      // "  command-name    Description text"
      const pattern1 = line.match(/^\s{1,8}(\S+)\s{2,}(.+)$/);
      if (pattern1) {
        const [, cmdName, description] = pattern1;
        if (!skipPatterns.some((p) => p.test(cmdName))) {
          this.addCommand(commands, seenCommands, cmdName, description.trim());
        }
        continue;
      }

      // Pattern 2: Oclif-style with colon separator
      // "  connect-name:subcommand    Description text"
      const pattern2 = line.match(/^\s{1,8}[\w-]+:([\w-]+)\s{2,}(.+)$/);
      if (pattern2) {
        const [, cmdName, description] = pattern2;
        if (!skipPatterns.some((p) => p.test(cmdName))) {
          this.addCommand(commands, seenCommands, cmdName, description.trim());
        }
        continue;
      }

      // Pattern 3: List format with dash
      // "  - command-name: description text"
      const pattern3 = line.match(/^\s*[-*]\s+([\w-]+)[:\s]+(.+)$/);
      if (pattern3 && inCommands) {
        const [, cmdName, description] = pattern3;
        if (!skipPatterns.some((p) => p.test(cmdName))) {
          this.addCommand(commands, seenCommands, cmdName, description.trim());
        }
        continue;
      }

      // Pattern 4: Simple indented name (description might be on next line)
      // "  command-name" with description on following line
      const pattern4 = originalLine.match(/^\s{2,8}([\w][\w-]*)$/);
      if (pattern4 && inCommands) {
        const [, cmdName] = pattern4;
        // Look ahead for description
        const nextLine = i + 1 < lines.length ? lines[i + 1] : '';
        const nextTrimmed = nextLine.trim();
        if (nextTrimmed && nextLine.match(/^\s{4,}/)) {
          // Description is on next line
          if (!skipPatterns.some((p) => p.test(cmdName))) {
            this.addCommand(commands, seenCommands, cmdName, nextTrimmed);
            i++; // Skip description line
          }
        } else if (!skipPatterns.some((p) => p.test(cmdName))) {
          // No description found
          this.addCommand(commands, seenCommands, cmdName, `${cmdName} command`);
        }
        continue;
      }

      // Pattern 5: Bracket-delimited command
      // "[command]    description"
      const pattern5 = line.match(/^\s*\[([\w-]+)\]\s{2,}(.+)$/);
      if (pattern5 && inCommands) {
        const [, cmdName, description] = pattern5;
        if (!skipPatterns.some((p) => p.test(cmdName))) {
          this.addCommand(commands, seenCommands, cmdName, description.trim());
        }
        continue;
      }
    }

    // If no commands found, add generic fallbacks
    if (commands.length === 0) {
      commands.push(
        { name: 'auth status', description: 'Check authentication status', args: [], options: [] },
        { name: 'help', description: 'Show help', args: [], options: [] }
      );
    }

    return commands;
  }

  /**
   * Add a command if not already seen
   */
  private addCommand(
    commands: ConnectorCommand[],
    seenCommands: Set<string>,
    name: string,
    description: string
  ): void {
    const normalized = name.toLowerCase();
    if (!seenCommands.has(normalized)) {
      seenCommands.add(normalized);
      commands.push({
        name,
        description,
        args: [],
        options: [],
      });
    }
  }

  /**
   * Register connector tools based on configuration
   * @param registry - Tool registry to register tools with
   * @param config - Connectors configuration (optional)
   * @returns Set of connector names that were registered as individual tools
   */
  registerAll(registry: ToolRegistry, config?: string[] | ConnectorsConfigShared): Set<string> {
    const normalizedConfig = normalizeConnectorsConfig(config);
    const maxTools = normalizedConfig.maxToolsInContext ?? 0; // 0 = unlimited
    const priorityConnectors = new Set(normalizedConfig.priorityConnectors || []);
    const dynamicBinding = normalizedConfig.dynamicBinding ?? false;

    const registeredConnectors = new Set<string>();
    const connectorList = Array.from(this.connectors.values());

    // If dynamic binding is enabled and no priority connectors, don't register any individual tools
    if (dynamicBinding && priorityConnectors.size === 0) {
      return registeredConnectors;
    }

    // Sort connectors: priority connectors first, then alphabetically
    const sortedConnectors = connectorList.sort((a, b) => {
      const aPriority = priorityConnectors.has(a.name);
      const bPriority = priorityConnectors.has(b.name);
      if (aPriority && !bPriority) return -1;
      if (!aPriority && bPriority) return 1;
      return a.name.localeCompare(b.name);
    });

    for (const connector of sortedConnectors) {
      // Check if we've hit the limit (if set and not unlimited)
      const isPriority = priorityConnectors.has(connector.name);
      if (maxTools > 0 && registeredConnectors.size >= maxTools && !isPriority) {
        // Skip non-priority connectors when limit is reached
        continue;
      }

      // Skip non-priority connectors if dynamic binding is enabled
      if (dynamicBinding && !isPriority) {
        continue;
      }

      const tool = this.createTool(connector);
      const executor = this.createExecutor(connector);
      registry.register(tool, executor);
      registeredConnectors.add(connector.name);
    }

    return registeredConnectors;
  }

  /**
   * Register a single connector as a tool (for on-demand binding)
   * @param registry - Tool registry to register with
   * @param connectorName - Name of connector to register
   * @returns true if registered, false if connector not found
   */
  registerConnector(registry: ToolRegistry, connectorName: string): boolean {
    const connector = this.connectors.get(connectorName);
    if (!connector) {
      return false;
    }

    const tool = this.createTool(connector);
    const executor = this.createExecutor(connector);
    registry.register(tool, executor);
    return true;
  }

  /**
   * Create a tool definition from a connector
   */
  private createTool(connector: Connector): Tool {
    const commandNames: string[] = [];
    for (const cmd of connector.commands) {
      commandNames.push(cmd.name);
    }

    const commandDescriptions: string[] = [];
    for (const cmd of connector.commands) {
      commandDescriptions.push(`${cmd.name} (${cmd.description})`);
    }

    // Create a single tool per connector with command as a parameter
    return {
      name: connector.name,
      description: `${connector.description}. Available commands: ${commandNames.join(', ')}`,
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: `The command to run. Available: ${commandDescriptions.join('; ')}`,
          },
          args: {
            type: 'array',
            description: 'Arguments to pass to the command',
            items: { type: 'string', description: 'Argument value' },
          },
          options: {
            type: 'object',
            description: 'Options to pass to the command (key-value pairs)',
          },
        },
        required: ['command'],
      },
    };
  }

  /**
   * Create an executor function for a connector
   */
  private createExecutor(connector: Connector): ToolExecutor {
    return async (input: Record<string, unknown>): Promise<string> => {
      const command = input.command as string;
      const args = (input.args as string[]) || [];
      const options = (input.options as Record<string, unknown>) || {};
      const cwd = typeof input.cwd === 'string' ? input.cwd : process.cwd();
      const timeoutMs = Number(options.timeoutMs || options.timeout || 15000);

      // Check if this should run as an async job
      const jobManager = this.jobManagerGetter?.();
      if (jobManager && jobManager.shouldRunAsync(connector.name, input)) {
        const job = await jobManager.startJob(connector.name, command, input, connector.cli);
        return `Job started in background.\n\nJob ID: ${job.id}\nConnector: ${connector.name}\nCommand: ${command}\nTimeout: ${job.timeoutMs / 1000}s\n\nUse job_status or job_result to check progress.`;
      }

      // Build the command
      const cmdParts = buildCommandArgs(connector.cli, [...splitCommandLine(command), ...args]);

      // Add options
      for (const [key, value] of Object.entries(options)) {
        if (key === 'timeoutMs' || key === 'timeout' || key === 'async') continue;
        if (value === true) {
          cmdParts.push(`--${key}`);
        } else if (value !== false && value !== undefined) {
          cmdParts.push(`--${key}`, String(value));
        }
      }

      const lowerCommand = command.toLowerCase();
      const lowerArgs = args.map((arg) => arg.toLowerCase());
      const combined = [lowerCommand, ...lowerArgs].join(' ');
      const isAuthLogin =
        /\bauth\b/.test(combined) &&
        /(login|authorize|authorization|oauth|signin|sign-in|connect)/.test(combined);
      const runInBackground = options.background === true;

      const runtime = getRuntime();
      if (isAuthLogin || runInBackground) {
        try {
          const proc = runtime.spawn(cmdParts, {
            cwd,
            stdin: 'ignore',
            stdout: 'ignore',
            stderr: 'ignore',
          });
          // Note: unref is not available in the runtime interface
        } catch {
          // ignore spawn errors; fall through to error message below
        }
        return isAuthLogin
          ? 'Auth login started in the background. Complete it in your browser, then run auth status to confirm.'
          : 'Command started in the background.';
      }

      try {
        const proc = runtime.spawn(cmdParts, {
          cwd,
          stdin: 'ignore',
          stdout: 'pipe',
          stderr: 'pipe',
        });
        let timedOut = false;
        const timer = setTimeout(() => {
          timedOut = true;
          proc.kill();
        }, Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 15000);

        const [stdout, stderr] = await Promise.all([
          proc.stdout ? new Response(proc.stdout).text() : '',
          proc.stderr ? new Response(proc.stderr).text() : '',
        ]);
        const exitCode = await proc.exited;
        clearTimeout(timer);

        if (timedOut) {
          throw new ConnectorError(
            `Command timed out after ${Math.round((Number.isFinite(timeoutMs) ? timeoutMs : 15000) / 1000)}s.`,
            {
              connectorName: connector.name,
              command,
              code: ErrorCodes.CONNECTOR_EXECUTION_FAILED,
              recoverable: true,
              retryable: true,
              suggestion: 'Try again or increase the timeout.',
            }
          );
        }

        if (exitCode !== 0) {
          const stderrText = stderr.toString().trim();
          const stdoutText = stdout.toString().trim();
          throw new ConnectorError(`Exit ${exitCode}: ${stderrText || stdoutText || 'Command failed'}`, {
            connectorName: connector.name,
            command,
            code: ErrorCodes.CONNECTOR_EXECUTION_FAILED,
            recoverable: true,
            retryable: false,
          });
        }

        return stdout.toString().trim() || 'Command completed successfully';
      } catch (error) {
        if (error instanceof ConnectorError) throw error;
        throw new ConnectorError(error instanceof Error ? error.message : String(error), {
          connectorName: connector.name,
          command,
          code: ErrorCodes.CONNECTOR_EXECUTION_FAILED,
          recoverable: true,
          retryable: false,
        });
      }
    };
  }

  /**
   * Get a connector by name
   */
  getConnector(name: string): Connector | undefined {
    return this.connectors.get(name);
  }

  /**
   * Get all connectors
   */
  getConnectors(): Connector[] {
    return Array.from(this.connectors.values());
  }

  /**
   * Clear all caches (memory and disk) to force re-discovery
   */
  static clearCache(): void {
    ConnectorBridge.cache.clear();
    ConnectorBridge.diskCacheLoaded = false;

    // Remove disk cache file
    try {
      const cachePath = ConnectorBridge.getCachePath();
      if (existsSync(cachePath)) {
        const { unlinkSync } = require('fs');
        unlinkSync(cachePath);
      }
    } catch {
      // Ignore errors - cache file may not exist
    }
  }

  /**
   * Get cache statistics for status display
   */
  static getCacheStats(): { cacheSize: number; diskCacheLoaded: boolean; cachePath: string } {
    return {
      cacheSize: ConnectorBridge.cache.size,
      diskCacheLoaded: ConnectorBridge.diskCacheLoaded,
      cachePath: ConnectorBridge.getCachePath(),
    };
  }

  /**
   * Refresh connectors by clearing cache and re-discovering
   */
  async refresh(connectorNames?: string[]): Promise<Connector[]> {
    // Clear instance connectors
    this.connectors.clear();

    // Clear static caches
    ConnectorBridge.clearCache();

    // Re-discover connectors
    return this.discover(connectorNames);
  }

  /**
   * Check authentication status for a connector
   * Returns status object with authenticated flag, user/email info, or error
   */
  async checkAuthStatus(connector: Connector): Promise<{
    authenticated: boolean;
    user?: string;
    email?: string;
    error?: string;
  }> {
    const cli = connector.cli || `connect-${connector.name}`;
    const runtime = getRuntime();

    try {
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      const timeoutPromise = new Promise<{ exitCode: number; stdout: string }>((resolve) => {
        timeoutId = setTimeout(() => {
          resolve({ exitCode: 1, stdout: '' });
        }, 1000);
      });

      const execPromise = (async () => {
        const cmdParts = buildCommandArgs(cli, ['auth', 'status', '--format', 'json']);
        const proc = runtime.spawn(cmdParts, {
          cwd: this.cwd || process.cwd(),
          stdin: 'ignore',
          stdout: 'pipe',
          stderr: 'ignore',
        });
        const stdout = proc.stdout ? await new Response(proc.stdout).text() : '';
        const exitCode = await proc.exited;
        return { exitCode, stdout };
      })();

      const result = await Promise.race([execPromise, timeoutPromise]);

      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      if (result.exitCode === 0) {
        try {
          const parsed = JSON.parse(result.stdout);
          return {
            authenticated: Boolean(parsed.authenticated),
            user: parsed.user,
            email: parsed.email,
          };
        } catch {
          return { authenticated: false, error: 'Invalid response' };
        }
      }

      return { authenticated: false };
    } catch (err) {
      return { authenticated: false, error: err instanceof Error ? err.message : 'Failed to check' };
    }
  }

  /**
   * Get detailed help for a specific command
   * Runs: <cli> <command> --help
   */
  async getCommandHelp(connector: Connector, command: string): Promise<string> {
    const cli = connector.cli || `connect-${connector.name}`;
    const runtime = getRuntime();

    try {
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      const timeoutPromise = new Promise<{ exitCode: number; stdout: string }>((resolve) => {
        timeoutId = setTimeout(() => {
          resolve({ exitCode: 1, stdout: '' });
        }, 2000);
      });

      const execPromise = (async () => {
        const cmdParts = buildCommandArgs(cli, [command, '--help']);
        const proc = runtime.spawn(cmdParts, {
          cwd: this.cwd || process.cwd(),
          stdin: 'ignore',
          stdout: 'pipe',
          stderr: 'pipe',
        });
        const stdout = proc.stdout ? await new Response(proc.stdout).text() : '';
        const stderr = proc.stderr ? await new Response(proc.stderr).text() : '';
        const exitCode = await proc.exited;
        // Some CLIs output help to stderr
        return { exitCode, stdout: stdout || stderr };
      })();

      const result = await Promise.race([execPromise, timeoutPromise]);

      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      return result.stdout.trim() || 'No help available';
    } catch {
      return 'Failed to get help';
    }
  }
}

export const __test__ = {
  resolveTimeout,
};

// ============================================
// Connector Execute Tool (Generic)
// ============================================

/**
 * Generic connector execution tool that can run any connector command.
 * This reduces context usage when many connectors are available by providing
 * a single tool that can execute any discovered connector.
 */
export const connectorExecuteTool: Tool = {
  name: 'connector_execute',
  description: 'Execute a command on any discovered connector. Use connectors_list or connectors_search first to discover available connectors and their commands.',
  parameters: {
    type: 'object',
    properties: {
      connector: {
        type: 'string',
        description: 'Name of the connector to use (e.g., "notion", "gmail", "googledrive")',
      },
      command: {
        type: 'string',
        description: 'The command to run on the connector',
      },
      args: {
        type: 'array',
        description: 'Arguments to pass to the command',
        items: { type: 'string', description: 'Argument value' },
      },
      options: {
        type: 'object',
        description: 'Options to pass to the command (key-value pairs)',
      },
    },
    required: ['connector', 'command'],
  },
};

export interface ConnectorExecuteContext {
  getConnectorBridge: () => ConnectorBridge | null;
}

export function createConnectorExecuteExecutor(
  context: ConnectorExecuteContext
): ToolExecutor {
  return async (input: Record<string, unknown>): Promise<string> => {
    const bridge = context.getConnectorBridge();
    if (!bridge) {
      return JSON.stringify({
        error: 'Connector system not available',
        suggestion: 'Ensure connectors are configured and discovered',
      });
    }

    const connectorName = input.connector as string;
    if (!connectorName) {
      return JSON.stringify({
        error: 'Missing required parameter: connector',
        suggestion: 'Use connectors_list to find available connectors',
      });
    }

    const connector = bridge.getConnector(connectorName);
    if (!connector) {
      const available = bridge.getConnectors().map(c => c.name);
      return JSON.stringify({
        error: `Connector '${connectorName}' not found`,
        available: available.slice(0, 10),
        totalAvailable: available.length,
        suggestion: 'Use connectors_list to see all available connectors',
      });
    }

    // Create an executor for this connector and run it
    const executor = bridge['createExecutor'](connector);
    return executor({
      command: input.command,
      args: input.args,
      options: input.options,
      cwd: input.cwd,
    });
  };
}

export function registerConnectorExecuteTool(
  registry: ToolRegistry,
  context: ConnectorExecuteContext
): void {
  const executor = createConnectorExecuteExecutor(context);
  registry.register(connectorExecuteTool, executor);
}

// ============================================
// Connectors Search Tool
// ============================================

/**
 * Search tool for finding connectors by name, description, or command.
 * Useful when many connectors are available and user needs to find specific ones.
 */
export const connectorsSearchTool: Tool = {
  name: 'connectors_search',
  description: 'Search for connectors by name, description, or command. Use this to find the right connector for a task when many are available.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query to match against connector names, descriptions, and commands',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results to return (default: 5, max: 20)',
      },
    },
    required: ['query'],
  },
};

export interface ConnectorSearchContext {
  getConnectorBridge: () => ConnectorBridge | null;
  onConnectorSelected?: (connectorName: string) => void;
}

export function createConnectorsSearchExecutor(
  context: ConnectorSearchContext
): ToolExecutor {
  return async (input: Record<string, unknown>): Promise<string> => {
    const bridge = context.getConnectorBridge();
    if (!bridge) {
      return JSON.stringify({
        error: 'Connector discovery not available',
        results: [],
      });
    }

    const query = (input.query as string || '').toLowerCase();
    const limit = Math.min(Math.max(1, Number(input.limit) || 5), 20);

    if (!query) {
      return JSON.stringify({
        error: 'Search query is required',
        suggestion: 'Provide a query like "email", "storage", or "calendar"',
      });
    }

    const connectors = bridge.getConnectors();
    const results: Array<{
      name: string;
      description: string;
      matchedCommands: string[];
      score: number;
    }> = [];

    for (const connector of connectors) {
      let score = 0;
      const matchedCommands: string[] = [];

      // Score name match (highest weight)
      if (connector.name.toLowerCase().includes(query)) {
        score += 10;
        if (connector.name.toLowerCase() === query) {
          score += 5; // Exact match bonus
        }
      }

      // Score description match
      if (connector.description.toLowerCase().includes(query)) {
        score += 5;
      }

      // Score command matches
      for (const cmd of connector.commands) {
        if (cmd.name.toLowerCase().includes(query)) {
          score += 2;
          matchedCommands.push(cmd.name);
        }
        if (cmd.description.toLowerCase().includes(query)) {
          score += 1;
          if (!matchedCommands.includes(cmd.name)) {
            matchedCommands.push(cmd.name);
          }
        }
      }

      if (score > 0) {
        results.push({
          name: connector.name,
          description: connector.description,
          matchedCommands: matchedCommands.slice(0, 5),
          score,
        });
      }
    }

    // Sort by score (descending) and limit results
    results.sort((a, b) => b.score - a.score);
    const topResults = results.slice(0, limit);

    // Notify about selected connectors (for dynamic binding)
    if (context.onConnectorSelected && topResults.length > 0) {
      for (const result of topResults) {
        context.onConnectorSelected(result.name);
      }
    }

    return JSON.stringify({
      query,
      count: topResults.length,
      totalMatches: results.length,
      results: topResults.map(({ score, ...rest }) => rest),
      suggestion: topResults.length > 0
        ? `Use connector_execute with connector="${topResults[0].name}" to run commands`
        : 'Try a different search query or use connectors_list to see all available connectors',
    }, null, 2);
  };
}

export function registerConnectorsSearchTool(
  registry: ToolRegistry,
  context: ConnectorSearchContext
): void {
  const executor = createConnectorsSearchExecutor(context);
  registry.register(connectorsSearchTool, executor);
}

// ============================================
// Connectors List Tool
// ============================================

export const connectorsListTool: Tool = {
  name: 'connectors_list',
  description: 'List all discovered connectors and their available commands. Use this to discover what connectors are available and what operations they support.',
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Optional: filter to a specific connector by name',
      },
      verbose: {
        type: 'boolean',
        description: 'Optional: include detailed command information (default: false)',
      },
      page: {
        type: 'number',
        description: 'Optional: page number for paginated results (default: 1)',
      },
      limit: {
        type: 'number',
        description: 'Optional: items per page (default: 10, max: 50)',
      },
    },
    required: [],
  },
};

export interface ConnectorListContext {
  getConnectorBridge: () => ConnectorBridge | null;
  /** Optional callback when a connector is explicitly viewed (for dynamic binding) */
  onConnectorSelected?: (connectorName: string) => void;
}

export function createConnectorsListExecutor(
  context: ConnectorListContext
): ToolExecutor {
  return async (input: Record<string, unknown>): Promise<string> => {
    const bridge = context.getConnectorBridge();
    if (!bridge) {
      return JSON.stringify({
        error: 'Connector discovery not available',
        connectors: [],
      });
    }

    const connectors = bridge.getConnectors();
    const autoRefreshManager = ConnectorAutoRefreshManager.getInstance();
    await autoRefreshManager.start();
    const filterName = input.name as string | undefined;
    const verbose = input.verbose === true;
    const page = Math.max(1, Number(input.page) || 1);
    const limit = Math.min(Math.max(1, Number(input.limit) || 10), 50);

    // Filter by name if specified
    let filtered = filterName
      ? connectors.filter((c) => c.name.toLowerCase() === filterName.toLowerCase())
      : connectors;

    if (filtered.length === 0 && filterName) {
      // Try partial match
      filtered = connectors.filter((c) =>
        c.name.toLowerCase().includes(filterName.toLowerCase())
      );

      if (filtered.length === 0) {
        return JSON.stringify({
          error: `Connector '${filterName}' not found`,
          available: connectors.slice(0, 10).map((c) => c.name),
          totalAvailable: connectors.length,
          suggestion: 'Use connectors_search to find connectors by functionality',
        });
      }
    }

    // Notify about explicitly viewed connector (for dynamic binding)
    if (context.onConnectorSelected && filterName && filtered.length === 1) {
      context.onConnectorSelected(filtered[0].name);
    }

    // Apply pagination
    const total = filtered.length;
    const totalPages = Math.ceil(total / limit);
    const startIndex = (page - 1) * limit;
    const paginated = filtered.slice(startIndex, startIndex + limit);

    const result = paginated.map((connector) => {
      const autoRefreshEntry = autoRefreshManager.get(connector.name);
      const base: Record<string, unknown> = {
        name: connector.name,
        description: connector.description,
        autoRefresh: autoRefreshEntry
          ? {
              enabled: autoRefreshEntry.enabled,
              schedule: autoRefreshEntry.schedule,
              nextRunAt: autoRefreshEntry.nextRunAt,
              lastRunAt: autoRefreshEntry.lastRunAt,
              lastResult: autoRefreshEntry.lastResult,
            }
          : null,
        commands: verbose
          ? connector.commands.map((cmd) => ({
              name: cmd.name,
              description: cmd.description,
              args: cmd.args.map((a) => ({
                name: a.name,
                description: a.description,
                required: a.required,
                type: a.type,
              })),
              options: cmd.options.map((o) => ({
                name: o.name,
                description: o.description,
                type: o.type,
                default: o.default,
              })),
            }))
          : connector.commands.map((cmd) => cmd.name),
      };
      return base;
    });

    return JSON.stringify(
      {
        count: result.length,
        total,
        page,
        limit,
        totalPages,
        hasMore: page < totalPages,
        connectors: result,
        ...(total > limit && !filterName ? {
          tip: 'Use connectors_search to find specific connectors, or connector_execute to run commands directly',
        } : {}),
      },
      null,
      2
    );
  };
}

export function registerConnectorsListTool(
  registry: ToolRegistry,
  context: ConnectorListContext
): void {
  const executor = createConnectorsListExecutor(context);
  registry.register(connectorsListTool, executor);
}
