import type { LLMProvider } from './llm-providers';

// ============================================
// Message Types
// ============================================

export type MessageRole = 'user' | 'assistant' | 'system';

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: number;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
  documents?: DocumentAttachment[];
}

// ============================================
// Document Types (PDF support)
// ============================================

export interface DocumentAttachment {
  type: 'pdf' | 'image';
  source: DocumentSource;
  name?: string;
  mediaType?: string;
}

export type DocumentSource =
  | { type: 'base64'; mediaType: string; data: string }
  | { type: 'url'; url: string }
  | { type: 'file'; fileId: string };

export interface StreamChunk {
  type: 'text' | 'tool_use' | 'tool_result' | 'error' | 'done' | 'usage' | 'exit' | 'show_panel' | 'stopped' | 'partial_transcript';
  content?: string;
  toolCall?: ToolCall;
  toolResult?: ToolResult;
  error?: string;
  usage?: TokenUsage;
  /** Panel to show (for 'show_panel' type) */
  panel?: 'connectors' | 'projects' | 'plans' | 'tasks' | 'assistants' | 'hooks' | 'config' | 'messages' | 'guardrails' | 'budget' | 'model' | 'schedules' | 'wallet' | 'secrets' | 'identity' | 'memory' | 'inbox' | 'swarm' | 'workspace' | 'logs' | 'skills' | 'heartbeat' | 'resume' | 'webhooks' | 'channels' | 'telephony' | 'orders' | 'contacts' | 'setup' | 'people';
  /** Initial value for the panel */
  panelValue?: string;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  maxContextTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

// ============================================
// Tool Types
// ============================================

export interface Tool {
  name: string;
  description: string;
  parameters: ToolParameters;
}

export interface ToolParameters {
  type: 'object';
  properties: Record<string, ToolProperty>;
  required?: string[];
}

type ToolPropertyType = 'string' | 'number' | 'boolean' | 'array' | 'object';

export interface ToolProperty {
  type: ToolPropertyType | ToolPropertyType[];
  description: string;
  enum?: string[];
  items?: ToolProperty;
  default?: unknown;
  /** For object types: nested properties */
  properties?: Record<string, ToolProperty>;
  /** For object types: required property names */
  required?: string[];
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  content: string;
  rawContent?: string;
  truncated?: boolean;
  isError?: boolean;
  toolName?: string;
}

export interface AskUserQuestion {
  id: string;
  question: string;
  options?: string[];
  placeholder?: string;
  multiline?: boolean;
  required?: boolean;
}

export interface AskUserRequest {
  title?: string;
  description?: string;
  questions: AskUserQuestion[];
}

export interface AskUserResponse {
  answers: Record<string, string>;
}

// ============================================
// Interview Types (rich multi-step wizard)
// ============================================

export interface InterviewOption {
  label: string;
  description?: string;
}

export interface InterviewQuestion {
  id: string;
  question: string;
  header?: string;
  options?: InterviewOption[];
  placeholder?: string;
  multiSelect?: boolean;
  required?: boolean;
}

export interface InterviewRequest {
  title?: string;
  description?: string;
  questions: InterviewQuestion[];
  metadata?: Record<string, unknown>;
}

export interface InterviewResponse {
  answers: Record<string, string | string[]>;
  cancelled?: boolean;
  chatRequested?: boolean;
  chatMessage?: string;
}

export interface InterviewRecord {
  id: string;
  sessionId: string;
  assistantId?: string;
  title?: string;
  questions: InterviewQuestion[];
  answers: Record<string, string | string[]>;
  status: 'pending' | 'completed' | 'cancelled';
  createdAt: number;
  completedAt?: number;
}

// ============================================
// Connector Types
// ============================================

export interface Connector {
  name: string;
  cli: string;
  description: string;
  commands: ConnectorCommand[];
  auth?: ConnectorAuth;
  /** Auto-generated tags derived from commands and description */
  tags?: string[];
  /** Last time this connector was used (ISO timestamp) */
  lastUsedAt?: string;
  /** Usage count for ranking */
  usageCount?: number;
}

export interface ConnectorCommand {
  name: string;
  description: string;
  args: ConnectorArg[];
  options: ConnectorOption[];
  /** Usage examples for the command */
  examples?: string[];
}

export interface ConnectorArg {
  name: string;
  description?: string;
  required?: boolean;
  /** Type hint for the argument */
  type?: string;
  /** Default value if optional */
  default?: string;
}

export interface ConnectorOption {
  name: string;
  description?: string;
  type: 'string' | 'number' | 'boolean';
  default?: unknown;
  alias?: string;
}

/**
 * Extended connector information for interactive UI
 */
export interface ConnectorStatus {
  authenticated: boolean;
  user?: string;
  email?: string;
  error?: string;
}

export interface ConnectorAuth {
  type: 'oauth2' | 'api_key' | 'none';
  statusCommand?: string;
}

// ============================================
// Skill Types
// ============================================

export interface Skill {
  name: string;
  description: string;
  argumentHint?: string;
  allowedTools?: string[];
  disableModelInvocation?: boolean;
  userInvocable?: boolean;
  model?: string;
  context?: 'fork';
  assistant?: string;
  hooks?: HookConfig;
  content: string;
  filePath: string;
  contentLoaded?: boolean;
  source?: 'local' | 'npm';
  packageName?: string;
  version?: string;
}

export interface SkillFrontmatter {
  name?: string;
  description?: string;
  'argument-hint'?: string;
  'allowed-tools'?: string;
  'disable-model-invocation'?: boolean;
  'user-invocable'?: boolean;
  model?: string;
  context?: 'fork';
  assistant?: string;
  hooks?: HookConfig;
  [key: string]: unknown;  // Allow additional properties
}

// ============================================
// Hook Types
// ============================================

export type HookEvent =
  | 'SessionStart'
  | 'SessionEnd'
  | 'UserPromptSubmit'
  | 'PreToolUse'
  | 'PostToolUse'
  | 'PostToolUseFailure'
  | 'PermissionRequest'
  | 'Notification'
  | 'SubassistantStart'
  | 'SubassistantStop'
  | 'PreCompact'
  | 'Stop';

export interface HookConfig {
  [event: string]: HookMatcher[];
}

export interface HookMatcher {
  matcher?: string;
  hooks: HookHandler[];
}

export interface HookHandler {
  id?: string; // Unique ID (auto-generated if not provided)
  name?: string; // Human-readable name
  description?: string; // What this hook does
  enabled?: boolean; // Whether hook is active (default true)
  type: 'command' | 'prompt' | 'assistant';
  command?: string;
  prompt?: string;
  model?: string;
  timeout?: number;
  async?: boolean;
  statusMessage?: string;
}

export interface HookInput {
  session_id: string;
  hook_event_name: HookEvent;
  cwd: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  prompt?: string;
  [key: string]: unknown;
}

export interface HookOutput {
  continue?: boolean;
  stopReason?: string;
  systemMessage?: string;
  additionalContext?: string;
  permissionDecision?: 'allow' | 'deny' | 'ask';
  updatedInput?: Record<string, unknown>;
  suppress?: boolean; // For Notification hook - suppress the notification
  skip?: boolean; // For PreCompact hook - skip the compaction
}

// ============================================
// Native Hook Types
// ============================================

/**
 * Native hook handler function type
 */
export type NativeHookHandler = (
  input: HookInput,
  context: NativeHookContext
) => Promise<HookOutput | null>;

/**
 * Native hook definition - system hooks that cannot be deleted
 */
export interface NativeHook {
  id: string;
  name?: string;
  description?: string;
  event: HookEvent;
  priority: number; // Lower = runs first
  handler: NativeHookHandler;
  enabled?: boolean;
}

/**
 * Context passed to native hooks
 */
export interface NativeHookContext {
  sessionId: string;
  cwd: string;
  messages: Message[];
  scopeContext?: ScopeContext;
  llmClient?: unknown; // LLMClient type from core
  config?: NativeHookConfig;
}

/**
 * Configuration for native hooks
 */
export interface NativeHookConfig {
  scopeVerification?: ScopeVerificationConfig;
  /** Autonomous heartbeat configuration passed to the auto-schedule Stop hook. */
  heartbeat?: {
    autonomous?: boolean;
    maxSleepMs?: number;
    watchdogEnabled?: boolean;
    watchdogIntervalMs?: number;
  };
}

/**
 * Configuration for scope verification feature
 */
export interface ScopeVerificationConfig {
  enabled?: boolean;
  maxRetries?: number;
  excludePatterns?: string[];
}

// ============================================
// Scope Context Types
// ============================================

/**
 * Tracks user's intent/goals for the current session
 */
export interface ScopeContext {
  originalMessage: string;
  extractedGoals: string[];
  timestamp: number;
  verificationAttempts: number;
  maxAttempts: number;
}

// ============================================
// Verification Session Types
// ============================================

/**
 * Goal analysis result from verification
 */
export interface GoalAnalysis {
  goal: string;
  met: boolean;
  evidence: string;
}

/**
 * Result of scope verification
 */
export interface VerificationResult {
  goalsMet: boolean;
  goalsAnalysis: GoalAnalysis[];
  reason: string;
  suggestions?: string[];
}

/**
 * Stored verification session for user visibility
 */
export interface VerificationSession {
  id: string;
  parentSessionId: string;
  type: 'scope-verification';
  result: 'pass' | 'fail' | 'force-continue';
  goals: string[];
  reason: string;
  suggestions?: string[];
  verificationResult: VerificationResult;
  createdAt: string;
}

// ============================================
// Session Types
// ============================================

export interface Session {
  id: string;
  createdAt: number;
  updatedAt: number;
  messages: Message[];
  metadata?: Record<string, unknown>;
}

// ============================================
// Multi-Session Types
// ============================================

export interface SessionInfo {
  id: string;
  cwd: string;
  startedAt: number;
  updatedAt: number;
  isProcessing: boolean;
}

// ============================================
// Config Types
// ============================================

/**
 * Status line configuration for terminal UI
 * Controls which metrics are shown in the bottom status bar
 */
export interface StatusLineConfig {
  /** Show context usage percentage (default: true) */
  showContext?: boolean;
  /** Show session index when multiple sessions exist (default: true) */
  showSession?: boolean;
  /** Show processing elapsed time (default: true) */
  showElapsed?: boolean;
  /** Show heartbeat indicator (default: true) */
  showHeartbeat?: boolean;
  /** Show voice indicator (default: true) */
  showVoice?: boolean;
  /** Show queue length (default: true) */
  showQueue?: boolean;
  /** Show recent tool calls (default: true) */
  showRecentTools?: boolean;
  /** Show verbose tool names (default: false) */
  verboseTools?: boolean;
}

export interface AssistantsConfig {
  llm: LLMConfig;
  voice?: VoiceConfig;
  connectors?: string[] | ConnectorsConfigShared;
  skills?: string[];
  hooks?: HookConfig;
  scheduler?: SchedulerConfig;
  heartbeat?: HeartbeatConfig;
  context?: ContextConfig;
  energy?: EnergyConfig;
  validation?: ValidationConfig;
  inbox?: InboxConfig;
  wallet?: WalletConfig;
  secrets?: SecretsConfig;
  jobs?: JobsConfig;
  messages?: MessagesConfig;
  webhooks?: WebhooksConfig;
  channels?: ChannelsConfig;
  telephony?: TelephonyConfig;
  orders?: OrdersConfig;
  memory?: MemoryConfigShared;
  subassistants?: SubassistantConfigShared;
  input?: InputConfig;
  budget?: BudgetConfig;
  guardrails?: GuardrailsConfigShared;
  capabilities?: CapabilitiesConfigShared;
  statusLine?: StatusLineConfig;
}

/**
 * Budget configuration for resource limits
 * Controls token, time, and tool-call limits per session/assistant/swarm
 */
export interface BudgetConfig {
  /** Whether budget enforcement is enabled (default: false) */
  enabled?: boolean;
  /** Session-level limits */
  session?: BudgetLimits;
  /** Per-assistant limits (for multi-assistant scenarios) */
  assistant?: BudgetLimits;
  /** Swarm-level limits (aggregate across all assistants) */
  swarm?: BudgetLimits;
  /** Per-project limits (aggregate across sessions for a project) */
  project?: BudgetLimits;
  /** Action to take when budget is exceeded */
  onExceeded?: 'warn' | 'pause' | 'stop';
  /** Whether to persist budget state across restarts */
  persist?: boolean;
}

/**
 * Budget limits specification
 */
export interface BudgetLimits {
  /** Maximum input tokens per period */
  maxInputTokens?: number;
  /** Maximum output tokens per period */
  maxOutputTokens?: number;
  /** Maximum total tokens per period */
  maxTotalTokens?: number;
  /** Maximum LLM API calls per period */
  maxLlmCalls?: number;
  /** Maximum tool calls per period */
  maxToolCalls?: number;
  /** Maximum execution time in milliseconds per period */
  maxDurationMs?: number;
  /** Period for rolling limits (e.g., 'session', 'hour', 'day') */
  period?: 'session' | 'hour' | 'day';
}

/**
 * Budget usage tracking state
 */
export interface BudgetUsage {
  /** Input tokens consumed */
  inputTokens: number;
  /** Output tokens consumed */
  outputTokens: number;
  /** Total tokens consumed */
  totalTokens: number;
  /** Number of LLM API calls */
  llmCalls: number;
  /** Number of tool calls */
  toolCalls: number;
  /** Execution time in milliseconds */
  durationMs: number;
  /** When the current period started */
  periodStartedAt: string;
  /** When usage was last updated */
  lastUpdatedAt: string;
}

/**
 * Input handling configuration
 * Controls how large pastes and input are handled in terminal and web UIs
 */
export interface InputConfig {
  /** Paste handling settings */
  paste?: PasteConfig;
}

/**
 * Paste handling configuration
 */
export interface PasteConfig {
  /** Whether large paste handling is enabled (default: true) */
  enabled?: boolean;
  /** Paste detection thresholds */
  thresholds?: {
    /** Character threshold for large paste detection (default: 500) */
    chars?: number;
    /** Word threshold for large paste detection (default: 100) */
    words?: number;
    /** Line threshold for large paste detection (default: 20) */
    lines?: number;
  };
  /**
   * Display mode when large paste is detected
   * - 'placeholder': Show summary placeholder (default)
   * - 'preview': Show collapsed preview with expand option
   * - 'confirm': Ask user to confirm before accepting
   * - 'inline': No special handling, show full content
   */
  mode?: 'placeholder' | 'preview' | 'confirm' | 'inline';
}

/**
 * Guardrails configuration for security and safety policies
 * Controls tool access, data sensitivity, and approval requirements
 */
export interface GuardrailsConfigShared {
  /** Whether guardrails enforcement is enabled (default: false) */
  enabled?: boolean;
  /** Default action when no policy matches */
  defaultAction?: 'allow' | 'deny' | 'require_approval' | 'warn';
  /** Whether to log all policy evaluations */
  logEvaluations?: boolean;
  /** Whether to persist policy state */
  persist?: boolean;
}

/**
 * Capabilities configuration for assistant permissions and limits
 * Controls orchestration rights, tool access, and resource constraints
 */
export interface CapabilitiesConfigShared {
  /** Whether capability enforcement is enabled (default: false) */
  enabled?: boolean;
  /** Orchestration level preset: 'none' | 'limited' | 'standard' | 'full' | 'coordinator' */
  orchestrationLevel?: 'none' | 'limited' | 'standard' | 'full' | 'coordinator';
  /** Maximum concurrent subassistants this assistant can spawn */
  maxConcurrentSubassistants?: number;
  /** Maximum subassistant depth (nesting level) */
  maxSubassistantDepth?: number;
  /** Tool access policy: 'allow_all' | 'allow_list' | 'deny_list' */
  toolPolicy?: 'allow_all' | 'allow_list' | 'deny_list';
  /** Allowed tool patterns (when policy is 'allow_list') */
  allowedTools?: string[];
  /** Denied tool patterns (when policy is 'deny_list') */
  deniedTools?: string[];
  /** Whether to persist capability state */
  persist?: boolean;
}

/**
 * Connectors configuration for AssistantsConfig
 * Controls how connector tools are registered and exposed to the LLM
 */
export interface ConnectorsConfigShared {
  /** List of connector names to enable (empty = auto-discover all) */
  enabled?: string[];
  /**
   * Maximum number of connector tools to register in LLM context.
   * When exceeded, only `connector_execute` and `connectors_search` are available.
   * Set to 0 for unlimited (default behavior).
   * Recommended: 5-10 for optimal context usage.
   * Default: 0 (unlimited)
   */
  maxToolsInContext?: number;
  /**
   * Whether to use dynamic binding (register tools on demand after search).
   * When true, connector tools are only registered after user explicitly
   * selects them via connectors_search or connector tool name.
   * Default: false
   */
  dynamicBinding?: boolean;
  /**
   * Priority connectors that are always registered regardless of limit.
   * These connectors will have their tools available immediately.
   */
  priorityConnectors?: string[];
}

/**
 * Subassistant configuration for AssistantsConfig (shared types)
 * Controls limits and behavior of spawned subassistants
 */
export interface SubassistantConfigShared {
  /** Maximum recursion depth for nested subassistants (default: 3) */
  maxDepth?: number;
  /** Maximum concurrent subassistants per parent (default: 5) */
  maxConcurrent?: number;
  /** Maximum turns per subassistant (default: 10, max: 25) */
  maxTurns?: number;
  /** Default timeout in milliseconds (default: 120000 = 2 minutes) */
  defaultTimeoutMs?: number;
  /** Default tools for subassistants if not specified */
  defaultTools?: string[];
  /** Tools that subassistants cannot use (security) */
  forbiddenTools?: string[];
}

/**
 * Memory configuration for AssistantsConfig (shared types)
 */
export interface MemoryConfigShared {
  /** Whether memory system is enabled (default: true) */
  enabled?: boolean;
  /** Memory injection settings */
  injection?: {
    /** Whether auto-injection is enabled (default: true) */
    enabled?: boolean;
    /** Maximum tokens for injected memories (default: 500) */
    maxTokens?: number;
    /** Minimum importance to include (default: 5) */
    minImportance?: number;
    /** Categories to include (default: ['preference', 'fact']) */
    categories?: ('preference' | 'fact' | 'knowledge' | 'history')[];
    /** Refresh interval in turns (default: 5) */
    refreshInterval?: number;
  };
  /** Storage settings */
  storage?: {
    /** Maximum number of memory entries (default: 1000) */
    maxEntries?: number;
    /** Default TTL in milliseconds for new entries */
    defaultTTL?: number;
  };
  /** Scope settings */
  scopes?: {
    /** Whether global scope is enabled (default: true) */
    globalEnabled?: boolean;
    /** Whether shared scope is enabled (default: true) */
    sharedEnabled?: boolean;
    /** Whether private scope is enabled (default: true) */
    privateEnabled?: boolean;
  };
}

export interface LLMConfig {
  provider?: LLMProvider;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  maxTokens?: number;
}

export interface VoiceConfig {
  enabled: boolean;
  stt: STTConfig;
  tts: TTSConfig;
  wake?: WakeConfig;
  autoListen?: boolean;
  /** Whether to auto-send messages after silence in talk mode (default: true) */
  autoSend?: boolean;
}

export interface STTConfig {
  provider: 'whisper' | 'elevenlabs' | 'system';
  model?: string;
  language?: string;
}

export interface TTSConfig {
  provider: 'elevenlabs' | 'system';
  voiceId?: string;
  model?: string;
  stability?: number;
  similarityBoost?: number;
  speed?: number;
}

export interface WakeConfig {
  enabled: boolean;
  word: string;
}

export interface VoiceState {
  enabled: boolean;
  isSpeaking: boolean;
  isListening: boolean;
  isTalking: boolean;
  sttProvider?: string;
  ttsProvider?: string;
}

export type HeartbeatAssistantState = 'idle' | 'processing' | 'waiting_input' | 'error' | 'stopped';

export interface HeartbeatState {
  enabled: boolean;
  state: HeartbeatAssistantState;
  lastActivity: string;
  uptimeSeconds: number;
  isStale: boolean;
  /** Interval in ms between heartbeats (if available). */
  intervalMs?: number;
  /** ISO timestamp for the next planned heartbeat (if available). */
  nextHeartbeatAt?: string;
}

// ============================================
// Identity & Assistant Types
// ============================================

export type AssistantBackend = 'native' | 'claude-agent-sdk' | 'codex-sdk';

export interface AssistantSettings {
  model: string;
  maxTokens?: number;
  temperature?: number;
  systemPromptAddition?: string;
  enabledTools?: string[];
  disabledTools?: string[];
  skillDirectories?: string[];
  backend?: AssistantBackend;
}

export interface Assistant {
  id: string;
  name: string;
  description?: string;
  avatar?: string;
  /** Theme color for the assistant (e.g., 'cyan', 'green', '#ff6600') */
  color?: string;
  defaultIdentityId?: string;
  settings: AssistantSettings;
  isSystem?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ContactEntry {
  value: string;
  label: string;
  isPrimary?: boolean;
}

export interface AddressEntry {
  street: string;
  city: string;
  state?: string;
  postalCode: string;
  country: string;
  label: string;
}

export interface SocialEntry {
  platform: string;
  value: string;
  label?: string;
}

export interface IdentityProfile {
  displayName: string;
  title?: string;
  company?: string;
  bio?: string;
  timezone: string;
  locale: string;
}

export interface IdentityContacts {
  emails: ContactEntry[];
  phones: ContactEntry[];
  addresses: AddressEntry[];
  virtualAddresses?: ContactEntry[];
  social?: SocialEntry[];
}

export interface IdentityPreferences {
  language: string;
  dateFormat: string;
  communicationStyle: 'formal' | 'casual' | 'professional';
  responseLength: 'concise' | 'detailed' | 'balanced';
  codeStyle?: {
    indentation: 'tabs' | 'spaces';
    indentSize: number;
    quoteStyle: 'single' | 'double';
  };
  custom: Record<string, unknown>;
}

export interface Identity {
  id: string;
  name: string;
  isDefault: boolean;
  profile: IdentityProfile;
  contacts: IdentityContacts;
  preferences: IdentityPreferences;
  context?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ActiveIdentityInfo {
  assistant: Assistant | null;
  identity: Identity | null;
}

export interface SchedulerConfig {
  enabled?: boolean;
  heartbeatIntervalMs?: number;
}

// ============================================
// Jobs Types (async job system)
// ============================================

/**
 * Per-connector job configuration
 */
export interface ConnectorJobConfig {
  /** Whether async mode is enabled for this connector */
  enabled?: boolean;
  /** Custom timeout for this connector (ms) */
  timeoutMs?: number;
}

/**
 * Jobs system configuration
 */
export interface JobsConfig {
  /** Whether jobs system is enabled (default: true) */
  enabled?: boolean;
  /** Default timeout for jobs in ms (default: 60000 = 1 minute) */
  defaultTimeoutMs?: number;
  /** Maximum age for job files in ms (default: 86400000 = 24 hours) */
  maxJobAgeMs?: number;
  /** Per-connector configuration */
  connectors?: Record<string, ConnectorJobConfig>;
}

export interface HeartbeatConfig {
  enabled?: boolean;
  intervalMs?: number;
  staleThresholdMs?: number;
  persistPath?: string;
  historyPath?: string;
  /** Enable autonomous self-scheduling (default: false). */
  autonomous?: boolean;
  /** Maximum ms the agent can sleep between heartbeats. */
  maxSleepMs?: number;
  /** Enable the watchdog safety-net schedule (default: false). */
  watchdogEnabled?: boolean;
  /** Watchdog polling interval in ms. */
  watchdogIntervalMs?: number;
}

export interface ContextConfig {
  enabled?: boolean;
  maxContextTokens?: number;
  targetContextTokens?: number;
  summaryTriggerRatio?: number;
  keepRecentMessages?: number;
  keepSystemPrompt?: boolean;
  summaryStrategy?: 'llm' | 'hybrid';
  summaryModel?: string;
  summaryMaxTokens?: number;
  maxMessages?: number;
  /**
   * Number of recent tool calls to always preserve during summarization.
   * Ensures the assistant remembers what it just did and can continue
   * multi-step operations after context compaction.
   * Default: 5
   */
  preserveLastToolCalls?: number;
  /**
   * Configuration for automatic context injection (datetime, cwd, etc.)
   */
  injection?: ContextInjectionConfigShared;
}

/**
 * Context injection configuration (shared types)
 */
export interface ContextInjectionConfigShared {
  /** Whether context injection is enabled (default: true) */
  enabled?: boolean;
  /** Maximum tokens for injected context (default: 200) */
  maxTokens?: number;
  /** Output format: "full" for markdown sections, "compact" for single line */
  format?: 'full' | 'compact';
  /** Individual injection type configurations */
  injections?: {
    datetime?: { enabled?: boolean; format?: 'ISO' | 'relative' | 'short'; includeTimezone?: boolean };
    timezone?: { enabled?: boolean };
    cwd?: { enabled?: boolean; truncate?: number };
    project?: { enabled?: boolean; includePackageJson?: boolean; includeGitInfo?: boolean };
    os?: { enabled?: boolean };
    locale?: { enabled?: boolean };
    git?: { enabled?: boolean; includeBranch?: boolean; includeStatus?: boolean; includeRecentCommits?: number };
    username?: { enabled?: boolean };
    custom?: { enabled?: boolean; text?: string };
    envVars?: { enabled?: boolean; allowed?: string[] };
  };
}

export interface EnergyCosts {
  message: number;
  toolCall: number;
  llmCall: number;
  longContext: number;
}

export interface EnergyConfig {
  enabled?: boolean;
  costs?: Partial<EnergyCosts>;
  regenRate?: number;
  lowEnergyThreshold?: number;
  criticalThreshold?: number;
  maxEnergy?: number;
}

export interface EnergyState {
  current: number;
  max: number;
  regenRate: number;
  lastUpdate: string;
}

export interface ValidationConfig {
  mode?: 'strict' | 'lenient';
  maxUserMessageLength?: number;
  maxToolOutputLength?: number;
  maxTotalContextTokens?: number;
  maxFileReadSize?: number;
  perTool?: Record<string, {
    mode?: 'strict' | 'lenient';
    maxOutputLength?: number;
    allowEnv?: boolean;
    allowAll?: boolean;
    /** Allow limited global package installs via bun (e.g., bun install -g connect-*) */
    allowPackageInstall?: boolean;
  }>;
}

// ============================================
// Scheduler Types
// ============================================

export interface ScheduledCommand {
  id: string;
  createdAt: number;
  updatedAt: number;
  createdBy: 'user' | 'assistant';
  sessionId?: string;
  /** Type of action to perform when the schedule fires */
  actionType?: 'command' | 'message';
  /** Command to execute (used when actionType is 'command' or undefined for backwards compatibility) */
  command: string;
  /** Custom message to inject into assistant session (used when actionType is 'message') */
  message?: string;
  description?: string;
  status: 'active' | 'paused' | 'completed' | 'error';
  schedule: {
    kind: 'once' | 'cron' | 'random' | 'interval';
    at?: string;
    cron?: string;
    timezone?: string;
    /** For random schedules: minimum interval */
    minInterval?: number;
    /** For random schedules: maximum interval */
    maxInterval?: number;
    /** For random and interval schedules: interval unit (supports sub-minute with 'seconds') */
    unit?: 'seconds' | 'minutes' | 'hours';
    /** For interval schedules: fixed interval value (minimum 1 second) */
    interval?: number;
  };
  nextRunAt?: number;
  lastRunAt?: number;
  lastResult?: {
    ok: boolean;
    summary?: string;
    error?: string;
  };
}

// ============================================
// Client Types
// ============================================

export interface AssistantClient {
  send(message: string): Promise<void>;
  onChunk(callback: (chunk: StreamChunk) => void): void | (() => void);
  onError(callback: (error: Error) => void): void | (() => void);
  getTools(): Promise<Tool[]>;
  getSkills(): Promise<Skill[]>;
  getEnergyState(): EnergyState | null;
  getVoiceState(): VoiceState | null;
  getIdentityInfo(): ActiveIdentityInfo | null;
  getModel(): string | null;
  stop(): void;
  disconnect(): void;
}

// ============================================
// Inbox Types
// ============================================

/**
 * Configuration for assistant inbox feature
 */
export interface InboxConfig {
  /** Whether inbox is enabled (default: false) */
  enabled?: boolean;
  /** Email provider: 'ses' or 'resend' (default: 'ses') */
  provider?: 'ses' | 'resend';
  /** Email domain (e.g., "mail.example.com") */
  domain?: string;
  /** Email address format (default: "{assistant-name}@{domain}") */
  addressFormat?: string;

