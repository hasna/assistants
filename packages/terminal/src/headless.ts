import { EmbeddedClient, SessionStorage } from '@hasna/assistants-core';
import type { StreamChunk, TokenUsage, Message } from '@hasna/assistants-shared';

export interface HeadlessOptions {
  prompt: string;
  cwd: string;
  outputFormat: 'text' | 'json' | 'stream-json';
  allowedTools?: string[];
  systemPrompt?: string;
  jsonSchema?: string;
  continue?: boolean;
  resume?: string | null;
  cwdProvided?: boolean;
  timeoutMs?: number | null;
}

interface JsonOutput {
  result: string;
  session_id: string;
  usage?: TokenUsage;
  tool_calls?: Array<{
    name: string;
    input: Record<string, unknown>;
  }>;
  structured_output?: unknown;
}

/**
 * Result returned by runHeadless
 */
export interface HeadlessResult {
  success: boolean;
  result: string;
  sessionId: string;
  usage?: TokenUsage;
  toolCalls: Array<{ name: string; input: Record<string, unknown> }>;
  error?: string;
  structuredOutput?: unknown;
}

/**
 * Run assistants in headless (non-interactive) mode
 *
 * @returns HeadlessResult with success status, result, and error info
 */
export async function runHeadless(options: HeadlessOptions): Promise<HeadlessResult> {
  const {
    prompt,
    cwd,
    outputFormat,
    jsonSchema,
    continue: shouldContinue,
    resume,
    cwdProvided,
    timeoutMs,
  } = options;

  let sessionData = null as null | { id: string; data: ReturnType<typeof SessionStorage.loadSession> };

  if (resume) {
    const data = SessionStorage.loadSession(resume);
    if (!data) {
      throw new Error(`Session ${resume} not found`);
    }
    sessionData = { id: resume, data };
  } else if (shouldContinue) {
    const latest = SessionStorage.getLatestSession();
    if (latest) {
      const data = SessionStorage.loadSession(latest.id);
      if (data) {
        sessionData = { id: latest.id, data };
      }
    }
  }

  const effectiveCwd = sessionData?.data?.cwd && !cwdProvided ? sessionData.data.cwd : cwd;

  const client = new EmbeddedClient(effectiveCwd, {
    sessionId: sessionData?.id,
    initialMessages: sessionData?.data?.messages as Message[] | undefined,
    systemPrompt: options.systemPrompt,
    allowedTools: options.allowedTools,
    startedAt: sessionData?.data?.startedAt,
  });

  let result = '';
  const toolCalls: Array<{ name: string; input: Record<string, unknown> }> = [];
  let hadError = false;
  let errorMessage = '';

  // Setup chunk handling
  client.onChunk((chunk: StreamChunk) => {
    if (outputFormat === 'stream-json') {
      // Output each event as JSON line
      const event = formatStreamEvent(chunk);
      if (event) {
        process.stdout.write(JSON.stringify(event) + '\n');
      }
    }

    // Accumulate text for final result
    if (chunk.type === 'text' && chunk.content) {
      result += chunk.content;

      // For text mode, stream to stdout immediately
      if (outputFormat === 'text') {
        process.stdout.write(chunk.content);
      }
    }

    // Track tool calls
    if (chunk.type === 'tool_use' && chunk.toolCall) {
      toolCalls.push({
        name: chunk.toolCall.name,
        input: chunk.toolCall.input,
      });
    }

    if (chunk.type === 'tool_result' && chunk.toolResult?.isError) {
      hadError = true;
      errorMessage = chunk.toolResult.content || 'Tool error';
      process.stderr.write(`Error: ${errorMessage}\n`);
    }

    // Handle errors
    if (chunk.type === 'error' && chunk.error) {
      hadError = true;
      errorMessage = chunk.error;
      process.stderr.write(`Error: ${chunk.error}\n`);
    }
  });

  // Handle client errors
  client.onError((error: Error) => {
    hadError = true;
    errorMessage = error.message;
    if (outputFormat === 'json') {
      console.error(JSON.stringify({ error: error.message }));
    } else {
      console.error(`Error: ${error.message}`);
    }
  });

  // Initialize the client
  await client.initialize();

  // Build the message to send
  let message = prompt;

  // If JSON schema is provided, add instruction to output structured data
  if (jsonSchema) {
    message = `${prompt}\n\nIMPORTANT: Your response MUST be valid JSON conforming to this schema:\n${jsonSchema}`;
  }

  try {
    // Send the message and wait for completion
    if (timeoutMs && timeoutMs > 0) {
      await Promise.race([
        client.send(message),
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error(`Headless run timed out after ${timeoutMs}ms`)), timeoutMs)
        ),
      ]);
    } else {
      await client.send(message);
    }
  } catch (error) {
    // Capture any thrown errors
    hadError = true;
    errorMessage = error instanceof Error ? error.message : String(error);
    if (outputFormat === 'text') {
      process.stderr.write(`Error: ${errorMessage}\n`);
    }
  } finally {
    // Always disconnect the client to clean up resources
    client.disconnect();
  }

  // Output final result based on format
  if (outputFormat === 'json') {
    const output: JsonOutput = {
      result: result.trim(),
      session_id: client.getSessionId(),
      usage: client.getTokenUsage(),
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    };
    if (hadError && errorMessage) {
      (output as JsonOutput & { error?: string }).error = errorMessage;
    }

    // Parse structured output if JSON schema was provided
    if (jsonSchema) {
      try {
        output.structured_output = JSON.parse(result.trim());
      } catch {
        // Result wasn't valid JSON - that's okay
      }
    }

    console.log(JSON.stringify(output, null, 2));
  } else if (outputFormat === 'text') {
    // Add newline at end if not already present
    if (result && !result.endsWith('\n')) {
      process.stdout.write('\n');
    }
  }
  // stream-json already output everything

  // Return result object (let caller decide exit behavior)
  const headlessResult: HeadlessResult = {
    success: !hadError,
    result: result.trim(),
    sessionId: client.getSessionId(),
    usage: client.getTokenUsage(),
    toolCalls,
    error: hadError ? errorMessage : undefined,
  };

  // Include structured output if JSON schema was provided
  if (jsonSchema) {
    try {
      headlessResult.structuredOutput = JSON.parse(result.trim());
    } catch {
      // Result wasn't valid JSON - that's okay
    }
  }

  return headlessResult;
}

/**
 * Format a stream chunk as a JSON event
 */
function formatStreamEvent(chunk: StreamChunk): Record<string, unknown> | null {
  const timestamp = Date.now();

  switch (chunk.type) {
    case 'text':
      return {
        type: 'text_delta',
        text: chunk.content,
        timestamp,
      };
    case 'tool_use':
      return {
        type: 'tool_use',
        tool_call: {
          id: chunk.toolCall?.id,
          name: chunk.toolCall?.name,
          input: chunk.toolCall?.input,
        },
        timestamp,
      };
    case 'tool_result':
      return {
        type: 'tool_result',
        tool_result: {
          tool_call_id: chunk.toolResult?.toolCallId,
          content: chunk.toolResult?.content,
          is_error: chunk.toolResult?.isError,
        },
        timestamp,
      };
    case 'usage':
      return {
        type: 'usage',
        usage: chunk.usage,
        timestamp,
      };
    case 'error':
      return {
        type: 'error',
        error: chunk.error,
        timestamp,
      };
    case 'done':
      return {
        type: 'done',
        timestamp,
      };
    default:
      return null;
  }
}
