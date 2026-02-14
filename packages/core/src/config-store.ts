/**
 * DB-backed config store using the `config` table.
 *
 * Provides simple key-value access for runtime config flags
 * (e.g. onboardingCompleted, firstGreetingShown) that persist
 * across sessions without requiring a config.json file.
 *
 * Falls back gracefully when the database is not yet initialized.
 */

import { getDatabase } from './database';

/**
 * Get a config value from the DB.
 * Returns null if not found or DB not available.
 */
export function getConfigValue(key: string, scope: string = 'global', scopeId: string = ''): string | null {
  try {
    const db = getDatabase();
    const row = db
      .query<{ value: string }>('SELECT value FROM config WHERE scope = ? AND scope_id = ? AND key = ?')
      .get(scope, scopeId, key);
    return row?.value ?? null;
  } catch {
    return null;
  }
}

/**
 * Set a config value in the DB.
 */
export function setConfigValue(key: string, value: string, scope: string = 'global', scopeId: string = ''): void {
  try {
    const db = getDatabase();
    db.prepare(
      `INSERT INTO config (scope, scope_id, key, value, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (scope, scope_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    ).run(scope, scopeId, key, value, new Date().toISOString());
  } catch {
    // Silently fail if DB not available
  }
}

/**
 * Check if onboarding has been completed (checks both DB and JSON config).
 */
export function isOnboardingCompleted(): boolean {
  const val = getConfigValue('onboardingCompleted');
  return val === 'true';
}

/**
 * Mark onboarding as completed in the DB.
 */
export function markOnboardingCompleted(): void {
  setConfigValue('onboardingCompleted', 'true');
}

/**
 * Check if the first greeting has been shown.
 */
export function isFirstGreetingShown(): boolean {
  const val = getConfigValue('firstGreetingShown');
  return val === 'true';
}

/**
 * Mark the first greeting as shown.
 */
export function markFirstGreetingShown(): void {
  setConfigValue('firstGreetingShown', 'true');
}
