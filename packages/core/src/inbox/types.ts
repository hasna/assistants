/**
 * Internal types for inbox module
 * Types that are not exposed in the public API
 */

/**
 * Raw email metadata from S3 listing
 */
export interface S3EmailMeta {
  /** S3 object key */
  key: string;
  /** Last modified timestamp */
  lastModified?: Date;
  /** Object size in bytes */
  size?: number;
  /** Extracted email ID */
  emailId: string;
}

/**
 * Email sync state for tracking fetch progress
 */
export interface SyncState {
  /** Last sync timestamp */
  lastSync: string;
  /** Number of emails fetched in last sync */
  emailsFetched: number;
  /** S3 continuation token for pagination */
  continuationToken?: string;
}

/**
 * Inbox statistics
 */
export interface InboxStats {
  /** Total number of cached emails */
  totalEmails: number;
  /** Number of unread emails */
  unreadEmails: number;
  /** Cache size in bytes */
  cacheSizeBytes: number;
  /** Last sync timestamp */
  lastSync: string | null;
}
