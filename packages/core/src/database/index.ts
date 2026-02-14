/**
 * Unified SQLite database singleton
 *
 * Provides a single shared DatabaseConnection for all stores in the core package.
 * On first call to getDatabase(), it:
 *   1. Opens ~/.assistants/assistants.db
 *   2. Configures WAL mode, busy_timeout, foreign_keys
 *   3. Runs all CREATE TABLE IF NOT EXISTS statements
 *   4. Records the schema version
 */

import { join, dirname } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { getConfigDir } from '../config';
import { getRuntime } from '../runtime';
import type { DatabaseConnection } from '../runtime';
import { SCHEMA_STATEMENTS, SCHEMA_VERSION } from './schema';

let singleton: DatabaseConnection | null = null;
let singletonPath: string | null = null;

/**
 * Get the path to the unified database file.
 */
export function getDatabasePath(baseDir?: string): string {
  const dir = baseDir || getConfigDir();
  return join(dir, 'assistants.db');
}

/**
 * Get the shared database connection.
 * Creates and initializes the database on first call.
 *
 * Stores can optionally pass a custom connection (for testing)
 * but in production they should call getDatabase() with no arguments.
 */
export function getDatabase(dbPath?: string): DatabaseConnection {
  if (singleton) return singleton;

  const path = dbPath || getDatabasePath();
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const runtime = getRuntime();
  const db = runtime.openDatabase(path);

  // Configure pragmas for performance and safety
  db.exec('PRAGMA journal_mode=WAL');
  db.exec('PRAGMA busy_timeout=5000');
  db.exec('PRAGMA foreign_keys=ON');
  db.exec('PRAGMA synchronous=NORMAL');

  // Run all schema statements
  for (const sql of SCHEMA_STATEMENTS) {
    db.exec(sql);
  }

  // Record schema version if not already present
  const versionRow = db
    .query<{ version: number }>('SELECT version FROM _schema_version ORDER BY version DESC LIMIT 1')
    .get();

  if (!versionRow || versionRow.version < SCHEMA_VERSION) {
    db.prepare('INSERT INTO _schema_version (version, applied_at) VALUES (?, ?)')
      .run(SCHEMA_VERSION, new Date().toISOString());
  }

  singleton = db;
  singletonPath = path;
  return db;
}

/**
 * Close the shared database connection and reset the singleton.
 * Call this during graceful shutdown.
 */
export function closeDatabase(): void {
  if (singleton) {
    try {
      singleton.close();
    } catch {
      // Ignore close errors during shutdown
    }
    singleton = null;
    singletonPath = null;
  }
}

/**
 * Reset the singleton (for testing).
 * Does NOT close the connection - call closeDatabase() first if needed.
 */
export function resetDatabaseSingleton(): void {
  singleton = null;
  singletonPath = null;
}

/**
 * Get the current schema version from the database.
 */
export function getSchemaVersion(db?: DatabaseConnection): number {
  const conn = db || getDatabase();
  const row = conn
    .query<{ version: number }>('SELECT version FROM _schema_version ORDER BY version DESC LIMIT 1')
    .get();
  return row?.version ?? 0;
}

// Re-export schema for external use
export { SCHEMA_VERSION, SCHEMA_STATEMENTS } from './schema';
export type { DatabaseConnection } from '../runtime';
