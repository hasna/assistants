/**
 * Channel tools for assistant use
 * Tools that allow assistants to collaborate via shared channels
 */

import type { Tool } from '@hasna/assistants-shared';
import type { ToolExecutor, ToolRegistry } from '../tools/registry';
import type { ChannelsManager } from './manager';

// ============================================
// Tool Definitions
// ============================================

/**
 * channel_list - List available channels
 */
export const channelListTool: Tool = {
  name: 'channel_list',
  description:
    'List channels. By default shows only channels you are a member of. Set mine_only to false to see all channels.',
  parameters: {
    type: 'object',
    properties: {
      mine_only: {
        type: 'boolean',
        description: 'Only list channels you are a member of (default: true)',
      },
    },
    required: [],
  },
};

/**
 * channel_join - Join a channel
 */
export const channelJoinTool: Tool = {
  name: 'channel_join',
  description: 'Join a channel by name or ID to start receiving messages.',
  parameters: {
    type: 'object',
    properties: {
      channel: {
        type: 'string',
        description: 'Channel name (e.g., "general" or "#general") or channel ID',
      },
    },
    required: ['channel'],
  },
};

/**
 * channel_leave - Leave a channel
 */
export const channelLeaveTool: Tool = {
  name: 'channel_leave',
  description: 'Leave a channel. You will stop receiving messages from it.',
  parameters: {
    type: 'object',
    properties: {
      channel: {
        type: 'string',
        description: 'Channel name or ID',
      },
    },
    required: ['channel'],
  },
};

/**
 * channel_send - Send a message to a channel
 */
export const channelSendTool: Tool = {
  name: 'channel_send',
  description: 'Send a message to a channel. You must be a member of the channel.',
  parameters: {
    type: 'object',
    properties: {
      channel: {
        type: 'string',
        description: 'Channel name or ID',
      },
      message: {
        type: 'string',
        description: 'Message content to send',
      },
    },
    required: ['channel', 'message'],
  },
};

/**
 * channel_read - Read recent messages from a channel
 */
export const channelReadTool: Tool = {
  name: 'channel_read',
  description: 'Read recent messages from a channel. Also marks the channel as read.',
  parameters: {
    type: 'object',
    properties: {
      channel: {
        type: 'string',
        description: 'Channel name or ID',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of messages to return (default: 20)',
      },
    },
    required: ['channel'],
  },
};

/**
 * channel_members - List channel members
 */
export const channelMembersTool: Tool = {
  name: 'channel_members',
  description: 'List all members of a channel with their roles.',
  parameters: {
    type: 'object',
    properties: {
      channel: {
        type: 'string',
        description: 'Channel name or ID',
      },
    },
    required: ['channel'],
  },
};

/**
 * channel_invite - Invite an agent or person to a channel
 */
export const channelInviteTool: Tool = {
  name: 'channel_invite',
  description: 'Invite another assistant or person to join a channel.',
  parameters: {
    type: 'object',
    properties: {
      channel: {
        type: 'string',
        description: 'Channel name or ID',
      },
      name: {
        type: 'string',
        description: 'Name or ID of the person or assistant to invite',
      },
      type: {
        type: 'string',
        description: 'Member type: "person" or "assistant" (default: "assistant")',
        enum: ['person', 'assistant'],
      },
    },
    required: ['channel', 'name'],
  },
};

// ============================================
// Tool Executors
// ============================================

/**
 * Create executors for channel tools
 */
