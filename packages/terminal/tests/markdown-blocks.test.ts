import { describe, expect, test } from 'bun:test';
import { __test__ } from '../src/components/Markdown';

const stripAnsi = (text: string) => text.replace(/\x1B\[[0-9;]*m/g, '');

describe('Markdown block rendering', () => {
  test('renders a block with header and content', () => {
    const markdown = `:::block type=info title="Tweet 3"\nLine one\nLine two\n:::`;
    const output = stripAnsi(__test__.parseMarkdown(markdown));
    expect(output).toContain('┌');
    expect(output).toContain('INFO · Tweet 3');
    expect(output).toContain('Line one');
    expect(output).not.toContain(':::block');
  });

  test('renders a card grid with multiple cards', () => {
    const markdown = `:::grid columns=2
:::card type=success title="A"
First
:::
:::card type=warning title="B"
Second
:::
:::`;
    const output = stripAnsi(__test__.parseMarkdown(markdown));
    expect(output).toContain('SUCCESS · A');
    expect(output).toContain('WARNING · B');
    const boxCount = (output.match(/┌/g) ?? []).length;
    expect(boxCount).toBeGreaterThanOrEqual(2);
  });

  test('supports indented blocks', () => {
    const markdown = `  :::block type=note title="Indented"\n  Line one\n  :::`;
    const output = stripAnsi(__test__.parseMarkdown(markdown));
    const firstLine = output.split('\n')[0] || '';
    expect(firstLine.startsWith('  ┌')).toBe(true);
  });

  test('warns on malformed blocks', () => {
    const markdown = `:::block type=info title="Oops"\nLine one`;
    const output = stripAnsi(__test__.parseMarkdown(markdown));
    expect(output).toContain('Malformed block');
  });

  test('warns on invalid grid columns', () => {
    const markdown = `:::grid columns=oops\n:::card type=note title="A"\nBody\n:::\n:::`;
    const output = stripAnsi(__test__.parseMarkdown(markdown));
    expect(output).toContain('Malformed block');
  });

  test('warns on malformed cards', () => {
    const markdown = `:::grid columns=2\n  :::card type=note title="A"\n  Body\n:::\n:::`;
    const output = stripAnsi(__test__.parseMarkdown(markdown));
    expect(output).toContain('Malformed card');
  });

  test('renders report blocks with legend and progress', () => {
    const markdown = `:::report
legend: Not Started | In Progress | Complete | Blocked
progress:
- HIGH PRIORITY: 40
- OVERALL: 13
table:
| # | Item | Priority | Progress | Status |
|---|------|----------|----------|--------|
| 1 | Prompt | High | 0% | Stub exists |
:::`; 
    const output = stripAnsi(__test__.parseMarkdown(markdown));
    expect(output).toContain('Legend');
    expect(output).toContain('Progress Overview');
    expect(output).toContain('Detailed Status Table');
    expect(output).toContain('HIGH PRIORITY');
  });

  test('renders tables with escaped pipes', () => {
    const markdown = `| Col A | Col B |
| --- | --- |
| a \\| b | c |`;
    const output = stripAnsi(__test__.parseMarkdown(markdown));
    expect(output).toContain('a | b');
  });

  test('preserves inline code with underscores', () => {
    const markdown = 'Use `foo_bar` here';
    const output = stripAnsi(__test__.parseMarkdown(markdown));
    expect(output).toContain('foo_bar');
    expect(output).not.toContain('foo bar');
  });

  test('does not italicize underscores inside words', () => {
    const markdown = 'file_name_test';
    const output = stripAnsi(__test__.parseMarkdown(markdown));
    expect(output).toContain('file_name_test');
  });
});
