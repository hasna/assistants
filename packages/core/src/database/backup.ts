/**
 * Database backup using VACUUM INTO
 *
 * - Creates atomic backups at ~/.assistants/backups/assistants-{timestamp}.db
 * - Automatically triggered on first startup of the day
 * - Keeps last 5 backups, deletes older ones
 * - Records each backup in the _backups table
 */

import { join, dirname } from 'path';
import { existsSync, mkdirSync, readdirSync, unlinkSync, statSync } from 'fs';
import { getConfigDir } from '../config';
import { getDatabase } from './index';
import type { DatabaseConnection } from '../runtime';

const MAX_BACKUPS = 5;

/**
 * Get the backups directory path.
 */
export function getBackupsDir(baseDir?: string): string {
  return join(baseDir || getConfigDir(), 'backups');
}

/**
 * Create a backup using VACUUM INTO.
 * Returns the backup file path, or null if backup was skipped/failed.
 */
export function createBackup(db?: DatabaseConnection, baseDir?: string): string | null {
  const conn = db || getDatabase();
  const backupsDir = getBackupsDir(baseDir);

  if (!existsSync(backupsDir)) {
    mkdirSync(backupsDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = join(backupsDir, `assistants-${timestamp}.db`);

  try {
    conn.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);

    // Record in _backups table
    let sizeBytes = 0;
    try {
      sizeBytes = statSync(backupPath).size;
    } catch {
      // Ignore stat errors
    }

    conn.prepare(
      'INSERT INTO _backups (path, size_bytes, created_at) VALUES (?, ?, ?)'
    ).run(backupPath, sizeBytes, new Date().toISOString());

    return backupPath;
  } catch {
    // Backup is non-critical - don't crash
    return null;
  }
}

/**
 * Rotate old backups, keeping only the most recent MAX_BACKUPS.
 */
export function rotateBackups(baseDir?: string): number {
  const backupsDir = getBackupsDir(baseDir);
  if (!existsSync(backupsDir)) return 0;

  try {
    const files = readdirSync(backupsDir)
      .filter((f) => f.startsWith('assistants-') && f.endsWith('.db'))
      .map((f) => ({
        name: f,
        path: join(backupsDir, f),
        mtime: statSync(join(backupsDir, f)).mtimeMs,
      }))
      .sort((a, b) => b.mtime - a.mtime); // newest first

    let deleted = 0;
    for (let i = MAX_BACKUPS; i < files.length; i++) {
      try {
        unlinkSync(files[i].path);
        deleted++;
      } catch {
        // Ignore deletion errors
      }
    }

    return deleted;
  } catch {
    return 0;
  }
}

/**
 * Run backup if one hasn't been done today.
 * Call this during startup.
 */
export function backupIfNeeded(db?: DatabaseConnection, baseDir?: string): string | null {
  const conn = db || getDatabase();

  // Check if we already backed up today
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const todayBackup = conn
    .query<{ id: number }>(`SELECT id FROM _backups WHERE created_at >= ? LIMIT 1`)
    .get(today + 'T00:00:00.000Z');

  if (todayBackup) {
    return null; // Already backed up today
  }

  const backupPath = createBackup(conn, baseDir);
  if (backupPath) {
    rotateBackups(baseDir);
  }
  return backupPath;
}

/**
 * List recent backups from the _backups table.
 */
export function listBackups(db?: DatabaseConnection, limit = 10): Array<{
  id: number;
  path: string;
  sizeBytes: number;
  createdAt: string;
}> {
  const conn = db || getDatabase();
  const rows = conn
    .query<{ id: number; path: string; size_bytes: number; created_at: string }>(
      'SELECT id, path, size_bytes, created_at FROM _backups ORDER BY created_at DESC LIMIT ?'
    )
    .all(limit);

  return rows.map((r) => ({
    id: r.id,
    path: r.path,
    sizeBytes: r.size_bytes,
    createdAt: r.created_at,
  }));
}
