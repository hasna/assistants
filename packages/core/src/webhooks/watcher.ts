/**
 * WebhookEventWatcher - Watches for new webhook events on the filesystem
 *
 * Uses fs.watch to detect new event files in per-webhook event directories,
 * enabling push-based event notifications instead of polling.
 * Follows the same pattern as messages/watcher.ts (InboxWatcher).
 */

import { watch, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import type { FSWatcher } from 'fs';
import { getWebhooksBasePath } from './storage/local-storage';

export type NewEventCallback = (webhookId: string, eventId: string) => void;

/**
 * WebhookEventWatcher - watches filesystem for new webhook events
 */
export class WebhookEventWatcher {
  private basePath: string;
  private eventsPath: string;
  private watchers: Map<string, FSWatcher> = new Map();
  private callbacks: Set<NewEventCallback> = new Set();
  private knownFiles: Map<string, Set<string>> = new Map();
  private running = false;
  private directoryWatcher: FSWatcher | null = null;

  constructor(basePath?: string) {
    this.basePath = basePath || getWebhooksBasePath();
    this.eventsPath = join(this.basePath, 'events');
  }

  /**
   * Start watching all webhook event directories
   */
  start(): void {
    if (this.running) return;
    this.running = true;

    if (!existsSync(this.eventsPath)) {
      this.pollForDirectory();
      return;
    }

    this.startWatchingAll();
  }

  /**
   * Stop watching
   */
  stop(): void {
    this.running = false;
    for (const [, watcher] of this.watchers) {
      watcher.close();
    }
    this.watchers.clear();
    if (this.directoryWatcher) {
      this.directoryWatcher.close();
      this.directoryWatcher = null;
    }
    this.callbacks.clear();
    this.knownFiles.clear();
  }

  /**
   * Register a callback for new events
   * Returns unsubscribe function
   */
  onNewEvent(cb: NewEventCallback): () => void {
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

  private startWatchingAll(): void {
    // Watch the events directory for new webhook subdirectories
    try {
      this.directoryWatcher = watch(this.eventsPath, (eventType, filename) => {
        if (!filename || eventType !== 'rename') return;
        // A new webhook directory appeared
        const dirPath = join(this.eventsPath, filename);
        if (existsSync(dirPath) && !this.watchers.has(filename)) {
          this.watchWebhookDir(filename);
        }
      });

      this.directoryWatcher.on('error', () => {
        if (this.running) {
          this.directoryWatcher?.close();
          this.directoryWatcher = null;
          setTimeout(() => {
            if (this.running) this.startWatchingAll();
          }, 5000);
        }
      });
    } catch {
      // Fall back to polling
    }

    // Watch existing webhook directories
    try {
      const dirs = readdirSync(this.eventsPath);
      for (const dir of dirs) {
        this.watchWebhookDir(dir);
      }
    } catch {
      // Non-critical
    }
  }

  private watchWebhookDir(webhookId: string): void {
    if (this.watchers.has(webhookId)) return;

    const dirPath = join(this.eventsPath, webhookId);
    if (!existsSync(dirPath)) return;

    // Snapshot existing files
    const known = new Set<string>();
    try {
      const files = readdirSync(dirPath);
      for (const file of files) {
        if (file.endsWith('.json') && file !== 'index.json') {
          known.add(file);
        }
      }
    } catch {
      // Non-critical
    }
    this.knownFiles.set(webhookId, known);

    try {
      const watcher = watch(dirPath, (eventType, filename) => {
        if (!filename || !filename.endsWith('.json') || filename === 'index.json') return;
        const knownSet = this.knownFiles.get(webhookId);
        if (eventType === 'rename' && knownSet && !knownSet.has(filename)) {
          knownSet.add(filename);
          const eventId = filename.replace('.json', '');
          this.notifyCallbacks(webhookId, eventId);
        }
      });

      watcher.on('error', () => {
        if (this.running) {
          watcher.close();
          this.watchers.delete(webhookId);
          setTimeout(() => {
            if (this.running) this.watchWebhookDir(webhookId);
          }, 5000);
        }
      });

      this.watchers.set(webhookId, watcher);
    } catch {
      // Non-critical
    }
  }

  private pollForDirectory(): void {
    if (!this.running) return;
    const interval = setInterval(() => {
      if (!this.running) {
        clearInterval(interval);
        return;
      }
      if (existsSync(this.eventsPath)) {
        clearInterval(interval);
        this.startWatchingAll();
      }
    }, 5000);
  }

  private notifyCallbacks(webhookId: string, eventId: string): void {
    for (const cb of this.callbacks) {
      try {
        cb(webhookId, eventId);
      } catch {
        // Don't let callback errors crash the watcher
      }
    }
  }
}
