import { describe, expect, test } from 'bun:test';
import { ChannelAgentPool } from '../src/channels/agent-pool';
import type { ChannelMember } from '../src/channels/types';

describe('ChannelAgentPool', () => {
  test('queues overlapping triggerResponses calls instead of dropping them', async () => {
    const calls: Array<{ id: string; prompt: string }> = [];
    const factory = async (assistantId: string) => {
      return {
        send: async (prompt: string) => {
          calls.push({ id: assistantId, prompt });
        },
        disconnect: () => {},
      } as any;
    };

    const pool = new ChannelAgentPool('/tmp', undefined, { clientFactory: factory });

    const members: ChannelMember[] = [
      {
        channelId: 'ch_test',
        assistantId: 'assistant-1',
        assistantName: 'Alpha',
        role: 'member',
        joinedAt: new Date().toISOString(),
        lastReadAt: null,
        memberType: 'assistant',
      },
    ];

    await Promise.all([
      pool.triggerResponses('general', 'User', 'First message', members),
      pool.triggerResponses('general', 'User', 'Second message', members),
    ]);

    expect(calls.length).toBe(2);
    const prompts = calls.map((c) => c.prompt);
    expect(prompts.some((p) => p.includes('First message'))).toBe(true);
    expect(prompts.some((p) => p.includes('Second message'))).toBe(true);
  });
});
