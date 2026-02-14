import { describe, expect, test } from 'bun:test';
import { mkdtemp, writeFile, symlink, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { validateBashCommand } from '../src/security/bash-validator';
import { isPathSafe } from '../src/security/path-validator';
import { SecurityLogger } from '../src/security/logger';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('Bash Security', () => {
  test('should block dangerous commands', () => {
    const result = validateBashCommand('rm -rf /');
    expect(result.valid).toBe(false);
  });

  test('should detect command substitution', () => {
    const result = validateBashCommand('echo $(whoami)');
    expect(result.valid).toBe(false);
  });

  test('should allow safe commands', () => {
    const result = validateBashCommand('ls -la');
    expect(result.valid).toBe(true);
  });
});

describe('Path Security', () => {
  test('should block symlink outside working directory', async () => {
    const base = await mkdtemp(join(tmpdir(), 'assistants-sec-'));
    const outside = await mkdtemp(join(tmpdir(), 'assistants-outside-'));
    const target = join(outside, 'secret.txt');
    await writeFile(target, 'secret');

    const linkPath = join(base, 'link.txt');
    await symlink(target, linkPath);

    const result = await isPathSafe(linkPath, 'read', { cwd: base });
    expect(result.safe).toBe(false);
  });

  test('should block reads of protected paths', async () => {
    const result = await isPathSafe('/etc/passwd', 'read');
    expect(result.safe).toBe(false);
  });

  test('should block protected paths with home expansion', async () => {
    const result = await isPathSafe('~/.ssh', 'read');
    expect(result.safe).toBe(false);
  });

  test('should block secrets file in home directory', async () => {
    const result = await isPathSafe('~/.secrets', 'read');
    expect(result.safe).toBe(false);
  });

  test('should not block paths that only share a prefix with protected paths', async () => {
    // Test that /etc/passwd2 isn't blocked just because /etc/passwd is protected
    // We need to allow /etc in the allowlist to isolate testing the protected path matching
    const result = await isPathSafe('/etc/passwd2', 'read', { cwd: '/', allowedPaths: ['/etc'] });
    expect(result.safe).toBe(true);
  });

  test('should block path traversal attempts with ../', async () => {
    const base = await mkdtemp(join(tmpdir(), 'assistants-traversal-'));
    const result = await isPathSafe(join(base, '../../etc/passwd'), 'read', { cwd: base });
    expect(result.safe).toBe(false);
    expect(result.reason || '').toMatch(/outside|protected path/i);
  });

  test('should block protected filename patterns (.env)', async () => {
    const base = await mkdtemp(join(tmpdir(), 'assistants-env-'));
    const result = await isPathSafe(join(base, '.env'), 'read', { cwd: base });
    expect(result.safe).toBe(false);
    expect(result.reason).toContain('protected name');
  });

  test('should block protected filename patterns (.env.local)', async () => {
    const base = await mkdtemp(join(tmpdir(), 'assistants-envlocal-'));
    const result = await isPathSafe(join(base, '.env.local'), 'read', { cwd: base });
    expect(result.safe).toBe(false);
    expect(result.reason).toContain('protected name');
  });

  test('should block credentials files', async () => {
    const base = await mkdtemp(join(tmpdir(), 'assistants-creds-'));
    const result = await isPathSafe(join(base, 'credentials.json'), 'read', { cwd: base });
    expect(result.safe).toBe(false);
  });

  test('should block id_rsa private keys', async () => {
    const base = await mkdtemp(join(tmpdir(), 'assistants-ssh-'));
    const result = await isPathSafe(join(base, 'id_rsa'), 'read', { cwd: base });
    expect(result.safe).toBe(false);
  });

  test('should block .pem files', async () => {
    const base = await mkdtemp(join(tmpdir(), 'assistants-pem-'));
    const result = await isPathSafe(join(base, 'private.pem'), 'read', { cwd: base });
    expect(result.safe).toBe(false);
  });

  test('should block AWS credentials', async () => {
    const result = await isPathSafe('~/.aws/credentials', 'read');
    expect(result.safe).toBe(false);
  });

  test('should block npm tokens', async () => {
    const result = await isPathSafe('~/.npmrc', 'read');
    expect(result.safe).toBe(false);
  });

  test('should block symlink pointing to protected file', async () => {
    const base = await mkdtemp(join(tmpdir(), 'assistants-symlink-'));
    const secretFile = join(base, '.env');
    await writeFile(secretFile, 'SECRET=foo');
    const linkPath = join(base, 'innocent.txt');
    await symlink(secretFile, linkPath);

    const result = await isPathSafe(linkPath, 'read', { cwd: base });
    expect(result.safe).toBe(false);
  });

  test('should allow safe paths within cwd', async () => {
    const base = await mkdtemp(join(tmpdir(), 'assistants-safe-'));
    const safePath = join(base, 'safe', 'file.txt');
    const result = await isPathSafe(safePath, 'read', { cwd: base });
    expect(result.safe).toBe(true);
  });
});

describe('Security Logger', () => {
  test('should log and persist events', async () => {
    const logDir = await mkdtemp(join(tmpdir(), 'assistants-sec-log-'));
    const logFile = join(logDir, 'security.log');
    const logger = new SecurityLogger(logFile);

    logger.log({
      eventType: 'blocked_command',
      severity: 'high',
      details: {
        tool: 'bash',
        command: 'rm -rf /',
        reason: 'Blocked command',
      },
      sessionId: 'test-session',
    });

    await wait(10);

    const events = logger.getEvents();
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe('blocked_command');

    const content = await readFile(logFile, 'utf-8');
    expect(content).toContain('blocked_command');
  });
});
