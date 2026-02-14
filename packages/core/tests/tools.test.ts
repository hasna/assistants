import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { BashTool } from '../src/tools/bash';
import { FilesystemTools } from '../src/tools/filesystem';
import { WebFetchTool, WebSearchTool, CurlTool, WebTools, setDnsLookupForTests } from '../src/tools/web';
import { FeedbackTool } from '../src/tools/feedback';
import { ImageDisplayTool, ImageTools } from '../src/tools/image';
import { ToolRegistry } from '../src/tools/registry';
import { ConnectorBridge } from '../src/tools/connector';
import { mkdtemp, rm, writeFile, mkdir, chmod, readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

let tempDir: string;
let originalAssistantsDir: string | undefined;

beforeEach(async () => {
  originalAssistantsDir = process.env.ASSISTANTS_DIR;
  tempDir = await mkdtemp(join(tmpdir(), 'assistants-tools-'));
  process.env.ASSISTANTS_DIR = tempDir;
  FilesystemTools.setSessionId('test');
});

afterEach(async () => {
  process.env.ASSISTANTS_DIR = originalAssistantsDir;
  await rm(tempDir, { recursive: true, force: true });
});

describe('BashTool', () => {
  test('can instantiate tool class for coverage', () => {
    expect(new BashTool()).toBeInstanceOf(BashTool);
  });

  test('should allow safe commands', async () => {
    const output = await BashTool.executor({ command: 'echo hello' });
    expect(output).toBe('hello');
  });

  test('should respect cwd when provided', async () => {
    const filePath = join(tempDir, 'cwd-check.txt');
    await writeFile(filePath, 'ok');
    const output = await BashTool.executor({ command: 'ls', cwd: tempDir });
    expect(output).toContain('cwd-check.txt');
  });

  test('should block unsafe commands', async () => {
    await expect(BashTool.executor({ command: 'rm -rf /' })).rejects.toThrow('Blocked command');
  });

  test('should reject commands not in allowlist', async () => {
    await expect(BashTool.executor({ command: 'uname -a' })).rejects.toThrow('not in allowed list');
  });

  test('should block shell chaining operators', async () => {
    await expect(BashTool.executor({ command: 'ls; uname -a' })).rejects.toThrow('not allowed');
  });

  test('should block newline command separators', async () => {
    await expect(BashTool.executor({ command: 'ls\nuname -a' })).rejects.toThrow('not allowed');
  });

  test('should block git remote modifications', async () => {
    await expect(BashTool.executor({ command: 'git remote add origin https://example.com/repo.git' }))
      .rejects.toThrow('not allowed');
  });

  test('should block git branch deletions', async () => {
    await expect(BashTool.executor({ command: 'git branch -D feature' })).rejects.toThrow('not allowed');
  });

  test('should block git tag deletions', async () => {
    await expect(BashTool.executor({ command: 'git tag -d v1.0.0' })).rejects.toThrow('not allowed');
  });

  test('should report when command produces no output', async () => {
    const output = await BashTool.executor({ command: 'echo -n' });
    expect(output).toContain('Command completed successfully');
  });

  test('should report non-zero exit codes', async () => {
    await expect(BashTool.executor({ command: 'ls /nonexistent' })).rejects.toThrow('Exit code');
  });

  test('should kill commands that exceed timeout', async () => {
    const originalSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = ((fn: (...args: any[]) => void, _ms?: number, ...args: any[]) => {
      fn(...args);
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout;

    try {
      await expect(BashTool.executor({ command: 'tail -f /dev/null', timeout: 10 }))
        .rejects.toThrow('Exit code');
    } finally {
      globalThis.setTimeout = originalSetTimeout;
    }
  });
});

describe('FilesystemTools', () => {
  test('can instantiate tool class for coverage', () => {
    expect(new FilesystemTools()).toBeInstanceOf(FilesystemTools);
  });

  test('should write and read within scripts folder', async () => {
    const writeResult = await FilesystemTools.writeExecutor({ filename: 'test.txt', content: 'hello', cwd: tempDir });
    expect(writeResult).toContain('Successfully wrote');

    const readResult = await FilesystemTools.readExecutor({
      path: join(tempDir, '.assistants-data', 'scripts', 'test', 'test.txt'),
      cwd: tempDir,
    });
    expect(readResult).toContain('hello');
  });

  test('should return error when reading missing file', async () => {
    await expect(FilesystemTools.readExecutor({ path: 'missing.txt', cwd: tempDir }))
      .rejects.toThrow('File not found');
  });

  test('should reject empty filenames', async () => {
    await expect(FilesystemTools.writeExecutor({ filename: '   ', content: 'hello', cwd: tempDir }))
      .rejects.toThrow('Filename is required');
  });

  test('should sanitize filenames to stay within scripts folder', async () => {
    const writeResult = await FilesystemTools.writeExecutor({ filename: '../outside.txt', content: 'safe', cwd: tempDir });
    expect(writeResult).toContain('Successfully wrote');
    expect(writeResult).toContain('outside.txt');
  });

  test('should glob and grep files', async () => {
    await FilesystemTools.writeExecutor({ filename: 'notes.txt', content: 'alpha\nbeta', cwd: tempDir });

    const globResult = await FilesystemTools.globExecutor({
      pattern: '**/*.txt',
      path: join(tempDir, '.assistants-data', 'scripts'),
      cwd: tempDir,
    });
    expect(globResult).toContain('notes.txt');

    const grepResult = await FilesystemTools.grepExecutor({
      pattern: 'beta',
      path: join(tempDir, '.assistants-data', 'scripts'),
      cwd: tempDir,
    });
    expect(grepResult).toContain('beta');
  });

  test('should handle glob and grep misses', async () => {
    await mkdir(join(tempDir, '.assistants-data', 'scripts'), { recursive: true });
    const globResult = await FilesystemTools.globExecutor({
      pattern: '**/*.nope',
      path: join(tempDir, '.assistants-data', 'scripts'),
      cwd: tempDir,
    });
    expect(globResult).toContain('No files found');

    const grepResult = await FilesystemTools.grepExecutor({
      pattern: 'nope',
      path: join(tempDir, '.assistants-data', 'scripts'),
      cwd: tempDir,
    });
    expect(grepResult).toContain('No matches found');
  });

  test('should resolve relative paths against cwd', async () => {
    const localDir = join(tempDir, 'project');
    await mkdir(localDir, { recursive: true });
    await writeFile(join(localDir, 'cwd.txt'), 'from cwd');

    const readResult = await FilesystemTools.readExecutor({ path: 'cwd.txt', cwd: localDir });
    expect(readResult).toContain('from cwd');

    const globResult = await FilesystemTools.globExecutor({ pattern: '**/*.txt', cwd: localDir });
    expect(globResult).toContain('cwd.txt');

    const grepResult = await FilesystemTools.grepExecutor({ pattern: 'cwd', cwd: localDir });
    expect(grepResult).toContain('cwd.txt');
  });

  test('registerAll should register filesystem tools', () => {
    const registry = new ToolRegistry();
    FilesystemTools.registerAll(registry, 'session-123');
    const names = registry.getTools().map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining(['read', 'write', 'glob', 'grep']));
  });
});

describe('Web tools', () => {
  test('can instantiate web tool classes for coverage', () => {
    expect(new WebFetchTool()).toBeInstanceOf(WebFetchTool);
    expect(new WebSearchTool()).toBeInstanceOf(WebSearchTool);
    expect(new CurlTool()).toBeInstanceOf(CurlTool);
    expect(new WebTools()).toBeInstanceOf(WebTools);
  });

  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    setDnsLookupForTests(async () => [{ address: '93.184.216.34', family: 4 }]);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    setDnsLookupForTests();
  });

  test('WebFetchTool should block localhost', async () => {
    await expect(WebFetchTool.executor({ url: 'http://localhost' })).rejects.toThrow('Cannot fetch');
  });

  test('WebFetchTool should block localhost with trailing dot', async () => {
    await expect(WebFetchTool.executor({ url: 'http://localhost.' })).rejects.toThrow('Cannot fetch');
  });

  test('WebFetchTool should block localhost subdomains', async () => {
    await expect(WebFetchTool.executor({ url: 'http://foo.localhost' })).rejects.toThrow('Cannot fetch');
  });

  test('WebFetchTool should block .local domains', async () => {
    await expect(WebFetchTool.executor({ url: 'http://printer.local' })).rejects.toThrow('Cannot fetch');
  });

  test('WebFetchTool should block hostnames resolving to private IPs', async () => {
    setDnsLookupForTests(async () => [{ address: '127.0.0.1', family: 4 }]);
    await expect(WebFetchTool.executor({ url: 'http://example.test' })).rejects.toThrow('Cannot fetch');
  });

  test('WebFetchTool should allow hostnames resolving to public IPs', async () => {
    setDnsLookupForTests(async () => [{ address: '93.184.216.34', family: 4 }]);
    globalThis.fetch = async () =>
      new Response('<html><body>ok</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    const result = await WebFetchTool.executor({ url: 'http://example.test' });
    expect(result).toContain('ok');
  });

  test('WebFetchTool should block private 172.16.x.x addresses', async () => {
    await expect(WebFetchTool.executor({ url: 'http://172.16.0.1' })).rejects.toThrow('Cannot fetch');
  });

  test('WebFetchTool should block 0.0.0.0/8 addresses', async () => {
    await expect(WebFetchTool.executor({ url: 'http://0.0.0.0' })).rejects.toThrow('Cannot fetch');
  });

  test('WebFetchTool should block carrier-grade NAT addresses', async () => {
    await expect(WebFetchTool.executor({ url: 'http://100.64.0.1' })).rejects.toThrow('Cannot fetch');
  });

  test('WebFetchTool should block link-local addresses', async () => {
    await expect(WebFetchTool.executor({ url: 'http://169.254.1.1' })).rejects.toThrow('Cannot fetch');
  });

  test('WebFetchTool should block IPv6 loopback', async () => {
    await expect(WebFetchTool.executor({ url: 'http://[::1]' })).rejects.toThrow('Cannot fetch');
  });

  test('WebFetchTool should block IPv6 unique local addresses', async () => {
    await expect(WebFetchTool.executor({ url: 'http://[fd00::1]' })).rejects.toThrow('Cannot fetch');
  });

  test('WebFetchTool should block IPv6 link-local addresses', async () => {
    await expect(WebFetchTool.executor({ url: 'http://[fe80::1]' })).rejects.toThrow('Cannot fetch');
  });

  test('WebFetchTool should block multicast addresses', async () => {
    await expect(WebFetchTool.executor({ url: 'http://224.0.0.1' })).rejects.toThrow('Cannot fetch');
  });

  test('WebFetchTool should block reserved addresses', async () => {
    await expect(WebFetchTool.executor({ url: 'http://240.0.0.1' })).rejects.toThrow('Cannot fetch');
  });

  test('WebFetchTool should block IPv4-mapped IPv6 loopback', async () => {
    await expect(WebFetchTool.executor({ url: 'http://[::ffff:127.0.0.1]' })).rejects.toThrow('Cannot fetch');
  });

  test('WebFetchTool should block IPv4-mapped IPv6 loopback (hex form)', async () => {
    await expect(WebFetchTool.executor({ url: 'http://[::ffff:7f00:0001]' })).rejects.toThrow('Cannot fetch');
  });

  test('WebFetchTool should reject non-http protocols', async () => {
    await expect(WebFetchTool.executor({ url: 'file:///etc/passwd' })).rejects.toThrow('Only http/https');
  });

  test('WebFetchTool should allow public 172.x.x.x addresses', async () => {
    globalThis.fetch = async () =>
      new Response('<html><body>ok</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });

    const result = await WebFetchTool.executor({ url: 'http://172.32.0.1' });
    expect(result).toContain('ok');
  });

  test('WebFetchTool should extract text from HTML', async () => {
    globalThis.fetch = async () =>
      new Response('<html><body><h1>Hello</h1><p>World</p></body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });

    const result = await WebFetchTool.executor({ url: 'https://example.com' });
    expect(result).toContain('Hello');
    expect(result).toContain('World');
  });

  test('WebFetchTool should return raw HTML when requested', async () => {
    globalThis.fetch = async () =>
      new Response('<html><body><h1>Raw</h1></body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });

    const result = await WebFetchTool.executor({ url: 'https://example.com', extract_type: 'html' });
    expect(result).toContain('<h1>Raw</h1>');
  });

  test('WebFetchTool should return JSON error for invalid JSON', async () => {
    globalThis.fetch = async () =>
      new Response('not-json', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });

    await expect(WebFetchTool.executor({ url: 'https://example.com', extract_type: 'json' }))
      .rejects.toThrow('not valid JSON');
  });

  test('WebFetchTool should timeout on slow response', async () => {
    globalThis.fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        if (init?.signal) {
          init.signal.addEventListener('abort', () => {
            const err = new Error('aborted');
            (err as any).name = 'AbortError';
            reject(err);
          });
        }
      });

    await expect(WebFetchTool.executor({ url: 'https://example.com', timeout: 5 }))
      .rejects.toThrow('timed out');
  });

  test('WebFetchTool should block redirects to private hosts', async () => {
    let callCount = 0;
    globalThis.fetch = async (input) => {
      callCount += 1;
      if (callCount === 1) {
        return new Response('', {
          status: 302,
          headers: { location: 'http://localhost' },
        });
      }
      return new Response('<html><body>ok</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    };

    await expect(WebFetchTool.executor({ url: 'https://example.com' })).rejects.toThrow('Cannot fetch');
  });

  test('WebFetchTool should error on excessive redirects', async () => {
    globalThis.fetch = async () =>
      new Response('', {
        status: 302,
        headers: { location: 'https://example.com/loop' },
      });

    await expect(WebFetchTool.executor({ url: 'https://example.com' })).rejects.toThrow('Too many redirects');
  });

  test('WebFetchTool should respect immediate timeout', async () => {
    const originalSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = ((fn: (...args: any[]) => void, _ms?: number, ...args: any[]) => {
      fn(...args);
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout;

    globalThis.fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        if (init?.signal) {
          if (init.signal.aborted) {
            const err = new Error('aborted');
            (err as any).name = 'AbortError';
            reject(err);
            return;
          }
          init.signal.addEventListener('abort', () => {
            const err = new Error('aborted');
            (err as any).name = 'AbortError';
            reject(err);
          });
        }
      });

    try {
      await expect(WebFetchTool.executor({ url: 'https://example.com', timeout: 5 }))
        .rejects.toThrow('timed out');
    } finally {
      globalThis.setTimeout = originalSetTimeout;
    }
  });

  test('WebSearchTool should parse results', async () => {
    const html = `
      <a class="result__a" href="/l/?uddg=https%3A%2F%2Fexample.com">Example</a>
      <a class="result__snippet">Snippet</a>
    `;

    globalThis.fetch = async () =>
      new Response(html, { status: 200, headers: { 'content-type': 'text/html' } });

    const result = await WebSearchTool.executor({ query: 'example' });
    expect(result).toContain('Example');
    expect(result).toContain('https://example.com');
  });

  test('WebSearchTool should use fallback parser when needed', async () => {
    const html = `
      <a class="result__snippet">Snippet</a>
      <a href="https://fallback.test" class="result__title result__a">Fallback</a>
    `;

    globalThis.fetch = async () =>
      new Response(html, { status: 200, headers: { 'content-type': 'text/html' } });

    const result = await WebSearchTool.executor({ query: 'fallback' });
    expect(result).toContain('Fallback');
    expect(result).toContain('https://fallback.test');
  });

  test('WebSearchTool should tolerate invalid encoded URLs', async () => {
    const html = `
      <a class="result__a" href="/l/?uddg=https%3A%2F%2Fexample.com%2F%ZZ">Bad URL</a>
      <a class="result__snippet">Snippet</a>
    `;

    globalThis.fetch = async () =>
      new Response(html, { status: 200, headers: { 'content-type': 'text/html' } });

    const result = await WebSearchTool.executor({ query: 'bad' });
    expect(result).toContain('Bad URL');
    expect(result).toContain('https%3A%2F%2Fexample.com');
  });

  test('CurlTool should return JSON', async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });

    const result = await CurlTool.executor({ url: 'https://api.test', method: 'GET' });
    expect(result).toContain('HTTP 200');
    expect(result).toContain('"ok": true');
  });

  test('CurlTool should block localhost', async () => {
    await expect(CurlTool.executor({ url: 'http://localhost', method: 'GET' })).rejects.toThrow('Cannot fetch');
  });

  test('CurlTool should block localhost with trailing dot', async () => {
    await expect(CurlTool.executor({ url: 'http://localhost.', method: 'GET' })).rejects.toThrow('Cannot fetch');
  });

  test('CurlTool should block localhost subdomains', async () => {
    await expect(CurlTool.executor({ url: 'http://foo.localhost', method: 'GET' })).rejects.toThrow('Cannot fetch');
  });

  test('CurlTool should block .local domains', async () => {
    await expect(CurlTool.executor({ url: 'http://printer.local', method: 'GET' })).rejects.toThrow('Cannot fetch');
  });

  test('CurlTool should block hostnames resolving to private IPs', async () => {
    setDnsLookupForTests(async () => [{ address: '10.0.0.1', family: 4 }]);
    await expect(CurlTool.executor({ url: 'http://example.test', method: 'GET' })).rejects.toThrow('Cannot fetch');
  });

  test('CurlTool should block IPv6 loopback', async () => {
    await expect(CurlTool.executor({ url: 'http://[::1]', method: 'GET' })).rejects.toThrow('Cannot fetch');
  });

  test('CurlTool should block IPv4-mapped IPv6 loopback', async () => {
    await expect(CurlTool.executor({ url: 'http://[::ffff:127.0.0.1]', method: 'GET' }))
      .rejects.toThrow('Cannot fetch');
  });

  test('CurlTool should block IPv6 link-local addresses', async () => {
    await expect(CurlTool.executor({ url: 'http://[fe80::1]', method: 'GET' })).rejects.toThrow('Cannot fetch');
  });

  test('CurlTool should block multicast addresses', async () => {
    await expect(CurlTool.executor({ url: 'http://224.0.0.1', method: 'GET' })).rejects.toThrow('Cannot fetch');
  });

  test('CurlTool should block reserved addresses', async () => {
    await expect(CurlTool.executor({ url: 'http://240.0.0.1', method: 'GET' })).rejects.toThrow('Cannot fetch');
  });

  test('CurlTool should reject non-http protocols', async () => {
    await expect(CurlTool.executor({ url: 'ftp://example.com', method: 'GET' })).rejects.toThrow('Only http/https');
  });

  test('CurlTool should reject redirects for non-GET methods', async () => {
    globalThis.fetch = async () =>
      new Response('', {
        status: 302,
        headers: { location: 'https://example.com/redirect' },
      });

    await expect(CurlTool.executor({ url: 'https://example.com', method: 'POST', body: 'x' }))
      .rejects.toThrow('Redirects are only supported');
  });

  test('CurlTool should timeout on slow response', async () => {
    const originalSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = ((fn: (...args: any[]) => void, _ms?: number, ...args: any[]) => {
      fn(...args);
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout;

    globalThis.fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        if (init?.signal) {
          if (init.signal.aborted) {
            const err = new Error('aborted');
            (err as any).name = 'AbortError';
            reject(err);
            return;
          }
          init.signal.addEventListener('abort', () => {
            const err = new Error('aborted');
            (err as any).name = 'AbortError';
            reject(err);
          });
        }
      });

    try {
      await expect(CurlTool.executor({ url: 'https://example.com', method: 'GET' }))
        .rejects.toThrow('timed out');
    } finally {
      globalThis.setTimeout = originalSetTimeout;
    }
  });

  test('WebTools registerAll should register tools', () => {
    const names: string[] = [];
    WebTools.registerAll({
      register: (tool) => {
        names.push(tool.name);
      },
    });
    expect(names).toContain('web_fetch');
    expect(names).toContain('web_search');
    expect(names).toContain('curl');
  });
});

