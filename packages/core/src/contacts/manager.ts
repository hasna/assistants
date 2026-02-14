/**
 * ContactsManager - Manages contacts address book
 *
 * Thin validation layer over the contacts store.
 */

import { ContactsStore } from './store';
import type {
  Contact,
  ContactListItem,
  ContactGroup,
  CreateContactOptions,
  UpdateContactOptions,
  ContactsListOptions,
  ContactRelationship,
} from './types';

const VALID_RELATIONSHIPS: ContactRelationship[] = ['friend', 'colleague', 'vendor', 'client', 'family', 'other'];
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export class ContactsManager {
  private store: ContactsStore;

  constructor(store?: ContactsStore) {
    this.store = store || new ContactsStore();
  }

  // ============================================
  // Contact CRUD
  // ============================================

  createContact(options: CreateContactOptions): Contact {
    if (!options.name || !options.name.trim()) {
      throw new Error('Contact name is required.');
    }

    if (options.relationship && !VALID_RELATIONSHIPS.includes(options.relationship)) {
      throw new Error(`Invalid relationship: ${options.relationship}. Must be one of: ${VALID_RELATIONSHIPS.join(', ')}`);
    }

    if (options.birthday && !ISO_DATE_REGEX.test(options.birthday)) {
      throw new Error('Birthday must be in ISO format (YYYY-MM-DD).');
    }

    if (options.emails) {
      for (const e of options.emails) {
        if (!EMAIL_REGEX.test(e.email)) {
          throw new Error(`Invalid email format: ${e.email}`);
        }
      }
    }

    return this.store.createContact(options.name.trim(), options);
  }

  getContact(id: string): Contact | null {
    return this.store.getContact(id);
  }

  updateContact(id: string, updates: UpdateContactOptions): Contact | null {
    if (updates.name !== undefined && !updates.name.trim()) {
      throw new Error('Contact name cannot be empty.');
    }

    if (updates.relationship && !VALID_RELATIONSHIPS.includes(updates.relationship)) {
      throw new Error(`Invalid relationship: ${updates.relationship}. Must be one of: ${VALID_RELATIONSHIPS.join(', ')}`);
    }

    if (updates.birthday && !ISO_DATE_REGEX.test(updates.birthday)) {
      throw new Error('Birthday must be in ISO format (YYYY-MM-DD).');
    }

    if (updates.emails) {
      for (const e of updates.emails) {
        if (!EMAIL_REGEX.test(e.email)) {
          throw new Error(`Invalid email format: ${e.email}`);
        }
      }
    }

    return this.store.updateContact(id, updates);
  }

  deleteContact(id: string): boolean {
    return this.store.deleteContact(id);
  }

  listContacts(options?: ContactsListOptions): ContactListItem[] {
    return this.store.listContacts(options);
  }

  searchContacts(query: string): ContactListItem[] {
    if (!query.trim()) {
      return this.store.listContacts();
    }
    return this.store.searchContacts(query.trim());
  }

  // ============================================
  // Group CRUD
  // ============================================

  createGroup(name: string, description?: string): ContactGroup {
    if (!name || !name.trim()) {
      throw new Error('Group name is required.');
    }

    const existing = this.store.getGroupByName(name.trim());
    if (existing) {
      throw new Error(`Group "${name.trim()}" already exists.`);
    }

    return this.store.createGroup(name.trim(), description);
  }

  deleteGroup(id: string): boolean {
    return this.store.deleteGroup(id);
  }

  listGroups(): ContactGroup[] {
    return this.store.listGroups();
  }

  resolveGroup(nameOrId: string): ContactGroup | null {
    return this.store.resolveGroup(nameOrId);
  }

  addGroupMember(groupId: string, contactId: string): boolean {
    const group = this.store.getGroup(groupId);
    if (!group) throw new Error(`Group not found: ${groupId}`);
    const contact = this.store.getContact(contactId);
    if (!contact) throw new Error(`Contact not found: ${contactId}`);
    return this.store.addGroupMember(groupId, contactId);
  }

  removeGroupMember(groupId: string, contactId: string): boolean {
    return this.store.removeGroupMember(groupId, contactId);
  }

  getGroupMembers(groupId: string): ContactListItem[] {
    return this.store.getGroupMembers(groupId);
  }

  // ============================================
  // Cleanup
  // ============================================

  close(): void {
    this.store.close();
  }
}

/**
 * Factory: create a ContactsManager (sync - no async init needed)
 */
export function createContactsManager(): ContactsManager {
  return new ContactsManager();
}
