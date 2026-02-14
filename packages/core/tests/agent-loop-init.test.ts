import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { AssistantLoop } from '../src/agent/loop';
import { closeDatabase, resetDatabaseSingleton, getDatabase } from '../src/database';
import { StatePersistence } from '../src/heartbeat/persistence';

let tempDir: string;
let originalAssistantsDir: string | undefined;

beforeEach(() => {
  originalAssistantsDir = process.env.ASSISTANTS_DIR;
  tempDir = mkdtempSync(join(tmpdir(), 'assistants-init-'));
  process.env.ASSISTANTS_DIR = tempDir;
  resetDatabaseSingleton();

  // Minimal config to avoid connector discovery and provide API key
  writeFileSync(
    join(tempDir, 'config.json'),
    JSON.stringify(
      {
        llm: { provider: 'anthropic', model: 'mock', apiKey: 'test-key' },
        connectors: [],
      },
      null,
      2
    )
  );
});

afterEach(() => {
  closeDatabase();
  resetDatabaseSingleton();
  process.env.ASSISTANTS_DIR = originalAssistantsDir;
  rmSync(tempDir, { recursive: true, force: true });
});

describe('AssistantLoop initialize', () => {
  test('initializes tools and commands', async () => {
    const assistant = new AssistantLoop({ cwd: tempDir });
    await assistant.initialize();

    const tools = assistant.getTools();
    expect(tools.length).toBeGreaterThan(0);
    expect(tools.some((tool) => tool.name === 'connector_autorefresh')).toBe(true);
    expect(tools.some((tool) => tool.name === 'connectors_search')).toBe(true);
    expect(tools.some((tool) => tool.name === 'connector_execute')).toBe(true);
  });

  test('registers filesystem and audio tools', async () => {
    const assistant = new AssistantLoop({ cwd: tempDir });
    await assistant.initialize();

    const tools = assistant.getTools();
    const toolNames = tools.map((t) => t.name);

    // Filesystem tools
    expect(toolNames).toContain('read');
    expect(toolNames).toContain('write');
    expect(toolNames).toContain('glob');
    expect(toolNames).toContain('grep');
    expect(toolNames).toContain('read_pdf');

    // Audio tool registered alongside filesystem tools
    expect(toolNames).toContain('read_audio');
  });

  test('registers skill tools including install and uninstall', async () => {
    const assistant = new AssistantLoop({ cwd: tempDir });
    await assistant.initialize();

    const tools = assistant.getTools();
    const toolNames = tools.map((t) => t.name);

    // Core skill tools
    expect(toolNames).toContain('skill_create');
    expect(toolNames).toContain('skills_list');
    expect(toolNames).toContain('skill_read');
    expect(toolNames).toContain('skill_execute');

    // New npm skill management tools
    expect(toolNames).toContain('skill_install');
    expect(toolNames).toContain('skill_uninstall');
  });

  test('emits recovery notice before heartbeat startup overwrites stale state', async () => {
    const chunks: string[] = [];
    const assistant = new AssistantLoop({
      cwd: tempDir,
      onChunk: (chunk) => {
        if (chunk.type === 'text' && chunk.content) chunks.push(chunk.content);
      },
    });
    const sessionId = (assistant as any).sessionId as string;

    const oldTimestamp = new Date(Date.now() - 5 * 60 * 1000).toISOString();

    // Write recovery state to the database (not files)
    const persistence = new StatePersistence(sessionId, getDatabase());
    await persistence.save({
      sessionId,
      heartbeat: {
        sessionId,
        timestamp: oldTimestamp,
        state: 'processing',
        lastActivity: oldTimestamp,
        stats: { messagesProcessed: 1, toolCallsExecuted: 0, errorsEncountered: 0, uptimeSeconds: 10 },
      },
      context: { cwd: tempDir },
      timestamp: oldTimestamp,
    });

    await assistant.initialize();
    expect(chunks.some((line) => line.includes('Recovery available from'))).toBe(true);
  });

});
