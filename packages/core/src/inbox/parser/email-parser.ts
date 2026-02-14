/**
 * Email parser for MIME/EML content
 * Uses mailparser for robust email parsing
 */

import { simpleParser, type ParsedMail, type AddressObject } from 'mailparser';
import type { Email, EmailAddress, EmailAttachment } from '@hasna/assistants-shared';

export interface ParseOptions {
  /** Unique ID for this email */
  id: string;
  /** S3 object key (optional) */
  s3Key?: string;
  /** Whether to include raw email content */
  includeRaw?: boolean;
}

/**
 * Parse raw email content (EML/MIME) into structured Email object
 */
export class EmailParser {
  /**
   * Parse raw email buffer into Email structure
   */
  async parse(rawEmail: Buffer, options: ParseOptions): Promise<Email> {
    const parsed = await simpleParser(rawEmail);

    const from = this.parseAddress(parsed.from);
    const to = this.parseAddressList(parsed.to);
    const cc = parsed.cc ? this.parseAddressList(parsed.cc) : undefined;

    const attachments = this.parseAttachments(parsed);

    const headers: Record<string, string> = {};
    if (parsed.headers) {
      for (const [key, value] of parsed.headers) {
        if (typeof value === 'string') {
          headers[key] = value;
        } else if (value && typeof value === 'object') {
          headers[key] = JSON.stringify(value);
        }
      }
    }

    const email: Email = {
      id: options.id,
      messageId: parsed.messageId || options.id,
      from: from || { address: 'unknown@unknown.com' },
      to: to.length > 0 ? to : [{ address: 'unknown@unknown.com' }],
      cc: cc && cc.length > 0 ? cc : undefined,
      subject: parsed.subject || '(No Subject)',
      date: parsed.date?.toISOString() || new Date().toISOString(),
      body: {
        text: parsed.text || undefined,
        html: parsed.html || undefined,
      },
      attachments: attachments.length > 0 ? attachments : undefined,
      headers,
      s3Key: options.s3Key,
      cachedAt: new Date().toISOString(),
    };

    if (options.includeRaw) {
      email.raw = rawEmail.toString('utf-8');
    }

    return email;
  }

  /**
   * Parse a single address object
   */
  private parseAddress(addr: AddressObject | AddressObject[] | undefined): EmailAddress | null {
    if (!addr) return null;

    // Handle array case - take first address
    const addressObj = Array.isArray(addr) ? addr[0] : addr;
    if (!addressObj?.value?.[0]) return null;

    const first = addressObj.value[0];
    return {
      name: first.name || undefined,
      address: first.address || 'unknown@unknown.com',
    };
  }

  /**
   * Parse address list (to, cc, bcc)
   */
  private parseAddressList(addr: AddressObject | AddressObject[] | undefined): EmailAddress[] {
    if (!addr) return [];

    const addresses: EmailAddress[] = [];
    const addrArray = Array.isArray(addr) ? addr : [addr];

    for (const addrObj of addrArray) {
      if (addrObj?.value) {
        for (const entry of addrObj.value) {
          addresses.push({
            name: entry.name || undefined,
            address: entry.address || 'unknown@unknown.com',
          });
        }
      }
    }

    return addresses;
  }

  /**
   * Parse attachments from parsed email
   */
  private parseAttachments(parsed: ParsedMail): EmailAttachment[] {
    if (!parsed.attachments || parsed.attachments.length === 0) {
      return [];
    }

    return parsed.attachments.map((att) => ({
      filename: att.filename || 'attachment',
      contentType: att.contentType || 'application/octet-stream',
      size: att.size || att.content?.length || 0,
      contentId: att.cid || undefined,
    }));
  }

  /**
   * Extract attachment content from raw email
   */
  async extractAttachment(rawEmail: Buffer, attachmentIndex: number): Promise<Buffer | null> {
    const parsed = await simpleParser(rawEmail);

    if (!parsed.attachments || attachmentIndex >= parsed.attachments.length) {
      return null;
    }

    return parsed.attachments[attachmentIndex].content;
  }
}

/**
 * Format email address for display
 */
export function formatEmailAddress(addr: EmailAddress): string {
  if (addr.name) {
    return `${addr.name} <${addr.address}>`;
  }
  return addr.address;
}

/**
 * Format email for display as markdown
 */
export function formatEmailAsMarkdown(email: Email): string {
  const lines: string[] = [];

  lines.push(`# ${email.subject}`);
  lines.push('');
  lines.push(`**From:** ${formatEmailAddress(email.from)}`);
  lines.push(`**To:** ${email.to.map(formatEmailAddress).join(', ')}`);
  if (email.cc && email.cc.length > 0) {
    lines.push(`**CC:** ${email.cc.map(formatEmailAddress).join(', ')}`);
  }
  lines.push(`**Date:** ${email.date}`);
  lines.push(`**Message-ID:** ${email.messageId}`);
  lines.push('');

  if (email.attachments && email.attachments.length > 0) {
    lines.push('## Attachments');
    lines.push('');
    email.attachments.forEach((att, i) => {
      const size = formatSize(att.size);
      lines.push(`${i + 1}. **${att.filename}** (${att.contentType}, ${size})`);
    });
    lines.push('');
  }

  lines.push('## Content');
  lines.push('');
  if (email.body.text) {
    lines.push(email.body.text);
  } else if (email.body.html) {
    lines.push('*HTML content available - text version not provided*');
  } else {
    lines.push('*No content*');
  }

  return lines.join('\n');
}

/**
 * Format file size for display
 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
