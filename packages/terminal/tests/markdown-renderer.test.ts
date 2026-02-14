import React from 'react';
import { describe, expect, test } from 'bun:test';
import { render } from 'ink';
import { Markdown, renderMarkdown } from '../src/components/Markdown';

describe('terminal Markdown renderer', () => {
  test('Markdown component returns pre-rendered content without hooks', () => {
    const element = Markdown({ content: 'hello', preRendered: true } as any) as any;
    expect(element?.props?.children).toBe('hello');
  });

  test('Markdown component renders with stdout width', () => {
    const instance = render(React.createElement(Markdown, { content: 'hello' }));
    instance.unmount();
  });

  test('renderMarkdown handles blocks, grids, reports, tables, and statuses', () => {
    const content = `
# Header

Status: Running Success Error

* bullet
1. ordered
[Link](https://example.com)

:::block type=note title="Note"
This is a very long line that should wrap across the box width to test wrapping behavior.
:::

:::block type=unknown title="Mystery"
Unknown type block should fall back to info.
:::

:::grid columns=3
:::card type=info title="Card 1"
Card one content.
:::
:::card type=warning title="Card 2"
Card two content.
:::
:::

| Name | Value |
| --- | --- |
| Alpha | 1 |
| Beta | 2 |

:::report
Legend: Not Started | In Progress | Complete | Blocked | Custom
Progress:
- HIGH PRIORITY: 40%
- OVERALL: 13%
Table:
| # | Item | Priority | Progress | Status |
| - | - | - | - | - |
| 1 | Prompt | High | 0% | Blocked |
| 2 | Input | Low | 100% | Complete |
| 3 | Steps | Medium | 50% | In Progress |
| 4 | Extra | Unknown | 12% | Waiting |
:::
`;

    const output = renderMarkdown(content, { maxWidth: 50 });
    expect(output).toContain('Header');
    expect(output).toContain('Note');
    expect(output).toContain('Card 1');
    expect(output).toContain('Progress Overview');
    expect(output).toContain('Detailed Status Table');
    expect(output).toContain('Alpha');
  });

  test('renderMarkdown handles malformed blocks, wrapping, and tables', () => {
    const codeOutput = renderMarkdown('```js\nconsole.log("x");\n```\nInline `code`', { maxWidth: 20 });
    expect(codeOutput).toContain('console.log');
    expect(codeOutput).toContain('code');

    const longBlock = renderMarkdown(
      ':::block type=error title="Failure"\n**Bold** ' + 'x'.repeat(80) + '\n:::\n:::block type=command title="Run"\ncmd\n:::\n',
      { maxWidth: 20 }
    );
    expect(longBlock).toContain('ERROR');
    expect(longBlock).toContain('COMMAND');

    const tinyOutput = renderMarkdown(':::block type=note title="TinyTitle"\nLine\n:::\n', { maxWidth: 6 });
    expect(tinyOutput).toContain('Tiny');

    const malformedGrid = renderMarkdown(':::grid columns=bad\n:::card type=info title="One"\nBody\n:::\n', { maxWidth: 40 });
    expect(malformedGrid).toContain('Malformed block');

    const orphanCard = renderMarkdown(':::card type=info title="Orphan"\nBody\n:::\n', { maxWidth: 40 });
    expect(orphanCard).toContain('Card blocks must be inside');

    const gridNoCards = renderMarkdown(':::grid columns=2\nJust text\n:::\n', { maxWidth: 30 });
    expect(gridNoCards).toContain('Grid');

    const gridSmall = renderMarkdown(
      ':::grid columns=4\n:::card type=note title="Short"\nOne\n:::\n:::card type=note title="Tall"\nLine 1\nLine 2\nLine 3\n:::\n:::\n',
      { maxWidth: 30 }
    );
    expect(gridSmall).toContain('Short');

    const indentMismatch = renderMarkdown('  :::block type=note title="Indented"\n  Body\n:::\n', { maxWidth: 40 });
    expect(indentMismatch).toContain('Malformed block');

    const reportMissingClose = renderMarkdown(':::report\nLegend: Custom\nProgress:\n- Custom: 10%\n', { maxWidth: 40 });
    expect(reportMissingClose).toContain('Malformed block');

    const tableOutput = renderMarkdown(
      '| Name | Description |\n| --- | --- |\n| Alpha | ' + 'Very long description text here' + ' |\n',
      { maxWidth: 20 }
    );
    expect(tableOutput).toContain('Name');
  });
});