export function createChannelToolExecutors(
  getChannelsManager: () => ChannelsManager | null
): Record<string, ToolExecutor> {
  return {
    channel_list: async (input) => {
      const manager = getChannelsManager();
      if (!manager) {
        return 'Error: Channels are not enabled or configured. Set channels.enabled: true in config.';
      }

      const mineOnly = input.mine_only !== false; // default true

      try {
        const channels = mineOnly
          ? manager.listMyChannels()
          : manager.listChannels();

        if (channels.length === 0) {
          return mineOnly
            ? 'You are not a member of any channels. Use channel_list with mine_only: false to see all, or channel_join to join one.'
            : 'No channels exist yet.';
        }

        const lines: string[] = [];
        const label = mineOnly ? 'My Channels' : 'All Channels';
        lines.push(`## ${label} (${channels.length})`);
        lines.push('');

        for (const ch of channels) {
          const unread = ch.unreadCount > 0 ? ` (${ch.unreadCount} unread)` : '';
          const lastMsg = ch.lastMessagePreview
            ? `Last: ${ch.lastMessagePreview}`
            : 'No messages yet';

          lines.push(`**#${ch.name}**${unread}`);
          if (ch.description) {
            lines.push(`  ${ch.description}`);
          }
          lines.push(`  Members: ${ch.memberCount} | ${lastMsg}`);
          lines.push('');
        }

        return lines.join('\n');
      } catch (error) {
        return `Error listing channels: ${error instanceof Error ? error.message : String(error)}`;
      }
    },

    channel_join: async (input) => {
      const manager = getChannelsManager();
      if (!manager) {
        return 'Error: Channels are not enabled or configured.';
      }

      const channel = String(input.channel || '').trim();
      if (!channel) {
        return 'Error: Channel name or ID is required.';
      }

      const result = manager.join(channel);
      return result.success ? result.message : `Error: ${result.message}`;
    },

    channel_leave: async (input) => {
      const manager = getChannelsManager();
      if (!manager) {
        return 'Error: Channels are not enabled or configured.';
      }

      const channel = String(input.channel || '').trim();
      if (!channel) {
        return 'Error: Channel name or ID is required.';
      }

      const result = manager.leave(channel);
      return result.success ? result.message : `Error: ${result.message}`;
    },

    channel_send: async (input) => {
      const manager = getChannelsManager();
      if (!manager) {
        return 'Error: Channels are not enabled or configured.';
      }

      const channel = String(input.channel || '').trim();
      const message = String(input.message || '').trim();

      if (!channel) return 'Error: Channel name or ID is required.';
      if (!message) return 'Error: Message content is required.';

      const result = manager.send(channel, message);
      return result.success ? result.message : `Error: ${result.message}`;
    },

    channel_read: async (input) => {
      const manager = getChannelsManager();
      if (!manager) {
        return 'Error: Channels are not enabled or configured.';
      }

      const channel = String(input.channel || '').trim();
      if (!channel) return 'Error: Channel name or ID is required.';

      const limit = typeof input.limit === 'number' ? input.limit : 20;

      try {
        const result = manager.readMessages(channel, limit);
        if (!result) {
          return `Channel "${channel}" not found.`;
        }

        const { channel: ch, messages } = result;

        if (messages.length === 0) {
          return `No messages in #${ch.name}.`;
        }

        const lines: string[] = [];
        lines.push(`## #${ch.name} — Recent Messages (${messages.length})`);
        lines.push('');

        for (const msg of messages) {
          const date = new Date(msg.createdAt).toLocaleString();
          lines.push(`**${msg.senderName}** (${date}):`);
          lines.push(msg.content);
          lines.push('');
        }

        return lines.join('\n');
      } catch (error) {
        return `Error reading messages: ${error instanceof Error ? error.message : String(error)}`;
      }
    },

    channel_members: async (input) => {
      const manager = getChannelsManager();
      if (!manager) {
        return 'Error: Channels are not enabled or configured.';
      }

      const channel = String(input.channel || '').trim();
      if (!channel) return 'Error: Channel name or ID is required.';

      try {
        const ch = manager.getChannel(channel);
        if (!ch) {
          return `Channel "${channel}" not found.`;
        }

        const members = manager.getMembers(channel);
        if (members.length === 0) {
          return `No members in #${ch.name}.`;
        }

        const lines: string[] = [];
        lines.push(`## #${ch.name} Members (${members.length})`);
        lines.push('');

        for (const member of members) {
          const roleTag = member.role === 'owner' ? ' (owner)' : '';
          const typeTag = member.memberType === 'person' ? ' [person]' : '';
          const joined = new Date(member.joinedAt).toLocaleDateString();
          lines.push(`- **${member.assistantName}**${roleTag}${typeTag} — joined ${joined}`);
        }

        return lines.join('\n');
      } catch (error) {
        return `Error listing members: ${error instanceof Error ? error.message : String(error)}`;
      }
    },

    channel_invite: async (input) => {
      const manager = getChannelsManager();
      if (!manager) {
        return 'Error: Channels are not enabled or configured.';
      }

      const channel = String(input.channel || '').trim();
      const name = String(input.name || input.assistant || '').trim();
      const memberType = (input.type === 'person' ? 'person' : 'assistant') as 'person' | 'assistant';

      if (!channel) return 'Error: Channel name or ID is required.';
      if (!name) return 'Error: Name is required.';

      const result = manager.invite(channel, name, name, memberType);
      return result.success ? result.message : `Error: ${result.message}`;
    },
  };
}

/**
 * All channel tools
 */
export const channelTools: Tool[] = [
  channelListTool,
  channelJoinTool,
  channelLeaveTool,
  channelSendTool,
  channelReadTool,
  channelMembersTool,
  channelInviteTool,
];

/**
 * Register channel tools with a tool registry
 */
export function registerChannelTools(
  registry: ToolRegistry,
  getChannelsManager: () => ChannelsManager | null
): void {
  const executors = createChannelToolExecutors(getChannelsManager);

  for (const tool of channelTools) {
    registry.register(tool, executors[tool.name]);
  }
}
