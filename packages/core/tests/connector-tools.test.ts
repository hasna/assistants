import { describe, expect, test, mock, beforeEach } from 'bun:test';
import type { Connector } from '@hasna/assistants-shared';
import {
  ConnectorBridge,
  connectorExecuteTool,
  createConnectorExecuteExecutor,
  connectorsSearchTool,
  createConnectorsSearchExecutor,
  connectorsListTool,
  createConnectorsListExecutor,
} from '../src/tools/connector';
import { ToolRegistry } from '../src/tools/registry';

// Mock connectors for testing
const mockConnectors: Connector[] = [
  {
    name: 'notion',
    cli: 'connect-notion',
    description: 'Notion workspace integration',
    commands: [
      { name: 'search', description: 'Search pages', args: [], options: [] },
      { name: 'list', description: 'List databases', args: [], options: [] },
      { name: 'create', description: 'Create a page', args: [], options: [] },
    ],
    auth: { type: 'oauth2' },
  },
  {
    name: 'gmail',
    cli: 'connect-gmail',
    description: 'Gmail email integration',
    commands: [
      { name: 'send', description: 'Send an email', args: [], options: [] },
      { name: 'list', description: 'List emails', args: [], options: [] },
      { name: 'search', description: 'Search emails', args: [], options: [] },
    ],
    auth: { type: 'oauth2' },
  },
  {
    name: 'googledrive',
    cli: 'connect-googledrive',
    description: 'Google Drive file storage',
    commands: [
      { name: 'upload', description: 'Upload a file', args: [], options: [] },
      { name: 'download', description: 'Download a file', args: [], options: [] },
      { name: 'list', description: 'List files', args: [], options: [] },
    ],
    auth: { type: 'oauth2' },
  },
  {
    name: 'slack',
    cli: 'connect-slack',
    description: 'Slack messaging',
    commands: [
      { name: 'post', description: 'Post a message', args: [], options: [] },
      { name: 'channels', description: 'List channels', args: [], options: [] },
    ],
    auth: { type: 'oauth2' },
  },
  {
    name: 'github',
    cli: 'connect-github',
    description: 'GitHub repository management',
    commands: [
      { name: 'repos', description: 'List repositories', args: [], options: [] },
      { name: 'issues', description: 'List issues', args: [], options: [] },
      { name: 'prs', description: 'List pull requests', args: [], options: [] },
    ],
    auth: { type: 'oauth2' },
  },
];

// Create a mock bridge that returns our mock connectors
function createMockBridge(): ConnectorBridge {
  const bridge = new ConnectorBridge();
  // Manually populate the connectors map
  const connectorsMap = (bridge as any).connectors as Map<string, Connector>;
  for (const connector of mockConnectors) {
    connectorsMap.set(connector.name, connector);
  }
  return bridge;
}

describe('connector_execute tool', () => {
  test('has correct tool definition', () => {
    expect(connectorExecuteTool.name).toBe('connector_execute');
    expect(connectorExecuteTool.parameters.required).toContain('connector');
    expect(connectorExecuteTool.parameters.required).toContain('command');
  });

  test('returns error when bridge is not available', async () => {
    const executor = createConnectorExecuteExecutor({
      getConnectorBridge: () => null,
    });

    const result = await executor({ connector: 'notion', command: 'search' });
    const parsed = JSON.parse(result);

    expect(parsed.error).toBe('Connector system not available');
  });

  test('returns error when connector is not found', async () => {
    const bridge = createMockBridge();
    const executor = createConnectorExecuteExecutor({
      getConnectorBridge: () => bridge,
    });

    const result = await executor({ connector: 'unknown', command: 'search' });
    const parsed = JSON.parse(result);

    expect(parsed.error).toContain('not found');
    expect(parsed.available).toBeDefined();
    expect(parsed.suggestion).toBeDefined();
  });

  test('returns error when connector parameter is missing', async () => {
    const bridge = createMockBridge();
    const executor = createConnectorExecuteExecutor({
      getConnectorBridge: () => bridge,
    });

    const result = await executor({ command: 'search' });
    const parsed = JSON.parse(result);

    expect(parsed.error).toContain('Missing required parameter');
  });
});