describe('ImageDisplayTool', () => {
  test('can instantiate image tool classes for coverage', () => {
    expect(new ImageDisplayTool()).toBeInstanceOf(ImageDisplayTool);
    expect(new ImageTools()).toBeInstanceOf(ImageTools);
  });

  test('should report missing file', async () => {
    const result = await ImageDisplayTool.executor({ path: 'missing.png' });
    expect(result).toContain('Image file not found');
  });

  test('should return structured JSON for local image', async () => {
    const binDir = await mkdtemp(join(tmpdir(), 'assistants-img-'));
    const imagePath = join(binDir, 'image.png');
    const pngData = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/xcAAgMBAJ+lWQ0AAAAASUVORK5CYII=',
      'base64'
    );
    await writeFile(imagePath, pngData);

    try {
      const result = await ImageDisplayTool.executor({ path: imagePath });
      const data = JSON.parse(result);
      expect(data.displayed).toBe(true);
      expect(data.path).toBe(imagePath);
      expect(data.alt).toBe('image.png');
    } finally {
      await rm(binDir, { recursive: true, force: true });
    }
  });

  test('should return structured JSON for URL image', async () => {
    const pngData = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/xcAAgMBAJ+lWQ0AAAAASUVORK5CYII=',
      'base64'
    );

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(pngData, {
        status: 200,
        headers: { 'content-type': 'image/png' },
      });

    try {
      const result = await ImageDisplayTool.executor({ path: 'https://example.com/image.png' });
      const data = JSON.parse(result);
      expect(data.displayed).toBe(true);
      expect(data.path).toContain('assistants-image-');
      expect(data.alt).toBe('image.png');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('should reject non-image URL content types', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response('not an image', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      });

    try {
      const result = await ImageDisplayTool.executor({ path: 'https://example.com/not-image' });
      expect(result).toContain('does not point to an image');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('ImageTools', () => {
  test('registerAll should register image tools', () => {
    const names: string[] = [];
    ImageTools.registerAll({
      register: (tool) => {
        names.push(tool.name);
      },
    });
    expect(names).toContain('display_image');
  });
});

describe('ConnectorBridge', () => {
  test('should register connector tools and execute', async () => {
    const bridge = new ConnectorBridge();
    const registry = new ToolRegistry();

    // Inject a fake connector using echo
    (bridge as any).connectors.set('echo', {
      name: 'echo',
      cli: 'echo',
      description: 'Echo connector',
      commands: [{ name: 'hello', description: 'Say hello', args: [], options: [] }],
      auth: { type: 'none' },
    });

    bridge.registerAll(registry);

    const result = await registry.execute({ id: '1', name: 'echo', input: { command: 'hello' } });
    expect(result.content).toContain('hello');
  });
});

describe('ToolRegistry', () => {
  test('should execute multiple tool calls', async () => {
    const registry = new ToolRegistry();
    registry.register(
      { name: 'one', description: 'one', parameters: { type: 'object', properties: {} } },
      async () => 'first'
    );
    registry.register(
      { name: 'two', description: 'two', parameters: { type: 'object', properties: {} } },
      async () => 'second'
    );

    const results = await registry.executeAll([
      { id: '1', name: 'one', input: {} },
      { id: '2', name: 'two', input: {} },
    ]);

    expect(results.map((r) => r.content)).toEqual(['first', 'second']);
  });

  test('should unregister tools', () => {
    const registry = new ToolRegistry();
    registry.register(
      { name: 'temp', description: 'temp', parameters: { type: 'object', properties: {} } },
      async () => 'ok'
    );

    expect(registry.hasTool('temp')).toBe(true);
    registry.unregister('temp');
    expect(registry.hasTool('temp')).toBe(false);
  });
});

describe('FeedbackTool', () => {
  test('should save feedback locally', async () => {
    const result = await FeedbackTool.executor({
      type: 'feedback',
      title: 'Test feedback',
      description: 'Something went wrong',
      cwd: tempDir,
    });

    expect(result).toContain('Feedback saved locally');

    const feedbackDir = join(tempDir, '.assistants-data', 'feedback');
    const files = await readdir(feedbackDir);
    expect(files.length).toBe(1);

    const data = JSON.parse(await readFile(join(feedbackDir, files[0]), 'utf8'));
    expect(data.title).toBe('Test feedback');
    expect(data.description).toBe('Something went wrong');
    expect(data.type).toBe('feedback');
  });
});
