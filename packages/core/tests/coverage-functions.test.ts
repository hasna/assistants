import { describe, expect, test } from 'bun:test';
import { __test__ as bashTest } from '../src/tools/bash';
import { __test__ as hookTest } from '../src/hooks/executor';
import { __test__ as connectorTest } from '../src/tools/connector';
import { __test__ as builtinTest } from '../src/commands/builtin';
import { __test__ as fsTest } from '../src/tools/filesystem';
import { __test__ as imageTest } from '../src/tools/image';
import { __test__ as webTest, setDnsLookupForTests } from '../src/tools/web';
import { getRuntime } from '../src/runtime';


describe('Function coverage helpers', () => {
  test('bash killProcess triggers proc.kill', () => {
    let called = false;
    bashTest.killProcess({ kill: () => { called = true; } });
    expect(called).toBe(true);
  });

  test('hook killSpawnedProcess triggers proc.kill', () => {
    let called = false;
    hookTest.killSpawnedProcess({ kill: () => { called = true; } });
    expect(called).toBe(true);
  });

  test('connector resolveTimeout resolves with exitCode 1', async () => {
    let resolved: { exitCode: number } | null = null;
    const p = new Promise<{ exitCode: number }>((resolve) => {
      connectorTest.resolveTimeout((value) => {
        resolved = value;
        resolve(value);
      });
    });
    const result = await p;
    expect(result.exitCode).toBe(1);
    expect(resolved?.exitCode).toBe(1);
  });

  test('builtin resolveAuthTimeout resolves with default stdout', async () => {
    const result = await new Promise<{ exitCode: number; stdout: { toString: () => string } }>((resolve) => {
      builtinTest.resolveAuthTimeout(resolve);
    });
    expect(result.exitCode).toBe(1);
    expect(result.stdout.toString()).toBe('{}');
  });

  test('filesystem helpers compute scripts folder and containment', () => {
    const cwd = process.cwd();
    const scriptsFolder = fsTest.getScriptsFolder(cwd, 'session-1');
    expect(scriptsFolder).toMatch(/\.assistants-data/);
    expect(scriptsFolder).toContain('scripts');
    expect(fsTest.isInScriptsFolder(scriptsFolder, cwd, 'session-1')).toBe(true);
    expect(fsTest.isInScriptsFolder(scriptsFolder + '/file.txt', cwd, 'session-1')).toBe(true);
    expect(fsTest.isInScriptsFolder('/tmp/not-assistants', cwd, 'session-1')).toBe(false);
  });

  test('image tool module exports exist', () => {
    // image.ts no longer exports test helpers (viu removed in favour of ink-picture)
    expect(imageTest).toBeDefined();
  });

  test('web helpers behave as expected', async () => {
    const controller = new AbortController();
    webTest.abortController(controller);
    expect(controller.signal.aborted).toBe(true);

    const text = webTest.extractReadableText('<html><body><h1>Title</h1><p>Body</p></body></html>');
    expect(text).toContain('Title');
    expect(text).toContain('Body');

    const results = webTest.parseDuckDuckGoResults(
      '<a class="result__a" href="/l/?uddg=https%3A%2F%2Fexample.com">Example</a>\n' +
      '<a class="result__snippet">Snippet</a>',
      5
    );
    expect(results[0]?.url).toBe('https://example.com');

    expect(webTest.isIpLiteral('127.0.0.1')).toBe(true);
    expect(webTest.isIpLiteral('example.com')).toBe(false);
    expect(webTest.normalizeHostname('Example.COM.')).toBe('example.com');
    expect(webTest.isPrivateHost('localhost')).toBe(true);
    expect(webTest.isPrivateIPv4([192, 168, 1, 1])).toBe(true);

    setDnsLookupForTests(async () => [{ address: '93.184.216.34', family: 4 }]);
    try {
      const resolved = await webTest.isPrivateHostOrResolved('example.com');
      expect(resolved).toBe(false);
    } finally {
      setDnsLookupForTests();
    }
  });
});
