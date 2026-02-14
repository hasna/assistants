import { generateId } from '@hasna/assistants-shared';
import type { Assistant, AssistantSettings, CreateAssistantOptions } from './types';
import { IdentityManager } from './identity-manager';
import {
  getSystemAssistantDefinitions,
  buildSystemAssistant,
  isSystemAssistantId,
  DEFAULT_SYSTEM_ASSISTANT_ID,
} from './system-assistants';
import { getDatabase } from '../database';
import type { DatabaseConnection } from '../database';

function getDb(): DatabaseConnection {
  return getDatabase();
}

const DEFAULT_SETTINGS: AssistantSettings = {
  model: 'claude-opus-4-5',
};

interface AssistantRow {
  id: string;
  name: string;
  model: string | null;
  system_prompt: string | null;
  settings: string;
  identity_id: string | null;
  created_at: number;
  updated_at: number;
}

function rowToAssistant(row: AssistantRow): Assistant {
  const raw = JSON.parse(row.settings) as Record<string, unknown>;
  // Extract extra fields stored alongside settings
  const avatar = raw.__avatar as string | undefined;
  const description = raw.__description as string | undefined;
  const color = raw.__color as string | undefined;
  const isSystem = raw.__isSystem as boolean | undefined;

  // Remove extra fields before casting to AssistantSettings
  delete raw.__avatar;
  delete raw.__description;
  delete raw.__color;
  delete raw.__isSystem;

  const settings = raw as unknown as AssistantSettings;
  const assistant: Assistant = {
    id: row.id,
    name: row.name,
    settings,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
  if (row.identity_id) assistant.defaultIdentityId = row.identity_id;
  if (avatar) assistant.avatar = avatar;
  if (description) assistant.description = description;
  if (color) assistant.color = color;
  if (isSystem) assistant.isSystem = true;
  return assistant;
}

function assistantToRow(assistant: Assistant): {
  id: string;
  name: string;
  model: string | null;
  system_prompt: string | null;
  settings: string;
  identity_id: string | null;
  created_at: number;
  updated_at: number;
} {
  // Store extra fields inside settings JSON for round-tripping
  const settingsObj: Record<string, unknown> = { ...assistant.settings };
  if (assistant.avatar) settingsObj.__avatar = assistant.avatar;
  if (assistant.description) settingsObj.__description = assistant.description;
  if (assistant.color) settingsObj.__color = assistant.color;
  if (assistant.isSystem) settingsObj.__isSystem = true;

  return {
    id: assistant.id,
    name: assistant.name,
    model: assistant.settings.model || null,
    system_prompt: assistant.settings.systemPromptAddition || null,
    settings: JSON.stringify(settingsObj),
    identity_id: assistant.defaultIdentityId || null,
    created_at: new Date(assistant.createdAt).getTime(),
    updated_at: new Date(assistant.updatedAt).getTime(),
  };
}

export class AssistantManager {
  private basePath: string;
  private assistants: Map<string, Assistant> = new Map();
  private activeId: string | null = null;
  private db: DatabaseConnection;

  constructor(basePath: string, db?: DatabaseConnection) {
    this.basePath = basePath;
    this.db = db || getDb();
  }

  async initialize(): Promise<void> {
    // Load all assistants from DB
    const rows = this.db.query<AssistantRow>(
      'SELECT * FROM assistants_config'
    ).all();
    for (const row of rows) {
      try {
        const assistant = rowToAssistant(row);
        this.assistants.set(assistant.id, assistant);
      } catch {
        // Skip malformed rows
      }
    }

    // Seed system assistants if they don't exist
    await this.seedSystemAssistants();

    // Load active assistant
    const activeRow = this.db.query<{ assistant_id: string }>(
      "SELECT assistant_id FROM assistants_active WHERE key = 'active'"
    ).get();
    this.activeId = activeRow?.assistant_id || null;

    if (!this.activeId || !this.assistants.has(this.activeId)) {
      await this.setActive(DEFAULT_SYSTEM_ASSISTANT_ID);
    }
  }

  async createAssistant(options: CreateAssistantOptions): Promise<Assistant> {
    const id = generateId();
    const now = new Date().toISOString();
    const assistant: Assistant = {
      id,
      name: options.name,
      description: options.description,
      avatar: options.avatar,
      color: options.color,
      settings: { ...DEFAULT_SETTINGS, ...(options.settings || {}) },
      createdAt: now,
      updatedAt: now,
    };

    this.persistAssistant(assistant);
    this.assistants.set(id, assistant);
    await this.setActive(id);
    return assistant;
  }

  async updateAssistant(id: string, updates: Partial<Assistant>): Promise<Assistant> {
    const existing = this.assistants.get(id);
    if (!existing) {
      throw new Error(`Assistant ${id} not found`);
    }
    const updated: Assistant = {
      ...existing,
      ...updates,
      settings: { ...existing.settings, ...(updates.settings || {}) },
      updatedAt: new Date().toISOString(),
    };
    this.persistAssistant(updated);
    this.assistants.set(id, updated);
    return updated;
  }

  async deleteAssistant(id: string): Promise<void> {
    if (!this.assistants.has(id)) {
      throw new Error(`Assistant ${id} not found`);
    }
    // Protect system assistants from deletion
    const assistant = this.assistants.get(id);
    if (assistant?.isSystem || isSystemAssistantId(id)) {
      throw new Error(`Cannot delete system assistant "${assistant?.name || id}". System assistants are built-in and cannot be removed.`);
    }
    this.db.prepare('DELETE FROM assistants_config WHERE id = ?').run(id);
    this.assistants.delete(id);

    if (this.activeId === id) {
      const next = this.listAssistants()[0];
      await this.setActive(next?.id || null);
    }
  }

  async switchAssistant(id: string): Promise<Assistant> {
    const assistant = this.assistants.get(id);
    if (!assistant) {
      throw new Error(`Assistant ${id} not found`);
    }
    await this.setActive(id);
    return assistant;
  }

  getActive(): Assistant | null {
    if (!this.activeId) return null;
    return this.assistants.get(this.activeId) || null;
  }

  getActiveId(): string | null {
    return this.activeId;
  }

  listAssistants(): Assistant[] {
    return Array.from(this.assistants.values()).sort((a, b) =>
      a.updatedAt.localeCompare(b.updatedAt)
    );
  }

  getIdentityManager(assistantId: string): IdentityManager {
    return new IdentityManager(assistantId, this.basePath);
  }

  /**
   * Seed system assistants (Marcus, Claude, Codex) if they don't already exist.
   */
  private async seedSystemAssistants(): Promise<void> {
    const definitions = getSystemAssistantDefinitions();
    for (const def of definitions) {
      if (!this.assistants.has(def.id)) {
        const assistant = buildSystemAssistant(def);
        this.persistAssistant(assistant);
        this.assistants.set(def.id, assistant);
      }
    }
  }

  private persistAssistant(assistant: Assistant): void {
    const row = assistantToRow(assistant);
    this.db.prepare(
      `INSERT OR REPLACE INTO assistants_config (id, name, model, system_prompt, settings, identity_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      row.id,
      row.name,
      row.model,
      row.system_prompt,
      row.settings,
      row.identity_id,
      row.created_at,
      row.updated_at,
    );
  }

  private async setActive(id: string | null): Promise<void> {
    this.activeId = id;
    if (id) {
      this.db.prepare(
        "INSERT OR REPLACE INTO assistants_active (key, assistant_id) VALUES ('active', ?)"
      ).run(id);
    } else {
      this.db.prepare("DELETE FROM assistants_active WHERE key = 'active'").run();
    }
  }
}
