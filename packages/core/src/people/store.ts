/**
 * PeopleStore - SQLite-based storage for people
 *
 * Migrated from file-based JSON storage to unified SQLite database.
 * Tables: people, people_active
 */

import { generateId } from '@hasna/assistants-shared';
import { getDatabase } from '../database';
import type { DatabaseConnection } from '../database';
import type { Person, PersonListItem } from './types';

function getDb(): DatabaseConnection {
  return getDatabase();
}

interface PeopleRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: string | null;
  notes: string | null;
  avatar_url: string | null;
  metadata: string | null;
  created_at: number;
  updated_at: number;
}

function rowToPerson(row: PeopleRow): Person {
  const person: Person = {
    id: row.id,
    name: row.name,
    status: 'active',
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
  if (row.email) person.email = row.email;
  if (row.phone) person.phone = row.phone;
  if (row.role) person.role = row.role;
  if (row.notes) person.notes = row.notes;
  if (row.avatar_url) person.avatar = row.avatar_url;
  // Restore extra fields from metadata
  if (row.metadata) {
    try {
      const meta = JSON.parse(row.metadata) as Record<string, unknown>;
      if (meta.status) person.status = meta.status as Person['status'];
      if (meta.defaultIdentityId) person.defaultIdentityId = meta.defaultIdentityId as string;
    } catch {
      // Ignore malformed metadata
    }
  }
  return person;
}

export class PeopleStore {
  private people: Map<string, Person> = new Map();
  private activeId: string | null = null;
  private db: DatabaseConnection;

  constructor(db?: DatabaseConnection) {
    this.db = db || getDb();
  }

  async initialize(): Promise<void> {
    // Load all people from DB
    const rows = this.db.query<PeopleRow>('SELECT * FROM people').all();
    for (const row of rows) {
      try {
        const person = rowToPerson(row);
        this.people.set(person.id, person);
      } catch {
        // Skip malformed rows
      }
    }

    // Load active person
    const activeRow = this.db.query<{ person_id: string }>(
      "SELECT person_id FROM people_active WHERE key = 'active'"
    ).get();
    this.activeId = activeRow?.person_id || null;
  }

  // ============================================
  // CRUD
  // ============================================

  async create(name: string, email?: string, phone?: string, role?: string, notes?: string, avatar?: string): Promise<Person> {
    const id = `person_${generateId().slice(0, 12)}`;
    const now = new Date().toISOString();
    const person: Person = {
      id,
      name,
      email,
      phone,
      role,
      notes,
      avatar,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };

    this.persistPerson(person);
    this.people.set(id, person);
    return person;
  }

  async update(id: string, updates: Partial<Omit<Person, 'id' | 'createdAt'>>): Promise<Person> {
    const existing = this.people.get(id);
    if (!existing) {
      throw new Error(`Person ${id} not found`);
    }
    const updated: Person = {
      ...existing,
      ...updates,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };
    this.persistPerson(updated);
    this.people.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<void> {
    this.db.prepare('DELETE FROM people WHERE id = ?').run(id);
    this.people.delete(id);

    if (this.activeId === id) {
      await this.setActive(null);
    }
  }

  get(id: string): Person | null {
    return this.people.get(id) || null;
  }

  getByName(name: string): Person | null {
    const lower = name.toLowerCase();
    for (const person of this.people.values()) {
      if (person.name.toLowerCase() === lower) {
        return person;
      }
    }
    return null;
  }

  /**
   * Resolve a person by name or ID
   */
  resolve(nameOrId: string): Person | null {
    return this.get(nameOrId) || this.getByName(nameOrId);
  }

  list(): PersonListItem[] {
    return Array.from(this.people.values()).map((p) => ({
      id: p.id,
      name: p.name,
      email: p.email,
      phone: p.phone,
      role: p.role,
      status: p.status,
      isActive: p.id === this.activeId,
    }));
  }

  // ============================================
  // Active Person
  // ============================================

  getActive(): Person | null {
    if (!this.activeId) return null;
    return this.people.get(this.activeId) || null;
  }

  getActiveId(): string | null {
    return this.activeId;
  }

  async setActive(id: string | null): Promise<void> {
    if (id !== null) {
      const person = this.people.get(id);
      if (!person) {
        throw new Error(`Person ${id} not found`);
      }
    }
    this.activeId = id;
    if (id) {
      this.db.prepare(
        "INSERT OR REPLACE INTO people_active (key, person_id) VALUES ('active', ?)"
      ).run(id);
    } else {
      this.db.prepare("DELETE FROM people_active WHERE key = 'active'").run();
    }
  }

  // ============================================
  // DB Persistence
  // ============================================

  private persistPerson(person: Person): void {
    const nowMs = new Date(person.updatedAt).getTime();
    const createdMs = new Date(person.createdAt).getTime();
    // Store extra fields as metadata JSON
    const metadata: Record<string, unknown> = {};
    if (person.status !== 'active') metadata.status = person.status;
    if (person.defaultIdentityId) metadata.defaultIdentityId = person.defaultIdentityId;
    const metadataStr = Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : null;

    this.db.prepare(
      `INSERT OR REPLACE INTO people (id, name, email, phone, role, notes, avatar_url, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      person.id,
      person.name,
      person.email || null,
      person.phone || null,
      person.role || null,
      person.notes || null,
      person.avatar || null,
      metadataStr,
      createdMs,
      nowMs,
    );
  }
}
