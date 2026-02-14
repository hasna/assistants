#!/usr/bin/env bun

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { setRuntime, hasRuntime } from '@hasna/assistants-core';
import { bunRuntime } from '@hasna/runtime-bun';
import { EmbeddedClient, SessionStorage } from '@hasna/assistants-core';
import type { StreamChunk, Message } from '@hasna/assistants-shared';

// Initialize Bun runtime
if (!hasRuntime()) {
  setRuntime(bunRuntime);
}

const server = new McpServer({
  name: 'assistants',
  version: '0.1.0',
});

// ─── chat ────────────────────────────────────────────────────────────────────
// Send a message to the assistant and get a response

server.tool(
  'chat',
  'Send a message to the AI assistant and get a response. The assistant can use tools like bash, file read/write, web search, etc.',
  {
    message: z.string().describe('The message to send to the assistant'),
    cwd: z.string().optional().describe('Working directory for the assistant (defaults to current directory)'),
    system_prompt: z.string().optional().describe('Custom system prompt to use'),
    allowed_tools: z.array(z.string()).optional().describe('Tools to auto-approve (e.g. ["Read", "Write", "Bash"])'),
    session_id: z.string().optional().describe('Resume a specific session by ID'),
  },
  async ({ message, cwd, system_prompt, allowed_tools, session_id }) => {
    const workingDir = cwd || process.cwd();

    let initialMessages: Message[] | undefined;
    if (session_id) {
      const data = SessionStorage.loadSession(session_id);
      if (data?.messages) {
        initialMessages = data.messages as Message[];
      }
    }

    const client = new EmbeddedClient(workingDir, {
      sessionId: session_id,
      initialMessages,
      systemPrompt: system_prompt,
      allowedTools: allowed_tools,
    });

    let result = '';
    const toolCalls: Array<{ name: string; input: Record<string, unknown> }> = [];
    let errorMsg = '';

    client.onChunk((chunk: StreamChunk) => {
      if (chunk.type === 'text' && chunk.content) {
        result += chunk.content;
      }
      if (chunk.type === 'tool_use' && chunk.toolCall) {
        toolCalls.push({ name: chunk.toolCall.name, input: chunk.toolCall.input });
      }
      if (chunk.type === 'error' && chunk.error) {
        errorMsg += chunk.error + '\n';
      }
    });

    client.onError((error: Error) => {
      errorMsg += error.message + '\n';
    });

    await client.initialize();

    try {
      await client.send(message);
    } catch (e) {
      errorMsg += e instanceof Error ? e.message : String(e);
    } finally {
      client.disconnect();
    }

    const sessionId = client.getSessionId();
    const usage = client.getTokenUsage();

    const parts: string[] = [];
    if (result.trim()) parts.push(result.trim());
    if (toolCalls.length > 0) {
      parts.push(`\n---\nTools used: ${toolCalls.map(t => t.name).join(', ')}`);
    }
    if (usage) {
      parts.push(`Session: ${sessionId} | Tokens: ${usage.inputTokens ?? 0} in / ${usage.outputTokens ?? 0} out`);
    }

    if (errorMsg) {
      return { content: [{ type: 'text' as const, text: errorMsg.trim() }], isError: true };
    }

    return { content: [{ type: 'text' as const, text: parts.join('\n') }] };
  }
);

// ─── run_prompt ──────────────────────────────────────────────────────────────
// Run a one-shot prompt and return the result

server.tool(
  'run_prompt',
  'Run a one-shot prompt against the assistant and return the result as text. No interactive session.',
  {
    prompt: z.string().describe('The prompt to run'),
    cwd: z.string().optional().describe('Working directory'),
    system_prompt: z.string().optional().describe('Custom system prompt'),
    allowed_tools: z.array(z.string()).optional().describe('Tools to auto-approve'),
    timeout_ms: z.number().optional().describe('Timeout in milliseconds'),
  },
  async ({ prompt, cwd, system_prompt, allowed_tools, timeout_ms }) => {
    const workingDir = cwd || process.cwd();

    const client = new EmbeddedClient(workingDir, {
      systemPrompt: system_prompt,
      allowedTools: allowed_tools,
    });

    let result = '';
    let errorMsg = '';

    client.onChunk((chunk: StreamChunk) => {
      if (chunk.type === 'text' && chunk.content) result += chunk.content;
      if (chunk.type === 'error' && chunk.error) errorMsg += chunk.error;
    });

    client.onError((error: Error) => { errorMsg += error.message; });

    await client.initialize();

    try {
      if (timeout_ms && timeout_ms > 0) {
        await Promise.race([
          client.send(prompt),
          new Promise<void>((_, reject) =>
            setTimeout(() => reject(new Error(`Timed out after ${timeout_ms}ms`)), timeout_ms)
          ),
        ]);
      } else {
        await client.send(prompt);
      }
    } catch (e) {
      errorMsg += e instanceof Error ? e.message : String(e);
    } finally {
      client.disconnect();
    }

    if (errorMsg) {
      return { content: [{ type: 'text' as const, text: errorMsg.trim() }], isError: true };
    }

    return { content: [{ type: 'text' as const, text: result.trim() }] };
  }
);

