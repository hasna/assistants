/**
 * InboxManager - Core class for managing assistant inbox operations
 * Orchestrates S3 storage, local cache, email parsing, and sending
 */

import { join } from 'path';
import type { Email, EmailListItem, InboxConfig } from '@hasna/assistants-shared';
import { S3InboxClient } from './storage/s3-client';
import { LocalInboxCache } from './storage/local-cache';
import { EmailParser } from './parser/email-parser';
import { createEmailProvider, type EmailProvider, type SendEmailOptions } from './providers';

export interface InboxManagerOptions {
  /** Assistant ID for scoping */
  assistantId: string;
  /** Assistant name (used for email address) */
  assistantName: string;
  /** Inbox configuration */
  config: InboxConfig;
  /** Base path for local cache (default: ~/.assistants/inbox) */
  basePath: string;
}

/**
 * InboxManager handles all inbox operations for an assistant
 */
export class InboxManager {
  private assistantId: string;
  private assistantName: string;
  private config: InboxConfig;
  private s3Client: S3InboxClient | null = null;
  private localCache: LocalInboxCache;
  private emailParser: EmailParser;
  private emailProvider: EmailProvider | null = null;

  constructor(options: InboxManagerOptions) {
    this.assistantId = options.assistantId;
    this.assistantName = options.assistantName;
    this.config = options.config;

    // Initialize local cache
    this.localCache = new LocalInboxCache({
      assistantId: options.assistantId,
      basePath: options.basePath,
    });

    // Initialize email parser
    this.emailParser = new EmailParser();

    // Initialize S3 client if storage is configured
    if (this.config.storage?.bucket) {
      this.s3Client = new S3InboxClient({
        bucket: this.config.storage.bucket,
        region: this.config.storage.region,
        prefix: this.config.storage.prefix,
        credentialsProfile: this.config.storage.credentialsProfile,
      });
    }
  }

  /**
   * Get the assistant's email address
   */
  getEmailAddress(): string {
    if (!this.config.domain) {
      return `${this.assistantName}@inbox.local`;
    }

    const format = this.config.addressFormat || '{assistant-name}@{domain}';
    return format
      .replace('{assistant-name}', this.assistantName.toLowerCase().replace(/\s+/g, '-'))
      .replace('{assistant-id}', this.assistantId)
      .replace('{domain}', this.config.domain);
  }

  /**
   * Fetch new emails from S3 to local cache
   * Uses catch-all strategy: fetches all emails and filters by To: header
   */
  async fetch(options?: { limit?: number }): Promise<number> {
    if (!this.s3Client) {
      throw new Error('S3 storage not configured. Set inbox.storage.bucket in config.');
    }

    const limit = options?.limit || 20;
    const assistantEmail = this.getEmailAddress().toLowerCase();

    // Get already cached email IDs
    const cachedIds = await this.localCache.getCachedIds();

    // List all emails from S3 inbox (catch-all bucket)
    const { objects } = await this.s3Client.listObjects({
      maxKeys: limit * 2, // Fetch more since we filter by address
    });

    let newCount = 0;

    for (const obj of objects) {
      if (newCount >= limit) break;

      const emailId = this.s3Client.extractEmailId(obj.key);

      // Skip already cached emails
      if (cachedIds.has(emailId)) {
        continue;
      }

      try {
        // Fetch raw email from S3
        const rawEmail = await this.s3Client.getObject(obj.key);

        // Parse the email
        const email = await this.emailParser.parse(rawEmail, {
          id: emailId,
          s3Key: obj.key,
        });

        // Check if this email is addressed to this assistant
        const isForAssistant = this.isEmailForAssistant(email, assistantEmail);
        if (!isForAssistant) {
          continue;
        }

        // Save to local cache
        await this.localCache.saveEmail(email);
        newCount++;
      } catch (error) {
        // Log error but continue processing other emails
        console.error(`Error processing email ${emailId}:`, error);
      }
    }

    // Update last sync timestamp
    await this.localCache.updateLastSync();

    return newCount;
  }

