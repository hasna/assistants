/**
 * Media integration test - verifies the full pipeline:
 * 1. Read tool auto-detects images and returns __image_attachment__ JSON
 * 2. Context.addToolResults extracts image/pdf attachments into documents array
 * 3. Anthropic client converts image documents to ImageBlockParam
 * 4. OpenAI client converts image documents to image_url content parts
 * 5. Audio tool validates file extensions, size limits, and path resolution
 * 6. Tool registration: verify read_audio is registered alongside existing tools
 */

import { describe, expect, test } from 'bun:test';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { FilesystemTools } from '../src/tools/filesystem';
import { AssistantContext } from '../src/agent/context';
import { AnthropicClient } from '../src/llm/anthropic';
import { OpenAIClient } from '../src/llm/openai';
import { AudioTools } from '../src/tools/audio';
import type { Message, LLMConfig, DocumentAttachment } from '@hasna/assistants-shared';

const anthropicConfig: LLMConfig = {
  provider: 'anthropic',
  model: 'claude-3-haiku-20240307',
  apiKey: 'test-api-key',
  maxTokens: 4096,
};

const openaiConfig: LLMConfig = {
  provider: 'openai',
  model: 'gpt-4o',
  apiKey: 'test-api-key',
  maxTokens: 4096,
};

