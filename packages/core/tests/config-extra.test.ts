import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { ensureConfigDir, loadHooksConfig, loadSystemPrompt, loadConfig, getTempFolder, getConfigDir } from '../src/config';

let tempDir: string;
let originalAssistantsDir: string | undefined;

beforeEach(() => {
  originalAssistantsDir = process.env.ASSISTANTS_DIR;
  tempDir = mkdtempSync(join(tmpdir(), 'assistants-config-'));
  process.env.ASSISTANTS_DIR = tempDir;
});

afterEach(() => {
  process.env.ASSISTANTS_DIR = originalAssistantsDir;
  rmSync(tempDir, { recursive: true, force: true });
});

describe('config helpers', () => {
  test('ensureConfigDir creates base directories', async () => {
    await ensureConfigDir('sess');
    expect(existsSync(join(tempDir, 'logs'))).toBe(true);
    expect(existsSync(join(tempDir, 'temp'))).toBe(true);
    expect(existsSync(join(tempDir, 'temp', 'sess'))).toBe(true);
    expect(existsSync(join(tempDir, 'messages'))).toBe(true);
    expect(existsSync(join(tempDir, 'backups'))).toBe(true);
  });

  test('loadHooksConfig merges user and project hooks', async () => {
    const userHooksPath = join(tempDir, 'hooks.json');
    writeFileSync(
      userHooksPath,
      JSON.stringify(
        { hooks: { PreToolUse: [{ matcher: 'bash', hooks: [{ type: 'command', command: 'echo ok' }] }] } },
        null,
        2
      )
    );

    const projectDir = mkdtempSync(join(tmpdir(), 'assistants-project-'));
    const projectHooksDir = join(projectDir, '.assistants');
    mkdirSync(projectHooksDir, { recursive: true });
    writeFileSync(
      join(projectHooksDir, 'hooks.json'),
      JSON.stringify(
        { hooks: { PostToolUse: [{ hooks: [{ type: 'command', command: 'echo ok' }] }] } },
        null,
        2
      )
    );

    const hooks = await loadHooksConfig(projectDir);
    expect(hooks.PreToolUse?.length).toBe(1);
    expect(hooks.PostToolUse?.length).toBe(1);

    rmSync(projectDir, { recursive: true, force: true });
  });

  test('loadSystemPrompt combines global and project prompts', async () => {
    writeFileSync(join(tempDir, 'ASSISTANTS.md'), 'global');

    const projectDir = mkdtempSync(join(tmpdir(), 'assistants-project-'));
    const projectConfigDir = join(projectDir, '.assistants');
    mkdirSync(projectConfigDir, { recursive: true });
    writeFileSync(join(projectConfigDir, 'ASSISTANTS.md'), 'project');

    const prompt = await loadSystemPrompt(projectDir);
    expect(prompt).toContain('global');
    expect(prompt).toContain('project');
    expect(prompt).toContain('---');

    rmSync(projectDir, { recursive: true, force: true });
  });

  test('loadSystemPrompt returns default prompt when no prompt files exist', async () => {
    const prompt = await loadSystemPrompt(tempDir);
    expect(prompt).toContain('You are a helpful AI assistant by Hasna');
  });

  test('loadSystemPrompt tolerates read errors', async () => {
    const originalFile = Bun.file;
    try {
      (Bun as any).file = () => {
        throw new Error('boom');
      };
      const prompt = await loadSystemPrompt(tempDir);
      expect(prompt).toContain('You are a helpful AI assistant by Hasna');
    } finally {
      (Bun as any).file = originalFile;
    }
  });

  test('loadConfig ignores invalid JSON files', async () => {
    const invalidPath = join(tempDir, 'config.json');
    writeFileSync(invalidPath, '{ invalid json');
    const loaded = await loadConfig(tempDir);
    expect(loaded.llm.provider).toBeDefined();
  });

  test('loadConfig honors explicit baseDir override', async () => {
    const workspaceDir = join(tempDir, 'workspace-a');
    mkdirSync(workspaceDir, { recursive: true });

    writeFileSync(
      join(workspaceDir, 'config.json'),
      JSON.stringify({ llm: { provider: 'openai', model: 'gpt-5-mini' } }, null, 2)
    );
    writeFileSync(
      join(tempDir, 'config.json'),
      JSON.stringify({ llm: { provider: 'anthropic', model: 'claude-opus-4-1' } }, null, 2)
    );

    const loaded = await loadConfig(tempDir, workspaceDir);
    expect(loaded.llm.provider).toBe('openai');
    expect(loaded.llm.model).toBe('gpt-5-mini');
  });

  test('ensureConfigDir and getTempFolder honor explicit baseDir override', async () => {
    const workspaceDir = join(tempDir, 'workspace-b');
    await ensureConfigDir('sess-base', workspaceDir);

    expect(existsSync(join(workspaceDir, 'logs'))).toBe(true);
    expect(existsSync(join(workspaceDir, 'temp', 'sess-base'))).toBe(true);
    expect(getTempFolder('sess-base', workspaceDir)).toBe(join(workspaceDir, 'temp', 'sess-base'));
  });

  test('getTempFolder uses config dir', () => {
    const tempPath = getTempFolder('abc');
    expect(tempPath).toBe(join(tempDir, 'temp', 'abc'));
  });

  test('getConfigDir uses HOME when ASSISTANTS_DIR is unset', () => {
    const originalAssistantsDir = process.env.ASSISTANTS_DIR;
    const originalHome = process.env.HOME;
    const homeDir = join(tempDir, 'home');
    mkdirSync(homeDir, { recursive: true });

    delete process.env.ASSISTANTS_DIR;
    process.env.HOME = homeDir;

    try {
      expect(getConfigDir()).toBe(join(homeDir, '.assistants'));
    } finally {
      process.env.ASSISTANTS_DIR = originalAssistantsDir;
      process.env.HOME = originalHome;
    }
  });
});
