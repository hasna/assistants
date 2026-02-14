import type { Tool, AskUserRequest, AskUserResponse, InterviewRequest, InterviewResponse } from '@hasna/assistants-shared';
import type { ToolExecutor } from './registry';
import { ToolExecutionError, ErrorCodes } from '../errors';

export type AskUserHandler = (request: AskUserRequest) => Promise<AskUserResponse>;
export type InterviewHandler = (request: InterviewRequest) => Promise<InterviewResponse>;

export function createAskUserTool(getHandler: () => AskUserHandler | null, getInterviewHandler?: () => InterviewHandler | null): {
  tool: Tool;
  executor: ToolExecutor;
} {
  const tool: Tool = {
    name: 'ask_user',
    description:
      'Ask the user clarifying questions with an interactive interview wizard. Supports multiple questions with selectable options, descriptions, and multi-select. Questions are presented in a tabbed interface where the user can navigate between them.',
    parameters: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Short title shown above the questions.',
        },
        description: {
          type: 'string',
          description: 'Optional context for the user.',
        },
        questions: {
          type: 'array',
          description: 'Questions to ask the user (1-6 questions).',
          items: {
            type: 'object',
            description: 'A question object.',
            properties: {
              id: { type: 'string', description: 'Stable id for this question.' },
              question: { type: 'string', description: 'The full question text.' },
              header: { type: 'string', description: 'Short label for the tab bar (max 12 chars, e.g. "Auth method", "Library").' },
              options: {
                type: 'array',
                description: 'Answer options. Each can be a string or an object with label and description.',
                items: {
                  oneOf: [
                    { type: 'string', description: 'Simple option label' },
                    {
                      type: 'object',
                      description: 'Option with label and description.',
                      properties: {
                        label: { type: 'string', description: 'Display text for this option.' },
                        description: { type: 'string', description: 'Explanation of what this option means.' },
                      },
                      required: ['label'],
                    },
                  ],
                },
              },
              placeholder: { type: 'string', description: 'Placeholder text for the "Other" input.' },
              multiSelect: { type: 'boolean', description: 'Allow selecting multiple options.' },
              required: { type: 'boolean', description: 'Whether the answer is required.' },
            },
            required: ['id', 'question'],
          },
        },
        metadata: {
          type: 'object',
          description: 'Optional metadata to attach to this interview for tracking.',
        },
      },
      required: ['questions'],
    },
  };

  const executor: ToolExecutor = async (input) => {
    const questions = Array.isArray(input.questions) ? input.questions : [];
    if (questions.length === 0) {
      throw new ToolExecutionError('ask_user requires at least one question.', {
        toolName: 'ask_user',
        toolInput: input,
        code: ErrorCodes.TOOL_EXECUTION_FAILED,
        recoverable: true,
        retryable: false,
        suggestion: 'Provide an array of questions with id and question fields.',
      });
    }
    if (questions.length > 6) {
      throw new ToolExecutionError('ask_user supports up to 6 questions at a time.', {
        toolName: 'ask_user',
        toolInput: input,
        code: ErrorCodes.TOOL_EXECUTION_FAILED,
        recoverable: true,
        retryable: false,
        suggestion: 'Split into multiple ask_user calls.',
      });
    }

    for (const entry of questions) {
      if (!entry.id || !entry.question) {
        throw new ToolExecutionError('Each ask_user question must include id and question.', {
          toolName: 'ask_user',
          toolInput: input,
          code: ErrorCodes.TOOL_EXECUTION_FAILED,
          recoverable: true,
          retryable: false,
        });
      }
    }

    // Detect if any question uses rich format (objects in options, header, multiSelect)
    const hasRichFormat = questions.some(
      (q: Record<string, unknown>) =>
        q.header ||
        q.multiSelect ||
        (Array.isArray(q.options) && q.options.some((opt: unknown) => typeof opt === 'object' && opt !== null && 'label' in (opt as Record<string, unknown>)))
    );

    // Use interview handler for rich format if available
    const interviewHandler = getInterviewHandler?.();
    if (hasRichFormat && interviewHandler) {
      const request: InterviewRequest = {
        title: input.title ? String(input.title) : undefined,
        description: input.description ? String(input.description) : undefined,
        questions: questions.map((entry: Record<string, unknown>) => ({
          id: String(entry.id || ''),
          question: String(entry.question || ''),
          header: entry.header ? String(entry.header) : undefined,
          options: Array.isArray(entry.options)
            ? entry.options.map((opt: unknown) => {
                if (typeof opt === 'object' && opt !== null && 'label' in (opt as Record<string, unknown>)) {
                  const o = opt as Record<string, unknown>;
                  return { label: String(o.label), description: o.description ? String(o.description) : undefined };
                }
                return { label: String(opt) };
              })
            : undefined,
          placeholder: entry.placeholder ? String(entry.placeholder) : undefined,
          multiSelect: entry.multiSelect ? Boolean(entry.multiSelect) : undefined,
          required: entry.required !== undefined ? Boolean(entry.required) : undefined,
        })),
        metadata: input.metadata as Record<string, unknown> | undefined,
      };

      const response = await interviewHandler(request);

      if (response.cancelled) {
        return 'The user cancelled the interview.';
      }
      if (response.chatRequested) {
        return `The user wants to discuss this further. Their message: ${response.chatMessage || '(no message)'}`;
      }

      return JSON.stringify(response.answers ?? {}, null, 2);
    }

    // Fall back to simple handler
    const handler = getHandler();
    if (!handler) {
      throw new ToolExecutionError('User input is not available in this environment.', {
        toolName: 'ask_user',
        toolInput: input,
        code: ErrorCodes.TOOL_EXECUTION_FAILED,
        recoverable: true,
        retryable: false,
        suggestion: 'Ask the user directly in chat.',
      });
    }

    const request: AskUserRequest = {
      title: input.title ? String(input.title) : undefined,
      description: input.description ? String(input.description) : undefined,
      questions: questions.map((entry: Record<string, unknown>) => ({
        id: String(entry.id || ''),
        question: String(entry.question || ''),
        options: Array.isArray(entry.options)
          ? entry.options.map((opt: unknown) => {
              if (typeof opt === 'object' && opt !== null && 'label' in (opt as Record<string, unknown>)) {
                return String((opt as Record<string, unknown>).label);
              }
              return String(opt);
            })
          : undefined,
        placeholder: entry.placeholder ? String(entry.placeholder) : undefined,
        multiline: Boolean(entry.multiSelect || (entry as Record<string, unknown>).multiline),
        required: entry.required !== undefined ? Boolean(entry.required) : undefined,
      })),
    };

    const response = await handler(request);
    return JSON.stringify(response.answers ?? {}, null, 2);
  };

  return { tool, executor };
}
