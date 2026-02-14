import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { resetDatabaseSingleton, closeDatabase } from '../src/database';

let tempDir: string;
let originalAssistantsDir: string | undefined;

// Dynamically import the module so it picks up the current ASSISTANTS_DIR
let loadHistory: () => Promise<string[]>;
let saveHistory: (history: string[]) => Promise<void>;
let appendToHistory: (command: string) => Promise<void>;
let CommandHistory: new () => any;

describe('Command History', () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'assistants-history-'));
    originalAssistantsDir = process.env.ASSISTANTS_DIR;
    process.env.ASSISTANTS_DIR = tempDir;
    resetDatabaseSingleton();

    // Re-import to pick up fresh env
    const mod = await import('../src/history');
    loadHistory = mod.loadHistory;
    saveHistory = mod.saveHistory;
    appendToHistory = mod.appendToHistory;
    CommandHistory = mod.CommandHistory;
  });

  afterEach(async () => {
    closeDatabase();
    resetDatabaseSingleton();
    process.env.ASSISTANTS_DIR = originalAssistantsDir;
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('loadHistory', () => {
    test('returns empty array when no history exists', async () => {
      const history = await loadHistory();
      expect(history).toEqual([]);
    });

    test('loads previously saved history', async () => {
      await saveHistory(['/help', '/status', '/clear']);
      const history = await loadHistory();
      expect(history).toEqual(['/help', '/status', '/clear']);
    });
  });

  describe('saveHistory', () => {
    test('saves and loads history', async () => {
      await saveHistory(['/help', '/status', '/clear']);
      const loaded = await loadHistory();
      expect(loaded).toEqual(['/help', '/status', '/clear']);
    });

    test('replaces existing history', async () => {
      await saveHistory(['/help', '/status']);
      await saveHistory(['/clear', '/exit']);
      const loaded = await loadHistory();
      expect(loaded).toEqual(['/clear', '/exit']);
    });
  });

  describe('appendToHistory', () => {
    test('appends to existing history', async () => {
      await saveHistory(['/help']);
      await appendToHistory('/status');
      const loaded = await loadHistory();
      expect(loaded).toEqual(['/help', '/status']);
    });

    test('creates history if none exists', async () => {
      await appendToHistory('/help');
      const loaded = await loadHistory();
      expect(loaded).toEqual(['/help']);
    });

    test('ignores empty commands', async () => {
      await appendToHistory('');
      await appendToHistory('   ');
      const history = await loadHistory();
      expect(history).toEqual([]);
    });
  });

  describe('CommandHistory class', () => {
    test('navigates through history', async () => {
      const history = new CommandHistory();
      await history.add('/help');
      await history.add('/status');
      await history.add('/clear');

      // Start navigation - should get last command
      expect(history.previous()).toBe('/clear');
      expect(history.previous()).toBe('/status');
      expect(history.previous()).toBe('/help');
      // Already at oldest
      expect(history.previous()).toBe(null);

      // Navigate forward
      expect(history.next()).toBe('/status');
      expect(history.next()).toBe('/clear');
      // Past end - returns saved input (empty in this case)
      expect(history.next()).toBe('');
    });

    test('skips duplicate of last command', async () => {
      const history = new CommandHistory();
      await history.add('/help');
      await history.add('/help'); // Duplicate
      await history.add('/status');

      expect(history.previous()).toBe('/status');
      expect(history.previous()).toBe('/help');
      expect(history.previous()).toBe(null); // Only 2 unique entries
    });

    test('resetIndex clears navigation state', async () => {
      const history = new CommandHistory();
      await history.add('/help');
      await history.add('/status');

      history.previous(); // Start navigation
      expect(history.isNavigating()).toBe(true);

      history.resetIndex();
      expect(history.isNavigating()).toBe(false);
    });

    test('preserves saved input during navigation', async () => {
      const history = new CommandHistory();
      await history.add('/help');
      await history.add('/status');

      // Simulate user typing before navigating
      history.resetIndex('partial text');

      // Navigate up
      expect(history.previous()).toBe('/status');
      expect(history.previous()).toBe('/help');

      // Navigate down past end - should restore saved input
      expect(history.next()).toBe('/status');
      expect(history.next()).toBe('partial text');
    });
  });
});
