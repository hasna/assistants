import { join } from 'path';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { generateId } from '@hasna/assistants-shared';
import type { BudgetConfig } from '@hasna/assistants-shared';
import { DEFAULT_BUDGET_CONFIG } from '@hasna/assistants-core';

export interface BudgetProfile {
  id: string;
  name: string;
  description?: string;
  config: BudgetConfig;
  createdAt: number;
  updatedAt: number;
}

const PROFILES_FILE = 'budgets.json';
const SESSION_MAP_FILE = 'budget-sessions.json';
const DEFAULT_PROFILE_ID = 'default';

function cloneConfig(config?: BudgetConfig): BudgetConfig {
  return JSON.parse(JSON.stringify(config || DEFAULT_BUDGET_CONFIG));
}

async function ensureDir(baseDir: string): Promise<void> {
  await mkdir(baseDir, { recursive: true });
}

async function readJsonFile<T>(path: string): Promise<T | null> {
  try {
    const raw = await readFile(path, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function writeJsonFile(path: string, data: unknown): Promise<void> {
  await writeFile(path, JSON.stringify(data, null, 2), 'utf-8');
}

export async function loadBudgetProfiles(
  baseDir: string,
  seedConfig?: BudgetConfig
): Promise<BudgetProfile[]> {
  await ensureDir(baseDir);
  const path = join(baseDir, PROFILES_FILE);
  const data = await readJsonFile<{ profiles: BudgetProfile[] }>(path);
  const profiles = Array.isArray(data?.profiles) ? data!.profiles : [];

  if (profiles.length === 0) {
    const now = Date.now();
    const defaultProfile: BudgetProfile = {
      id: DEFAULT_PROFILE_ID,
      name: 'Default',
      description: 'Default budget profile',
      config: cloneConfig(seedConfig),
      createdAt: now,
      updatedAt: now,
    };
    await writeJsonFile(path, { profiles: [defaultProfile] });
    return [defaultProfile];
  }

  return profiles;
}

export async function saveBudgetProfiles(baseDir: string, profiles: BudgetProfile[]): Promise<void> {
  await ensureDir(baseDir);
  const path = join(baseDir, PROFILES_FILE);
  await writeJsonFile(path, { profiles });
}

export async function createBudgetProfile(
  baseDir: string,
  name: string,
  config: BudgetConfig,
  description?: string
): Promise<BudgetProfile> {
  const profiles = await loadBudgetProfiles(baseDir, config);
  const now = Date.now();
  const profile: BudgetProfile = {
    id: `budget_${generateId().slice(0, 8)}`,
    name: name.trim(),
    description: description?.trim() || undefined,
    config: cloneConfig(config),
    createdAt: now,
    updatedAt: now,
  };
  profiles.push(profile);
  await saveBudgetProfiles(baseDir, profiles);
  return profile;
}

export async function updateBudgetProfile(
  baseDir: string,
  id: string,
  updater: (profile: BudgetProfile) => BudgetProfile
): Promise<BudgetProfile | null> {
  const profiles = await loadBudgetProfiles(baseDir);
  const index = profiles.findIndex((p) => p.id === id);
  if (index < 0) return null;
  const updated = updater(profiles[index]);
  profiles[index] = { ...updated, updatedAt: Date.now() };
  await saveBudgetProfiles(baseDir, profiles);
  return profiles[index];
}

export async function deleteBudgetProfile(baseDir: string, id: string): Promise<boolean> {
  const profiles = await loadBudgetProfiles(baseDir);
  const next = profiles.filter((p) => p.id !== id);
  if (next.length === profiles.length) return false;
  await saveBudgetProfiles(baseDir, next);
  return true;
}

export async function loadSessionBudgetMap(baseDir: string): Promise<Record<string, string>> {
  await ensureDir(baseDir);
  const path = join(baseDir, SESSION_MAP_FILE);
  const data = await readJsonFile<Record<string, string>>(path);
  return data || {};
}

export async function saveSessionBudgetMap(
  baseDir: string,
  map: Record<string, string>
): Promise<void> {
  await ensureDir(baseDir);
  const path = join(baseDir, SESSION_MAP_FILE);
  await writeJsonFile(path, map);
}
