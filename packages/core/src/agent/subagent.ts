import type { HookHandler, HookInput, StreamChunk } from '@hasna/assistants-shared';
import { generateId } from '@hasna/assistants-shared';
import type { LLMClient } from '../llm/client';
import { AssistantLoop } from './loop';

const DEFAULT_HOOK_TOOLS = ['read', 'glob', 'grep'];
const safeSetTimeout = setTimeout;

function sleepSafe(ms: number): Promise<void> {
  return new Promise((resolve) => safeSetTimeout(resolve, ms));
}

export interface HookAssistantOptions {
  hook: HookHandler;
  input: HookInput;
  timeout: number;
  cwd: string;
  allowedTools?: string[];
  llmClient?: LLMClient;
}

export async function runHookAssistant(options: HookAssistantOptions): Promise<string> {
  const { hook, input, timeout, cwd, allowedTools, llmClient } = options;
  let response = '';

  const assistant = new AssistantLoop({
    cwd,
    sessionId: `hook-${generateId()}`,
    allowedTools: allowedTools ?? DEFAULT_HOOK_TOOLS,
    llmClient,
    extraSystemPrompt: `You are a hook assistant evaluating whether to allow an action.
Task: ${hook.prompt}

Respond with ALLOW or DENY on the first line, followed by a short reason.`,
    onChunk: (chunk: StreamChunk) => {
      if (chunk.type === 'text' && chunk.content) {
        response += chunk.content;
      }
    },
  });

  await assistant.initialize();

  const runPromise = assistant.process(JSON.stringify(input)).catch(() => {});
  const timedOut = await Promise.race([
    runPromise.then(() => false),
    sleepSafe(timeout).then(() => true),
  ]);

  if (timedOut) {
    assistant.stop();
    return '';
  }

  await runPromise;
  let trimmed = response.trim();
  if (!trimmed) {
    const messages = assistant.getContext().getMessages();
    const lastAssistant = [...messages].reverse().find((msg) => msg.role === 'assistant' && msg.content);
    if (lastAssistant?.content) {
      trimmed = String(lastAssistant.content).trim();
    }
  }
  return trimmed;
}
