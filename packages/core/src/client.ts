import type { AssistantClient, StreamChunk, Tool, Skill, Message, TokenUsage, VoiceState, ActiveIdentityInfo, HeartbeatState, AssistantBackend } from '@hasna/assistants-shared';
import { generateId } from '@hasna/assistants-shared';
import { AssistantLoop } from './agent/loop';
import { createAgentLoop, type AgentLoop } from './agent/factory';
import type { AskUserHandler, InterviewHandler } from './tools/ask-user';
import { Logger, SessionStorage, initAssistantsDir } from './logger';
import type { Command } from './commands';

/**
 * Embedded client - runs the assistant in the same process
 */
export class EmbeddedClient implements AssistantClient {
  private assistantLoop: AgentLoop;
  private chunkCallbacks: ((chunk: StreamChunk) => void)[] = [];
  private errorCallbacks: ((error: Error) => void)[] = [];
  private initialized = false;
  private logger: Logger;
  private session: SessionStorage;
  private messages: Message[] = [];
  private messageIds: Set<string> = new Set();
  private cwd: string;
  private startedAt: string;
  private initialMessages: Message[] | null = null;
  private assistantId: string | null = null;
  private basePath?: string;
  private workspaceId?: string | null;
  private messageQueue: string[] = [];
  private processingQueue = false;
  private sawErrorChunk = false;

  constructor(
    cwd?: string,
    options?: {
      sessionId?: string;
      initialMessages?: Message[];
      systemPrompt?: string;
      allowedTools?: string[];
      assistantId?: string;
      /** Override the model from config (e.g., assistant-specific model selection) */
      model?: string;
      startedAt?: string;
      assistantFactory?: (options: ConstructorParameters<typeof AssistantLoop>[0]) => AgentLoop;
      /** Backend type for the assistant (native, claude-agent-sdk, codex-sdk) */
      backend?: AssistantBackend;
      /** Optional base path for workspace-scoped storage */
      basePath?: string;
      /** Optional workspace identifier for scoping */
      workspaceId?: string | null;
    }
  ) {
    // Initialize .assistants directory structure
    initAssistantsDir(options?.basePath);

    const sessionId = options?.sessionId || generateId();
    this.basePath = options?.basePath;
    this.logger = new Logger(sessionId, this.basePath);
    this.workspaceId = options?.workspaceId ?? null;
    this.session = new SessionStorage(sessionId, this.basePath);
    this.cwd = cwd || process.cwd();
    this.startedAt = options?.startedAt || new Date().toISOString();
    this.initialMessages = options?.initialMessages || null;

    this.logger.info('Session started', { cwd: this.cwd });

    const backend = options?.backend;
    const createAssistant = options?.assistantFactory ?? ((opts: ConstructorParameters<typeof AssistantLoop>[0]) => createAgentLoop(backend, opts));
    this.assistantLoop = createAssistant({
      cwd: this.cwd,
      sessionId,
      assistantId: options?.assistantId,
      allowedTools: options?.allowedTools,
      extraSystemPrompt: options?.systemPrompt,
      model: options?.model,
      storageDir: this.basePath,
      workspaceId: this.workspaceId,
      onChunk: (chunk) => {
        for (const callback of this.chunkCallbacks) {
          callback(chunk);
        }
        if (chunk.type === 'error') {
          this.sawErrorChunk = true;
        }
        // Drain queue on terminal chunks (done, error, stopped)
        if (chunk.type === 'done' || chunk.type === 'error' || chunk.type === 'stopped') {
          queueMicrotask(() => {
            void this.drainQueue();
          });
        }
      },
      onToolStart: (toolCall) => {
        // Only log - tool_use chunk is already emitted from LLM stream
        this.logger.info('Tool started', { tool: toolCall.name, input: toolCall.input });
      },
      onToolEnd: (toolCall, result) => {
        this.logger.info('Tool completed', {
          tool: toolCall.name,
          success: !result.isError,
          resultLength: result.content.length,
        });
      },
    });
  }

