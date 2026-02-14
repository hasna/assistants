import { getDatabase } from '../../database';
import type { DatabaseConnection } from '../../database';
import type { Secret, SecretListItem, SecretScope } from '../types';

export interface LocalSecretsClientOptions {
  db?: DatabaseConnection;
}

function getDb(injected?: DatabaseConnection): DatabaseConnection {
  if (injected) return injected;
  return getDatabase();
}

interface SecretRow {
  name: string;
  scope: string;
  assistant_id: string | null;
  value: string;
  description: string | null;
  created_at: number;
  updated_at: number;
}

export class LocalSecretsClient {
  private injectedDb?: DatabaseConnection;

  constructor(options: LocalSecretsClientOptions = {}) {
    this.injectedDb = options.db;
  }

  private db(): DatabaseConnection {
    return getDb(this.injectedDb);
  }

  async listSecrets(scope: SecretScope | 'all', assistantId?: string): Promise<SecretListItem[]> {
    const items: SecretListItem[] = [];

    if (scope === 'global' || scope === 'all') {
      const rows = this.db().query<SecretRow>(
        "SELECT * FROM secrets WHERE scope = 'global'"
      ).all();
      for (const row of rows) {
        items.push(this.toSecretListItem(row));
      }
    }

    if ((scope === 'assistant' || scope === 'all') && assistantId) {
      const rows = this.db().query<SecretRow>(
        "SELECT * FROM secrets WHERE scope = 'assistant' AND assistant_id = ?"
      ).all(assistantId);
      for (const row of rows) {
        items.push(this.toSecretListItem(row));
      }
    }

    return items.sort((a, b) => {
      if (a.scope === b.scope) {
        return a.name.localeCompare(b.name);
      }
      return a.scope.localeCompare(b.scope);
    });
  }

  async getSecret(name: string, scope: SecretScope, assistantId?: string): Promise<Secret | null> {
    const row = this.db().query<SecretRow>(
      'SELECT * FROM secrets WHERE name = ? AND scope = ? AND assistant_id IS ?'
    ).get(name, scope, scope === 'assistant' ? (assistantId ?? null) : null);

    if (!row) return null;

    return {
      name: row.name,
      value: row.value,
      description: row.description ?? undefined,
      scope: row.scope as SecretScope,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async setSecret(
    name: string,
    value: string,
    scope: SecretScope,
    assistantId?: string,
    description?: string
  ): Promise<void> {
    if (scope === 'assistant' && !assistantId) {
      throw new Error('Assistant ID required for assistant-scoped secrets');
    }

    const now = Date.now();
    const aId = scope === 'assistant' ? (assistantId ?? null) : null;

    const existing = this.db().query<SecretRow>(
      'SELECT * FROM secrets WHERE name = ? AND scope = ? AND assistant_id IS ?'
    ).get(name, scope, aId);

    if (existing) {
      this.db().prepare(
        'UPDATE secrets SET value = ?, description = ?, updated_at = ? WHERE name = ? AND scope = ? AND assistant_id IS ?'
      ).run(value, description ?? null, now, name, scope, aId);
    } else {
      this.db().prepare(
        'INSERT INTO secrets (name, scope, assistant_id, value, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(name, scope, aId, value, description ?? null, now, now);
    }
  }

  async deleteSecret(name: string, scope: SecretScope, assistantId?: string): Promise<void> {
    const aId = scope === 'assistant' ? (assistantId ?? null) : null;
    this.db().prepare(
      'DELETE FROM secrets WHERE name = ? AND scope = ? AND assistant_id IS ?'
    ).run(name, scope, aId);
  }

  async checkCredentials(): Promise<{ valid: boolean; error?: string }> {
    return { valid: true };
  }

  private toSecretListItem(row: SecretRow): SecretListItem {
    return {
      name: row.name,
      description: row.description ?? undefined,
      scope: row.scope as SecretScope,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      hasValue: true,
    };
  }
}
