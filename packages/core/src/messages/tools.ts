/**
 * Messages tools for assistant use
 * Tools that allow assistants to send and receive messages from other assistants
 */

import type { Tool } from '@hasna/assistants-shared';
import type { ToolExecutor, ToolRegistry } from '../tools/registry';
import type { MessagesManager } from './messages-manager';

// ============================================
// Tool Definitions
// ============================================

/**
 * messages_send - Send a message to another assistant
 */
export const messagesSendTool: Tool = {
  name: 'messages_send',
  description:
    'Send a message to another assistant. Use assistant name or ID as recipient. Messages are delivered instantly to the recipient\'s inbox.',
  parameters: {
    type: 'object',
    properties: {
      to: {
        type: 'string',
        description: 'Recipient assistant name or ID',
      },
      body: {
        type: 'string',
        description: 'Message body content',
      },
      subject: {
        type: 'string',
        description: 'Message subject (optional)',
      },
      priority: {
        type: 'string',
        description: 'Message priority: low, normal, high, or urgent (default: normal)',
        enum: ['low', 'normal', 'high', 'urgent'],
      },
      replyTo: {
        type: 'string',
        description: 'Message ID to reply to (optional, for threading)',
      },
    },
    required: ['to', 'body'],
  },
};

/**
 * messages_list - List messages in inbox
 */
export const messagesListTool: Tool = {
  name: 'messages_list',
  description: 'List messages in your inbox. Can filter by read status, thread, or sender.',
  parameters: {
    type: 'object',
    properties: {
      limit: {
        type: 'number',
        description: 'Maximum number of messages to return (default: 20)',
      },
      unreadOnly: {
        type: 'boolean',
        description: 'Only return unread messages (default: false)',
      },
      threadId: {
        type: 'string',
        description: 'Filter by thread ID (optional)',
      },
      from: {
        type: 'string',
        description: 'Filter by sender assistant name or ID (optional)',
      },
    },
    required: [],
  },
};

/**
 * messages_read - Read a specific message
 */
export const messagesReadTool: Tool = {
  name: 'messages_read',
  description: 'Read the full content of a message by its ID. Marks the message as read.',
  parameters: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'The message ID to read',
      },
    },
    required: ['id'],
  },
};

/**
 * messages_read_thread - Read entire thread
 */
export const messagesReadThreadTool: Tool = {
  name: 'messages_read_thread',
  description: 'Read all messages in a conversation thread. Messages are returned in chronological order.',
  parameters: {
    type: 'object',
    properties: {
      threadId: {
        type: 'string',
        description: 'The thread ID to read',
      },
    },
    required: ['threadId'],
  },
};

/**
 * messages_delete - Delete a message
 */
export const messagesDeleteTool: Tool = {
  name: 'messages_delete',
  description: 'Delete a message from your inbox.',
  parameters: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'The message ID to delete',
      },
    },
    required: ['id'],
  },
};

/**
 * messages_list_assistants - List known assistants
 */
export const messagesListAssistantsTool: Tool = {
  name: 'messages_list_assistants',
  description:
    'List all known assistants that you can send messages to. Shows assistant names and when they were last active.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
};

// ============================================
// Tool Executors
// ============================================

/**
 * Create executors for messages tools
 */