  /** S3 storage configuration */
  storage?: {
    /** S3 bucket name */
    bucket: string;
    /** AWS region */
    region: string;
    /** S3 prefix (default: "inbox/") */
    prefix?: string;
    /** AWS credentials profile for cross-account access */
    credentialsProfile?: string;
  };

  /** Amazon SES specific configuration */
  ses?: {
    /** SES region if different from storage region */
    region?: string;
    /** SES receipt rule set name */
    ruleSetName?: string;
    /** AWS credentials profile for SES (if different from storage) */
    credentialsProfile?: string;
  };

  /** Resend specific configuration */
  resend?: {
    /** Environment variable name for API key (default: "RESEND_API_KEY") */
    apiKeyEnvVar?: string;
  };

  /** Local cache configuration */
  cache?: {
    /** Whether caching is enabled (default: true) */
    enabled?: boolean;
    /** Maximum age for cached emails in days (default: 30) */
    maxAgeDays?: number;
    /** Maximum cache size in MB (default: 500) */
    maxSizeMb?: number;
  };
}

// ============================================
// Wallet Types
// ============================================

/**
 * Configuration for assistant wallet (payment card storage)
 *
 * Cards can be stored locally (default) or in AWS Secrets Manager.
 */
export interface WalletConfig {
  /** Whether wallet is enabled (default: false) */
  enabled?: boolean;

