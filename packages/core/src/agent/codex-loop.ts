/**
 * Codex Agent Loop
 *
 * Adapter that wraps the OpenAI Codex SDK (@openai/codex-sdk)
 * to provide the same API surface as AssistantLoop.
 *
 * Uses Codex class → startThread() → runStreamed() async generator.
 * App tools are exposed via system prompt instructions + bash wrappers.
 */

import type { Tool, StreamChunk, ToolCall, ToolResult, TokenUsage, Skill, ActiveIdentityInfo } from '@hasna/assistants-shared';
import { generateId } from '@hasna/assistants-shared';
import { AssistantContext } from './context';
import type { ToolRegistry } from '../tools/registry';
import { buildToolsSystemPrompt } from './tool-bridge';

export interface CodexAgentLoopOptions {
  cwd?: string;
  sessionId?: string;
  assistantId?: string;
  model?: string;
  storageDir?: string;
  workspaceId?: string | null;
  extraSystemPrompt?: string;
  toolRegistry?: ToolRegistry;
  onChunk?: (chunk: StreamChunk) => void;
  onToolStart?: (toolCall: ToolCall) => void;
  onToolEnd?: (toolCall: ToolCall, result: ToolResult) => void;
}

/**
 * OpenAI Codex SDK adapter matching AssistantLoop's API surface.
 */
