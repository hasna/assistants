import { describe, expect, test } from 'bun:test';
import { formatEmailAddress, formatEmailAsMarkdown } from '../src/inbox/parser/email-parser';
import type { Email } from '@hasna/assistants-shared';

const sampleEmail: Email = {
  id: 'email-1',
  messageId: 'msg-1',
  from: { address: 'from@example.com', name: 'From Name' },
  to: [{ address: 'to@example.com' }],
  subject: 'Subject',
  date: '2024-01-01T00:00:00.000Z',
  body: { text: 'Body text' },
  headers: {},
  attachments: [
    { filename: 'file.txt', contentType: 'text/plain', size: 1200 },
  ],
};

describe('email parser formatting', () => {
  test('formatEmailAddress uses name when available', () => {
    const formatted = formatEmailAddress({ name: 'Alice', address: 'alice@example.com' });
    expect(formatted).toBe('Alice <alice@example.com>');
  });

  test('formatEmailAsMarkdown includes attachments section', () => {
    const output = formatEmailAsMarkdown(sampleEmail);
    expect(output).toContain('Attachments');
    expect(output).toContain('file.txt');
    expect(output).toContain('Body text');
  });
});
