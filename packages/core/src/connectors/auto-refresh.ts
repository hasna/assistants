import { join } from 'path';
import { mkdir, readFile, writeFile, open, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { generateId } from '@hasna/assistants-shared';
import type { Connector } from '@hasna/assistants-shared';
import { getConfigDir } from '../config';
import { getRuntime } from '../runtime';
import { buildCommandArgs, splitCommandLine } from '../utils/command-line';
import { getNextCronRun } from '../scheduler/cron';

export type ConnectorAutoRefreshSchedule =
  | { kind: 'cron'; cron: string; timezone?: string }
  | { kind: 'interval'; interval: number; unit?: 'minutes' | 'hours' | 'seconds' };

export interface ConnectorAutoRefreshEntry {
  connector: string;
  enabled: boolean;
  schedule: ConnectorAutoRefreshSchedule;
  command: string;
  createdAt: number;
  updatedAt: number;
  nextRunAt?: number;
  lastRunAt?: number;
  lastResult?: {
    ok: boolean;
    error?: string;
    summary?: string;
  };
}

interface ConnectorAutoRefreshState {
  version: number;
  updatedAt: number;
  entries: Record<string, ConnectorAutoRefreshEntry>;
}

const STORE_VERSION = 1;
const DEFAULT_INTERVAL_MINUTES = 45;
const DEFAULT_TICK_MS = 30_000;
const DEFAULT_COMMAND = 'auth refresh';
const LOCK_TTL_MS = 5 * 60 * 1000;
const SAFE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const MAX_SUMMARY_CHARS = 500;

function isSafeId(id: string): boolean {
  return SAFE_ID_PATTERN.test(id);
}

function truncateSummary(value: string): string {
  if (value.length <= MAX_SUMMARY_CHARS) return value;
  return value.slice(0, MAX_SUMMARY_CHARS).trimEnd() + '…';
}

function scheduleLabel(schedule: ConnectorAutoRefreshSchedule): string {
  if (schedule.kind === 'cron') {
    return schedule.timezone
      ? `cron "${schedule.cron}" (${schedule.timezone})`
      : `cron "${schedule.cron}"`;
  }
  const unit = schedule.unit || 'minutes';
  return `every ${schedule.interval} ${unit}`;
}

function computeNextRun(entry: ConnectorAutoRefreshEntry, fromTime: number): number | undefined {
  if (entry.schedule.kind === 'cron') {
    if (!entry.schedule.cron) return undefined;
    return getNextCronRun(entry.schedule.cron, fromTime, entry.schedule.timezone);
  }
  const unit = entry.schedule.unit || 'minutes';
  const interval = entry.schedule.interval;
  if (!interval || interval <= 0) return undefined;
  const multiplier = unit === 'seconds' ? 1000 : unit === 'hours' ? 3600000 : 60000;
  return fromTime + interval * multiplier;
}

class ConnectorAutoRefreshStore {
  private baseDir: string;
  private statePath: string;
  private locksDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir ?? join(getConfigDir(), 'connectors');
    this.statePath = join(this.baseDir, 'auto-refresh.json');
    this.locksDir = join(this.baseDir, 'auto-refresh-locks');
  }

  private async ensureDirs(): Promise<void> {
    await mkdir(this.baseDir, { recursive: true });
    await mkdir(this.locksDir, { recursive: true });
  }

  async load(): Promise<ConnectorAutoRefreshState> {
    try {
      const raw = await readFile(this.statePath, 'utf-8');
      const parsed = JSON.parse(raw) as ConnectorAutoRefreshState;
      if (!parsed || parsed.version !== STORE_VERSION || !parsed.entries) {
        return { version: STORE_VERSION, updatedAt: Date.now(), entries: {} };
      }
      return parsed;
    } catch {
      return { version: STORE_VERSION, updatedAt: Date.now(), entries: {} };
    }
  }

  async save(state: ConnectorAutoRefreshState): Promise<void> {
    await this.ensureDirs();
    const payload: ConnectorAutoRefreshState = {
      ...state,
      version: STORE_VERSION,
      updatedAt: Date.now(),
    };
    await writeFile(this.statePath, JSON.stringify(payload, null, 2), 'utf-8');
  }

  private lockPath(connector: string): string {
    return join(this.locksDir, `${connector}.lock.json`);
  }

  async acquireLock(connector: string, ownerId: string, ttlMs: number = LOCK_TTL_MS): Promise<boolean> {
    if (!isSafeId(connector)) return false;
    await this.ensureDirs();
    const path = this.lockPath(connector);
    const now = Date.now();

    try {
      const handle = await open(path, 'wx');
      await handle.writeFile(JSON.stringify({ ownerId, createdAt: now, updatedAt: now, ttlMs }, null, 2), 'utf-8');
      await handle.close();
      return true;
    } catch {
      try {
        const raw = await readFile(path, 'utf-8');
        const lock = JSON.parse(raw) as { ownerId?: string; createdAt?: number; updatedAt?: number; ttlMs?: number };
        const updatedAt = lock?.updatedAt || lock?.createdAt || 0;
        const ttl = lock?.ttlMs ?? ttlMs;
        if (now - updatedAt > ttl) {
          await unlink(path);
          return this.acquireLock(connector, ownerId, ttlMs);
        }
      } catch {
        // ignore
      }
    }

    return false;
  }

  async releaseLock(connector: string, ownerId: string): Promise<void> {
    if (!isSafeId(connector)) return;
    const path = this.lockPath(connector);
    try {
      if (!existsSync(path)) return;
      const raw = await readFile(path, 'utf-8');
      const lock = JSON.parse(raw) as { ownerId?: string };
      if (lock?.ownerId && lock.ownerId !== ownerId) return;
      await unlink(path);
    } catch {
      // ignore
    }
  }
}