export class CodexAgentLoop {
  private context: AssistantContext;
  private cwd: string;
  private sessionId: string;
  private assistantId: string | null;
  private model: string;
  private processing = false;
  private stopped = false;
  private toolRegistry: ToolRegistry | null;
  private extraSystemPrompt: string;
  private codex: any = null;
  private thread: any = null;
  private tokenUsage: TokenUsage = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    maxContextTokens: 128000,
  };

  private onChunk: ((chunk: StreamChunk) => void) | null;
  private onToolStart: ((toolCall: ToolCall) => void) | null;
  private onToolEnd: ((toolCall: ToolCall, result: ToolResult) => void) | null;

  constructor(options: CodexAgentLoopOptions) {
    this.cwd = options.cwd || process.cwd();
    this.sessionId = options.sessionId || generateId();
    this.assistantId = options.assistantId || null;
    this.model = options.model || 'codex-mini';
    this.toolRegistry = options.toolRegistry || null;
    this.extraSystemPrompt = options.extraSystemPrompt || '';
    this.onChunk = options.onChunk || null;
    this.onToolStart = options.onToolStart || null;
    this.onToolEnd = options.onToolEnd || null;

    this.context = new AssistantContext(100);
  }

  async initialize(): Promise<void> {
    // Build enhanced system prompt with tool descriptions
    if (this.toolRegistry) {
      const toolsPrompt = buildToolsSystemPrompt(this.toolRegistry);
      if (toolsPrompt) {
        this.extraSystemPrompt = [this.extraSystemPrompt, toolsPrompt].filter(Boolean).join('\n\n');
      }
    }
  }

  async process(userMessage: string): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    this.stopped = false;

    try {
      this.context.addUserMessage(userMessage);

      // Dynamic import to avoid requiring the SDK at load time
      let Codex: any;
      try {
        // @ts-ignore - Optional dependency, loaded dynamically
        const sdk = await import('@openai/codex-sdk');
        Codex = sdk.Codex || sdk.default;
      } catch {
        this.emitChunk({ type: 'error', error: 'OpenAI Codex SDK (@openai/codex-sdk) is not installed. Run: pnpm add -F @hasna/assistants-core @openai/codex-sdk' });
        this.emitChunk({ type: 'done' });
        return;
      }

      // Initialize Codex client if needed
      if (!this.codex) {
        this.codex = new Codex({
          model: this.model,
          instructions: this.extraSystemPrompt || undefined,
        });
      }

      // Start or reuse thread
      if (!this.thread) {
        this.thread = this.codex.startThread({
          workingDirectory: this.cwd,
        });
      }

      let fullText = '';

      const { events } = await this.thread.runStreamed(userMessage);
      for await (const event of events) {
        if (this.stopped) break;

        if (event.type === 'item.completed') {
          const item = event.item;

          if (item?.type === 'message' && item.role === 'assistant') {
            // Extract text content
            for (const part of item.content || []) {
              if (part.type === 'output_text' || part.type === 'text') {
                const text = part.text || part.content || '';
                fullText += text;
                this.emitChunk({ type: 'text', content: text });
              }
            }
          } else if (item?.type === 'function_call' || item?.type === 'tool_use') {
            const toolCall: ToolCall = {
              id: item.call_id || item.id || generateId(),
              name: item.name || item.function?.name || 'unknown',
              input: typeof item.arguments === 'string'
                ? JSON.parse(item.arguments || '{}')
                : (item.input || item.arguments || {}),
            };
            this.onToolStart?.(toolCall);
            this.emitChunk({ type: 'tool_use', toolCall });
          } else if (item?.type === 'function_call_output') {
            const result: ToolResult = {
              toolCallId: item.call_id || generateId(),
              content: typeof item.output === 'string' ? item.output : JSON.stringify(item.output),
              toolName: item.name,
            };
            this.emitChunk({ type: 'tool_result', toolResult: result });
          }
        } else if (event.type === 'turn.completed') {
          // Update token usage if available
          if (event.usage) {
            this.tokenUsage = {
              inputTokens: this.tokenUsage.inputTokens + (event.usage.input_tokens || 0),
              outputTokens: this.tokenUsage.outputTokens + (event.usage.output_tokens || 0),
              totalTokens: this.tokenUsage.totalTokens + (event.usage.input_tokens || 0) + (event.usage.output_tokens || 0),
              maxContextTokens: this.tokenUsage.maxContextTokens,
            };
            this.emitChunk({ type: 'usage', usage: this.tokenUsage });
          }
        }
      }

      // Add assistant message to context
      if (fullText) {
        this.context.addAssistantMessage(fullText);
      }

      this.emitChunk({ type: 'done' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emitChunk({ type: 'error', error: message });
      this.emitChunk({ type: 'done' });
    } finally {
      this.processing = false;
    }
  }

  stop(): void {
    this.stopped = true;
    this.processing = false;
  }

  shutdown(): void {
    this.stop();
    this.thread = null;
    this.codex = null;
  }

  clearConversation(): void {
    this.context.clear();
    this.thread = null; // Reset thread for fresh conversation
    this.tokenUsage = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      maxContextTokens: 128000,
    };
  }

  // API surface matching AssistantLoop

  getContext(): AssistantContext {
    return this.context;
  }

  getTools(): Tool[] {
    return this.toolRegistry?.getTools() || [];
  }

  getSkills(): Skill[] {
    return [];
  }

  getSkillLoader(): null {
    return null;
  }

  getCommands(): [] {
    return [];
  }

  getTokenUsage(): TokenUsage {
    return this.tokenUsage;
  }

  getModel(): string {
    return this.model;
  }

  getContextInfo(): null {
    return null;
  }

  getVoiceState(): null {
    return null;
  }

  getHeartbeatState(): null {
    return null;
  }

  getAssistantManager(): null {
    return null;
  }

  getIdentityManager(): null {
    return null;
  }

  getMemoryManager(): null {
    return null;
  }

  getMessagesManager(): null {
    return null;
  }

  getWebhooksManager(): null {
    return null;
  }

  getChannelsManager(): null {
    return null;
  }

  getChannelAgentPool(): null {
    return null;
  }

  getPeopleManager(): null {
    return null;
  }

  getTelephonyManager(): null {
    return null;
  }

  getOrdersManager(): null {
    return null;
  }

  getJobManager(): null {
    return null;
  }

  getWalletManager(): null {
    return null;
  }

  getSecretsManager(): null {
    return null;
  }

  getInboxManager(): null {
    return null;
  }

  getAssistantId(): string | null {
    return this.assistantId;
  }

  getIdentityInfo(): ActiveIdentityInfo {
    return { assistant: null, identity: null };
  }

  getActiveProjectId(): null {
    return null;
  }

  setActiveProjectId(_id: string | null): void {
    // No-op for SDK-backed loops
  }

  getOrCreateSwarmCoordinator(): null {
    return null;
  }

  isProcessing(): boolean {
    return this.processing;
  }

  isBudgetExceeded(): boolean {
    return false;
  }

  isPaused(): boolean {
    return false;
  }

  getBudgetStatus(): null {
    return null;
  }

  getSessionId(): string {
    return this.sessionId;
  }

  setAskUserHandler(_handler: unknown): void {
    // No-op for SDK-backed loops
  }

  importContext(_messages: unknown[]): void {
    // No-op for SDK-backed loops
  }

  refreshIdentityContext(): void {
    // No-op
  }

  refreshSkills(): void {
    // No-op
  }

  addSystemMessage(content: string): void {
    this.context.addSystemMessage(content);
  }

  private emitChunk(chunk: StreamChunk): void {
    this.onChunk?.(chunk);
  }
}
