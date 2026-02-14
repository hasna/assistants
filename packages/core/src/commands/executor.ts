import type { Command, CommandContext, CommandResult } from './types';
import type { CommandLoader } from './loader';
import { getRuntime } from '../runtime';
import { validateBashCommand } from '../security/bash-validator';
import { getSecurityLogger } from '../security/logger';

/** Maximum output length for shell commands (64KB) */
const MAX_SHELL_OUTPUT_LENGTH = 64 * 1024;

/**
 * CommandExecutor - executes slash commands
 *
 * Features:
 * - Argument substitution ($ARGUMENTS)
 * - Shell command injection (!command)
 * - Self-handled commands (built-in)
 * - Custom commands (sent to LLM)
 */
export class CommandExecutor {
  private loader: CommandLoader;

  constructor(loader: CommandLoader) {
    this.loader = loader;
  }

  /**
   * Parse a slash command from user input
   * Returns null if input is not a slash command
   */
  parseCommand(input: string): { name: string; args: string } | null {
    const trimmed = input.trim();

    // Must start with /
    if (!trimmed.startsWith('/')) {
      return null;
    }

    // Extract command name and arguments
    const match = trimmed.match(/^\/(\S+)(?:\s+(.*))?$/);
    if (!match) {
      return null;
    }

    return {
      name: match[1],
      args: match[2] || '',
    };
  }

  /**
   * Check if input is a slash command
   */
  isCommand(input: string): boolean {
    return this.parseCommand(input) !== null;
  }

  /**
   * Execute a slash command
   */
  async execute(input: string, context: CommandContext): Promise<CommandResult> {
    const parsed = this.parseCommand(input);

    if (!parsed) {
      return { handled: false };
    }

    const command = this.loader.getCommand(parsed.name);

    if (!command) {
      // Unknown command
      context.emit('text', `Unknown command: /${parsed.name}\n\nUse /help to see available commands.\n`);
      context.emit('done');
      return { handled: true };
    }

    // Self-handled commands (built-in with handler)
    if (command.selfHandled && command.handler) {
      return command.handler(parsed.args, context);
    }

    // Commands that go to LLM
    const prompt = await this.preparePrompt(command, parsed.args, context);

    return {
      handled: false,
      prompt,
    };
  }

  /**
   * Prepare the prompt for LLM
   * - Substitutes $ARGUMENTS
   * - Executes shell commands (!command)
   */
  private async preparePrompt(command: Command, args: string, context: CommandContext): Promise<string> {
    let content = command.content;

    // Substitute $ARGUMENTS
    content = content.replace(/\$ARGUMENTS/g, args || '(no arguments provided)');

    // Execute shell commands (!command) and inject output
    content = await this.processShellCommands(content, context.cwd);

    return content;
  }

  /**
   * Process shell commands in content
   * Lines starting with ! are executed and replaced with their output
   */
  private async processShellCommands(content: string, cwd: string): Promise<string> {
    const lines = content.split('\n');
    const processedLines: string[] = [];
    let inCodeBlock = false;

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed.startsWith('```')) {
        inCodeBlock = !inCodeBlock;
        processedLines.push(line);
        continue;
      }

      if (!inCodeBlock && trimmed.startsWith('!')) {
        // Execute shell command
        const command = trimmed.slice(1).trim();
        if (!command) {
          processedLines.push(line);
          continue;
        }
        const output = await this.executeShell(command, cwd);
        const indent = line.match(/^\s*/)?.[0] ?? '';
        const fenced = [`${indent}\`\`\``, ...output.split('\n').map((o) => `${indent}${o}`), `${indent}\`\`\``];
        processedLines.push(fenced.join('\n'));
      } else {
        processedLines.push(line);
      }
    }

    return processedLines.join('\n');
  }

  /**
   * Execute a shell command and return output
   * Validates command against dangerous patterns before execution
   */
  private async executeShell(command: string, cwd: string): Promise<string> {
    // Validate command before execution
    const validation = validateBashCommand(command);
    if (!validation.valid) {
      getSecurityLogger().log({
        eventType: 'blocked_command',
        severity: validation.severity || 'high',
        details: {
          tool: 'custom_command',
          command,
          reason: validation.reason || 'Command blocked by security policy',
        },
        sessionId: 'custom-command',
      });
      return `Error: ${validation.reason || 'Command blocked by security policy'}`;
    }

    try {
      const runtime = getRuntime();
      const timeoutMs = 5000;
      const isWindows = process.platform === 'win32';
      const shellBinary = isWindows ? 'cmd' : (runtime.which('bash') || 'sh');
      const shellArgs = isWindows ? ['/c', command] : ['-lc', command];
      const proc = runtime.spawn([shellBinary, ...shellArgs], {
        cwd,
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
      });

      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        proc.kill();
      }, timeoutMs);

      const [stdout, stderr] = await Promise.all([
        proc.stdout ? new Response(proc.stdout).text() : '',
        proc.stderr ? new Response(proc.stderr).text() : '',
      ]);

      const exitCode = await proc.exited;
      clearTimeout(timer);

      if (timedOut) {
        return `Error: command timed out after ${Math.round(timeoutMs / 1000)}s.`;
      }

      if (exitCode !== 0 && stderr) {
        const truncatedStderr = stderr.length > MAX_SHELL_OUTPUT_LENGTH
          ? `${stderr.slice(0, MAX_SHELL_OUTPUT_LENGTH)}...(truncated)`
          : stderr;
        return `Error (exit ${exitCode}):\n${truncatedStderr}`;
      }

      // Cap output length to prevent excessive content
      const trimmedOutput = stdout.trim();
      if (trimmedOutput.length > MAX_SHELL_OUTPUT_LENGTH) {
        return `${trimmedOutput.slice(0, MAX_SHELL_OUTPUT_LENGTH)}...(output truncated at ${MAX_SHELL_OUTPUT_LENGTH} bytes)`;
      }

      return trimmedOutput || '(no output)';
    } catch (error) {
      return `Error: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  /**
   * Get command suggestions for partial input
   */
  getSuggestions(partial: string): Command[] {
    if (!partial.startsWith('/')) {
      return [];
    }

    const name = partial.slice(1).toLowerCase();
    return this.loader.findMatching(name);
  }
}
