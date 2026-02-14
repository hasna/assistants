/**
 * Contacts tools for assistant use
 * Tools that allow assistants to manage the contacts address book.
 */

import type { Tool } from '@hasna/assistants-shared';
import type { ToolExecutor, ToolRegistry } from '../tools/registry';
import type { ContactsManager } from './manager';
import type { Contact, ContactListItem, ContactGroup, ContactRelationship } from './types';

// ============================================
// Tool Definitions
// ============================================

export const contactsListTool: Tool = {
  name: 'contacts_list',
  description: 'List contacts from the address book. Supports filtering by query, tag, group, relationship, and favorites.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query to filter by name, company, email, or phone',
      },
      tag: {
        type: 'string',
        description: 'Filter by tag',
      },
      group: {
        type: 'string',
        description: 'Filter by group name or ID',
      },
      relationship: {
        type: 'string',
        description: 'Filter by relationship type',
        enum: ['friend', 'colleague', 'vendor', 'client', 'family', 'other'],
      },
      favorite: {
        type: 'boolean',
        description: 'Filter favorites only',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of contacts to return (default: 50)',
      },
      offset: {
        type: 'number',
        description: 'Offset for pagination',
      },
    },
  },
};

export const contactsGetTool: Tool = {
  name: 'contacts_get',
  description: 'Get full details for a contact by ID, including all emails, phones, addresses, social profiles, tags, and groups.',
  parameters: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'Contact ID',
      },
    },
    required: ['id'],
  },
};

export const contactsCreateTool: Tool = {
  name: 'contacts_create',
  description: 'Create a new contact in the address book.',
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Contact full name',
      },
      company: {
        type: 'string',
        description: 'Company or organization',
      },
      title: {
        type: 'string',
        description: 'Job title',
      },
      birthday: {
        type: 'string',
        description: 'Birthday in YYYY-MM-DD format',
      },
      relationship: {
        type: 'string',
        description: 'Relationship type',
        enum: ['friend', 'colleague', 'vendor', 'client', 'family', 'other'],
      },
      notes: {
        type: 'string',
        description: 'Freeform notes about the contact',
      },
      favorite: {
        type: 'boolean',
        description: 'Whether to mark as favorite',
      },
      emails: {
        type: 'array',
        description: 'Email addresses',
        items: {
          type: 'object',
          description: 'Email entry',
          properties: {
            email: { type: 'string', description: 'Email address' },
            label: { type: 'string', description: 'Label (e.g., personal, work)' },
            isPrimary: { type: 'boolean', description: 'Whether this is the primary email' },
          },
          required: ['email'],
        },
      },
      phones: {
        type: 'array',
        description: 'Phone numbers',
        items: {
          type: 'object',
          description: 'Phone entry',
          properties: {
            phone: { type: 'string', description: 'Phone number' },
            label: { type: 'string', description: 'Label (e.g., mobile, work, home)' },
            isPrimary: { type: 'boolean', description: 'Whether this is the primary phone' },
          },
          required: ['phone'],
        },
      },
      addresses: {
        type: 'array',
        description: 'Physical addresses',
        items: {
          type: 'object',
          description: 'Address entry',
          properties: {
            street: { type: 'string', description: 'Street address' },
            city: { type: 'string', description: 'City' },
            state: { type: 'string', description: 'State/province' },
            postalCode: { type: 'string', description: 'Postal/ZIP code' },
            country: { type: 'string', description: 'Country' },
            label: { type: 'string', description: 'Label (e.g., home, work)' },
          },
        },
      },
      social: {
        type: 'array',
        description: 'Social media profiles',
        items: {
          type: 'object',
          description: 'Social profile entry',
          properties: {
            platform: { type: 'string', description: 'Platform name (e.g., twitter, linkedin, github)' },
            handle: { type: 'string', description: 'Username or profile URL' },
          },
          required: ['platform', 'handle'],
        },
      },
      tags: {
        type: 'array',
        description: 'Tags for categorization',
        items: { type: 'string', description: 'Tag name' },
      },
    },
    required: ['name'],
  },
};

