import type { Message } from '@hasna/assistants-shared';

const MESSAGE_OVERHEAD_TOKENS = 4;
const CHARS_PER_TOKEN = 4; // Rough estimate: ~4 characters per token

/**
 * Token counter using character-based estimation.
 * This avoids the tiktoken WASM bundling issues while providing
 * reasonable estimates for context management.
 */
export class TokenCounter {
  private cache: Map<string, number> = new Map();
  private maxCacheEntries = 10000;

  constructor(_model?: string) {
    // Model parameter kept for API compatibility but not used
  }

  count(text: string): number {
    if (!text) return 0;
    const cached = this.cache.get(text);
    if (cached !== undefined) return cached;

    // Estimate ~4 characters per token
    const tokens = Math.ceil(text.length / CHARS_PER_TOKEN);

    if (text.length < 10000) {
      this.cache.set(text, tokens);
      if (this.cache.size > this.maxCacheEntries) {
        this.cache.clear();
      }
    }

    return tokens;
  }

  countMessages(messages: Message[]): number {
    let total = 0;

    for (const msg of messages) {
      total += MESSAGE_OVERHEAD_TOKENS;
      total += this.count(msg.content || '');

      if (msg.toolCalls) {
        for (const call of msg.toolCalls) {
          total += this.count(JSON.stringify(call));
        }
      }

      if (msg.toolResults) {
        for (const result of msg.toolResults) {
          total += this.count(JSON.stringify(result));
        }
      }
    }

    return total;
  }

  estimateResponse(prompt: string): number {
    return Math.floor(this.count(prompt) * 0.5);
  }

  clearCache(): void {
    this.cache.clear();
  }
}
