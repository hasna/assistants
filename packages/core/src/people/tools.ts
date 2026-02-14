/**
 * People tools for assistant use
 * Tools that allow assistants to manage human participants.
 */

import type { Tool } from '@hasna/assistants-shared';
import type { ToolExecutor, ToolRegistry } from '../tools/registry';
import type { PeopleManager } from './manager';
import type { Person, PersonListItem, PersonStatus } from './types';

// ============================================
// Tool Definitions
// ============================================

export const peopleListTool: Tool = {
  name: 'people_list',
  description: 'List all registered people with status and active indicator.',
  parameters: {
    type: 'object',
    properties: {},
  },
};

export const peopleGetTool: Tool = {
  name: 'people_get',
  description: 'Get details for a person by name or ID.',
  parameters: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'Person name or ID',
      },
    },
    required: ['id'],
  },
};

export const peopleCreateTool: Tool = {
  name: 'people_create',
  description: 'Create a new person and optionally set them as active.',
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Person name',
      },
      email: {
        type: 'string',
        description: 'Email address (optional)',
      },
      phone: {
        type: 'string',
        description: 'Phone number (optional)',
      },
      role: {
        type: 'string',
        description: 'Role or title (optional)',
      },
      notes: {
        type: 'string',
        description: 'Notes about this person (optional)',
      },
      avatar: {
        type: 'string',
        description: 'Avatar URL (optional)',
      },
      setActive: {
        type: 'boolean',
        description: 'Whether to log in as this person after creation (default: true)',
        default: true,
      },
    },
    required: ['name'],
  },
};

export const peopleUpdateTool: Tool = {
  name: 'people_update',
  description: 'Update a person by name or ID.',
  parameters: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'Person name or ID',
      },
      name: {
        type: 'string',
        description: 'New name (optional)',
      },
      email: {
        type: 'string',
        description: 'New email address (optional)',
      },
      avatar: {
        type: 'string',
        description: 'New avatar URL (optional)',
      },
      status: {
        type: 'string',
        description: 'Status (active/inactive)',
        enum: ['active', 'inactive'],
      },
    },
    required: ['id'],
  },
};

export const peopleDeleteTool: Tool = {
  name: 'people_delete',
  description: 'Delete a person by name or ID.',
  parameters: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'Person name or ID',
      },
    },
    required: ['id'],
  },
};

export const peopleLoginTool: Tool = {
  name: 'people_login',
  description: 'Set the active person by name or ID.',
  parameters: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'Person name or ID',
      },
    },
    required: ['id'],
  },
};

export const peopleLogoutTool: Tool = {
  name: 'people_logout',
  description: 'Clear the active person.',
  parameters: {
    type: 'object',
    properties: {},
  },
};

export const peopleWhoamiTool: Tool = {
  name: 'people_whoami',
  description: 'Show the currently active person (if any).',
  parameters: {
    type: 'object',
    properties: {},
  },
};

export const peopleTools: Tool[] = [
  peopleListTool,
  peopleGetTool,
  peopleCreateTool,
  peopleUpdateTool,
  peopleDeleteTool,
  peopleLoginTool,
  peopleLogoutTool,
  peopleWhoamiTool,
];

// ============================================
// Executors
// ============================================

