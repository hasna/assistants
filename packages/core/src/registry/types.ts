/**
 * Assistant Registry Types
 *
 * Defines the data model for tracking registered assistants in the system.
 * Supports both in-memory and persisted storage with TTL-based cleanup.
 */

import type { AssistantState as HeartbeatAssistantState } from '../heartbeat';

/**
 * Assistant type classification
 */
export type AssistantType = 'assistant' | 'subassistant' | 'coordinator' | 'worker';

/**
 * Assistant operational state (extends heartbeat state with 'offline')
 */
export type RegistryAssistantState = HeartbeatAssistantState | 'offline';

/**
 * Assistant capabilities - what an assistant can do
 */
export interface AssistantCapabilities {
  /** Available tools this assistant can use */
  tools: string[];
  /** Available skills this assistant has access to */
  skills: string[];
  /** Supported LLM models */
  models: string[];
  /** Domain expertise tags (e.g., 'code', 'research', 'data') */
  tags: string[];
  /** Maximum concurrent tasks this assistant can handle */
  maxConcurrent?: number;
  /** Maximum subassistant depth this assistant can spawn */
  maxDepth?: number;
  /** Tool scope restrictions (allowed patterns) */
  toolScopes?: string[];
}

/**
 * Assistant current status
 */
export interface AssistantStatus {
  /** Current operational state */
  state: RegistryAssistantState;
  /** Current task being executed (if any) */
  currentTask?: string;
  /** Task description or summary */
  taskDescription?: string;
  /** Error message if in error state */
  errorMessage?: string;
  /** Uptime in seconds */
  uptime: number;
  /** Number of messages processed */
  messagesProcessed: number;
  /** Number of tool calls executed */
  toolCallsExecuted: number;
  /** Number of errors encountered */
  errorsCount: number;
}

/**
 * Assistant resource usage and load
 */
export interface AssistantLoad {
  /** Number of active/running tasks */
  activeTasks: number;
  /** Number of queued tasks waiting */
  queuedTasks: number;
  /** Total tokens used in current session */
  tokensUsed: number;
  /** Token budget limit (if set) */
  tokenLimit?: number;
  /** LLM calls made */
  llmCalls: number;
  /** LLM call limit (if set) */
  llmCallLimit?: number;
  /** Current recursion depth */
  currentDepth: number;
}

/**
 * Heartbeat information for liveness tracking
 */
export interface HeartbeatInfo {
  /** Last heartbeat timestamp (ISO string) */
  lastHeartbeat: string;
  /** Heartbeat interval in milliseconds */
  intervalMs: number;
  /** Whether heartbeat is considered stale */
  isStale: boolean;
  /** Consecutive missed heartbeats */
  missedCount: number;
}

/**
 * Registered assistant record
 */
export interface RegisteredAssistant {
  /** Unique assistant identifier */
  id: string;
  /** Human-readable assistant name */
  name: string;
  /** Optional description */
  description?: string;
  /** Assistant type classification */
  type: AssistantType;

  // Relationships
  /** Associated session ID */
  sessionId?: string;
  /** Parent assistant ID (for subassistants) */
  parentId?: string;
  /** Child assistant IDs */
  childIds: string[];

  // Capabilities
  /** What this assistant can do */
  capabilities: AssistantCapabilities;

  // Status
  /** Current operational status */
  status: AssistantStatus;
  /** Current resource load */
  load: AssistantLoad;
  /** Heartbeat information */
  heartbeat: HeartbeatInfo;

  // Lifecycle timestamps
  /** When assistant was registered */
  registeredAt: string;
  /** When assistant was last updated */
  updatedAt: string;
  /** When assistant was deregistered (if applicable) */
  deregisteredAt?: string;

  // Location (for remote assistants)
  /** Endpoint URL for remote assistants */
  endpoint?: string;
  /** Region/zone for distributed deployments */
  region?: string;

