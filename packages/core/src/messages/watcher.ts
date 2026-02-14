/**
 * InboxWatcher - Watches an assistant's inbox for new messages
 *
 * Uses fs.watch to detect new files in the inbox directory,
 * enabling push-based message notifications instead of polling.
 */

import { watch, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import type { FSWatcher } from 'fs';
import { getMessagesBasePath } from './storage/local-storage';

export type NewMessageCallback = (messageId: string) => void;

/**
 * InboxWatcher - watches filesystem for new messages
 */
export class InboxWatcher {
  private assistantId: string;
  private inboxPath: string;
  private watcher: FSWatcher | null = null;
  private callbacks: Set<NewMessageCallback> = new Set();
  private knownFiles: Set<string> = new Set();
  private running = false;

  constructor(assistantId: string, basePath?: string) {
    this.assistantId = assistantId;
    const base = basePath || getMessagesBasePath();
    this.inboxPath = join(base, assistantId, 'messages');
  }

  /**
   * Start watching the inbox directory
   */
  start(): void {
    if (this.running) return;
    this.running = true;

    // Snapshot existing files so we only notify on NEW ones
    this.snapshotExisting();

    // Ensure directory exists before watching
    if (!existsSync(this.inboxPath)) {
      // Directory doesn't exist yet - poll for it
      this.pollForDirectory();
      return;
    }

    this.startWatching();
  }

  /**
   * Stop watching
   */
  stop(): void {
    this.running = false;
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    this.callbacks.clear();
  }

  /**
   * Register a callback for new messages
   * Returns unsubscribe function
   */
  onNewMessage(cb: NewMessageCallback): () => void {
    this.callbacks.add(cb);
    return () => {
      this.callbacks.delete(cb);
    };
  }

  /**
   * Check if watcher is running
   */
  isRunning(): boolean {
    return this.running;
  }

  private snapshotExisting(): void {
    try {
      if (existsSync(this.inboxPath)) {
        const files = readdirSync(this.inboxPath);
        for (const file of files) {
          if (file.endsWith('.json')) {
            this.knownFiles.add(file);
          }
        }
      }
    } catch {
      // Non-critical
    }
  }

  private startWatching(): void {
    try {
      this.watcher = watch(this.inboxPath, (eventType, filename) => {
        if (!filename || !filename.endsWith('.json')) return;
        if (eventType === 'rename' && !this.knownFiles.has(filename)) {
          // New file appeared
          this.knownFiles.add(filename);
          const messageId = filename.replace('.json', '');
          this.notifyCallbacks(messageId);
        }
      });

      this.watcher.on('error', () => {
        // Watcher error - restart after delay
        if (this.running) {
          this.watcher?.close();
          this.watcher = null;
          setTimeout(() => {
            if (this.running) this.startWatching();
          }, 5000);
        }
      });
    } catch {
      // fs.watch not available or directory doesn't exist
      // Fall back to polling
      this.pollForDirectory();
    }
  }

  private pollForDirectory(): void {
    if (!this.running) return;
    const interval = setInterval(() => {
      if (!this.running) {
        clearInterval(interval);
        return;
      }
      if (existsSync(this.inboxPath)) {
        clearInterval(interval);
        this.snapshotExisting();
        this.startWatching();
      }
    }, 5000);
  }

  private notifyCallbacks(messageId: string): void {
    for (const cb of this.callbacks) {
      try {
        cb(messageId);
      } catch {
        // Don't let callback errors crash the watcher
      }
    }
  }
}
