import { resolve, normalize, relative, isAbsolute } from 'path';
import { homedir } from 'os';
import { lstat, realpath } from 'fs/promises';

export interface PathValidationOptions {
  allowSymlinks?: boolean;
  allowedPaths?: string[];
  blockedPaths?: string[];
}

export interface PathValidationResult {
  valid: boolean;
  resolved: string;
  error?: string;
}

export async function validatePath(
  inputPath: string,
  options: PathValidationOptions = {}
): Promise<PathValidationResult> {
  const normalized = normalize(expandHome(inputPath));
  const resolved = resolve(normalized);

  const allowedPaths = options.allowedPaths?.map((p) => resolve(p));
  const blockedPaths = options.blockedPaths?.map((p) => resolve(p));

  if (normalized.includes('..')) {
    const real = await realpath(resolved).catch(() => resolved);
    if (!isWithinAllowed(real, allowedPaths)) {
      return { valid: false, resolved, error: 'Path traversal detected' };
    }
  }

  if (!options.allowSymlinks) {
    try {
      const stat = await lstat(resolved);
      if (stat.isSymbolicLink()) {
        const target = await realpath(resolved);
        if (!isWithinAllowed(target, allowedPaths)) {
          return { valid: false, resolved, error: 'Symlink points outside allowed paths' };
        }
      }
    } catch {
      // File does not exist yet.
    }
  }

  if (blockedPaths && blockedPaths.some((blocked) => isWithinPath(resolved, blocked))) {
    return { valid: false, resolved, error: 'Path is in blocked list' };
  }

  if (!isWithinAllowed(resolved, allowedPaths)) {
    return { valid: false, resolved, error: 'Path is outside allowed paths' };
  }

  return { valid: true, resolved };
}

function expandHome(value: string): string {
  if (value === '~') return homedir();
  if (value.startsWith('~/')) {
    return resolve(homedir(), value.slice(2));
  }
  return value;
}

function isWithinAllowed(path: string, allowed?: string[]): boolean {
  if (!allowed || allowed.length === 0) return true;
  return allowed.some((allowedPath) => path === allowedPath || path.startsWith(`${allowedPath}/`));
}

function isWithinPath(target: string, base: string): boolean {
  if (target === base) return true;
  const rel = relative(base, target);
  if (!rel || rel === '') return true;
  if (rel.startsWith('..')) return false;
  if (isAbsolute(rel)) return false;
  return true;
}
