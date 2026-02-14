import { existsSync } from 'fs';
import { mkdir, readFile, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { generateId } from '@hasna/assistants-shared';
import type { Assistant, CreateIdentityOptions, Identity, IdentityContacts, IdentityPreferences, IdentityProfile } from './types';

interface IdentityIndex {
  identities: string[];
}

/**
 * Pattern for safe IDs - only alphanumeric, hyphens, and underscores allowed
 */
const SAFE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

/**
 * Validate that an ID is safe to use in filesystem paths.
 * Returns true if valid, false otherwise.
 */
function isValidId(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0 && SAFE_ID_PATTERN.test(id);
}

/**
 * Validate and throw if ID is invalid
 */
function validateId(id: string, idType: string): void {
  if (!isValidId(id)) {
    throw new Error(
      `Invalid ${idType}: "${id}" contains invalid characters. Only alphanumeric characters, hyphens, and underscores are allowed.`
    );
  }
}

const DEFAULT_PROFILE: IdentityProfile = {
  displayName: 'Assistant',
  timezone: 'UTC',
  locale: 'en-US',
};

const DEFAULT_CONTACTS: IdentityContacts = {
  emails: [],
  phones: [],
  addresses: [],
  virtualAddresses: [],
  social: [],
};

const DEFAULT_PREFERENCES: IdentityPreferences = {
  language: 'en',
  dateFormat: 'YYYY-MM-DD',
  communicationStyle: 'professional',
  responseLength: 'balanced',
  custom: {},
};

export class IdentityManager {
  private assistantId: string;
  private basePath: string;
  private identities: Map<string, Identity> = new Map();
  private activeId: string | null = null;

  constructor(assistantId: string, basePath: string) {
    validateId(assistantId, 'assistantId');
    this.assistantId = assistantId;
    this.basePath = basePath;
  }

  private get identitiesRoot(): string {
    return join(this.basePath, 'assistants', this.assistantId, 'identities');
  }

  private get indexPath(): string {
    return join(this.identitiesRoot, 'index.json');
  }

  private get activePath(): string {
    return join(this.identitiesRoot, 'active.json');
  }

  private identityPath(id: string): string {
    validateId(id, 'identityId');
    return join(this.identitiesRoot, `${id}.json`);
  }

  private assistantConfigPath(): string {
    return join(this.basePath, 'assistants', this.assistantId, 'config.json');
  }

  async initialize(): Promise<void> {
    await mkdir(this.identitiesRoot, { recursive: true });

    const index = await this.readIndex();
    for (const id of index.identities) {
      const identity = await this.readIdentity(id);
      if (identity) {
        this.identities.set(id, identity);
      }
    }

    this.activeId = await this.readActive();
    if (!this.activeId && this.identities.size > 0) {
      const defaultIdentity = Array.from(this.identities.values()).find((identity) => identity.isDefault);
      await this.setActive(defaultIdentity?.id || Array.from(this.identities.keys())[0]);
    }
  }

  async createIdentity(options: CreateIdentityOptions): Promise<Identity> {
    const id = generateId();
    const now = new Date().toISOString();
    const identity: Identity = {
      id,
      name: options.name,
      isDefault: this.identities.size === 0,
      profile: { ...DEFAULT_PROFILE, displayName: options.name, ...(options.profile || {}) },
      contacts: { ...DEFAULT_CONTACTS, ...(options.contacts || {}) },
      preferences: { ...DEFAULT_PREFERENCES, ...(options.preferences || {}) },
      context: options.context,
      createdAt: now,
      updatedAt: now,
    };

    await this.persistIdentity(identity);
    this.identities.set(id, identity);
    await this.appendToIndex(id);
    if (identity.isDefault) {
      await this.setActive(id);
    }
    return identity;
  }

  async updateIdentity(id: string, updates: Partial<Identity>): Promise<Identity> {
    const existing = this.identities.get(id) || (await this.readIdentity(id));
    if (!existing) {
      throw new Error(`Identity ${id} not found`);
    }
    const updated: Identity = {
      ...existing,
      ...updates,
      profile: { ...existing.profile, ...(updates.profile || {}) },
      contacts: { ...existing.contacts, ...(updates.contacts || {}) },
      preferences: { ...existing.preferences, ...(updates.preferences || {}) },
      updatedAt: new Date().toISOString(),
    };
    await this.persistIdentity(updated);
    this.identities.set(id, updated);
    return updated;
  }

  async deleteIdentity(id: string): Promise<void> {
    await rm(this.identityPath(id), { force: true });
    this.identities.delete(id);
    await this.removeFromIndex(id);

    if (this.activeId === id) {
      const next = this.listIdentities()[0];
      await this.setActive(next?.id || null);
    }
  }

  async switchIdentity(id: string): Promise<Identity> {
    const identity = this.identities.get(id) || (await this.readIdentity(id));
    if (!identity) {
      throw new Error(`Identity ${id} not found`);
    }
    await this.setActive(id);
    return identity;
  }

  getActive(): Identity | null {
    if (!this.activeId) return null;
    return this.identities.get(this.activeId) || null;
  }

  listIdentities(): Identity[] {
    return Array.from(this.identities.values()).sort((a, b) =>
      a.updatedAt.localeCompare(b.updatedAt)
    );
  }

  async buildSystemPromptContext(): Promise<string | null> {
    const assistant = await this.loadAssistant();
    const identity = this.getActive();
    if (!assistant || !identity) return null;

    const primaryEmail = identity.contacts.emails.find((e) => e.isPrimary) || identity.contacts.emails[0];
    const primaryPhone = identity.contacts.phones.find((p) => p.isPrimary) || identity.contacts.phones[0];
    const primaryVirtual = identity.contacts.virtualAddresses?.find((v) => v.isPrimary) || identity.contacts.virtualAddresses?.[0];
    const primaryAddress = identity.contacts.addresses[0];

    const formatAddress = (address: IdentityContacts['addresses'][number]): string => {
      const parts = [
        address.street,
        address.city,
        address.state,
        address.postalCode,
        address.country,
      ].filter((part) => part && String(part).trim().length > 0);
      const label = address.label ? ` (${address.label})` : '';
      return `${parts.join(', ')}${label}`;
    };

    const lines: string[] = [];
    lines.push(`You are operating as "${assistant.name}" with the "${identity.name}" identity.`);
    lines.push(`- Name: ${identity.profile.displayName}`);
    if (identity.profile.title) lines.push(`- Role: ${identity.profile.title}`);
    if (identity.profile.company) lines.push(`- Company: ${identity.profile.company}`);
    if (primaryEmail) lines.push(`- Email: ${primaryEmail.value} (${primaryEmail.label || 'primary'})`);
    if (primaryPhone) lines.push(`- Phone: ${primaryPhone.value} (${primaryPhone.label || 'primary'})`);
    if (primaryAddress) lines.push(`- Address: ${formatAddress(primaryAddress)}`);
    if (primaryVirtual) lines.push(`- Virtual address: ${primaryVirtual.value} (${primaryVirtual.label || 'primary'})`);
    lines.push(`- Timezone: ${identity.profile.timezone}`);
    lines.push(`- Locale: ${identity.profile.locale}`);
    lines.push(`- Communication style: ${identity.preferences.communicationStyle}`);
    lines.push(`- Response length: ${identity.preferences.responseLength}`);
    if (identity.context) lines.push(`- Notes: ${identity.context}`);

    return lines.join('\n');
  }

  private async readIndex(): Promise<IdentityIndex> {
    if (!existsSync(this.indexPath)) {
      return { identities: [] };
    }
    try {
      const raw = await readFile(this.indexPath, 'utf-8');
      const data = JSON.parse(raw) as IdentityIndex;
      const identities = Array.isArray(data.identities) ? data.identities : [];
      // Filter out invalid IDs to prevent path traversal from poisoned index
      return { identities: identities.filter(isValidId) };
    } catch {
      return { identities: [] };
    }
  }

  private async appendToIndex(id: string): Promise<void> {
    const index = await this.readIndex();
    if (!index.identities.includes(id)) {
      index.identities.push(id);
    }
    await writeFile(this.indexPath, JSON.stringify(index, null, 2));
  }

  private async removeFromIndex(id: string): Promise<void> {
    const index = await this.readIndex();
    index.identities = index.identities.filter((identityId) => identityId !== id);
    await writeFile(this.indexPath, JSON.stringify(index, null, 2));
  }

  private async readIdentity(id: string): Promise<Identity | null> {
    const path = this.identityPath(id);
    if (!existsSync(path)) return null;
    try {
      const raw = await readFile(path, 'utf-8');
      return JSON.parse(raw) as Identity;
    } catch {
      return null;
    }
  }

  private async persistIdentity(identity: Identity): Promise<void> {
    await mkdir(this.identitiesRoot, { recursive: true });
    await writeFile(this.identityPath(identity.id), JSON.stringify(identity, null, 2));
  }

  private async readActive(): Promise<string | null> {
    if (!existsSync(this.activePath)) return null;
    try {
      const raw = await readFile(this.activePath, 'utf-8');
      const data = JSON.parse(raw) as { id?: string };
      const id = data.id || null;
      // Validate ID to prevent path traversal from poisoned active.json
      if (id && !isValidId(id)) {
        return null;
      }
      return id;
    } catch {
      return null;
    }
  }

  private async setActive(id: string | null): Promise<void> {
    this.activeId = id;
    await writeFile(this.activePath, JSON.stringify({ id }, null, 2));
  }

  private async loadAssistant(): Promise<Assistant | null> {
    if (!existsSync(this.assistantConfigPath())) return null;
    try {
      const raw = await readFile(this.assistantConfigPath(), 'utf-8');
      return JSON.parse(raw) as Assistant;
    } catch {
      return null;
    }
  }
}