  /** Storage backend selection */
  storage?: {
    /** Storage provider (default: "local") */
    provider?: 'local' | 'aws';
  };

  /** AWS Secrets Manager configuration */
  secrets?: {
    /** AWS region for Secrets Manager */
    region: string;
    /** Secret name prefix (default: "assistants/wallet/") */
    prefix?: string;
    /** AWS credentials profile for cross-account access */
    credentialsProfile?: string;
  };

  /** Security settings */
  security?: {
    /** Maximum card reads per hour (default: 10) */
    maxReadsPerHour?: number;
  };
}

// ============================================
// Secrets Types
// ============================================

/**
 * Configuration for assistant secrets management (API keys, tokens, passwords)
 *
 * Secrets can be stored locally (default) or in AWS Secrets Manager.
 */
export interface SecretsConfig {
  /** Whether secrets management is enabled (default: false) */
  enabled?: boolean;

  /** Storage backend configuration */
  storage?: {
    /** Storage provider (default: "local") */
    provider?: 'local' | 'aws';
    /** AWS region for Secrets Manager (required when provider is "aws") */
    region?: string;
    /** Secret name prefix (default: "assistants/secrets/") */
    prefix?: string;
    /** AWS credentials profile for cross-account access */
    credentialsProfile?: string;
  };

