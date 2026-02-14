/**
 * Identity Management Tools
 *
 * Tools for listing, creating, updating, deleting, and switching identities.
 * Also includes template management for quick identity creation.
 */

import type { Tool } from '@hasna/assistants-shared';
import type { ToolExecutor, ToolRegistry } from './registry';
import type { IdentityManager } from '../identity';
import { listTemplates, getTemplate, createIdentityFromTemplate } from '../identity/templates';

// ============================================
// Types
// ============================================

export interface IdentityToolsContext {
  getIdentityManager: () => IdentityManager | null;
}

// ============================================
// Tool Definitions
// ============================================

export const identityListTool: Tool = {
  name: 'identity_list',
  description: 'List all identities for the current assistant with their details (id, name, profile, preferences, active status).',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
};

export const identityGetTool: Tool = {
  name: 'identity_get',
  description: 'Get detailed information about a specific identity by ID.',
  parameters: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'The identity ID to retrieve',
      },
    },
    required: ['id'],
  },
};

export const identityCreateTool: Tool = {
  name: 'identity_create',
  description: 'Create a new identity for the current assistant. Can use templates or custom settings.',
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Name for the new identity',
      },
      template: {
        type: 'string',
        description: 'Optional: Use a template (tech-support, professional, creative, analyst, mentor, developer)',
      },
      displayName: {
        type: 'string',
        description: 'Display name for the identity',
      },
      title: {
        type: 'string',
        description: 'Role or job title',
      },
      company: {
        type: 'string',
        description: 'Company or organization name',
      },
      timezone: {
        type: 'string',
        description: 'Timezone (e.g., "UTC", "America/New_York")',
      },
      communicationStyle: {
        type: 'string',
        enum: ['formal', 'casual', 'professional'],
        description: 'Communication style preference',
      },
      responseLength: {
        type: 'string',
        enum: ['concise', 'detailed', 'balanced'],
        description: 'Response length preference',
      },
      context: {
        type: 'string',
        description: 'Additional context or notes for this identity',
      },
      email: {
        type: 'string',
        description: 'Primary email address',
      },
      phone: {
        type: 'string',
        description: 'Primary phone number',
      },
      address: {
        type: 'object',
        description: 'Primary physical address',
        properties: {
          street: { type: 'string', description: 'Street address line' },
          city: { type: 'string', description: 'City or locality' },
          state: { type: 'string', description: 'State, province, or region' },
          postalCode: { type: 'string', description: 'ZIP or postal code' },
          country: { type: 'string', description: 'Country name or code' },
          label: { type: 'string', description: 'Address label (e.g., Primary, Office)' },
        },
      },
      virtualAddress: {
        type: 'string',
        description: 'Primary virtual address (handle, URL, or DID)',
      },
    },
    required: ['name'],
  },
};

export const identityUpdateTool: Tool = {
  name: 'identity_update',
  description: 'Update an existing identity\'s configuration.',
  parameters: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'The identity ID to update',
      },
      name: {
        type: 'string',
        description: 'New name for the identity',
      },
      displayName: {
        type: 'string',
        description: 'New display name',
      },
      title: {
        type: 'string',
        description: 'New role or job title',
      },
      company: {
        type: 'string',
        description: 'New company or organization name',
      },
      timezone: {
        type: 'string',
        description: 'New timezone',
      },
      communicationStyle: {
        type: 'string',
        enum: ['formal', 'casual', 'professional'],
        description: 'New communication style',
      },
      responseLength: {
        type: 'string',
        enum: ['concise', 'detailed', 'balanced'],
        description: 'New response length preference',
      },
      context: {
        type: 'string',
        description: 'New context or notes',
      },
      email: {
        type: 'string',
        description: 'Primary email address',
      },
      phone: {
        type: 'string',
        description: 'Primary phone number',
      },
      address: {
        type: 'object',
        description: 'Primary physical address',
        properties: {
          street: { type: 'string', description: 'Street address line' },
          city: { type: 'string', description: 'City or locality' },
          state: { type: 'string', description: 'State, province, or region' },
          postalCode: { type: 'string', description: 'ZIP or postal code' },
          country: { type: 'string', description: 'Country name or code' },
          label: { type: 'string', description: 'Address label (e.g., Primary, Office)' },
        },
      },
      virtualAddress: {
        type: 'string',
        description: 'Primary virtual address (handle, URL, or DID)',
      },
    },
    required: ['id'],
  },
};