describe('Media integration: full pipeline', () => {
  test('PNG image flows from read tool through context to Anthropic client', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'media-int-'));
    try {
      // Step 1: Read tool auto-detects PNG and returns __image_attachment__ JSON
      const filePath = join(tempDir, 'chart.png');
      const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      await writeFile(filePath, pngHeader);

      const readResult = await FilesystemTools.readExecutor({ path: filePath, cwd: tempDir } as any);
      const parsed = JSON.parse(readResult);
      expect(parsed.__image_attachment__).toBe(true);
      expect(parsed.mediaType).toBe('image/png');

      // Step 2: Context extracts image attachment into documents array
      const ctx = new AssistantContext();
      const msg = ctx.addToolResults([
        { toolCallId: 'tc1', content: readResult, rawContent: readResult },
      ]);

      expect(msg.documents).toBeDefined();
      expect(msg.documents!.length).toBe(1);
      expect(msg.documents![0].type).toBe('image');
      expect(msg.documents![0].source.type).toBe('base64');
      expect(msg.documents![0].mediaType).toBe('image/png');

      // Tool result content is replaced with friendly message
      expect(msg.toolResults![0].content).toContain('Image loaded:');

      // Step 3: Anthropic client converts to ImageBlockParam
      const anthropic = new AnthropicClient(anthropicConfig);
      const messages: Message[] = [
        {
          id: '1',
          role: 'assistant',
          content: 'Reading the image.',
          timestamp: Date.now(),
          toolCalls: [{ id: 'tc1', name: 'read', input: { path: 'chart.png' } }],
        },
        msg,
      ];

      const converted = (anthropic as any).convertMessages(messages);
      const userMsg = converted.find((m: any) => m.role === 'user');
      expect(userMsg).toBeDefined();

      const imageBlocks = userMsg.content.filter((b: any) => b.type === 'image');
      expect(imageBlocks.length).toBe(1);
      expect(imageBlocks[0].source.type).toBe('base64');
      expect(imageBlocks[0].source.media_type).toBe('image/png');
      expect(typeof imageBlocks[0].source.data).toBe('string');
      expect(imageBlocks[0].source.data.length).toBeGreaterThan(0);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test('JPEG image flows from read tool through context to OpenAI client', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'media-int-'));
    try {
      // Step 1: Read tool auto-detects JPEG
      const filePath = join(tempDir, 'photo.jpg');
      await writeFile(filePath, Buffer.from([0xff, 0xd8, 0xff, 0xe0]));

      const readResult = await FilesystemTools.readExecutor({ path: filePath, cwd: tempDir } as any);
      const parsed = JSON.parse(readResult);
      expect(parsed.__image_attachment__).toBe(true);
      expect(parsed.mediaType).toBe('image/jpeg');

      // Step 2: Context extracts image
      const ctx = new AssistantContext();
      const msg = ctx.addToolResults([
        { toolCallId: 'tc1', content: readResult, rawContent: readResult },
      ]);
      expect(msg.documents![0].type).toBe('image');
      expect(msg.documents![0].mediaType).toBe('image/jpeg');

      // Step 4: OpenAI client converts to image_url content part
      const openai = new OpenAIClient(openaiConfig);
      const messages: Message[] = [
        {
          id: '1',
          role: 'assistant',
          content: 'Reading the image.',
          timestamp: Date.now(),
          toolCalls: [{ id: 'tc1', name: 'read', input: { path: 'photo.jpg' } }],
        },
        msg,
      ];

      const converted = (openai as any).convertMessages(messages, undefined);
      const imageMessages = converted.filter(
        (m: any) => m.role === 'user' && Array.isArray(m.content) && m.content.some((c: any) => c.type === 'image_url')
      );
      expect(imageMessages.length).toBe(1);

      const imageParts = imageMessages[0].content.filter((c: any) => c.type === 'image_url');
      expect(imageParts.length).toBe(1);
      expect(imageParts[0].image_url.url).toStartWith('data:image/jpeg;base64,');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test('PDF flows from read tool through context to Anthropic document block', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'media-int-'));
    try {
      // Step 1: Read tool delegates PDF
      const filePath = join(tempDir, 'report.pdf');
      await writeFile(filePath, '%PDF-1.4\nfake pdf content');

      const readResult = await FilesystemTools.readExecutor({ path: filePath, cwd: tempDir } as any);
      const parsed = JSON.parse(readResult);
      expect(parsed.__pdf_attachment__).toBe(true);
      expect(parsed.mediaType).toBe('application/pdf');

      // Step 2: Context extracts PDF attachment
      const ctx = new AssistantContext();
      const msg = ctx.addToolResults([
        { toolCallId: 'tc1', content: readResult, rawContent: readResult },
      ]);
      expect(msg.documents!.length).toBe(1);
      expect(msg.documents![0].type).toBe('pdf');
      expect(msg.toolResults![0].content).toContain('PDF loaded:');

      // Step 3: Anthropic client converts to DocumentBlockParam
      const anthropic = new AnthropicClient(anthropicConfig);
      const messages: Message[] = [
        {
          id: '1',
          role: 'assistant',
          content: 'Reading the document.',
          timestamp: Date.now(),
          toolCalls: [{ id: 'tc1', name: 'read', input: { path: 'report.pdf' } }],
        },
        msg,
      ];

      const converted = (anthropic as any).convertMessages(messages);
      const userMsg = converted.find((m: any) => m.role === 'user');
      const docBlocks = userMsg.content.filter((b: any) => b.type === 'document');
      expect(docBlocks.length).toBe(1);
      expect(docBlocks[0].source.type).toBe('base64');
      expect(docBlocks[0].source.media_type).toBe('application/pdf');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test('mixed image and text tool results are handled correctly', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'media-int-'));
    try {
      // Create an image file
      const imgPath = join(tempDir, 'screenshot.webp');
      await writeFile(imgPath, Buffer.from('RIFF....WEBP'));

      const imageResult = await FilesystemTools.readExecutor({ path: imgPath, cwd: tempDir } as any);

      // Create a regular text file
      const txtPath = join(tempDir, 'notes.txt');
      await writeFile(txtPath, 'hello world');
      const textResult = await FilesystemTools.readExecutor({ path: txtPath, cwd: tempDir } as any);

      // Both results through context
      const ctx = new AssistantContext();
      const msg = ctx.addToolResults([
        { toolCallId: 'tc1', content: imageResult, rawContent: imageResult },
        { toolCallId: 'tc2', content: textResult, rawContent: textResult },
      ]);

      // Only the image should become a document
      expect(msg.documents!.length).toBe(1);
      expect(msg.documents![0].type).toBe('image');
      expect(msg.documents![0].mediaType).toBe('image/webp');

      // Text result should pass through unchanged
      expect(msg.toolResults![1].content).toContain('hello world');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

describe('Media integration: audio tool validation', () => {
  test('rejects unsupported audio format before reaching API', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'media-int-audio-'));
    try {
      const filePath = join(tempDir, 'audio.txt');
      await writeFile(filePath, 'not audio');
      await expect(
        AudioTools.readAudioExecutor({ path: filePath, cwd: tempDir } as any)
      ).rejects.toThrow('Unsupported audio format');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test('accepts all 7 supported audio extensions without format error', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'media-int-audio-'));
    try {
      const extensions = ['.wav', '.mp3', '.m4a', '.flac', '.ogg', '.webm', '.aac'];
      for (const ext of extensions) {
        const filePath = join(tempDir, `test${ext}`);
        await writeFile(filePath, 'fake audio data');
        try {
          await AudioTools.readAudioExecutor({ path: filePath, cwd: tempDir } as any);
        } catch (err: any) {
          // Should fail at API call, never at format validation
          expect(err.message).not.toContain('Unsupported audio format');
        }
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test('resolves relative paths correctly', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'media-int-audio-'));
    try {
      await writeFile(join(tempDir, 'recording.mp3'), 'fake audio');
      try {
        await AudioTools.readAudioExecutor({ path: 'recording.mp3', cwd: tempDir } as any);
      } catch (err: any) {
        // Should resolve the path (fail at API, not at "not found")
        expect(err.message).not.toContain('not found');
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test('throws on empty path', async () => {
    await expect(
      AudioTools.readAudioExecutor({ path: '', cwd: '/tmp' } as any)
    ).rejects.toThrow('Audio file path is required');
  });
});

describe('Media integration: tool registration', () => {
  test('read_audio registers alongside other tools in a mock registry', () => {
    const registered: string[] = [];
    const mockRegistry = {
      register: (tool: any, _executor: any) => {
        registered.push(tool.name);
      },
    };

    // Register filesystem tools
    FilesystemTools.registerAll(mockRegistry as any, { cwd: '/tmp' });

    // Register audio tools
    AudioTools.registerAll(mockRegistry as any);

    // Both read (filesystem) and read_audio should be registered
    expect(registered).toContain('read');
    expect(registered).toContain('read_audio');
    expect(registered).toContain('write');
    expect(registered).toContain('glob');
  });
});
