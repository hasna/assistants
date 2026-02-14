import { describe, expect, test } from 'bun:test';
import { marked } from 'marked';

// We test the marked configuration used by Markdown component
// Direct component testing with Ink requires additional setup

describe('Markdown rendering', () => {
  test('should parse basic markdown', () => {
    const result = marked.parse('# Hello\n\nWorld', { async: false }) as string;
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  test('should handle code blocks', () => {
    const markdown = '```js\nconsole.log("hello");\n```';
    const result = marked.parse(markdown, { async: false }) as string;
    expect(result).toContain('console.log');
  });

  test('should handle inline code', () => {
    const markdown = 'Use `npm install` to install';
    const result = marked.parse(markdown, { async: false }) as string;
    expect(result).toContain('npm install');
  });

  test('should handle lists', () => {
    const markdown = '- Item 1\n- Item 2\n- Item 3';
    const result = marked.parse(markdown, { async: false }) as string;
    expect(result).toContain('Item 1');
    expect(result).toContain('Item 2');
  });

  test('should handle links', () => {
    const markdown = '[Click here](https://example.com)';
    const result = marked.parse(markdown, { async: false }) as string;
    expect(result).toContain('Click here');
    expect(result).toContain('example.com');
  });

  test('should handle bold text', () => {
    const markdown = 'This is **bold** text';
    const result = marked.parse(markdown, { async: false }) as string;
    expect(result).toContain('bold');
  });

  test('should handle italic text', () => {
    const markdown = 'This is *italic* text';
    const result = marked.parse(markdown, { async: false }) as string;
    expect(result).toContain('italic');
  });

  test('should handle empty content', () => {
    const result = marked.parse('', { async: false }) as string;
    expect(result).toBe('');
  });

  test('should handle multiline content', () => {
    const markdown = `# Title

Paragraph 1

Paragraph 2

## Subtitle

More content`;
    const result = marked.parse(markdown, { async: false }) as string;
    expect(result).toContain('Title');
    expect(result).toContain('Paragraph');
    expect(result).toContain('Subtitle');
  });
});
