import { describe, expect, test } from 'bun:test';
import { AnthropicClient } from '../src/llm/anthropic';
import { OpenAIClient } from '../src/llm/openai';
import type { Message, LLMConfig, DocumentAttachment } from '@hasna/assistants-shared';

const anthropicConfig: LLMConfig = {
  provider: 'anthropic',
  model: 'claude-3-haiku-20240307',
  apiKey: 'test-api-key',
  maxTokens: 4096,
};

const openaiConfig: LLMConfig = {
  provider: 'openai',
  model: 'gpt-4o',
  apiKey: 'test-api-key',
  maxTokens: 4096,
};

describe('AnthropicClient image handling', () => {
  const createClient = () => new AnthropicClient(anthropicConfig);

  test('convertImageToBlock produces correct base64 image block', () => {
    const client = createClient();
    const doc: DocumentAttachment = {
      type: 'image',
      source: { type: 'base64', mediaType: 'image/png', data: 'iVBORw0KGgo=' },
      name: 'test.png',
      mediaType: 'image/png',
    };

    const block = (client as any).convertImageToBlock(doc);
    expect(block).not.toBeNull();
    expect(block.type).toBe('image');
    expect(block.source.type).toBe('base64');
    expect(block.source.media_type).toBe('image/png');
    expect(block.source.data).toBe('iVBORw0KGgo=');
  });

  test('convertImageToBlock handles JPEG media type', () => {
    const client = createClient();
    const doc: DocumentAttachment = {
      type: 'image',
      source: { type: 'base64', mediaType: 'image/jpeg', data: '/9j/4AAQ' },
      name: 'photo.jpg',
      mediaType: 'image/jpeg',
    };

    const block = (client as any).convertImageToBlock(doc);
    expect(block.source.media_type).toBe('image/jpeg');
  });

  test('convertImageToBlock handles URL source', () => {
    const client = createClient();
    const doc: DocumentAttachment = {
      type: 'image',
      source: { type: 'url', url: 'https://example.com/image.png' },
      name: 'remote.png',
      mediaType: 'image/png',
    };

    const block = (client as any).convertImageToBlock(doc);
    expect(block).not.toBeNull();
    expect(block.type).toBe('image');
    expect(block.source.type).toBe('url');
    expect(block.source.url).toBe('https://example.com/image.png');
  });

  test('convertMessages includes image blocks in user messages', () => {
    const client = createClient();
    const messages: Message[] = [
      {
        id: '1',
        role: 'assistant',
        content: 'Let me read that file.',
        timestamp: Date.now(),
        toolCalls: [{ id: 'tc1', name: 'read', input: { path: 'image.png' } }],
      },
      {
        id: '2',
        role: 'user',
        content: '',
        timestamp: Date.now(),
        toolResults: [
          { toolCallId: 'tc1', content: 'Image loaded: image.png (1.2 KB)' },
        ],
        documents: [
          {
            type: 'image',
            source: { type: 'base64', mediaType: 'image/png', data: 'iVBORw0KGgo=' },
            name: 'image.png',
            mediaType: 'image/png',
          },
        ],
      },
    ];

    const converted = (client as any).convertMessages(messages);
    expect(converted).toHaveLength(2);

    // The user message should contain the image block + tool_result
    const userMsg = converted[1];
    expect(userMsg.role).toBe('user');

    const imageBlocks = userMsg.content.filter((b: any) => b.type === 'image');
    expect(imageBlocks.length).toBe(1);
    expect(imageBlocks[0].source.type).toBe('base64');
    expect(imageBlocks[0].source.media_type).toBe('image/png');
  });

  test('convertMessages handles mixed PDF and image documents', () => {
    const client = createClient();
    const messages: Message[] = [
      {
        id: '1',
        role: 'user',
        content: 'Analyze these files',
        timestamp: Date.now(),
        documents: [
          {
            type: 'pdf',
            source: { type: 'base64', mediaType: 'application/pdf', data: 'JVBERi0=' },
            name: 'doc.pdf',
          },
          {
            type: 'image',
            source: { type: 'base64', mediaType: 'image/jpeg', data: '/9j/4AAQ' },
            name: 'chart.jpg',
            mediaType: 'image/jpeg',
          },
        ],
      },
    ];

    const converted = (client as any).convertMessages(messages);
    expect(converted).toHaveLength(1);

    const content = converted[0].content;
    const docBlocks = content.filter((b: any) => b.type === 'document');
    const imageBlocks = content.filter((b: any) => b.type === 'image');
    const textBlocks = content.filter((b: any) => b.type === 'text');

    expect(docBlocks.length).toBe(1);
    expect(imageBlocks.length).toBe(1);
    expect(textBlocks.length).toBe(1);
    expect(textBlocks[0].text).toBe('Analyze these files');
  });
});

