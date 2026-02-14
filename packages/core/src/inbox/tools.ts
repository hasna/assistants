/**
 * Inbox tools for assistant use
 * Native tools that allow assistants to interact with their email inbox
 */

import type { Tool } from '@hasna/assistants-shared';
import type { ToolExecutor, ToolRegistry } from '../tools/registry';
import type { InboxManager } from './inbox-manager';
import { formatEmailAsMarkdown, formatEmailAddress } from './parser/email-parser';

/**
 * inbox_fetch - Sync emails from S3 to local cache
 */
export const inboxFetchTool: Tool = {
  name: 'inbox_fetch',
  description: 'Fetch new emails from the inbox. Syncs emails from S3 storage to local cache.',
  parameters: {
    type: 'object',
    properties: {
      limit: {
        type: 'number',
        description: 'Maximum number of emails to fetch (default: 20)',
      },
    },
    required: [],
  },
};

/**
 * inbox_list - List emails from cache
 */
export const inboxListTool: Tool = {
  name: 'inbox_list',
  description: 'List emails in the inbox. Returns a summary of cached emails.',
  parameters: {
    type: 'object',
    properties: {
      limit: {
        type: 'number',
        description: 'Maximum number of emails to return (default: 20)',
      },
      unreadOnly: {
        type: 'boolean',
        description: 'Only return unread emails (default: false)',
      },
    },
    required: [],
  },
};

/**
 * inbox_read - Read a specific email
 */
export const inboxReadTool: Tool = {
  name: 'inbox_read',
  description: 'Read the full content of an email by its ID.',
  parameters: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'The email ID to read',
      },
    },
    required: ['id'],
  },
};

/**
 * inbox_download_attachment - Download an email attachment
 */
export const inboxDownloadAttachmentTool: Tool = {
  name: 'inbox_download_attachment',
  description: 'Download an attachment from an email to local storage.',
  parameters: {
    type: 'object',
    properties: {
      emailId: {
        type: 'string',
        description: 'The email ID containing the attachment',
      },
      attachmentIndex: {
        type: 'number',
        description: 'The index of the attachment (0-based)',
      },
    },
    required: ['emailId', 'attachmentIndex'],
  },
};

/**
 * inbox_send - Send an email
 */
export const inboxSendTool: Tool = {
  name: 'inbox_send',
  description: 'Send an email from the assistant inbox.',
  parameters: {
    type: 'object',
    properties: {
      to: {
        type: 'string',
        description: 'Recipient email address (or comma-separated list)',
      },
      subject: {
        type: 'string',
        description: 'Email subject',
      },
      body: {
        type: 'string',
        description: 'Email body (plain text or markdown)',
      },
      html: {
        type: 'string',
        description: 'Optional HTML body',
      },
      replyToId: {
        type: 'string',
        description: 'Optional email ID to reply to (sets proper headers)',
      },
    },
    required: ['to', 'subject', 'body'],
  },
};

/**
 * Create executors for inbox tools
 */
