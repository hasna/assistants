/**
 * Unified SQLite schema for all core storage
 *
 * All tables live in a single ~/.assistants/assistants.db file.
 * Tables are grouped by domain but share the same connection
 * with WAL mode, busy_timeout, and foreign keys enabled.
 */

// Schema version - bump when adding migrations
export const SCHEMA_VERSION = 1;

/**
 * All CREATE TABLE / CREATE INDEX statements.
 * Each entry is idempotent (IF NOT EXISTS).
 * Order matters for foreign key references.
 */
export const SCHEMA_STATEMENTS: string[] = [
  // ============================================
  // Meta tables
  // ============================================
  `CREATE TABLE IF NOT EXISTS _schema_version (
    version INTEGER NOT NULL,
    applied_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS _backups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT NOT NULL,
    size_bytes INTEGER,
    created_at TEXT NOT NULL
  )`,

  // ============================================
  // Config (replaces JSON config files for runtime state)
  // ============================================
  `CREATE TABLE IF NOT EXISTS config (
    scope TEXT NOT NULL DEFAULT 'global',
    scope_id TEXT,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (scope, scope_id, key)
  )`,

  // ============================================
  // Memory: sessions table (from memory/store.ts)
  // ============================================
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    metadata TEXT
  )`,

  // ============================================
  // Memory: session_messages (renamed from "messages" to avoid conflict)
  // ============================================
  `CREATE TABLE IF NOT EXISTS session_messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    tool_calls TEXT,
    tool_results TEXT,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
  )`,

  `CREATE INDEX IF NOT EXISTS idx_session_messages_session ON session_messages(session_id)`,

  // ============================================
  // Memory: KV store (from memory/store.ts)
  // Now includes assistant_id for per-assistant isolation
  // ============================================
  `CREATE TABLE IF NOT EXISTS memory (
    key TEXT NOT NULL,
    assistant_id TEXT,
    value TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    expires_at INTEGER,
    PRIMARY KEY (key, assistant_id)
  )`,

  // ============================================
  // Global Memory: memories (from memory/global-memory.ts)
  // ============================================
  `CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    scope TEXT NOT NULL,
    scope_id TEXT,
    category TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    summary TEXT,
    importance INTEGER DEFAULT 5,
    tags TEXT,
    source TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    accessed_at TEXT,
    access_count INTEGER DEFAULT 0,
    expires_at TEXT,
    UNIQUE(scope, scope_id, key)
  )`,

  `CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(scope, scope_id)`,
  `CREATE INDEX IF NOT EXISTS idx_memories_category ON memories(category)`,
  `CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_memories_key ON memories(key)`,

  `CREATE TABLE IF NOT EXISTS memory_access_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    memory_id TEXT NOT NULL,
    session_id TEXT,
    assistant_id TEXT,
    action TEXT NOT NULL,
    timestamp TEXT NOT NULL
  )`,

  `CREATE INDEX IF NOT EXISTS idx_memory_access_log_memory ON memory_access_log(memory_id)`,
  `CREATE INDEX IF NOT EXISTS idx_memory_access_log_timestamp ON memory_access_log(timestamp)`,

  // ============================================
  // Contacts (from contacts/store.ts)
  // ============================================
  `CREATE TABLE IF NOT EXISTS contacts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    company TEXT,
    title TEXT,
    birthday TEXT,
    relationship TEXT DEFAULT 'other',
    notes TEXT,
    favorite INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS contact_emails (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    label TEXT DEFAULT 'personal',
    is_primary INTEGER DEFAULT 0
  )`,

  `CREATE TABLE IF NOT EXISTS contact_phones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    phone TEXT NOT NULL,
    label TEXT DEFAULT 'mobile',
    is_primary INTEGER DEFAULT 0
  )`,

  `CREATE TABLE IF NOT EXISTS contact_addresses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    street TEXT,
    city TEXT,
    state TEXT,
    postal_code TEXT,
    country TEXT,
    label TEXT DEFAULT 'home'
  )`,

  `CREATE TABLE IF NOT EXISTS contact_social (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    platform TEXT NOT NULL,
    handle TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS contact_tags (
    contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    tag TEXT NOT NULL,
    PRIMARY KEY (contact_id, tag)
  )`,

  `CREATE TABLE IF NOT EXISTS contact_groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    created_at INTEGER NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS contact_group_members (
    group_id TEXT NOT NULL REFERENCES contact_groups(id) ON DELETE CASCADE,
    contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    PRIMARY KEY (group_id, contact_id)
  )`,

  `CREATE INDEX IF NOT EXISTS idx_contact_emails_contact ON contact_emails(contact_id)`,
  `CREATE INDEX IF NOT EXISTS idx_contact_phones_contact ON contact_phones(contact_id)`,
  `CREATE INDEX IF NOT EXISTS idx_contact_addresses_contact ON contact_addresses(contact_id)`,
  `CREATE INDEX IF NOT EXISTS idx_contact_social_contact ON contact_social(contact_id)`,
  `CREATE INDEX IF NOT EXISTS idx_contact_tags_contact ON contact_tags(contact_id)`,
  `CREATE INDEX IF NOT EXISTS idx_contact_group_members_group ON contact_group_members(group_id)`,
  `CREATE INDEX IF NOT EXISTS idx_contact_group_members_contact ON contact_group_members(contact_id)`,
  `CREATE INDEX IF NOT EXISTS idx_contacts_name ON contacts(name)`,

  // ============================================
  // Channels (from channels/store.ts)
  // ============================================
  `CREATE TABLE IF NOT EXISTS channels (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    created_by TEXT NOT NULL,
    created_by_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS channel_members (
    channel_id TEXT NOT NULL,
    assistant_id TEXT NOT NULL,
    assistant_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    joined_at TEXT NOT NULL,
    last_read_at TEXT,
    member_type TEXT NOT NULL DEFAULT 'assistant',
    PRIMARY KEY (channel_id, assistant_id)
  )`,

  `CREATE TABLE IF NOT EXISTS channel_messages (
    id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    sender_id TEXT NOT NULL,
    sender_name TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,

  `CREATE INDEX IF NOT EXISTS idx_channel_messages_channel ON channel_messages(channel_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_channel_members_assistant ON channel_members(assistant_id)`,

  // ============================================
  // Orders (from orders/store.ts)
  // ============================================
  `CREATE TABLE IF NOT EXISTS stores (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    url TEXT,
    connector_name TEXT,
    category TEXT NOT NULL DEFAULT 'other',
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    store_id TEXT NOT NULL,
    store_name TEXT NOT NULL,
    order_number TEXT,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    total_amount REAL,
    currency TEXT NOT NULL DEFAULT 'USD',
    shipping_address TEXT,
    payment_method TEXT,
    tracking_number TEXT,
    tracking_url TEXT,
    notes TEXT,
    connector_order_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS order_items (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    quantity INTEGER NOT NULL DEFAULT 1,
    unit_price REAL,
    total_price REAL,
    sku TEXT,
    url TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL
  )`,

  `CREATE INDEX IF NOT EXISTS idx_orders_store ON orders(store_id)`,
  `CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status, updated_at)`,
  `CREATE INDEX IF NOT EXISTS idx_orders_updated ON orders(updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id)`,
  `CREATE INDEX IF NOT EXISTS idx_stores_name ON stores(name)`,

  // ============================================
  // Telephony (from telephony/store.ts)
  // ============================================
  `CREATE TABLE IF NOT EXISTS phone_numbers (
    id TEXT PRIMARY KEY,
    number TEXT NOT NULL UNIQUE,
    friendly_name TEXT,
    twilio_sid TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    voice_capable INTEGER NOT NULL DEFAULT 1,
    sms_capable INTEGER NOT NULL DEFAULT 1,
    whatsapp_capable INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS call_logs (
    id TEXT PRIMARY KEY,
    call_sid TEXT,
    from_number TEXT NOT NULL,
    to_number TEXT NOT NULL,
    direction TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    assistant_id TEXT,
    duration INTEGER,
    recording_url TEXT,
    started_at TEXT,
    ended_at TEXT,
    created_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS sms_logs (
    id TEXT PRIMARY KEY,
    message_sid TEXT,
    from_number TEXT NOT NULL,
    to_number TEXT NOT NULL,
    direction TEXT NOT NULL,
    message_type TEXT NOT NULL DEFAULT 'sms',
    body TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    assistant_id TEXT,
    created_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS routing_rules (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    priority INTEGER NOT NULL DEFAULT 100,
    from_pattern TEXT,
    to_pattern TEXT,
    message_type TEXT NOT NULL DEFAULT 'all',
    time_of_day TEXT,
    day_of_week TEXT,
    keyword TEXT,
    target_assistant_id TEXT NOT NULL,
    target_assistant_name TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS telephony_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  `CREATE INDEX IF NOT EXISTS idx_call_logs_assistant ON call_logs(assistant_id)`,
  `CREATE INDEX IF NOT EXISTS idx_call_logs_status ON call_logs(status)`,
  `CREATE INDEX IF NOT EXISTS idx_call_logs_created ON call_logs(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_call_logs_sid ON call_logs(call_sid)`,
  `CREATE INDEX IF NOT EXISTS idx_sms_logs_assistant ON sms_logs(assistant_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sms_logs_created ON sms_logs(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_sms_logs_sid ON sms_logs(message_sid)`,
  `CREATE INDEX IF NOT EXISTS idx_routing_rules_priority ON routing_rules(priority, enabled)`,

  // ============================================
  // Interviews (from interviews/store.ts)
  // ============================================
  `CREATE TABLE IF NOT EXISTS interviews (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    assistant_id TEXT,
    title TEXT,
    questions TEXT NOT NULL,
    answers TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER NOT NULL,
    completed_at INTEGER
  )`,

  `CREATE INDEX IF NOT EXISTS idx_interviews_session ON interviews(session_id)`,
  `CREATE INDEX IF NOT EXISTS idx_interviews_status ON interviews(status)`,
  `CREATE INDEX IF NOT EXISTS idx_interviews_created ON interviews(created_at)`,

  // ============================================
  // Tasks (JSON -> SQL, with project_path)
  // ============================================
  `CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    project_path TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    priority TEXT NOT NULL DEFAULT 'normal',
    result TEXT,
    error TEXT,
    assignee TEXT,
    project_id TEXT,
    blocked_by TEXT,
    blocks TEXT,
    is_recurring_template INTEGER DEFAULT 0,
    next_run_at INTEGER,
    recurrence TEXT,
    created_at INTEGER NOT NULL,
    started_at INTEGER,
    completed_at INTEGER
  )`,

  `CREATE INDEX IF NOT EXISTS idx_tasks_project_path ON tasks(project_path)`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority)`,

  `CREATE TABLE IF NOT EXISTS task_queue_settings (
    project_path TEXT PRIMARY KEY,
    paused INTEGER NOT NULL DEFAULT 0,
    auto_run INTEGER NOT NULL DEFAULT 1
  )`,

  // ============================================
  // Schedules (JSON -> SQL, with project_path)
  // ============================================
  `CREATE TABLE IF NOT EXISTS schedules (
    id TEXT PRIMARY KEY,
    project_path TEXT NOT NULL,
    command TEXT NOT NULL,
    schedule TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    session_id TEXT,
    next_run_at INTEGER,
    last_run_at INTEGER,
    run_count INTEGER DEFAULT 0,
    max_runs INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    data TEXT
  )`,

  `CREATE INDEX IF NOT EXISTS idx_schedules_project_path ON schedules(project_path)`,
  `CREATE INDEX IF NOT EXISTS idx_schedules_status ON schedules(status, next_run_at)`,

  // ============================================
  // Persisted Sessions (from sessions/store.ts, JSON -> SQL)
  // ============================================
  `CREATE TABLE IF NOT EXISTS persisted_sessions (
    id TEXT PRIMARY KEY,
    cwd TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    assistant_id TEXT,
    label TEXT,
    status TEXT NOT NULL DEFAULT 'active'
  )`,

  `CREATE INDEX IF NOT EXISTS idx_persisted_sessions_status ON persisted_sessions(status)`,

  // ============================================
  // Jobs (from jobs/job-store.ts, JSON -> SQL)
  // ============================================
  `CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    connector_name TEXT NOT NULL,
    action TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    input TEXT,
    output TEXT,
    error TEXT,
    timeout_ms INTEGER,
    created_at INTEGER NOT NULL,
    started_at INTEGER,
    completed_at INTEGER
  )`,

  `CREATE INDEX IF NOT EXISTS idx_jobs_session ON jobs(session_id)`,
  `CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status)`,

  // ============================================
  // Messages - Assistant-to-Assistant (from messages/storage/local-storage.ts, JSON -> SQL)
  // Also serves as the unified messages directory (formerly inbox/)
  // ============================================
  `CREATE TABLE IF NOT EXISTS assistant_registry (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    last_seen TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS assistant_messages (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL,
    parent_id TEXT,
    from_assistant_id TEXT NOT NULL,
    from_assistant_name TEXT NOT NULL,
    to_assistant_id TEXT NOT NULL,
    to_assistant_name TEXT NOT NULL,
    subject TEXT,
    body TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT 'normal',
    status TEXT NOT NULL DEFAULT 'unread',
    created_at TEXT NOT NULL,
    read_at TEXT,
    injected_at TEXT
  )`,

  `CREATE INDEX IF NOT EXISTS idx_assistant_messages_to ON assistant_messages(to_assistant_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_assistant_messages_thread ON assistant_messages(thread_id)`,
  `CREATE INDEX IF NOT EXISTS idx_assistant_messages_created ON assistant_messages(created_at DESC)`,

  `CREATE TABLE IF NOT EXISTS assistant_message_threads (
    thread_id TEXT PRIMARY KEY,
    subject TEXT,
    participants TEXT NOT NULL,
    message_count INTEGER DEFAULT 0,
    unread_count INTEGER DEFAULT 0,
    last_message_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  // ============================================
  // Webhooks (from webhooks/storage/local-storage.ts, JSON -> SQL)
  // ============================================
  `CREATE TABLE IF NOT EXISTS webhook_registrations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    source TEXT NOT NULL,
    url TEXT,
    secret TEXT,
    events TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    delivery_count INTEGER DEFAULT 0,
    last_delivery_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS webhook_events (
    id TEXT PRIMARY KEY,
    webhook_id TEXT NOT NULL,
    source TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    headers TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    timestamp TEXT NOT NULL,
    injected_at TEXT
  )`,

  `CREATE INDEX IF NOT EXISTS idx_webhook_events_webhook ON webhook_events(webhook_id, timestamp DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_webhook_events_status ON webhook_events(status)`,

  `CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id TEXT PRIMARY KEY,
    webhook_id TEXT NOT NULL,
    event_id TEXT NOT NULL,
    received_at TEXT NOT NULL,
    processed_at TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    response TEXT
  )`,

  `CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook ON webhook_deliveries(webhook_id)`,

  // ============================================
  // Wallet (from wallet/storage/local-client.ts, JSON -> SQL)
  // ============================================
  `CREATE TABLE IF NOT EXISTS wallet_cards (
    id TEXT PRIMARY KEY,
    assistant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    card_number TEXT NOT NULL,
    expiry_month TEXT NOT NULL,
    expiry_year TEXT NOT NULL,
    cvv TEXT,
    card_type TEXT NOT NULL DEFAULT 'visa',
    billing_address TEXT,
    created_at TEXT NOT NULL
  )`,

  `CREATE INDEX IF NOT EXISTS idx_wallet_cards_assistant ON wallet_cards(assistant_id)`,

  // ============================================
  // Secrets (from secrets/storage/local-client.ts, JSON -> SQL)
  // ============================================
  `CREATE TABLE IF NOT EXISTS secrets (
    name TEXT NOT NULL,
    scope TEXT NOT NULL DEFAULT 'global',
    assistant_id TEXT,
    value TEXT NOT NULL,
    description TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (name, scope, assistant_id)
  )`,

  // ============================================
  // Inbox / Email Cache (index to SQL, email body files stay on disk)
  // Moved from inbox/ to messages/ directory for unification
  // ============================================
  `CREATE TABLE IF NOT EXISTS inbox_cache (
    id TEXT NOT NULL,
    assistant_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    message_id TEXT NOT NULL,
    from_address TEXT NOT NULL,
    subject TEXT NOT NULL,
    date TEXT NOT NULL,
    has_attachments INTEGER DEFAULT 0,
    is_read INTEGER DEFAULT 0,
    cached_at TEXT NOT NULL,
    PRIMARY KEY (id, assistant_id)
  )`,

  `CREATE INDEX IF NOT EXISTS idx_inbox_cache_assistant ON inbox_cache(assistant_id, date DESC)`,

  `CREATE TABLE IF NOT EXISTS inbox_sync (
    assistant_id TEXT PRIMARY KEY,
    last_sync TEXT
  )`,

  // ============================================
  // Heartbeat Persistence (from heartbeat/persistence.ts, JSON -> SQL)
  // ============================================
  `CREATE TABLE IF NOT EXISTS heartbeat_state (
    session_id TEXT PRIMARY KEY,
    heartbeat TEXT NOT NULL,
    context TEXT NOT NULL,
    timestamp TEXT NOT NULL
  )`,

  // ============================================
  // Energy (from energy/storage.ts, JSON -> SQL)
  // ============================================
  `CREATE TABLE IF NOT EXISTS energy_state (
    id TEXT PRIMARY KEY DEFAULT 'default',
    current_energy REAL NOT NULL,
    max_energy REAL NOT NULL,
    regen_rate REAL NOT NULL,
    last_update TEXT NOT NULL
  )`,

  // ============================================
  // Capabilities (from capabilities/storage.ts, JSON -> SQL)
  // ============================================
  `CREATE TABLE IF NOT EXISTS capability_chains (
    entity_id TEXT PRIMARY KEY,
    chain TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS capability_overrides (
    entity_id TEXT PRIMARY KEY,
    overrides TEXT NOT NULL
  )`,

  // ============================================
  // Command History (from history/storage.ts, plain text -> SQL)
  // ============================================
  `CREATE TABLE IF NOT EXISTS command_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    command TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,

  `CREATE INDEX IF NOT EXISTS idx_command_history_created ON command_history(created_at DESC)`,

  // ============================================
  // Projects (from projects/store.ts, JSON -> SQL)
  // ============================================
  `CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    project_path TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    context TEXT NOT NULL DEFAULT '[]',
    plans TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,

  `CREATE INDEX IF NOT EXISTS idx_projects_path ON projects(project_path)`,
  `CREATE INDEX IF NOT EXISTS idx_projects_name ON projects(name)`,

  // ============================================
  // Guardrails (from guardrails/store.ts)
  // Note: GuardrailStore is already SQLite-based, just needs connection change
  // ============================================
  `CREATE TABLE IF NOT EXISTS guardrail_evaluations (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    assistant_id TEXT,
    rule_id TEXT NOT NULL,
    rule_name TEXT NOT NULL,
    input_text TEXT,
    result TEXT NOT NULL,
    score REAL,
    details TEXT,
    created_at TEXT NOT NULL
  )`,

  `CREATE INDEX IF NOT EXISTS idx_guardrail_evaluations_session ON guardrail_evaluations(session_id)`,
  `CREATE INDEX IF NOT EXISTS idx_guardrail_evaluations_rule ON guardrail_evaluations(rule_id)`,

  // ============================================
  // Assistants / Identity (from identity/assistant-manager.ts, JSON -> SQL)
  // ============================================
  `CREATE TABLE IF NOT EXISTS assistants_config (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    model TEXT,
    system_prompt TEXT,
    settings TEXT NOT NULL DEFAULT '{}',
    identity_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS assistants_active (
    key TEXT PRIMARY KEY DEFAULT 'active',
    assistant_id TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS assistant_sessions (
    id TEXT PRIMARY KEY,
    assistant_id TEXT NOT NULL,
    cwd TEXT,
    started_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    metadata TEXT
  )`,

  `CREATE INDEX IF NOT EXISTS idx_assistant_sessions_assistant ON assistant_sessions(assistant_id)`,

  // ============================================
  // People (from people/store.ts, JSON -> SQL)
  // ============================================
  `CREATE TABLE IF NOT EXISTS people (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    role TEXT,
    notes TEXT,
    avatar_url TEXT,
    metadata TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS people_active (
    key TEXT PRIMARY KEY DEFAULT 'active',
    person_id TEXT NOT NULL
  )`,

  // ============================================
  // Verification Sessions (from sessions/verification.ts, JSON -> SQL)
  // ============================================
  `CREATE TABLE IF NOT EXISTS verification_sessions (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    assistant_id TEXT,
    goal TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    result TEXT,
    created_at TEXT NOT NULL,
    completed_at TEXT,
    data TEXT
  )`,

  `CREATE INDEX IF NOT EXISTS idx_verification_sessions_session ON verification_sessions(session_id)`,

  // ============================================
  // Workspaces (from workspace/shared.ts, JSON -> SQL)
  // Workspace files stay on disk, only metadata in DB
  // ============================================
  `CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    creator_id TEXT NOT NULL,
    creator_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    participants TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS workspaces_active (
    assistant_id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL
  )`,

  // ============================================
  // Budget (from budget/tracker.ts, JSON -> SQL)
  // ============================================
  `CREATE TABLE IF NOT EXISTS budget_usage (
    scope TEXT NOT NULL,
    scope_id TEXT NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    api_calls INTEGER NOT NULL DEFAULT 0,
    tool_calls INTEGER NOT NULL DEFAULT 0,
    estimated_cost_usd REAL NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (scope, scope_id)
  )`,

  // ============================================
  // Registry (from registry/store.ts, JSON -> SQL)
  // ============================================
  `CREATE TABLE IF NOT EXISTS registered_assistants (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'general',
    description TEXT,
    model TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    state TEXT NOT NULL DEFAULT 'idle',
    capabilities TEXT,
    tags TEXT,
    parent_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_active_at TEXT,
    metadata TEXT
  )`,

  `CREATE INDEX IF NOT EXISTS idx_registered_assistants_type ON registered_assistants(type)`,
  `CREATE INDEX IF NOT EXISTS idx_registered_assistants_status ON registered_assistants(status)`,

  // ============================================
  // Heartbeat History (from heartbeat/history.ts, JSONL -> SQL)
  // ============================================
  `CREATE TABLE IF NOT EXISTS heartbeat_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    status TEXT NOT NULL,
    energy INTEGER,
    context_tokens INTEGER,
    action TEXT,
    timestamp TEXT NOT NULL
  )`,

  `CREATE INDEX IF NOT EXISTS idx_heartbeat_history_session ON heartbeat_history(session_id, timestamp DESC)`,

  // ============================================
  // Connector Cache (from tools/connector.ts, JSON -> SQL)
  // ============================================
  `CREATE TABLE IF NOT EXISTS connector_cache (
    key TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    cached_at TEXT NOT NULL
  )`,
];