  /** Security settings */
  security?: {
    /** Maximum secret reads per hour (default: 100) */
    maxReadsPerHour?: number;
  };
}

// ============================================
// Messages Types (Assistant-to-Assistant)
// ============================================

/**
 * Message priority level
 */
export type MessagePriority = 'low' | 'normal' | 'high' | 'urgent';

/**
 * Messages injection configuration
 */
export interface MessagesInjectionConfig {
  /** Whether to auto-inject messages at turn start (default: true) */
  enabled?: boolean;
  /** Max messages to inject per turn (default: 5) */
  maxPerTurn?: number;
  /** Only inject messages >= this priority (default: 'low') */
  minPriority?: MessagePriority;
}

/**
 * Messages storage configuration
 */
export interface MessagesStorageConfig {
  /** Base path for storage (default: ~/.assistants/messages) */
  basePath?: string;
  /** Max messages per inbox (default: 1000) */
  maxMessages?: number;
  /** Max message age in days (default: 90) */
  maxAgeDays?: number;
}

/**
 * Configuration for assistant-to-assistant messaging
 */
export interface MessagesConfig {
  /** Whether messages are enabled (default: false) */
  enabled?: boolean;
  /** Auto-injection settings */
  injection?: MessagesInjectionConfig;
  /** Storage settings */
  storage?: MessagesStorageConfig;
}

/**
 * Configuration for webhooks system
 * Enables external apps and connectors to push events to the assistant
 */
export interface WebhooksConfig {
  /** Whether webhooks are enabled (default: false) */
  enabled?: boolean;

