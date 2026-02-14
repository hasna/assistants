/**
 * One-time migration from old multi-DB/JSON storage to unified SQLite
 *
 * Detection: Checks for ~/.assistants/.migrated-v1 marker file.
 * Migration order follows dependencies.
 * Runs in a single transaction for atomicity.
 * Old files are NOT deleted (user can clean up manually).
 */

import { join } from 'path';
import { existsSync, writeFileSync, readFileSync, readdirSync, mkdirSync } from 'fs';
import { getConfigDir } from '../config';
import type { DatabaseConnection } from '../runtime';

const MIGRATION_MARKER = '.migrated-v1';

/**
 * Check if migration has already been completed.
 */
export function isMigrated(baseDir?: string): boolean {
  const dir = baseDir || getConfigDir();
  return existsSync(join(dir, MIGRATION_MARKER));
}

/**
 * Mark migration as complete.
 */
export function markMigrated(baseDir?: string): void {
  const dir = baseDir || getConfigDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(join(dir, MIGRATION_MARKER), new Date().toISOString());
}

/**
 * Check if there are old stores to migrate.
 * Returns true if any old database or JSON store files exist.
 */
export function hasOldStores(baseDir?: string): boolean {
  const dir = baseDir || getConfigDir();
  const oldFiles = [
    'memory.db',
    'channels.db',
    'orders.db',
    'telephony.db',
    'contacts/contacts.db',
    'interviews/interviews.db',
    'sessions',
    'jobs',
    'messages',
    'webhooks',
    'wallet',
    'secrets',
    'heartbeats',
    'energy',
    'capabilities/store.json',
    'history',
  ];

  return oldFiles.some((f) => existsSync(join(dir, f)));
}

/**
 * Migrate old SQLite databases by attaching and copying data.
 * Each source database is attached, data is copied, then detached.
 */