  /**
   * Check if an email is addressed to this assistant
   */
  private isEmailForAssistant(email: Email, assistantEmail: string): boolean {
    // Check To: addresses
    for (const addr of email.to) {
      if (addr.address.toLowerCase() === assistantEmail) {
        return true;
      }
    }

    // Check CC: addresses
    if (email.cc) {
      for (const addr of email.cc) {
        if (addr.address.toLowerCase() === assistantEmail) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * List emails from local cache
   */
  async list(options?: {
    limit?: number;
    unreadOnly?: boolean;
  }): Promise<EmailListItem[]> {
    return this.localCache.listEmails(options);
  }

  /**
   * Read a specific email by ID
   */
  async read(emailId: string): Promise<Email | null> {
    const email = await this.localCache.loadEmail(emailId);

    if (email) {
      // Mark as read
      await this.localCache.markRead(emailId);
    }

    return email;
  }

  /**
   * Download an attachment from an email
   */
  async downloadAttachment(emailId: string, attachmentIndex: number): Promise<string | null> {
    // Load the email to get attachment info
    const email = await this.localCache.loadEmail(emailId);
    if (!email) {
      throw new Error(`Email ${emailId} not found in cache`);
    }

    if (!email.attachments || attachmentIndex >= email.attachments.length) {
      throw new Error(`Attachment ${attachmentIndex} not found in email ${emailId}`);
    }

    const attachment = email.attachments[attachmentIndex];

    // Check if already downloaded
    const existingPath = await this.localCache.getAttachmentPath(emailId, attachment.filename);
    if (existingPath) {
      return existingPath;
    }

    // Need to fetch from S3
    if (!this.s3Client || !email.s3Key) {
      throw new Error('Cannot download attachment: S3 not configured or no S3 key');
    }

    // Fetch raw email from S3
    const rawEmail = await this.s3Client.getObject(email.s3Key);

    // Extract attachment content
    const content = await this.emailParser.extractAttachment(rawEmail, attachmentIndex);
    if (!content) {
      throw new Error(`Could not extract attachment ${attachmentIndex} from email`);
    }

    // Save to local cache
    const localPath = await this.localCache.saveAttachment(
      emailId,
      attachment.filename,
      content
    );

    return localPath;
  }

  /**
   * Send an email
   */
  async send(options: Omit<SendEmailOptions, 'from'>): Promise<{ messageId: string }> {
    // Initialize provider lazily
    if (!this.emailProvider) {
      this.emailProvider = createEmailProvider(this.config);
    }

    const fromAddress = this.getEmailAddress();

    return this.emailProvider.send({
      ...options,
      from: fromAddress,
    });
  }

  /**
   * Reply to an email
   */
  async reply(
    emailId: string,
    options: { text?: string; html?: string }
  ): Promise<{ messageId: string }> {
    const originalEmail = await this.localCache.loadEmail(emailId);
    if (!originalEmail) {
      throw new Error(`Email ${emailId} not found`);
    }

    // Determine reply-to address
    const replyTo = originalEmail.headers['reply-to'] || originalEmail.from.address;

    // Create subject with Re: prefix if not already present
    let subject = originalEmail.subject;
    if (!subject.toLowerCase().startsWith('re:')) {
      subject = `Re: ${subject}`;
    }

    return this.send({
      to: replyTo,
      subject,
      text: options.text,
      html: options.html,
      replyTo: originalEmail.messageId,
    });
  }

  /**
   * Mark an email as read
   */
  async markRead(emailId: string): Promise<void> {
    await this.localCache.markRead(emailId);
  }

  /**
   * Mark an email as unread
   */
  async markUnread(emailId: string): Promise<void> {
    await this.localCache.markUnread(emailId);
  }

  /**
   * Get last sync timestamp
   */
  async getLastSync(): Promise<string | null> {
    return this.localCache.getLastSync();
  }

  /**
   * Clean up old cached emails
   */
  async cleanup(): Promise<number> {
    const maxAgeDays = this.config.cache?.maxAgeDays || 30;
    return this.localCache.cleanup(maxAgeDays);
  }

  /**
   * Get cache statistics
   */
  async getCacheStats(): Promise<{
    emailCount: number;
    cacheSize: number;
    lastSync: string | null;
  }> {
    const emails = await this.localCache.listEmails();
    const cacheSize = await this.localCache.getCacheSize();
    const lastSync = await this.localCache.getLastSync();

    return {
      emailCount: emails.length,
      cacheSize,
      lastSync,
    };
  }
}

/**
 * Create an InboxManager from config
 */
export function createInboxManager(
  assistantId: string,
  assistantName: string,
  config: InboxConfig,
  configDir: string
): InboxManager {
  const basePath = join(configDir, 'messages');

  return new InboxManager({
    assistantId,
    assistantName,
    config,
    basePath,
  });
}