  /** Auto-injection settings for webhook events */
  injection?: {
    /** Auto-inject events at turn start (default: true) */
    enabled?: boolean;
    /** Max events to inject per turn (default: 5) */
    maxPerTurn?: number;
  };

  /** Storage settings */
  storage?: {
    /** Base path (default: ~/.assistants/webhooks) */
    basePath?: string;
    /** Max events to retain per webhook (default: 1000) */
    maxEvents?: number;
    /** Max event age in days (default: 30) */
    maxAgeDays?: number;
  };

  /** Security settings */
  security?: {
    /** Max timestamp age in milliseconds for replay protection (default: 300000 = 5 min) */
    maxTimestampAgeMs?: number;
    /** Rate limit: max events per webhook per minute (default: 60) */
    rateLimitPerMinute?: number;
  };
}

/**
 * Configuration for channels (Slack-like agent collaboration)
 * Enables shared communication spaces where multiple agents can collaborate
 */
export interface ChannelsConfig {
  /** Whether channels are enabled (default: false) */
  enabled?: boolean;

  /** Auto-injection settings for channel messages */
  injection?: {
    /** Auto-inject unread messages at turn start (default: true) */
    enabled?: boolean;
    /** Max messages to inject per turn across all channels (default: 10) */
    maxPerTurn?: number;
  };

