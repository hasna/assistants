/**
 * Channels module exports
 * Provides Slack-like channel collaboration for agents and people
 */

// Core manager
export { ChannelsManager, createChannelsManager } from './manager';
export type { ChannelsManagerOptions } from './manager';

// Agent pool for multi-agent channel responses
export { ChannelAgentPool } from './agent-pool';

// Store
export { ChannelStore } from './store';

// Mentions
export { parseMentions, resolveMentions, getMentionedMemberIds, resolveNameToKnown } from './mentions';

// Tools
export {
  channelTools,
  channelListTool,
  channelJoinTool,
  channelLeaveTool,
  channelSendTool,
  channelReadTool,
  channelMembersTool,
  channelInviteTool,
  createChannelToolExecutors,
  registerChannelTools,
} from './tools';

// Types
export type {
  Channel,
  ChannelMember,
  ChannelMessage,
  ChannelListItem,
  ChannelOperationResult,
  ChannelStatus,
  ChannelMemberRole,
  ChannelsConfig,
  ChannelsInjectionConfig,
  ChannelsStorageConfig,
  MemberType,
} from './types';
