import type { HookMatcher, HookHandler, HookInput, HookOutput, Message } from '@hasna/assistants-shared';
import type { LLMClient } from '../llm/client';
import { existsSync } from 'fs';
import { generateId, sleep } from '@hasna/assistants-shared';
import { getRuntime } from '../runtime';
import { HookLogger } from './logger';
import { backgroundProcessManager } from './background';

function killSpawnedProcess(proc: { kill: () => void }): void {
  proc.kill();
}

type AssistantRunner = (hook: HookHandler, input: HookInput, timeout: number) => Promise<string | null>;

/**
 * Hook executor - runs hooks and collects results
 */
export class HookExecutor {
  private llmClient?: LLMClient;
  private assistantRunner?: AssistantRunner;
  private logger?: HookLogger;

  setLLMClient(client: LLMClient): void {
    this.llmClient = client;
  }

  setAssistantRunner(runner: AssistantRunner): void {
    this.assistantRunner = runner;
  }

  setLogger(logger: HookLogger): void {
    this.logger = logger;
  }

  /**
   * Execute hooks for an event
   */
  async execute(matchers: HookMatcher[], input: HookInput): Promise<HookOutput | null> {
    if (matchers.length === 0) {
      return null;
    }

    let mergedInput: Record<string, unknown> | undefined;

    for (const matcher of matchers) {
      // Check if matcher matches the input
      if (!this.matchesPattern(matcher.matcher, input)) {
        continue;
      }

      // Execute all hooks in this matcher
      for (const hook of matcher.hooks) {
        // Skip disabled hooks (enabled defaults to true if not specified)
        if (hook.enabled === false) {
          continue;
        }

        const result = await this.executeHook(hook, input);

        // If hook returns a blocking result, stop processing
        if (result && result.continue === false) {
          return result;
        }

        // If hook returns a permission decision, use it
        if (result?.permissionDecision) {
          return result;
        }

        // If hook returns updated input, merge it (later hooks can override earlier)
        if (result?.updatedInput) {
          mergedInput = {
            ...(mergedInput || {}),
            ...result.updatedInput,
          };
        }
      }
    }

    // Return merged updated input if any hooks modified it
    if (mergedInput) {
      return { continue: true, updatedInput: mergedInput };
    }

    return null;
  }

  /**
   * Check if input matches the matcher pattern
   */
  private matchesPattern(pattern: string | undefined, input: HookInput): boolean {
    // Empty or wildcard pattern matches everything
    if (!pattern || pattern === '*' || pattern === '') {
      return true;
    }

    // Get the value to match against
    let value: string | undefined;

    switch (input.hook_event_name) {
      case 'PreToolUse':
      case 'PostToolUse':
      case 'PostToolUseFailure':
      case 'PermissionRequest':
        value = input.tool_name;
        break;
      case 'SessionStart':
        value = input.source as string;
        break;
      case 'SessionEnd':
        value = input.reason as string;
        break;
      case 'Notification':
        value = input.notification_type as string;
        break;
      case 'SubassistantStart':
        // Match on task pattern for subassistant hooks
        value = input.task as string;
        break;
      case 'SubassistantStop':
        // Match on status pattern for subassistant stop hooks (completed, failed, timeout)
        value = input.status as string;
        break;
      case 'PreCompact':
        // Match on strategy pattern for compaction hooks (llm, hybrid)
        value = input.strategy as string;
        break;
      default:
        return true; // Events without matchers always match
    }

    if (!value) {
      return true;
    }

    // Try regex match
    try {
      const regex = new RegExp(`^${pattern}$`);
      return regex.test(value);
    } catch {
      // Fall back to simple equality
      return value === pattern;
    }
  }

  /**
   * Execute a single hook
   */
  private async executeHook(hook: HookHandler, input: HookInput): Promise<HookOutput | null> {
    const timeout = hook.timeout || 30000;
    const startTime = Date.now();

    try {
      let result: HookOutput | null = null;
      switch (hook.type) {
        case 'command':
          result = await this.executeCommandHook(hook, input, timeout);
          break;
        case 'prompt':
          result = await this.executePromptHook(hook, input, timeout);
          break;
        case 'assistant':
          result = await this.executeAssistantHook(hook, input, timeout);
          break;
        default:
          return null;
      }

      // Log successful execution
      const durationMs = Date.now() - startTime;
      this.logger?.logExecution(hook, input, result, durationMs);

      return result;
    } catch (error) {
      // Log failed execution
      const durationMs = Date.now() - startTime;
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger?.logExecution(hook, input, null, durationMs, undefined, errorMsg);
      console.error(`Hook execution error:`, error);
      return null;
    }
  }

