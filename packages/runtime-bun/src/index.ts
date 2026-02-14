/**
 * Bun runtime implementation for @hasna/assistants-core
 */

import { Glob } from 'bun';
import { Database } from 'bun:sqlite';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type {
  Runtime,
  FileHandle,
  SpawnOptions,
  SpawnResult,
  ShellCommand,
  ShellResult,
  GlobOptions,
  DatabaseConnection,
  DatabaseStatement,
} from '@hasna/assistants-core/runtime';

class BunFileHandle implements FileHandle {
  private bunFile: ReturnType<typeof Bun.file>;

  constructor(path: string) {
    this.bunFile = Bun.file(path);
  }

  exists(): Promise<boolean> {
    return this.bunFile.exists();
  }

  text(): Promise<string> {
    return this.bunFile.text();
  }

  json<T = unknown>(): Promise<T> {
    return this.bunFile.json() as Promise<T>;
  }

  arrayBuffer(): Promise<ArrayBuffer> {
    return this.bunFile.arrayBuffer();
  }

  get size(): number {
    return this.bunFile.size;
  }
}

class BunShellCommand implements ShellCommand {
  private _cwd: string | undefined;
  private _env: Record<string, string | undefined> | undefined;
  private _quiet: boolean = false;
  private _nothrow: boolean = false;
  private command: string;

  constructor(strings: TemplateStringsArray, values: unknown[]) {
    // Reconstruct the command string from template
    this.command = strings.reduce((acc, str, i) => {
      const value = i < values.length ? String(values[i]) : '';
      return acc + str + value;
    }, '');
  }

  cwd(path: string): ShellCommand {
    this._cwd = path;
    return this;
  }

  env(env: Record<string, string | undefined>): ShellCommand {
    this._env = env;
    return this;
  }

  quiet(): ShellCommand {
    this._quiet = true;
    return this;
  }

  nothrow(): ShellCommand {
    this._nothrow = true;
    return this;
  }

  async text(): Promise<string> {
    const result = await this.execute();
    return result.stdout;
  }

  private async execute(): Promise<ShellResult> {
    // Use Bun.spawn with sh -c to execute the command string
    // This is necessary because Bun.$ template literals escape interpolations
    const isWindows = process.platform === 'win32';
    const shellBinary = isWindows ? 'cmd' : (Bun.which('bash') || 'sh');
    const shellArgs = isWindows ? ['/c', this.command] : ['-lc', this.command];
    const proc = Bun.spawn([shellBinary, ...shellArgs], {
      cwd: this._cwd,
      env: { ...process.env, ...(this._env ?? {}) },
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);

    const exitCode = await proc.exited;

    if (!this._nothrow && exitCode !== 0) {
      const error = new Error(`Shell command failed with exit code ${exitCode}: ${stderr}`);
      (error as Error & { exitCode: number; stdout: string; stderr: string }).exitCode = exitCode;
      (error as Error & { exitCode: number; stdout: string; stderr: string }).stdout = stdout;
      (error as Error & { exitCode: number; stdout: string; stderr: string }).stderr = stderr;
      throw error;
    }

    return {
      stdout,
      stderr,
      exitCode,
    };
  }

  then<T>(
    onFulfilled?: (result: ShellResult) => T | PromiseLike<T>,
    onRejected?: (reason: unknown) => T | PromiseLike<T>
  ): Promise<T> {
    return this.execute().then(onFulfilled, onRejected);
  }
}

class BunDatabaseStatement<T = unknown> implements DatabaseStatement<T> {
  private stmt: ReturnType<Database['query']>;

  constructor(stmt: ReturnType<Database['query']>) {
    this.stmt = stmt;
  }

  all(...params: unknown[]): T[] {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return this.stmt.all(...(params as any)) as T[];
  }

  get(...params: unknown[]): T | undefined {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return this.stmt.get(...(params as any)) as T | undefined;
  }

  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint } {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return this.stmt.run(...(params as any));
  }
}

class BunDatabaseConnection implements DatabaseConnection {
  private db: Database;

  constructor(path: string) {
    this.db = new Database(path);
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  query<T = unknown>(sql: string): DatabaseStatement<T> {
    return new BunDatabaseStatement<T>(this.db.query(sql));
  }

  prepare<T = unknown>(sql: string): DatabaseStatement<T> {
    return new BunDatabaseStatement<T>(this.db.prepare(sql));
  }

  close(): void {
    this.db.close();
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }
}

export const bunRuntime: Runtime = {
  name: 'bun',
  version: Bun.version,

  file(path: string): FileHandle {
    return new BunFileHandle(path);
  },

  write(path: string, content: string | Uint8Array | Blob): Promise<number> {
    return mkdir(dirname(path), { recursive: true }).then(() => Bun.write(path, content));
  },

  spawn(cmd: string[], options?: SpawnOptions): SpawnResult {
    const proc = Bun.spawn(cmd, {
      cwd: options?.cwd,
      stdin: options?.stdin,
      stdout: options?.stdout,
      stderr: options?.stderr,
      env: options?.env ? { ...process.env, ...options.env } : process.env,
    });

    return {
      stdout: proc.stdout as ReadableStream<Uint8Array> | null,
      stderr: proc.stderr as ReadableStream<Uint8Array> | null,
      // Bun's FileSink has a different interface than WritableStream, cast through unknown
      stdin: proc.stdin as unknown as WritableStream<Uint8Array> | null,
      pid: proc.pid,
      exited: proc.exited,
      kill: (signal?: number) => proc.kill(signal),
    };
  },

  shell(strings: TemplateStringsArray, ...values: unknown[]): ShellCommand {
    return new BunShellCommand(strings, values);
  },

  which(binary: string): string | null {
    return Bun.which(binary);
  },

  async *glob(pattern: string, options?: GlobOptions): AsyncIterable<string> {
    const g = new Glob(pattern);
    for await (const file of g.scan({
      cwd: options?.cwd,
      dot: options?.dot,
      absolute: options?.absolute,
      onlyFiles: options?.onlyFiles ?? true,
    })) {
      yield file;
    }
  },

  openDatabase(path: string): DatabaseConnection {
    return new BunDatabaseConnection(path);
  },
};

export default bunRuntime;
