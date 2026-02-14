import Anthropic from '@anthropic-ai/sdk';
import type { LLMClient } from './client';
import type { Message, Tool, StreamChunk, LLMConfig, ToolCall } from '@hasna/assistants-shared';
import { getProviderInfo } from '@hasna/assistants-shared';
import { ErrorCodes, LLMError } from '../errors';
import { LLMRetryConfig, withRetry } from '../utils/retry';
import { resolveApiKey } from './provider-utils';

/**
 * Anthropic Claude client
 */
export class AnthropicClient implements LLMClient {
  private client: Anthropic;
  private model: string;
  private maxTokens: number;

  constructor(config: LLMConfig) {
    const apiKey = resolveApiKey('anthropic', config.apiKey);

    if (!apiKey) {
      const info = getProviderInfo('anthropic');
      const envName = info?.apiKeyEnv || 'ANTHROPIC_API_KEY';
      throw new Error(
        `${envName} not found. Please either:\n` +
        `  1. Set the ${envName} environment variable, or\n` +
        `  2. Add it to ~/.secrets: export ${envName}="your-key"`
      );
    }

    this.client = new Anthropic({ apiKey });
    this.model = config.model;
    this.maxTokens = config.maxTokens || 8192;
  }

  getModel(): string {
    return this.model;
  }

  async *chat(
    messages: Message[],
    tools?: Tool[],
    systemPrompt?: string
  ): AsyncGenerator<StreamChunk> {
    // Convert messages to Anthropic format
    const anthropicMessages = this.convertMessages(messages);

    // Convert tools to Anthropic format
    const anthropicTools = tools ? this.convertTools(tools) : undefined;

    try {
      const combinedSystem =
        systemPrompt && systemPrompt.trim().length > 0
          ? `${this.getDefaultSystemPrompt()}\n\n---\n\n${systemPrompt}`
          : this.getDefaultSystemPrompt();

      const stream = await withRetry(
        async () => {
          try {
            return this.client.messages.stream({
              model: this.model,
              max_tokens: this.maxTokens,
              system: combinedSystem,
              messages: anthropicMessages,
              tools: anthropicTools,
            });
          } catch (error) {
            throw toLLMError(error);
          }
        },
        {
          ...LLMRetryConfig,
          retryOn: (error) => error instanceof LLMError && error.retryable,
        }
      );

      let currentToolCall: Partial<ToolCall> | null = null;
      let toolInputJson = '';

      for await (const event of stream) {
        if (event.type === 'content_block_start') {
          if (event.content_block.type === 'tool_use') {
            currentToolCall = {
              id: event.content_block.id,
              name: event.content_block.name,
            };
            toolInputJson = '';
          }
        } else if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') {
            yield {
              type: 'text',
              content: event.delta.text,
            };
          } else if (event.delta.type === 'input_json_delta') {
            toolInputJson += event.delta.partial_json;
          }
        } else if (event.type === 'content_block_stop') {
          if (currentToolCall && currentToolCall.id && currentToolCall.name) {
            try {
              currentToolCall.input = toolInputJson ? JSON.parse(toolInputJson) : {};
            } catch {
              currentToolCall.input = {};
            }
            yield {
              type: 'tool_use',
              toolCall: currentToolCall as ToolCall,
            };
            currentToolCall = null;
            toolInputJson = '';
          }
        } else if (event.type === 'message_stop') {
          yield { type: 'done' };
        }
      }