export const contactsUpdateTool: Tool = {
  name: 'contacts_update',
  description: 'Update an existing contact. Only provided fields are updated. For arrays (emails, phones, etc.), the entire array is replaced.',
  parameters: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'Contact ID',
      },
      name: { type: 'string', description: 'Updated name' },
      company: { type: 'string', description: 'Updated company' },
      title: { type: 'string', description: 'Updated title' },
      birthday: { type: 'string', description: 'Updated birthday (YYYY-MM-DD)' },
      relationship: {
        type: 'string',
        description: 'Updated relationship',
        enum: ['friend', 'colleague', 'vendor', 'client', 'family', 'other'],
      },
      notes: { type: 'string', description: 'Updated notes' },
      favorite: { type: 'boolean', description: 'Updated favorite status' },
      emails: {
        type: 'array',
        description: 'Replacement email list',
        items: {
          type: 'object',
          description: 'Email entry',
          properties: {
            email: { type: 'string', description: 'Email address' },
            label: { type: 'string', description: 'Label' },
            isPrimary: { type: 'boolean', description: 'Primary flag' },
          },
          required: ['email'],
        },
      },
      phones: {
        type: 'array',
        description: 'Replacement phone list',
        items: {
          type: 'object',
          description: 'Phone entry',
          properties: {
            phone: { type: 'string', description: 'Phone number' },
            label: { type: 'string', description: 'Label' },
            isPrimary: { type: 'boolean', description: 'Primary flag' },
          },
          required: ['phone'],
        },
      },
      tags: {
        type: 'array',
        description: 'Replacement tags list',
        items: { type: 'string', description: 'Tag name' },
      },
    },
    required: ['id'],
  },
};

export const contactsDeleteTool: Tool = {
  name: 'contacts_delete',
  description: 'Delete a contact from the address book.',
  parameters: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'Contact ID',
      },
    },
    required: ['id'],
  },
};

export const contactsSearchTool: Tool = {
  name: 'contacts_search',
  description: 'Full-text search across contacts by name, company, email, phone, or notes.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query',
      },
    },
    required: ['query'],
  },
};

export const contactsGroupsListTool: Tool = {
  name: 'contacts_groups_list',
  description: 'List all contact groups with member counts.',
  parameters: {
    type: 'object',
    properties: {},
  },
};

export const contactsGroupsCreateTool: Tool = {
  name: 'contacts_groups_create',
  description: 'Create a new contact group.',
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Group name (must be unique)',
      },
      description: {
        type: 'string',
        description: 'Group description',
      },
    },
    required: ['name'],
  },
};

export const contactsGroupsDeleteTool: Tool = {
  name: 'contacts_groups_delete',
  description: 'Delete a contact group. Members are not deleted.',
  parameters: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'Group ID',
      },
    },
    required: ['id'],
  },
};

export const contactsGroupsAddMemberTool: Tool = {
  name: 'contacts_groups_add_member',
  description: 'Add a contact to a group.',
  parameters: {
    type: 'object',
    properties: {
      group_id: {
        type: 'string',
        description: 'Group ID',
      },
      contact_id: {
        type: 'string',
        description: 'Contact ID',
      },
    },
    required: ['group_id', 'contact_id'],
  },
};

export const contactsGroupsRemoveMemberTool: Tool = {
  name: 'contacts_groups_remove_member',
  description: 'Remove a contact from a group.',
  parameters: {
    type: 'object',
    properties: {
      group_id: {
        type: 'string',
        description: 'Group ID',
      },
      contact_id: {
        type: 'string',
        description: 'Contact ID',
      },
    },
    required: ['group_id', 'contact_id'],
  },
};

export const contactsTools: Tool[] = [
  contactsListTool,
  contactsGetTool,
  contactsCreateTool,
  contactsUpdateTool,
  contactsDeleteTool,
  contactsSearchTool,
  contactsGroupsListTool,
  contactsGroupsCreateTool,
  contactsGroupsDeleteTool,
  contactsGroupsAddMemberTool,
  contactsGroupsRemoveMemberTool,
];

// ============================================
// Executors
// ============================================

