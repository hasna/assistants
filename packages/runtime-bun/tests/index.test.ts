import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import { bunRuntime } from '../src/index';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const TEST_DIR = join(import.meta.dir, '.test-tmp');

describe('bunRuntime', () => {
  beforeAll(async () => {
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterAll(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  test('has correct name and version', () => {
    expect(bunRuntime.name).toBe('bun');
    expect(bunRuntime.version).toBe(Bun.version);
  });

  describe('file()', () => {
    test('returns a FileHandle', () => {
      const handle = bunRuntime.file(join(TEST_DIR, 'test.txt'));
      expect(handle).toBeDefined();
      expect(handle.exists).toBeDefined();
      expect(handle.text).toBeDefined();
      expect(handle.json).toBeDefined();
      expect(handle.arrayBuffer).toBeDefined();
    });

    test('exists() returns false for non-existent file', async () => {
      const handle = bunRuntime.file(join(TEST_DIR, 'nonexistent.txt'));
      expect(await handle.exists()).toBe(false);
    });

    test('exists() returns true for existing file', async () => {
      const path = join(TEST_DIR, 'exists-test.txt');
      await writeFile(path, 'test content');
      const handle = bunRuntime.file(path);
      expect(await handle.exists()).toBe(true);
    });

    test('text() reads file content', async () => {
      const path = join(TEST_DIR, 'text-test.txt');
      await writeFile(path, 'hello world');
      const handle = bunRuntime.file(path);
      expect(await handle.text()).toBe('hello world');
    });

    test('json() parses JSON file', async () => {
      const path = join(TEST_DIR, 'json-test.json');
      await writeFile(path, '{"key": "value", "num": 42}');
      const handle = bunRuntime.file(path);
      expect(await handle.json()).toEqual({ key: 'value', num: 42 });
    });

    test('arrayBuffer() returns binary content', async () => {
      const path = join(TEST_DIR, 'binary-test.bin');
      await writeFile(path, Buffer.from([0x48, 0x69])); // "Hi"
      const handle = bunRuntime.file(path);
      const buffer = await handle.arrayBuffer();
      expect(new Uint8Array(buffer)).toEqual(new Uint8Array([0x48, 0x69]));
    });
  });

  describe('write()', () => {
    test('writes string content', async () => {
      const path = join(TEST_DIR, 'write-test.txt');
      await bunRuntime.write(path, 'written content');
      const handle = bunRuntime.file(path);
      expect(await handle.text()).toBe('written content');
    });

    test('writes Uint8Array content', async () => {
      const path = join(TEST_DIR, 'write-binary.bin');
      await bunRuntime.write(path, new Uint8Array([1, 2, 3]));
      const handle = bunRuntime.file(path);
      const buffer = await handle.arrayBuffer();
      expect(new Uint8Array(buffer)).toEqual(new Uint8Array([1, 2, 3]));
    });

    test('creates parent directories', async () => {
      const path = join(TEST_DIR, 'nested', 'deep', 'file.txt');
      await bunRuntime.write(path, 'nested content');
      const handle = bunRuntime.file(path);
      expect(await handle.exists()).toBe(true);
      expect(await handle.text()).toBe('nested content');
    });
  });

  describe('shell()', () => {
    test('executes simple command', async () => {
      const result = await bunRuntime.shell`echo "hello"`;
      expect(result.stdout.trim()).toBe('hello');
      expect(result.exitCode).toBe(0);
    });

    test('text() returns stdout', async () => {
      const output = await bunRuntime.shell`echo "output"`.text();
      expect(output.trim()).toBe('output');
    });

    test('cwd() changes working directory', async () => {
      const result = await bunRuntime.shell`pwd`.cwd('/tmp');
      expect(result.stdout.trim()).toMatch(/\/tmp|\/private\/tmp/);
    });

    test('env() sets environment variables', async () => {
      const result = await bunRuntime.shell`echo $TEST_VAR`.env({ TEST_VAR: 'test_value' });
      expect(result.stdout.trim()).toBe('test_value');
    });

    test('nothrow() prevents throwing on non-zero exit', async () => {
      const result = await bunRuntime.shell`exit 1`.nothrow();
      expect(result.exitCode).toBe(1);
    });

    test('throws on non-zero exit without nothrow', async () => {
      try {
        await bunRuntime.shell`exit 1`;
        expect(true).toBe(false); // Should not reach
      } catch (error) {
        expect((error as Error & { exitCode: number }).exitCode).toBe(1);
      }
    });
  });

  describe('which()', () => {
    test('finds existing binary', () => {
      const path = bunRuntime.which('echo');
      expect(path).not.toBeNull();
    });

    test('returns null for non-existent binary', () => {
      const path = bunRuntime.which('nonexistent-binary-12345');
      expect(path).toBeNull();
    });
  });

  describe('glob()', () => {
    test('finds matching files', async () => {
      const dir = join(TEST_DIR, 'glob-test');
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'a.txt'), 'a');
      await writeFile(join(dir, 'b.txt'), 'b');
      await writeFile(join(dir, 'c.md'), 'c');

      const files: string[] = [];
      for await (const file of bunRuntime.glob('*.txt', { cwd: dir })) {
        files.push(file);
      }

      expect(files.sort()).toEqual(['a.txt', 'b.txt']);
    });

    test('respects dot option', async () => {
      const dir = join(TEST_DIR, 'glob-dot-test');
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, '.hidden'), 'hidden');
      await writeFile(join(dir, 'visible'), 'visible');

      // Without dot option (default false)
      const withoutDot: string[] = [];
      for await (const file of bunRuntime.glob('*', { cwd: dir })) {
        withoutDot.push(file);
      }

      // With dot option
      const withDot: string[] = [];
      for await (const file of bunRuntime.glob('*', { cwd: dir, dot: true })) {
        withDot.push(file);
      }

      expect(withoutDot).toContain('visible');
      expect(withDot).toContain('.hidden');
      expect(withDot).toContain('visible');
    });
  });

  describe('openDatabase()', () => {
    test('opens SQLite database', () => {
      const dbPath = join(TEST_DIR, 'test.db');
      const db = bunRuntime.openDatabase(dbPath);
      expect(db).toBeDefined();
      expect(db.exec).toBeDefined();
      expect(db.query).toBeDefined();
      expect(db.prepare).toBeDefined();
      expect(db.close).toBeDefined();
      expect(db.transaction).toBeDefined();
      db.close();
    });

    test('exec() runs SQL statements', () => {
      const dbPath = join(TEST_DIR, 'exec-test.db');
      const db = bunRuntime.openDatabase(dbPath);
      db.exec('CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)');
      db.exec("INSERT INTO test (name) VALUES ('foo')");
      const result = db.query<{ id: number; name: string }>('SELECT * FROM test').all();
      expect(result).toEqual([{ id: 1, name: 'foo' }]);
      db.close();
    });

    test('query() returns statement for execution', () => {
      const dbPath = join(TEST_DIR, 'query-test.db');
      const db = bunRuntime.openDatabase(dbPath);
      db.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, value TEXT)');
      db.exec("INSERT INTO items (value) VALUES ('a'), ('b')");

      const stmt = db.query<{ id: number; value: string }>('SELECT * FROM items');
      expect(stmt.all()).toHaveLength(2);
      expect(stmt.get()).toEqual({ id: 1, value: 'a' });

      db.close();
    });

    test('prepare() creates reusable statement', () => {
      const dbPath = join(TEST_DIR, 'prepare-test.db');
      const db = bunRuntime.openDatabase(dbPath);
      db.exec('CREATE TABLE data (id INTEGER PRIMARY KEY, val INTEGER)');

      const insert = db.prepare('INSERT INTO data (val) VALUES (?)');
      insert.run(10);
      insert.run(20);
      insert.run(30);

      const select = db.query<{ val: number }>('SELECT val FROM data ORDER BY val');
      expect(select.all().map(r => r.val)).toEqual([10, 20, 30]);

      db.close();
    });

    test('run() returns changes and lastInsertRowid', () => {
      const dbPath = join(TEST_DIR, 'run-test.db');
      const db = bunRuntime.openDatabase(dbPath);
      db.exec('CREATE TABLE records (id INTEGER PRIMARY KEY, name TEXT)');

      const insert = db.prepare('INSERT INTO records (name) VALUES (?)');
      const result = insert.run('test');

      expect(result.changes).toBe(1);
      expect(result.lastInsertRowid).toBe(1);

      db.close();
    });

    test('transaction() wraps operations', () => {
      const dbPath = join(TEST_DIR, 'transaction-test.db');
      const db = bunRuntime.openDatabase(dbPath);
      db.exec('CREATE TABLE tx_test (id INTEGER PRIMARY KEY, val INTEGER)');

      const result = db.transaction(() => {
        db.exec('INSERT INTO tx_test (val) VALUES (1)');
        db.exec('INSERT INTO tx_test (val) VALUES (2)');
        return db.query<{ val: number }>('SELECT val FROM tx_test').all();
      });

      expect(result).toHaveLength(2);
      db.close();
    });
  });

  describe('spawn()', () => {
    test('spawns process and returns result', async () => {
      const result = bunRuntime.spawn(['echo', 'spawned']);
      expect(result.pid).toBeGreaterThan(0);
      expect(result.stdout).toBeDefined();

      const exitCode = await result.exited;
      expect(exitCode).toBe(0);
    });

    test('respects cwd option', async () => {
      const result = bunRuntime.spawn(['pwd'], { cwd: '/tmp', stdout: 'pipe' });
      const text = await new Response(result.stdout!).text();
      expect(text.trim()).toMatch(/\/tmp|\/private\/tmp/);
      await result.exited;
    });

    test('respects env option', async () => {
      const result = bunRuntime.spawn(['sh', '-c', 'echo $CUSTOM_ENV'], {
        stdout: 'pipe',
        env: { CUSTOM_ENV: 'custom_value' },
      });
      const text = await new Response(result.stdout!).text();
      expect(text.trim()).toBe('custom_value');
      await result.exited;
    });

    test('kill() terminates process', async () => {
      const result = bunRuntime.spawn(['sleep', '10']);
      result.kill();
      const exitCode = await result.exited;
      // On Unix, killed processes typically exit with signal-based code
      expect(exitCode).not.toBe(0);
    });
  });
});
