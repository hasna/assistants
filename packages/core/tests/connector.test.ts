import { describe, expect, test, beforeEach } from 'bun:test';
import { ConnectorBridge } from '../src/tools/connector';
import { ToolRegistry } from '../src/tools/registry';
import type { Connector, ConnectorCommand } from '@hasna/assistants-shared';
import { mkdtempSync, writeFileSync, chmodSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('ConnectorBridge', () => {
  let bridge: ConnectorBridge;

  beforeEach(() => {
    bridge = new ConnectorBridge();
  });

  describe('parseHelpOutput', () => {
    // Access private method for testing via type assertion
    const parseHelp = (bridge: ConnectorBridge, helpText: string, name: string): ConnectorCommand[] => {
      return (bridge as any).parseHelpOutput(helpText, name);
    };

    test('should parse commands from standard help output', () => {
      const helpText = `
connect-notion v1.0.0

Usage: connect-notion [command] [options]

Commands:
  search      Search for pages and databases
  get         Get a page or database by ID
  create      Create a new page
  update      Update an existing page

Options:
  --help      Show help
  --version   Show version
`;

      const commands = parseHelp(bridge, helpText, 'notion');
      expect(commands.length).toBeGreaterThanOrEqual(3);
      expect(commands.map((c) => c.name)).toContain('search');
      expect(commands.map((c) => c.name)).toContain('get');
      expect(commands.map((c) => c.name)).toContain('create');
    });

    test('should skip help and version commands', () => {
      const helpText = `
Commands:
  search      Search for items
  help        Show help
  --help      Show help
  version     Show version
  -v          Show version
`;

      const commands = parseHelp(bridge, helpText, 'test');
      const names = commands.map((c) => c.name);
      expect(names).toContain('search');
      expect(names).not.toContain('help');
      expect(names).not.toContain('--help');
      expect(names).not.toContain('version');
      expect(names).not.toContain('-v');
    });

    test('should return default commands when none found', () => {
      const helpText = `
connect-example v1.0.0

This is a tool with no documented commands.
`;

      const commands = parseHelp(bridge, helpText, 'example');
      expect(commands.length).toBeGreaterThan(0);
      // Should have fallback commands
      const names = commands.map((c) => c.name);
      expect(names).toContain('auth status');
    });

    test('should handle multi-word command descriptions', () => {
      const helpText = `
Commands:
  list-pages    List all available pages in the workspace
  sync-all      Synchronize all data from remote
`;

      const commands = parseHelp(bridge, helpText, 'test');
      const listCmd = commands.find((c) => c.name === 'list-pages');
      expect(listCmd).toBeDefined();
      expect(listCmd?.description).toContain('pages');
    });
  });

  describe('createTool', () => {
    // Access private method for testing
    const createTool = (bridge: ConnectorBridge, connector: Connector) => {
      return (bridge as any).createTool(connector);
    };

    test('should create tool definition from connector', () => {
      const connector: Connector = {
        name: 'notion',
        cli: 'connect-notion',
        description: 'Notion integration',
        commands: [
          { name: 'search', description: 'Search pages', args: [], options: [] },
          { name: 'get', description: 'Get page', args: [], options: [] },
        ],
      };

      const tool = createTool(bridge, connector);
      expect(tool.name).toBe('notion');
      expect(tool.description).toContain('Notion integration');
      expect(tool.description).toContain('search');
      expect(tool.description).toContain('get');
      expect(tool.parameters.type).toBe('object');
      expect(tool.parameters.properties.command).toBeDefined();
      expect(tool.parameters.required).toContain('command');
    });

    test('should include command descriptions in tool', () => {
      const connector: Connector = {
        name: 'gmail',
        cli: 'connect-gmail',
        description: 'Gmail integration',
        commands: [
          { name: 'list', description: 'List emails', args: [], options: [] },
          { name: 'send', description: 'Send an email', args: [], options: [] },
        ],
      };

      const tool = createTool(bridge, connector);
      expect(tool.parameters.properties.command.description).toContain('list (List emails)');
      expect(tool.parameters.properties.command.description).toContain('send (Send an email)');
    });
  });

  describe('getConnector and getConnectors', () => {
    test('should return undefined for non-existent connector', () => {
      expect(bridge.getConnector('non-existent')).toBeUndefined();
    });

    test('should return empty array when no connectors discovered', () => {
      expect(bridge.getConnectors()).toEqual([]);
    });

    test('should return existing connector entries', () => {
      const connector: Connector = {
        name: 'demo',
        cli: 'connect-demo',
        description: 'Demo connector',
        commands: [{ name: 'list', description: 'List items', args: [], options: [] }],
      };
      (bridge as any).connectors.set('demo', connector);

      const fetched = bridge.getConnector('demo');
      expect(fetched?.name).toBe('demo');
      expect(bridge.getConnectors().length).toBe(1);
    });
  });

  describe('discover', () => {
    test('should auto-discover connect-* binaries on PATH', async () => {
      const binDir = mkdtempSync(join(tmpdir(), 'assistants-bin-'));
      const cliPath = join(binDir, 'connect-demo');
      const exePath = join(binDir, 'connect-win.exe');
      const dirPath = join(binDir, 'connect-dir');
      writeFileSync(cliPath, '#!/bin/sh\necho demo\n');
      writeFileSync(exePath, '#!/bin/sh\necho win\n');
      chmodSync(cliPath, 0o755);
      chmodSync(exePath, 0o755);
      mkdirSync(dirPath, { recursive: true });

      const originalPath = process.env.PATH;
      process.env.PATH = `${binDir}:${originalPath || ''}`;

      try {
        (ConnectorBridge as any).cache = new Map();
        const discovered = await bridge.discover();
        expect(discovered.some((c) => c.name === 'demo')).toBe(true);
        if (process.platform === 'win32') {
          expect(discovered.some((c) => c.name === 'win')).toBe(true);
        }
        expect(discovered.some((c) => c.name === 'dir')).toBe(false);
      } finally {
        process.env.PATH = originalPath;
        rmSync(binDir, { recursive: true, force: true });
      }
    });

    test('should discover connector commands from help output', async () => {
      const binDir = mkdtempSync(join(tmpdir(), 'assistants-bin-help-'));
      const cliPath = join(binDir, 'connect-foo');
      const helpOutput = [
        'Usage: connect-foo <command>',
        '',
        'Commands:',
        '  list    List items',
        '  help    Show help',
        '',
      ].join('\\n');

      writeFileSync(
        cliPath,
        `#!/bin/sh\necho "${helpOutput.replace(/"/g, '\\"')}"\n`
      );
      chmodSync(cliPath, 0o755);

      try {
        const connector = await (bridge as any).discoverConnector('foo', cliPath);
        expect(connector?.name).toBe('foo');
        expect(connector?.commands.some((cmd: { name: string }) => cmd.name === 'list')).toBe(true);
        expect(connector?.commands.some((cmd: { name: string }) => cmd.name === 'help')).toBe(false);
      } finally {
        rmSync(binDir, { recursive: true, force: true });
      }
    });

    test('should use manifest description when available', async () => {
      const binDir = mkdtempSync(join(tmpdir(), 'assistants-bin-manifest-'));
      const cliPath = join(binDir, 'connect-foo');
      const helpOutput = [
        'Usage: connect-foo <command>',
        '',
        'Commands:',
        '  list    List items',
        '',
      ].join('\\n');

      writeFileSync(
        cliPath,
        `#!/bin/sh\necho "${helpOutput.replace(/"/g, '\\"')}"\n`
      );
      chmodSync(cliPath, 0o755);

      const homeDir = mkdtempSync(join(tmpdir(), 'assistants-home-'));
      const originalHome = process.env.HOME;
      process.env.HOME = homeDir;

      const manifestDir = join(homeDir, '.connect-foo');
      mkdirSync(manifestDir, { recursive: true });
      writeFileSync(join(manifestDir, 'manifest.json'), JSON.stringify({ description: 'Foo connector' }));

      try {
        const connector = await (bridge as any).discoverConnector('foo', cliPath);
        expect(connector?.description).toBe('Foo connector');
      } finally {
        process.env.HOME = originalHome;
        rmSync(homeDir, { recursive: true, force: true });
        rmSync(binDir, { recursive: true, force: true });
      }
    });

    test('should handle timeouts when discovery hangs', async () => {
      const originalDollar = (Bun as any).$;
      const originalSetTimeout = globalThis.setTimeout;

      (Bun as any).$ = () => ({
        quiet: () => ({
          nothrow: () => new Promise(() => {}),
        }),
      });
      globalThis.setTimeout = ((fn: (...args: any[]) => void, _ms?: number, ...args: any[]) => {
        fn(...args);
        return 0 as unknown as ReturnType<typeof setTimeout>;
      }) as typeof setTimeout;

      try {
        (ConnectorBridge as any).cache = new Map();
        const discovered = await bridge.discover(['demo']);
        expect(discovered).toEqual([]);
      } finally {
        globalThis.setTimeout = originalSetTimeout;
        (Bun as any).$ = originalDollar;
      }
    });
  });

  describe('registerAll', () => {
    test('should register tools to registry', async () => {
      const registry = new ToolRegistry();

      // Manually add a connector for testing
      const connector: Connector = {
        name: 'test',
        cli: 'connect-test',
        description: 'Test connector',
        commands: [{ name: 'run', description: 'Run command', args: [], options: [] }],
      };

      // Directly set the connector in the bridge
      (bridge as any).connectors.set('test', connector);

      bridge.registerAll(registry);

      expect(registry.hasTool('test')).toBe(true);
      const tool = registry.getTool('test');
      expect(tool?.name).toBe('test');
    });
  });
});