describe('connectors_search tool', () => {
  test('has correct tool definition', () => {
    expect(connectorsSearchTool.name).toBe('connectors_search');
    expect(connectorsSearchTool.parameters.required).toContain('query');
  });

  test('returns error when bridge is not available', async () => {
    const executor = createConnectorsSearchExecutor({
      getConnectorBridge: () => null,
    });

    const result = await executor({ query: 'email' });
    const parsed = JSON.parse(result);

    expect(parsed.error).toBe('Connector discovery not available');
  });

  test('returns error when query is empty', async () => {
    const bridge = createMockBridge();
    const executor = createConnectorsSearchExecutor({
      getConnectorBridge: () => bridge,
    });

    const result = await executor({ query: '' });
    const parsed = JSON.parse(result);

    expect(parsed.error).toContain('required');
  });

  test('finds connectors by name', async () => {
    const bridge = createMockBridge();
    const executor = createConnectorsSearchExecutor({
      getConnectorBridge: () => bridge,
    });

    const result = await executor({ query: 'gmail' });
    const parsed = JSON.parse(result);

    expect(parsed.count).toBeGreaterThan(0);
    expect(parsed.results[0].name).toBe('gmail');
  });

  test('finds connectors by description', async () => {
    const bridge = createMockBridge();
    const executor = createConnectorsSearchExecutor({
      getConnectorBridge: () => bridge,
    });

    const result = await executor({ query: 'email' });
    const parsed = JSON.parse(result);

    expect(parsed.count).toBeGreaterThan(0);
    expect(parsed.results.some((r: any) => r.name === 'gmail')).toBe(true);
  });

  test('finds connectors by command', async () => {
    const bridge = createMockBridge();
    const executor = createConnectorsSearchExecutor({
      getConnectorBridge: () => bridge,
    });

    const result = await executor({ query: 'upload' });
    const parsed = JSON.parse(result);

    expect(parsed.count).toBeGreaterThan(0);
    expect(parsed.results[0].name).toBe('googledrive');
    expect(parsed.results[0].matchedCommands).toContain('upload');
  });

  test('respects limit parameter', async () => {
    const bridge = createMockBridge();
    const executor = createConnectorsSearchExecutor({
      getConnectorBridge: () => bridge,
    });

    const result = await executor({ query: 'list', limit: 2 });
    const parsed = JSON.parse(result);

    expect(parsed.count).toBeLessThanOrEqual(2);
  });

  test('calls onConnectorSelected callback', async () => {
    const bridge = createMockBridge();
    const selectedConnectors: string[] = [];
    const executor = createConnectorsSearchExecutor({
      getConnectorBridge: () => bridge,
      onConnectorSelected: (name) => selectedConnectors.push(name),
    });

    await executor({ query: 'gmail' });

    expect(selectedConnectors).toContain('gmail');
  });
});

describe('connectors_list tool', () => {
  test('has correct tool definition', () => {
    expect(connectorsListTool.name).toBe('connectors_list');
    expect(connectorsListTool.parameters.properties.name).toBeDefined();
    expect(connectorsListTool.parameters.properties.verbose).toBeDefined();
    expect(connectorsListTool.parameters.properties.page).toBeDefined();
    expect(connectorsListTool.parameters.properties.limit).toBeDefined();
  });

  test('lists all connectors', async () => {
    const bridge = createMockBridge();
    const executor = createConnectorsListExecutor({
      getConnectorBridge: () => bridge,
    });

    const result = await executor({});
    const parsed = JSON.parse(result);

    expect(parsed.count).toBe(mockConnectors.length);
    expect(parsed.connectors.length).toBe(mockConnectors.length);
  });

  test('filters by name', async () => {
    const bridge = createMockBridge();
    const executor = createConnectorsListExecutor({
      getConnectorBridge: () => bridge,
    });

    const result = await executor({ name: 'notion' });
    const parsed = JSON.parse(result);

    expect(parsed.count).toBe(1);
    expect(parsed.connectors[0].name).toBe('notion');
  });

  test('returns commands as names in non-verbose mode', async () => {
    const bridge = createMockBridge();
    const executor = createConnectorsListExecutor({
      getConnectorBridge: () => bridge,
    });

    const result = await executor({ name: 'notion', verbose: false });
    const parsed = JSON.parse(result);

    expect(Array.isArray(parsed.connectors[0].commands)).toBe(true);
    expect(typeof parsed.connectors[0].commands[0]).toBe('string');
  });

  test('returns detailed commands in verbose mode', async () => {
    const bridge = createMockBridge();
    const executor = createConnectorsListExecutor({
      getConnectorBridge: () => bridge,
    });

    const result = await executor({ name: 'notion', verbose: true });
    const parsed = JSON.parse(result);

    expect(Array.isArray(parsed.connectors[0].commands)).toBe(true);
    expect(typeof parsed.connectors[0].commands[0]).toBe('object');
    expect(parsed.connectors[0].commands[0].name).toBeDefined();
    expect(parsed.connectors[0].commands[0].description).toBeDefined();
  });

  test('supports pagination', async () => {
    const bridge = createMockBridge();
    const executor = createConnectorsListExecutor({
      getConnectorBridge: () => bridge,
    });

    const result = await executor({ page: 1, limit: 2 });
    const parsed = JSON.parse(result);

    expect(parsed.count).toBe(2);
    expect(parsed.total).toBe(mockConnectors.length);
    expect(parsed.page).toBe(1);
    expect(parsed.limit).toBe(2);
    expect(parsed.totalPages).toBe(Math.ceil(mockConnectors.length / 2));
    expect(parsed.hasMore).toBe(true);
  });

  test('returns error for non-existent connector', async () => {
    const bridge = createMockBridge();
    const executor = createConnectorsListExecutor({
      getConnectorBridge: () => bridge,
    });

    const result = await executor({ name: 'nonexistent' });
    const parsed = JSON.parse(result);

    expect(parsed.error).toContain('not found');
    expect(parsed.available).toBeDefined();
  });
});

