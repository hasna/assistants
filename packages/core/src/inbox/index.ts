/**
 * Inbox module exports
 * Provides email inbox functionality for assistants
 */

// Core manager
export { InboxManager, createInboxManager } from './inbox-manager';
export type { InboxManagerOptions } from './inbox-manager';

// Storage
export { S3InboxClient } from './storage/s3-client';
export type { S3InboxClientOptions, S3ObjectInfo } from './storage/s3-client';
export { LocalInboxCache } from './storage/local-cache';
export type { LocalInboxCacheOptions, CacheIndex, CachedEmailEntry } from './storage/local-cache';

// Email parsing
export { EmailParser, formatEmailAsMarkdown, formatEmailAddress } from './parser/email-parser';
export type { ParseOptions } from './parser/email-parser';

// Email providers
export {
  createEmailProvider,
  SESProvider,
  ResendProvider,
} from './providers';
export type {
  EmailProvider,
  SendEmailOptions,
  SendEmailResult,
} from './providers';

// Tools
export {
  inboxTools,
  inboxFetchTool,
  inboxListTool,
  inboxReadTool,
  inboxDownloadAttachmentTool,
  inboxSendTool,
  createInboxToolExecutors,
  registerInboxTools,
} from './tools';

// Internal types (for advanced usage)
export type { S3EmailMeta, SyncState, InboxStats } from './types';
