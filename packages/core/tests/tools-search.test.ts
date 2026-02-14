import { describe, expect, test, beforeEach } from 'bun:test';
import {
  ToolIndex,
  toolsSearchTool,
  createToolsSearchExecutor,
  type ToolMetadata,
} from '../src/tools/search';
import { ToolRegistry } from '../src/tools/registry';

// Sample tool metadata for testing
const sampleTools: ToolMetadata[] = [
  { name: 'bash', description: 'Execute shell commands', category: 'system', source: 'builtin', tags: ['execute'] },
  { name: 'read', description: 'Read file contents', category: 'filesystem', source: 'builtin', tags: ['read', 'file'] },
  { name: 'write', description: 'Write file contents', category: 'filesystem', source: 'builtin', tags: ['write', 'file', 'create'] },
  { name: 'glob', description: 'Find files by pattern', category: 'filesystem', source: 'builtin', tags: ['search', 'file'] },
  { name: 'grep', description: 'Search file contents', category: 'filesystem', source: 'builtin', tags: ['search', 'file'] },
  { name: 'memory_save', description: 'Save information to memory', category: 'memory', source: 'builtin', tags: ['create', 'memory'] },
  { name: 'memory_recall', description: 'Recall information from memory', category: 'memory', source: 'builtin', tags: ['read', 'memory'] },
  { name: 'memory_list', description: 'List all memories', category: 'memory', source: 'builtin', tags: ['list', 'memory'] },
  { name: 'notion', description: 'Notion workspace integration', category: 'connectors', source: 'connector' },
  { name: 'gmail', description: 'Gmail email integration', category: 'connectors', source: 'connector', tags: ['email'] },
  { name: 'web_fetch', description: 'Fetch content from URL', category: 'web', source: 'builtin', tags: ['read', 'http'] },
  { name: 'assistant_spawn', description: 'Spawn a subassistant', category: 'assistants', source: 'builtin', tags: ['create'] },
];

describe('ToolIndex', () => {
  let index: ToolIndex;

  beforeEach(() => {
    index = new ToolIndex();
    for (const tool of sampleTools) {
      index.add(tool);
    }
  });

  describe('add and size', () => {
    test('adds tools correctly', () => {
      expect(index.size()).toBe(sampleTools.length);
    });

    test('removes tools correctly', () => {
      index.remove('bash');
      expect(index.size()).toBe(sampleTools.length - 1);
    });
  });

  describe('getCategories', () => {
    test('returns all unique categories', () => {
      const categories = index.getCategories();
      expect(categories).toContain('system');
      expect(categories).toContain('filesystem');
      expect(categories).toContain('memory');
      expect(categories).toContain('connectors');
      expect(categories).toContain('web');
      expect(categories).toContain('assistants');
    });

    test('returns sorted categories', () => {
      const categories = index.getCategories();
      const sorted = [...categories].sort();
      expect(categories).toEqual(sorted);
    });
  });

  describe('getTags', () => {
    test('returns all unique tags', () => {
      const tags = index.getTags();
      expect(tags).toContain('read');
      expect(tags).toContain('write');
      expect(tags).toContain('search');
      expect(tags).toContain('file');
    });
  });

  describe('search', () => {
    test('returns all tools when no filters', () => {
      const { tools, total } = index.search({});
      expect(total).toBe(sampleTools.length);
      expect(tools.length).toBe(sampleTools.length);
    });

    test('filters by category', () => {
      const { tools, total } = index.search({ category: 'filesystem' });
      expect(total).toBe(4); // read, write, glob, grep
      expect(tools.every(t => t.category === 'filesystem')).toBe(true);
    });

    test('filters by tags', () => {
      const { tools, total } = index.search({ tags: ['file'] });
      expect(total).toBe(4); // read, write, glob, grep
      expect(tools.every(t => t.tags?.includes('file'))).toBe(true);
    });

    test('filters by multiple tags (intersection)', () => {
      const { tools, total } = index.search({ tags: ['file', 'search'] });
      expect(total).toBe(2); // glob, grep
    });

    test('filters by source', () => {
      const { tools, total } = index.search({ source: 'connector' });
      expect(total).toBe(2); // notion, gmail
      expect(tools.every(t => t.source === 'connector')).toBe(true);
    });

    test('searches by query in name', () => {
      const { tools } = index.search({ query: 'memory' });
      expect(tools.length).toBeGreaterThan(0);
      expect(tools[0].name).toContain('memory');
    });

    test('searches by query in description', () => {
      const { tools } = index.search({ query: 'email' });
      expect(tools.length).toBeGreaterThan(0);
      expect(tools.some(t => t.name === 'gmail')).toBe(true);
    });

    test('exact name match scores higher', () => {
      const { tools } = index.search({ query: 'bash' });
      expect(tools[0].name).toBe('bash');
    });

    test('respects limit', () => {
      const { tools, total } = index.search({ limit: 3 });
      expect(tools.length).toBe(3);
      expect(total).toBe(sampleTools.length);
    });

    test('respects offset', () => {
      const all = index.search({});
      const paged = index.search({ offset: 2, limit: 3 });
      expect(paged.tools[0].name).toBe(all.tools[2].name);
    });

    test('combines category and query', () => {
      const { tools } = index.search({ query: 'search', category: 'filesystem' });
      expect(tools.length).toBeGreaterThan(0);
      expect(tools.every(t => t.category === 'filesystem')).toBe(true);
    });
  });

  describe('clear', () => {
    test('removes all tools', () => {
      index.clear();
      expect(index.size()).toBe(0);
      expect(index.getCategories()).toEqual([]);
      expect(index.getTags()).toEqual([]);
    });
  });
});

