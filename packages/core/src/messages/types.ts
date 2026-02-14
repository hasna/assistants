/**
 * Assistant-to-Assistant Messaging Types
 * Internal messaging system for assistant communication
 */

// ============================================
// Message Priority & Status
// ============================================

export type MessagePriority = 'low' | 'normal' | 'high' | 'urgent';
export type MessageStatus = 'unread' | 'read' | 'archived' | 'injected';

// ============================================
// Core Message Types
// ============================================

/**
 * Full assistant message with all content
 */
export interface AssistantMessage {
  /** Unique message ID (msg_xxx) */
  id: string;
  /** Thread ID this message belongs to */
  threadId: string;
  /** Parent message ID if this is a reply */
  parentId: string | null;
  /** Sender assistant ID */
  fromAssistantId: string;
  /** Sender assistant name (for display) */
  fromAssistantName: string;
  /** Recipient assistant ID */
  toAssistantId: string;
  /** Recipient assistant name (for display) */
  toAssistantName: string;
  /** Message subject (optional) */
  subject?: string;
  /** Message body content */
  body: string;
  /** Message priority */
  priority: MessagePriority;
  /** Current status */
  status: MessageStatus;
  /** When message was created (ISO 8601) */
  createdAt: string;
  /** When message was read (ISO 8601) */
  readAt?: string;
  /** When message was injected into context (ISO 8601) */
  injectedAt?: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Message list item (summary for listing)
 */
export interface MessageListItem {
  /** Unique message ID */
  id: string;
  /** Thread ID */
  threadId: string;
  /** Parent message ID if reply */
  parentId: string | null;
  /** Sender assistant ID */
  fromAssistantId: string;
  /** Sender assistant name */
  fromAssistantName: string;
  /** Message subject */
  subject?: string;
  /** Preview of message body (first ~100 chars) */
  preview: string;
  /** Message priority */
  priority: MessagePriority;
  /** Current status */
  status: MessageStatus;
  /** When created (ISO 8601) */
  createdAt: string;
  /** Number of replies in thread */
  replyCount: number;
}

/**
 * Message thread metadata
 */
export interface MessageThread {
  /** Thread ID */
  threadId: string;
  /** Thread subject (from first message) */
  subject?: string;
  /** Participants in the thread */
  participants: Array<{ assistantId: string; assistantName: string }>;
  /** Total messages in thread */
  messageCount: number;
  /** Unread messages in thread */
  unreadCount: number;
  /** Last message in thread */
  lastMessage: MessageListItem;
  /** When thread was created (ISO 8601) */
  createdAt: string;
  /** When thread was last updated (ISO 8601) */
  updatedAt: string;
}

// ============================================
// Assistant Registry Types
// ============================================

/**
 * Assistant registry entry
 */
export interface AssistantRegistryEntry {
  /** Assistant display name */
  name: string;
  /** When assistant was last seen (ISO 8601) */
  lastSeen: string;
}

/**
 * Global assistant registry
 */
export interface AssistantRegistry {
  /** Map of assistantId -> assistant info */
  assistants: Record<string, AssistantRegistryEntry>;
}

// ============================================
// Inbox Index Types
// ============================================

/**
 * Inbox statistics
 */
export interface MessagesInboxStats {
  /** Total messages in inbox */
  totalMessages: number;
  /** Unread message count */
  unreadCount: number;
  /** Number of threads */
  threadCount: number;
}

/**
 * Inbox index for fast lookups
 */
export interface InboxIndex {
  /** List of message summaries */
  messages: MessageListItem[];
  /** Last time inbox was checked */
  lastCheck: string;
  /** Inbox statistics */
  stats: MessagesInboxStats;
}

// ============================================
// Input/Output Types
// ============================================

/**
 * Input for sending a message
 */
export interface SendMessageInput {
  /** Recipient (assistant ID or name) */
  to: string;
  /** Message subject (optional) */
  subject?: string;
  /** Message body */
  body: string;
  /** Priority (default: normal) */
  priority?: MessagePriority;
  /** Message ID to reply to */
  replyTo?: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Result from a messages operation
 */
export interface MessagesOperationResult {
  /** Whether operation succeeded */
  success: boolean;
  /** Human-readable message */
  message: string;
  /** Message ID (for send operations) */
  messageId?: string;
  /** Thread ID (for send operations) */
  threadId?: string;
}

// ============================================
// Configuration Types (re-exported from shared)
// ============================================

export type {
  MessagesConfig,
  MessagesInjectionConfig,
  MessagesStorageConfig,
} from '@hasna/assistants-shared';
