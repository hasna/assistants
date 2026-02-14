/**
 * Agent Loop Factory
 *
 * Creates the appropriate agent loop based on the assistant's backend setting.
 * - 'native' → AssistantLoop (default)
 * - 'claude-agent-sdk' → ClaudeAgentLoop
 * - 'codex-sdk' → CodexAgentLoop
 */

import type { AssistantBackend } from '../identity/types';
import { AssistantLoop, type AssistantLoopOptions } from './loop';
import { ClaudeAgentLoop, type ClaudeAgentLoopOptions } from './claude-agent-loop';
import { CodexAgentLoop, type CodexAgentLoopOptions } from './codex-loop';

export type AgentLoop = AssistantLoop | ClaudeAgentLoop | CodexAgentLoop;

export function createAgentLoop(
  backend: AssistantBackend | undefined,
  options: AssistantLoopOptions = {}
): AgentLoop {
  switch (backend) {
    case 'claude-agent-sdk':
      return new ClaudeAgentLoop({
        cwd: options.cwd,
        sessionId: options.sessionId,
        assistantId: options.assistantId,
        model: options.model,
        storageDir: options.storageDir,
        workspaceId: options.workspaceId,
        extraSystemPrompt: options.extraSystemPrompt,
        onChunk: options.onChunk,
        onToolStart: options.onToolStart,
        onToolEnd: options.onToolEnd,
      });

    case 'codex-sdk':
      return new CodexAgentLoop({
        cwd: options.cwd,
        sessionId: options.sessionId,
        assistantId: options.assistantId,
        model: options.model,
        storageDir: options.storageDir,
        workspaceId: options.workspaceId,
        extraSystemPrompt: options.extraSystemPrompt,
        onChunk: options.onChunk,
        onToolStart: options.onToolStart,
        onToolEnd: options.onToolEnd,
      });

    case 'native':
    default:
      return new AssistantLoop(options);
  }
}
