import type { StreamChunk, Message, TokenUsage } from '@hasna/assistants-shared';
import { generateId } from '@hasna/assistants-shared';
import { EmbeddedClient } from '../client';
import { SessionStore, type PersistedSessionData } from './store';

/**
 * Information about a session
 */
export interface SessionInfo {
  id: string;
  cwd: string;
  startedAt: number;
  updatedAt: number;
  isProcessing: boolean;
  client: EmbeddedClient;
  /** Assigned assistant ID */
  assistantId: string | null;
  /** Human-readable session label */
  label: string | null;
}

/**
 * Persisted session state for switching
 */
export interface PersistedSession {
  id: string;
  cwd: string;
  startedAt: number;
  messages: Message[];
  tokenUsage: TokenUsage;
}

/**
 * Options for creating a session
 */
export interface CreateSessionOptions {
  /** Working directory */
  cwd: string;
  /** Optional assistant ID to bind to this session */
  assistantId?: string;
  /** Optional label for the session */
  label?: string;
  /** Optional session ID override (used when resuming) */
  sessionId?: string;
  /** Optional initial messages to seed the session */
  initialMessages?: Message[];
  /** Optional original startedAt timestamp (ISO string) */
  startedAt?: string;
  /** Optional backend override (native, claude-agent-sdk, codex-sdk) */
  backend?: string;
}

export interface SessionRegistryOptions {
  /** Base path for session persistence (defaults to global config dir) */
  basePath?: string;
  /** Optional workspace identifier for scoping */
  workspaceId?: string | null;
  /** Optional custom client factory (primarily for tests) */
  clientFactory?: (cwd: string, options?: ConstructorParameters<typeof EmbeddedClient>[1]) => EmbeddedClient;
}

/**
 * Registry that manages multiple concurrent sessions
 */
export class SessionRegistry {
  private sessions: Map<string, SessionInfo> = new Map();
  private activeSessionId: string | null = null;
  private chunkBuffers: Map<string, StreamChunk[]> = new Map();
  private chunkCallbacks: ((chunk: StreamChunk) => void)[] = [];
  private errorCallbacks: ((error: Error) => void)[] = [];
  private clientFactory: (cwd: string, options?: ConstructorParameters<typeof EmbeddedClient>[1]) => EmbeddedClient;
  private maxBufferedChunks = 2000;
  private store: SessionStore;
  private basePath?: string;
  private workspaceId: string | null = null;

  constructor(
    options?: SessionRegistryOptions
      | ((cwd: string, options?: ConstructorParameters<typeof EmbeddedClient>[1]) => EmbeddedClient)
  ) {
    if (typeof options === 'function') {
      this.clientFactory = options;
      this.basePath = undefined;
      this.workspaceId = null;
      this.store = new SessionStore();
      return;
    }
    this.clientFactory = options?.clientFactory ?? ((cwd, opts) => new EmbeddedClient(cwd, opts));
    this.basePath = options?.basePath;
    this.workspaceId = options?.workspaceId ?? null;
    this.store = new SessionStore();
  }

  /**
   * Create a new session
   */
  async createSession(cwdOrOptions: string | CreateSessionOptions): Promise<SessionInfo> {
    const options = typeof cwdOrOptions === 'string'
      ? { cwd: cwdOrOptions }
      : cwdOrOptions;

    const clientOptions: ConstructorParameters<typeof EmbeddedClient>[1] = {
      sessionId: options.sessionId,
      initialMessages: options.initialMessages,
      startedAt: options.startedAt,
      assistantId: options.assistantId,
      backend: options.backend as any,
      basePath: this.basePath,
      workspaceId: this.workspaceId ?? undefined,
    };
    const client = this.clientFactory(options.cwd, clientOptions);
    await client.initialize();

    const parsedStartedAt = options.startedAt ? new Date(options.startedAt).getTime() : Date.now();
    const startedAt = Number.isNaN(parsedStartedAt) ? Date.now() : parsedStartedAt;
    const sessionInfo: SessionInfo = {
      id: client.getSessionId(),
      cwd: options.cwd,
      startedAt,
      updatedAt: Date.now(),
      isProcessing: false,
      client,
      assistantId: options.assistantId || null,
      label: options.label || null,
    };

    // Setup chunk forwarding/buffering
    client.onChunk((chunk) => {
      this.handleChunk(sessionInfo.id, chunk);
    });

    client.onError((error) => {
      if (this.activeSessionId === sessionInfo.id) {
        for (const callback of this.errorCallbacks) {
          callback(error);
        }
        return;
      }
      this.handleChunk(sessionInfo.id, { type: 'error', error: error.message });
    });

    this.sessions.set(sessionInfo.id, sessionInfo);
    this.chunkBuffers.set(sessionInfo.id, []);

    // If this is the first session, make it active
    if (this.activeSessionId === null) {
      this.activeSessionId = sessionInfo.id;
    }

    // Persist session
    this.persistSession(sessionInfo);

    return sessionInfo;
  }

