/**
 * Background process manager for async hooks
 * Tracks running processes and handles cleanup on exit
 */

interface BackgroundProcess {
  id: string;
  hookId: string;
  startTime: number;
  proc: { kill: () => void };
  timeoutId?: NodeJS.Timeout;
}

/**
 * Manages background processes spawned by async hooks
 */
export class BackgroundProcessManager {
  private processes: Map<string, BackgroundProcess> = new Map();
  private cleanupRegistered = false;
  private idCounter = 0;

  constructor() {
    this.registerCleanup();
  }

  /**
   * Register cleanup handlers for process exit
   */
  private registerCleanup(): void {
    if (this.cleanupRegistered) return;

    const cleanup = () => {
      this.killAll();
    };

    process.on('exit', cleanup);
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
    process.on('uncaughtException', cleanup);

    this.cleanupRegistered = true;
  }

  /**
   * Track a new background process
   */
  track(hookId: string, proc: { kill: () => void }, timeout?: number): string {
    const id = `bg-${++this.idCounter}`;

    const entry: BackgroundProcess = {
      id,
      hookId,
      startTime: Date.now(),
      proc,
    };

    // Set up automatic cleanup after timeout
    if (timeout) {
      entry.timeoutId = setTimeout(() => {
        this.kill(id);
      }, timeout);
    }

    this.processes.set(id, entry);
    return id;
  }

  /**
   * Kill a specific background process
   */
  kill(id: string): boolean {
    const entry = this.processes.get(id);
    if (!entry) return false;

    try {
      entry.proc.kill();
    } catch {
      // Process may have already exited
    }

    if (entry.timeoutId) {
      clearTimeout(entry.timeoutId);
    }

    this.processes.delete(id);
    return true;
  }

  /**
   * Kill all background processes
   */
  killAll(): void {
    for (const [id, entry] of this.processes) {
      try {
        entry.proc.kill();
      } catch {
        // Ignore errors
      }

      if (entry.timeoutId) {
        clearTimeout(entry.timeoutId);
      }
    }

    this.processes.clear();
  }

  /**
   * Remove a completed process from tracking
   */
  remove(id: string): void {
    const entry = this.processes.get(id);
    if (entry?.timeoutId) {
      clearTimeout(entry.timeoutId);
    }
    this.processes.delete(id);
  }

  /**
   * Get count of running background processes
   */
  get count(): number {
    return this.processes.size;
  }

  /**
   * Get all running background processes
   */
  getAll(): Array<{ id: string; hookId: string; runningMs: number }> {
    const now = Date.now();
    return Array.from(this.processes.values()).map((p) => ({
      id: p.id,
      hookId: p.hookId,
      runningMs: now - p.startTime,
    }));
  }
}

// Singleton instance
export const backgroundProcessManager = new BackgroundProcessManager();