// ─── list_sessions ───────────────────────────────────────────────────────────
// List previous assistant sessions

server.tool(
  'list_sessions',
  'List previous assistant sessions that can be resumed.',
  {
    limit: z.number().optional().describe('Max sessions to return (default 20)'),
  },
  async ({ limit }) => {
    const sessions = SessionStorage.listAllSessions();
    const maxResults = limit || 20;
    const recent = sessions.slice(0, maxResults);

    if (recent.length === 0) {
      return { content: [{ type: 'text' as const, text: 'No sessions found.' }] };
    }

    const lines = recent.map((s) => {
      const date = s.startedAt ? new Date(s.startedAt).toLocaleString() : 'unknown';
      const msgs = s.messageCount ?? 0;
      return `- **${s.id}** (${date}, ${msgs} messages)${s.assistantId ? ` [${s.assistantId}]` : ''}`;
    });

    return {
      content: [{ type: 'text' as const, text: `## Sessions (${recent.length})\n\n${lines.join('\n')}` }],
    };
  }
);

// ─── list_skills ─────────────────────────────────────────────────────────────
// List available skills

server.tool(
  'list_skills',
  'List available assistant skills (SKILL.md files).',
  {
    cwd: z.string().optional().describe('Working directory to search for project-level skills'),
  },
  async ({ cwd }) => {
    const { SkillLoader } = await import('@hasna/assistants-core');
    const workingDir = cwd || process.cwd();

    const loader = new SkillLoader(workingDir);
    await loader.initialize();
    const skills = loader.getSkills();

    if (skills.length === 0) {
      return { content: [{ type: 'text' as const, text: 'No skills found.' }] };
    }

    const lines = skills.map((s) => {
      return `- **${s.name}**: ${s.description || 'No description'}${s.argumentHint ? ` (args: ${s.argumentHint})` : ''}`;
    });

    return {
      content: [{ type: 'text' as const, text: `## Skills (${skills.length})\n\n${lines.join('\n')}` }],
    };
  }
);

// ─── execute_skill ───────────────────────────────────────────────────────────
// Execute a specific skill

server.tool(
  'execute_skill',
  'Execute a named skill with arguments. The skill prompt is expanded and sent to the assistant.',
  {
    skill_name: z.string().describe('Name of the skill to execute'),
    arguments: z.string().optional().describe('Arguments to pass to the skill'),
    cwd: z.string().optional().describe('Working directory'),
    allowed_tools: z.array(z.string()).optional().describe('Tools to auto-approve'),
  },
  async ({ skill_name, arguments: args, cwd, allowed_tools }) => {
    const { SkillLoader, SkillExecutor } = await import('@hasna/assistants-core');
    const workingDir = cwd || process.cwd();

    const loader = new SkillLoader(workingDir);
    await loader.initialize();

    const executor = new SkillExecutor(loader);
    const expandedPrompt = await executor.execute(skill_name, args || '');

    if (!expandedPrompt) {
      return { content: [{ type: 'text' as const, text: `Skill "${skill_name}" not found.` }], isError: true };
    }

    // Run the expanded prompt through the assistant
    const client = new EmbeddedClient(workingDir, {
      allowedTools: allowed_tools,
    });

    let result = '';
    let errorMsg = '';

    client.onChunk((chunk: StreamChunk) => {
      if (chunk.type === 'text' && chunk.content) result += chunk.content;
      if (chunk.type === 'error' && chunk.error) errorMsg += chunk.error;
    });

    client.onError((error: Error) => { errorMsg += error.message; });

    await client.initialize();

    try {
      await client.send(expandedPrompt);
    } catch (e) {
      errorMsg += e instanceof Error ? e.message : String(e);
    } finally {
      client.disconnect();
    }

    if (errorMsg) {
      return { content: [{ type: 'text' as const, text: errorMsg.trim() }], isError: true };
    }

    return { content: [{ type: 'text' as const, text: result.trim() }] };
  }
);

// ─── get_session ─────────────────────────────────────────────────────────────
// Get details of a specific session

server.tool(
  'get_session',
  'Get the messages and details of a specific session.',
  {
    session_id: z.string().describe('The session ID to retrieve'),
  },
  async ({ session_id }) => {
    const data = SessionStorage.loadSession(session_id);

    if (!data) {
      return { content: [{ type: 'text' as const, text: `Session "${session_id}" not found.` }], isError: true };
    }

    const messages = (data.messages || []) as Message[];
    const lines = messages.map((m) => {
      const role = m.role === 'user' ? 'User' : 'Assistant';
      const text = typeof m.content === 'string'
        ? m.content.slice(0, 500)
        : JSON.stringify(m.content).slice(0, 500);
      return `**${role}**: ${text}`;
    });

    const header = [
      `## Session: ${session_id}`,
      `Started: ${data.startedAt || 'unknown'}`,
      `Messages: ${messages.length}`,
      `CWD: ${data.cwd || 'unknown'}`,
      '',
    ].join('\n');

    return {
      content: [{ type: 'text' as const, text: header + lines.join('\n\n') }],
    };
  }
);

// ─── Start server ────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error('MCP server error:', error);
  process.exit(1);
});
