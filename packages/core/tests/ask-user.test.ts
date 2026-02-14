import { describe, expect, test } from 'bun:test';
import { createAskUserTool } from '../src/tools/ask-user';

describe('ask_user tool', () => {
  test('rejects when no handler is available', async () => {
    const { executor } = createAskUserTool(() => null);
    await expect(executor({ questions: [{ id: 'q1', question: 'Hi?' }] })).rejects.toThrow('not available');
  });

  test('requires at least one question', async () => {
    const { executor } = createAskUserTool(() => async () => ({ answers: {} }));
    await expect(executor({ questions: [] })).rejects.toThrow('at least one question');
  });

  test('enforces max question count', async () => {
    const { executor } = createAskUserTool(() => async () => ({ answers: {} }));
    const questions = Array.from({ length: 7 }, (_, i) => ({ id: `q${i}`, question: 'Test' }));
    await expect(executor({ questions })).rejects.toThrow('up to 6 questions');
  });

  test('requires id and question fields', async () => {
    const { executor } = createAskUserTool(() => async () => ({ answers: {} }));
    await expect(executor({ questions: [{ id: '', question: '' }] })).rejects.toThrow('must include id and question');
  });

  test('returns serialized answers from handler', async () => {
    const { executor } = createAskUserTool(() => async () => ({
      answers: { project_scope: 'project' },
    }));
    const result = await executor({
      title: 'Scope',
      questions: [{ id: 'project_scope', question: 'Project or global?' }],
    });
    expect(result).toContain('project_scope');
    expect(result).toContain('project');
  });
});
