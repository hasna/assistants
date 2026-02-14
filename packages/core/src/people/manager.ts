/**
 * PeopleManager - Manages human participants
 *
 * Handles CRUD for people and active person tracking.
 */

import { PeopleStore } from './store';
import type { Person, PersonListItem, CreatePersonOptions } from './types';

export class PeopleManager {
  private store: PeopleStore;

  constructor(store?: PeopleStore) {
    this.store = store || new PeopleStore();
  }

  async initialize(): Promise<void> {
    await this.store.initialize();
  }

  // ============================================
  // CRUD
  // ============================================

  async createPerson(options: CreatePersonOptions): Promise<Person> {
    // Check for duplicate name
    const existing = this.store.getByName(options.name);
    if (existing) {
      throw new Error(`Person "${options.name}" already exists.`);
    }
    return this.store.create(options.name, options.email, options.phone, options.role, options.notes, options.avatar);
  }

  async updatePerson(id: string, updates: Partial<Omit<Person, 'id' | 'createdAt'>>): Promise<Person> {
    return this.store.update(id, updates);
  }

  async deletePerson(nameOrId: string): Promise<void> {
    const person = this.store.resolve(nameOrId);
    if (!person) {
      throw new Error(`Person "${nameOrId}" not found.`);
    }
    await this.store.delete(person.id);
  }

  getPerson(nameOrId: string): Person | null {
    return this.store.resolve(nameOrId);
  }

  listPeople(): PersonListItem[] {
    return this.store.list();
  }

  // ============================================
  // Active Person
  // ============================================

  getActivePerson(): Person | null {
    return this.store.getActive();
  }

  getActivePersonId(): string | null {
    return this.store.getActiveId();
  }

  async setActivePerson(nameOrId: string): Promise<Person> {
    const person = this.store.resolve(nameOrId);
    if (!person) {
      throw new Error(`Person "${nameOrId}" not found.`);
    }
    await this.store.setActive(person.id);
    return person;
  }

  async logout(): Promise<void> {
    await this.store.setActive(null);
  }
}

/**
 * Factory: create and initialize a PeopleManager
 */
export async function createPeopleManager(): Promise<PeopleManager> {
  const manager = new PeopleManager();
  await manager.initialize();
  return manager;
}