  /** Storage settings */
  storage?: {
    /** Max messages to retain per channel (default: 5000) */
    maxMessagesPerChannel?: number;
    /** Max message age in days (default: 90) */
    maxAgeDays?: number;
  };
}

/**
 * Configuration for telephony (Twilio + ElevenLabs Conversational AI)
 * Enables phone numbers, SMS, WhatsApp, and real-time voice calls
 */
export interface TelephonyConfig {
  /** Whether telephony is enabled (default: false) */
  enabled?: boolean;

  /** Twilio webhook base URL (e.g., "https://app.example.com") */
  webhookUrl?: string;

  /** Default phone number for outbound calls/SMS */
  defaultPhoneNumber?: string;

  /** ElevenLabs Conversational AI Agent ID */
  elevenLabsAgentId?: string;

  /** Auto-injection settings for incoming calls/SMS */
  injection?: {
    /** Auto-inject events at turn start (default: true) */
    enabled?: boolean;
    /** Max events to inject per turn (default: 5) */
    maxPerTurn?: number;
  };

  /** Storage settings */
  storage?: {
    /** Max call logs to retain (default: 1000) */
    maxCallLogs?: number;
    /** Max SMS logs to retain (default: 5000) */
    maxSmsLogs?: number;
    /** Max log age in days (default: 90) */
    maxAgeDays?: number;
  };