export class ConnectorAutoRefreshManager {
  private static instance: ConnectorAutoRefreshManager | null = null;
  private store = new ConnectorAutoRefreshStore();
  private entries = new Map<string, ConnectorAutoRefreshEntry>();
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private isTicking = false;
  private ownerId = `refresh-${process.pid}-${generateId().slice(0, 6)}`;
  private lastLoadedAt = 0;

  static getInstance(): ConnectorAutoRefreshManager {
    if (!ConnectorAutoRefreshManager.instance) {
      ConnectorAutoRefreshManager.instance = new ConnectorAutoRefreshManager();
    }
    return ConnectorAutoRefreshManager.instance;
  }

  async start(): Promise<void> {
    if (this.tickTimer) return;
    await this.load();
    this.tickTimer = setInterval(() => {
      void this.tick();
    }, DEFAULT_TICK_MS);
    if (typeof (this.tickTimer as any).unref === 'function') {
      (this.tickTimer as any).unref();
    }
  }

  async stop(): Promise<void> {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  private async load(force = false): Promise<void> {
    const now = Date.now();
    if (!force && now - this.lastLoadedAt < 5000) return;
    const state = await this.store.load();
    this.entries = new Map(Object.values(state.entries).map((entry) => [entry.connector, entry]));
    this.lastLoadedAt = now;
  }

  private async persist(): Promise<void> {
    const state: ConnectorAutoRefreshState = {
      version: STORE_VERSION,
      updatedAt: Date.now(),
      entries: Object.fromEntries(this.entries),
    };
    await this.store.save(state);
  }

  list(): ConnectorAutoRefreshEntry[] {
    return Array.from(this.entries.values()).sort((a, b) => a.connector.localeCompare(b.connector));
  }

  get(connector: string): ConnectorAutoRefreshEntry | null {
    return this.entries.get(connector.toLowerCase()) || null;
  }

  async enable(connector: string, schedule?: ConnectorAutoRefreshSchedule, command?: string): Promise<ConnectorAutoRefreshEntry> {
    const name = connector.toLowerCase();
    const now = Date.now();
    const existing = this.entries.get(name);
    const nextSchedule = schedule ?? existing?.schedule ?? { kind: 'interval', interval: DEFAULT_INTERVAL_MINUTES, unit: 'minutes' };
    const entry: ConnectorAutoRefreshEntry = {
      connector: name,
      enabled: true,
      schedule: nextSchedule,
      command: command?.trim() || existing?.command || DEFAULT_COMMAND,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      nextRunAt: existing?.nextRunAt,
      lastRunAt: existing?.lastRunAt,
      lastResult: existing?.lastResult,
    };
    entry.nextRunAt = computeNextRun(entry, now);
    if (!entry.nextRunAt) {
      throw new Error('Invalid schedule: unable to compute next run time.');
    }
    this.entries.set(name, entry);
    await this.persist();
    return entry;
  }

  async disable(connector: string): Promise<ConnectorAutoRefreshEntry | null> {
    const name = connector.toLowerCase();
    const entry = this.entries.get(name);
    if (!entry) return null;
    entry.enabled = false;
    entry.updatedAt = Date.now();
    this.entries.set(name, entry);
    await this.persist();
    return entry;
  }

  async remove(connector: string): Promise<boolean> {
    const name = connector.toLowerCase();
    const existed = this.entries.delete(name);
    if (existed) {
      await this.persist();
    }
    return existed;
  }

  buildPromptSection(connectors: Connector[]): string | null {
    const entries = this.list();
    if (connectors.length === 0 && entries.length === 0) return null;

    const byName = new Map(entries.map((entry) => [entry.connector, entry]));
    const names = new Set<string>();
    for (const connector of connectors) {
      names.add(connector.name.toLowerCase());
    }
    for (const entry of entries) {
      names.add(entry.connector);
    }
    const sorted = Array.from(names).sort();
    const lines: string[] = [];
    lines.push('## Connector Auto-Refresh');
    lines.push('Global background token refresh jobs (not tied to sessions).');

    const limit = 20;
    for (const name of sorted.slice(0, limit)) {
      const entry = byName.get(name);
      if (!entry) {
        lines.push(`- ${name}: not configured`);
        continue;
      }
      const status = entry.enabled ? 'enabled' : 'disabled';
      const nextRun = entry.nextRunAt ? new Date(entry.nextRunAt).toISOString() : 'n/a';
      lines.push(`- ${name}: ${status} (${scheduleLabel(entry.schedule)}), next ${nextRun}`);
    }

    if (sorted.length > limit) {
      lines.push(`- ... ${sorted.length - limit} more connector(s) not shown`);
    }

    lines.push('Use connector_autorefresh to enable, disable, or change schedules.');
    return lines.join('\n');
  }

  private async tick(): Promise<void> {
    if (this.isTicking) return;
    this.isTicking = true;
    try {
      await this.load();
      const now = Date.now();
      const entries = this.list().filter((entry) => entry.enabled && entry.nextRunAt && entry.nextRunAt <= now);
      for (const entry of entries) {
        const locked = await this.store.acquireLock(entry.connector, this.ownerId);
        if (!locked) continue;
        try {
          await this.runEntry(entry);
        } finally {
          await this.store.releaseLock(entry.connector, this.ownerId);
        }
      }
    } finally {
      this.isTicking = false;
    }
  }

  private async runEntry(entry: ConnectorAutoRefreshEntry): Promise<void> {
    const runtime = getRuntime();
    const cli = `connect-${entry.connector}`;
    const cmdParts = buildCommandArgs(cli, splitCommandLine(entry.command));
    const start = Date.now();

    try {
      const proc = runtime.spawn(cmdParts, {
        cwd: process.cwd(),
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const [stdout, stderr] = await Promise.all([
        proc.stdout ? new Response(proc.stdout).text() : '',
        proc.stderr ? new Response(proc.stderr).text() : '',
      ]);
      const exitCode = await proc.exited;
      const combined = `${stdout}\n${stderr}`.trim();

      entry.lastRunAt = start;
      entry.lastResult = exitCode === 0
        ? { ok: true, summary: truncateSummary(combined || 'ok') }
        : { ok: false, error: truncateSummary(combined || `exit ${exitCode}`) };
    } catch (error) {
      entry.lastRunAt = start;
      entry.lastResult = {
        ok: false,
        error: truncateSummary(error instanceof Error ? error.message : String(error)),
      };
    }

    entry.updatedAt = Date.now();
    entry.nextRunAt = computeNextRun(entry, entry.updatedAt);
    this.entries.set(entry.connector, entry);
    await this.persist();
  }
}
