/**
 * SharedWorkspaceManager - Manages shared workspaces for agent collaboration
 *
 * Workspace metadata is stored in the unified SQLite database.
 * Workspace files (shared/, assistants/ dirs) remain on disk.
 *
 * Tables: workspaces
 */

import { join } from 'path';
import {
  existsSync,
  mkdirSync,
  rmSync,
  renameSync,
  readdirSync,
} from 'fs';
import { generateId } from '@hasna/assistants-shared';
import { getConfigDir } from '../config';
import { getDatabase } from '../database';
import type { DatabaseConnection } from '../database';

function getDb(): DatabaseConnection {
  return getDatabase();
}

/**
 * Workspace metadata
 */
export interface SharedWorkspace {
  id: string;
  name: string;
  description?: string;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  participants: string[];
  status: 'active' | 'archived';
}

interface WorkspaceRow {
  id: string;
  name: string;
  description: string | null;
  creator_id: string;
  creator_name: string;
  status: string;
  participants: string;
  created_at: string;
  updated_at: string;
}

function rowToWorkspace(row: WorkspaceRow): SharedWorkspace {
  let participants: string[] = [];
  try {
    participants = JSON.parse(row.participants);
  } catch {
    participants = [];
  }
  return {
    id: row.id,
    name: row.name,
    description: row.description || undefined,
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
    createdBy: row.creator_id,
    participants,
    status: row.status as 'active' | 'archived',
  };
}

/**
 * SharedWorkspaceManager - creates and manages shared workspaces
 */
export class SharedWorkspaceManager {
  private basePath: string;
  private db: DatabaseConnection;

  constructor(basePath?: string, db?: DatabaseConnection) {
    this.basePath = basePath || join(getConfigDir(), 'workspaces');
    this.db = db || getDb();
    this.ensureDir();
    this.migrateAgentsToAssistants();
  }

  private ensureDir(): void {
    if (!existsSync(this.basePath)) {
      mkdirSync(this.basePath, { recursive: true });
    }
  }

  /**
   * Migrate existing workspaces from agents/ to assistants/ directory structure
   */
  private migrateAgentsToAssistants(): void {
    try {
      const dirs = readdirSync(this.basePath, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);

      for (const dir of dirs) {
        const wsPath = join(this.basePath, dir);
        const oldAgentsDir = join(wsPath, 'agents');
        const newAssistantsDir = join(wsPath, 'assistants');

        if (existsSync(oldAgentsDir) && !existsSync(newAssistantsDir)) {
          renameSync(oldAgentsDir, newAssistantsDir);
        }
      }
    } catch {
      // Migration is best-effort; don't fail startup
    }
  }

  private getWorkspacePath(id: string): string {
    return join(this.basePath, id);
  }

  /**
   * Create a new shared workspace
   */
  create(
    name: string,
    createdBy: string,
    participants: string[],
    description?: string
  ): SharedWorkspace {
    const id = `ws_${generateId().slice(0, 8)}`;
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const allParticipants = [...new Set([createdBy, ...participants])];

    const workspace: SharedWorkspace = {
      id,
      name,
      description,
      createdAt: now,
      updatedAt: now,
      createdBy,
      participants: allParticipants,
      status: 'active',
    };

    // Create directory structure on disk
    const wsPath = this.getWorkspacePath(id);
    mkdirSync(join(wsPath, 'shared'), { recursive: true });

    // Create per-assistant directories
    for (const assistantId of allParticipants) {
      mkdirSync(join(wsPath, 'assistants', assistantId), { recursive: true });
    }

    // Save metadata to DB
    this.db.prepare(
      `INSERT INTO workspaces (id, name, description, creator_id, creator_name, status, participants, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      name,
      description || null,
      createdBy,
      createdBy, // creator_name same as creator_id for now
      'active',
      JSON.stringify(allParticipants),
      nowIso,
      nowIso,
    );

    return workspace;
  }

  /**
   * Join an existing workspace
   */
  join(workspaceId: string, assistantId: string): void {
    const workspace = this.get(workspaceId);
    if (!workspace) {
      throw new Error(`Workspace ${workspaceId} not found`);
    }

    if (!workspace.participants.includes(assistantId)) {
      workspace.participants.push(assistantId);
      workspace.updatedAt = Date.now();
      this.db.prepare(
        'UPDATE workspaces SET participants = ?, updated_at = ? WHERE id = ?'
      ).run(
        JSON.stringify(workspace.participants),
        new Date(workspace.updatedAt).toISOString(),
        workspaceId,
      );
    }

    // Ensure assistant directory exists on disk
    const assistantDir = join(this.getWorkspacePath(workspaceId), 'assistants', assistantId);
    if (!existsSync(assistantDir)) {
      mkdirSync(assistantDir, { recursive: true });
    }
  }

  /**
   * Get workspace metadata
   */
  get(workspaceId: string): SharedWorkspace | null {
    const row = this.db.query<WorkspaceRow>(
      'SELECT * FROM workspaces WHERE id = ?'
    ).get(workspaceId);
    if (!row) return null;
    return rowToWorkspace(row);
  }

  /**
   * Get the filesystem path for a workspace
   */
  getPath(workspaceId: string): string {
    return this.getWorkspacePath(workspaceId);
  }

  /**
   * Get the shared directory path for a workspace
   */
  getSharedPath(workspaceId: string): string {
    return join(this.getWorkspacePath(workspaceId), 'shared');
  }

  /**
   * Get an assistant's directory in a workspace
   */
  getAssistantPath(workspaceId: string, assistantId: string): string {
    return join(this.getWorkspacePath(workspaceId), 'assistants', assistantId);
  }

  /**
   * List all workspaces
   */
  list(includeArchived = false): SharedWorkspace[] {
    const query = includeArchived
      ? 'SELECT * FROM workspaces ORDER BY updated_at DESC'
      : "SELECT * FROM workspaces WHERE status = 'active' ORDER BY updated_at DESC";
    const rows = this.db.query<WorkspaceRow>(query).all();
    return rows.map(rowToWorkspace);
  }

  /**
   * List workspaces that a specific agent participates in
   */
  listForAgent(assistantId: string): SharedWorkspace[] {
    return this.list().filter((ws) => ws.participants.includes(assistantId));
  }

  /**
   * Archive a workspace
   */
  archive(workspaceId: string): void {
    const workspace = this.get(workspaceId);
    if (workspace) {
      this.db.prepare(
        "UPDATE workspaces SET status = 'archived', updated_at = ? WHERE id = ?"
      ).run(new Date().toISOString(), workspaceId);
    }
  }

  /**
   * Delete a workspace and all its contents
   */
  delete(workspaceId: string): void {
    // Remove from DB
    this.db.prepare('DELETE FROM workspaces WHERE id = ?').run(workspaceId);

    // Remove files from disk
    const wsPath = this.getWorkspacePath(workspaceId);
    if (existsSync(wsPath)) {
      rmSync(wsPath, { recursive: true, force: true });
    }
  }
}
