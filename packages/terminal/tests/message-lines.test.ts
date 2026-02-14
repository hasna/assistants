import { describe, expect, test } from 'bun:test';
import type { Message } from '@hasna/assistants-shared';
import { __test__, estimateGroupedToolMessagesLines, groupConsecutiveToolMessages } from '../src/components/messageLines';

describe('message line estimation', () => {
  test('wraps long lines by width', () => {
    const msg: Message = {
      id: 'msg-1',
      role: 'assistant',
      content: '1234567890',
      timestamp: 0,
    };
    expect(__test__.estimateMessageLines(msg, 5)).toBe(6);
  });

  test('returns zero lines for system messages', () => {
    const msg: Message = {
      id: 'sys-1',
      role: 'system',
      content: 'hidden',
      timestamp: 0,
    };
    expect(__test__.estimateMessageLines(msg, 80)).toBe(0);
  });

  test('ignores ANSI codes when wrapping', () => {
    const msg: Message = {
      id: 'msg-2',
      role: 'assistant',
      content: '\u001b[31m123456\u001b[0m',
      timestamp: 0,
    };
    expect(__test__.estimateMessageLines(msg, 3)).toBe(8);
  });

  test('counts multi-line tool results', () => {
    const msg: Message = {
      id: 'msg-3',
      role: 'assistant',
      content: '',
      timestamp: 0,
      toolCalls: [
        { id: 'tool-1', name: 'bash', input: {}, type: 'tool' },
      ],
      toolResults: [
        {
          toolCallId: 'tool-1',
          toolName: 'bash',
          content: ['1', '2', '3', '4', '5', '6'].join('\n'),
          isError: false,
        },
      ],
    };
    expect(__test__.estimateMessageLines(msg)).toBe(9);
  });

  test('skips margin for continuation chunks', () => {
    const msg: Message = {
      id: 'msg-4::chunk-1',
      role: 'assistant',
      content: 'hello',
      timestamp: 0,
    };
    expect(__test__.estimateMessageLines(msg)).toBe(1);
  });

  test('counts activity entry lines with margin', () => {
    const entry = {
      type: 'text' as const,
      content: 'hello\nworld',
    };
    expect(__test__.estimateActivityEntryLines(entry, 80, 80)).toBe(4);
  });

  test('counts tool call and tool result activity entries', () => {
    const toolCall = { type: 'tool_call' as const };
    expect(__test__.estimateActivityEntryLines(toolCall, 80, 80)).toBe(4);

    const toolResult = {
      type: 'tool_result' as const,
      toolResult: { toolCallId: 'tool-1', toolName: 'bash', content: 'ok', isError: false },
    };
    expect(__test__.estimateActivityEntryLines(toolResult, 10, 10)).toBe(3);

    const emptyResult = {
      type: 'tool_result' as const,
    };
    expect(__test__.estimateActivityEntryLines(emptyResult, 10, 10)).toBe(3);

    const unknown = { type: 'unknown' } as any;
    expect(__test__.estimateActivityEntryLines(unknown, 10, 10)).toBe(0);
  });

  test('sums activity log lines', () => {
    const entries = [
      { type: 'text' as const, content: 'hello' },
      { type: 'tool_call' as const },
    ];
    expect(__test__.estimateActivityLogLines(entries, 20, 20)).toBe(7);
  });

  test('groups consecutive tool-only assistant messages', () => {
    const messages = [
      { id: 'a', role: 'assistant', content: '', timestamp: 0, toolCalls: [{ id: 't1', name: 'read', input: {}, type: 'tool' }] },
      { id: 'b', role: 'assistant', content: '', timestamp: 0, toolCalls: [{ id: 't2', name: 'read', input: {}, type: 'tool' }] },
      { id: 'c', role: 'assistant', content: 'text', timestamp: 0 },
      { id: 'd', role: 'assistant', content: '', timestamp: 0, toolCalls: [{ id: 't3', name: 'bash', input: {}, type: 'tool' }] },
    ];
    const groups = groupConsecutiveToolMessages(messages as any);
    expect(groups.length).toBe(3);
    expect(groups[0].type).toBe('grouped');
    expect(groups[1].type).toBe('single');
    expect(groups[2].type).toBe('single');
  });

  test('groups single tool-only assistant message as single', () => {
    const messages = [
      { id: 'a', role: 'assistant', content: '', timestamp: 0, toolCalls: [{ id: 't1', name: 'read', input: {}, type: 'tool' }] },
      { id: 'b', role: 'assistant', content: 'text', timestamp: 0 },
    ];
    const groups = groupConsecutiveToolMessages(messages as any);
    expect(groups[0].type).toBe('single');
  });

  test('estimates grouped tool messages with results', () => {
    const grouped = [
      {
        id: 'a',
        role: 'assistant',
        content: '',
        timestamp: 0,
        toolCalls: [{ id: 'tool-1', name: 'bash', input: {}, type: 'tool' }],
        toolResults: [{ toolCallId: 'tool-1', toolName: 'bash', content: 'ok', isError: false }],
      },
      {
        id: 'b',
        role: 'assistant',
        content: '',
        timestamp: 0,
        toolCalls: [{ id: 'tool-2', name: 'read', input: {}, type: 'tool' }],
      },
    ];
    expect(estimateGroupedToolMessagesLines(grouped as any, 40)).toBeGreaterThan(0);
  });

  test('estimates tool panel and result line counts directly', () => {
    expect(__test__.estimateToolPanelLines([], [], false, 80)).toBe(0);
    const toolCalls = [{ id: 'tool-1', name: 'bash', input: {}, type: 'tool' }];
    const toolResults = [{ toolCallId: 'tool-1', toolName: 'bash', content: '', isError: false }];
    const panelLines = __test__.estimateToolPanelLines(toolCalls as any, toolResults as any, true, 40);
    expect(panelLines).toBeGreaterThan(0);

    const resultLines = __test__.estimateToolResultLines(toolResults[0] as any, 10, 2);
    expect(resultLines).toBeGreaterThan(0);
  });

  test('estimates tool result-only panels for user messages', () => {
    const msg: Message = {
      id: 'user-1',
      role: 'user',
      content: 'tool output',
      timestamp: 0,
      toolResults: [{ toolCallId: 'tool-1', toolName: 'bash', content: 'ok', isError: false }],
    };
    expect(__test__.estimateMessageLines(msg, 80)).toBeGreaterThan(0);
  });

  test('trims display messages by line budget', () => {
    const messages = [
      { id: 'a', role: 'assistant', content: 'one', timestamp: 0, __lineCount: 1 },
      { id: 'b', role: 'assistant', content: 'two', timestamp: 0, __lineCount: 1 },
      { id: 'c', role: 'assistant', content: 'three', timestamp: 0, __lineCount: 1 },
    ];
    const result = __test__.trimDisplayMessagesByLines(messages as any, 6, 80);
    expect(result.trimmed).toBe(true);
    expect(result.messages.map((msg: any) => msg.id)).toEqual(['b', 'c']);
  });

  test('trims to empty when maxLines is zero', () => {
    const messages = [
      { id: 'a', role: 'assistant', content: 'one', timestamp: 0, __lineCount: 1 },
    ];
    const result = __test__.trimDisplayMessagesByLines(messages as any, 0, 80);
    expect(result.messages.length).toBe(0);
    expect(result.trimmed).toBe(true);
  });

  test('trims activity log entries by line budget', () => {
    const entries = [
      { type: 'text' as const, content: 'one' },
      { type: 'text' as const, content: 'two' },
      { type: 'text' as const, content: 'three' },
    ];
    const result = __test__.trimActivityLogByLines(entries as any, 80, 80, 4);
    expect(result.trimmed).toBe(true);
    expect(result.entries.length).toBe(1);
  });
});