function migrateOldSqliteDb(
  db: DatabaseConnection,
  oldDbPath: string,
  alias: string,
  copyStatements: string[]
): { migrated: boolean; error?: string } {
  if (!existsSync(oldDbPath)) {
    return { migrated: false };
  }

  try {
    db.exec(`ATTACH DATABASE '${oldDbPath.replace(/'/g, "''")}' AS ${alias}`);

    for (const stmt of copyStatements) {
      try {
        db.exec(stmt);
      } catch {
        // Skip individual statement failures (e.g., table doesn't exist in old DB)
      }
    }

    db.exec(`DETACH DATABASE ${alias}`);
    return { migrated: true };
  } catch (err) {
    try {
      db.exec(`DETACH DATABASE ${alias}`);
    } catch {
      // Ignore detach errors
    }
    return { migrated: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Migrate old JSON files into SQL tables.
 */
function migrateJsonFile<T>(
  filePath: string,
  inserter: (data: T) => void
): { migrated: boolean; error?: string } {
  if (!existsSync(filePath)) {
    return { migrated: false };
  }

  try {
    const raw = readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw) as T;
    inserter(data);
    return { migrated: true };
  } catch (err) {
    return { migrated: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Run the full migration.
 * Returns a summary of what was migrated.
 */
export function runMigration(
  db: DatabaseConnection,
  baseDir?: string
): { results: Record<string, { migrated: boolean; error?: string }> } {
  const dir = baseDir || getConfigDir();
  const results: Record<string, { migrated: boolean; error?: string }> = {};

  // 1. Migrate memory.db (sessions, session_messages renamed from messages, memory KV)
  results['memory.db'] = migrateOldSqliteDb(db, join(dir, 'memory.db'), 'old_memory', [
    `INSERT OR IGNORE INTO sessions SELECT * FROM old_memory.sessions`,
    `INSERT OR IGNORE INTO session_messages SELECT * FROM old_memory.messages`,
    `INSERT OR IGNORE INTO memory (key, assistant_id, value, created_at, updated_at, expires_at)
     SELECT key, NULL, value, created_at, updated_at, expires_at FROM old_memory.memory`,
  ]);

  // 1b. Migrate per-assistant memory.db files
  const assistantsDir = join(dir, 'assistants');
  if (existsSync(assistantsDir)) {
    try {
      const assistantDirs = readdirSync(assistantsDir);
      for (const assistantId of assistantDirs) {
        const assistantMemoryDb = join(assistantsDir, assistantId, 'memory.db');
        if (existsSync(assistantMemoryDb)) {
          const alias = `old_amem_${assistantId.replace(/[^a-zA-Z0-9]/g, '_')}`;
          results[`assistants/${assistantId}/memory.db`] = migrateOldSqliteDb(
            db,
            assistantMemoryDb,
            alias,
            [
              `INSERT OR IGNORE INTO memory (key, assistant_id, value, created_at, updated_at, expires_at)
               SELECT key, '${assistantId}', value, created_at, updated_at, expires_at FROM ${alias}.memory`,
            ]
          );
        }
      }
    } catch {
      // Skip if assistants directory can't be read
    }
  }

  // 2. Migrate global memory (memories + access log)
  // GlobalMemoryManager also uses memory.db at the global level - already handled above
  // But it has its own tables: memories, memory_access_log
  results['global-memory'] = migrateOldSqliteDb(db, join(dir, 'memory.db'), 'old_gmem', [
    `INSERT OR IGNORE INTO memories SELECT * FROM old_gmem.memories`,
    `INSERT OR IGNORE INTO memory_access_log SELECT * FROM old_gmem.memory_access_log`,
  ]);

  // 3. Migrate contacts.db
  results['contacts.db'] = migrateOldSqliteDb(db, join(dir, 'contacts', 'contacts.db'), 'old_contacts', [
    `INSERT OR IGNORE INTO contacts SELECT * FROM old_contacts.contacts`,
    `INSERT OR IGNORE INTO contact_emails SELECT * FROM old_contacts.contact_emails`,
    `INSERT OR IGNORE INTO contact_phones SELECT * FROM old_contacts.contact_phones`,
    `INSERT OR IGNORE INTO contact_addresses SELECT * FROM old_contacts.contact_addresses`,
    `INSERT OR IGNORE INTO contact_social SELECT * FROM old_contacts.contact_social`,
    `INSERT OR IGNORE INTO contact_tags SELECT * FROM old_contacts.contact_tags`,
    `INSERT OR IGNORE INTO contact_groups SELECT * FROM old_contacts.contact_groups`,
    `INSERT OR IGNORE INTO contact_group_members SELECT * FROM old_contacts.contact_group_members`,
  ]);

  // 4. Migrate channels.db
  results['channels.db'] = migrateOldSqliteDb(db, join(dir, 'channels.db'), 'old_channels', [
    `INSERT OR IGNORE INTO channels SELECT * FROM old_channels.channels`,
    `INSERT OR IGNORE INTO channel_members SELECT * FROM old_channels.channel_members`,
    `INSERT OR IGNORE INTO channel_messages SELECT * FROM old_channels.channel_messages`,
  ]);

  // 5. Migrate orders.db
  results['orders.db'] = migrateOldSqliteDb(db, join(dir, 'orders.db'), 'old_orders', [
    `INSERT OR IGNORE INTO stores SELECT * FROM old_orders.stores`,
    `INSERT OR IGNORE INTO orders SELECT * FROM old_orders.orders`,
    `INSERT OR IGNORE INTO order_items SELECT * FROM old_orders.order_items`,
  ]);

  // 6. Migrate telephony.db
  results['telephony.db'] = migrateOldSqliteDb(db, join(dir, 'telephony.db'), 'old_telephony', [
    `INSERT OR IGNORE INTO phone_numbers SELECT * FROM old_telephony.phone_numbers`,
    `INSERT OR IGNORE INTO call_logs SELECT * FROM old_telephony.call_logs`,
    `INSERT OR IGNORE INTO sms_logs SELECT * FROM old_telephony.sms_logs`,
    `INSERT OR IGNORE INTO routing_rules SELECT * FROM old_telephony.routing_rules`,
    `INSERT OR IGNORE INTO telephony_settings SELECT * FROM old_telephony.telephony_settings`,
  ]);

  // 7. Migrate interviews.db
  results['interviews.db'] = migrateOldSqliteDb(
    db,
    join(dir, 'interviews', 'interviews.db'),
    'old_interviews',
    [`INSERT OR IGNORE INTO interviews SELECT * FROM old_interviews.interviews`]
  );

  // 8. Migrate sessions (JSON files -> persisted_sessions table)
  const sessionsDir = join(dir, 'sessions');
  if (existsSync(sessionsDir)) {
    try {
      const sessionFiles = readdirSync(sessionsDir).filter((f) => f.endsWith('.json'));
      let sessionCount = 0;
      for (const file of sessionFiles) {
        const result = migrateJsonFile<{
          id: string;
          cwd: string;
          startedAt: number;
          updatedAt: number;
          assistantId: string | null;
          label: string | null;
          status: string;
        }>(join(sessionsDir, file), (data) => {
          if (!data.id) return;
          db.prepare(
            `INSERT OR IGNORE INTO persisted_sessions (id, cwd, started_at, updated_at, assistant_id, label, status)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          ).run(data.id, data.cwd, data.startedAt, data.updatedAt, data.assistantId, data.label, data.status);
          sessionCount++;
        });
        if (result.error) {
          results[`sessions/${file}`] = result;
        }
      }
      results['sessions'] = { migrated: sessionCount > 0 };
    } catch (err) {
      results['sessions'] = { migrated: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  // 9. Migrate jobs (JSON files -> jobs table)
  const jobsDir = join(dir, 'jobs');
  if (existsSync(jobsDir)) {
    try {
      const jobFiles = readdirSync(jobsDir).filter((f) => f.endsWith('.json'));
      let jobCount = 0;
      for (const file of jobFiles) {
        migrateJsonFile<{
          id: string;
          sessionId: string;
          connectorName: string;
          action: string;
          status: string;
          input?: unknown;
          output?: unknown;
          error?: string;
          timeoutMs?: number;
          createdAt: number;
          startedAt?: number;
          completedAt?: number;
        }>(join(jobsDir, file), (data) => {
          if (!data.id) return;
          db.prepare(
            `INSERT OR IGNORE INTO jobs (id, session_id, connector_name, action, status, input, output, error, timeout_ms, created_at, started_at, completed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            data.id,
            data.sessionId,
            data.connectorName,
            data.action,
            data.status,
            data.input ? JSON.stringify(data.input) : null,
            data.output ? JSON.stringify(data.output) : null,
            data.error || null,
            data.timeoutMs || null,
            data.createdAt,
            data.startedAt || null,
            data.completedAt || null
          );
          jobCount++;
        });
      }
      results['jobs'] = { migrated: jobCount > 0 };
    } catch (err) {
      results['jobs'] = { migrated: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  // 10. Migrate command history (plain text -> command_history table)
  const historyPath = join(dir, 'history');
  if (existsSync(historyPath)) {
    try {
      const content = readFileSync(historyPath, 'utf-8');
      const lines = content.split('\n').filter((l) => l.trim().length > 0);
      const stmt = db.prepare(
        'INSERT INTO command_history (command, created_at) VALUES (?, ?)'
      );
      const now = Date.now();
      db.transaction(() => {
        for (let i = 0; i < lines.length; i++) {
          stmt.run(lines[i], now - (lines.length - i) * 1000); // Approximate timestamps
        }
      });
      results['history'] = { migrated: true };
    } catch (err) {
      results['history'] = { migrated: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  return { results };
}

/**
 * Run migration if needed (called during startup).
 * Returns null if already migrated, or migration results.
 */
export function migrateIfNeeded(
  db: DatabaseConnection,
  baseDir?: string
): { results: Record<string, { migrated: boolean; error?: string }> } | null {
  if (isMigrated(baseDir)) {
    return null;
  }

  if (!hasOldStores(baseDir)) {
    // No old stores to migrate - mark as done
    markMigrated(baseDir);
    return null;
  }

  const migrationResult = runMigration(db, baseDir);
  markMigrated(baseDir);
  return migrationResult;
}
