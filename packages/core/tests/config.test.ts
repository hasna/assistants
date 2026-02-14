import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { loadConfig } from '../src/config';
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

let tempDir: string;
let originalHome: string | undefined;

beforeEach(async () => {
  originalHome = process.env.HOME;
  tempDir = await mkdtemp(join(tmpdir(), 'assistants-config-'));
  const fakeHome = join(tempDir, 'home');
  await mkdir(fakeHome, { recursive: true });
  process.env.HOME = fakeHome;
});

afterEach(async () => {
  process.env.HOME = originalHome;
  await rm(tempDir, { recursive: true, force: true });
});

describe('loadConfig', () => {
  test('should preserve defaults when partial config provided', async () => {
    const projectDir = join(tempDir, 'project');
    const projectConfigDir = join(projectDir, '.assistants');
    await mkdir(projectConfigDir, { recursive: true });

    const config = {
      llm: { model: 'custom-model' },
      voice: { enabled: true, tts: { voiceId: 'voice-1' } },
    };

    await writeFile(join(projectConfigDir, 'config.json'), JSON.stringify(config));

    const loaded = await loadConfig(projectDir);

    expect(loaded.llm.provider).toBe('anthropic');
    expect(loaded.llm.model).toBe('custom-model');
    expect(loaded.llm.maxTokens).toBe(8192);

    expect(loaded.voice?.enabled).toBe(true);
    expect(loaded.voice?.tts.voiceId).toBe('voice-1');
    // Defaults should still be present
    expect(loaded.voice?.stt.provider).toBe('whisper');
    expect(loaded.voice?.tts.model).toBe('eleven_v3');
  });

  test('should allow project local config to override project config', async () => {
    const projectDir = join(tempDir, 'project');
    const projectConfigDir = join(projectDir, '.assistants');
    await mkdir(projectConfigDir, { recursive: true });

    await writeFile(
      join(projectConfigDir, 'config.json'),
      JSON.stringify({ llm: { model: 'project-model', maxTokens: 4096 } })
    );
    await writeFile(
      join(projectConfigDir, 'config.local.json'),
      JSON.stringify({ llm: { model: 'local-model' } })
    );

    const loaded = await loadConfig(projectDir);

    expect(loaded.llm.model).toBe('local-model');
    expect(loaded.llm.maxTokens).toBe(4096);
  });
});
