/**
 * MessagesManager - Core class for assistant-to-assistant messaging
 * Handles sending, receiving, listing, and context injection of messages
 */

import { generateId } from '@hasna/assistants-shared';
import { LocalMessagesStorage } from './storage/local-storage';
import { InboxWatcher, type NewMessageCallback } from './watcher';
import type {
  AssistantMessage,
  MessageListItem,
  MessageThread,
  SendMessageInput,
  MessagesOperationResult,
  MessagesConfig,
  MessagePriority,
} from './types';

export interface MessagesManagerOptions {
  /** Assistant ID */
  assistantId: string;
  /** Assistant name */
  assistantName: string;
  /** Messages configuration */
  config: MessagesConfig;
}

/**
 * Priority order for comparison
 */
const PRIORITY_ORDER: Record<MessagePriority, number> = {
  low: 0,
  normal: 1,
  high: 2,
  urgent: 3,
};

/**
 * Generate a message ID
 */
function generateMessageId(): string {
  return `msg_${generateId().slice(0, 8)}`;
}

/**
 * Generate a thread ID
 */
function generateThreadId(): string {
  return `thread_${generateId().slice(0, 8)}`;
}

/**
 * MessagesManager handles all messaging operations for an assistant
 */
export class MessagesManager {
  private assistantId: string;
  private assistantName: string;
  private config: MessagesConfig;
  private storage: LocalMessagesStorage;
  private watcher: InboxWatcher | null = null;
  private messageCallbacks: Set<(message: AssistantMessage) => void> = new Set();

  constructor(options: MessagesManagerOptions) {
    this.assistantId = options.assistantId;
    this.assistantName = options.assistantName;
    this.config = options.config;

    this.storage = new LocalMessagesStorage();
  }

  /**
   * Initialize the manager (register assistant)
   */
  async initialize(): Promise<void> {
    await this.storage.registerAssistant(this.assistantId, this.assistantName);
  }

  // ============================================
  // Message Operations
  // ============================================

