/**
 * Test database helper
 *
 * Creates an isolated in-memory SQLite database for each test.
 * Uses the same schema as the production database.
 */

import { getRuntime } from '../../src/runtime';
import { SCHEMA_STATEMENTS } from '../../src/database/schema';
import type { DatabaseConnection } from '../../src/runtime';

/**
 * Create a fresh in-memory database with the full schema.
 * Each call returns a new isolated database - no shared state between tests.
 */
export function createTestDatabase(): DatabaseConnection {
  const runtime = getRuntime();
  const db = runtime.openDatabase(':memory:');

  db.exec('PRAGMA journal_mode=WAL');
  db.exec('PRAGMA foreign_keys=ON');

  for (const sql of SCHEMA_STATEMENTS) {
    db.exec(sql);
  }

  return db;
}