      // Get final usage from stream
      const finalMessage = await stream.finalMessage();
      if (finalMessage.usage) {
        yield {
          type: 'usage',
          usage: {
            inputTokens: finalMessage.usage.input_tokens,
            outputTokens: finalMessage.usage.output_tokens,
            totalTokens: finalMessage.usage.input_tokens + finalMessage.usage.output_tokens,
            maxContextTokens: 200000,
          },
        };
      }
    } catch (error) {
      const llmError = toLLMError(error);
      yield {
        type: 'error',
        error: formatLLMError(llmError),
      };
    }
  }

  private convertMessages(messages: Message[]): Anthropic.MessageParam[] {
    const result: Anthropic.MessageParam[] = [];

    // Track tool_use IDs from assistant messages to validate tool_results
    const pendingToolUseIds = new Set<string>();

    for (const msg of messages) {
      if (msg.role === 'system') continue; // System messages handled separately

      // Build content array with proper types
      const content: Array<
        | Anthropic.TextBlockParam
        | Anthropic.ToolUseBlockParam
        | Anthropic.ToolResultBlockParam
        | Anthropic.DocumentBlockParam
      > = [];

      // Add document/image attachments first (media should come before text per Anthropic best practices)
      if (msg.documents && msg.documents.length > 0) {
        for (const doc of msg.documents) {
          if (doc.type === 'pdf') {
            const docBlock = this.convertDocumentToBlock(doc);
            if (docBlock) {
              content.push(docBlock);
            }
          } else if (doc.type === 'image') {
            const imageBlock = this.convertImageToBlock(doc);
            if (imageBlock) {
              content.push(imageBlock as unknown as Anthropic.DocumentBlockParam);
            }
          }
        }
      }

      // Add text content
      if (msg.content) {
        content.push({ type: 'text', text: msg.content });
      }

      // Add tool use blocks (for assistant messages)
      if (msg.role === 'assistant' && msg.toolCalls) {
        for (const toolCall of msg.toolCalls) {
          content.push({
            type: 'tool_use',
            id: toolCall.id,
            name: toolCall.name,
            input: toolCall.input as Record<string, unknown>,
          });
          pendingToolUseIds.add(toolCall.id);
        }
      }

      // Add tool results (for user messages following tool use)
      // Only include results that have a corresponding tool_use in this conversation
      if (msg.toolResults) {
        for (const toolResult of msg.toolResults) {
          // Only add if we have a corresponding tool_use
          if (pendingToolUseIds.has(toolResult.toolCallId)) {
            content.push({
              type: 'tool_result',
              tool_use_id: toolResult.toolCallId,
              content: toolResult.rawContent ?? toolResult.content,
              is_error: toolResult.isError,
            });
            pendingToolUseIds.delete(toolResult.toolCallId);
          }
          // Skip orphaned tool_results to avoid API errors
        }
      }

      if (content.length > 0) {
        result.push({
          role: msg.role === 'assistant' ? 'assistant' : 'user',
          content: content as Anthropic.MessageParam['content'],
        });
      }
    }

    return result;
  }

  private convertDocumentToBlock(doc: import('@hasna/assistants-shared').DocumentAttachment): Anthropic.DocumentBlockParam | null {
    if (doc.source.type === 'base64') {
      return {
        type: 'document',
        source: {
          type: 'base64',
          media_type: doc.source.mediaType as 'application/pdf',
          data: doc.source.data,
        },
      };
    } else if (doc.source.type === 'url') {
      return {
        type: 'document',
        source: {
          type: 'url',
          url: doc.source.url,
        },
      };
    }
    // file type not yet supported
    return null;
  }

  private convertImageToBlock(doc: import('@hasna/assistants-shared').DocumentAttachment): Anthropic.ImageBlockParam | null {
    if (doc.source.type === 'base64') {
      return {
        type: 'image',
        source: {
          type: 'base64',
          media_type: (doc.mediaType || doc.source.mediaType || 'image/png') as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp',
          data: doc.source.data,
        },
      };
    } else if (doc.source.type === 'url') {
      return {
        type: 'image',
        source: {
          type: 'url',
          url: doc.source.url,
        },
      };
    }
    return null;
  }

  private convertTools(tools: Tool[]): Anthropic.Tool[] {
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: {
        type: 'object' as const,
        properties: tool.parameters.properties,
        required: tool.parameters.required,
      },
    }));
  }

  private getDefaultSystemPrompt(): string {
    return `You are a helpful personal AI assistant running in the terminal.

You have access to various tools and connectors:
- Connectors discovered from installed connect-* CLIs
- Filesystem operations (read, write, search files)
- Shell command execution
- Scheduling tools for recurring or delayed commands

Guidelines:
- Be concise and direct
- Don't introduce yourself or say your name
- Use tools proactively to accomplish tasks
- Format output nicely for the terminal (use markdown)
- If a task requires multiple steps, break it down clearly

Current date: ${new Date().toISOString().split('T')[0]}`;
  }
}

function toLLMError(error: unknown): LLMError {
  if (error instanceof LLMError) return error;

  const message = error instanceof Error ? error.message : String(error);
  const statusRaw = (error as { status?: unknown; statusCode?: unknown } | null)?.status ??
    (error as { statusCode?: unknown } | null)?.statusCode;
  const statusCode = typeof statusRaw === 'number' ? statusRaw : undefined;

  const rateLimited = statusCode === 429 || /rate limit/i.test(message);
  const contextTooLong = /context|max tokens|too long/i.test(message);

  if (rateLimited) {
    return new LLMError(message, {
      code: ErrorCodes.LLM_RATE_LIMITED,
      statusCode,
      rateLimited: true,
      retryable: true,
      suggestion: 'Wait a moment and retry the request.',
    });
  }

  if (contextTooLong) {
    return new LLMError(message, {
      code: ErrorCodes.LLM_CONTEXT_TOO_LONG,
      statusCode,
      retryable: false,
      suggestion: 'Try shortening the conversation or use /compact.',
    });
  }

  return new LLMError(message, {
    code: ErrorCodes.LLM_API_ERROR,
    statusCode,
    retryable: false,
  });
}

function formatLLMError(error: LLMError): string {
  if (error.suggestion) {
    return `${error.code}: ${error.message}\nSuggestion: ${error.suggestion}`;
  }
  return `${error.code}: ${error.message}`;
}
