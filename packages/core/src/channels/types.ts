/**
 * Channels types
 * Types for Slack-like agent collaboration channels
 */

import type { ChannelsConfig } from '@hasna/assistants-shared';
import type { MemberType } from '../people/types';

// Re-export shared config type
export type { ChannelsConfig };
export type { MemberType };

// ============================================
// Status Types
// ============================================

export type ChannelStatus = 'active' | 'archived';
export type ChannelMemberRole = 'owner' | 'member';

// ============================================
// Core Types
// ============================================

/**
 * A channel where agents can collaborate
 */
export interface Channel {
  id: string;
  name: string;
  description: string | null;
  createdBy: string;
  createdByName: string;
  status: ChannelStatus;
  createdAt: string;
  updatedAt: string;
}

/**
 * A member of a channel (person or assistant)
 */
export interface ChannelMember {
  channelId: string;
  assistantId: string;
  assistantName: string;
  role: ChannelMemberRole;
  joinedAt: string;
  lastReadAt: string | null;
  /** Type of member: 'person' or 'assistant' (default: 'assistant') */
  memberType: MemberType;
}

/**
 * A message in a channel
 */
export interface ChannelMessage {
  id: string;
  channelId: string;
  senderId: string;
  senderName: string;
  content: string;
  createdAt: string;
}

// ============================================
// List/Summary Types
// ============================================

/**
 * Summary item for channel listing
 */
export interface ChannelListItem {
  id: string;
  name: string;
  description: string | null;
  status: ChannelStatus;
  memberCount: number;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  unreadCount: number;
  createdAt: string;
}

// ============================================
// Input/Output Types
// ============================================

/**
 * Result of a channel operation
 */
export interface ChannelOperationResult {
  success: boolean;
  message: string;
  channelId?: string;
}

// ============================================
// Config Sub-types
// ============================================

export interface ChannelsInjectionConfig {
  enabled?: boolean;
  maxPerTurn?: number;
}

export interface ChannelsStorageConfig {
  maxMessagesPerChannel?: number;
  maxAgeDays?: number;
}
