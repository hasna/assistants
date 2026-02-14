import type {
  HookInput,
  HookOutput,
  NativeHook,
  NativeHookContext,
  VerificationResult,
  Message,
  ScopeContext,
} from '@hasna/assistants-shared';
import { generateId } from '@hasna/assistants-shared';
import type { LLMClient } from '../llm/client';
import { VerificationSessionStore } from '../sessions/verification';
import { getConfigDir } from '../config';

/**
 * Verification system prompt template
 */
const VERIFICATION_PROMPT = `You are a goal verification assistant. Your task is to determine if the user's original goals were accomplished based on the conversation history.

Original request: {originalMessage}

Extracted goals:
{goals}

Analyze the conversation history that follows. For each goal, determine if it was addressed and provide evidence.

Respond with ONLY valid JSON in this exact format:
{
  "goalsMet": boolean,
  "goalsAnalysis": [
    {"goal": "string", "met": boolean, "evidence": "string"}
  ],
  "reason": "string explaining overall assessment",
  "suggestions": ["string"] // Only include if goalsMet is false, listing what still needs to be done
}`;

/**
 * Extract conversation summary for verification
 */
function summarizeConversation(messages: Message[]): string {
  const relevant = messages.filter((m) => m.role !== 'system');
  const summary: string[] = [];

  for (const msg of relevant.slice(-20)) {
    // Limit to last 20 messages
    if (msg.role === 'user') {
      if (msg.toolResults && msg.toolResults.length > 0) {
        for (const result of msg.toolResults) {
          const content = (result.content || '').slice(0, 500);
          summary.push(`[Tool Result - ${result.toolName || 'unknown'}]: ${content}`);
        }
      } else {
        summary.push(`User: ${(msg.content ?? '').slice(0, 300)}`);
      }
    } else if (msg.role === 'assistant') {
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        for (const call of msg.toolCalls) {
          const input = JSON.stringify(call.input).slice(0, 200);
          summary.push(`[Tool Call - ${call.name}]: ${input}`);
        }
      }
      const assistantContent = msg.content ?? '';
      if (assistantContent.trim()) {
        summary.push(`Assistant: ${assistantContent.slice(0, 300)}`);
      }
    }
  }

  return summary.join('\n\n');
}

/**
 * Run verification using LLM
 */
async function runVerification(
  scopeContext: ScopeContext,
  messages: Message[],
  llmClient: LLMClient
): Promise<VerificationResult> {
  const goalsText = scopeContext.extractedGoals
    .map((g, i) => `${i + 1}. ${g}`)
    .join('\n');

  const prompt = VERIFICATION_PROMPT.replace('{originalMessage}', scopeContext.originalMessage).replace(
    '{goals}',
    goalsText
  );

  const conversationSummary = summarizeConversation(messages);

  const verificationMessages: Message[] = [
    {
      id: generateId(),
      role: 'user',
      content: `${prompt}\n\n---\n\nConversation history:\n${conversationSummary}`,
      timestamp: Date.now(),
    },
  ];

  let response = '';
  for await (const chunk of llmClient.chat(verificationMessages)) {
    if (chunk.type === 'text' && chunk.content) {
      response += chunk.content;
    }
  }

  // Parse the JSON response
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const result = JSON.parse(jsonMatch[0]) as VerificationResult;
      // Validate structure
      if (
        typeof result.goalsMet === 'boolean' &&
        typeof result.reason === 'string' &&
        Array.isArray(result.goalsAnalysis)
      ) {
        return result;
      }
    }
  } catch {
    // Parsing failed
  }

  // Default to goals met if verification fails
  return {
    goalsMet: true,
    goalsAnalysis: scopeContext.extractedGoals.map((goal) => ({
      goal,
      met: true,
      evidence: 'Unable to verify - defaulting to complete',
    })),
    reason: 'Verification parsing failed - assuming goals were met',
  };
}

/**
 * Scope verification handler - runs on Stop event
 */
export async function scopeVerificationHandler(
  input: HookInput,
  context: NativeHookContext
): Promise<HookOutput | null> {
  const { scopeContext, messages, config, sessionId, cwd } = context;
  const llmClient = context.llmClient as LLMClient | undefined;

  // Skip if no scope context or verification disabled
  if (!scopeContext || !llmClient) {
    return null;
  }

  // Skip if max attempts reached
  if (scopeContext.verificationAttempts >= scopeContext.maxAttempts) {
    return null;
  }

  // Skip if config says disabled
  if (config?.scopeVerification?.enabled === false) {
    return null;
  }

  // Skip if no goals to verify
  if (scopeContext.extractedGoals.length === 0) {
    return null;
  }

  try {
    // Run verification
    const result = await runVerification(scopeContext, messages, llmClient);

    // Store verification session
    const store = new VerificationSessionStore(getConfigDir());
    const session = store.create(sessionId, scopeContext.extractedGoals, result);

    // If goals met, allow stop
    if (result.goalsMet) {
      return null;
    }

    // Goals not met - force continuation
    const suggestions = result.suggestions?.join('\n- ') || 'Please complete the remaining tasks.';

    return {
      continue: false,
      stopReason: 'Goals not fully achieved',
      systemMessage: `[Scope Verification - Session ${session.id}]
The following goals were not completed:
${result.goalsAnalysis
  .filter((g) => !g.met)
  .map((g) => `- ${g.goal}: ${g.evidence}`)
  .join('\n')}

${result.reason}

Please continue and:
- ${suggestions}`,
      additionalContext: `Verification session: ${session.id}`,
    };
  } catch (error) {
    console.error('Scope verification error:', error);
    // On error, don't block
    return null;
  }
}

/**
 * Create the native scope verification hook
 */
export function createScopeVerificationHook(): NativeHook {
  return {
    id: 'scope-verification',
    name: 'Scope Verification',
    description: 'Verifies user goals were met before stopping the session',
    event: 'Stop',
    priority: 100, // Run after other Stop hooks
    handler: scopeVerificationHandler,
  };
}