  // Metadata
  /** Additional custom metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Assistant registration request
 */
export interface AssistantRegistration {
  /** Optional specific ID (generated if not provided) */
  id?: string;
  /** Assistant name */
  name: string;
  /** Optional description */
  description?: string;
  /** Assistant type */
  type: AssistantType;
  /** Session ID */
  sessionId?: string;
  /** Parent assistant ID */
  parentId?: string;
  /** Initial capabilities */
  capabilities: Partial<AssistantCapabilities>;
  /** Remote endpoint */
  endpoint?: string;
  /** Custom metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Assistant update request
 */
export interface AssistantUpdate {
  /** Update name */
  name?: string;
  /** Update description */
  description?: string;
  /** Update capabilities */
  capabilities?: Partial<AssistantCapabilities>;
  /** Update status */
  status?: Partial<AssistantStatus>;
  /** Update load */
  load?: Partial<AssistantLoad>;
  /** Update metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Query parameters for finding assistants
 */
export interface AssistantQuery {
  /** Filter by assistant type */
  type?: AssistantType | AssistantType[];
  /** Filter by state */
  state?: RegistryAssistantState | RegistryAssistantState[];
  /** Filter by session ID */
  sessionId?: string;
  /** Filter by parent ID */
  parentId?: string;
  /** Filter by required capabilities (all must match) */
  requiredCapabilities?: {
    tools?: string[];
    skills?: string[];
    tags?: string[];
  };
  /** Filter by preferred capabilities (any match improves score) */
  preferredCapabilities?: {
    tools?: string[];
    skills?: string[];
    tags?: string[];
  };
  /** Exclude assistants with these capabilities */
  excludedCapabilities?: {
    tools?: string[];
    skills?: string[];
    tags?: string[];
  };
  /** Include offline/stale assistants */
  includeOffline?: boolean;
  /** Maximum load threshold (0-1) */
  maxLoadFactor?: number;
  /** Maximum results to return */
  limit?: number;
  /** Sort field */
  sortBy?: 'name' | 'registeredAt' | 'load' | 'uptime';
  /** Sort direction */
  sortDir?: 'asc' | 'desc';
}

/**
 * Query result with scored matches
 */
export interface AssistantQueryResult {
  /** Matching assistants */
  assistants: RegisteredAssistant[];
  /** Total count (before limit) */
  total: number;
  /** Match scores (0-1) for each assistant */
  scores: Map<string, number>;
}

/**
 * Registry configuration
 */
export interface RegistryConfig {
  /** Enable registry (default: true) */
  enabled: boolean;
  /** Storage mode */
  storage: 'memory' | 'file' | 'database';
  /** Storage path (for file mode) */
  storagePath?: string;
  /** Time-to-live for stale assistants in milliseconds (default: 5 minutes) */
  staleTTL: number;
  /** Cleanup interval in milliseconds (default: 1 minute) */
  cleanupInterval: number;
  /** Maximum assistants to track (default: 1000) */
  maxAssistants: number;
  /** Auto-register from heartbeat (default: true) */
  autoRegister: boolean;
  /** Auto-deregister stale assistants (default: true) */
  autoDeregister: boolean;
  /** Heartbeat stale threshold in milliseconds (default: 30 seconds) */
  heartbeatStaleThreshold: number;
}

/**
 * Default registry configuration
 */
export const DEFAULT_REGISTRY_CONFIG: RegistryConfig = {
  enabled: true,
  storage: 'memory',
  staleTTL: 5 * 60 * 1000, // 5 minutes
  cleanupInterval: 60 * 1000, // 1 minute
  maxAssistants: 1000,
  autoRegister: true,
  autoDeregister: true,
  heartbeatStaleThreshold: 30 * 1000, // 30 seconds
};

/**
 * Registry event types
 */
export type RegistryEventType =
  | 'assistant:registered'
  | 'assistant:updated'
  | 'assistant:deregistered'
  | 'assistant:stale'
  | 'assistant:recovered'
  | 'assistant:error';

/**
 * Registry event payload
 */
export interface RegistryEvent {
  type: RegistryEventType;
  assistantId: string;
  assistant?: RegisteredAssistant;
  previousState?: Partial<RegisteredAssistant>;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

/**
 * Registry event listener
 */
export type RegistryEventListener = (event: RegistryEvent) => void;

/**
 * Registry statistics
 */
export interface RegistryStats {
  /** Total registered assistants */
  totalAssistants: number;
  /** Assistants by type */
  byType: Record<AssistantType, number>;
  /** Assistants by state */
  byState: Record<RegistryAssistantState, number>;
  /** Stale assistants count */
  staleCount: number;
  /** Average load factor */
  averageLoad: number;
  /** Registry uptime */
  uptime: number;
}