export function createInboxToolExecutors(
  getInboxManager: () => InboxManager | null
): Record<string, ToolExecutor> {
  return {
    inbox_fetch: async (input) => {
      const manager = getInboxManager();
      if (!manager) {
        return 'Error: Inbox is not enabled or configured.';
      }

      const limit = typeof input.limit === 'number' ? input.limit : 20;

      try {
        const count = await manager.fetch({ limit });
        if (count === 0) {
          return 'No new emails found.';
        }
        return `Fetched ${count} new email(s).`;
      } catch (error) {
        return `Error fetching emails: ${error instanceof Error ? error.message : String(error)}`;
      }
    },

    inbox_list: async (input) => {
      const manager = getInboxManager();
      if (!manager) {
        return 'Error: Inbox is not enabled or configured.';
      }

      const limit = typeof input.limit === 'number' ? input.limit : 20;
      const unreadOnly = input.unreadOnly === true;

      try {
        const emails = await manager.list({ limit, unreadOnly });

        if (emails.length === 0) {
          return unreadOnly ? 'No unread emails.' : 'Inbox is empty.';
        }

        const lines: string[] = [];
        lines.push(`## Inbox (${emails.length} email${emails.length === 1 ? '' : 's'})`);
        lines.push('');

        for (const email of emails) {
          const readIndicator = email.isRead ? '📖' : '📬';
          const attachmentIndicator = email.hasAttachments ? ' 📎' : '';
          const date = new Date(email.date).toLocaleDateString();
          lines.push(`${readIndicator} **${email.id}**${attachmentIndicator}`);
          lines.push(`   From: ${email.from}`);
          lines.push(`   Subject: ${email.subject}`);
          lines.push(`   Date: ${date}`);
          lines.push('');
        }

        return lines.join('\n');
      } catch (error) {
        return `Error listing emails: ${error instanceof Error ? error.message : String(error)}`;
      }
    },

    inbox_read: async (input) => {
      const manager = getInboxManager();
      if (!manager) {
        return 'Error: Inbox is not enabled or configured.';
      }

      const id = String(input.id || '').trim();
      if (!id) {
        return 'Error: Email ID is required.';
      }

      try {
        const email = await manager.read(id);
        if (!email) {
          return `Email ${id} not found.`;
        }

        return formatEmailAsMarkdown(email);
      } catch (error) {
        return `Error reading email: ${error instanceof Error ? error.message : String(error)}`;
      }
    },

    inbox_download_attachment: async (input) => {
      const manager = getInboxManager();
      if (!manager) {
        return 'Error: Inbox is not enabled or configured.';
      }

      const emailId = String(input.emailId || '').trim();
      const attachmentIndex = typeof input.attachmentIndex === 'number' ? input.attachmentIndex : -1;

      if (!emailId) {
        return 'Error: Email ID is required.';
      }
      if (attachmentIndex < 0) {
        return 'Error: Valid attachment index is required.';
      }

      try {
        const localPath = await manager.downloadAttachment(emailId, attachmentIndex);
        if (!localPath) {
          return 'Error: Could not download attachment.';
        }

        return `Attachment downloaded to: ${localPath}`;
      } catch (error) {
        return `Error downloading attachment: ${error instanceof Error ? error.message : String(error)}`;
      }
    },

    inbox_send: async (input) => {
      const manager = getInboxManager();
      if (!manager) {
        return 'Error: Inbox is not enabled or configured.';
      }

      const to = String(input.to || '').trim();
      const subject = String(input.subject || '').trim();
      const body = String(input.body || '').trim();
      const html = input.html ? String(input.html) : undefined;
      const replyToId = input.replyToId ? String(input.replyToId).trim() : undefined;

      if (!to) {
        return 'Error: Recipient (to) is required.';
      }
      if (!subject) {
        return 'Error: Subject is required.';
      }
      if (!body) {
        return 'Error: Body is required.';
      }

      try {
        // Handle reply case
        if (replyToId) {
          const result = await manager.reply(replyToId, { text: body, html });
          return `Email sent successfully (Message-ID: ${result.messageId})`;
        }

        // Parse multiple recipients
        const recipients = to.split(',').map((r) => r.trim()).filter(Boolean);

        const result = await manager.send({
          to: recipients.length === 1 ? recipients[0] : recipients,
          subject,
          text: body,
          html,
        });

        return `Email sent successfully (Message-ID: ${result.messageId})`;
      } catch (error) {
        return `Error sending email: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
  };
}

/**
 * All inbox tools
 */
export const inboxTools: Tool[] = [
  inboxFetchTool,
  inboxListTool,
  inboxReadTool,
  inboxDownloadAttachmentTool,
  inboxSendTool,
];

/**
 * Register inbox tools with a tool registry
 */
export function registerInboxTools(
  registry: ToolRegistry,
  getInboxManager: () => InboxManager | null
): void {
  const executors = createInboxToolExecutors(getInboxManager);

  for (const tool of inboxTools) {
    registry.register(tool, executors[tool.name]);
  }
}