  /** Voice settings */
  voice?: {
    /** Whether to record calls (default: false) */
    recordCalls?: boolean;
    /** Max call duration in seconds (default: 3600 = 1 hour) */
    maxCallDurationSeconds?: number;
  };
}

/**
 * Configuration for orders (full-lifecycle order management)
 * Enables tracking, creating, modifying, cancelling, and returning orders across stores/vendors
 */
export interface OrdersConfig {
  /** Whether orders are enabled (default: false) */
  enabled?: boolean;

  /** Auto-injection settings for order status changes */
  injection?: {
    /** Auto-inject recent order updates at turn start (default: true) */
    enabled?: boolean;
    /** Max order updates to inject per turn (default: 5) */
    maxPerTurn?: number;
  };

  /** Storage settings */
  storage?: {
    /** Max orders to retain (default: 5000) */
    maxOrders?: number;
    /** Max order age in days (default: 365) */
    maxAgeDays?: number;
  };
}

/**
 * Email address with optional display name
 */
export interface EmailAddress {
  /** Display name (e.g., "John Doe") */
  name?: string;
  /** Email address (e.g., "john@example.com") */
  address: string;
}

/**
 * Email attachment metadata
 */
export interface EmailAttachment {
  /** Filename of the attachment */
  filename: string;
  /** MIME content type */
  contentType: string;
  /** Size in bytes */
  size: number;
  /** Content-ID for inline attachments */
  contentId?: string;
  /** Local file path if downloaded */
  localPath?: string;
}

/**
 * Full email data structure
 */
export interface Email {
  /** Unique email ID (derived from S3 key or message-id) */
  id: string;
  /** RFC Message-ID header */
  messageId: string;
  /** Sender */
  from: EmailAddress;
  /** Recipients */
  to: EmailAddress[];
  /** CC recipients */
  cc?: EmailAddress[];
  /** Email subject */
  subject: string;
  /** Received date (ISO 8601) */
  date: string;
  /** Email body */
  body: {
    /** Plain text body */
    text?: string;
    /** HTML body */
    html?: string;
  };
  /** Attachments */
  attachments?: EmailAttachment[];
  /** Email headers */
  headers: Record<string, string>;
  /** Raw email content (EML) */
  raw?: string;
  /** S3 object key */
  s3Key?: string;
  /** When cached locally (ISO 8601) */
  cachedAt?: string;
}

/**
 * Summary email item for listing
 */
export interface EmailListItem {
  /** Unique email ID */
  id: string;
  /** RFC Message-ID header */
  messageId: string;
  /** Formatted sender string (name or address) */
  from: string;
  /** Email subject */
  subject: string;
  /** Received date (ISO 8601) */
  date: string;
  /** Whether email has attachments */
  hasAttachments: boolean;
  /** Whether email has been read */
  isRead: boolean;
}

// ============================================
// User & Authentication Types
// ============================================

export type UserRole = 'user' | 'admin';

export interface User {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  role: UserRole;
  emailVerified: boolean;
  createdAt: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResponse {
  user: User;
  accessToken: string;
  refreshToken: string;
}

// ============================================
// API Response Types
// ============================================

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    errors?: Record<string, string[]>;
  };
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// ============================================
// Database Entity Types (for web API)
// ============================================

export interface DbSession {
  id: string;
  userId: string;
  label: string | null;
  cwd: string | null;
  assistantId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface DbAssistant {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  avatar: string | null;
  model: string;
  systemPrompt: string | null;
  settings: Record<string, unknown> | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DbMessage {
  id: string;
  sessionId: string;
  userId: string | null;
  role: 'user' | 'assistant' | 'system';
  content: string;
  toolCalls: ToolCall[] | null;
  toolResults: ToolResult[] | null;
  createdAt: string;
}

export interface DbAssistantMessage {
  id: string;
  threadId: string;
  parentId: string | null;
  fromAssistantId: string | null;
  toAssistantId: string | null;
  subject: string | null;
  body: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  status: 'unread' | 'read' | 'archived' | 'injected';
  readAt: string | null;
  injectedAt: string | null;
  createdAt: string;
}
