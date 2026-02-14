/**
 * Claude Agent Loop
 *
 * Adapter that wraps the Claude Agent SDK (@anthropic-ai/claude-agent-sdk)
 * to provide the same API surface as AssistantLoop.
 *
 * Uses query() async generator — yields system, assistant, and result messages.
 * Custom tools bridged from ToolRegistry via MCP tool definitions.
 */

import type { Tool, StreamChunk, ToolCall, ToolResult, TokenUsage, Skill, ActiveIdentityInfo } from '@hasna/assistants-shared';
import { generateId } from '@hasna/assistants-shared';
import { AssistantContext } from './context';
import type { ToolRegistry } from '../tools/registry';
import { getAllMcpDescriptors, type McpToolDescriptor } from './tool-bridge';

export interface ClaudeAgentLoopOptions {
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
 * Claude Agent SDK adapter matching AssistantLoop's API surface.
 */
export class ClaudeAgentLoop {
  private context: AssistantContext;
  private cwd: string;
  private sessionId: string;
  private assistantId: string | null;
  private model: string;
  private processing = false;
  private stopped = false;
  private toolRegistry: ToolRegistry | null;
  private mcpDescriptors: McpToolDescriptor[] = [];
  private extraSystemPrompt: string;
  private tokenUsage: TokenUsage = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    maxContextTokens: 200000,
  };

  private onChunk: ((chunk: StreamChunk) => void) | null;
  private onToolStart: ((toolCall: ToolCall) => void) | null;
  private onToolEnd: ((toolCall: ToolCall, result: ToolResult) => void) | null;

  constructor(options: ClaudeAgentLoopOptions) {
    this.cwd = options.cwd || process.cwd();
    this.sessionId = options.sessionId || generateId();
    this.assistantId = options.assistantId || null;
    this.model = options.model || 'claude-sonnet-4-20250514';
    this.toolRegistry = options.toolRegistry || null;
    this.extraSystemPrompt = options.extraSystemPrompt || '';
    this.onChunk = options.onChunk || null;
    this.onToolStart = options.onToolStart || null;
    this.onToolEnd = options.onToolEnd || null;

    this.context = new AssistantContext(100);
  }

  async initialize(): Promise<void> {
    if (this.toolRegistry) {
      this.mcpDescriptors = getAllMcpDescriptors(this.toolRegistry);
    }
  }

  async process(userMessage: string): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    this.stopped = false;

    try {
      this.context.addUserMessage(userMessage);

      // Dynamic import to avoid requiring the SDK at load time
      let query: any;
      try {
        // @ts-ignore - Optional dependency, loaded dynamically
        const sdk = await import('@anthropic-ai/claude-agent-sdk');
        query = sdk.query;
      } catch {
        this.emitChunk({ type: 'error', error: 'Claude Agent SDK (@anthropic-ai/claude-agent-sdk) is not installed. Run: pnpm add -F @hasna/assistants-core @anthropic-ai/claude-agent-sdk' });
        this.emitChunk({ type: 'done' });
        return;
      }

      // Build MCP tool names for allowedTools
      const mcpToolNames = this.mcpDescriptors.map((d) => `mcp__assistants__${d.name}`);
      const builtinTools = [
        'Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep',
        'WebSearch', 'WebFetch',
      ];

      const queryOptions: Record<string, unknown> = {
        model: this.model,
        allowedTools: [...builtinTools, ...mcpToolNames],
        permissionMode: 'bypassPermissions',
        cwd: this.cwd,
      };

      // Add system prompt if provided
      if (this.extraSystemPrompt) {
        queryOptions.systemPrompt = this.extraSystemPrompt;
      }

      // If we have tool descriptors, we'd need to create an MCP server
      // For now, rely on built-in tools and system prompt instructions
      // MCP server integration requires the full SDK setup

      let fullText = '';

      for await (const msg of query({ prompt: userMessage, options: queryOptions })) {
        if (this.stopped) break;

        if (msg.type === 'assistant') {
          // Process content blocks
          for (const block of msg.message?.content || []) {
            if (this.stopped) break;

            if (block.type === 'text') {
              fullText += block.text;
              this.emitChunk({ type: 'text', content: block.text });
            } else if (block.type === 'tool_use') {
              const toolCall: ToolCall = {
                id: block.id || generateId(),
                name: block.name,
                input: block.input as Record<string, unknown>,
              };
              this.onToolStart?.(toolCall);
              this.emitChunk({ type: 'tool_use', toolCall });

              // If the tool is one of our app tools (via MCP), execute it
              if (this.toolRegistry && block.name.startsWith('mcp__assistants__')) {
                const realToolName = block.name.replace('mcp__assistants__', '');
                try {
                  const appToolCall: ToolCall = {
                    id: toolCall.id,
                    name: realToolName,
                    input: block.input as Record<string, unknown>,
                  };
                  const result = await this.toolRegistry.execute(appToolCall);
                  this.onToolEnd?.(toolCall, result);
                  this.emitChunk({ type: 'tool_result', toolResult: result });
                } catch (err) {
                  const result: ToolResult = {
                    toolCallId: toolCall.id,
                    content: err instanceof Error ? err.message : String(err),
                    isError: true,
                    toolName: realToolName,
                  };
                  this.onToolEnd?.(toolCall, result);
                  this.emitChunk({ type: 'tool_result', toolResult: result });
                }
              }
            }
          }
        } else if (msg.type === 'result') {
          if (msg.is_error) {
            this.emitChunk({ type: 'error', error: msg.error || 'Claude Agent SDK error' });
          } else {
            // Update token usage from result if available
            if (msg.usage) {
              this.tokenUsage = {
                inputTokens: this.tokenUsage.inputTokens + (msg.usage.input_tokens || 0),
                outputTokens: this.tokenUsage.outputTokens + (msg.usage.output_tokens || 0),
                totalTokens: this.tokenUsage.totalTokens + (msg.usage.input_tokens || 0) + (msg.usage.output_tokens || 0),
                maxContextTokens: this.tokenUsage.maxContextTokens,
              };
              this.emitChunk({ type: 'usage', usage: this.tokenUsage });
            }
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
  }

  clearConversation(): void {
    this.context.clear();
    this.tokenUsage = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      maxContextTokens: 200000,
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