  /**
   * Send a message to another assistant
   */
  async send(input: SendMessageInput): Promise<MessagesOperationResult> {
    try {
      // Resolve recipient
      const recipient = await this.resolveRecipient(input.to);
      if (!recipient) {
        return {
          success: false,
          message: `Assistant "${input.to}" not found. Use messages_list_assistants to see known assistants.`,
        };
      }

      // Handle reply
      let threadId: string;
      let parentId: string | null = null;
      let subject = input.subject;

      if (input.replyTo) {
        const parentMessage = await this.storage.loadMessage(this.assistantId, input.replyTo);
        if (!parentMessage) {
          return {
            success: false,
            message: `Message "${input.replyTo}" not found.`,
          };
        }
        threadId = parentMessage.threadId;
        parentId = parentMessage.id;
        if (!subject && parentMessage.subject) {
          subject = parentMessage.subject.startsWith('Re: ')
            ? parentMessage.subject
            : `Re: ${parentMessage.subject}`;
        }
      } else {
        threadId = generateThreadId();
      }

      const messageId = generateMessageId();
      const now = new Date().toISOString();

      const message: AssistantMessage = {
        id: messageId,
        threadId,
        parentId,
        fromAssistantId: this.assistantId,
        fromAssistantName: this.assistantName,
        toAssistantId: recipient.id,
        toAssistantName: recipient.name,
        subject,
        body: input.body,
        priority: input.priority || 'normal',
        status: 'unread',
        createdAt: now,
        metadata: input.metadata,
      };

      // Save to recipient's inbox
      await this.storage.saveMessage(message);

      // Update sender's registry
      await this.storage.registerAssistant(this.assistantId, this.assistantName);

      return {
        success: true,
        message: `Message sent to ${recipient.name}`,
        messageId,
        threadId,
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to send message: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Resolve a recipient (by ID or name)
   */
  private async resolveRecipient(to: string): Promise<{ id: string; name: string } | null> {
    // Try by ID first
    const byId = await this.storage.getAssistantById(to);
    if (byId) {
      return { id: to, name: byId.name };
    }

    // Try by name
    const byName = await this.storage.findAssistantByName(to);
    if (byName) {
      return { id: byName.id, name: byName.entry.name };
    }

    return null;
  }

  /**
   * List messages in inbox
   */
  async list(options?: {
    limit?: number;
    unreadOnly?: boolean;
    threadId?: string;
    from?: string;
  }): Promise<MessageListItem[]> {
    let fromAssistantId: string | undefined;

    if (options?.from) {
      const recipient = await this.resolveRecipient(options.from);
      fromAssistantId = recipient?.id;
    }

    return this.storage.listMessages(this.assistantId, {
      limit: options?.limit,
      unreadOnly: options?.unreadOnly,
      threadId: options?.threadId,
      fromAssistantId,
    });
  }

  /**
   * Read a specific message
   */
  async read(messageId: string): Promise<AssistantMessage | null> {
    const message = await this.storage.loadMessage(this.assistantId, messageId);

    if (message && (message.status === 'unread' || message.status === 'injected')) {
      await this.storage.updateMessageStatus(
        this.assistantId,
        messageId,
        'read',
        new Date().toISOString()
      );
      message.status = 'read';
      message.readAt = new Date().toISOString();
    }

    return message;
  }

  /**
   * Read an entire thread
   */
  async readThread(threadId: string): Promise<AssistantMessage[]> {
    const messages = await this.storage.loadThreadMessages(this.assistantId, threadId);

    // Mark all as read
    for (const message of messages) {
      if (message.status === 'unread' || message.status === 'injected') {
        await this.storage.updateMessageStatus(
          this.assistantId,
          message.id,
          'read',
          new Date().toISOString()
        );
        message.status = 'read';
        message.readAt = new Date().toISOString();
      }
    }

    return messages;
  }

  /**
   * Delete a message
   */
  async delete(messageId: string): Promise<MessagesOperationResult> {
    const deleted = await this.storage.deleteMessage(this.assistantId, messageId);

    if (deleted) {
      return {
        success: true,
        message: `Message ${messageId} deleted.`,
      };
    }

    return {
      success: false,
      message: `Message ${messageId} not found.`,
    };
  }

  /**
   * List conversation threads
   */
  async listThreads(): Promise<MessageThread[]> {
    return this.storage.listThreads(this.assistantId);
  }

  /**
   * List known assistants
   */
  async listAssistants(): Promise<Array<{ id: string; name: string; lastSeen: string }>> {
    const assistants = await this.storage.listAssistants();
    // Filter out self
    return assistants.filter((a) => a.id !== this.assistantId);
  }

  /**
   * Get inbox statistics
   */
  async getStats(): Promise<{
    totalMessages: number;
    unreadCount: number;
    threadCount: number;
  }> {
    const index = await this.storage.loadIndex(this.assistantId);
    return index.stats;
  }

  // ============================================
  // Context Injection
  // ============================================

  /**
   * Get unread messages for context injection
   */
  async getUnreadForInjection(): Promise<AssistantMessage[]> {
    const injectionConfig = this.config.injection || {};
    if (injectionConfig.enabled === false) {
      return [];
    }

    const maxPerTurn = injectionConfig.maxPerTurn || 5;
    const minPriority = injectionConfig.minPriority || 'low';
    const minPriorityOrder = PRIORITY_ORDER[minPriority];

    // Get unread messages
    const unread = await this.storage.listMessages(this.assistantId, {
      unreadOnly: true,
    });

    // Filter by priority and exclude already-injected messages
    const filtered = unread.filter(
      (m) => m.status === 'unread' && PRIORITY_ORDER[m.priority] >= minPriorityOrder
    );

    // Sort by priority (high first) then by date (oldest first)
    filtered.sort((a, b) => {
      const priorityDiff = PRIORITY_ORDER[b.priority] - PRIORITY_ORDER[a.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });

    // Limit
    const toInject = filtered.slice(0, maxPerTurn);

    // Load full messages
    const messages: AssistantMessage[] = [];
    for (const item of toInject) {
      const message = await this.storage.loadMessage(this.assistantId, item.id);
      if (message) {
        messages.push(message);
      }
    }

    return messages;
  }

  /**
   * Mark messages as injected
   */
  async markInjected(messageIds: string[]): Promise<void> {
    const now = new Date().toISOString();
    for (const id of messageIds) {
      await this.storage.updateMessageStatus(this.assistantId, id, 'injected', now);
    }
  }

  /**
   * Build context string for injection
   */
  buildInjectionContext(messages: AssistantMessage[]): string {
    if (messages.length === 0) {
      return '';
    }

    const lines: string[] = [];
    lines.push('## Pending Assistant Messages');
    lines.push('');
    lines.push(`You have ${messages.length} unread message(s):`);

    for (const msg of messages) {
      lines.push('');
      lines.push(`### From: ${msg.fromAssistantName}`);
      if (msg.subject) {
        lines.push(`**Subject:** ${msg.subject}`);
      }
      lines.push(`**Priority:** ${msg.priority} | **Sent:** ${formatDate(msg.createdAt)}`);
      lines.push('');
      lines.push(msg.body);
      lines.push(`*Message ID: ${msg.id}*`);
      if (msg.threadId !== msg.id.replace('msg_', 'thread_')) {
        lines.push(`*Thread: ${msg.threadId}*`);
      }
      lines.push('---');
    }

    lines.push('');
    lines.push('Use messages_read to mark as read, or messages_send to reply.');

    return lines.join('\n');
  }

  // ============================================
  // Real-time Watching
  // ============================================

  /**
   * Start watching inbox for new messages (push-based notifications)
   */
  startWatching(): void {
    if (this.watcher) return;
    this.watcher = new InboxWatcher(
      this.assistantId,
      this.config.storage?.basePath
    );

    this.watcher.onNewMessage(async (messageId) => {
      // Load the new message and notify callbacks
      try {
        const message = await this.storage.loadMessage(this.assistantId, messageId);
        if (message) {
          for (const cb of this.messageCallbacks) {
            try {
              cb(message);
            } catch {
              // Don't let callback errors crash watching
            }
          }
        }
      } catch {
        // Non-critical
      }
    });

    this.watcher.start();
  }

  /**
   * Stop watching inbox
   */
  stopWatching(): void {
    if (this.watcher) {
      this.watcher.stop();
      this.watcher = null;
    }
    this.messageCallbacks.clear();
  }

  /**
   * Register a callback for incoming messages
   * Returns unsubscribe function
   */
  onMessage(callback: (message: AssistantMessage) => void): () => void {
    this.messageCallbacks.add(callback);
    return () => {
      this.messageCallbacks.delete(callback);
    };
  }

  /**
   * Check if watching is active
   */
  isWatching(): boolean {
    return this.watcher?.isRunning() ?? false;
  }

  // ============================================
  // Cleanup
  // ============================================

  /**
   * Clean up old messages
   */
  async cleanup(): Promise<number> {
    const maxAgeDays = this.config.storage?.maxAgeDays || 90;
    const maxMessages = this.config.storage?.maxMessages || 1000;

    let deleted = await this.storage.cleanup(this.assistantId, maxAgeDays);
    deleted += await this.storage.enforceMaxMessages(this.assistantId, maxMessages);

    return deleted;
  }
}

/**
 * Format a date for display
 */
function formatDate(isoDate: string): string {
  const date = new Date(isoDate);
  return date.toLocaleString();
}

/**
 * Create a MessagesManager from config
 */
export function createMessagesManager(
  assistantId: string,
  assistantName: string,
  config: MessagesConfig
): MessagesManager {
  return new MessagesManager({
    assistantId,
    assistantName,
    config,
  });
}
