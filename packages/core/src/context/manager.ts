import type { Message } from '@hasna/assistants-shared';
import { generateId, now } from '@hasna/assistants-shared';
import { TokenCounter } from './token-counter';
import type { SummaryStrategy } from './summarizer';
import type { ContextConfig, ContextProcessResult, ContextState } from './types';

const SUMMARY_TAG = '[Context Summary';

export class ContextManager {
  private config: ContextConfig;
  private tokenCounter: TokenCounter;
  private summarizer: SummaryStrategy;
  private state: ContextState;

  constructor(config: ContextConfig, summarizer: SummaryStrategy, tokenCounter?: TokenCounter) {
    this.config = config;
    this.tokenCounter = tokenCounter ?? new TokenCounter();
    this.summarizer = summarizer;
    this.state = {
      totalTokens: 0,
      messageCount: 0,
      summaryCount: 0,
    };
  }

  async processMessages(messages: Message[]): Promise<ContextProcessResult> {
    const tokens = this.tokenCounter.countMessages(messages);
    this.state.totalTokens = tokens;
    this.state.messageCount = messages.length;

    if (!this.config.enabled) {
      return {
        messages,
        summarized: false,
        tokensBefore: tokens,
        tokensAfter: tokens,
        summarizedCount: 0,
      };
    }

    const ratioThreshold = this.config.maxContextTokens * this.config.summaryTriggerRatio;
    const threshold = Math.min(ratioThreshold, this.config.targetContextTokens);
    if (tokens <= threshold) {
      return {
        messages,
        summarized: false,
        tokensBefore: tokens,
        tokensAfter: tokens,
        summarizedCount: 0,
      };
    }

    return this.summarizeAndCompress(messages);
  }

  async summarizeNow(messages: Message[]): Promise<ContextProcessResult> {
    const tokens = this.tokenCounter.countMessages(messages);
    this.state.totalTokens = tokens;
    this.state.messageCount = messages.length;

    if (!this.config.enabled) {
      return {
        messages,
        summarized: false,
        tokensBefore: tokens,
        tokensAfter: tokens,
        summarizedCount: 0,
      };
    }

    return this.summarizeAndCompress(messages);
  }

  getState(): ContextState {
    return { ...this.state };
  }

  refreshState(messages: Message[]): ContextState {
    const tokens = this.tokenCounter.countMessages(messages);
    this.state.totalTokens = tokens;
    this.state.messageCount = messages.length;
    return { ...this.state };
  }

  private async summarizeAndCompress(messages: Message[]): Promise<ContextProcessResult> {
    const systemMessages = messages.filter((msg) => msg.role === 'system' && !this.isSummaryMessage(msg));
    const nonSystemMessages = messages.filter((msg) => msg.role !== 'system');

    const { recentMessages, toSummarize, summarizedCount } = this.partitionMessages(nonSystemMessages);

    if (toSummarize.length === 0) {
      const tokens = this.tokenCounter.countMessages(messages);
      this.state.totalTokens = tokens;
      this.state.messageCount = messages.length;
      return {
        messages,
        summarized: false,
        tokensBefore: tokens,
        tokensAfter: tokens,
        summarizedCount: 0,
      };
    }

    let summary = '';
    try {
      summary = await this.summarizer.summarize(toSummarize);
    } catch {
      const tokens = this.tokenCounter.countMessages(messages);
      this.state.totalTokens = tokens;
      this.state.messageCount = messages.length;
      return {
        messages,
        summarized: false,
        tokensBefore: tokens,
        tokensAfter: tokens,
        summarizedCount: 0,
      };
    }
    if (!summary.trim()) {
      const tokens = this.tokenCounter.countMessages(messages);
      this.state.totalTokens = tokens;
      this.state.messageCount = messages.length;
      return {
        messages,
        summarized: false,
        tokensBefore: tokens,
        tokensAfter: tokens,
        summarizedCount: 0,
      };
    }

    const summaryMessage: Message = {
      id: generateId(),
      role: 'system',
      content: `${SUMMARY_TAG} - ${summarizedCount} messages summarized]\n\n${summary}`,
      timestamp: now(),
    };

    const resultMessages: Message[] = [];
    if (this.config.keepSystemPrompt) {
      resultMessages.push(...systemMessages);
    }
    resultMessages.push(summaryMessage);
    resultMessages.push(...recentMessages);

    const tokensBefore = this.tokenCounter.countMessages(messages);
    const tokensAfter = this.tokenCounter.countMessages(resultMessages);

    this.state.summaryCount += 1;
    this.state.lastSummaryAt = new Date().toISOString();
    this.state.lastSummaryMessageCount = summarizedCount;
    this.state.lastSummaryTokensBefore = tokensBefore;
    this.state.lastSummaryTokensAfter = tokensAfter;
    this.state.lastSummaryStrategy = this.summarizer.name;
    this.state.totalTokens = tokensAfter;
    this.state.messageCount = resultMessages.length;

    return {
      messages: resultMessages,
      summarized: true,
      summary,
      tokensBefore,
      tokensAfter,
      summarizedCount,
    };
  }

  private isSummaryMessage(message: Message): boolean {
    const content = message.content ?? '';
    return message.role === 'system' && content.trim().startsWith(SUMMARY_TAG);
  }

  private partitionMessages(messages: Message[]): {
    recentMessages: Message[];
    toSummarize: Message[];
    summarizedCount: number;
  } {
    const keepRecent = Math.max(0, this.config.keepRecentMessages);
    const preserveToolCalls = Math.max(0, this.config.preserveLastToolCalls ?? 5);

    // Start with the configured number of recent messages
    let recentMessages = keepRecent > 0 ? messages.slice(-keepRecent) : [];
    let startIndex = messages.length - recentMessages.length;

    // If the first preserved message has tool results, include the preceding message
    // (which likely contains the tool call)
    if (recentMessages.length > 0 && recentMessages[0].toolResults) {
      if (startIndex > 0) {
        startIndex -= 1;
        recentMessages = messages.slice(startIndex);
      }
    }

    // Now ensure we preserve the last N tool calls
    // Scan backwards from startIndex to find messages with tool calls/results
    if (preserveToolCalls > 0) {
      let toolCallsFound = 0;
      let scanIndex = startIndex - 1;
      let newStartIndex = startIndex;

      // Count tool calls already in recentMessages
      for (const msg of recentMessages) {
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          toolCallsFound += msg.toolCalls.length;
        }
      }

      // Scan backwards to find more tool calls if needed
      while (scanIndex >= 0 && toolCallsFound < preserveToolCalls) {
        const msg = messages[scanIndex];
        // If this message has tool calls or results, include it
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          toolCallsFound += msg.toolCalls.length;
          newStartIndex = scanIndex;
        } else if (msg.toolResults && msg.toolResults.length > 0) {
          // Include tool results as well
          newStartIndex = scanIndex;
        }
        scanIndex--;
      }

      // If we found more tool calls to preserve, extend recentMessages
      if (newStartIndex < startIndex) {
        startIndex = newStartIndex;
        recentMessages = messages.slice(startIndex);
      }
    }

    const toSummarize = messages.slice(0, Math.max(0, startIndex));

    return {
      recentMessages,
      toSummarize,
      summarizedCount: toSummarize.length,
    };
  }
}