describe('ToolIndex.fromRegistry', () => {
  test('builds index from registry', () => {
    const registry = new ToolRegistry();
    registry.register(
      { name: 'test_tool', description: 'A test tool', parameters: { type: 'object', properties: {} } },
      async () => 'result'
    );
    registry.register(
      { name: 'memory_test', description: 'Memory test', parameters: { type: 'object', properties: {} } },
      async () => 'result'
    );

    const index = ToolIndex.fromRegistry(registry);
    expect(index.size()).toBe(2);
  });

  test('uses custom categorizer', () => {
    const registry = new ToolRegistry();
    registry.register(
      { name: 'custom_tool', description: 'Custom tool', parameters: { type: 'object', properties: {} } },
      async () => 'result'
    );

    const index = ToolIndex.fromRegistry(registry, (tool) => ({
      name: tool.name,
      description: tool.description,
      category: 'custom',
      source: 'custom' as const,
      tags: ['custom-tag'],
    }));

    const { tools } = index.search({ category: 'custom' });
    expect(tools.length).toBe(1);
    expect(tools[0].tags).toContain('custom-tag');
  });
});

describe('tools_search tool', () => {
  let index: ToolIndex;

  beforeEach(() => {
    index = new ToolIndex();
    for (const tool of sampleTools) {
      index.add(tool);
    }
  });

  test('has correct tool definition', () => {
    expect(toolsSearchTool.name).toBe('tools_search');
    expect(toolsSearchTool.parameters.properties.query).toBeDefined();
    expect(toolsSearchTool.parameters.properties.category).toBeDefined();
    expect(toolsSearchTool.parameters.properties.tags).toBeDefined();
    expect(toolsSearchTool.parameters.properties.source).toBeDefined();
    expect(toolsSearchTool.parameters.properties.limit).toBeDefined();
  });

  test('returns error when index not available', async () => {
    const executor = createToolsSearchExecutor({
      getToolIndex: () => null,
    });

    const result = await executor({});
    const parsed = JSON.parse(result);

    expect(parsed.error).toBe('Tool index not available');
  });

  test('returns all tools when no filters', async () => {
    const executor = createToolsSearchExecutor({
      getToolIndex: () => index,
    });

    const result = await executor({});
    const parsed = JSON.parse(result);

    expect(parsed.total).toBe(sampleTools.length);
    expect(parsed.count).toBeLessThanOrEqual(10); // default limit
  });

  test('searches by query', async () => {
    const executor = createToolsSearchExecutor({
      getToolIndex: () => index,
    });

    const result = await executor({ query: 'file' });
    const parsed = JSON.parse(result);

    expect(parsed.count).toBeGreaterThan(0);
    expect(parsed.query).toBe('file');
  });

  test('filters by category', async () => {
    const executor = createToolsSearchExecutor({
      getToolIndex: () => index,
    });

    const result = await executor({ category: 'memory' });
    const parsed = JSON.parse(result);

    expect(parsed.count).toBe(3);
    expect(parsed.tools.every((t: any) => t.category === 'memory')).toBe(true);
  });

  test('filters by tags', async () => {
    const executor = createToolsSearchExecutor({
      getToolIndex: () => index,
    });

    const result = await executor({ tags: ['search'] });
    const parsed = JSON.parse(result);

    expect(parsed.count).toBeGreaterThan(0);
    expect(parsed.filters.tags).toEqual(['search']);
  });

  test('filters by source', async () => {
    const executor = createToolsSearchExecutor({
      getToolIndex: () => index,
    });

    const result = await executor({ source: 'connector' });
    const parsed = JSON.parse(result);

    expect(parsed.count).toBe(2);
    expect(parsed.tools.every((t: any) => t.source === 'connector')).toBe(true);
  });

  test('respects limit', async () => {
    const executor = createToolsSearchExecutor({
      getToolIndex: () => index,
    });

    const result = await executor({ limit: 3 });
    const parsed = JSON.parse(result);

    expect(parsed.count).toBe(3);
    expect(parsed.hasMore).toBe(true);
  });

  test('returns available categories', async () => {
    const executor = createToolsSearchExecutor({
      getToolIndex: () => index,
    });

    const result = await executor({});
    const parsed = JSON.parse(result);

    expect(parsed.availableCategories).toContain('memory');
    expect(parsed.availableCategories).toContain('filesystem');
  });

  test('provides suggestion when no results', async () => {
    const executor = createToolsSearchExecutor({
      getToolIndex: () => index,
    });

    const result = await executor({ query: 'nonexistent_tool_xyz' });
    const parsed = JSON.parse(result);

    expect(parsed.count).toBe(0);
    expect(parsed.suggestion).toBeDefined();
    expect(parsed.suggestion).toContain('No tools found');
  });

  test('builds index from registry if available', async () => {
    const registry = new ToolRegistry();
    registry.register(
      { name: 'dynamic_tool', description: 'Dynamic tool', parameters: { type: 'object', properties: {} } },
      async () => 'result'
    );

    const executor = createToolsSearchExecutor({
      getToolIndex: () => null,
      getToolRegistry: () => registry,
    });

    const result = await executor({ query: 'dynamic' });
    const parsed = JSON.parse(result);

    expect(parsed.count).toBe(1);
    expect(parsed.tools[0].name).toBe('dynamic_tool');
  });
});
