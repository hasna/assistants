/**
 * ContactsStore - SQLite storage for contacts and groups
 *
 * Manages contacts, multi-value sub-entities (emails, phones, addresses, social),
 * tags, groups, and group memberships in a shared SQLite database.
 */

import { generateId } from '@hasna/assistants-shared';
import { getDatabase } from '../database';
import type { DatabaseConnection } from '../runtime';
import type {
  Contact,
  ContactEmail,
  ContactPhone,
  ContactAddress,
  ContactSocial,
  ContactGroupRef,
  ContactListItem,
  ContactGroup,
  ContactRelationship,
  ContactsListOptions,
} from './types';

function generateContactId(): string {
  return `ct_${generateId().slice(0, 12)}`;
}

function generateGroupId(): string {
  return `grp_${generateId().slice(0, 12)}`;
}

export class ContactsStore {
  private db: DatabaseConnection;

  constructor(db?: DatabaseConnection) {
    this.db = db || getDatabase();
  }

  // ============================================
  // Contact CRUD
  // ============================================

  createContact(
    name: string,
    options?: Omit<import('./types').CreateContactOptions, 'name'>
  ): Contact {
    const id = generateContactId();
    const now = Date.now();

    this.db.transaction(() => {
      this.db.prepare(
        `INSERT INTO contacts (id, name, company, title, birthday, relationship, notes, favorite, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        name,
        options?.company || null,
        options?.title || null,
        options?.birthday || null,
        options?.relationship || 'other',
        options?.notes || null,
        options?.favorite ? 1 : 0,
        now,
        now
      );

      // Insert emails
      if (options?.emails) {
        const stmt = this.db.prepare(
          'INSERT INTO contact_emails (contact_id, email, label, is_primary) VALUES (?, ?, ?, ?)'
        );
        for (const e of options.emails) {
          stmt.run(id, e.email, e.label || 'personal', e.isPrimary ? 1 : 0);
        }
      }

      // Insert phones
      if (options?.phones) {
        const stmt = this.db.prepare(
          'INSERT INTO contact_phones (contact_id, phone, label, is_primary) VALUES (?, ?, ?, ?)'
        );
        for (const p of options.phones) {
          stmt.run(id, p.phone, p.label || 'mobile', p.isPrimary ? 1 : 0);
        }
      }

      // Insert addresses
      if (options?.addresses) {
        const stmt = this.db.prepare(
          'INSERT INTO contact_addresses (contact_id, street, city, state, postal_code, country, label) VALUES (?, ?, ?, ?, ?, ?, ?)'
        );
        for (const a of options.addresses) {
          stmt.run(id, a.street || null, a.city || null, a.state || null, a.postalCode || null, a.country || null, a.label || 'home');
        }
      }

      // Insert social
      if (options?.social) {
        const stmt = this.db.prepare(
          'INSERT INTO contact_social (contact_id, platform, handle) VALUES (?, ?, ?)'
        );
        for (const s of options.social) {
          stmt.run(id, s.platform, s.handle);
        }
      }

      // Insert tags
      if (options?.tags) {
        const stmt = this.db.prepare(
          'INSERT INTO contact_tags (contact_id, tag) VALUES (?, ?)'
        );
        for (const tag of options.tags) {
          stmt.run(id, tag);
        }
      }
    });
    return this.getContact(id)!;
  }

  getContact(id: string): Contact | null {
    const row = this.db.prepare('SELECT * FROM contacts WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.buildContact(row);
  }

  updateContact(
    id: string,
    updates: import('./types').UpdateContactOptions
  ): Contact | null {
    const existing = this.getContact(id);
    if (!existing) return null;

    const now = Date.now();

    this.db.transaction(() => {
      // Update core fields
      const sets: string[] = ['updated_at = ?'];
      const params: unknown[] = [now];

      if (updates.name !== undefined) { sets.push('name = ?'); params.push(updates.name); }
      if (updates.company !== undefined) { sets.push('company = ?'); params.push(updates.company || null); }
      if (updates.title !== undefined) { sets.push('title = ?'); params.push(updates.title || null); }
      if (updates.birthday !== undefined) { sets.push('birthday = ?'); params.push(updates.birthday || null); }
      if (updates.relationship !== undefined) { sets.push('relationship = ?'); params.push(updates.relationship); }
      if (updates.notes !== undefined) { sets.push('notes = ?'); params.push(updates.notes || null); }
      if (updates.favorite !== undefined) { sets.push('favorite = ?'); params.push(updates.favorite ? 1 : 0); }

      params.push(id);
      this.db.prepare(`UPDATE contacts SET ${sets.join(', ')} WHERE id = ?`).run(...params);

      // Replace emails if provided
      if (updates.emails !== undefined) {
        this.db.prepare('DELETE FROM contact_emails WHERE contact_id = ?').run(id);
        const stmt = this.db.prepare(
          'INSERT INTO contact_emails (contact_id, email, label, is_primary) VALUES (?, ?, ?, ?)'
        );
        for (const e of updates.emails) {
          stmt.run(id, e.email, e.label || 'personal', e.isPrimary ? 1 : 0);
        }
      }

      // Replace phones if provided
      if (updates.phones !== undefined) {
        this.db.prepare('DELETE FROM contact_phones WHERE contact_id = ?').run(id);
        const stmt = this.db.prepare(
          'INSERT INTO contact_phones (contact_id, phone, label, is_primary) VALUES (?, ?, ?, ?)'
        );
        for (const p of updates.phones) {
          stmt.run(id, p.phone, p.label || 'mobile', p.isPrimary ? 1 : 0);
        }
      }

      // Replace addresses if provided
      if (updates.addresses !== undefined) {
        this.db.prepare('DELETE FROM contact_addresses WHERE contact_id = ?').run(id);
        const stmt = this.db.prepare(
          'INSERT INTO contact_addresses (contact_id, street, city, state, postal_code, country, label) VALUES (?, ?, ?, ?, ?, ?, ?)'
        );
        for (const a of updates.addresses) {
          stmt.run(id, a.street || null, a.city || null, a.state || null, a.postalCode || null, a.country || null, a.label || 'home');
        }
      }

      // Replace social if provided
      if (updates.social !== undefined) {
        this.db.prepare('DELETE FROM contact_social WHERE contact_id = ?').run(id);
        const stmt = this.db.prepare(
          'INSERT INTO contact_social (contact_id, platform, handle) VALUES (?, ?, ?)'
        );
        for (const s of updates.social) {
          stmt.run(id, s.platform, s.handle);
        }
      }

      // Replace tags if provided
      if (updates.tags !== undefined) {
        this.db.prepare('DELETE FROM contact_tags WHERE contact_id = ?').run(id);
        const stmt = this.db.prepare(
          'INSERT INTO contact_tags (contact_id, tag) VALUES (?, ?)'
        );
        for (const tag of updates.tags) {
          stmt.run(id, tag);
        }
      }
    });
    return this.getContact(id);
  }

  deleteContact(id: string): boolean {
    // Sub-entities are deleted by ON DELETE CASCADE
    const result = this.db.prepare('DELETE FROM contacts WHERE id = ?').run(id);
    return (result as { changes: number }).changes > 0;
  }

  listContacts(options?: ContactsListOptions): ContactListItem[] {
    let query = `
      SELECT DISTINCT c.id, c.name, c.company, c.relationship, c.favorite
      FROM contacts c
    `;
    const joins: string[] = [];
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (options?.tag) {
      joins.push('JOIN contact_tags ct ON ct.contact_id = c.id');
      conditions.push('ct.tag = ?');
      params.push(options.tag);
    }

    if (options?.group) {
      joins.push('JOIN contact_group_members cgm ON cgm.contact_id = c.id');
      const group = this.resolveGroup(options.group);
      if (group) {
        conditions.push('cgm.group_id = ?');
        params.push(group.id);
      } else {
        return [];
      }
    }

    if (options?.query) {
      joins.push('LEFT JOIN contact_emails ce_q ON ce_q.contact_id = c.id');
      joins.push('LEFT JOIN contact_phones cp_q ON cp_q.contact_id = c.id');
      conditions.push(
        `(c.name LIKE ? OR c.company LIKE ? OR c.notes LIKE ? OR ce_q.email LIKE ? OR cp_q.phone LIKE ?)`
      );
      const like = `%${options.query}%`;
      params.push(like, like, like, like, like);
    }

    if (options?.relationship) {
      conditions.push('c.relationship = ?');
      params.push(options.relationship);
    }

    if (options?.favorite !== undefined) {
      conditions.push('c.favorite = ?');
      params.push(options.favorite ? 1 : 0);
    }

    if (joins.length > 0) {
      query += ' ' + joins.join(' ');
    }
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' ORDER BY c.favorite DESC, c.name ASC';

    if (options?.limit) {
      query += ' LIMIT ?';
      params.push(options.limit);
    }
    if (options?.offset) {
      query += ' OFFSET ?';
      params.push(options.offset);
    }

    const rows = this.db.prepare(query).all(...params) as Record<string, unknown>[];

    return rows.map((row) => {
      const contactId = String(row.id);
      const primaryEmail = this.db.prepare(
        'SELECT email FROM contact_emails WHERE contact_id = ? ORDER BY is_primary DESC LIMIT 1'
      ).get(contactId) as Record<string, unknown> | undefined;
      const primaryPhone = this.db.prepare(
        'SELECT phone FROM contact_phones WHERE contact_id = ? ORDER BY is_primary DESC LIMIT 1'
      ).get(contactId) as Record<string, unknown> | undefined;
      const tags = this.db.prepare(
        'SELECT tag FROM contact_tags WHERE contact_id = ?'
      ).all(contactId) as Record<string, unknown>[];

      return {
        id: contactId,
        name: String(row.name),
        company: row.company ? String(row.company) : undefined,
        primaryEmail: primaryEmail ? String(primaryEmail.email) : undefined,
        primaryPhone: primaryPhone ? String(primaryPhone.phone) : undefined,
        favorite: Number(row.favorite) === 1,
        tags: tags.map((t) => String(t.tag)),
        relationship: String(row.relationship) as ContactRelationship,
      };
    });
  }

  searchContacts(query: string): ContactListItem[] {
    return this.listContacts({ query });
  }

  // ============================================
  // Group CRUD
  // ============================================

  createGroup(name: string, description?: string): ContactGroup {
    const id = generateGroupId();
    const now = Date.now();

    this.db.prepare(
      'INSERT INTO contact_groups (id, name, description, created_at) VALUES (?, ?, ?, ?)'
    ).run(id, name, description || null, now);

    return { id, name, description, memberCount: 0, createdAt: now };
  }

  getGroup(id: string): ContactGroup | null {
    const row = this.db.prepare(
      `SELECT g.*, (SELECT COUNT(*) FROM contact_group_members WHERE group_id = g.id) as member_count
       FROM contact_groups g WHERE g.id = ?`
    ).get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToGroup(row) : null;
  }

  getGroupByName(name: string): ContactGroup | null {
    const row = this.db.prepare(
      `SELECT g.*, (SELECT COUNT(*) FROM contact_group_members WHERE group_id = g.id) as member_count
       FROM contact_groups g WHERE LOWER(g.name) = LOWER(?)`
    ).get(name) as Record<string, unknown> | undefined;
    return row ? this.rowToGroup(row) : null;
  }

  resolveGroup(nameOrId: string): ContactGroup | null {
    return this.getGroup(nameOrId) || this.getGroupByName(nameOrId);
  }

  deleteGroup(id: string): boolean {
    const result = this.db.prepare('DELETE FROM contact_groups WHERE id = ?').run(id);
    return (result as { changes: number }).changes > 0;
  }

  listGroups(): ContactGroup[] {
    const rows = this.db.prepare(
      `SELECT g.*, (SELECT COUNT(*) FROM contact_group_members WHERE group_id = g.id) as member_count
       FROM contact_groups g ORDER BY g.name ASC`
    ).all() as Record<string, unknown>[];
    return rows.map((row) => this.rowToGroup(row));
  }

  addGroupMember(groupId: string, contactId: string): boolean {
    try {
      this.db.prepare(
        'INSERT OR IGNORE INTO contact_group_members (group_id, contact_id) VALUES (?, ?)'
      ).run(groupId, contactId);
      return true;
    } catch {
      return false;
    }
  }

  removeGroupMember(groupId: string, contactId: string): boolean {
    const result = this.db.prepare(
      'DELETE FROM contact_group_members WHERE group_id = ? AND contact_id = ?'
    ).run(groupId, contactId);
    return (result as { changes: number }).changes > 0;
  }

  getGroupMembers(groupId: string): ContactListItem[] {
    const rows = this.db.prepare(
      `SELECT c.id, c.name, c.company, c.relationship, c.favorite
       FROM contacts c
       JOIN contact_group_members cgm ON cgm.contact_id = c.id
       WHERE cgm.group_id = ?
       ORDER BY c.name ASC`
    ).all(groupId) as Record<string, unknown>[];

    return rows.map((row) => {
      const contactId = String(row.id);
      const primaryEmail = this.db.prepare(
        'SELECT email FROM contact_emails WHERE contact_id = ? ORDER BY is_primary DESC LIMIT 1'
      ).get(contactId) as Record<string, unknown> | undefined;
      const primaryPhone = this.db.prepare(
        'SELECT phone FROM contact_phones WHERE contact_id = ? ORDER BY is_primary DESC LIMIT 1'
      ).get(contactId) as Record<string, unknown> | undefined;
      const tags = this.db.prepare(
        'SELECT tag FROM contact_tags WHERE contact_id = ?'
      ).all(contactId) as Record<string, unknown>[];

      return {
        id: contactId,
        name: String(row.name),
        company: row.company ? String(row.company) : undefined,
        primaryEmail: primaryEmail ? String(primaryEmail.email) : undefined,
        primaryPhone: primaryPhone ? String(primaryPhone.phone) : undefined,
        favorite: Number(row.favorite) === 1,
        tags: tags.map((t) => String(t.tag)),
        relationship: String(row.relationship) as ContactRelationship,
      };
    });
  }

  // ============================================
  // Cleanup
  // ============================================

  close(): void { }

  // ============================================
  // Private Helpers
  // ============================================

  private buildContact(row: Record<string, unknown>): Contact {
    const id = String(row.id);

    const emailRows = this.db.prepare(
      'SELECT * FROM contact_emails WHERE contact_id = ? ORDER BY is_primary DESC'
    ).all(id) as Record<string, unknown>[];

    const phoneRows = this.db.prepare(
      'SELECT * FROM contact_phones WHERE contact_id = ? ORDER BY is_primary DESC'
    ).all(id) as Record<string, unknown>[];

    const addressRows = this.db.prepare(
      'SELECT * FROM contact_addresses WHERE contact_id = ?'
    ).all(id) as Record<string, unknown>[];

    const socialRows = this.db.prepare(
      'SELECT * FROM contact_social WHERE contact_id = ?'
    ).all(id) as Record<string, unknown>[];

    const tagRows = this.db.prepare(
      'SELECT tag FROM contact_tags WHERE contact_id = ?'
    ).all(id) as Record<string, unknown>[];

    const groupRows = this.db.prepare(
      `SELECT g.id, g.name FROM contact_groups g
       JOIN contact_group_members cgm ON cgm.group_id = g.id
       WHERE cgm.contact_id = ?`
    ).all(id) as Record<string, unknown>[];

    return {
      id,
      name: String(row.name),
      company: row.company ? String(row.company) : undefined,
      title: row.title ? String(row.title) : undefined,
      birthday: row.birthday ? String(row.birthday) : undefined,
      relationship: String(row.relationship) as ContactRelationship,
      notes: row.notes ? String(row.notes) : undefined,
      favorite: Number(row.favorite) === 1,
      emails: emailRows.map((e) => this.rowToEmail(e)),
      phones: phoneRows.map((p) => this.rowToPhone(p)),
      addresses: addressRows.map((a) => this.rowToAddress(a)),
      social: socialRows.map((s) => this.rowToSocial(s)),
      tags: tagRows.map((t) => String(t.tag)),
      groups: groupRows.map((g) => ({ id: String(g.id), name: String(g.name) } as ContactGroupRef)),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  }

  private rowToEmail(row: Record<string, unknown>): ContactEmail {
    return {
      id: Number(row.id),
      contactId: String(row.contact_id),
      email: String(row.email),
      label: String(row.label),
      isPrimary: Number(row.is_primary) === 1,
    };
  }

  private rowToPhone(row: Record<string, unknown>): ContactPhone {
    return {
      id: Number(row.id),
      contactId: String(row.contact_id),
      phone: String(row.phone),
      label: String(row.label),
      isPrimary: Number(row.is_primary) === 1,
    };
  }

  private rowToAddress(row: Record<string, unknown>): ContactAddress {
    return {
      id: Number(row.id),
      contactId: String(row.contact_id),
      street: row.street ? String(row.street) : undefined,
      city: row.city ? String(row.city) : undefined,
      state: row.state ? String(row.state) : undefined,
      postalCode: row.postal_code ? String(row.postal_code) : undefined,
      country: row.country ? String(row.country) : undefined,
      label: String(row.label),
    };
  }

  private rowToSocial(row: Record<string, unknown>): ContactSocial {
    return {
      id: Number(row.id),
      contactId: String(row.contact_id),
      platform: String(row.platform),
      handle: String(row.handle),
    };
  }

  private rowToGroup(row: Record<string, unknown>): ContactGroup {
    return {
      id: String(row.id),
      name: String(row.name),
      description: row.description ? String(row.description) : undefined,
      memberCount: Number(row.member_count),
      createdAt: Number(row.created_at),
    };
  }
}