  /**
   * Execute a command hook
   */
  private async executeCommandHook(
    hook: HookHandler,
    input: HookInput,
    timeout: number
  ): Promise<HookOutput | null> {
    if (!hook.command) return null;

    // Handle async hooks - fire and forget
    if (hook.async) {
      return this.executeAsyncCommandHook(hook, input, timeout);
    }

    try {
      const runtime = getRuntime();
      // Run the command with input on stdin
      const cwd = input.cwd && existsSync(input.cwd) ? input.cwd : process.cwd();
      const isWindows = process.platform === 'win32';
      const shellBinary = isWindows ? 'cmd' : (runtime.which('bash') || 'sh');
      const shellArgs = isWindows ? ['/c', hook.command] : ['-lc', hook.command];
      const proc = runtime.spawn([shellBinary, ...shellArgs], {
        cwd,
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
      });

      // Write input as JSON to stdin (handle Web streams and Bun FileSink)
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
      const timeoutId = setTimeout(killSpawnedProcess, timeout, proc);

      const [stdout, stderr] = await Promise.all([
        proc.stdout ? new Response(proc.stdout).text() : '',
        proc.stderr ? new Response(proc.stderr).text() : '',
      ]);

      clearTimeout(timeoutId);

      const exitCode = await proc.exited;

      // Exit code 0: success, parse JSON output
      if (exitCode === 0) {
        try {
          return JSON.parse(stdout.trim());
        } catch {
          // Not JSON, just return success
          return { continue: true, additionalContext: stdout.trim() };
        }
      }

      // Exit code 2: blocking error
      if (exitCode === 2) {
        return {
          continue: false,
          stopReason: stderr.trim() || 'Blocked by hook',
        };
      }

      // Other exit codes: non-blocking error
      return null;
    } catch (error) {
      console.error(`Command hook error:`, error);
      return null;
    }
  }

  /**
   * Execute an async command hook (fire and forget)
   */
  private executeAsyncCommandHook(
    hook: HookHandler,
    input: HookInput,
    timeout: number
  ): HookOutput | null {
    if (!hook.command) return null;

    try {
      const runtime = getRuntime();
      const cwd = input.cwd && existsSync(input.cwd) ? input.cwd : process.cwd();
      const isWindows = process.platform === 'win32';
      const shellBinary = isWindows ? 'cmd' : (runtime.which('bash') || 'sh');
      const shellArgs = isWindows ? ['/c', hook.command] : ['-lc', hook.command];

      const proc = runtime.spawn([shellBinary, ...shellArgs], {
        cwd,
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
      });

      // Track the background process
      const bgId = backgroundProcessManager.track(hook.id || 'unknown', proc, timeout);

      // Write input as JSON to stdin (don't await)
      const inputData = new TextEncoder().encode(JSON.stringify(input));
      const stdin = proc.stdin as unknown as {
        getWriter?: () => { write: (chunk: Uint8Array) => Promise<void> | void; close: () => Promise<void> | void };
        write?: (chunk: Uint8Array) => Promise<void> | void;
        end?: () => Promise<void> | void;
      } | null;
      if (stdin?.getWriter) {
        const writer = stdin.getWriter();
        void Promise.resolve(writer.write(inputData)).then(() => writer.close()).catch((err) => {
          console.error(`[Hook] Async hook stdin error (${hook.id || hook.command}):`, err);
        });
      } else if (stdin?.write) {
        void Promise.resolve(stdin.write(inputData)).then(() => stdin.end?.()).catch((err) => {
          console.error(`[Hook] Async hook stdin error (${hook.id || hook.command}):`, err);
        });
      }

      // Set up cleanup when process exits
      void proc.exited.then((exitCode) => {
        backgroundProcessManager.remove(bgId);
        if (exitCode !== 0 && exitCode !== 2) {
          // Log non-zero exit but don't fail
          console.debug(`Async hook ${hook.id || hook.command} exited with code ${exitCode}`);
        }
      }).catch((err) => {
        backgroundProcessManager.remove(bgId);
        console.debug(`Async hook ${hook.id || hook.command} error:`, err);
      });

      // Return immediately - async hooks don't block
      return { continue: true };
    } catch (error) {
      console.error(`Async command hook error:`, error);
      return null;
    }
  }

