import OpenAI from 'openai';
import type { LLMClient } from './client';
import type { Message, Tool, StreamChunk, LLMConfig, ToolCall } from '@hasna/assistants-shared';
import { getProviderInfo, type LLMProvider } from '@hasna/assistants-shared';
import { ErrorCodes, LLMError } from '../errors';
import { LLMRetryConfig, withRetry } from '../utils/retry';
import { resolveApiKey, resolveBaseUrl } from './provider-utils';

/**
 * OpenAI-compatible client implementation
 */
export class OpenAIClient implements LLMClient {
  private client: OpenAI;
  private model: string;
  private maxTokens: number;

  constructor(config: LLMConfig) {
    const provider = (config.provider || 'openai') as LLMProvider;
    const apiKey = resolveApiKey(provider, config.apiKey);

    if (!apiKey) {
      const info = getProviderInfo(provider);
      const envName = info?.apiKeyEnv || 'OPENAI_API_KEY';
      throw new Error(
        `${envName} not found. Please either:\n` +
        `  1. Set the ${envName} environment variable, or\n` +
        `  2. Add it to ~/.secrets: export ${envName}="your-key"`
      );
    }

    const baseURL = resolveBaseUrl(provider, config.baseUrl);
    this.client = new OpenAI({ apiKey, baseURL: baseURL || undefined });
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
    // Convert messages to OpenAI format
    const openaiMessages = this.convertMessages(messages, systemPrompt);

    // Convert tools to OpenAI format
    const openaiTools = tools ? this.convertTools(tools) : undefined;

    try {
      const stream = await withRetry(
        async () => {
          try {
            return this.client.chat.completions.create({
              model: this.model,
              max_tokens: this.maxTokens,
              messages: openaiMessages,
              tools: openaiTools,
              stream: true,
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

      // Track current tool calls being built
      const toolCallsInProgress: Map<number, {
        id: string;
        name: string;
        arguments: string;
      }> = new Map();

      let inputTokens = 0;
      let outputTokens = 0;

      for await (const chunk of stream) {
        const choice = chunk.choices[0];
        if (!choice) continue;

        const delta = choice.delta;

        // Handle text content
        if (delta.content) {
          yield {
            type: 'text',
            content: delta.content,
          };
        }

        // Handle tool calls
        if (delta.tool_calls) {
          for (const toolCallDelta of delta.tool_calls) {
            const index = toolCallDelta.index;

            // Initialize tool call if this is the first chunk for this index
            if (!toolCallsInProgress.has(index) && toolCallDelta.id) {
              toolCallsInProgress.set(index, {
                id: toolCallDelta.id,
                name: toolCallDelta.function?.name || '',
                arguments: '',
              });
            }

            // Update the tool call
            const current = toolCallsInProgress.get(index);
            if (current) {
              if (toolCallDelta.function?.name) {
                current.name = toolCallDelta.function.name;
              }
              if (toolCallDelta.function?.arguments) {
                current.arguments += toolCallDelta.function.arguments;
              }
            }
          }
        }

        // Check if we've reached the end
        if (choice.finish_reason) {
          // Emit completed tool calls
          for (const [, toolCall] of toolCallsInProgress) {
            let input: Record<string, unknown> = {};
            try {
              input = toolCall.arguments ? JSON.parse(toolCall.arguments) : {};
            } catch {
              // Empty input on parse failure
            }

            yield {
              type: 'tool_use',
              toolCall: {
                id: toolCall.id,
                name: toolCall.name,
                input,
              } as ToolCall,
            };
          }

          yield { type: 'done' };
        }

        // Track usage if available
        if (chunk.usage) {
          inputTokens = chunk.usage.prompt_tokens || 0;
          outputTokens = chunk.usage.completion_tokens || 0;
        }
      }

      // Emit usage at the end
      if (inputTokens > 0 || outputTokens > 0) {
        yield {
          type: 'usage',
          usage: {
            inputTokens,
            outputTokens,
            totalTokens: inputTokens + outputTokens,
            maxContextTokens: this.getContextWindow(),
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

  /**
   * Get the context window size for the current model
   */
  private getContextWindow(): number {
    // GPT-5.2 models have 400k context
    if (this.model.startsWith('gpt-5.2')) {
      return 400000;
    }
    // Gemini models typically support large contexts
    if (this.model.startsWith('gemini-')) {
      return 1048576;
    }
    // xAI Grok models have 131k context
    if (this.model.startsWith('grok-')) {
      return 131072;
    }
    // Mistral models have 128k context
    if (this.model.startsWith('mistral-') || this.model.startsWith('codestral') ||
        this.model.startsWith('ministral') || this.model.startsWith('magistral') ||
        this.model.startsWith('devstral') || this.model.startsWith('pixtral')) {
      return 128000;
    }
    // Fallback for any other OpenAI models
    return 128000;
  }

  /**
   * Convert internal messages to OpenAI format
   */
  private convertMessages(
    messages: Message[],
    systemPrompt?: string
  ): OpenAI.ChatCompletionMessageParam[] {
    const result: OpenAI.ChatCompletionMessageParam[] = [];

    // Add system prompt as first message
    const combinedSystem =
      systemPrompt && systemPrompt.trim().length > 0
        ? `${this.getDefaultSystemPrompt()}\n\n---\n\n${systemPrompt}`
        : this.getDefaultSystemPrompt();

    result.push({
      role: 'system',
      content: combinedSystem,
    });

    // Track tool_use IDs from assistant messages to validate tool_results
    const pendingToolUseIds = new Set<string>();

    for (const msg of messages) {
      if (msg.role === 'system') continue; // System messages handled above

      if (msg.role === 'user') {
        // Handle user messages with tool results
        if (msg.toolResults && msg.toolResults.length > 0) {
          // Add tool result messages
          for (const toolResult of msg.toolResults) {
            // Only add if we have a corresponding tool_use
            if (pendingToolUseIds.has(toolResult.toolCallId)) {
              result.push({
                role: 'tool',
                tool_call_id: toolResult.toolCallId,
                content: toolResult.rawContent ?? toolResult.content,
              });
              pendingToolUseIds.delete(toolResult.toolCallId);
            }
          }

          // Add image attachments from tool results as a separate user message
          if (msg.documents && msg.documents.length > 0) {
            const imageParts: OpenAI.ChatCompletionContentPart[] = [];
            for (const doc of msg.documents) {
              if (doc.type === 'image') {
                const imageContent = this.convertImageToPart(doc);
                if (imageContent) {
                  imageParts.push(imageContent);
                }
              } else if (doc.type === 'pdf') {
                // PDF-as-images fallback for OpenAI: include a text note
                imageParts.push({
                  type: 'text',
                  text: `[PDF document attached: ${doc.name || 'document.pdf'}. Note: PDF native viewing is not supported by this model. The PDF content was attached but may not be readable.]`,
                });
              }
            }
            if (imageParts.length > 0) {
              imageParts.push({ type: 'text', text: 'Please analyze the attached media.' });
              result.push({
                role: 'user',
                content: imageParts,
              });
            }
          }
        } else if (msg.content) {
          // Regular user message - check for document attachments
          if (msg.documents && msg.documents.length > 0) {
            const contentParts: OpenAI.ChatCompletionContentPart[] = [];
            for (const doc of msg.documents) {
              if (doc.type === 'image') {
                const imageContent = this.convertImageToPart(doc);
                if (imageContent) {
                  contentParts.push(imageContent);
                }
              }
            }
            contentParts.push({ type: 'text', text: msg.content });
            result.push({
              role: 'user',
              content: contentParts,
            });
          } else {
            result.push({
              role: 'user',
              content: msg.content,
            });
          }
        }
      } else if (msg.role === 'assistant') {
        const assistantMsg: OpenAI.ChatCompletionAssistantMessageParam = {
          role: 'assistant',
        };

        // Add text content
        if (msg.content) {
          assistantMsg.content = msg.content;
        }

        // Add tool calls
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          assistantMsg.tool_calls = msg.toolCalls.map((toolCall) => {
            pendingToolUseIds.add(toolCall.id);
            return {
              id: toolCall.id,
              type: 'function' as const,
              function: {
                name: toolCall.name,
                arguments: JSON.stringify(toolCall.input),
              },
            };
          });
        }

        // Only add if there's content or tool calls
        if (assistantMsg.content || assistantMsg.tool_calls) {
          result.push(assistantMsg);
        }
      }
    }

    return result;
  }

  /**
   * Convert an image document attachment to an OpenAI image content part
   */
  private convertImageToPart(doc: import('@hasna/assistants-shared').DocumentAttachment): OpenAI.ChatCompletionContentPart | null {
    if (doc.source.type === 'base64') {
      const mediaType = doc.mediaType || doc.source.mediaType || 'image/png';
      return {
        type: 'image_url',
        image_url: {
          url: `data:${mediaType};base64,${doc.source.data}`,
        },
      };
    } else if (doc.source.type === 'url') {
      return {
        type: 'image_url',
        image_url: {
          url: doc.source.url,
        },
      };
    }
    return null;
  }

  /**
   * Convert internal tools to OpenAI format
   */
  private convertTools(tools: Tool[]): OpenAI.ChatCompletionTool[] {
    return tools.map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: {
          type: 'object' as const,
          properties: tool.parameters.properties,
          required: tool.parameters.required,
        },
      },
    }));
  }

  private getDefaultSystemPrompt(): string {
    return `You are a helpful personal AI assistant running in the terminal.

You have access to various tools and connectors:
- Connectors installed via \`connectors install <name>\` or standalone connect-* CLIs. To install a new connector, use the bash tool to run \`connectors install <name>\`.
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
