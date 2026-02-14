import type { Tool, TokenUsage, EnergyState, VoiceState, HeartbeatState, HeartbeatConfig, HookConfig, BudgetConfig, GuardrailsConfigShared } from '@hasna/assistants-shared';
import type { BudgetScope, BudgetSummary } from '../budget/types';
import type { GuardrailsConfig, GuardrailsPolicy, PolicyAction } from '../guardrails/types';
import type { RecordOptions } from '../voice/recorder';
import type { ErrorStats } from '../errors';
import type { ContextInfo, ContextProcessResult } from '../context';
import type { AssistantManager, IdentityManager } from '../identity';
import type { PeopleManager } from '../people';
import type { InboxManager } from '../inbox';
import type { WalletManager } from '../wallet';
import type { SecretsManager } from '../secrets';
import type { MessagesManager } from '../messages';
import type { WebhooksManager } from '../webhooks';
import type { ChannelsManager, ChannelAgentPool } from '../channels';
import type { TelephonyManager } from '../telephony';
import type { OrdersManager } from '../orders';
import type { GlobalMemoryManager } from '../memory';
import type { SwarmCoordinator } from '../swarm';
import type { JobManager } from '../jobs/job-manager';

// Re-export TokenUsage from shared
export type { TokenUsage } from '@hasna/assistants-shared';

/**
 * Command definition loaded from a markdown file
 */
export interface Command {
  /** Command name (derived from filename or frontmatter) */
  name: string;
  /** Alias names for backwards compatibility */
  aliases?: string[];
  /** Human-readable description */
  description: string;
  /** Optional tags for categorization */
  tags?: string[];
  /** Allowed tools for this command (restricts available tools) */
  allowedTools?: string[];
  /** Whether this is a built-in command */
  builtin?: boolean;
  /** The markdown content/instructions */
  content: string;
  /** Source file path (for custom commands) */
  filePath?: string;
  /** Whether the command handles its own execution (doesn't go to LLM) */
  selfHandled?: boolean;
  /** Handler function for self-handled commands */
  handler?: (args: string, context: CommandContext) => Promise<CommandResult>;
}

/**
 * Command frontmatter from markdown files
 */
export interface CommandFrontmatter {
  name?: string;
  description?: string;
  tags?: string[];
  'allowed-tools'?: string;
  [key: string]: unknown;
}

/**
 * Connector info for command context
 */
export interface ConnectorInfo {
  name: string;
  description: string;
  cli: string;
  commands: Array<{ name: string; description: string }>;
}

/**
 * Context passed to command handlers
 */
