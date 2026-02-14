import type { Message } from '@hasna/assistants-shared';
import { generateId, now } from '@hasna/assistants-shared';
import type { LLMClient } from '../llm/client';
import type { TokenCounter } from './token-counter';

const MAX_MESSAGE_CHARS = 4000;
const MAX_TOOL_CHARS = 2000;

export interface SummaryStrategy {
  name: string;
  summarize(messages: Message[]): Promise<string>;
}

export interface LLMSummarizerOptions {
  maxTokens?: number;
  tokenCounter?: TokenCounter;
}

export class LLMSummarizer implements SummaryStrategy {
  name = 'llm';
  private llmClient: LLMClient;
  private maxTokens: number;
  private tokenCounter?: TokenCounter;

  constructor(llmClient: LLMClient, options: LLMSummarizerOptions = {}) {
    this.llmClient = llmClient;
    this.maxTokens = options.maxTokens ?? 2000;
    this.tokenCounter = options.tokenCounter;
  }

  async summarize(messages: Message[]): Promise<string> {
    const transcript = this.formatTranscript(messages);
    const prompt = this.buildPrompt(transcript);

    const summaryMessages: Message[] = [
      {
        id: generateId(),
        role: 'user',
        content: prompt,
        timestamp: now(),
      },
    ];

    let response = '';
    for await (const chunk of this.llmClient.chat(summaryMessages)) {
      if (chunk.type === 'text' && chunk.content) {
        response += chunk.content;
      } else if (chunk.type === 'error') {
        throw new Error(chunk.error || 'Summarization error');
      }
    }

    return response.trim();
  }

  private buildPrompt(transcript: string): string {
    const targetTokens = this.maxTokens;
    return (
      'Summarize this conversation transcript, preserving:\n' +
      '1. Key decisions made\n' +
      '2. Important technical details (file paths, commands, errors)\n' +
      '3. Current task/goal state\n' +
      '4. Pending questions or blockers\n\n' +
      `Be concise but comprehensive. Aim for roughly ${targetTokens} tokens or fewer. ` +
      'Format as structured bullet points with clear headings.\n\n' +
      'Transcript:\n' +
      transcript +
      '\n\nSummary:'
    );
  }

  private formatTranscript(messages: Message[]): string {
    return messages
      .map((msg) => {
        const role = msg.role === 'user' ? 'User' : msg.role === 'assistant' ? 'Assistant' : 'System';
        let content = this.truncate(msg.content || '', MAX_MESSAGE_CHARS);

        if (msg.toolCalls && msg.toolCalls.length > 0) {
          const toolNames = msg.toolCalls.map((call) => call.name).join(', ');
          content += `\n[Tool calls: ${toolNames}]`;
        }

        if (msg.toolResults && msg.toolResults.length > 0) {
          const results = msg.toolResults
            .map((result) => this.truncate(result.rawContent ?? result.content ?? '', MAX_TOOL_CHARS))
            .join('\n');
          content += `\n[Tool results]\n${results}`;
        }

        return `${role}: ${content}`;
      })
      .join('\n\n');
  }

  private truncate(text: string, limit: number): string {
    if (text.length <= limit) return text;
    const head = text.slice(0, Math.max(0, limit - 120));
    return `${head}\n[... ${text.length - head.length} characters truncated ...]`;
  }
}

export class HybridSummarizer implements SummaryStrategy {
  name = 'hybrid';
  private llmSummarizer: LLMSummarizer;

  constructor(llmSummarizer: LLMSummarizer) {
    this.llmSummarizer = llmSummarizer;
  }

  async summarize(messages: Message[]): Promise<string> {
    const files = this.extractFilePaths(messages);
    const commands = this.extractCommands(messages);
    const errors = this.extractErrors(messages);
    const tools = this.extractToolCalls(messages);

    const llmSummary = await this.llmSummarizer.summarize(messages);

    const sections: string[] = [];
    if (files.length > 0) {
      sections.push('## Files Referenced');
      sections.push(files.map((file) => `- ${file}`).join('\n'));
    }
    if (commands.length > 0) {
      sections.push('## Commands & Actions');
      sections.push(commands.map((cmd) => `- ${cmd}`).join('\n'));
    }
    if (tools.length > 0) {
      sections.push('## Tools Invoked');
      sections.push(tools.map((tool) => `- ${tool}`).join('\n'));
    }
    if (errors.length > 0) {
      sections.push('## Errors & Warnings');
      sections.push(errors.map((err) => `- ${err}`).join('\n'));
    }

    sections.push('## Conversation Summary');
    sections.push(llmSummary);

    return sections.join('\n\n');
  }

  private extractFilePaths(messages: Message[]): string[] {
    const paths = new Set<string>();
    const pathRegex = /(?:\.?\/|[A-Za-z]:\\)[\w\-.\/\\]+\.[A-Za-z0-9]+/g;

    for (const msg of messages) {
      const content = msg.content ?? '';
      const matches = content.match(pathRegex);
      if (matches) {
        for (const match of matches) {
          paths.add(match.replace(/\\/g, '/'));
        }
      }
    }

    return Array.from(paths);
  }

  private extractCommands(messages: Message[]): string[] {
    const commands = new Set<string>();

    for (const msg of messages) {
      const content = msg.content ?? '';
      const lines = content.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (trimmed.startsWith('$ ')) {
          commands.add(trimmed.slice(2));
        } else if (trimmed.startsWith('Running:')) {
          commands.add(trimmed.replace(/^Running:\s*/, ''));
        }
      }
    }

    for (const msg of messages) {
      if (msg.toolCalls) {
        for (const call of msg.toolCalls) {
          commands.add(`${call.name} ${JSON.stringify(call.input)}`);
        }
      }
    }

    return Array.from(commands);
  }

  private extractErrors(messages: Message[]): string[] {
    const errors = new Set<string>();

    for (const msg of messages) {
      const content = msg.content ?? '';
      const lines = content.split('\n');
      for (const line of lines) {
        if (/error|failed|exception/i.test(line)) {
          errors.add(line.trim());
        }
      }
    }

    return Array.from(errors);
  }

  private extractToolCalls(messages: Message[]): string[] {
    const tools = new Set<string>();
    for (const msg of messages) {
      if (msg.toolCalls) {
        for (const call of msg.toolCalls) {
          tools.add(call.name);
        }
      }
      if (msg.toolResults) {
        for (const result of msg.toolResults) {
          if (result.toolName) tools.add(result.toolName);
        }
      }
    }
    return Array.from(tools);
  }
}