describe('ConnectorBridge.registerAll with config', () => {
  test('registers all connectors when no limit is set', () => {
    const bridge = createMockBridge();
    const registry = new ToolRegistry();

    const registered = bridge.registerAll(registry);

    expect(registered.size).toBe(mockConnectors.length);
  });

  test('respects maxToolsInContext limit', () => {
    const bridge = createMockBridge();
    const registry = new ToolRegistry();

    const registered = bridge.registerAll(registry, {
      maxToolsInContext: 2,
    });

    expect(registered.size).toBe(2);
  });

  test('always registers priority connectors', () => {
    const bridge = createMockBridge();
    const registry = new ToolRegistry();

    const registered = bridge.registerAll(registry, {
      maxToolsInContext: 2,
      priorityConnectors: ['slack', 'github'],
    });

    expect(registered.has('slack')).toBe(true);
    expect(registered.has('github')).toBe(true);
  });

  test('registers no individual tools when dynamicBinding is enabled without priority', () => {
    const bridge = createMockBridge();
    const registry = new ToolRegistry();

    const registered = bridge.registerAll(registry, {
      dynamicBinding: true,
    });

    expect(registered.size).toBe(0);
  });

  test('registers only priority connectors when dynamicBinding is enabled', () => {
    const bridge = createMockBridge();
    const registry = new ToolRegistry();

    const registered = bridge.registerAll(registry, {
      dynamicBinding: true,
      priorityConnectors: ['notion'],
    });

    expect(registered.size).toBe(1);
    expect(registered.has('notion')).toBe(true);
  });

  test('handles string array config (backwards compatibility)', () => {
    const bridge = createMockBridge();
    const registry = new ToolRegistry();

    // String array should be treated as enabled connectors list
    const registered = bridge.registerAll(registry, ['notion', 'gmail']);

    // With just enabled list, all discovered connectors are registered
    expect(registered.size).toBe(mockConnectors.length);
  });
});

describe('ConnectorBridge.registerConnector', () => {
  test('registers a single connector on demand', () => {
    const bridge = createMockBridge();
    const registry = new ToolRegistry();

    const success = bridge.registerConnector(registry, 'notion');

    expect(success).toBe(true);
    expect(registry.getTool('notion')).toBeDefined();
  });

  test('returns false for non-existent connector', () => {
    const bridge = createMockBridge();
    const registry = new ToolRegistry();

    const success = bridge.registerConnector(registry, 'nonexistent');

    expect(success).toBe(false);
  });
});

describe('ConnectorBridge cache management', () => {
  beforeEach(() => {
    // Clear cache before each test
    ConnectorBridge.clearCache();
  });

  test('clearCache clears the internal cache', () => {
    // Get initial stats
    const initialStats = ConnectorBridge.getCacheStats();

    // Create a bridge and manually populate cache
    const bridge = new ConnectorBridge();
    (bridge as any).connectors.set('test', mockConnectors[0]);

    // Populate static cache
    (ConnectorBridge as any).cache.set('test', mockConnectors[0]);

    // Clear the cache
    ConnectorBridge.clearCache();

    // Verify cache is cleared
    const stats = ConnectorBridge.getCacheStats();
    expect(stats.cacheSize).toBe(0);
    expect(stats.diskCacheLoaded).toBe(false);
  });

  test('getCacheStats returns cache information', () => {
    const stats = ConnectorBridge.getCacheStats();

    expect(typeof stats.cacheSize).toBe('number');
    expect(typeof stats.diskCacheLoaded).toBe('boolean');
    expect(typeof stats.cachePath).toBe('string');
    expect(stats.cachePath).toContain('connectors.json');
  });

  test('refresh clears cache and calls discover', async () => {
    const bridge = createMockBridge();

    // Manually add something to static cache
    (ConnectorBridge as any).cache.set('old-connector', { name: 'old' });

    // After refresh, the mock bridge won't have the old connector
    // (discover would be called but our mock doesn't run discover properly)
    const connectors = await bridge.refresh();

    // The cache should be cleared
    const stats = ConnectorBridge.getCacheStats();
    expect(stats.diskCacheLoaded).toBe(false);
    // Note: In a real scenario, connectors would come from discovery
    // Our mock doesn't simulate PATH scanning, so we just verify the method runs
    expect(Array.isArray(connectors)).toBe(true);
  });
});
