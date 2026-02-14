/**
 * ChannelsManager - Core class for channel-based agent collaboration
 *
 * Handles channel CRUD, membership, messaging, and context injection.
 * Follows the pattern from messages/messages-manager.ts.
 */

import type { ChannelsConfig } from '@hasna/assistants-shared';

import { ChannelStore } from './store';
import type {
  Channel,
  ChannelMember,
  ChannelMessage,
  ChannelListItem,
  ChannelOperationResult,
  MemberType,
} from './types';

export interface ChannelsManagerOptions {
  /** Assistant ID */
  assistantId: string;
  /** Assistant name */
  assistantName: string;
  /** Channels configuration */
  config: ChannelsConfig;
  /** Optional base path for workspace-scoped storage */
  basePath?: string;
  /** Optional override for the channels database path */
  dbPath?: string;
}

/**
 * ChannelsManager handles all channel operations for an assistant
 */
export class ChannelsManager {
  private assistantId: string;
  private assistantName: string;
  private config: ChannelsConfig;
  private store: ChannelStore;

  constructor(options: ChannelsManagerOptions) {
    this.assistantId = options.assistantId;
    this.assistantName = options.assistantName;
    this.config = options.config;
    this.store = new ChannelStore();
  }

  /**
   * Get the underlying store (for agent pool unread checks)
   */
  getStore(): ChannelStore {
    return this.store;
  }

  // ============================================
  // Channel CRUD
  // ============================================

  /**
   * Create a new channel
   */
  createChannel(name: string, description?: string): ChannelOperationResult {
    return this.store.createChannel(
      name,
      description || null,
      this.assistantId,
      this.assistantName
    );
  }

  /**
   * List all active channels
   */
  listChannels(): ChannelListItem[] {
    return this.store.listChannels({ status: 'active' });
  }

  /**
   * List channels the current assistant is a member of
   */
  listMyChannels(): ChannelListItem[] {
    return this.store.listChannels({
      status: 'active',
      assistantId: this.assistantId,
    });
  }

  /**
   * Get a channel by name or ID
   */
  getChannel(nameOrId: string): Channel | null {
    return this.store.resolveChannel(nameOrId);
  }

  /**
   * Archive a channel (soft delete)
   */
  archiveChannel(nameOrId: string): ChannelOperationResult {
    const channel = this.store.resolveChannel(nameOrId);
    if (!channel) {
      return { success: false, message: `Channel "${nameOrId}" not found.` };
    }

    const success = this.store.archiveChannel(channel.id);
    if (success) {
      return { success: true, message: `Channel #${channel.name} archived.`, channelId: channel.id };
    }
    return { success: false, message: `Failed to archive #${channel.name}. It may already be archived.` };
  }

  // ============================================
  // Membership
  // ============================================

  /**
   * Join a channel
   */
  join(nameOrId: string): ChannelOperationResult {
    const channel = this.store.resolveChannel(nameOrId);
    if (!channel) {
      return { success: false, message: `Channel "${nameOrId}" not found.` };
    }

    if (channel.status !== 'active') {
      return { success: false, message: `Channel #${channel.name} is archived.` };
    }

    if (this.store.isMember(channel.id, this.assistantId)) {
      return { success: false, message: `Already a member of #${channel.name}.` };
    }

    this.store.addMember(channel.id, this.assistantId, this.assistantName);
    return { success: true, message: `Joined #${channel.name}.`, channelId: channel.id };
  }

  /**
   * Leave a channel
   */
  leave(nameOrId: string): ChannelOperationResult {
    const channel = this.store.resolveChannel(nameOrId);
    if (!channel) {
      return { success: false, message: `Channel "${nameOrId}" not found.` };
    }

    if (!this.store.isMember(channel.id, this.assistantId)) {
      return { success: false, message: `Not a member of #${channel.name}.` };
    }

    this.store.removeMember(channel.id, this.assistantId);
    return { success: true, message: `Left #${channel.name}.`, channelId: channel.id };
  }

  /**
   * Invite another assistant or person to a channel
   */
  invite(
    nameOrId: string,
    targetId: string,
    targetName: string,
    memberType: MemberType = 'assistant'
  ): ChannelOperationResult {
    const channel = this.store.resolveChannel(nameOrId);
    if (!channel) {
      return { success: false, message: `Channel "${nameOrId}" not found.` };
    }

    if (channel.status !== 'active') {
      return { success: false, message: `Channel #${channel.name} is archived.` };
    }

    if (this.store.isMember(channel.id, targetId)) {
      return { success: false, message: `${targetName} is already a member of #${channel.name}.` };
    }

    this.store.addMember(channel.id, targetId, targetName, 'member', memberType);
    return {
      success: true,
      message: `Invited ${targetName} to #${channel.name}.`,
      channelId: channel.id,
    };
  }

  /**
   * Get members of a channel
   */
  getMembers(nameOrId: string): ChannelMember[] {
    const channel = this.store.resolveChannel(nameOrId);
    if (!channel) return [];
    return this.store.getMembers(channel.id);
  }

  // ============================================
  // Messages
  // ============================================

  /**
   * Send a message to a channel
   */
  send(nameOrId: string, content: string): ChannelOperationResult {
    const channel = this.store.resolveChannel(nameOrId);
    if (!channel) {
      return { success: false, message: `Channel "${nameOrId}" not found.` };
    }

    if (channel.status !== 'active') {
      return { success: false, message: `Channel #${channel.name} is archived.` };
    }

    if (!this.store.isMember(channel.id, this.assistantId)) {
      return { success: false, message: `You are not a member of #${channel.name}. Join first.` };
    }

    const messageId = this.store.sendMessage(
      channel.id,
      this.assistantId,
      this.assistantName,
      content
    );

    return {
      success: true,
      message: `Message sent to #${channel.name} (${messageId}).`,
      channelId: channel.id,
    };
  }

