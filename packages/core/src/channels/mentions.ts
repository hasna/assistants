/**
 * Channel @mention parsing and resolution
 */

import type { ChannelMember } from './types';

/**
 * Extract @mention names from message content
 * Supports:
 *   @name          - single word (alphanumeric, hyphens, underscores)
 *   @"Name Here"   - quoted multi-word name
 *   @Name-Here     - hyphenated name
 */
export function parseMentions(content: string): string[] {
  const mentions: string[] = [];

  // Match @"quoted name" first
  const quotedRegex = /@"([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = quotedRegex.exec(content)) !== null) {
    const name = match[1].trim();
    if (name && !mentions.includes(name)) {
      mentions.push(name);
    }
  }

  // Match @singleword (skip already-matched quoted ones)
  const simpleRegex = /@([a-zA-Z0-9_-]+)/g;
  while ((match = simpleRegex.exec(content)) !== null) {
    const name = match[1];
    if (!mentions.includes(name)) {
      mentions.push(name);
    }
  }

  return mentions;
}

/**
 * Resolve mention names against a list of known names (assistants, people).
 * Performs fuzzy matching: exact match, case-insensitive, or prefix match.
 */
export function resolveNameToKnown(
  mentionName: string,
  knownNames: Array<{ id: string; name: string }>
): { id: string; name: string } | null {
  const lower = mentionName.toLowerCase();

  // Exact match (case-insensitive)
  const exact = knownNames.find((k) => k.name.toLowerCase() === lower);
  if (exact) return exact;

  // Prefix match (e.g. @Default matches "Default Assistant")
  const prefix = knownNames.find((k) => k.name.toLowerCase().startsWith(lower));
  if (prefix) return prefix;

  // Word match (e.g. @Email matches "Email Assistant")
  const word = knownNames.find((k) =>
    k.name.toLowerCase().split(/\s+/).some((w) => w === lower)
  );
  if (word) return word;

  return null;
}

/**
 * Resolve mention names to member IDs using channel members list
 */
export function resolveMentions(
  names: string[],
  members: ChannelMember[]
): Array<{ name: string; memberId: string; memberType: string }> {
  const resolved: Array<{ name: string; memberId: string; memberType: string }> = [];

  for (const name of names) {
    const lower = name.toLowerCase();
    const member = members.find(
      (m) => m.assistantName.toLowerCase() === lower
    );
    if (member) {
      resolved.push({
        name,
        memberId: member.assistantId,
        memberType: member.memberType,
      });
    }
  }

  return resolved;
}

/**
 * Get mentioned member IDs from a message content
 */
export function getMentionedMemberIds(
  content: string,
  members: ChannelMember[]
): string[] {
  const names = parseMentions(content);
  const resolved = resolveMentions(names, members);
  return resolved.map((r) => r.memberId);
}