export interface CommandContext {
  cwd: string;
  sessionId: string;
  messages: Array<{ role: string; content: string }>;
  tools: Tool[];
  skills: Array<{ name: string; description: string; argumentHint?: string }>;
  connectors: ConnectorInfo[];
  getErrorStats?: () => ErrorStats[];
  getContextInfo?: () => ContextInfo | null;
  summarizeContext?: () => Promise<ContextProcessResult>;
  getModel?: () => string | undefined;
  getStorageDir?: () => string;
  getWorkspaceId?: () => string | null;
  getEnergyState?: () => EnergyState | null;
  getVoiceState?: () => VoiceState | null;
  getHeartbeatState?: () => HeartbeatState | null;
  getHeartbeatConfig?: () => HeartbeatConfig | null;
  enableVoice?: () => void;
  disableVoice?: () => void;
  speak?: (text: string) => Promise<void>;
  listen?: (options?: RecordOptions) => Promise<string>;
  stopSpeaking?: () => void;
  stopListening?: () => void;
  talk?: (options: {
    onTranscript: (text: string) => void;
    onPartialTranscript?: (text: string) => void;
    onResponse: (text: string) => void;
    sendMessage: (text: string) => Promise<string>;
    waitForConfirm?: (text: string) => Promise<boolean>;
  }) => Promise<void>;
  stopTalking?: () => void;
  processForTalk?: (text: string) => Promise<string>;
  getAutoSend?: () => boolean;
  setAutoSend?: (enabled: boolean) => void;
  getAssistantManager?: () => AssistantManager | null;
  getIdentityManager?: () => IdentityManager | null;
  getPeopleManager?: () => PeopleManager | null;
  getInboxManager?: () => InboxManager | null;
  getWalletManager?: () => WalletManager | null;
  getSecretsManager?: () => SecretsManager | null;
  getMessagesManager?: () => MessagesManager | null;
  getWebhooksManager?: () => WebhooksManager | null;
  getChannelsManager?: () => ChannelsManager | null;
  getChannelAgentPool?: () => ChannelAgentPool | null;
  getTelephonyManager?: () => TelephonyManager | null;
  getOrdersManager?: () => OrdersManager | null;
  getJobManager?: () => JobManager | null;
  getMemoryManager?: () => GlobalMemoryManager | null;
  getHooks?: () => HookConfig;
  setHookEnabled?: (hookId: string, enabled: boolean) => Promise<boolean>;
  refreshIdentityContext?: () => Promise<void>;
  refreshSkills?: () => Promise<void>;
  switchAssistant?: (assistantId: string) => Promise<void>;
  switchIdentity?: (identityId: string) => Promise<void>;
  switchModel?: (modelId: string) => Promise<void>;
  getActiveProjectId?: () => string | null;
  setActiveProjectId?: (projectId: string | null) => void;
  setProjectContext?: (content: string | null) => void;
  restEnergy?: (amount?: number) => void;
  refreshConnectors?: () => Promise<{ count: number; names: string[] }>;
  budgetConfig?: BudgetConfig;
  getBudgetSummary?: () => BudgetSummary | null;
  setBudgetConfig?: (config: BudgetConfig) => void;
  setBudgetEnabled?: (enabled: boolean) => void;
  resetBudget?: (scope?: BudgetScope) => void;
  resumeBudget?: () => void;
  guardrailsConfig?: GuardrailsConfig;
  setGuardrailsEnabled?: (enabled: boolean) => void;
  addGuardrailsPolicy?: (policy: GuardrailsPolicy) => void;
  removeGuardrailsPolicy?: (policyId: string) => void;
  setGuardrailsDefaultAction?: (action: PolicyAction) => void;
  getSwarmCoordinator?: () => SwarmCoordinator | null;
  clearMessages: () => void;
  addSystemMessage: (content: string) => void;
  emit: (type: 'text' | 'done' | 'error' | 'partial_transcript', content?: string) => void;
}

/**
 * Result from command execution
 */
export interface CommandResult {
  /** Whether the command was handled (true = don't send to LLM) */
  handled: boolean;
  /** Optional message to display to user */
  message?: string;
  /** Optional prompt to send to LLM instead */
  prompt?: string;
  /** Whether to clear the conversation */
  clearConversation?: boolean;
  /** Whether to exit the application */
  exit?: boolean;
  /** Session action to perform */
  sessionAction?: 'list' | 'switch' | 'new' | 'assign' | 'rename';
  /** Session number to switch to (1-based) */
  sessionNumber?: number;
  /** Label for new session */
  sessionLabel?: string;
  /** Agent name/ID to assign to session */
  sessionAgent?: string;
  /** Panel to show (terminal-specific interactive UIs) */
  showPanel?: 'connectors' | 'projects' | 'plans' | 'tasks' | 'assistants' | 'hooks' | 'config' | 'messages' | 'guardrails' | 'budget' | 'model' | 'schedules' | 'wallet' | 'secrets' | 'identity' | 'memory' | 'inbox' | 'swarm' | 'workspace' | 'logs' | 'skills' | 'heartbeat' | 'resume' | 'webhooks' | 'channels' | 'telephony' | 'orders' | 'contacts' | 'setup' | 'people';
  /** Initial value for panel (e.g., connector name) */
  panelValue?: string;
}
