import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { getConfigDir } from '../config';
import { initAssistantsDir } from '../logger';
import { getDatabase } from '../database';
import type { DatabaseConnection } from '../database';

function getDb(): DatabaseConnection {
  return getDatabase();
}

const SAFE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

function isValidId(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0 && SAFE_ID_PATTERN.test(id);
}

function getWorkspaceRoot(baseDir?: string): string {
  return join(baseDir ?? getConfigDir(), 'workspaces');
}

/**
 * Read the active workspace ID from the database.
 */
export function getActiveWorkspaceId(baseDir?: string, db?: DatabaseConnection): string | null {
  try {
    const conn = db || getDb();
    // Use a known assistant_id key for the "global" active workspace
    const row = conn.query<{ workspace_id: string }>(
      "SELECT workspace_id FROM workspaces_active WHERE assistant_id = '__global__'"
    ).get();
    const id = row?.workspace_id ?? null;
    if (id && !isValidId(id)) {
      return null;
    }
    return id || null;
  } catch {
    return null;
  }
}

/**
 * Persist the active workspace ID to the database.
 */
export function setActiveWorkspaceId(id: string | null, baseDir?: string, db?: DatabaseConnection): void {
  if (id && !isValidId(id)) {
    throw new Error(`Invalid workspace id: "${id}"`);
  }
  const conn = db || getDb();
  if (id) {
    conn.prepare(
      "INSERT OR REPLACE INTO workspaces_active (assistant_id, workspace_id) VALUES ('__global__', ?)"
    ).run(id);
  } else {
    conn.prepare(
      "DELETE FROM workspaces_active WHERE assistant_id = '__global__'"
    ).run();
  }
}

/**
 * Resolve the workspace-scoped assistants data directory.
 * Uses a nested .assistants folder inside the workspace root.
 */
export function getWorkspaceDataDir(workspaceId: string, baseDir?: string): string {
  if (!isValidId(workspaceId)) {
    throw new Error(`Invalid workspace id: "${workspaceId}"`);
  }
  return join(getWorkspaceRoot(baseDir), workspaceId, '.assistants');
}

/**
 * Ensure the workspace data directory exists and has required subfolders.
 */
export function ensureWorkspaceDataDir(workspaceId: string, baseDir?: string): string {
  const dir = getWorkspaceDataDir(workspaceId, baseDir);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  initAssistantsDir(dir);
  return dir;
}

/**
 * Resolve the storage base directory for the active workspace.
 * If no workspace is active, returns the global config dir (unless fallback is disabled).
 */
export function resolveWorkspaceBaseDir(
  workspaceId?: string | null,
  options: { baseDir?: string; fallbackToConfigDir?: boolean } = {}
): string | null {
  const { baseDir, fallbackToConfigDir = true } = options;
  if (!workspaceId) {
    return fallbackToConfigDir ? getConfigDir() : null;
  }
  return ensureWorkspaceDataDir(workspaceId, baseDir);
}