  /**
   * Assign an assistant to a session
   */
  assignAssistant(sessionId: string, assistantId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }
    session.assistantId = assistantId;
    session.updatedAt = Date.now();
    this.persistSession(session);
  }

  /**
   * Set a session label
   */
  setLabel(sessionId: string, label: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }
    session.label = label;
    session.updatedAt = Date.now();
    this.persistSession(session);
  }

  /**
   * Persist session metadata to store
   */
  private persistSession(session: SessionInfo): void {
    this.store.save({
      id: session.id,
      cwd: session.cwd,
      startedAt: session.startedAt,
      updatedAt: session.updatedAt,
      assistantId: session.assistantId,
      label: session.label,
      status: session.id === this.activeSessionId ? 'active' : 'background',
    });
  }

  /**
   * Load persisted sessions for recovery
   */
  loadPersistedSessions(): PersistedSessionData[] {
    return this.store.listRecoverable();
  }

  /**
   * Get the session store (for external access)
   */
  getStore(): SessionStore {
    return this.store;
  }

  /**
   * Handle chunks - forward to UI if active, buffer if background
   */
  private handleChunk(sessionId: string, chunk: StreamChunk): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.updatedAt = Date.now();

      // Track processing state
      if (chunk.type === 'text' || chunk.type === 'tool_use' || chunk.type === 'tool_result') {
        session.isProcessing = true;
      }
      if (chunk.type === 'done' || chunk.type === 'error' || chunk.type === 'exit') {
        session.isProcessing = false;
      }
    }

    if (sessionId === this.activeSessionId) {
      // Forward to UI immediately
      for (const callback of this.chunkCallbacks) {
        callback(chunk);
      }
    } else {
      // Buffer for later
      const buffer = this.chunkBuffers.get(sessionId);
      if (buffer) {
        buffer.push(chunk);
        if (buffer.length > this.maxBufferedChunks) {
          buffer.splice(0, buffer.length - this.maxBufferedChunks);
        }
      }
    }
  }

  /**
   * Switch to a different session
   */
  async switchSession(id: string): Promise<void> {
    if (!this.sessions.has(id)) {
      throw new Error(`Session ${id} not found`);
    }

    if (this.activeSessionId === id) {
      return; // Already active
    }

    // Persist old session as background
    if (this.activeSessionId) {
      const oldSession = this.sessions.get(this.activeSessionId);
      if (oldSession) {
        this.store.save({
          id: oldSession.id,
          cwd: oldSession.cwd,
          startedAt: oldSession.startedAt,
          updatedAt: Date.now(),
          assistantId: oldSession.assistantId,
          label: oldSession.label,
          status: 'background',
        });
      }
    }

    this.activeSessionId = id;

    // Persist new session as active
    const newSession = this.sessions.get(id);
    if (newSession) {
      this.persistSession(newSession);
    }

    // Replay any buffered chunks from the new active session
    const buffer = this.chunkBuffers.get(id);
    if (buffer && buffer.length > 0) {
      for (const chunk of buffer) {
        for (const callback of this.chunkCallbacks) {
          callback(chunk);
        }
      }
      // Clear the buffer after replay
      this.chunkBuffers.set(id, []);
    }
  }

  /**
   * List all sessions
   */
  listSessions(): SessionInfo[] {
    return Array.from(this.sessions.values()).sort(
      (a, b) => b.updatedAt - a.updatedAt
    );
  }

  /**
   * Get the currently active session
   */
  getActiveSession(): SessionInfo | null {
    if (!this.activeSessionId) return null;
    return this.sessions.get(this.activeSessionId) || null;
  }

  /**
   * Get the active session ID
   */
  getActiveSessionId(): string | null {
    return this.activeSessionId;
  }

  /**
   * Get session by ID
   */
  getSession(id: string): SessionInfo | null {
    return this.sessions.get(id) || null;
  }

  /**
   * Get session index (1-based) for display
   */
  getSessionIndex(id: string): number {
    const sessions = this.listSessions();
    return sessions.findIndex((s) => s.id === id) + 1;
  }

  /**
   * Get session count
   */
  getSessionCount(): number {
    return this.sessions.size;
  }

  /**
   * Close a specific session
   */
  closeSession(id: string): void {
    const session = this.sessions.get(id);
    if (session) {
      session.client.disconnect();
      this.sessions.delete(id);
      this.chunkBuffers.delete(id);

      // Persist as closed
      this.store.save({
        id: session.id,
        cwd: session.cwd,
        startedAt: session.startedAt,
        updatedAt: Date.now(),
        assistantId: session.assistantId,
        label: session.label,
        status: 'closed',
      });

      // If we closed the active session, switch to another
      if (this.activeSessionId === id) {
        const remaining = this.listSessions();
        this.activeSessionId = remaining.length > 0 ? remaining[0].id : null;
        if (this.activeSessionId) {
          const buffer = this.chunkBuffers.get(this.activeSessionId);
          if (buffer && buffer.length > 0) {
            for (const chunk of buffer) {
              for (const callback of this.chunkCallbacks) {
                callback(chunk);
              }
            }
            this.chunkBuffers.set(this.activeSessionId, []);
          }
        }
      }
    }
  }

  /**
   * Close all sessions (called on app exit)
   */
  closeAll(): void {
    for (const session of this.sessions.values()) {
      session.client.disconnect();
      // Persist as closed
      this.store.save({
        id: session.id,
        cwd: session.cwd,
        startedAt: session.startedAt,
        updatedAt: Date.now(),
        assistantId: session.assistantId,
        label: session.label,
        status: 'closed',
      });
    }
    this.sessions.clear();
    this.chunkBuffers.clear();
    this.activeSessionId = null;
  }

  /**
   * Reset registry storage scope (e.g., when switching workspaces).
   * Closes all sessions and points to a new persistence base path.
   */
  resetStore(options: { basePath?: string; workspaceId?: string | null } = {}): void {
    this.closeAll();
    this.basePath = options.basePath;
    this.workspaceId = options.workspaceId ?? null;
    this.store = new SessionStore();
  }

  /**
   * Register a chunk callback
   */
  onChunk(callback: (chunk: StreamChunk) => void): void {
    this.chunkCallbacks.push(callback);
  }

  /**
   * Register an error callback
   */
  onError(callback: (error: Error) => void): void {
    this.errorCallbacks.push(callback);
  }

  /**
   * Mark a session as processing
   */
  setProcessing(id: string, isProcessing: boolean): void {
    const session = this.sessions.get(id);
    if (session) {
      session.isProcessing = isProcessing;
      session.updatedAt = Date.now();
    }
  }

  /**
   * Check if any session is currently processing
   */
  hasProcessingSession(): boolean {
    for (const session of this.sessions.values()) {
      if (session.isProcessing) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get sessions that are processing in background
   */
  getBackgroundProcessingSessions(): SessionInfo[] {
    return Array.from(this.sessions.values()).filter(
      (s) => s.isProcessing && s.id !== this.activeSessionId
    );
  }
}
