/**
 * Runtime abstraction types for cross-platform support.
 * These interfaces allow core to work with both Bun and Node.js runtimes.
 */

/**
 * File handle for reading file contents
 */
export interface FileHandle {
  exists(): Promise<boolean>;
  text(): Promise<string>;
  json<T = unknown>(): Promise<T>;
  arrayBuffer(): Promise<ArrayBuffer>;
  readonly size: number;
}

/**
 * Options for spawning a process
 */
export interface SpawnOptions {
  cwd?: string;
  stdin?: 'pipe' | 'ignore' | 'inherit';
  stdout?: 'pipe' | 'ignore' | 'inherit';
  stderr?: 'pipe' | 'ignore' | 'inherit';
  env?: Record<string, string | undefined>;
  timeout?: number;
}

/**
 * Result of spawning a process
 */
export interface SpawnResult {
  readonly stdout: ReadableStream<Uint8Array> | null;
  readonly stderr: ReadableStream<Uint8Array> | null;
  readonly stdin: WritableStream<Uint8Array> | null;
  readonly pid: number;
  readonly exited: Promise<number>;
  kill(signal?: number): void;
}

/**
 * Result of running a shell command
 */
export interface ShellResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/**
 * Options for glob pattern matching
 */
export interface GlobOptions {
  cwd?: string;
  dot?: boolean;
  absolute?: boolean;
  onlyFiles?: boolean;
}

/**
 * Database statement for prepared queries
 */
export interface DatabaseStatement<T = unknown> {
  all(...params: unknown[]): T[];
  get(...params: unknown[]): T | undefined;
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
}

/**
 * Database connection for SQLite operations
 */
export interface DatabaseConnection {
  exec(sql: string): void;
  query<T = unknown>(sql: string): DatabaseStatement<T>;
  prepare<T = unknown>(sql: string): DatabaseStatement<T>;
  close(): void;
  transaction<T>(fn: () => T): T;
}

/**
 * Main runtime interface that abstracts platform-specific APIs
 */
export interface Runtime {
  // File operations
  file(path: string): FileHandle;
  write(path: string, content: string | Uint8Array | Blob): Promise<number>;

  // Process operations
  spawn(cmd: string[], options?: SpawnOptions): SpawnResult;
  shell(strings: TemplateStringsArray, ...values: unknown[]): ShellCommand;
  which(binary: string): string | null;

  // Glob operations
  glob(pattern: string, options?: GlobOptions): AsyncIterable<string>;

  // Database
  openDatabase(path: string): DatabaseConnection;

  // Runtime info
  readonly name: 'bun' | 'node';
  readonly version: string;
}

/**
 * Shell command builder (similar to Bun.$)
 */
export interface ShellCommand {
  cwd(path: string): ShellCommand;
  env(env: Record<string, string | undefined>): ShellCommand;
  quiet(): ShellCommand;
  nothrow(): ShellCommand;
  text(): Promise<string>;
  then<T>(
    onFulfilled?: (result: ShellResult) => T | PromiseLike<T>,
    onRejected?: (reason: unknown) => T | PromiseLike<T>
  ): Promise<T>;
}