export function createMessagesToolExecutors(
  getMessagesManager: () => MessagesManager | null
): Record<string, ToolExecutor> {
  return {
    messages_send: async (input) => {
      const manager = getMessagesManager();
      if (!manager) {
        return 'Error: Messages are not enabled or configured.';
      }

      const to = String(input.to || '').trim();
      const body = String(input.body || '').trim();
      const subject = input.subject ? String(input.subject).trim() : undefined;
      const priority = input.priority as 'low' | 'normal' | 'high' | 'urgent' | undefined;
      const replyTo = input.replyTo ? String(input.replyTo).trim() : undefined;

      if (!to) {
        return 'Error: Recipient (to) is required.';
      }
      if (!body) {
        return 'Error: Message body is required.';
      }

      const result = await manager.send({
        to,
        body,
        subject,
        priority,
        replyTo,
      });

      if (result.success) {
        return `${result.message} (Message ID: ${result.messageId})`;
      }
      return `Error: ${result.message}`;
    },

    messages_list: async (input) => {
      const manager = getMessagesManager();
      if (!manager) {
        return 'Error: Messages are not enabled or configured.';
      }

      const limit = typeof input.limit === 'number' ? input.limit : 20;
      const unreadOnly = input.unreadOnly === true;
      const threadId = input.threadId ? String(input.threadId).trim() : undefined;
      const from = input.from ? String(input.from).trim() : undefined;

      try {
        const messages = await manager.list({
          limit,
          unreadOnly,
          threadId,
          from,
        });

        if (messages.length === 0) {
          if (unreadOnly) {
            return 'No unread messages.';
          }
          return 'Inbox is empty.';
        }

        const lines: string[] = [];
        lines.push(`## Inbox (${messages.length} message${messages.length === 1 ? '' : 's'})`);
        lines.push('');

        for (const msg of messages) {
          const statusIcon = msg.status === 'read' ? '📖' : msg.status === 'injected' ? '👁️' : '📬';
          const priorityIcon =
            msg.priority === 'urgent'
              ? '🔴'
              : msg.priority === 'high'
              ? '🟠'
              : msg.priority === 'normal'
              ? ''
              : '🔵';
          const date = new Date(msg.createdAt).toLocaleDateString();

          lines.push(`${statusIcon}${priorityIcon} **${msg.id}**`);
          lines.push(`   From: ${msg.fromAssistantName}`);
          if (msg.subject) {
            lines.push(`   Subject: ${msg.subject}`);
          }
          lines.push(`   Preview: ${msg.preview}`);
          lines.push(`   Date: ${date}${msg.replyCount > 0 ? ` | ${msg.replyCount} replies` : ''}`);
          lines.push('');
        }

        return lines.join('\n');
      } catch (error) {
        return `Error listing messages: ${error instanceof Error ? error.message : String(error)}`;
      }
    },

    messages_read: async (input) => {
      const manager = getMessagesManager();
      if (!manager) {
        return 'Error: Messages are not enabled or configured.';
      }

      const id = String(input.id || '').trim();
      if (!id) {
        return 'Error: Message ID is required.';
      }

      try {
        const message = await manager.read(id);
        if (!message) {
          return `Message ${id} not found.`;
        }

        return formatMessageAsMarkdown(message);
      } catch (error) {
        return `Error reading message: ${error instanceof Error ? error.message : String(error)}`;
      }
    },

    messages_read_thread: async (input) => {
      const manager = getMessagesManager();
      if (!manager) {
        return 'Error: Messages are not enabled or configured.';
      }

      const threadId = String(input.threadId || '').trim();
      if (!threadId) {
        return 'Error: Thread ID is required.';
      }

      try {
        const messages = await manager.readThread(threadId);
        if (messages.length === 0) {
          return `Thread ${threadId} not found or empty.`;
        }

        const lines: string[] = [];
        lines.push(`## Thread: ${threadId}`);
        lines.push(`**${messages.length} message(s)**`);
        lines.push('');

        for (const msg of messages) {
          lines.push('---');
          lines.push(`### From: ${msg.fromAssistantName} → ${msg.toAssistantName}`);
          if (msg.subject) {
            lines.push(`**Subject:** ${msg.subject}`);
          }
          lines.push(`**Sent:** ${new Date(msg.createdAt).toLocaleString()}`);
          lines.push('');
          lines.push(msg.body);
          lines.push(`*ID: ${msg.id}*`);
          lines.push('');
        }

        return lines.join('\n');
      } catch (error) {
        return `Error reading thread: ${error instanceof Error ? error.message : String(error)}`;
      }
    },

    messages_delete: async (input) => {
      const manager = getMessagesManager();
      if (!manager) {
        return 'Error: Messages are not enabled or configured.';
      }

      const id = String(input.id || '').trim();
      if (!id) {
        return 'Error: Message ID is required.';
      }

      try {
        const result = await manager.delete(id);
        return result.message;
      } catch (error) {
        return `Error deleting message: ${error instanceof Error ? error.message : String(error)}`;
      }
    },

    messages_broadcast: async (input) => {
      const manager = getMessagesManager();
      if (!manager) {
        return 'Error: Messages are not enabled or configured.';
      }

      const body = String(input.body || '').trim();
      const subject = input.subject ? String(input.subject).trim() : undefined;
      const priority = input.priority as 'low' | 'normal' | 'high' | 'urgent' | undefined;

      if (!body) {
        return 'Error: Message body is required.';
      }

      try {
        const assistants = await manager.listAssistants();
        if (assistants.length === 0) {
          return 'No other assistants found to broadcast to.';
        }

        const results: string[] = [];
        let sent = 0;
        let failed = 0;

        for (const assistant of assistants) {
          const result = await manager.send({
            to: assistant.id,
            body,
            subject: subject || '[Broadcast]',
            priority,
          });
          if (result.success) {
            sent++;
          } else {
            failed++;
            results.push(`Failed to send to ${assistant.name}: ${result.message}`);
          }
        }

        if (failed === 0) {
          return `Broadcast sent to ${sent} assistant(s).`;
        }
        return `Broadcast: ${sent} sent, ${failed} failed.\n${results.join('\n')}`;
      } catch (error) {
        return `Error broadcasting: ${error instanceof Error ? error.message : String(error)}`;
      }
    },

    messages_list_assistants: async () => {
      const manager = getMessagesManager();
      if (!manager) {
        return 'Error: Messages are not enabled or configured.';
      }

      try {
        const assistants = await manager.listAssistants();

        if (assistants.length === 0) {
          return 'No other assistants found. Assistants appear here after sending or receiving messages.';
        }

        const lines: string[] = [];
        lines.push(`## Known Assistants (${assistants.length})`);
        lines.push('');

        for (const assistant of assistants) {
          const lastSeen = new Date(assistant.lastSeen).toLocaleDateString();
          lines.push(`- **${assistant.name}** (ID: ${assistant.id})`);
          lines.push(`  Last seen: ${lastSeen}`);
        }

        return lines.join('\n');
      } catch (error) {
        return `Error listing assistants: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
  };
}

/**
 * Format a message as markdown for display
 */
function formatMessageAsMarkdown(message: {
  id: string;
  threadId: string;
  parentId: string | null;
  fromAssistantId: string;
  fromAssistantName: string;
  toAssistantId: string;
  toAssistantName: string;
  subject?: string;
  body: string;
  priority: string;
  status: string;
  createdAt: string;
  readAt?: string;
}): string {
  const lines: string[] = [];

  lines.push(`## Message: ${message.id}`);
  lines.push('');
  lines.push(`**From:** ${message.fromAssistantName} (${message.fromAssistantId})`);
  lines.push(`**To:** ${message.toAssistantName} (${message.toAssistantId})`);
  if (message.subject) {
    lines.push(`**Subject:** ${message.subject}`);
  }
  lines.push(`**Priority:** ${message.priority}`);
  lines.push(`**Sent:** ${new Date(message.createdAt).toLocaleString()}`);
  if (message.readAt) {
    lines.push(`**Read:** ${new Date(message.readAt).toLocaleString()}`);
  }
  lines.push(`**Thread:** ${message.threadId}`);
  if (message.parentId) {
    lines.push(`**In reply to:** ${message.parentId}`);
  }
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push(message.body);

  return lines.join('\n');
}

/**
 * messages_broadcast - Send a message to all workspace participants
 */
export const messagesBroadcastTool: Tool = {
  name: 'messages_broadcast',
  description:
    'Send a message to all known assistants. Useful for announcements or coordination. The message is delivered to every assistant in the registry.',
  parameters: {
    type: 'object',
    properties: {
      body: {
        type: 'string',
        description: 'Message body content to broadcast',
      },
      subject: {
        type: 'string',
        description: 'Message subject (optional)',
      },
      priority: {
        type: 'string',
        description: 'Message priority: low, normal, high, or urgent (default: normal)',
        enum: ['low', 'normal', 'high', 'urgent'],
      },
    },
    required: ['body'],
  },
};

/**
 * All messages tools
 */
export const messagesTools: Tool[] = [
  messagesSendTool,
  messagesListTool,
  messagesReadTool,
  messagesReadThreadTool,
  messagesDeleteTool,
  messagesListAssistantsTool,
  messagesBroadcastTool,
];

/**
 * Register messages tools with a tool registry
 */
export function registerMessagesTools(
  registry: ToolRegistry,
  getMessagesManager: () => MessagesManager | null
): void {
  const executors = createMessagesToolExecutors(getMessagesManager);

  for (const tool of messagesTools) {
    registry.register(tool, executors[tool.name]);
  }
}
