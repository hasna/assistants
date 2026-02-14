import type { HookEvent, HookHandler, HookInput, HookOutput } from '@hasna/assistants-shared';
import { existsSync } from 'fs';
import { generateId } from '@hasna/assistants-shared';
import { getRuntime } from '../runtime';

/**
 * Result from testing a hook
 */
export interface HookTestResult {
  success: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  parsedOutput: HookOutput | null;
  action: 'ALLOW' | 'BLOCK' | 'MODIFY' | 'ERROR' | 'NO_ACTION';
  reason?: string;
  durationMs: number;
  error?: string;
}

/**
 * Sample inputs for each hook event type
 */
const sampleInputs: Record<HookEvent, Partial<HookInput>> = {
  SessionStart: {
    source: 'test',
  },
  SessionEnd: {
    reason: 'manual',
    duration_ms: 60000,
    message_count: 10,
  },
  UserPromptSubmit: {
    user_prompt: 'Hello, how are you?',
  },
  PreToolUse: {
    tool_name: 'Bash',
    tool_input: { command: 'echo "test"' },
  },
  PostToolUse: {
    tool_name: 'Bash',
    tool_input: { command: 'echo "test"' },
    tool_result: { content: 'test', isError: false },
  },
  PostToolUseFailure: {
    tool_name: 'Bash',
    tool_input: { command: 'cat /nonexistent' },
    tool_result: { content: 'No such file or directory', isError: true },
    error: 'No such file or directory',
  },
  PermissionRequest: {
    tool_name: 'Bash',
    tool_input: { command: 'rm -rf /' },
    permission_type: 'execute',
  },
  Notification: {
    notification_type: 'info',
    title: 'Test Notification',
    message: 'This is a test notification',
  },
  SubassistantStart: {
    subassistant_id: 'test-assistant-001',
    task: 'Explore the codebase and find all API endpoints',
    allowed_tools: ['Glob', 'Grep', 'Read'],
    max_turns: 10,
    depth: 1,
    parent_session_id: 'parent-session-001',
  },
  SubassistantStop: {
    subassistant_id: 'test-assistant-001',
    status: 'completed',
    result: 'Found 5 API endpoints',
    duration_ms: 5000,
    turns_used: 3,
  },
  PreCompact: {
    strategy: 'llm',
    message_count: 50,
  },
  Stop: {
    reason: 'user_request',
  },
};

/**
 * HookTester - test hooks with sample input without running the full assistant
 */
export class HookTester {
  private cwd: string;
  private sessionId: string;

  constructor(cwd: string = process.cwd(), sessionId?: string) {
    this.cwd = cwd;
    this.sessionId = sessionId || generateId();
  }

  /**
   * Test a hook with sample input
   */
  async test(hook: HookHandler, event: HookEvent, customInput?: Partial<HookInput>): Promise<HookTestResult> {
    const startTime = Date.now();

    // Build the input
    const baseInput = sampleInputs[event] || {};
    const input: HookInput = {
      session_id: this.sessionId,
      hook_event_name: event,
      cwd: this.cwd,
      ...baseInput,
      ...customInput,
    };

    // Only command hooks can be tested directly
    if (hook.type !== 'command') {
      return {
        success: false,
        exitCode: null,
        stdout: '',
        stderr: '',
        parsedOutput: null,
        action: 'ERROR',
        error: `Cannot test hook type '${hook.type}' - only 'command' hooks can be tested`,
        durationMs: Date.now() - startTime,
      };
    }

    if (!hook.command) {
      return {
        success: false,
        exitCode: null,
        stdout: '',
        stderr: '',
        parsedOutput: null,
        action: 'ERROR',
        error: 'Hook has no command defined',
        durationMs: Date.now() - startTime,
      };
    }

    try {
      const result = await this.executeCommand(hook.command, input, hook.timeout || 30000);
      return {
        ...result,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        exitCode: null,
        stdout: '',
        stderr: '',
        parsedOutput: null,
        action: 'ERROR',
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Execute a command and collect results
   */
  private async executeCommand(
    command: string,
    input: HookInput,
    timeout: number
  ): Promise<Omit<HookTestResult, 'durationMs'>> {
    const runtime = getRuntime();
    const cwd = input.cwd && existsSync(input.cwd) ? input.cwd : process.cwd();
    const isWindows = process.platform === 'win32';
    const shellBinary = isWindows ? 'cmd' : (runtime.which('bash') || 'sh');
    const shellArgs = isWindows ? ['/c', command] : ['-lc', command];

    const proc = runtime.spawn([shellBinary, ...shellArgs], {
      cwd,
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    });

    // Write input as JSON to stdin
    const inputData = new TextEncoder().encode(JSON.stringify(input));
    const stdin = proc.stdin as unknown as {
      getWriter?: () => { write: (chunk: Uint8Array) => Promise<void> | void; close: () => Promise<void> | void };
      write?: (chunk: Uint8Array) => Promise<void> | void;
      end?: () => Promise<void> | void;
    } | null;

    if (stdin?.getWriter) {
      const writer = stdin.getWriter();
      await writer.write(inputData);
      await writer.close();
    } else if (stdin?.write) {
      await stdin.write(inputData);
      if (stdin.end) {
        await stdin.end();
      }
    }

    // Set up timeout
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, timeout);

    const [stdout, stderr] = await Promise.all([
      proc.stdout ? new Response(proc.stdout).text() : '',
      proc.stderr ? new Response(proc.stderr).text() : '',
    ]);

    clearTimeout(timeoutId);

    if (timedOut) {
      return {
        success: false,
        exitCode: null,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        parsedOutput: null,
        action: 'ERROR',
        error: `Hook timed out after ${timeout}ms`,
      };
    }

    const exitCode = await proc.exited;

    // Parse output and determine action
    let parsedOutput: HookOutput | null = null;
    let action: HookTestResult['action'] = 'NO_ACTION';
    let reason: string | undefined;

    if (exitCode === 0) {
      // Try to parse JSON output
      try {
        parsedOutput = JSON.parse(stdout.trim()) as HookOutput;
        if (parsedOutput.continue === false) {
          action = 'BLOCK';
          reason = parsedOutput.stopReason;
        } else if (parsedOutput.updatedInput) {
          action = 'MODIFY';
        } else if (parsedOutput.permissionDecision) {
          action = parsedOutput.permissionDecision === 'deny' ? 'BLOCK' : 'ALLOW';
          reason = parsedOutput.permissionDecision;
        } else {
          action = 'ALLOW';
        }
      } catch {
        // Not JSON, just context addition
        action = 'ALLOW';
        if (stdout.trim()) {
          parsedOutput = { continue: true, additionalContext: stdout.trim() };
        }
      }
    } else if (exitCode === 2) {
      // Blocking exit code
      action = 'BLOCK';
      reason = stderr.trim() || 'Blocked by hook';
      parsedOutput = { continue: false, stopReason: reason };
    } else {
      // Other error
      action = 'ERROR';
      reason = `Exit code ${exitCode}: ${stderr.trim()}`;
    }

    return {
      success: exitCode === 0 || exitCode === 2,
      exitCode,
      stdout: stdout.trim(),
      stderr: stderr.trim(),
      parsedOutput,
      action,
      reason,
    };
  }

  /**
   * Generate sample input for an event type
   */
  static getSampleInput(event: HookEvent): Partial<HookInput> {
    return sampleInputs[event] || {};
  }

  /**
   * Get all available event types
   */
  static getEventTypes(): HookEvent[] {
    return Object.keys(sampleInputs) as HookEvent[];
  }
}
