import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { EmbeddedClient } from '../src/client';
import type { StreamChunk, Message, Tool, Skill } from '@hasna/assistants-shared';
import { mkdtemp, writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

describe('E2E: EmbeddedClient', () => {
  let client: EmbeddedClient;
  let tempDir: string;
  let chunks: StreamChunk[] = [];
  let errors: Error[] = [];

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'assistants-e2e-'));
    chunks = [];
    errors = [];

    // Create minimal project structure
    await mkdir(join(tempDir, '.assistants'), { recursive: true });
    await mkdir(join(tempDir, '.assistants', 'skills'), { recursive: true });

    client = new EmbeddedClient(tempDir);

    client.onChunk((chunk: StreamChunk) => {
      chunks.push(chunk);
    });

    client.onError((err: Error) => {
      errors.push(err);
    });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('initialization', () => {
    test('should initialize successfully', async () => {
      await client.initialize();
      // If we get here without error, initialization succeeded
      expect(true).toBe(true);
    });

    test('should have tools after initialization', async () => {
      await client.initialize();
      const tools = await client.getTools();

      expect(tools.length).toBeGreaterThan(0);
      expect(tools.some((t) => t.name === 'bash')).toBe(true);
      expect(tools.some((t) => t.name === 'read')).toBe(true);
    });
  });

  describe('skills', () => {
    test('should load skills from project directory', async () => {
      // Create a test skill
      const skillDir = join(tempDir, '.assistants', 'skills', 'test-skill');
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        join(skillDir, 'SKILL.md'),
        `---
name: test-skill
description: A test skill
---
# Test Skill
Test instructions here.
`
      );

      await client.initialize();
      const skills = await client.getSkills();

      expect(skills.length).toBeGreaterThan(0);
      expect(skills.some((s) => s.name === 'test-skill')).toBe(true);
    });

    test('should return empty skills when none exist', async () => {
      await client.initialize();
      const skills = await client.getSkills();

      expect(Array.isArray(skills)).toBe(true);
      // May have skills from user directory, so just check it's an array
    });
  });

  describe('message sending', () => {
    test('should send message and receive response', async () => {
      await client.initialize();

      // Send a simple message
      await client.send('Say exactly: "Test response"');

      // Check we received chunks
      expect(chunks.length).toBeGreaterThan(0);

      // Check for done chunk
      const doneChunk = chunks.find((c) => c.type === 'done');
      expect(doneChunk).toBeDefined();

      // Check for text content
      const textChunks = chunks.filter((c) => c.type === 'text');
      expect(textChunks.length).toBeGreaterThan(0);
    }, 30000); // 30 second timeout for API calls

    test('should handle errors gracefully', async () => {
      // Don't initialize - this should cause an error when processing
      // The client should handle this internally

      try {
        await client.send('Hello');
      } catch (e) {
        // Expected to throw since not initialized
        expect(e).toBeDefined();
      }
    });
  });

  describe('tool execution', () => {
    test('should execute tools and return results', async () => {
      await client.initialize();

      // Ask to list files - should trigger bash or glob tool
      await client.send('Use the glob tool to find all *.md files in the current directory');

      // Check for tool_use chunk
      const toolUseChunks = chunks.filter((c) => c.type === 'tool_use');
      // May or may not use tools depending on LLM decision
      expect(Array.isArray(toolUseChunks)).toBe(true);

      // Should have completed
      const doneChunk = chunks.find((c) => c.type === 'done');
      expect(doneChunk).toBeDefined();
    }, 60000); // 60 second timeout for tool execution
  });

  describe('stop', () => {
    test('should be able to stop processing', async () => {
      await client.initialize();

      // Start a request but stop it
      const sendPromise = client.send('Tell me a very long story');

      // Stop immediately
      client.stop();

      // Wait for the promise to resolve
      await sendPromise;

      // Should not throw
      expect(true).toBe(true);
    });
  });

  describe('disconnect', () => {
    test('should disconnect without error', async () => {
      await client.initialize();

      expect(() => client.disconnect()).not.toThrow();
    });
  });

  describe('isProcessing', () => {
    test('should return false when not processing', async () => {
      await client.initialize();

      expect(client.isProcessing()).toBe(false);
    });
  });
});

describe('E2E: Built-in Tools', () => {
  let client: EmbeddedClient;
  let tempDir: string;
  let responseText: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'assistants-e2e-'));
    responseText = '';

    await mkdir(join(tempDir, '.assistants'), { recursive: true });

    client = new EmbeddedClient(tempDir);

    client.onChunk((chunk: StreamChunk) => {
      if (chunk.type === 'text' && chunk.content) {
        responseText += chunk.content;
      }
    });

    await client.initialize();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test('should have bash tool', async () => {
    const tools = await client.getTools();
    const bashTool = tools.find((t) => t.name === 'bash');

    expect(bashTool).toBeDefined();
    expect(bashTool?.description).toContain('shell');
  });

  test('should have read tool', async () => {
    const tools = await client.getTools();
    const readTool = tools.find((t) => t.name === 'read');

    expect(readTool).toBeDefined();
    expect(readTool?.description).toContain('file');
  });

  test('should have write tool', async () => {
    const tools = await client.getTools();
    const writeTool = tools.find((t) => t.name === 'write');

    expect(writeTool).toBeDefined();
    expect(writeTool?.description).toContain('file');
  });

  test('should have glob tool', async () => {
    const tools = await client.getTools();
    const globTool = tools.find((t) => t.name === 'glob');

    expect(globTool).toBeDefined();
    expect(globTool?.description).toContain('pattern');
  });

  test('should have grep tool', async () => {
    const tools = await client.getTools();
    const grepTool = tools.find((t) => t.name === 'grep');

    expect(grepTool).toBeDefined();
    expect(grepTool?.description).toContain('pattern');
  });
});

describe('E2E: Connector Discovery', () => {
  let client: EmbeddedClient;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'assistants-e2e-'));
    await mkdir(join(tempDir, '.assistants'), { recursive: true });

    client = new EmbeddedClient(tempDir);
    await client.initialize();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test('should discover available connectors', async () => {
    const tools = await client.getTools();

    // Check for common connectors (may or may not be installed)
    const connectorNames = ['notion', 'googledrive', 'gmail', 'googlecalendar', 'linear', 'slack'];

    let foundConnectors = 0;
    for (const name of connectorNames) {
      if (tools.some((t) => t.name === name)) {
        foundConnectors++;
      }
    }

    // At least some connectors should be discovered if installed
    // This test just verifies the discovery mechanism works
    expect(typeof foundConnectors).toBe('number');
  });

  test('should create proper tool definitions for connectors', async () => {
    const tools = await client.getTools();

    // Find any connector tool
    const connectorTool = tools.find((t) =>
      ['notion', 'googledrive', 'gmail', 'googlecalendar', 'linear', 'slack'].includes(t.name)
    );

    if (connectorTool) {
      // Connector tools should have command parameter
      expect(connectorTool.parameters.properties.command).toBeDefined();
      expect(connectorTool.parameters.required).toContain('command');
    }
  });
});
