import { homedir } from 'os';
import { resolve, relative, isAbsolute, basename } from 'path';
import { lstat, realpath } from 'fs/promises';

/**
 * Protected paths that should never be readable regardless of allowlist.
 * These contain credentials, secrets, and system-critical files.
 */
const PROTECTED_PATHS = [
  // System password/auth files
  '/etc/passwd',
  '/etc/shadow',
  '/etc/sudoers',
  '/etc/master.passwd',
  '/etc/security',
  // User secrets and credentials
  '~/.secrets',
  '~/.ssh',
  '~/.gnupg',
  '~/.pgp',
  '~/.gpg',
  // Cloud provider credentials
  '~/.aws/credentials',
  '~/.aws/config',
  '~/.azure/credentials',
  '~/.config/gcloud',
  '~/.kube/config',
  '~/.docker/config.json',
  // Package manager tokens
  '~/.npmrc',
  '~/.yarnrc',
  '~/.pypirc',
  '~/.gem/credentials',
  // Shell history (may contain secrets)
  '~/.bash_history',
  '~/.zsh_history',
  '~/.history',
  // Database configs
  '~/.pgpass',
  '~/.my.cnf',
  '~/.mongocli.yaml',
  // Git credentials
  '~/.git-credentials',
  '~/.gitconfig',
  // Application tokens
  '~/.netrc',
  '~/.authinfo',
  '~/.config/gh/hosts.yml',
  '~/.config/hub',
  // Password managers
  '~/.password-store',
  '~/.vault-token',
  // Claude/AI configs that may have keys
  '~/.anthropic',
  '~/.openai',
];

/**
 * Protected file patterns - filenames that should be blocked regardless of location.
 * These typically contain environment variables, secrets, or credentials.
 */
const PROTECTED_FILENAME_PATTERNS = [
  /^\.env($|\..*)/, // .env, .env.local, .env.production, etc.
  /^\.secret(s)?($|\..*)/, // .secret, .secrets, .secrets.json
  /^credentials(\..*)?$/i, // credentials, credentials.json
  /^secrets?(\..*)?$/i, // secret.json, secrets.yaml
  /^.*_credentials(\..*)?$/i, // aws_credentials, gcp_credentials.json
  /^.*_secret(s)?(\..*)?$/i, // api_secret, app_secrets.json
  /^\.?id_rsa(\.pub)?$/, // SSH keys
  /^\.?id_ed25519(\.pub)?$/,
  /^\.?id_ecdsa(\.pub)?$/,
  /^\.?id_dsa(\.pub)?$/,
  /^authorized_keys$/,
  /^known_hosts$/,
  /^.*\.pem$/, // Private key files
  /^.*\.key$/,
  /^.*\.p12$/,
  /^.*\.pfx$/,
  /^.*\.keystore$/,
];

export interface PathSafetyResult {
  safe: boolean;
  reason?: string;
}

export interface PathSafetyOptions {
  /** Working directory - reads are restricted to within this directory */
  cwd?: string;
  /** Additional allowed paths outside cwd (absolute paths only) */
  allowedPaths?: string[];
  /** Whether to enforce allowlist mode (default: true for reads) */
  enforceAllowlist?: boolean;
}

/**
 * Check if a filename matches any protected filename pattern.
 */
function isProtectedFilename(filename: string): boolean {
  for (const pattern of PROTECTED_FILENAME_PATTERNS) {
    if (pattern.test(filename)) {
      return true;
    }
  }
  return false;
}

/**
 * Check if a path is within any of the allowed paths.
 */
function isInAllowedPaths(resolved: string, allowedPaths: string[]): boolean {
  for (const allowedPath of allowedPaths) {
    if (isWithinPath(resolved, allowedPath)) {
      return true;
    }
  }
  return false;
}

export async function isPathSafe(
  targetPath: string,
  operation: 'read' | 'write' | 'delete',
  options: PathSafetyOptions = {}
): Promise<PathSafetyResult> {
  const expandedTarget = expandHome(targetPath);
  const resolved = resolve(expandedTarget);
  const home = homedir();
  const filename = basename(resolved);

  // 1. Always check protected paths first (absolute blocklist)
  for (const protectedPath of PROTECTED_PATHS) {
    const expanded = protectedPath.replace('~', home);
    if (isWithinPath(resolved, expanded)) {
      return {
        safe: false,
        reason: `Cannot ${operation} protected path: ${protectedPath}`,
      };
    }
  }

  // 2. Check protected filename patterns
  if (isProtectedFilename(filename)) {
    return {
      safe: false,
      reason: `Cannot ${operation} file with protected name pattern: ${filename}`,
    };
  }

  // 3. For read operations, enforce allowlist (default behavior)
  const enforceAllowlist = options.enforceAllowlist ?? (operation === 'read');
  if (enforceAllowlist) {
    const cwd = options.cwd ? resolve(options.cwd) : process.cwd();
    const allowedPaths = [cwd, ...(options.allowedPaths || []).map((p) => resolve(p))];

    if (!isInAllowedPaths(resolved, allowedPaths)) {
      return {
        safe: false,
        reason: `Cannot ${operation} files outside project directory. Path must be within: ${cwd}`,
      };
    }
  }

  // 4. Check symlink safety
  try {
    const stat = await lstat(resolved);
    if (stat.isSymbolicLink()) {
      const target = await realpath(resolved);
      const root = options.cwd ? resolve(options.cwd) : process.cwd();
      const allowedTargets = [root, ...(options.allowedPaths || []).map((p) => resolve(p))];

      // Symlink target must be in allowed paths
      if (!isInAllowedPaths(target, allowedTargets)) {
        return {
          safe: false,
          reason: 'Symlink points outside allowed directories',
        };
      }

      // Also check if symlink target is a protected path
      for (const protectedPath of PROTECTED_PATHS) {
        const expanded = protectedPath.replace('~', home);
        if (isWithinPath(target, expanded)) {
          return {
            safe: false,
            reason: `Symlink points to protected path: ${protectedPath}`,
          };
        }
      }

      // Check if symlink target has protected filename
      if (isProtectedFilename(basename(target))) {
        return {
          safe: false,
          reason: `Symlink points to file with protected name pattern`,
        };
      }
    }
  } catch {
    // Ignore missing paths.
  }

  return { safe: true };
}

function expandHome(value: string): string {
  if (value === '~') return homedir();
  if (value.startsWith('~/')) {
    return resolve(homedir(), value.slice(2));
  }
  return value;
}

function isWithinPath(target: string, base: string): boolean {
  const rel = relative(base, target);
  if (rel === '') return true;
  if (rel.startsWith('..')) return false;
  if (isAbsolute(rel)) return false;
  return true;
}

/** Exported for testing */
export const __test__ = {
  PROTECTED_PATHS,
  PROTECTED_FILENAME_PATTERNS,
  isProtectedFilename,
  isInAllowedPaths,
  expandHome,
  isWithinPath,
};
