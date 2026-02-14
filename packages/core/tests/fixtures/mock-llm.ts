import type { LLMClient } from '../../src/llm/client';
import type { StreamChunk, ToolCall, TokenUsage, Message } from '@hasna/assistants-shared';

export interface MockResponse {
  content: string;
  toolCalls?: ToolCall[];
  usage?: TokenUsage;
  error?: string;
}

export class MockLLMClient implements LLMClient {
  private responses: MockResponse[] = [];
  private callHistory: Array<{ messages: Message[]; tools?: unknown; systemPrompt?: string }> = [];

  queueResponse(response: MockResponse): void {
    this.responses.push(response);
  }

  queueToolCall(name: string, input: Record<string, unknown>): void {
    this.responses.push({
      content: '',
      toolCalls: [
        {
          id: `call_${Date.now()}`,
          name,
          input,
        },
      ],
    });
  }

  async *chat(messages: Message[], tools?: unknown, systemPrompt?: string): AsyncGenerator<StreamChunk> {
    this.callHistory.push({ messages, tools, systemPrompt });

    const response = this.responses.shift();
    if (!response) {
      throw new Error('No mock response queued');
    }

    if (response.error) {
      yield { type: 'error', error: response.error };
      return;
    }

    const text = response.content || '';
    const chunkSize = 25;
    for (let i = 0; i < text.length; i += chunkSize) {
      yield { type: 'text', content: text.slice(i, i + chunkSize) };
    }

    if (response.toolCalls) {
      for (const call of response.toolCalls) {
        yield { type: 'tool_use', toolCall: call };
      }
    }

    if (response.usage) {
      yield { type: 'usage', usage: response.usage };
    }

    yield { type: 'done' };
  }

  getModel(): string {
    return 'mock-model';
  }

  getCallHistory() {
    return [...this.callHistory];
  }

  clearHistory(): void {
    this.callHistory = [];
    this.responses = [];
  }
}