  /**
   * Send a message to a channel as a specific sender (for person/human attribution)
   */
  sendAs(
    nameOrId: string,
    content: string,
    senderId: string,
    senderName: string
  ): ChannelOperationResult {
    const channel = this.store.resolveChannel(nameOrId);
    if (!channel) {
      return { success: false, message: `Channel "${nameOrId}" not found.` };
    }

    if (channel.status !== 'active') {
      return { success: false, message: `Channel #${channel.name} is archived.` };
    }

    // Auto-join the person if they're not already a member
    if (!this.store.isMember(channel.id, senderId)) {
      this.store.addMember(channel.id, senderId, senderName, 'member', 'person');
    }

    const messageId = this.store.sendMessage(
      channel.id,
      senderId,
      senderName,
      content
    );

    return {
      success: true,
      message: `Message sent to #${channel.name} (${messageId}).`,
      channelId: channel.id,
    };
  }

  /**
   * Read recent messages from a channel (also marks as read)
   */
  readMessages(
    nameOrId: string,
    limit?: number
  ): { channel: Channel; messages: ChannelMessage[] } | null {
    const channel = this.store.resolveChannel(nameOrId);
    if (!channel) return null;

    const messages = this.store.getMessages(channel.id, { limit });

    // Mark as read up to the newest fetched message to avoid skipping newer arrivals
    if (messages.length > 0) {
      const latest = messages[messages.length - 1];
      this.store.markReadAt(channel.id, this.assistantId, latest.createdAt);
    } else {
      this.store.markRead(channel.id, this.assistantId);
    }

    return { channel, messages };
  }

  /**
   * Mark a channel as read
   */
  markRead(nameOrId: string): void {
    const channel = this.store.resolveChannel(nameOrId);
    if (channel) {
      this.store.markRead(channel.id, this.assistantId);
    }
  }

  // ============================================
  // Context Injection
  // ============================================

  /**
   * Get unread messages for context injection
   */
  getUnreadForInjection(): ChannelMessage[] {
    const injectionConfig = this.config.injection || {};
    if (injectionConfig.enabled === false) {
      return [];
    }

    const maxPerTurn = injectionConfig.maxPerTurn || 10;
    return this.store.getAllUnreadMessages(this.assistantId, maxPerTurn);
  }

  /**
   * Build context string for injection
   */
  buildInjectionContext(messages: ChannelMessage[]): string {
    if (messages.length === 0) {
      return '';
    }

    // Group messages by channel
    const byChannel = new Map<string, ChannelMessage[]>();
    for (const msg of messages) {
      const existing = byChannel.get(msg.channelId) || [];
      existing.push(msg);
      byChannel.set(msg.channelId, existing);
    }

    const lines: string[] = [];
    lines.push('## Unread Channel Messages');
    lines.push('');

    for (const [channelId, channelMessages] of byChannel) {
      const channel = this.store.getChannel(channelId);
      const channelName = channel ? `#${channel.name}` : channelId;

      lines.push(`### ${channelName} (${channelMessages.length} new)`);
      for (const msg of channelMessages) {
        const ago = formatTimeAgo(msg.createdAt);
        lines.push(`**${msg.senderName}** (${ago}): ${msg.content}`);
      }
      lines.push('');
    }

    lines.push('Use channel_read for history, channel_send to reply.');

    return lines.join('\n');
  }

  /**
   * Mark injected messages as read
   */
  markInjected(messages: ChannelMessage[]): void {
    // Group by channel and mark each as read
    const byChannel = new Map<string, string>();
    for (const msg of messages) {
      const existing = byChannel.get(msg.channelId);
      if (!existing || msg.createdAt > existing) {
        byChannel.set(msg.channelId, msg.createdAt);
      }
    }
    for (const [channelId, latestTimestamp] of byChannel) {
      this.store.markReadAt(channelId, this.assistantId, latestTimestamp);
    }
  }

  // ============================================
  // Cleanup
  // ============================================

  /**
   * Clean up old messages
   */
  cleanup(): number {
    const maxAgeDays = this.config.storage?.maxAgeDays || 90;
    const maxMessages = this.config.storage?.maxMessagesPerChannel || 5000;
    return this.store.cleanup(maxAgeDays, maxMessages);
  }

  /**
   * Close the store
   */
  close(): void {
    this.store.close();
  }
}

/**
 * Format a timestamp as relative time
 */
function formatTimeAgo(isoDate: string): string {
  const now = Date.now();
  const then = new Date(isoDate).getTime();
  const diffMs = now - then;

  if (diffMs < 60_000) {
    const secs = Math.floor(diffMs / 1000);
    return `${secs}s ago`;
  }
  if (diffMs < 3_600_000) {
    const mins = Math.floor(diffMs / 60_000);
    return `${mins}m ago`;
  }
  if (diffMs < 86_400_000) {
    const hours = Math.floor(diffMs / 3_600_000);
    return `${hours}h ago`;
  }
  const days = Math.floor(diffMs / 86_400_000);
  return `${days}d ago`;
}

/**
 * Create a ChannelsManager from config
 */
export function createChannelsManager(
  assistantId: string,
  assistantName: string,
  config: ChannelsConfig,
  options?: { basePath?: string; dbPath?: string }
): ChannelsManager {
  return new ChannelsManager({
    assistantId,
    assistantName,
    config,
    basePath: options?.basePath,
    dbPath: options?.dbPath,
  });
}