export function createContactsToolExecutors(
  getContactsManager: () => ContactsManager | null
): Record<string, ToolExecutor> {
  return {
    contacts_list: async (input) => {
      const manager = getContactsManager();
      if (!manager) return 'Contacts system is not available.';
      try {
        const contacts = manager.listContacts({
          query: typeof input.query === 'string' ? input.query : undefined,
          tag: typeof input.tag === 'string' ? input.tag : undefined,
          group: typeof input.group === 'string' ? input.group : undefined,
          relationship: typeof input.relationship === 'string' ? input.relationship as ContactRelationship : undefined,
          favorite: typeof input.favorite === 'boolean' ? input.favorite : undefined,
          limit: typeof input.limit === 'number' ? input.limit : 50,
          offset: typeof input.offset === 'number' ? input.offset : undefined,
        });
        return formatContactsList(contacts);
      } catch (error) {
        return `Error listing contacts: ${error instanceof Error ? error.message : String(error)}`;
      }
    },

    contacts_get: async (input) => {
      const manager = getContactsManager();
      if (!manager) return 'Contacts system is not available.';
      const id = typeof input.id === 'string' ? input.id.trim() : '';
      if (!id) return 'Error: id is required.';
      const contact = manager.getContact(id);
      if (!contact) return `Contact not found: ${id}`;
      return formatContactDetails(contact);
    },

    contacts_create: async (input) => {
      const manager = getContactsManager();
      if (!manager) return 'Contacts system is not available.';
      const name = typeof input.name === 'string' ? input.name.trim() : '';
      if (!name) return 'Error: name is required.';
      try {
        const contact = manager.createContact({
          name,
          company: typeof input.company === 'string' ? input.company : undefined,
          title: typeof input.title === 'string' ? input.title : undefined,
          birthday: typeof input.birthday === 'string' ? input.birthday : undefined,
          relationship: typeof input.relationship === 'string' ? input.relationship as ContactRelationship : undefined,
          notes: typeof input.notes === 'string' ? input.notes : undefined,
          favorite: typeof input.favorite === 'boolean' ? input.favorite : undefined,
          emails: Array.isArray(input.emails) ? input.emails : undefined,
          phones: Array.isArray(input.phones) ? input.phones : undefined,
          addresses: Array.isArray(input.addresses) ? input.addresses : undefined,
          social: Array.isArray(input.social) ? input.social : undefined,
          tags: Array.isArray(input.tags) ? input.tags : undefined,
        });
        return `Contact created: ${contact.name} (${contact.id})`;
      } catch (error) {
        return `Error creating contact: ${error instanceof Error ? error.message : String(error)}`;
      }
    },

    contacts_update: async (input) => {
      const manager = getContactsManager();
      if (!manager) return 'Contacts system is not available.';
      const id = typeof input.id === 'string' ? input.id.trim() : '';
      if (!id) return 'Error: id is required.';
      try {
        const updates: Record<string, unknown> = {};
        if (typeof input.name === 'string') updates.name = input.name;
        if (typeof input.company === 'string') updates.company = input.company;
        if (typeof input.title === 'string') updates.title = input.title;
        if (typeof input.birthday === 'string') updates.birthday = input.birthday;
        if (typeof input.relationship === 'string') updates.relationship = input.relationship;
        if (typeof input.notes === 'string') updates.notes = input.notes;
        if (typeof input.favorite === 'boolean') updates.favorite = input.favorite;
        if (Array.isArray(input.emails)) updates.emails = input.emails;
        if (Array.isArray(input.phones)) updates.phones = input.phones;
        if (Array.isArray(input.addresses)) updates.addresses = input.addresses;
        if (Array.isArray(input.social)) updates.social = input.social;
        if (Array.isArray(input.tags)) updates.tags = input.tags;

        const contact = manager.updateContact(id, updates as any);
        if (!contact) return `Contact not found: ${id}`;
        return formatContactDetails(contact);
      } catch (error) {
        return `Error updating contact: ${error instanceof Error ? error.message : String(error)}`;
      }
    },

    contacts_delete: async (input) => {
      const manager = getContactsManager();
      if (!manager) return 'Contacts system is not available.';
      const id = typeof input.id === 'string' ? input.id.trim() : '';
      if (!id) return 'Error: id is required.';
      const deleted = manager.deleteContact(id);
      return deleted ? `Contact deleted: ${id}` : `Contact not found: ${id}`;
    },

    contacts_search: async (input) => {
      const manager = getContactsManager();
      if (!manager) return 'Contacts system is not available.';
      const query = typeof input.query === 'string' ? input.query.trim() : '';
      if (!query) return 'Error: query is required.';
      const contacts = manager.searchContacts(query);
      return formatContactsList(contacts);
    },

    contacts_groups_list: async () => {
      const manager = getContactsManager();
      if (!manager) return 'Contacts system is not available.';
      const groups = manager.listGroups();
      return formatGroupsList(groups);
    },

    contacts_groups_create: async (input) => {
      const manager = getContactsManager();
      if (!manager) return 'Contacts system is not available.';
      const name = typeof input.name === 'string' ? input.name.trim() : '';
      if (!name) return 'Error: name is required.';
      try {
        const group = manager.createGroup(name, typeof input.description === 'string' ? input.description : undefined);
        return `Group created: ${group.name} (${group.id})`;
      } catch (error) {
        return `Error creating group: ${error instanceof Error ? error.message : String(error)}`;
      }
    },

    contacts_groups_delete: async (input) => {
      const manager = getContactsManager();
      if (!manager) return 'Contacts system is not available.';
      const id = typeof input.id === 'string' ? input.id.trim() : '';
      if (!id) return 'Error: id is required.';
      const deleted = manager.deleteGroup(id);
      return deleted ? `Group deleted: ${id}` : `Group not found: ${id}`;
    },

    contacts_groups_add_member: async (input) => {
      const manager = getContactsManager();
      if (!manager) return 'Contacts system is not available.';
      const groupId = typeof input.group_id === 'string' ? input.group_id.trim() : '';
      const contactId = typeof input.contact_id === 'string' ? input.contact_id.trim() : '';
      if (!groupId || !contactId) return 'Error: group_id and contact_id are required.';
      try {
        manager.addGroupMember(groupId, contactId);
        return `Contact ${contactId} added to group ${groupId}.`;
      } catch (error) {
        return `Error: ${error instanceof Error ? error.message : String(error)}`;
      }
    },

    contacts_groups_remove_member: async (input) => {
      const manager = getContactsManager();
      if (!manager) return 'Contacts system is not available.';
      const groupId = typeof input.group_id === 'string' ? input.group_id.trim() : '';
      const contactId = typeof input.contact_id === 'string' ? input.contact_id.trim() : '';
      if (!groupId || !contactId) return 'Error: group_id and contact_id are required.';
      const removed = manager.removeGroupMember(groupId, contactId);
      return removed ? `Contact ${contactId} removed from group ${groupId}.` : 'Member not found in group.';
    },
  };
}