export function createPeopleToolExecutors(
  getPeopleManager: () => PeopleManager | null
): Record<string, ToolExecutor> {
  return {
    people_list: async () => {
      const manager = getPeopleManager();
      if (!manager) return 'People system is not available.';
      const people = manager.listPeople();
      return formatPeopleList(people);
    },
    people_get: async (input) => {
      const manager = getPeopleManager();
      if (!manager) return 'People system is not available.';
      const nameOrId = typeof input.id === 'string' ? input.id.trim() : '';
      if (!nameOrId) return 'Error: id is required.';
      const person = manager.getPerson(nameOrId);
      if (!person) return `Person not found: ${nameOrId}`;
      const activeId = manager.getActivePersonId();
      return formatPersonDetails(person, activeId === person.id);
    },
    people_create: async (input) => {
      const manager = getPeopleManager();
      if (!manager) return 'People system is not available.';
      const name = typeof input.name === 'string' ? input.name.trim() : '';
      if (!name) return 'Error: name is required.';
      const email = typeof input.email === 'string' ? input.email.trim() : undefined;
      const phone = typeof input.phone === 'string' ? input.phone.trim() : undefined;
      const role = typeof input.role === 'string' ? input.role.trim() : undefined;
      const notes = typeof input.notes === 'string' ? input.notes.trim() : undefined;
      const avatar = typeof input.avatar === 'string' ? input.avatar.trim() : undefined;
      const setActive = input.setActive !== false;
      try {
        const person = await manager.createPerson({ name, email, phone, role, notes, avatar });
        if (setActive) {
          await manager.setActivePerson(person.id);
        }
        return [
          `Person created: ${person.name} (${person.id})`,
          email ? `Email: ${email}` : undefined,
          phone ? `Phone: ${phone}` : undefined,
          role ? `Role: ${role}` : undefined,
          setActive ? `Active: ${person.name}` : undefined,
        ].filter(Boolean).join('\n');
      } catch (error) {
        return `Error creating person: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    people_update: async (input) => {
      const manager = getPeopleManager();
      if (!manager) return 'People system is not available.';
      const nameOrId = typeof input.id === 'string' ? input.id.trim() : '';
      if (!nameOrId) return 'Error: id is required.';
      const person = manager.getPerson(nameOrId);
      if (!person) return `Person not found: ${nameOrId}`;
      const updates: Partial<Omit<Person, 'id' | 'createdAt'>> = {};
      if (typeof input.name === 'string' && input.name.trim()) updates.name = input.name.trim();
      if (typeof input.email === 'string') updates.email = input.email.trim() || undefined;
      if (typeof input.avatar === 'string') updates.avatar = input.avatar.trim() || undefined;
      if (typeof input.status === 'string' && isPersonStatus(input.status)) {
        updates.status = input.status;
      }
      if (Object.keys(updates).length === 0) {
        return 'Error: no updates provided.';
      }
      try {
        const updated = await manager.updatePerson(person.id, updates);
        const activeId = manager.getActivePersonId();
        return formatPersonDetails(updated, activeId === updated.id);
      } catch (error) {
        return `Error updating person: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    people_delete: async (input) => {
      const manager = getPeopleManager();
      if (!manager) return 'People system is not available.';
      const nameOrId = typeof input.id === 'string' ? input.id.trim() : '';
      if (!nameOrId) return 'Error: id is required.';
      try {
        await manager.deletePerson(nameOrId);
        return `Person deleted: ${nameOrId}`;
      } catch (error) {
        return `Error deleting person: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    people_login: async (input) => {
      const manager = getPeopleManager();
      if (!manager) return 'People system is not available.';
      const nameOrId = typeof input.id === 'string' ? input.id.trim() : '';
      if (!nameOrId) return 'Error: id is required.';
      try {
        const person = await manager.setActivePerson(nameOrId);
        return `Logged in as ${person.name} (${person.id}).`;
      } catch (error) {
        return `Error logging in: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    people_logout: async () => {
      const manager = getPeopleManager();
      if (!manager) return 'People system is not available.';
      await manager.logout();
      return 'Logged out.';
    },
    people_whoami: async () => {
      const manager = getPeopleManager();
      if (!manager) return 'People system is not available.';
      const person = manager.getActivePerson();
      if (!person) return 'Not logged in.';
      return formatPersonDetails(person, true);
    },
  };
}

export function registerPeopleTools(
  registry: ToolRegistry,
  getPeopleManager: () => PeopleManager | null
): void {
  const executors = createPeopleToolExecutors(getPeopleManager);
  for (const tool of peopleTools) {
    registry.register(tool, executors[tool.name]);
  }
}

// ============================================
// Helpers
// ============================================

function formatPeopleList(people: PersonListItem[]): string {
  if (people.length === 0) {
    return 'No people registered. Use people_create to add one.';
  }
  const lines: string[] = ['People:'];
  for (const person of people) {
    const email = person.email ? ` <${person.email}>` : '';
    const active = person.isActive ? ' [active]' : '';
    lines.push(`- ${person.name} (${person.id})${email} [${person.status}]${active}`);
  }
  return lines.join('\n');
}

function formatPersonDetails(person: Person, isActive: boolean): string {
  const lines = [
    `Name: ${person.name}`,
    `ID: ${person.id}`,
    person.email ? `Email: ${person.email}` : undefined,
    person.phone ? `Phone: ${person.phone}` : undefined,
    person.role ? `Role: ${person.role}` : undefined,
    person.avatar ? `Avatar: ${person.avatar}` : undefined,
    `Status: ${person.status}`,
    `Active: ${isActive ? 'yes' : 'no'}`,
    person.notes ? `Notes: ${person.notes}` : undefined,
    `Created: ${person.createdAt}`,
    `Updated: ${person.updatedAt}`,
  ].filter(Boolean) as string[];
  return lines.join('\n');
}

function isPersonStatus(value: string): value is PersonStatus {
  return value === 'active' || value === 'inactive';
}
