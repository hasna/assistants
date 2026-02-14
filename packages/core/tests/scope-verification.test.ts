import { describe, expect, test } from 'bun:test';
import { withTempDir } from './fixtures/helpers';
import { MockLLMClient } from './fixtures/mock-llm';
import type { HookInput, ScopeContext } from '@hasna/assistants-shared';
import { scopeVerificationHandler } from '../src/hooks/scope-verification';

const baseInput: HookInput = {
  session_id: 'session-1',
  hook_event_name: 'Stop',
  cwd: '/tmp',
};

const baseScope: ScopeContext = {
  originalMessage: 'Do the thing',
  extractedGoals: ['Do the thing'],
  timestamp: Date.now(),
  verificationAttempts: 0,
  maxAttempts: 1,
};

describe('scopeVerificationHandler', () => {
  test('returns null when disabled', async () => {
    const llm = new MockLLMClient();
    llm.queueResponse({ content: 'irrelevant' });

    const result = await scopeVerificationHandler(baseInput, {
      sessionId: 'session-1',
      cwd: '/tmp',
      messages: [],
      scopeContext: baseScope,
      llmClient: llm,
      config: { scopeVerification: { enabled: false } },
    });

    expect(result).toBeNull();
  });

  test('blocks when goals not met', async () => {
    await withTempDir(async (dir) => {
      const llm = new MockLLMClient();
      llm.queueResponse({
        content: JSON.stringify({
          goalsMet: false,
          goalsAnalysis: [{ goal: 'Do the thing', met: false, evidence: 'missing' }],
          reason: 'Not done',
          suggestions: ['Finish it'],
        }),
      });

      const originalDir = process.env.ASSISTANTS_DIR;
      process.env.ASSISTANTS_DIR = dir;

      const result = await scopeVerificationHandler(baseInput, {
        sessionId: 'session-1',
        cwd: dir,
        messages: [],
        scopeContext: baseScope,
        llmClient: llm,
        config: {},
      });

      process.env.ASSISTANTS_DIR = originalDir;

      expect(result?.continue).toBe(false);
      expect(result?.systemMessage).toContain('Scope Verification');
    });
  });

  test('returns null when verification parsing fails', async () => {
    const llm = new MockLLMClient();
    llm.queueResponse({ content: 'not json' });

    const result = await scopeVerificationHandler(baseInput, {
      sessionId: 'session-1',
      cwd: '/tmp',
      messages: [],
      scopeContext: baseScope,
      llmClient: llm,
      config: {},
    });

    expect(result).toBeNull();
  });
});