describe('OpenAIClient image handling', () => {
  const createClient = () => new OpenAIClient(openaiConfig);

  test('convertImageToPart produces correct base64 data URI', () => {
    const client = createClient();
    const doc: DocumentAttachment = {
      type: 'image',
      source: { type: 'base64', mediaType: 'image/png', data: 'iVBORw0KGgo=' },
      name: 'test.png',
      mediaType: 'image/png',
    };

    const part = (client as any).convertImageToPart(doc);
    expect(part).not.toBeNull();
    expect(part.type).toBe('image_url');
    expect(part.image_url.url).toBe('data:image/png;base64,iVBORw0KGgo=');
  });

  test('convertImageToPart handles JPEG', () => {
    const client = createClient();
    const doc: DocumentAttachment = {
      type: 'image',
      source: { type: 'base64', mediaType: 'image/jpeg', data: '/9j/4AAQ' },
      name: 'photo.jpg',
      mediaType: 'image/jpeg',
    };

    const part = (client as any).convertImageToPart(doc);
    expect(part.image_url.url).toStartWith('data:image/jpeg;base64,');
  });

  test('convertImageToPart handles URL source', () => {
    const client = createClient();
    const doc: DocumentAttachment = {
      type: 'image',
      source: { type: 'url', url: 'https://example.com/image.png' },
      name: 'remote.png',
      mediaType: 'image/png',
    };

    const part = (client as any).convertImageToPart(doc);
    expect(part).not.toBeNull();
    expect(part.type).toBe('image_url');
    expect(part.image_url.url).toBe('https://example.com/image.png');
  });

  test('convertMessages includes image in user message with tool results', () => {
    const client = createClient();
    const messages: Message[] = [
      {
        id: '1',
        role: 'assistant',
        content: 'Reading the image.',
        timestamp: Date.now(),
        toolCalls: [{ id: 'tc1', name: 'read', input: { path: 'photo.png' } }],
      },
      {
        id: '2',
        role: 'user',
        content: '',
        timestamp: Date.now(),
        toolResults: [
          { toolCallId: 'tc1', content: 'Image loaded: photo.png (5.2 KB)' },
        ],
        documents: [
          {
            type: 'image',
            source: { type: 'base64', mediaType: 'image/png', data: 'iVBORw0KGgo=' },
            name: 'photo.png',
            mediaType: 'image/png',
          },
        ],
      },
    ];

    const converted = (client as any).convertMessages(messages, undefined);

    // Should have: system, assistant, tool result, user with image
    // Find the user message with image_url
    const imageMessages = converted.filter(
      (m: any) => m.role === 'user' && Array.isArray(m.content) && m.content.some((c: any) => c.type === 'image_url')
    );
    expect(imageMessages.length).toBe(1);

    const imageParts = imageMessages[0].content.filter((c: any) => c.type === 'image_url');
    expect(imageParts.length).toBe(1);
    expect(imageParts[0].image_url.url).toStartWith('data:image/png;base64,');
  });

  test('convertMessages includes image in regular user messages', () => {
    const client = createClient();
    const messages: Message[] = [
      {
        id: '1',
        role: 'user',
        content: 'What is in this image?',
        timestamp: Date.now(),
        documents: [
          {
            type: 'image',
            source: { type: 'base64', mediaType: 'image/jpeg', data: '/9j/4AAQ' },
            name: 'photo.jpg',
            mediaType: 'image/jpeg',
          },
        ],
      },
    ];

    const converted = (client as any).convertMessages(messages, undefined);

    // Find the user message (not system)
    const userMessages = converted.filter((m: any) => m.role === 'user');
    expect(userMessages.length).toBe(1);

    // Should be multipart content
    expect(Array.isArray(userMessages[0].content)).toBe(true);
    const imageParts = userMessages[0].content.filter((c: any) => c.type === 'image_url');
    const textParts = userMessages[0].content.filter((c: any) => c.type === 'text');
    expect(imageParts.length).toBe(1);
    expect(textParts.length).toBe(1);
    expect(textParts[0].text).toBe('What is in this image?');
  });

  test('convertMessages handles PDF documents with text fallback', () => {
    const client = createClient();
    const messages: Message[] = [
      {
        id: '1',
        role: 'assistant',
        content: 'Reading the PDF.',
        timestamp: Date.now(),
        toolCalls: [{ id: 'tc1', name: 'read', input: { path: 'doc.pdf' } }],
      },
      {
        id: '2',
        role: 'user',
        content: '',
        timestamp: Date.now(),
        toolResults: [
          { toolCallId: 'tc1', content: 'PDF loaded: doc.pdf (100 KB)' },
        ],
        documents: [
          {
            type: 'pdf',
            source: { type: 'base64', mediaType: 'application/pdf', data: 'JVBERi0=' },
            name: 'doc.pdf',
          },
        ],
      },
    ];

    const converted = (client as any).convertMessages(messages, undefined);

    // Should have a user message mentioning PDF
    const userMessages = converted.filter(
      (m: any) => m.role === 'user' && Array.isArray(m.content) && m.content.some((c: any) => c.type === 'text' && c.text.includes('PDF'))
    );
    expect(userMessages.length).toBe(1);
  });
});
