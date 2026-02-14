import { describe, expect, test } from 'bun:test';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { FilesystemTools } from '../src/tools/filesystem';
import { AssistantContext } from '../src/agent/context';

describe('Read tool image auto-detection', () => {
  test('should return __image_attachment__ JSON for PNG files', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'assistants-img-'));
    try {
      const filePath = join(tempDir, 'test.png');
      // Write a minimal PNG (1x1 red pixel)
      const pngHeader = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
      ]);
      await writeFile(filePath, pngHeader);

      const result = await FilesystemTools.readExecutor({ path: filePath, cwd: tempDir } as any);
      const parsed = JSON.parse(result);
      expect(parsed.__image_attachment__).toBe(true);
      expect(parsed.mediaType).toBe('image/png');
      expect(parsed.name).toBe('test.png');
      expect(typeof parsed.data).toBe('string'); // base64 string
      expect(parsed.data.length).toBeGreaterThan(0);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test('should return __image_attachment__ JSON for JPG files', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'assistants-img-'));
    try {
      const filePath = join(tempDir, 'photo.jpg');
      await writeFile(filePath, Buffer.from([0xff, 0xd8, 0xff, 0xe0])); // JPEG magic bytes
      const result = await FilesystemTools.readExecutor({ path: filePath, cwd: tempDir } as any);
      const parsed = JSON.parse(result);
      expect(parsed.__image_attachment__).toBe(true);
      expect(parsed.mediaType).toBe('image/jpeg');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test('should return __image_attachment__ JSON for JPEG files', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'assistants-img-'));
    try {
      const filePath = join(tempDir, 'photo.jpeg');
      await writeFile(filePath, Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
      const result = await FilesystemTools.readExecutor({ path: filePath, cwd: tempDir } as any);
      const parsed = JSON.parse(result);
      expect(parsed.__image_attachment__).toBe(true);
      expect(parsed.mediaType).toBe('image/jpeg');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test('should return __image_attachment__ JSON for GIF files', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'assistants-img-'));
    try {
      const filePath = join(tempDir, 'anim.gif');
      await writeFile(filePath, Buffer.from('GIF89a')); // GIF magic bytes
      const result = await FilesystemTools.readExecutor({ path: filePath, cwd: tempDir } as any);
      const parsed = JSON.parse(result);
      expect(parsed.__image_attachment__).toBe(true);
      expect(parsed.mediaType).toBe('image/gif');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test('should return __image_attachment__ JSON for WebP files', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'assistants-img-'));
    try {
      const filePath = join(tempDir, 'image.webp');
      await writeFile(filePath, Buffer.from('RIFF....WEBP'));
      const result = await FilesystemTools.readExecutor({ path: filePath, cwd: tempDir } as any);
      const parsed = JSON.parse(result);
      expect(parsed.__image_attachment__).toBe(true);
      expect(parsed.mediaType).toBe('image/webp');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test('should return __image_attachment__ JSON for BMP files', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'assistants-img-'));
    try {
      const filePath = join(tempDir, 'bitmap.bmp');
      await writeFile(filePath, Buffer.from('BM'));
      const result = await FilesystemTools.readExecutor({ path: filePath, cwd: tempDir } as any);
      const parsed = JSON.parse(result);
      expect(parsed.__image_attachment__).toBe(true);
      expect(parsed.mediaType).toBe('image/bmp');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test('should still read text files normally', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'assistants-img-'));
    try {
      const filePath = join(tempDir, 'code.ts');
      await writeFile(filePath, 'const x = 1;\nconst y = 2;\n');
      const result = await FilesystemTools.readExecutor({ path: filePath, cwd: tempDir } as any);
      expect(result).toContain('const x = 1');
      expect(result).toContain('const y = 2');
      // Should NOT be an attachment
      expect(result).not.toContain('__image_attachment__');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test('should delegate .pdf to readPdfExecutor', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'assistants-img-'));
    try {
      const filePath = join(tempDir, 'doc.pdf');
      // Write a minimal PDF header
      await writeFile(filePath, '%PDF-1.4\nfake pdf content');
      const result = await FilesystemTools.readExecutor({ path: filePath, cwd: tempDir } as any);
      const parsed = JSON.parse(result);
      expect(parsed.__pdf_attachment__).toBe(true);
      expect(parsed.mediaType).toBe('application/pdf');
      expect(parsed.name).toBe('doc.pdf');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test('read tool description mentions image and PDF support', () => {
    expect(FilesystemTools.readTool.description).toContain('image');
    expect(FilesystemTools.readTool.description).toContain('PDF');
  });
});

describe('Context extractImageAttachment', () => {
  test('should extract image attachment from __image_attachment__ JSON', () => {
    const ctx = new AssistantContext();
    const imageJson = JSON.stringify({
      __image_attachment__: true,
      name: 'photo.png',
      mediaType: 'image/png',
      data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      size: 67,
    });

    const msg = ctx.addToolResults([
      { toolCallId: 'tc1', content: imageJson, rawContent: imageJson },
    ]);

    expect(msg.documents).toBeDefined();
    expect(msg.documents!.length).toBe(1);
    expect(msg.documents![0].type).toBe('image');
    expect(msg.documents![0].name).toBe('photo.png');
    expect(msg.documents![0].mediaType).toBe('image/png');
    expect(msg.documents![0].source.type).toBe('base64');
  });

  test('should show friendly message for image tool results', () => {
    const ctx = new AssistantContext();
    const imageJson = JSON.stringify({
      __image_attachment__: true,
      name: 'screenshot.jpg',
      mediaType: 'image/jpeg',
      data: 'base64data',
      size: 1024,
    });

    const msg = ctx.addToolResults([
      { toolCallId: 'tc1', content: imageJson, rawContent: imageJson },
    ]);

    expect(msg.toolResults![0].content).toContain('Image loaded: screenshot.jpg');
  });

  test('should still extract PDF attachments', () => {
    const ctx = new AssistantContext();
    const pdfJson = JSON.stringify({
      __pdf_attachment__: true,
      name: 'report.pdf',
      mediaType: 'application/pdf',
      data: 'JVBERi0xLjQK',
      size: 100,
    });

    const msg = ctx.addToolResults([
      { toolCallId: 'tc1', content: pdfJson, rawContent: pdfJson },
    ]);

    expect(msg.documents).toBeDefined();
    expect(msg.documents!.length).toBe(1);
    expect(msg.documents![0].type).toBe('pdf');
  });

  test('should handle regular tool results without attachments', () => {
    const ctx = new AssistantContext();
    const msg = ctx.addToolResults([
      { toolCallId: 'tc1', content: 'hello world' },
    ]);

    expect(msg.documents).toBeUndefined();
    expect(msg.toolResults![0].content).toBe('hello world');
  });

  test('should handle mixed image and regular tool results', () => {
    const ctx = new AssistantContext();
    const imageJson = JSON.stringify({
      __image_attachment__: true,
      name: 'chart.png',
      mediaType: 'image/png',
      data: 'base64data',
      size: 500,
    });

    const msg = ctx.addToolResults([
      { toolCallId: 'tc1', content: imageJson, rawContent: imageJson },
      { toolCallId: 'tc2', content: 'regular text result' },
    ]);

    expect(msg.documents).toBeDefined();
    expect(msg.documents!.length).toBe(1);
    expect(msg.documents![0].type).toBe('image');
    expect(msg.toolResults![1].content).toBe('regular text result');
  });
});
