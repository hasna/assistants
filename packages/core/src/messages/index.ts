/**
 * Messages module exports
 * Provides assistant-to-assistant messaging functionality
 */

// Core manager
export { MessagesManager, createMessagesManager } from './messages-manager';
export type { MessagesManagerOptions } from './messages-manager';

// Storage
export { LocalMessagesStorage, getMessagesBasePath } from './storage/local-storage';
export type { LocalStorageOptions } from './storage/local-storage';

// Watcher
export { InboxWatcher, type NewMessageCallback } from './watcher';

// Tools
export {
  messagesTools,
  messagesSendTool,
  messagesListTool,
  messagesReadTool,
  messagesReadThreadTool,
  messagesDeleteTool,
  messagesListAssistantsTool,
  messagesBroadcastTool,
  createMessagesToolExecutors,
  registerMessagesTools,
} from './tools';

// Types
export type {
  // Message types
  MessagePriority,
  MessageStatus,
  AssistantMessage,
  MessageListItem,
  MessageThread,
  // Registry types
  AssistantRegistry,
  AssistantRegistryEntry,
  // Index types
  InboxIndex,
  MessagesInboxStats,
  // Input/output types
  SendMessageInput,
  MessagesOperationResult,
  // Config types
  MessagesConfig,
  MessagesInjectionConfig,
  MessagesStorageConfig,
} from './types';
