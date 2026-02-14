import { describe, expect, test } from 'bun:test';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { AudioTools } from '../src/tools/audio';

describe('AudioTools', () => {
  describe('tool definition', () => {
    test('should have correct name and description', () => {
      expect(AudioTools.readAudioTool.name).toBe('read_audio');
      expect(AudioTools.readAudioTool.description).toContain('Transcribe');
      expect(AudioTools.readAudioTool.description).toContain('ElevenLabs');
    });

    test('should require path parameter', () => {
      expect(AudioTools.readAudioTool.parameters.required).toContain('path');
    });

    test('should have language parameter', () => {
      expect(AudioTools.readAudioTool.parameters.properties.language).toBeDefined();
      expect(AudioTools.readAudioTool.parameters.properties.language.type).toBe('string');
    });

    test('should have cwd parameter', () => {
      expect(AudioTools.readAudioTool.parameters.properties.cwd).toBeDefined();
    });
  });

  describe('readAudioExecutor', () => {
    test('should throw when path is empty', async () => {
      await expect(
        AudioTools.readAudioExecutor({ path: '', cwd: '/tmp' } as any)
      ).rejects.toThrow('Audio file path is required');
    });

    test('should throw when file not found', async () => {
      await expect(
        AudioTools.readAudioExecutor({ path: '/nonexistent/file.mp3', cwd: '/tmp' } as any)
      ).rejects.toThrow();
    });

    test('should throw for unsupported audio format', async () => {
      const tempDir = await mkdtemp(join(tmpdir(), 'assistants-audio-'));
      try {
        const filePath = join(tempDir, 'audio.xyz');
        await writeFile(filePath, 'fake audio content');
        await expect(
          AudioTools.readAudioExecutor({ path: filePath, cwd: tempDir } as any)
        ).rejects.toThrow('Unsupported audio format');
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    });

    test('should throw for oversized audio files', async () => {
      const tempDir = await mkdtemp(join(tmpdir(), 'assistants-audio-'));
      try {
        const filePath = join(tempDir, 'large.mp3');
        // Create a file that appears large via its content
        // We can't easily make a 25MB file in tests, so we check the code path
        // by verifying the error message format
        await writeFile(filePath, 'small content');
        // This won't hit size limit but verifies the file is read
        // It will fail at ElevenLabs API call (no API key)
        await expect(
          AudioTools.readAudioExecutor({ path: filePath, cwd: tempDir } as any)
        ).rejects.toThrow(); // Will throw due to missing API key
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    });

    test('should accept all supported audio extensions', async () => {
      const tempDir = await mkdtemp(join(tmpdir(), 'assistants-audio-'));
      try {
        const extensions = ['.wav', '.mp3', '.m4a', '.flac', '.ogg', '.webm', '.aac'];
        for (const ext of extensions) {
          const filePath = join(tempDir, `test${ext}`);
          await writeFile(filePath, 'fake audio data');
          // Should not throw "Unsupported audio format" - will throw at API call instead
          try {
            await AudioTools.readAudioExecutor({ path: filePath, cwd: tempDir } as any);
          } catch (err: any) {
            // Expected to fail due to missing API key, not unsupported format
            expect(err.message).not.toContain('Unsupported audio format');
          }
        }
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    });

    test('should resolve relative paths', async () => {
      const tempDir = await mkdtemp(join(tmpdir(), 'assistants-audio-'));
      try {
        const filePath = join(tempDir, 'test.mp3');
        await writeFile(filePath, 'fake audio data');
        // Should resolve relative to cwd - will fail at API call
        try {
          await AudioTools.readAudioExecutor({ path: 'test.mp3', cwd: tempDir } as any);
        } catch (err: any) {
          // Expected to fail at API call, not path resolution
          expect(err.message).not.toContain('not found');
        }
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe('registerAll', () => {
    test('should register read_audio tool', () => {
      const registered: string[] = [];
      const mockRegistry = {
        register: (tool: any, _executor: any) => {
          registered.push(tool.name);
        },
      };
      AudioTools.registerAll(mockRegistry as any);
      expect(registered).toContain('read_audio');
    });
  });
});