export function registerContactsTools(
  registry: ToolRegistry,
  getContactsManager: () => ContactsManager | null
): void {
  const executors = createContactsToolExecutors(getContactsManager);
  for (const tool of contactsTools) {
    registry.register(tool, executors[tool.name]);
  }
}

// ============================================
// Helpers
// ============================================

function formatContactsList(contacts: ContactListItem[]): string {
  if (contacts.length === 0) {
    return 'No contacts found. Use contacts_create to add one.';
  }
  const lines: string[] = [`Contacts (${contacts.length}):`];
  for (const c of contacts) {
    const fav = c.favorite ? ' *' : '';
    const email = c.primaryEmail ? ` <${c.primaryEmail}>` : '';
    const company = c.company ? ` @ ${c.company}` : '';
    const tags = c.tags.length > 0 ? ` [${c.tags.join(', ')}]` : '';
    lines.push(`- ${c.name}${fav} (${c.id})${company}${email}${tags}`);
  }
  return lines.join('\n');
}

function formatContactDetails(contact: Contact): string {
  const lines: string[] = [
    `Name: ${contact.name}${contact.favorite ? ' (favorite)' : ''}`,
    `ID: ${contact.id}`,
  ];

  if (contact.company) lines.push(`Company: ${contact.company}`);
  if (contact.title) lines.push(`Title: ${contact.title}`);
  if (contact.birthday) lines.push(`Birthday: ${contact.birthday}`);
  lines.push(`Relationship: ${contact.relationship}`);

  if (contact.emails.length > 0) {
    lines.push('Emails:');
    for (const e of contact.emails) {
      lines.push(`  - ${e.email} (${e.label})${e.isPrimary ? ' [primary]' : ''}`);
    }
  }

  if (contact.phones.length > 0) {
    lines.push('Phones:');
    for (const p of contact.phones) {
      lines.push(`  - ${p.phone} (${p.label})${p.isPrimary ? ' [primary]' : ''}`);
    }
  }

  if (contact.addresses.length > 0) {
    lines.push('Addresses:');
    for (const a of contact.addresses) {
      const parts = [a.street, a.city, a.state, a.postalCode, a.country].filter(Boolean);
      lines.push(`  - ${parts.join(', ')} (${a.label})`);
    }
  }

  if (contact.social.length > 0) {
    lines.push('Social:');
    for (const s of contact.social) {
      lines.push(`  - ${s.platform}: ${s.handle}`);
    }
  }

  if (contact.tags.length > 0) {
    lines.push(`Tags: ${contact.tags.join(', ')}`);
  }

  if (contact.groups.length > 0) {
    lines.push(`Groups: ${contact.groups.map((g) => g.name).join(', ')}`);
  }

  if (contact.notes) lines.push(`Notes: ${contact.notes}`);

  lines.push(`Created: ${new Date(contact.createdAt).toISOString()}`);
  lines.push(`Updated: ${new Date(contact.updatedAt).toISOString()}`);

  return lines.join('\n');
}

function formatGroupsList(groups: ContactGroup[]): string {
  if (groups.length === 0) {
    return 'No groups found. Use contacts_groups_create to add one.';
  }
  const lines: string[] = [`Groups (${groups.length}):`];
  for (const g of groups) {
    const desc = g.description ? ` - ${g.description}` : '';
    lines.push(`- ${g.name} (${g.id}) [${g.memberCount} members]${desc}`);
  }
  return lines.join('\n');
}