  /**
   * Execute a prompt hook (single-turn LLM decision)
   */
  private async executePromptHook(
    hook: HookHandler,
    input: HookInput,
    timeout: number
  ): Promise<HookOutput | null> {
    if (!hook.prompt || !this.llmClient) return null;

    const fullPrompt = `${hook.prompt}

Context:
${JSON.stringify(input, null, 2)}

Respond with JSON only: {"allow": boolean, "reason": string}`;

    try {
      const response = await this.completeWithTimeout(fullPrompt, timeout);
      const decision = this.parseDecision(response);
      if (!decision) return null;

      return {
        continue: decision.allow,
        stopReason: decision.allow ? undefined : decision.reason,
      };
    } catch (error) {
      console.error('Prompt hook error:', error);
      return null;
    }
  }

  /**
   * Execute an assistant hook (multi-turn with tools)
   */
  private async executeAssistantHook(
    hook: HookHandler,
    input: HookInput,
    timeout: number
  ): Promise<HookOutput | null> {
    if (!hook.prompt || !this.assistantRunner) return null;

    try {
      const response = await this.assistantRunner(hook, input, timeout);
      if (!response) return null;
      const decision = this.parseAllowDeny(response);
      if (!decision) return null;
      return {
        continue: decision.allow,
        stopReason: decision.allow ? undefined : decision.reason,
      };
    } catch (error) {
      console.error('Assistant hook error:', error);
      return null;
    }
  }

  private parseDecision(raw: string): { allow: boolean; reason?: string } | null {
    const json = this.extractJson(raw);
    if (!json) return null;
    try {
      const parsed = JSON.parse(json) as { allow?: boolean; continue?: boolean; reason?: string };
      const allow = typeof parsed.allow === 'boolean' ? parsed.allow : parsed.continue;
      if (typeof allow !== 'boolean') return null;
      return { allow, reason: parsed.reason };
    } catch {
      return null;
    }
  }

  private parseAllowDeny(raw: string): { allow: boolean; reason?: string } | null {
    const tokenMatch = raw.match(/\b(ALLOW|DENY)\b/i);
    if (!tokenMatch) return null;
    const allow = tokenMatch[1].toUpperCase() === 'ALLOW';
    const reason = raw.replace(/\b(ALLOW|DENY)\b/i, '').trim() || undefined;
    return { allow, reason };
  }

  private extractJson(raw: string): string | null {
    const match = raw.match(/\{[\s\S]*\}/);
    return match ? match[0] : null;
  }

  private async completeWithTimeout(prompt: string, timeout: number): Promise<string> {
    const messages: Message[] = [
      { id: generateId(), role: 'user', content: prompt, timestamp: Date.now() },
    ];

    const deadline = Date.now() + timeout;
    let response = '';
    const iterator = this.llmClient!.chat(messages)[Symbol.asyncIterator]();

    while (true) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new Error('timeout');
      }

      const next = await this.nextWithTimeout(iterator, remaining);
      if (next.done) break;

      const chunk = next.value;
      if (chunk.type === 'text' && chunk.content) {
        response += chunk.content;
      } else if (chunk.type === 'error') {
        throw new Error(chunk.error || 'llm error');
      }
    }

    await sleep(0);
    return response.trim();
  }

  private async nextWithTimeout<T>(
    iterator: AsyncIterator<T>,
    timeout: number
  ): Promise<IteratorResult<T>> {
    const result = await Promise.race([
      iterator.next(),
      sleep(timeout).then(() => ({ timeout: true } as const)),
    ]);

    if ('timeout' in result) {
      throw new Error('timeout');
    }

    return result as IteratorResult<T>;
  }
}

export const __test__ = {
  killSpawnedProcess,
};