export const identityDeleteTool: Tool = {
  name: 'identity_delete',
  description: 'Delete an identity by ID. Cannot delete the last remaining identity.',
  parameters: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'The identity ID to delete',
      },
    },
    required: ['id'],
  },
};

export const identitySwitchTool: Tool = {
  name: 'identity_switch',
  description: 'Switch to a different identity by ID. The new identity becomes active.',
  parameters: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'The identity ID to switch to',
      },
    },
    required: ['id'],
  },
};

export const identityTemplatesListTool: Tool = {
  name: 'identity_templates_list',
  description: 'List available identity templates that can be used to quickly create new identities.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
};

export const identityTemplateGetTool: Tool = {
  name: 'identity_template_get',
  description: 'Get detailed information about a specific identity template.',
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Template name (tech-support, professional, creative, analyst, mentor, developer)',
      },
    },
    required: ['name'],
  },
};

export const identityTools: Tool[] = [
  identityListTool,
  identityGetTool,
  identityCreateTool,
  identityUpdateTool,
  identityDeleteTool,
  identitySwitchTool,
  identityTemplatesListTool,
  identityTemplateGetTool,
];

// ============================================
// Tool Executors Factory
// ============================================

export function createIdentityToolExecutors(
  context: IdentityToolsContext
): Record<string, ToolExecutor> {
  return {
    identity_list: async (): Promise<string> => {
      const manager = context.getIdentityManager();
      if (!manager) {
        return JSON.stringify({
          success: false,
          error: 'Identity manager not initialized. Make sure an assistant is active.',
        });
      }

      const identities = manager.listIdentities();
      const active = manager.getActive();

      const list = identities.map((i) => ({
        id: i.id,
        name: i.name,
        isDefault: i.isDefault,
        displayName: i.profile.displayName,
        title: i.profile.title || null,
        company: i.profile.company || null,
        communicationStyle: i.preferences.communicationStyle,
        responseLength: i.preferences.responseLength,
        isActive: active?.id === i.id,
        createdAt: i.createdAt,
        updatedAt: i.updatedAt,
      }));

      return JSON.stringify({
        success: true,
        total: list.length,
        activeId: active?.id || null,
        identities: list,
      });
    },

    identity_get: async (input: Record<string, unknown>): Promise<string> => {
      const id = input.id as string;
      if (!id) {
        return JSON.stringify({
          success: false,
          error: 'Identity ID is required',
        });
      }

      const manager = context.getIdentityManager();
      if (!manager) {
        return JSON.stringify({
          success: false,
          error: 'Identity manager not initialized',
        });
      }

      const identities = manager.listIdentities();
      const identity = identities.find((i) => i.id === id);

      if (!identity) {
        return JSON.stringify({
          success: false,
          error: `Identity "${id}" not found`,
        });
      }

      const active = manager.getActive();

      return JSON.stringify({
        success: true,
        identity: {
          id: identity.id,
          name: identity.name,
          isDefault: identity.isDefault,
          profile: {
            displayName: identity.profile.displayName,
            title: identity.profile.title,
            company: identity.profile.company,
            bio: identity.profile.bio,
            timezone: identity.profile.timezone,
            locale: identity.profile.locale,
          },
          preferences: {
            language: identity.preferences.language,
            dateFormat: identity.preferences.dateFormat,
            communicationStyle: identity.preferences.communicationStyle,
            responseLength: identity.preferences.responseLength,
            codeStyle: identity.preferences.codeStyle,
          },
          contacts: {
            emails: identity.contacts.emails,
            phones: identity.contacts.phones,
            addresses: identity.contacts.addresses,
            virtualAddresses: identity.contacts.virtualAddresses || [],
          },
          context: identity.context || null,
          isActive: active?.id === identity.id,
          createdAt: identity.createdAt,
          updatedAt: identity.updatedAt,
        },
      });
    },

    identity_create: async (input: Record<string, unknown>): Promise<string> => {
      const name = input.name as string;
      if (!name || typeof name !== 'string' || !name.trim()) {
        return JSON.stringify({
          success: false,
          error: 'Identity name is required',
        });
      }

      const manager = context.getIdentityManager();
      if (!manager) {
        return JSON.stringify({
          success: false,
          error: 'Identity manager not initialized',
        });
      }

      try {
        const email = typeof input.email === 'string' ? input.email.trim() : '';
        const phone = typeof input.phone === 'string' ? input.phone.trim() : '';
        const virtualAddress = typeof input.virtualAddress === 'string' ? input.virtualAddress.trim() : '';
        const addressInput = input.address as Record<string, unknown> | undefined;
        const street = addressInput?.street ? String(addressInput.street).trim() : '';
        const city = addressInput?.city ? String(addressInput.city).trim() : '';
        const postalCode = addressInput?.postalCode ? String(addressInput.postalCode).trim() : '';
        const country = addressInput?.country ? String(addressInput.country).trim() : '';
        const hasAddress = Boolean(street && city && postalCode && country);
        const address = hasAddress
          ? {
              street,
              city,
              state: addressInput?.state ? String(addressInput.state).trim() : undefined,
              postalCode,
              country,
              label: addressInput?.label ? String(addressInput.label).trim() : 'Primary',
            }
          : null;

        const contacts = {
          emails: email ? [{ value: email, label: 'Primary', isPrimary: true }] : [],
          phones: phone ? [{ value: phone, label: 'Primary', isPrimary: true }] : [],
          addresses: address ? [address] : [],
          virtualAddresses: virtualAddress ? [{ value: virtualAddress, label: 'Primary', isPrimary: true }] : [],
        };

        // Check if using a template
        const templateName = input.template as string;
        let createOptions;

        if (templateName) {
          createOptions = createIdentityFromTemplate(templateName, {
            name: name.trim(),
            profile: {
              displayName: (input.displayName as string) || name.trim(),
              title: input.title as string,
              company: input.company as string,
              timezone: input.timezone as string,
            },
            preferences: {
              communicationStyle: input.communicationStyle as 'formal' | 'casual' | 'professional',
              responseLength: input.responseLength as 'concise' | 'detailed' | 'balanced',
            },
            contacts,
            context: input.context as string,
          });

          if (!createOptions) {
            return JSON.stringify({
              success: false,
              error: `Template "${templateName}" not found. Use identity_templates_list to see available templates.`,
            });
          }
        } else {
          createOptions = {
            name: name.trim(),
            profile: {
              displayName: (input.displayName as string) || name.trim(),
              title: input.title as string,
              company: input.company as string,
              timezone: (input.timezone as string) || 'UTC',
            },
            preferences: {
              communicationStyle: (input.communicationStyle as 'formal' | 'casual' | 'professional') || 'professional',
              responseLength: (input.responseLength as 'concise' | 'detailed' | 'balanced') || 'balanced',
            },
            contacts,
            context: input.context as string,
          };
        }

        const identity = await manager.createIdentity(createOptions);

        return JSON.stringify({
          success: true,
          message: `Identity "${identity.name}" created${templateName ? ` from template "${templateName}"` : ''}`,
          identity: {
            id: identity.id,
            name: identity.name,
            displayName: identity.profile.displayName,
            communicationStyle: identity.preferences.communicationStyle,
            isDefault: identity.isDefault,
          },
        });
      } catch (error) {
        return JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : 'Failed to create identity',
        });
      }
    },

    identity_update: async (input: Record<string, unknown>): Promise<string> => {
      const id = input.id as string;
      if (!id) {
        return JSON.stringify({
          success: false,
          error: 'Identity ID is required',
        });
      }

      const manager = context.getIdentityManager();
      if (!manager) {
        return JSON.stringify({
          success: false,
          error: 'Identity manager not initialized',
        });
      }

      try {
        const updates: Record<string, unknown> = {};
        if (input.name) updates.name = input.name;
        if (input.context !== undefined) updates.context = input.context;

        const profile: Record<string, unknown> = {};
        if (input.displayName) profile.displayName = input.displayName;
        if (input.title !== undefined) profile.title = input.title;
        if (input.company !== undefined) profile.company = input.company;
        if (input.timezone) profile.timezone = input.timezone;
        if (Object.keys(profile).length > 0) updates.profile = profile;

        const preferences: Record<string, unknown> = {};
        if (input.communicationStyle) preferences.communicationStyle = input.communicationStyle;
        if (input.responseLength) preferences.responseLength = input.responseLength;
        if (Object.keys(preferences).length > 0) updates.preferences = preferences;

        const email = typeof input.email === 'string' ? input.email.trim() : '';
        const phone = typeof input.phone === 'string' ? input.phone.trim() : '';
        const virtualAddress = typeof input.virtualAddress === 'string' ? input.virtualAddress.trim() : '';
        const addressInput = input.address as Record<string, unknown> | undefined;
        const street = addressInput?.street ? String(addressInput.street).trim() : '';
        const city = addressInput?.city ? String(addressInput.city).trim() : '';
        const postalCode = addressInput?.postalCode ? String(addressInput.postalCode).trim() : '';
        const country = addressInput?.country ? String(addressInput.country).trim() : '';
        const hasAddress = Boolean(street && city && postalCode && country);
        const address = hasAddress
          ? {
              street,
              city,
              state: addressInput?.state ? String(addressInput.state).trim() : undefined,
              postalCode,
              country,
              label: addressInput?.label ? String(addressInput.label).trim() : 'Primary',
            }
          : null;

        if (email || phone || virtualAddress || address) {
          updates.contacts = {
            ...(email ? { emails: [{ value: email, label: 'Primary', isPrimary: true }] } : {}),
            ...(phone ? { phones: [{ value: phone, label: 'Primary', isPrimary: true }] } : {}),
            ...(address ? { addresses: [address] } : {}),
            ...(virtualAddress ? { virtualAddresses: [{ value: virtualAddress, label: 'Primary', isPrimary: true }] } : {}),
          };
        }

        if (Object.keys(updates).length === 0) {
          return JSON.stringify({
            success: false,
            error: 'No updates provided',
          });
        }

        const identity = await manager.updateIdentity(id, updates);
        const active = manager.getActive();

        return JSON.stringify({
          success: true,
          message: `Identity "${identity.name}" updated`,
          identity: {
            id: identity.id,
            name: identity.name,
            displayName: identity.profile.displayName,
            isActive: active?.id === identity.id,
            updatedAt: identity.updatedAt,
          },
        });
      } catch (error) {
        return JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : 'Failed to update identity',
        });
      }
    },

    identity_delete: async (input: Record<string, unknown>): Promise<string> => {
      const id = input.id as string;
      if (!id) {
        return JSON.stringify({
          success: false,
          error: 'Identity ID is required',
        });
      }

      const manager = context.getIdentityManager();
      if (!manager) {
        return JSON.stringify({
          success: false,
          error: 'Identity manager not initialized',
        });
      }

      try {
        const identities = manager.listIdentities();
        if (identities.length <= 1) {
          return JSON.stringify({
            success: false,
            error: 'Cannot delete the last remaining identity',
          });
        }

        const toDelete = identities.find((i) => i.id === id);
        if (!toDelete) {
          return JSON.stringify({
            success: false,
            error: `Identity "${id}" not found`,
          });
        }

        await manager.deleteIdentity(id);

        return JSON.stringify({
          success: true,
          message: `Identity "${toDelete.name}" deleted`,
          deletedId: id,
        });
      } catch (error) {
        return JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : 'Failed to delete identity',
        });
      }
    },

    identity_switch: async (input: Record<string, unknown>): Promise<string> => {
      const id = input.id as string;
      if (!id) {
        return JSON.stringify({
          success: false,
          error: 'Identity ID is required',
        });
      }

      const manager = context.getIdentityManager();
      if (!manager) {
        return JSON.stringify({
          success: false,
          error: 'Identity manager not initialized',
        });
      }

      try {
        const identity = await manager.switchIdentity(id);

        return JSON.stringify({
          success: true,
          message: `Switched to identity "${identity.name}"`,
          identity: {
            id: identity.id,
            name: identity.name,
            displayName: identity.profile.displayName,
            communicationStyle: identity.preferences.communicationStyle,
          },
        });
      } catch (error) {
        return JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : 'Failed to switch identity',
        });
      }
    },

    identity_templates_list: async (): Promise<string> => {
      const templates = listTemplates();

      return JSON.stringify({
        success: true,
        total: templates.length,
        templates,
      });
    },

    identity_template_get: async (input: Record<string, unknown>): Promise<string> => {
      const name = input.name as string;
      if (!name) {
        return JSON.stringify({
          success: false,
          error: 'Template name is required',
        });
      }

      const template = getTemplate(name);
      if (!template) {
        return JSON.stringify({
          success: false,
          error: `Template "${name}" not found. Use identity_templates_list to see available templates.`,
        });
      }

      return JSON.stringify({
        success: true,
        template: {
          name: template.name,
          description: template.description,
          profile: template.profile,
          preferences: template.preferences,
          context: template.context,
        },
      });
    },
  };
}

// ============================================
// Registration Function
// ============================================

export function registerIdentityTools(
  registry: ToolRegistry,
  context: IdentityToolsContext
): void {
  const executors = createIdentityToolExecutors(context);

  for (const tool of identityTools) {
    registry.register(tool, executors[tool.name]);
  }
}
