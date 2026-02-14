/**
 * ChannelAgentPool - manages per-assistant EmbeddedClient instances
 * for multi-agent channel responses.
 *
 * Uses sequential round-based turn-taking to prevent SQLite write lock
 * contention and infinite agent-to-agent cascading. Each round executes
 * agents one at a time in random order with stagger delays.
 */

import { EmbeddedClient } from '../client';
import { parseMentions, resolveNameToKnown } from './mentions';
import type { ChannelsManager } from './manager';
import type { ChannelMember } from './types';

export class ChannelAgentPool {
  private agents: Map<string, EmbeddedClient> = new Map();
  private cwd: string;
  private getChannelsManager: (() => ChannelsManager | null) | undefined;
  private clientFactory?: (assistantId: string, cwd: string) => Promise<EmbeddedClient>;
  private draining = false;
  private queue: Array<{
    channelName: string;
    personName: string;
    message: string;
    channelMembers: ChannelMember[];
    excludeAssistantId?: string;
    resolve: () => void;
    reject: (error: Error) => void;
  }> = [];
  private maxRounds = 1;

  constructor(
    cwd: string,
    getChannelsManager?: () => ChannelsManager | null,
    options?: { clientFactory?: (assistantId: string, cwd: string) => Promise<EmbeddedClient> }
  ) {
    this.cwd = cwd;
    this.getChannelsManager = getChannelsManager;
    this.clientFactory = options?.clientFactory;
  }

  /**
   * Trigger all (or mentioned) assistant members of a channel to respond to a message.
   * Uses sequential round-based execution to prevent deadlocks and cascading loops.
   *
   * Round 1: All target agents respond to the person's message, one at a time.
   * Rounds 2..N: Agents with unread messages from other agents respond sequentially.
   */
  async triggerResponses(
    channelName: string,
    personName: string,
    message: string,
    channelMembers: ChannelMember[],
    excludeAssistantId?: string,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.queue.push({ channelName, personName, message, channelMembers, excludeAssistantId, resolve, reject });
      this.drainQueue();
    });
  }

  private async drainQueue(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length > 0) {
        const job = this.queue.shift();
        if (!job) continue;
        try {
          await this.runJob(job);
          job.resolve();
        } catch (error) {
          job.reject(error instanceof Error ? error : new Error(String(error)));
        }
      }
    } finally {
      this.draining = false;
    }
  }

  private async runJob(job: {
    channelName: string;
    personName: string;
    message: string;
    channelMembers: ChannelMember[];
    excludeAssistantId?: string;
    resolve: () => void;
    reject: (error: Error) => void;
  }): Promise<void> {
    const { channelName, personName, message, channelMembers, excludeAssistantId } = job;
    // Filter to assistant-type members only
    const assistantMembers = channelMembers.filter(
      (m) => m.memberType === 'assistant'
    );

    if (assistantMembers.length === 0) return;

    // Determine which assistants to trigger based on @mentions
    let targetMembers = assistantMembers;
    const mentions = parseMentions(message);
    if (mentions.length > 0) {
      const knownNames = assistantMembers.map((m) => ({
        id: m.assistantId,
        name: m.assistantName,
      }));
      const resolved = mentions
        .map((m) => resolveNameToKnown(m, knownNames))
        .filter(Boolean) as Array<{ id: string; name: string }>;

      if (resolved.length > 0) {
        const resolvedIds = new Set(resolved.map((r) => r.id));
        targetMembers = assistantMembers.filter((m) =>
          resolvedIds.has(m.assistantId)
        );
      } else {
        // Mentions were present but none matched channel members — don't send to everyone
        return;
      }
    }

    // Exclude the active session's assistant (it already processes via the main loop)
    if (excludeAssistantId) {
      targetMembers = targetMembers.filter(
        (m) => m.assistantId !== excludeAssistantId
      );
    }

    if (targetMembers.length === 0) return;

    // ROUND 1: All target agents respond to person's message (sequential, random order)
    const prompt = `[Channel Message] ${personName} posted in #${channelName}: "${message}"

You are in a group channel with other assistants and people. Respond in #${channelName} using channel_send. Be helpful and conversational. You may reference or build on what other assistants have said.`;

    await this.executeRound(channelName, targetMembers, prompt, excludeAssistantId);

    // ROUNDS 2..N: Follow-up rounds for agent-to-agent discussion
    for (let round = 2; round <= this.maxRounds; round++) {
      // Small delay before checking for follow-ups
      await new Promise((r) => setTimeout(r, 1000));

      // Check which agents have new unread messages from the round
      const followUpMembers = this.getAgentsWithUnread(channelName, targetMembers, excludeAssistantId);
      if (followUpMembers.length === 0) break; // No one has anything new — conversation settled

      const followUpPrompt = `[Channel Update] New messages appeared in #${channelName}. Read them with channel_read and respond if you have something valuable to add. If the conversation is complete or you have nothing meaningful to contribute, simply say nothing (do not use channel_send).`;

      await this.executeRound(channelName, followUpMembers, followUpPrompt, excludeAssistantId);
    }
  }

  /**
   * Execute a single round: agents respond one at a time in random order with stagger delays.
   */
  private async executeRound(
    channelName: string,
    members: ChannelMember[],
    prompt: string,
    excludeAssistantId?: string,
  ): Promise<void> {
    let roundMembers = excludeAssistantId
      ? members.filter((m) => m.assistantId !== excludeAssistantId)
      : members;

    if (roundMembers.length === 0) return;

    // Shuffle for unbiased ordering
    const shuffled = this.shuffleArray([...roundMembers]);

    for (let i = 0; i < shuffled.length; i++) {
      const member = shuffled[i];
      try {
        const client = await this.getOrCreateClient(member.assistantId);
        await client.send(prompt);
      } catch (error) {
        console.error(
          `ChannelAgentPool: Failed for ${member.assistantName}:`,
          error
        );
      }

      // Stagger delay between agents (not after last)
      if (i < shuffled.length - 1) {
        await new Promise((r) => setTimeout(r, 500 + Math.floor(Math.random() * 1500)));
      }
    }
  }

  /**
   * Get agents that have unread messages in the channel (for follow-up rounds).
   */
  private getAgentsWithUnread(
    channelName: string,
    members: ChannelMember[],
    excludeId?: string,
  ): ChannelMember[] {
    const manager = this.getChannelsManager?.();
    if (!manager) return [];
    const channel = manager.getChannel(channelName);
    if (!channel) return [];

    return members.filter((m) => {
      if (m.assistantId === excludeId) return false;
      const unread = manager.getStore().getUnreadMessages(channel.id, m.assistantId);
      return unread.length > 0;
    });
  }

  /**
   * Fisher-Yates shuffle for unbiased random ordering.
   */
  private shuffleArray<T>(array: T[]): T[] {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  /**
   * Get or create a cached EmbeddedClient for an assistant.
   * Each client initializes with the assistant's own identity, model, and tools.
   */
  private async getOrCreateClient(
    assistantId: string
  ): Promise<EmbeddedClient> {
    const existing = this.agents.get(assistantId);
    if (existing) return existing;

    const client = this.clientFactory
      ? await this.clientFactory(assistantId, this.cwd)
      : new EmbeddedClient(this.cwd, { assistantId });

    if (!this.clientFactory) {
      await client.initialize();
    }
    this.agents.set(assistantId, client);
    return client;
  }

  /**
   * Shut down all cached agent clients and release resources.
   */
  shutdown(): void {
    for (const [, client] of this.agents) {
      try {
        client.disconnect();
      } catch {
        // Ignore errors during shutdown
      }
    }
    this.agents.clear();
  }
}
