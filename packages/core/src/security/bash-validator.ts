import type { Severity } from './types';

const DANGEROUS_PATTERNS: Array<{ pattern: RegExp; reason: string; severity: Severity }> = [
  { pattern: /\$\([^)]*\)/, reason: 'Command substitution detected', severity: 'high' },
  { pattern: /`[^`]*`/, reason: 'Backtick command substitution detected', severity: 'high' },
  { pattern: />\s*\/dev\/sd[a-z]/i, reason: 'Direct disk device write detected', severity: 'critical' },
  { pattern: /\|\s*(bash|sh|zsh|fish)\b/i, reason: 'Piping to shell detected', severity: 'high' },
  { pattern: /\beval\s+/i, reason: 'Eval command detected', severity: 'high' },
  { pattern: /\bmkfs\b/i, reason: 'Filesystem formatting detected', severity: 'critical' },
  { pattern: /\bdd\s+/i, reason: 'Disk overwrite command detected', severity: 'critical' },
  { pattern: /:\s*\(\)\s*\{\s*:\s*\|\s*:\s*&\s*}\s*;/, reason: 'Fork bomb detected', severity: 'critical' },
];

const BLOCKED_COMMANDS = [
  'rm -rf /',
  'rm -rf /*',
  'mkfs',
  'dd if=/dev/zero',
];

export interface BashValidationResult {
  valid: boolean;
  reason?: string;
  severity?: Severity;
}

export function validateBashCommand(command: string): BashValidationResult {
  const normalized = command.toLowerCase();

  for (const blocked of BLOCKED_COMMANDS) {
    if (normalized.includes(blocked)) {
      return {
        valid: false,
        reason: `Blocked command pattern: ${blocked}`,
        severity: 'critical',
      };
    }
  }

  for (const entry of DANGEROUS_PATTERNS) {
    if (entry.pattern.test(command)) {
      return {
        valid: false,
        reason: entry.reason,
        severity: entry.severity,
      };
    }
  }

  return { valid: true };
}
