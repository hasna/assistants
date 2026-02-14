import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { ParsedMail } from 'mailparser';

let parsedMail: ParsedMail;

mock.module('mailparser', () => ({
  simpleParser: async () => parsedMail,
}));

const { EmailParser, formatEmailAsMarkdown } = await import('../src/inbox/parser/email-parser');

describe('EmailParser parse and attachments', () => {
  beforeEach(() => {
    parsedMail = {
      from: { value: [{ name: 'Sender', address: 'sender@example.com' }] },
      to: { value: [{ address: 'to@example.com' }] },
      cc: [{ value: [{ name: 'CC', address: 'cc@example.com' }] }],
      subject: '',
      date: new Date('2026-02-01T00:00:00Z'),
      text: 'Hello',
      html: '<p>Hello</p>',
      messageId: 'msg-1',
      headers: new Map([
        ['x-test', 'value'],
        ['x-json', { ok: true }],
      ]),
      attachments: [
        {
          filename: 'file.txt',
          contentType: 'text/plain',
          size: 3,
          content: Buffer.from('abc'),
          cid: 'cid-1',
        },
      ],
    } as ParsedMail;
  });

  afterAll(() => {
    mock.restore();
  });

  test('parse builds Email with defaults and headers', async () => {
    const parser = new EmailParser();
    const email = await parser.parse(Buffer.from('raw'), { id: 'email-1', includeRaw: true, s3Key: 's3-key' });

    expect(email.id).toBe('email-1');
    expect(email.messageId).toBe('msg-1');
    expect(email.subject).toBe('(No Subject)');
    expect(email.from.address).toBe('sender@example.com');
    expect(email.to[0].address).toBe('to@example.com');
    expect(email.cc?.[0].address).toBe('cc@example.com');
    expect(email.attachments?.[0].contentId).toBe('cid-1');
    expect(email.headers['x-test']).toBe('value');
    expect(email.headers['x-json']).toBe('{"ok":true}');
    expect(email.raw).toBe('raw');
  });

  test('parse falls back to unknown addresses', async () => {
    parsedMail = {
      headers: new Map(),
      attachments: [],
    } as ParsedMail;

    const parser = new EmailParser();
    const email = await parser.parse(Buffer.from('raw'), { id: 'email-2' });

    expect(email.from.address).toBe('unknown@unknown.com');
    expect(email.to[0].address).toBe('unknown@unknown.com');
  });

  test('extractAttachment returns content or null', async () => {
    const parser = new EmailParser();
    const content = await parser.extractAttachment(Buffer.from('raw'), 0);
    expect(content).toEqual(Buffer.from('abc'));

    const missing = await parser.extractAttachment(Buffer.from('raw'), 2);
    expect(missing).toBeNull();
  });

  test('formatEmailAsMarkdown handles attachments and html-only content', () => {
    const markdown = formatEmailAsMarkdown({
      id: 'email-1',
      messageId: 'msg-1',
      from: { address: 'sender@example.com', name: 'Sender' },
      to: [{ address: 'to@example.com' }],
      subject: 'Subject',
      date: '2026-02-01T00:00:00Z',
      body: { html: '<p>hi</p>' },
      headers: {},
      attachments: [
        { filename: 'file.txt', contentType: 'text/plain', size: 3 },
      ],
    });

    expect(markdown).toContain('## Attachments');
    expect(markdown).toContain('file.txt');
    expect(markdown).toContain('HTML content available');
  });
});