  /**
   * Initialize the client (must be called before use)
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.logger.info('Initializing assistant');
    await this.assistantLoop.initialize();
    if (typeof (this.assistantLoop as any).getAssistantId === 'function') {
      this.assistantId = (this.assistantLoop as any).getAssistantId();
      if (this.assistantId) {
        this.session = new SessionStorage(this.session.getSessionId(), this.basePath, this.assistantId);
      }
    }
    if (this.initialMessages && this.initialMessages.length > 0) {
      const contextSeed = this.selectContextSeed(this.initialMessages);
      if (typeof (this.assistantLoop as any).importContext === 'function') {
        (this.assistantLoop as any).importContext(contextSeed);
      } else {
        this.assistantLoop.getContext().import(contextSeed);
      }
      this.messages = [...this.initialMessages];
      this.messageIds = new Set(this.initialMessages.map((msg) => msg.id));
    }
    this.initialized = true;
    this.logger.info('Assistant initialized', {
      tools: this.assistantLoop.getTools().length,
      skills: this.assistantLoop.getSkills().length,
    });
  }

  /**
   * Send a message to the assistant
   */
  async send(message: string): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!message.trim()) {
      return;
    }

    this.messageQueue.push(message);
    if (this.assistantLoop.isProcessing() || this.processingQueue) {
      this.logger.info('Queuing message (assistant busy)', { message, queueLength: this.messageQueue.length });
      return;
    }

    await this.drainQueue();
  }

  /**
   * Process a single message
   */
  private async processMessage(message: string): Promise<void> {
    this.logger.info('User message', { message });
    this.sawErrorChunk = false;

    try {
      await this.assistantLoop.process(message);

      // Get assistant response from context
      const context = this.assistantLoop.getContext();
      const contextMessages = context.getMessages();
      if (contextMessages.length > 0) {
        this.mergeMessages(contextMessages);
        const lastMessage = contextMessages.slice(-1)[0];
        if (lastMessage?.role === 'assistant') {
          this.logger.info('Assistant response', {
            length: lastMessage.content.length,
            hasToolCalls: !!lastMessage.toolCalls?.length,
          });
        }
      }

      // Save session
      this.saveSession();
    } catch (error) {
      if (this.sawErrorChunk) {
        return;
      }
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error('Error processing message', { error: err.message });
      for (const callback of this.errorCallbacks) {
        callback(err);
      }
    }
  }

  /**
   * Process queued messages
   */
  private async drainQueue(): Promise<void> {
    if (this.processingQueue) return;
    this.processingQueue = true;

    try {
      while (this.messageQueue.length > 0 && !this.assistantLoop.isProcessing()) {
        const nextMessage = this.messageQueue.shift();
        if (nextMessage) {
          await this.processMessage(nextMessage);
        }
      }
    } finally {
      this.processingQueue = false;
    }
  }

  private saveSession() {
    this.session.save({
      messages: this.messages,
      startedAt: this.startedAt,
      updatedAt: new Date().toISOString(),
      cwd: this.cwd,
    });
  }

  /**
   * Register a chunk callback. Returns an unsubscribe function.
   */
  onChunk(callback: (chunk: StreamChunk) => void): () => void {
    this.chunkCallbacks.push(callback);
    return () => {
      const index = this.chunkCallbacks.indexOf(callback);
      if (index !== -1) this.chunkCallbacks.splice(index, 1);
    };
  }

  /**
   * Register an error callback. Returns an unsubscribe function.
   */
  onError(callback: (error: Error) => void): () => void {
    this.errorCallbacks.push(callback);
    return () => {
      const index = this.errorCallbacks.indexOf(callback);
      if (index !== -1) this.errorCallbacks.splice(index, 1);
    };
  }

  /**
   * Register an ask-user handler for interactive prompts
   */
  setAskUserHandler(handler: AskUserHandler | null): void {
    if (typeof (this.assistantLoop as any).setAskUserHandler === 'function') {
      (this.assistantLoop as any).setAskUserHandler(handler);
    }
  }

  /**
   * Register an interview handler for rich multi-step wizard prompts
   */
  setInterviewHandler(handler: InterviewHandler | null): void {
    if (typeof (this.assistantLoop as any).setInterviewHandler === 'function') {
      (this.assistantLoop as any).setInterviewHandler(handler);
    }
  }

  /**
   * Get available tools
   */
  async getTools(): Promise<Tool[]> {
    if (!this.initialized) {
      await this.initialize();
    }
    return this.assistantLoop.getTools();
  }

  /**
   * Get available skills
   */
  async getSkills(): Promise<Skill[]> {
    if (!this.initialized) {
      await this.initialize();
    }
    return this.assistantLoop.getSkills();
  }

  /**
   * Refresh skills from disk
   */
  async refreshSkills(): Promise<Skill[]> {
    if (!this.initialized) {
      await this.initialize();
    }
    if (typeof (this.assistantLoop as any).refreshSkills === 'function') {
      await (this.assistantLoop as any).refreshSkills();
    }
    return this.assistantLoop.getSkills();
  }

  /**
   * Get the skill loader (for panel operations like ensureSkillContent)
   */
  getSkillLoader(): any {
    if (typeof (this.assistantLoop as any).getSkillLoader === 'function') {
      return (this.assistantLoop as any).getSkillLoader();
    }
    return null;
  }

  /**
   * Stop the current processing
   */
  stop(): void {
    this.logger.info('Processing stopped by user');
    this.assistantLoop.stop();
  }

  /**
   * Disconnect and clean up resources
   */
  disconnect(): void {
    this.logger.info('Session ended');
    if (typeof (this.assistantLoop as any).shutdown === 'function') {
      (this.assistantLoop as any).shutdown();
    }
    this.saveSession();
    this.chunkCallbacks.length = 0;
    this.errorCallbacks.length = 0;
  }

  /**
   * Check if assistant is currently processing
   */
  isProcessing(): boolean {
    return this.assistantLoop.isProcessing();
  }

  /**
   * Get session ID
   */
  getSessionId(): string {
    return this.session.getSessionId();
  }

  /**
   * Get available commands
   */
  async getCommands(): Promise<Command[]> {
    if (!this.initialized) {
      await this.initialize();
    }
    return this.assistantLoop.getCommands();
  }

  /**
   * Get current token usage
   */
  getTokenUsage(): TokenUsage {
    return this.assistantLoop.getTokenUsage();
  }

  /**
   * Get current voice state
   */
  getVoiceState(): VoiceState | null {
    if (typeof (this.assistantLoop as any).getVoiceState === 'function') {
      return (this.assistantLoop as any).getVoiceState();
    }
    return null;
  }

  /**
   * Get current heartbeat state
   */
  getHeartbeatState(): HeartbeatState | null {
    if (typeof (this.assistantLoop as any).getHeartbeatState === 'function') {
      return (this.assistantLoop as any).getHeartbeatState();
    }
    return null;
  }

  /**
   * Get current assistant/identity info
   */
  getIdentityInfo(): ActiveIdentityInfo | null {
    if (typeof (this.assistantLoop as any).getIdentityInfo === 'function') {
      return (this.assistantLoop as any).getIdentityInfo();
    }
    return null;
  }

  /**
   * Get current model
   */
  getModel(): string | null {
    if (typeof (this.assistantLoop as any).getModel === 'function') {
      return (this.assistantLoop as any).getModel();
    }
    return null;
  }

  /**
   * Get the assistant manager
   */
  getAssistantManager(): any {
    if (typeof (this.assistantLoop as any).getAssistantManager === 'function') {
      return (this.assistantLoop as any).getAssistantManager();
    }
    return null;
  }

  /**
   * Get the identity manager
   */
  getIdentityManager(): any {
    if (typeof (this.assistantLoop as any).getIdentityManager === 'function') {
      return (this.assistantLoop as any).getIdentityManager();
    }
    return null;
  }

  /**
   * Get the memory manager
   */
  getMemoryManager(): any {
    if (typeof (this.assistantLoop as any).getMemoryManager === 'function') {
      return (this.assistantLoop as any).getMemoryManager();
    }
    return null;
  }

  /**
   * Refresh identity context after assistant/identity changes
   */
  async refreshIdentityContext(): Promise<void> {
    if (typeof (this.assistantLoop as any).refreshIdentityContext === 'function') {
      await (this.assistantLoop as any).refreshIdentityContext();
    }
  }

  /**
   * Get the messages manager
   */
  getMessagesManager(): any {
    if (typeof (this.assistantLoop as any).getMessagesManager === 'function') {
      return (this.assistantLoop as any).getMessagesManager();
    }
    return null;
  }

  /**
   * Get the webhooks manager
   */
  getWebhooksManager(): any {
    if (typeof (this.assistantLoop as any).getWebhooksManager === 'function') {
      return (this.assistantLoop as any).getWebhooksManager();
    }
    return null;
  }

  /**
   * Get the channels manager
   */
  getChannelsManager(): any {
    if (typeof (this.assistantLoop as any).getChannelsManager === 'function') {
      return (this.assistantLoop as any).getChannelsManager();
    }
    return null;
  }

  /**
   * Get the channel agent pool for multi-agent channel responses
   */
  getChannelAgentPool(): any {
    if (typeof (this.assistantLoop as any).getChannelAgentPool === 'function') {
      return (this.assistantLoop as any).getChannelAgentPool();
    }
    return null;
  }

  /**
   * Get the people manager
   */
  getPeopleManager(): any {
    if (typeof (this.assistantLoop as any).getPeopleManager === 'function') {
      return (this.assistantLoop as any).getPeopleManager();
    }
    return null;
  }

  /**
   * Get the contacts manager
   */
  getContactsManager(): any {
    if (typeof (this.assistantLoop as any).getContactsManager === 'function') {
      return (this.assistantLoop as any).getContactsManager();
    }
    return null;
  }

  /**
   * Get the telephony manager
   */
  getTelephonyManager(): any {
    if (typeof (this.assistantLoop as any).getTelephonyManager === 'function') {
      return (this.assistantLoop as any).getTelephonyManager();
    }
    return null;
  }

  /**
   * Get the orders manager
   */
  getOrdersManager(): any {
    if (typeof (this.assistantLoop as any).getOrdersManager === 'function') {
      return (this.assistantLoop as any).getOrdersManager();
    }
    return null;
  }

  /**
   * Get the jobs manager
   */
  getJobManager(): any {
    if (typeof (this.assistantLoop as any).getJobManager === 'function') {
      return (this.assistantLoop as any).getJobManager();
    }
    return null;
  }

  /**
   * Get the wallet manager
   */
  getWalletManager(): any {
    if (typeof (this.assistantLoop as any).getWalletManager === 'function') {
      return (this.assistantLoop as any).getWalletManager();
    }
    return null;
  }

  /**
   * Get the secrets manager
   */
  getSecretsManager(): any {
    if (typeof (this.assistantLoop as any).getSecretsManager === 'function') {
      return (this.assistantLoop as any).getSecretsManager();
    }
    return null;
  }

  /**
   * Get the inbox manager
   */
  getInboxManager(): any {
    if (typeof (this.assistantLoop as any).getInboxManager === 'function') {
      return (this.assistantLoop as any).getInboxManager();
    }
    return null;
  }

  /**
   * Get the active project ID
   */
  getActiveProjectId(): string | null {
    if (typeof (this.assistantLoop as any).getActiveProjectId === 'function') {
      return (this.assistantLoop as any).getActiveProjectId();
    }
    return null;
  }

  /**
   * Set the active project ID
   */
  setActiveProjectId(projectId: string | null): void {
    if (typeof (this.assistantLoop as any).setActiveProjectId === 'function') {
      (this.assistantLoop as any).setActiveProjectId(projectId);
    }
  }

  /**
   * Get the swarm coordinator (for swarm panel UI)
   */
  getSwarmCoordinator(): any {
    if (typeof (this.assistantLoop as any).getOrCreateSwarmCoordinator === 'function') {
      return (this.assistantLoop as any).getOrCreateSwarmCoordinator();
    }
    return null;
  }

  /**
   * Get the assistant loop (for pause/resume, budget checks)
   */
  getAssistantLoop(): any {
    return this.assistantLoop;
  }

  /**
   * Add a system message to the conversation context
   */
  addSystemMessage(content: string): void {
    if (typeof (this.assistantLoop as any).addSystemMessage === 'function') {
      (this.assistantLoop as any).addSystemMessage(content);
    } else {
      // Fallback: add to context directly
      const context = this.assistantLoop.getContext();
      if (typeof (context as any).addSystemMessage === 'function') {
        (context as any).addSystemMessage(content);
      }
    }
  }

  /**
   * Clear the conversation
   */
  clearConversation(): void {
    this.assistantLoop.clearConversation();
    this.messages = [];
    this.messageIds.clear();
    this.logger.info('Conversation cleared');
  }

  /**
   * Get working directory
   */
  getCwd(): string {
    return this.cwd;
  }

  /**
   * Get start time
   */
  getStartedAt(): string {
    return this.startedAt;
  }

  /**
   * Get messages
   */
  getMessages(): Message[] {
    return [...this.messages];
  }

  /**
   * Get number of queued messages
   */
  getQueueLength(): number {
    return this.messageQueue.length;
  }

  /**
   * Clear the message queue
   */
  clearQueue(): void {
    this.messageQueue = [];
    this.logger.info('Message queue cleared');
  }

  private mergeMessages(contextMessages: Message[]): void {
    if (contextMessages.length === 0) return;
    if (this.messages.length === 0 && this.messageIds.size === 0) {
      this.messages = [...contextMessages];
      this.messageIds = new Set(contextMessages.map((msg) => msg.id));
      return;
    }
    for (const msg of contextMessages) {
      if (!this.messageIds.has(msg.id)) {
        this.messages.push(msg);
        this.messageIds.add(msg.id);
      }
    }
  }

  private selectContextSeed(messages: Message[]): Message[] {
    if (messages.length === 0) return [];
    const contextInfo = typeof (this.assistantLoop as any).getContextInfo === 'function'
      ? (this.assistantLoop as any).getContextInfo()
      : null;
    const maxMessages = contextInfo?.config?.maxMessages ?? 100;
    if (messages.length <= maxMessages) return messages;
    let startIndex = messages.length - maxMessages;
    if (startIndex > 0 && messages[startIndex]?.toolResults && messages[startIndex - 1]) {
      startIndex -= 1;
    }
    return messages.slice(Math.max(0, startIndex));
  }
}
