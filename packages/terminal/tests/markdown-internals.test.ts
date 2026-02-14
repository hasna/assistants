import { describe, expect, test } from 'bun:test';
import { __test__ } from '../src/components/Markdown';

describe('markdown internals', () => {
  test('parseDelimitedBlock detects missing closing and indent mismatch', () => {
    const lines = ['  :::block', '  body', ':::'];
    const parsed = __test__.parseDelimitedBlock(lines, 0, '  ');
    expect(parsed?.warning).toContain('indentation');

    const missing = __test__.parseDelimitedBlock([':::block', 'body'], 0, '');
    expect(missing).toBeNull();
  });

  test('extractBlockSections handles malformed grid, report, and orphan card', () => {
    const blocks: any[] = [];
    const output = __test__.extractBlockSections(
      ':::grid\nbody\n\n:::report\nLegend: Custom\n\n:::card type=info\nBody\n:::',
      blocks
    );
    expect(output).toContain('@@BLOCKSECTION');
    expect(blocks.length).toBeGreaterThan(0);
  });

  test('extractBlockSections records indentation warnings', () => {
    const blocks: any[] = [];
    __test__.extractBlockSections(
      '  :::grid columns=2\n  :::card type=note\n  Body\n  :::\n:::\n  :::block type=note\n  Body\n:::\n  :::report\n  Legend: Custom\n:::\n',
      blocks
    );
    expect(blocks.some((block: any) => block.title === 'Malformed block')).toBe(true);
  });

  test('extractCards handles unknown types, missing closing, and indent warnings', () => {
    const unknown = __test__.extractCards(':::card type=weird title="X"\nBody\n:::');
    expect(unknown[0]?.title).toBe('Malformed card');

    const missing = __test__.extractCards(':::card type=note\nBody');
    expect(missing[0]?.body).toContain('Missing closing');

    const indentWarn = __test__.extractCards('  :::card type=note\n  Body\n:::');
    expect(indentWarn.some((card: any) => card.body?.includes('indentation'))).toBe(true);
  });

  test('renderCardGrid adapts columns and pads rows', () => {
    const cards = [
      { type: 'note', title: 'Short', body: 'One' },
      { type: 'note', title: 'Tall', body: 'Line 1\nLine 2\nLine 3' },
      { type: 'note', title: 'Mid', body: 'Two lines\nhere' },
    ];
    const output = __test__.renderCardGrid(cards, 4, 30, '');
    expect(output).toContain('Short');
  });

  test('formatMarkdownTables shrinks wide columns', () => {
    const table = [
      '| Name | Description |',
      '| --- | --- |',
      '| Alpha | Very long description that should shrink |',
    ].join('\n');
    const output = __test__.formatMarkdownTables(table, 20);
    expect(output).toContain('Name');
    expect(output).toContain('Descr');
  });

  test('renderReport renders legend and progress with custom labels', () => {
    const report = [
      'Legend: Not Started | Custom',
      'Progress:',
      '- Alpha: 40%',
      'Table:',
      '| Item | Priority | Progress | Status |',
      '| --- | --- | --- | --- |',
      '| Thing | Medium | 50% | Waiting |',
    ].join('\n');
    const output = __test__.renderReport(report, 40, '');
    expect(output).toContain('Legend');
    expect(output).toContain('Progress Overview');
  });

  test('wrapAnsiLine and truncateAnsi handle ansi sequences', () => {
    const line = '\x1b[31mRED\x1b[0m';
    const wrapped = __test__.wrapAnsiLine(line, 2);
    expect(wrapped.length).toBeGreaterThan(0);

    const tiny = __test__.truncateAnsi(line, 2);
    expect(tiny).toContain('\x1b[0m');

    const truncated = __test__.truncateAnsi(line + 'LONG', 5);
    expect(truncated).toContain('...');
  });

  test('wrapRenderedMarkdown wraps long plain lines and preserves box lines', () => {
    const plain = 'assistants is a terminal-first AI environment for connecting tools and collaborating.';
    const wrappedPlain = __test__.wrapRenderedMarkdown(plain, 24);
    expect(wrappedPlain.split('\n').length).toBeGreaterThan(1);

    const boxed = '┌────┐\n│ hi │\n└────┘';
    const wrappedBoxed = __test__.wrapRenderedMarkdown(boxed, 3);
    expect(wrappedBoxed).toContain('┌────┐');
    expect(wrappedBoxed).toContain('│ hi │');
    expect(wrappedBoxed).toContain('└────┘');
  });

  test('helper functions render expected outputs', () => {
    const blocks: any[] = [];
    const placeholder = __test__.createMalformedBlock(blocks, '', 'block', 'Oops');
    expect(placeholder).toContain('@@BLOCKSECTION');
    expect(blocks.length).toBe(1);

    const header = __test__.formatBlockHeader('error', 'Boom');
    expect(header).toContain('ERROR');
    expect(__test__.getBlockIcon('command')).toBe('❯');

    const box = __test__.renderBox('Header', ['line'], 'note', 20, '', true);
    expect(box).toContain('Header');
    const lines = __test__.renderBoxLines('Header', ['line'], 'note', 20, '', true);
    expect(lines.length).toBeGreaterThan(0);
    expect(__test__.formatBoxRow('row', 5)).toContain('row');

    expect(__test__.parseTableRow('| a | b |')).toEqual(['a', 'b']);
    const table = __test__.renderTable(['a', 'b'], [['1', '2']], 20);
    expect(table.join('\n')).toContain('a');

    const reportTable = __test__.renderReportTable(
      ['| a | priority | progress | status |', '| - | - | - | - |', '| row | high | 50% | progress |'],
      '',
      40
    );
    expect(reportTable.join('\n')).toContain('row');

    expect(__test__.decoratePriority('high')).toContain('High');
    expect(__test__.decorateProgress('50%')).toContain('50');
    expect(__test__.decorateStatus('progress')).not.toBe('');

    const wrappedLines = __test__.wrapAnsiLines(['line'], 2);
    expect(wrappedLines.length).toBeGreaterThan(0);
    expect(__test__.stripAnsi('\x1b[31mred\x1b[0m')).toBe('red');
  });
});
