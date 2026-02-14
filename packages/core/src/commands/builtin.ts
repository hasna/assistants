import type { Command, CommandContext, CommandResult, TokenUsage } from './types';
import type { CommandLoader } from './loader';
import { join } from 'path';
import { homedir, platform, release, arch } from 'os';
import { getRuntime } from '../runtime';
import { parseMentions, resolveNameToKnown } from '../channels/mentions';
import { buildCommandArgs } from '../utils/command-line';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { getConfigDir } from '../config';
import { SessionStorage } from '../logger';
import { generateId } from '@hasna/assistants-shared';
import { saveFeedbackEntry, type FeedbackType } from '../tools/feedback';
import type { ScheduledCommand } from '@hasna/assistants-shared';
import type { InboxManager } from '../inbox';
import type { WalletManager } from '../wallet';
import type { SecretsManager } from '../secrets';
import type { MessagesManager } from '../messages';
import type { Heartbeat } from '../heartbeat/types';
import {
  saveSchedule,
  listSchedules,
  getSchedule,
  deleteSchedule,
  updateSchedule,
  computeNextRun,
} from '../scheduler/store';
import { formatRelativeTime } from '../scheduler/format';
import {
  listHeartbeatHistorySessions,
  readHeartbeatHistory,
  resolveHeartbeatHistoryPath,
} from '../heartbeat/history';
import {
  createProject,
  deleteProject,
  ensureDefaultProject,
  findProjectByName,
  hasProjectNameConflict,
  listProjects,
  readProject,
  updateProject,
  type ProjectContextEntry,
  type ProjectPlan,
  type ProjectPlanStep,
  type ProjectRecord,
} from '../projects/store';
import { buildProjectContext } from '../projects/context';
import { VerificationSessionStore } from '../sessions/verification';
import { nativeHookRegistry, HookStore, HookTester } from '../hooks';
import { createSkill, type SkillScope } from '../skills/create';
import { SkillInstaller } from '../skills/installer';
import {
  listJobs,
  listJobsForSession,
  readJob,
  updateJob,
  cleanupSessionJobs,
  type Job,
} from '../jobs';
import {
  getTasks,
  resolveTaskId,
  addTask,
  updateTask,
  deleteTask,
  clearPendingTasks,
  clearCompletedTasks,
  getNextTask,
  isPaused,
  setPaused,
  startTask,
  completeTask,
  failTask,
  getTaskCounts,
  type Task,
  type TaskPriority,
  PRIORITY_ORDER,
} from '../tasks';
import {
  listTemplates,
  createIdentityFromTemplate,
} from '../identity/templates';

// Version lookup - prefer explicit env to avoid stale hardcoded values
const VERSION =
  process.env.ASSISTANTS_VERSION ||
  process.env.npm_package_version ||
  'unknown';

type ConnectorAuthTimeoutResolve = (value: {
  exitCode: number;
  stdout: { toString: () => string };
}) => void;

function resolveAuthTimeout(resolve: ConnectorAuthTimeoutResolve): void {
  resolve({ exitCode: 1, stdout: { toString: () => '{}' } });
}

function splitArgs(input: string): string[] {
  const args: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let escaped = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (quote) {
      if (escaped) {
        current += char;
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === quote) {
        quote = null;
        continue;
      }
      current += char;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char as '"' | "'";
      continue;
    }

    if (char === ' ' || char === '\t') {
      if (current) {
        args.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (current) args.push(current);
  return args;
}

function singleLine(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Built-in slash commands for assistants
 */
export class BuiltinCommands {
  private tokenUsage: TokenUsage = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    maxContextTokens: 200000, // Claude's context window
  };

  /**
   * Register all built-in commands
   */
  registerAll(loader: CommandLoader): void {
    loader.register(this.helpCommand(loader));
    loader.register(this.aboutCommand());
    loader.register(this.docsCommand());
    loader.register(this.clearCommand());
    loader.register(this.newCommand());
    loader.register(this.sessionCommand());
    loader.register(this.resumeCommand());
    loader.register(this.statusCommand());
    loader.register(this.tokensCommand());
    loader.register(this.contextCommand());
    loader.register(this.projectsCommand());
    loader.register(this.plansCommand());
    loader.register(this.summarizeCommand());
    loader.register(this.restCommand());
    loader.register(this.voiceCommand());
    loader.register(this.talkCommand());
    loader.register(this.assistantCommand());
    loader.register(this.identityCommand());
    loader.register(this.whoamiCommand());
    loader.register(this.compactCommand());
    loader.register(this.configCommand());
    loader.register(this.budgetCommand());
    loader.register(this.assistantsCommand());
    loader.register(this.swarmCommand());
    loader.register(this.workspaceCommand());

    loader.register(this.initCommand());
    loader.register(this.costCommand());
    loader.register(this.modelCommand());
    loader.register(this.skillsCommand(loader));
    loader.register(this.memoryCommand());
    loader.register(this.hooksCommand());
    loader.register(this.feedbackCommand());
    loader.register(this.schedulesCommand());
    loader.register(this.heartbeatCommand());
    loader.register(this.connectorsCommand());
    loader.register(this.securityLogCommand());
    loader.register(this.guardrailsCommand());
    loader.register(this.verificationCommand());
    loader.register(this.walletCommand());
    loader.register(this.secretsCommand());
    loader.register(this.jobsCommand());
    loader.register(this.messagesCommand());
    loader.register(this.webhooksCommand());
    loader.register(this.channelsCommand());
    loader.register(this.peopleCommand());
    loader.register(this.contactsCommand());
    loader.register(this.communicationCommand());
    loader.register(this.callCommand());
    loader.register(this.ordersCommand());
    loader.register(this.tasksCommand());
    loader.register(this.setupCommand());
    loader.register(this.exitCommand());
    loader.register(this.diffCommand());
    loader.register(this.undoCommand());
  }

  /**
   * /about - About Hasna and this app
   */
  private aboutCommand(): Command {
    return {
      name: 'about',
      description: 'About Hasna and Assistants',
      builtin: true,
      selfHandled: true,
      content: '',
      handler: async (_args, context) => {
        let message = '\n**About Hasna**\n\n';
        message += 'Hasna is on a mission to make AI more useful to everyone.\n';
        message += 'We build tools that bring the power of AI into your everyday workflow — no expertise required.\n';
        message += 'Website: hasna.com\n';
        message += '\n**About Hasna Assistants**\n\n';
        message += 'Hasna Assistants is a general-purpose AI assistant that lives in your terminal.\n';
        message += 'It connects natively to 100+ tools — email, calendars, databases, cloud storage, CRMs, and more — so you can get things done without switching apps.\n\n';
        message += 'What you can do:\n';
        message += '- Ask questions and get answers in plain language\n';
        message += '- Automate repetitive tasks across your tools\n';
        message += '- Read, write, and manage files on your machine\n';
        message += '- Run multi-step workflows with built-in skills\n';
        message += '- Schedule commands to run on a timer\n';
        message += '- Collaborate with multiple AI agents via swarm mode\n\n';
        message += 'Whether you are a developer, a founder, or just someone who wants AI to handle the boring stuff — Assistants is built for you.\n';
        context.emit('text', message);
        context.emit('done');
        return { handled: true };
      },
    };
  }

  /**
   * /docs - Documentation overview (terminal opens interactive docs panel)
   */
  private docsCommand(): Command {
    return {
      name: 'docs',
      description: 'Open docs panel in terminal or print full usage guide',
      builtin: true,
      selfHandled: true,
      content: '',
      handler: async (_args, context) => {
        let message = '\n**assistants Documentation**\n\n';
        message += 'In the terminal app, `/docs` opens an interactive documentation panel with keyboard navigation.\n\n';

        message += '**Quick Start**\n';
        message += '  1. Run `/init` in a project.\n';
        message += '  2. Run `/onboarding` to select provider, model, and API key setup.\n';
        message += '  3. Start work with `/new` and inspect status via `/status`, `/tokens`, and `/cost`.\n\n';

        message += '**Core Workflow**\n';
        message += '  - Sessions keep history, tool calls, context, and model state.\n';
        message += '  - `/sessions` switches sessions.\n';
        message += '  - `/compact` summarizes long context.\n';
        message += '  - `/resume` recovers interrupted work.\n\n';

        message += '**Configuration and Models**\n';
        message += '  - `/model` opens interactive model selection.\n';
        message += '  - `/config` manages user/project/local config.\n';
        message += '  - `/memory`, `/context`, `/hooks`, and `/guardrails` control behavior and safety.\n\n';

        message += '**Workspaces and Projects**\n';
        message += '  - `/workspace` switches isolated workspace state.\n';
        message += '  - `/projects` and `/plans` manage project scope and plan execution.\n\n';

        message += '**Resources and Operations**\n';
        message += '  - `/wallet`, `/secrets`, and `/budgets` manage cards, secrets, and limits.\n';
        message += '  - `/tasks`, `/schedules`, `/jobs`, `/orders`, `/heartbeat`, and `/logs` manage operations.\n\n';

        message += '**Collaboration**\n';
        message += '  - `/assistants`, `/identity`, `/messages`, `/channels`, `/people`, `/communication`.\n\n';

        message += '**Voice**\n';
        message += '  - `/voice`, `/talk`, `/say`.\n\n';

        message += '**Storage**\n';
        message += '  - Project data: `.assistants/`\n';
        message += '  - User/global data: `~/.assistants/`\n';
        message += '  - Workspace switching isolates sessions, assistants, settings, and resource state.\n';

        context.emit('text', message);
        context.emit('done');
        return { handled: true };
      },
    };
  }

  /**
   * /voice - Toggle voice mode or show status
   */
  private voiceCommand(): Command {
    return {
      name: 'voice',
      description: 'Toggle voice mode, check status, or stop audio (on/off/status/stop)',
      builtin: true,
      selfHandled: true,
      content: '',
      handler: async (args, context) => {
        if (!context.getVoiceState) {
          context.emit('text', 'Voice support is not available in this build.\n');
          context.emit('done');
          return { handled: true };
        }

        const trimmed = args.trim().toLowerCase();
        if (trimmed === 'on') {
          context.enableVoice?.();
          context.emit('text', 'Voice mode enabled.\n');
          context.emit('done');
          return { handled: true };
        }
        if (trimmed === 'off') {
          context.disableVoice?.();
          context.emit('text', 'Voice mode disabled.\n');
          context.emit('done');
          return { handled: true };
        }
        if (trimmed === 'stop') {
          context.stopSpeaking?.();
          context.stopListening?.();
          context.stopTalking?.();
          context.emit('text', 'Voice output/input stopped.\n');
          context.emit('done');
          return { handled: true };
        }

        const state = context.getVoiceState();
        if (!state) {
          context.emit('text', 'Voice support is not available.\n');
          context.emit('done');
          return { handled: true };
        }
        context.emit('text', '\n## Voice Mode\n\nSpeak and listen using text-to-speech and speech-to-text.\n\n');
        context.emit('text', '**Subcommands:** `/voice on` · `/voice off` · `/voice stop` · `/voice` (status)\n\nUse `/talk` to start a live voice conversation.\n\n');
        const status = state.enabled ? 'on' : 'off';
        const activity = state.isSpeaking ? 'speaking' : state.isListening ? 'listening' : 'idle';
        context.emit('text', `Voice mode: ${status} (${activity})\n`);
        if (state.sttProvider || state.ttsProvider) {
          context.emit('text', `STT: ${state.sttProvider || 'unknown'} · TTS: ${state.ttsProvider || 'unknown'}\n`);
        }
        context.emit('done');
        return { handled: true };
      },
    };
  }

  /**
   * /talk - Start live voice conversation
   * Args: --no-autosend (require Enter to send), --autosend (auto-send on silence)
   */
  private talkCommand(): Command {
    return {
      name: 'talk',
      description: 'Start live voice conversation. Args: --autosend (default), --no-autosend (press Enter to send)',
      builtin: true,
      selfHandled: true,
      content: '',
      handler: async (args, context) => {
        if (!context.talk || !context.processForTalk) {
          context.emit('text', 'Voice support is not available.\n');
          context.emit('done');
          return { handled: true };
        }

        // Parse args for auto-send toggle
        const trimmedArgs = args.trim().toLowerCase();
        if (trimmedArgs === '--no-autosend' || trimmedArgs === '--manual') {
          context.setAutoSend?.(false);
        } else if (trimmedArgs === '--autosend' || trimmedArgs === '--auto') {
          context.setAutoSend?.(true);
        }

        const autoSend = context.getAutoSend?.() !== false;
        const sendMode = autoSend
          ? 'Speak naturally — silence auto-sends your message.'
          : 'Speak, then press Enter to send. Use --autosend to switch.';

        context.emit('text', `\n## Talk Mode\n\nLive conversation started. ${sendMode}\nType /stop or press Ctrl+C to exit.\n\n`);

        // Track the last partial transcript for the live display
        let lastPartial = '';

        try {
          await context.talk({
            onPartialTranscript: (text) => {
              // Emit a special event for the terminal to update the input box live
              // Clear previous partial and show new one
              if (text !== lastPartial) {
                lastPartial = text;
                context.emit('partial_transcript', text);
              }
            },
            onTranscript: (text) => {
              lastPartial = '';
              context.emit('partial_transcript', ''); // Clear partial
              context.emit('text', `**You:** ${text}\n\n`);
            },
            onResponse: () => {
              // Response is already streamed to chat by the normal process flow
            },
            sendMessage: async (text) => {
              return context.processForTalk!(text);
            },
          });
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          if (msg !== 'Talk mode stopped') {
            context.emit('error', msg);
          }
        }

        context.emit('text', '\nTalk mode ended.\n');
        context.emit('done');
        return { handled: true };
      },
    };
  }

  /**
   * /assistants - Manage assistants
   */
  private assistantCommand(): Command {
    return {
      name: 'assistants',
      description: 'Manage assistants (list, create, switch, delete)',
      builtin: true,
      selfHandled: true,
      content: '',
      handler: async (args, context) => {
        const manager = context.getAssistantManager?.();
        if (!manager) {
          context.emit('text', 'Assistant manager not available.\n');
          context.emit('done');
          return { handled: true };
        }

        const [action, ...rest] = args.trim().split(/\s+/).filter(Boolean);
        const target = rest.join(' ');
        const switchAssistantInContext = async (assistantId: string) => {
          if (context.switchAssistant) {
            await context.switchAssistant(assistantId);
            return;
          }
          await manager.switchAssistant(assistantId);
          await context.refreshIdentityContext?.();
        };

        // Show interactive panel for no args or 'ui' command
        if (!action || action === 'ui') {
          context.emit('done');
          return { handled: true, showPanel: 'assistants' };
        }

        // Show current assistant info (text output for scripting)
        if (action === 'show' || action === 'info') {
          const active = manager.getActive();
          if (!active) {
            context.emit('text', 'No active assistant.\n');
          } else {
            context.emit('text', `Current assistant: ${active.name}\n`);
            context.emit('text', `ID: ${active.id}\n`);
            if (active.description) context.emit('text', `Description: ${active.description}\n`);
            context.emit('text', `Model: ${active.settings.model}\n`);
            if (active.settings.temperature !== undefined) {
              context.emit('text', `Temperature: ${active.settings.temperature}\n`);
            }
          }
          context.emit('done');
          return { handled: true };
        }

        if (action === 'list') {
          const assistants = manager.listAssistants();
          if (assistants.length === 0) {
            context.emit('text', 'No assistants found.\n');
          } else {
            context.emit('text', '\nAssistants:\n');
            for (const assistant of assistants) {
              const marker = manager.getActiveId() === assistant.id ? '*' : ' ';
              context.emit('text', ` ${marker} ${assistant.name} (${assistant.id})\n`);
            }
          }
          context.emit('done');
          return { handled: true };
        }

        if (action === 'create') {
          if (!target) {
            context.emit('text', 'Usage: /assistants create <name>\n');
            context.emit('done');
            return { handled: true };
          }
          const created = await manager.createAssistant({ name: target });
          await switchAssistantInContext(created.id);
          context.emit('text', `Created assistant ${created.name} (${created.id}).\n`);
          context.emit('done');
          return { handled: true };
        }

        if (action === 'switch') {
          if (!target) {
            context.emit('text', 'Usage: /assistants switch <name|id>\n');
            context.emit('done');
            return { handled: true };
          }
          const assistants = manager.listAssistants();
          const match = assistants.find((assistant) =>
            assistant.id === target || assistant.name.toLowerCase() === target.toLowerCase()
          );
          if (!match) {
            context.emit('text', `Assistant not found: ${target}\n`);
            context.emit('done');
            return { handled: true };
          }
          await switchAssistantInContext(match.id);
          context.emit('text', `Switched to ${match.name}.\n`);
          context.emit('done');
          return { handled: true };
        }

        if (action === 'delete') {
          if (!target) {
            context.emit('text', 'Usage: /assistants delete <name|id>\n');
            context.emit('done');
            return { handled: true };
          }
          const assistants = manager.listAssistants();
          if (assistants.length <= 1) {
            context.emit('text', 'Cannot delete the last remaining assistant.\n');
            context.emit('done');
            return { handled: true };
          }
          const match = assistants.find((assistant) =>
            assistant.id === target || assistant.name.toLowerCase() === target.toLowerCase()
          );
          if (!match) {
            context.emit('text', `Assistant not found: ${target}\n`);
            context.emit('done');
            return { handled: true };
          }
          const activeBeforeDelete = manager.getActiveId();
          await manager.deleteAssistant(match.id);
          if (activeBeforeDelete === match.id) {
            const nextActiveId = manager.getActiveId();
            if (nextActiveId) {
              await switchAssistantInContext(nextActiveId);
            }
          }
          context.emit('text', `Deleted assistant ${match.name}.\n`);
          context.emit('done');
          return { handled: true };
        }

        if (action === 'settings') {
          const active = manager.getActive();
          if (!active) {
            context.emit('text', 'No active assistant.\n');
            context.emit('done');
            return { handled: true };
          }
          context.emit('text', `Assistant settings for ${active.name}:\n`);
          context.emit('text', JSON.stringify(active.settings, null, 2) + '\n');
          context.emit('done');
          return { handled: true };
        }

        // /assistants prompt <text> - Set the assistant's system prompt addition
        if (action === 'prompt') {
          const active = manager.getActive();
          if (!active) {
            context.emit('text', 'No active assistant.\n');
            context.emit('done');
            return { handled: true };
          }

          if (!target) {
            // Show current prompt
            if (active.settings.systemPromptAddition) {
              context.emit('text', `Current system prompt for ${active.name}:\n`);
              context.emit('text', active.settings.systemPromptAddition + '\n');
            } else {
              context.emit('text', `No system prompt set for ${active.name}.\n`);
              context.emit('text', 'Usage: /assistants prompt <text>\n');
            }
            context.emit('done');
            return { handled: true };
          }

          // Set the prompt
          await manager.updateAssistant(active.id, {
            settings: {
              ...active.settings,
              systemPromptAddition: target,
            },
          });
          await context.refreshIdentityContext?.();
          context.emit('text', `System prompt updated for ${active.name}.\n`);
          context.emit('done');
          return { handled: true };
        }

        // /assistants prompt-clear - Clear the assistant's system prompt addition
        if (action === 'prompt-clear') {
          const active = manager.getActive();
          if (!active) {
            context.emit('text', 'No active assistant.\n');
            context.emit('done');
            return { handled: true };
          }

          const { systemPromptAddition, ...restSettings } = active.settings;
          await manager.updateAssistant(active.id, {
            settings: restSettings,
          });
          await context.refreshIdentityContext?.();
          context.emit('text', `System prompt cleared for ${active.name}.\n`);
          context.emit('done');
          return { handled: true };
        }

        if (action === 'update') {
          context.emit('text', 'To update assistants, run:\n');
          context.emit('text', '  bun install -g @hasna/assistants\n');
          context.emit('done');
          return { handled: true };
        }

        // /assistants help
        if (action === 'help') {
          context.emit('text', '\n## Assistant Commands\n\n');
          context.emit('text', '/assistants                   Open interactive assistant panel\n');
          context.emit('text', '/assistants show               Show current assistant info\n');
          context.emit('text', '/assistants list               List all assistants\n');
          context.emit('text', '/assistants create <name>      Create new assistant\n');
          context.emit('text', '/assistants switch <name|id>   Switch to assistant\n');
          context.emit('text', '/assistants delete <name|id>   Delete assistant\n');
          context.emit('text', '/assistants settings           Show assistant settings\n');
          context.emit('text', '/assistants prompt [text]      Get/set assistant system prompt\n');
          context.emit('text', '/assistants prompt-clear       Clear assistant system prompt\n');
          context.emit('text', '/assistants update             Update CLI via bun install -g\n');
          context.emit('text', '/assistants help               Show this help\n');
          context.emit('done');
          return { handled: true };
        }

        context.emit('text', 'Unknown /assistants command. Use /assistants help for options.\n');
        context.emit('done');
        return { handled: true };
      },
    };
  }

  /**
   * /hooks - Manage hooks (interactive panel)
   */
  private hooksCommand(): Command {
    return {
      name: 'hooks',
      description: 'View, enable, disable, and manage event hooks (pre/post tool use, etc.)',
      builtin: true,
      selfHandled: true,
      content: '',
      handler: async (args, context) => {
        const [action, ...rest] = args.trim().split(/\s+/).filter(Boolean);
        const hookId = rest[0];

        // Show interactive panel for no args or 'ui' command
        if (!action || action === 'ui') {
          context.emit('done');
          return { handled: true, showPanel: 'hooks' };
        }

        // Get hooks from context
        const hooks = context.getHooks?.() ?? {};

        // /hooks list - List all hooks
        if (action === 'list') {
          const events = Object.keys(hooks);
          const nativeHooks = nativeHookRegistry.listFlat();

          if (events.length === 0 && nativeHooks.length === 0) {
            context.emit('text', '\nNo hooks configured.\n');
            context.emit('done');
            return { handled: true };
          }

          // Show native hooks first
          if (nativeHooks.length > 0) {
            context.emit('text', '\n**Native Hooks**\n\n');
            for (const { hook, event, enabled } of nativeHooks) {
              const status = enabled ? '[on]' : '[off]';
              context.emit('text', `  ${status} ${hook.name || hook.id} (${event})\n`);
              context.emit('text', `       id: ${hook.id}\n`);
              if (hook.description) {
                context.emit('text', `       ${hook.description}\n`);
              }
            }
          }

          // Show user hooks
          if (events.length > 0) {
            context.emit('text', '\n**User Hooks**\n\n');
            for (const event of events) {
              const matchers = hooks[event] ?? [];
              const hookCount = matchers.reduce((sum, m) => sum + m.hooks.length, 0);
              context.emit('text', `**${event}** (${hookCount} hook${hookCount !== 1 ? 's' : ''})\n`);
              for (const matcher of matchers) {
                for (const hook of matcher.hooks) {
                  const status = hook.enabled !== false ? '[on]' : '[off]';
                  const name = hook.name || hook.command?.slice(0, 25) || hook.type;
                  const matcherStr = matcher.matcher ? `@${matcher.matcher}` : '';
                  context.emit('text', `  ${status} ${name} ${matcherStr}\n`);
                  if (hook.id) {
                    context.emit('text', `       id: ${hook.id}\n`);
                  }
                }
              }
            }
          }
          context.emit('done');
          return { handled: true };
        }

        // /hooks enable <id> - Enable a hook
        if (action === 'enable') {
          if (!hookId) {
            context.emit('text', 'Usage: /hooks enable <hook-id>\n');
            context.emit('done');
            return { handled: true };
          }
          // Try native hooks first
          if (nativeHookRegistry.getHook(hookId)) {
            nativeHookRegistry.setEnabled(hookId, true);
            context.emit('text', `Native hook ${hookId} enabled.\n`);
            context.emit('done');
            return { handled: true };
          }
          // Fall back to user hooks
          const result = await context.setHookEnabled?.(hookId, true);
          if (result) {
            context.emit('text', `Hook ${hookId} enabled.\n`);
          } else {
            context.emit('text', `Hook ${hookId} not found.\n`);
          }
          context.emit('done');
          return { handled: true };
        }

        // /hooks disable <id> - Disable a hook
        if (action === 'disable') {
          if (!hookId) {
            context.emit('text', 'Usage: /hooks disable <hook-id>\n');
            context.emit('done');
            return { handled: true };
          }
          // Try native hooks first
          if (nativeHookRegistry.getHook(hookId)) {
            nativeHookRegistry.setEnabled(hookId, false);
            context.emit('text', `Native hook ${hookId} disabled.\n`);
            context.emit('done');
            return { handled: true };
          }
          // Fall back to user hooks
          const result = await context.setHookEnabled?.(hookId, false);
          if (result) {
            context.emit('text', `Hook ${hookId} disabled.\n`);
          } else {
            context.emit('text', `Hook ${hookId} not found.\n`);
          }
          context.emit('done');
          return { handled: true };
        }

        // /hooks test <id> - Test a hook with sample input
        if (action === 'test') {
          if (!hookId) {
            context.emit('text', 'Usage: /hooks test <hook-id>\n');
            context.emit('done');
            return { handled: true };
          }

          // Find the hook by ID
          const store = new HookStore(context.cwd, context.getStorageDir?.());
          const hookInfo = store.getHook(hookId);

          if (!hookInfo) {
            context.emit('text', `Hook '${hookId}' not found.\n`);
            context.emit('done');
            return { handled: true };
          }

          // Test the hook
          const tester = new HookTester(context.cwd, context.sessionId);
          context.emit('text', `\n**Testing hook:** ${hookInfo.handler.name || hookId} (${hookInfo.event})\n`);
          context.emit('text', `${'━'.repeat(50)}\n`);

          const sampleInput = HookTester.getSampleInput(hookInfo.event);
          context.emit('text', `**Input:** ${JSON.stringify(sampleInput, null, 2)}\n\n`);

          const result = await tester.test(hookInfo.handler, hookInfo.event);

          context.emit('text', `**Exit code:** ${result.exitCode ?? 'N/A'}\n`);
          if (result.stdout) {
            context.emit('text', `**Stdout:**\n\`\`\`\n${result.stdout}\n\`\`\`\n`);
          } else {
            context.emit('text', `**Stdout:** (empty)\n`);
          }
          if (result.stderr) {
            context.emit('text', `**Stderr:**\n\`\`\`\n${result.stderr}\n\`\`\`\n`);
          } else {
            context.emit('text', `**Stderr:** (empty)\n`);
          }
          context.emit('text', `\n**Result:** ${result.action}\n`);
          if (result.reason) {
            context.emit('text', `**Reason:** ${result.reason}\n`);
          }
          if (result.error) {
            context.emit('text', `**Error:** ${result.error}\n`);
          }
          context.emit('text', `**Duration:** ${result.durationMs}ms\n`);

          context.emit('done');
          return { handled: true };
        }

        // /hooks help
        if (action === 'help') {
          context.emit('text', '\n## Hook Commands\n\n');
          context.emit('text', '/hooks                        Open interactive hooks panel\n');
          context.emit('text', '/hooks list                   List all hooks\n');
          context.emit('text', '/hooks enable <id>            Enable a hook\n');
          context.emit('text', '/hooks disable <id>           Disable a hook\n');
          context.emit('text', '/hooks test <id>              Test a hook with sample input\n');
          context.emit('text', '/hooks help                   Show this help\n');
          context.emit('done');
          return { handled: true };
        }

        context.emit('text', 'Unknown /hooks command. Use /hooks help for options.\n');
        context.emit('done');
        return { handled: true };
      },
    };
  }

  /**
   * /identity - Manage identities
   */
  private identityCommand(): Command {
    return {
      name: 'identity',
      description: 'Manage identities for the current assistant',
      builtin: true,
      selfHandled: true,
      content: '',
      handler: async (args, context) => {
        const manager = context.getIdentityManager?.();
        if (!manager) {
          context.emit('text', 'Identity manager not available.\n');
          context.emit('done');
          return { handled: true };
        }

        const [action, ...rest] = args.trim().split(/\s+/).filter(Boolean);
        const target = rest.join(' ');

        if (!action || action === 'ui') {
          context.emit('done');
          return { handled: true, showPanel: 'identity' };
        }

        if (action === 'list') {
          const identities = manager.listIdentities();
          if (identities.length === 0) {
            context.emit('text', 'No identities found.\n');
          } else {
            context.emit('text', '\nIdentities:\n');
            for (const identity of identities) {
              const marker = manager.getActive()?.id === identity.id ? '*' : ' ';
              context.emit('text', ` ${marker} ${identity.name} (${identity.id})\n`);
            }
          }
          context.emit('done');
          return { handled: true };
        }

        if (action === 'create') {
          // Check for --template flag
          const templateIndex = rest.indexOf('--template');
          if (templateIndex !== -1) {
            const templateName = rest[templateIndex + 1];
            if (!templateName) {
              context.emit('text', 'Usage: /identity create --template <template-name>\n');
              context.emit('text', 'Use /identity templates to see available templates.\n');
              context.emit('done');
              return { handled: true };
            }
            const createOptions = createIdentityFromTemplate(templateName);
            if (!createOptions) {
              context.emit('text', `Template not found: ${templateName}\n`);
              context.emit('text', 'Use /identity templates to see available templates.\n');
              context.emit('done');
              return { handled: true };
            }
            const created = await manager.createIdentity(createOptions);
            await context.refreshIdentityContext?.();
            context.emit('text', `Created identity "${created.name}" from template "${templateName}" (${created.id}).\n`);
            context.emit('done');
            return { handled: true };
          }

          if (!target) {
            context.emit('text', 'Usage: /identity create <name>\n');
            context.emit('text', 'Or: /identity create --template <template-name>\n');
            context.emit('done');
            return { handled: true };
          }
          const created = await manager.createIdentity({ name: target });
          await context.refreshIdentityContext?.();
          context.emit('text', `Created identity ${created.name} (${created.id}).\n`);
          context.emit('done');
          return { handled: true };
        }

        if (action === 'switch') {
          if (!target) {
            context.emit('text', 'Usage: /identity switch <name|id>\n');
            context.emit('done');
            return { handled: true };
          }
          const identities = manager.listIdentities();
          const match = identities.find((identity) =>
            identity.id === target || identity.name.toLowerCase() === target.toLowerCase()
          );
          if (!match) {
            context.emit('text', `Identity not found: ${target}\n`);
            context.emit('done');
            return { handled: true };
          }
          await context.switchIdentity?.(match.id);
          context.emit('text', `Switched to ${match.name}.\n`);
          context.emit('done');
          return { handled: true };
        }

        if (action === 'delete') {
          if (!target) {
            context.emit('text', 'Usage: /identity delete <name|id>\n');
            context.emit('done');
            return { handled: true };
          }
          const identities = manager.listIdentities();
          const match = identities.find((identity) =>
            identity.id === target || identity.name.toLowerCase() === target.toLowerCase()
          );
          if (!match) {
            context.emit('text', `Identity not found: ${target}\n`);
            context.emit('done');
            return { handled: true };
          }
          await manager.deleteIdentity(match.id);
          await context.refreshIdentityContext?.();
          context.emit('text', `Deleted identity ${match.name}.\n`);
          context.emit('done');
          return { handled: true };
        }

        // /identity templates - List available templates
        if (action === 'templates') {
          const templates = listTemplates();
          context.emit('text', '\n## Identity Templates\n\n');
          for (const t of templates) {
            context.emit('text', `**${t.name}** - ${t.description}\n`);
          }
          context.emit('text', '\nUsage: /identity create --template <name>\n');
          context.emit('done');
          return { handled: true };
        }

        // /identity edit <name|id> - Open identity panel for editing
        // /identity show <name|id> - Show identity details
        if (action === 'edit' || action === 'show') {
          if (!target) {
            context.emit('text', `Usage: /identity ${action} <name|id>\n`);
            context.emit('done');
            return { handled: true };
          }
          const identities = manager.listIdentities();
          const match = identities.find((identity) =>
            identity.id === target || identity.name.toLowerCase() === target.toLowerCase()
          );
          if (!match) {
            context.emit('text', `Identity not found: ${target}\n`);
            context.emit('done');
            return { handled: true };
          }
          if (action === 'edit') {
            context.emit('done');
            return { handled: true, showPanel: 'identity', panelValue: `edit:${match.id}` };
          }
          context.emit('text', '\n## Identity Details\n\n');
          context.emit('text', `**Name:** ${match.name}\n`);
          context.emit('text', `**ID:** ${match.id}\n`);
          context.emit('text', `**Display Name:** ${match.profile.displayName}\n`);
          if (match.profile.title) context.emit('text', `**Title:** ${match.profile.title}\n`);
          if (match.profile.company) context.emit('text', `**Company:** ${match.profile.company}\n`);
          context.emit('text', `**Timezone:** ${match.profile.timezone}\n`);
          context.emit('text', `**Locale:** ${match.profile.locale}\n`);
          context.emit('text', `**Communication Style:** ${match.preferences.communicationStyle}\n`);
          context.emit('text', `**Response Length:** ${match.preferences.responseLength}\n`);
          if (match.context) {
            context.emit('text', `**Context:**\n${match.context}\n`);
          }
          context.emit('text', `**Default:** ${match.isDefault ? 'Yes' : 'No'}\n`);
          context.emit('text', '\nTo update fields, use the web UI or edit the identity file directly.\n');
          context.emit('done');
          return { handled: true };
        }

        // /identity set-default <name|id> - Set as default
        if (action === 'set-default' || action === 'default') {
          if (!target) {
            context.emit('text', 'Usage: /identity set-default <name|id>\n');
            context.emit('done');
            return { handled: true };
          }
          const identities = manager.listIdentities();
          const match = identities.find((identity) =>
            identity.id === target || identity.name.toLowerCase() === target.toLowerCase()
          );
          if (!match) {
            context.emit('text', `Identity not found: ${target}\n`);
            context.emit('done');
            return { handled: true };
          }
          // Remove default from all, set on this one
          for (const identity of identities) {
            if (identity.isDefault && identity.id !== match.id) {
              await manager.updateIdentity(identity.id, { isDefault: false });
            }
          }
          await manager.updateIdentity(match.id, { isDefault: true });
          context.emit('text', `Set ${match.name} as default identity.\n`);
          context.emit('done');
          return { handled: true };
        }

        // /identity help - Show help
        if (action === 'help') {
          context.emit('text', '\n## Identity Commands\n\n');
          context.emit('text', '/identity                        Show current identity\n');
          context.emit('text', '/identity list                   List all identities\n');
          context.emit('text', '/identity create <name>          Create new identity\n');
          context.emit('text', '/identity create --template <t>  Create from template\n');
          context.emit('text', '/identity switch <name|id>       Switch to identity\n');
          context.emit('text', '/identity show <name|id>         Show identity details\n');
          context.emit('text', '/identity edit <name|id>         Edit identity in panel\n');
          context.emit('text', '/identity set-default <name|id>  Set as default\n');
          context.emit('text', '/identity delete <name|id>       Delete identity\n');
          context.emit('text', '/identity templates              List available templates\n');
          context.emit('text', '/identity help                   Show this help\n');
          context.emit('done');
          return { handled: true };
        }

        context.emit('text', 'Unknown /identity command. Use /identity help for options.\n');
        context.emit('done');
        return { handled: true };
      },
    };
  }

  /**
   * /whoami - Show current assistant + identity
   */
  private whoamiCommand(): Command {
    return {
      name: 'whoami',
      description: 'Show active assistant, identity profile, and current configuration',
      builtin: true,
      selfHandled: true,
      content: '',
      handler: async (_args, context) => {
        const assistant = context.getAssistantManager?.()?.getActive();
        const identity = context.getIdentityManager?.()?.getActive();
        const model = context.getModel?.();

        if (!assistant && !identity) {
          context.emit('text', 'No active assistant or identity.\n');
          if (model) {
            context.emit('text', `Model: ${model}\n`);
          }
          context.emit('done');
          return { handled: true };
        }

        if (assistant) {
          context.emit('text', `Assistant: ${assistant.name}\n`);
        }

        if (identity) {
          context.emit('text', `Identity: ${identity.name}\n`);
          context.emit('text', `Display name: ${identity.profile.displayName || identity.name}\n`);
        } else if (assistant) {
          context.emit('text', 'Identity: (not configured)\n');
        }

        if (model) {
          context.emit('text', `Model: ${model}\n`);
        }

        context.emit('done');
        return { handled: true };
      },
    };
  }

  /**
   * Update token usage
   */
  updateTokenUsage(usage: Partial<TokenUsage>): void {
    Object.assign(this.tokenUsage, usage);
  }

  /**
   * Get current token usage
   */
  getTokenUsage(): TokenUsage {
    return { ...this.tokenUsage };
  }

  /**
   * /help - Show available commands
   */
  private helpCommand(loader: CommandLoader): Command {
    return {
      name: 'help',
      description: 'Show all available slash commands and their descriptions',
      builtin: true,
      selfHandled: true,
      content: '',
      handler: async (args, context) => {
        const commands = loader.getCommands();
        const builtinByName = new Map<string, Command>();
        const customByName = new Map<string, Command>();

        for (const cmd of commands) {
          if (cmd.builtin) {
            builtinByName.set(cmd.name, cmd);
          } else {
            customByName.set(cmd.name, cmd);
          }
        }

        const builtinNames = Array.from(builtinByName.keys());
        const customNames = Array.from(customByName.keys());
        builtinNames.sort();
        customNames.sort();

        let message = '\n**Available Slash Commands**\n\n';

        if (builtinNames.length > 0) {
          message += '**Built-in Commands:**\n';
          for (const name of builtinNames) {
            const cmd = builtinByName.get(name);
            if (!cmd) continue;
            message += `  /${name} - ${cmd.description}\n`;
          }
          message += '\n';
        }

        if (customNames.length > 0) {
          message += '**Custom Commands:**\n';
          for (const name of customNames) {
            const cmd = customByName.get(name);
            if (!cmd) continue;
            message += `  /${name} - ${cmd.description}\n`;
          }
          message += '\n';
        }

        message += '**Tips:**\n';
        message += '  - Create custom commands in .assistants/commands/*.md\n';
        message += '  - Global commands go in ~/.assistants/commands/*.md\n';
        message += '  - Use /init to create a starter command\n';
        message += '  - The assistant can use the wait/sleep tool to pause between actions\n';

        context.emit('text', message);
        context.emit('done');
        return { handled: true };
      },
    };
  }

  /**
   * /clear - Clear conversation history
   */
  private clearCommand(): Command {
    return {
      name: 'clear',
      description: 'Clear current conversation history and reset context',
      builtin: true,
      selfHandled: true,
      content: '',
      handler: async (args, context) => {
        context.clearMessages();
        this.tokenUsage.inputTokens = 0;
        this.tokenUsage.outputTokens = 0;
        this.tokenUsage.totalTokens = 0;
        this.tokenUsage.cacheReadTokens = 0;
        this.tokenUsage.cacheWriteTokens = 0;
        context.emit('text', 'Conversation cleared. Starting fresh.\n');
        context.emit('done');
        return { handled: true, clearConversation: true };
      },
    };
  }

  /**
   * /new - Start a new conversation (alias for /clear)
   */
  private newCommand(): Command {
    return {
      name: 'new',
      description: 'Start a new conversation session (preserves previous session)',
      builtin: true,
      selfHandled: true,
      content: '',
      handler: async (args, context) => {
        context.clearMessages();
        this.tokenUsage.inputTokens = 0;
        this.tokenUsage.outputTokens = 0;
        this.tokenUsage.totalTokens = 0;
        this.tokenUsage.cacheReadTokens = 0;
        this.tokenUsage.cacheWriteTokens = 0;
        context.emit('text', 'Starting new conversation.\n');
        context.emit('done');
        return { handled: true, clearConversation: true };
      },
    };
  }

  /**
   * /guardrails - Manage security guardrails and policies
   */
  private guardrailsCommand(): Command {
    return {
      name: 'guardrails',
      description: 'View and manage security guardrails and policies',
      builtin: true,
      selfHandled: true,
      content: '',
      handler: async (args, context) => {
        // Import guardrails modules
        const {
          PolicyEvaluator,
          DEFAULT_GUARDRAILS_CONFIG,
          PERMISSIVE_POLICY,
          RESTRICTIVE_POLICY,
        } = await import('../guardrails');

        const [action, ...rest] = args.trim().toLowerCase().split(/\s+/);
        const target = rest.join(' ');

        // Create evaluator instance
        const evaluator = new PolicyEvaluator(context.guardrailsConfig);

        // /guardrails help
        if (action === 'help') {
          let message = '\n## Guardrails Commands\n\n';
          message += '/guardrails                       Open interactive panel\n';
          message += '/guardrails ui                    Open interactive panel\n';
          message += '/guardrails status                Show text status summary\n';
          message += '/guardrails enable                Enable guardrails enforcement\n';
          message += '/guardrails disable               Disable guardrails enforcement\n';
          message += '/guardrails policies              List all policies\n';
          message += '/guardrails preset <name>         Apply a preset (permissive/restrictive)\n';
          message += '/guardrails add-rule <pattern> <action>   Add a tool rule\n';
          message += '/guardrails remove-rule <pattern>         Remove a tool rule\n';
          message += '/guardrails check <tool>          Check if a tool is allowed\n';
          message += '/guardrails help                  Show this help\n';
          message += '\n**Presets:**\n';
          message += '  - `permissive`: Allow most operations, deny only dangerous commands\n';
          message += '  - `restrictive`: Require approval for most operations, deny shell\n';
          context.emit('text', message);
          context.emit('done');
          return { handled: true };
        }

        // /guardrails enable
        if (action === 'enable') {
          if (context.setGuardrailsEnabled) {
            context.setGuardrailsEnabled(true);
            context.emit('text', '\n✓ Guardrails enforcement **enabled**\n');
          } else {
            context.emit('text', '\n⚠ Guardrails control not available in this context\n');
          }
          context.emit('done');
          return { handled: true };
        }

        // /guardrails disable
        if (action === 'disable') {
          if (context.setGuardrailsEnabled) {
            context.setGuardrailsEnabled(false);
            context.emit('text', '\n✓ Guardrails enforcement **disabled**\n');
          } else {
            context.emit('text', '\n⚠ Guardrails control not available in this context\n');
          }
          context.emit('done');
          return { handled: true };
        }

        // /guardrails preset <name>
        if (action === 'preset') {
          if (!target) {
            context.emit('text', '\nUsage: /guardrails preset <permissive|restrictive>\n');
            context.emit('done');
            return { handled: true };
          }

          if (target === 'permissive') {
            if (context.addGuardrailsPolicy) {
              context.addGuardrailsPolicy(PERMISSIVE_POLICY);
              context.emit('text', '\n✓ Applied **permissive** policy preset\n');
              context.emit('text', '  - Most operations allowed\n');
              context.emit('text', '  - Only dangerous commands denied\n');
            } else {
              context.emit('text', '\n⚠ Cannot add policy in this context\n');
            }
          } else if (target === 'restrictive') {
            if (context.addGuardrailsPolicy) {
              context.addGuardrailsPolicy(RESTRICTIVE_POLICY);
              context.emit('text', '\n✓ Applied **restrictive** policy preset\n');
              context.emit('text', '  - Most operations require approval\n');
              context.emit('text', '  - Shell commands denied\n');
              context.emit('text', '  - Rate limits enforced\n');
            } else {
              context.emit('text', '\n⚠ Cannot add policy in this context\n');
            }
          } else {
            context.emit('text', `\n⚠ Unknown preset: ${target}\n`);
            context.emit('text', 'Available presets: permissive, restrictive\n');
          }
          context.emit('done');
          return { handled: true };
        }

        // /guardrails policies
        if (action === 'policies') {
          const config = evaluator.getConfig();
          let message = '\n**Guardrails Policies**\n\n';

          if (config.policies.length === 0) {
            message += 'No policies configured.\n';
          } else {
            for (const policy of config.policies) {
              const status = policy.enabled ? '✓' : '○';
              message += `${status} **${policy.name || policy.id || 'Unnamed'}** (${policy.scope})\n`;

              if (policy.tools?.rules && policy.tools.rules.length > 0) {
                message += `    Tool rules: ${policy.tools.rules.length}\n`;
              }
              if (policy.depth) {
                message += `    Max depth: ${policy.depth.maxDepth}\n`;
              }
              if (policy.rateLimits) {
                message += `    Rate limits: ${policy.rateLimits.toolCallsPerMinute || '-'} tool/min\n`;
              }
            }
          }

          context.emit('text', message);
          context.emit('done');
          return { handled: true };
        }

        // /guardrails add-rule <pattern> <action>
        if (action === 'add-rule') {
          const parts = target.split(/\s+/);
          if (parts.length < 2) {
            context.emit('text', '\nUsage: /guardrails add-rule <pattern> <allow|deny|warn|require_approval>\n');
            context.emit('text', '\nExamples:\n');
            context.emit('text', '  /guardrails add-rule bash:* deny\n');
            context.emit('text', '  /guardrails add-rule file:write warn\n');
            context.emit('text', '  /guardrails add-rule connector:* require_approval\n');
            context.emit('done');
            return { handled: true };
          }

          const pattern = parts[0];
          const ruleAction = parts[1] as 'allow' | 'deny' | 'warn' | 'require_approval';

          if (!['allow', 'deny', 'warn', 'require_approval'].includes(ruleAction)) {
            context.emit('text', `\n⚠ Invalid action: ${ruleAction}\n`);
            context.emit('text', 'Valid actions: allow, deny, warn, require_approval\n');
            context.emit('done');
            return { handled: true };
          }

          if (context.addGuardrailsPolicy) {
            // Add a new session policy with this rule
            const policy = {
              id: `session-rule-${Date.now()}`,
              name: `Rule: ${pattern} → ${ruleAction}`,
              scope: 'session' as const,
              enabled: true,
              tools: {
                defaultAction: 'allow' as const,
                rules: [
                  {
                    pattern,
                    action: ruleAction,
                    reason: 'Added via /guardrails command',
                  },
                ],
              },
            };
            context.addGuardrailsPolicy(policy);
            context.emit('text', `\n✓ Added rule: ${pattern} → **${ruleAction}**\n`);
          } else {
            context.emit('text', '\n⚠ Cannot add rules in this context\n');
          }
          context.emit('done');
          return { handled: true };
        }

        // /guardrails remove-rule <pattern>
        if (action === 'remove-rule') {
          if (!target) {
            context.emit('text', '\nUsage: /guardrails remove-rule <pattern>\n');
            context.emit('done');
            return { handled: true };
          }

          if (context.removeGuardrailsPolicy) {
            // Try to find and remove policy with matching rule
            const config = evaluator.getConfig();
            let removed = false;
            for (const policy of config.policies) {
              if (policy.tools?.rules?.some((r) => r.pattern === target)) {
                context.removeGuardrailsPolicy(policy.id || '');
                removed = true;
                break;
              }
            }

            if (removed) {
              context.emit('text', `\n✓ Removed rule for pattern: ${target}\n`);
            } else {
              context.emit('text', `\n⚠ No rule found matching pattern: ${target}\n`);
            }
          } else {
            context.emit('text', '\n⚠ Cannot remove rules in this context\n');
          }
          context.emit('done');
          return { handled: true };
        }

        // /guardrails check <tool>
        if (action === 'check') {
          if (!target) {
            context.emit('text', '\nUsage: /guardrails check <tool-name>\n');
            context.emit('text', '\nExamples:\n');
            context.emit('text', '  /guardrails check bash\n');
            context.emit('text', '  /guardrails check file:write\n');
            context.emit('text', '  /guardrails check connector:notion\n');
            context.emit('done');
            return { handled: true };
          }

          const result = evaluator.evaluateToolUse({ toolName: target });

          let message = `\n**Guardrails Check: ${target}**\n\n`;
          message += `Status: ${result.allowed ? '✓ **ALLOWED**' : '✗ **DENIED**'}\n`;
          message += `Action: ${result.action}\n`;

          if (result.requiresApproval) {
            message += `⚠ Requires approval\n`;
            if (result.approvalDetails?.timeout) {
              message += `  Timeout: ${Math.round(result.approvalDetails.timeout / 1000)}s\n`;
            }
          }

          if (result.warnings.length > 0) {
            message += `\nWarnings:\n`;
            for (const warning of result.warnings) {
              message += `  - ${warning}\n`;
            }
          }

          if (result.reasons.length > 0) {
            message += `\nReasons:\n`;
            for (const reason of result.reasons) {
              message += `  - ${reason}\n`;
            }
          }

          if (result.matchedRules.length > 0) {
            message += `\nMatched rules:\n`;
            for (const match of result.matchedRules) {
              const rule = match.rule;
              if ('pattern' in rule) {
                message += `  - ${rule.pattern} → ${rule.action}`;
                if ('reason' in rule && rule.reason) message += ` (${rule.reason})`;
                message += `\n`;
              }
            }
          }

          context.emit('text', message);
          context.emit('done');
          return { handled: true };
        }

        // /guardrails - Show interactive panel
        if (!action || action === 'ui') {
          context.emit('done');
          return { handled: true, showPanel: 'guardrails' };
        }

        // /guardrails status - Show text status
        const config = evaluator.getConfig();
        let message = '\n**Guardrails Status**\n\n';
        message += `Enforcement: ${config.enabled ? '**enabled**' : 'disabled'}\n`;
        message += `Default action: ${config.defaultAction}\n`;
        message += `Policies: ${config.policies.length}\n`;

        // Show active policies summary
        const activePolicies = config.policies.filter((p) => p.enabled);
        if (activePolicies.length > 0) {
          message += '\n## Active Policies\n';
          for (const policy of activePolicies) {
            message += `  - ${policy.name || policy.id || 'Unnamed'} (${policy.scope})\n`;
          }
        }

        // Show summary of rules
        let totalRules = 0;
        let denyRules = 0;
        let approvalRules = 0;
        let warnRules = 0;

        for (const policy of activePolicies) {
          if (policy.tools?.rules) {
            for (const rule of policy.tools.rules) {
              totalRules++;
              if (rule.action === 'deny') denyRules++;
              if (rule.action === 'require_approval') approvalRules++;
              if (rule.action === 'warn') warnRules++;
            }
          }
        }

        if (totalRules > 0) {
          message += '\n## Rule Summary\n';
          message += `  Total rules: ${totalRules}\n`;
          if (denyRules > 0) message += `  Deny: ${denyRules}\n`;
          if (approvalRules > 0) message += `  Require approval: ${approvalRules}\n`;
          if (warnRules > 0) message += `  Warn: ${warnRules}\n`;
        }

        // Check depth limits
        const depthPolicies = activePolicies.filter((p) => p.depth);
        if (depthPolicies.length > 0) {
          const minDepth = Math.min(...depthPolicies.map((p) => p.depth!.maxDepth));
          message += `\n## Depth Limits\n`;
          message += `  Max assistant depth: ${minDepth}\n`;
        }

        // Check rate limits
        const rateLimitPolicies = activePolicies.filter((p) => p.rateLimits);
        if (rateLimitPolicies.length > 0) {
          message += `\n## Rate Limits\n`;
          const first = rateLimitPolicies[0].rateLimits!;
          if (first.toolCallsPerMinute) message += `  Tool calls: ${first.toolCallsPerMinute}/min\n`;
          if (first.llmCallsPerMinute) message += `  LLM calls: ${first.llmCallsPerMinute}/min\n`;
          if (first.externalRequestsPerMinute) message += `  External requests: ${first.externalRequestsPerMinute}/min\n`;
        }

        message += '\n*Use `/guardrails help` for available commands*\n';

        context.emit('text', message);
        context.emit('done');
        return { handled: true };
      },
    };
  }

  /**
   * /verification - Manage scope verification feature
   */
  private verificationCommand(): Command {
    return {
      name: 'verification',
      description: 'Manage scope verification (list/view/enable/disable)',
      builtin: true,
      selfHandled: true,
      content: '',
      handler: async (args, context) => {
        const arg = args.trim().toLowerCase();
        const store = new VerificationSessionStore(context.getStorageDir?.() || getConfigDir());

        if (arg === 'disable' || arg === 'off') {
          nativeHookRegistry.setConfig({
            ...nativeHookRegistry.getConfig(),
            scopeVerification: {
              ...nativeHookRegistry.getConfig().scopeVerification,
              enabled: false,
            },
          });
          context.emit('text', 'Scope verification disabled.\n');
          context.emit('done');
          return { handled: true };
        }

        if (arg === 'enable' || arg === 'on') {
          nativeHookRegistry.setConfig({
            ...nativeHookRegistry.getConfig(),
            scopeVerification: {
              ...nativeHookRegistry.getConfig().scopeVerification,
              enabled: true,
            },
          });
          context.emit('text', 'Scope verification enabled.\n');
          context.emit('done');
          return { handled: true };
        }

        if (arg === 'status') {
          const config = nativeHookRegistry.getConfig();
          const enabled = config.scopeVerification?.enabled !== false;
          const maxRetries = config.scopeVerification?.maxRetries ?? 2;
          context.emit('text', `Scope verification: ${enabled ? 'enabled' : 'disabled'}\n`);
          context.emit('text', `Max retries: ${maxRetries}\n`);
          context.emit('done');
          return { handled: true };
        }

        if (arg === '' || arg === 'list') {
          const sessions = store.listRecent(10);
          if (sessions.length === 0) {
            context.emit('text', 'No verification sessions found.\n');
            context.emit('done');
            return { handled: true };
          }

          context.emit('text', 'Recent verification sessions:\n\n');
          for (const session of sessions) {
            const date = new Date(session.createdAt).toLocaleString();
            const status = session.result === 'pass' ? '✓' : session.result === 'force-continue' ? '→' : '✗';
            context.emit('text', `${status} ${session.id.slice(0, 8)} - ${date} - ${session.result}\n`);
            context.emit('text', `  Goals: ${session.goals.slice(0, 2).join(', ')}${session.goals.length > 2 ? '...' : ''}\n`);
          }
          context.emit('text', '\nUse /verification <id> to view details.\n');
          context.emit('done');
          return { handled: true };
        }

        // Try to find a session by ID (partial match)
        const sessions = store.listRecent(100);
        const match = sessions.find((s) => s.id.startsWith(arg) || s.id === arg);

        if (!match) {
          context.emit('text', `No verification session found matching "${arg}".\n`);
          context.emit('done');
          return { handled: true };
        }

        // Display session details
        context.emit('text', `\n=== Verification Session ${match.id} ===\n\n`);
        context.emit('text', `Created: ${new Date(match.createdAt).toLocaleString()}\n`);
        context.emit('text', `Parent Session: ${match.parentSessionId}\n`);
        context.emit('text', `Result: ${match.result}\n\n`);

        context.emit('text', `Goals:\n`);
        for (const goal of match.goals) {
          context.emit('text', `  • ${goal}\n`);
        }

        context.emit('text', `\nAnalysis:\n`);
        for (const analysis of match.verificationResult.goalsAnalysis) {
          const icon = analysis.met ? '✓' : '✗';
          context.emit('text', `  ${icon} ${analysis.goal}\n`);
          context.emit('text', `    ${analysis.evidence}\n`);
        }

        context.emit('text', `\nReason: ${match.reason}\n`);

        if (match.suggestions && match.suggestions.length > 0) {
          context.emit('text', `\nSuggestions:\n`);
          for (const suggestion of match.suggestions) {
            context.emit('text', `  • ${suggestion}\n`);
          }
        }

        context.emit('done');
        return { handled: true };
      },
    };
  }

  /**
   * /exit - Exit assistants
   */
  /**
   * /inbox - Manage assistant inbox
   */
  /**
   * /wallet - Manage assistant payment cards
   */
  private walletCommand(): Command {
    return {
      name: 'wallet',
      description: 'Manage payment cards in the assistant wallet',
      builtin: true,
      selfHandled: true,
      content: '',
      handler: async (args, context) => {
        const manager = context.getWalletManager?.();
        if (!manager) {
          context.emit('text', 'Wallet is not enabled. Configure wallet in config.json.\n');
          context.emit('text', '\nTo enable:\n');
          context.emit('text', '```json\n');
          context.emit('text', '{\n');
          context.emit('text', '  "wallet": {\n');
          context.emit('text', '    "enabled": true,\n');
          context.emit('text', '    "storage": {\n');
          context.emit('text', '      "provider": "local"\n');
          context.emit('text', '    }\n');
          context.emit('text', '  }\n');
          context.emit('text', '}\n');
          context.emit('text', '```\n');
          context.emit('text', '\nOptional AWS backend:\n');
          context.emit('text', '```json\n');
          context.emit('text', '{\n');
          context.emit('text', '  "wallet": {\n');
          context.emit('text', '    "enabled": true,\n');
          context.emit('text', '    "storage": { "provider": "aws" },\n');
          context.emit('text', '    "secrets": { "region": "us-east-1" }\n');
          context.emit('text', '  }\n');
          context.emit('text', '}\n');
          context.emit('text', '```\n');
          context.emit('done');
          return { handled: true };
        }

        const parts = splitArgs(args);
        const subcommand = parts[0]?.toLowerCase() || '';

        // Interactive UI mode - default when no args or explicit 'ui'
        if (!subcommand || subcommand === 'ui') {
          context.emit('done');
          return { handled: true, showPanel: 'wallet' as const };
        }

        // /wallet list
        if (subcommand === 'list') {
          try {
            const cards = await manager.list();

            if (cards.length === 0) {
              context.emit('text', 'No cards stored in wallet.\n');
              context.emit('text', 'Use /wallet add to add a card.\n');
            } else {
              context.emit('text', `\n## Wallet (${cards.length} card${cards.length === 1 ? '' : 's'})\n\n`);
              for (const card of cards) {
                context.emit('text', `💳 **${card.name}** (${card.id})\n`);
                context.emit('text', `   **** **** **** ${card.last4}\n`);
                context.emit('text', `   Expires: ${card.expiry}\n\n`);
              }
              const status = manager.getRateLimitStatus();
              context.emit('text', `---\nRate limit: ${status.readsUsed}/${status.maxReads} reads this hour\n`);
            }
          } catch (error) {
            context.emit('text', `Error: ${error instanceof Error ? error.message : String(error)}\n`);
          }
          context.emit('done');
          return { handled: true };
        }

        // /wallet add
        if (subcommand === 'add') {
          context.emit('done');
          return { handled: true, showPanel: 'wallet', panelValue: 'add' };
        }

        // /wallet remove <id>
        if (subcommand === 'remove') {
          const cardId = parts[1];
          if (!cardId) {
            context.emit('text', 'Usage: /wallet remove <card-id>\n');
            context.emit('done');
            return { handled: true };
          }

          try {
            const result = await manager.remove(cardId);
            if (result.success) {
              context.emit('text', `✓ ${result.message}\n`);
            } else {
              context.emit('text', `Error: ${result.message}\n`);
            }
          } catch (error) {
            context.emit('text', `Error: ${error instanceof Error ? error.message : String(error)}\n`);
          }
          context.emit('done');
          return { handled: true };
        }

        // /wallet status
        if (subcommand === 'status') {
          const status = manager.getRateLimitStatus();
          const credCheck = await manager.checkCredentials();
          const storageMode = typeof (manager as any).getStorageMode === 'function'
            ? (manager as any).getStorageMode()
            : 'unknown';

          context.emit('text', '\n## Wallet Status\n\n');
          context.emit('text', `Storage: ${storageMode}\n`);
          context.emit('text', `Credentials: ${credCheck.valid ? '✓ Valid' : '✗ Invalid'}\n`);
          if (!credCheck.valid && credCheck.error) {
            context.emit('text', `  Error: ${credCheck.error}\n`);
          }
          context.emit('text', `Rate Limit: ${status.readsUsed}/${status.maxReads} reads used\n`);
          context.emit('text', `Window Reset: ${status.windowResetMinutes} minutes\n`);
          context.emit('done');
          return { handled: true };
        }

        // /wallet warning
        if (subcommand === 'warning') {
          context.emit('text', '\n## ⚠️ PCI DSS Compliance Warning\n\n');
          context.emit('text', 'Storing payment card data requires compliance with PCI DSS (Payment Card Industry Data Security Standard).\n\n');
          context.emit('text', '**Before storing cards, ensure:**\n');
          context.emit('text', '1. You have explicit permission to store the card data\n');
          context.emit('text', '2. Your AWS account has appropriate security controls\n');
          context.emit('text', '3. Access is restricted to authorized personnel only\n');
          context.emit('text', '4. You maintain audit logs of card access\n');
          context.emit('text', '5. Cards are encrypted at rest (backend-dependent)\n\n');
          context.emit('text', '**This wallet system provides:**\n');
          context.emit('text', '- Storage backend selection (local or AWS)\n');
          context.emit('text', '- Rate limiting to prevent abuse\n');
          context.emit('text', '- Assistant isolation (cards scoped by assistant ID)\n');
          context.emit('text', '- Local storage under .assistants when configured\n');
          context.emit('text', '- 30-day soft delete for AWS Secrets Manager backend\n\n');
          context.emit('text', '**You are responsible for:**\n');
          context.emit('text', '- Proper AWS IAM policies\n');
          context.emit('text', '- Network security and access controls\n');
          context.emit('text', '- Compliance with applicable regulations\n');
          context.emit('done');
          return { handled: true };
        }

        // /wallet help
        if (subcommand === 'help') {
          context.emit('text', '\n## Wallet Commands\n\n');
          context.emit('text', '/wallet                  Interactive wallet manager\n');
          context.emit('text', '/wallet list             List stored cards\n');
          context.emit('text', '/wallet add              Open add-card form\n');
          context.emit('text', '/wallet remove <id>      Remove a card by ID\n');
          context.emit('text', '/wallet status           Show wallet status and credentials\n');
          context.emit('text', '/wallet warning          Show PCI compliance warning\n');
          context.emit('text', '/wallet help             Show this help\n\n');
          context.emit('text', '## Tools\n\n');
          context.emit('text', 'wallet_list              List cards (safe summaries)\n');
          context.emit('text', 'wallet_add               Add a new card\n');
          context.emit('text', 'wallet_get               Get card details (rate limited)\n');
          context.emit('text', 'wallet_remove            Remove a card\n');
          context.emit('done');
          return { handled: true };
        }

        context.emit('text', `Unknown wallet command: ${subcommand}\n`);
        context.emit('text', 'Use /wallet help for available commands.\n');
        context.emit('done');
        return { handled: true };
      },
    };
  }

  /**
   * /secrets - Manage assistant secrets (API keys, tokens, passwords)
   */
  private secretsCommand(): Command {
    return {
      name: 'secrets',
      description: 'Manage secrets (API keys, tokens, passwords)',
      builtin: true,
      selfHandled: true,
      content: '',
      handler: async (args, context) => {
        const manager = context.getSecretsManager?.();
        if (!manager) {
          context.emit('text', 'Secrets management is not enabled. Configure secrets in config.json.\n');
          context.emit('text', '\nTo enable:\n');
          context.emit('text', '```json\n');
          context.emit('text', '{\n');
          context.emit('text', '  "secrets": {\n');
          context.emit('text', '    "enabled": true,\n');
          context.emit('text', '    "storage": { "provider": "local" }\n');
          context.emit('text', '  }\n');
          context.emit('text', '}\n');
          context.emit('text', '```\n');
          context.emit('text', '\nOptional AWS backend:\n');
          context.emit('text', '```json\n');
          context.emit('text', '{\n');
          context.emit('text', '  "secrets": {\n');
          context.emit('text', '    "enabled": true,\n');
          context.emit('text', '    "storage": {\n');
          context.emit('text', '      "provider": "aws",\n');
          context.emit('text', '      "region": "us-east-1"\n');
          context.emit('text', '    }\n');
          context.emit('text', '  }\n');
          context.emit('text', '}\n');
          context.emit('text', '```\n');
          context.emit('done');
          return { handled: true };
        }

        const parts = splitArgs(args.trim());
        const subcommand = parts[0]?.toLowerCase() || '';

        // Interactive UI mode - default when no args or explicit 'ui'
        if (!subcommand || subcommand === 'ui') {
          context.emit('done');
          return { handled: true, showPanel: 'secrets' as const };
        }

        // /secrets list [scope]
        if (subcommand === 'list') {
          try {
            const scope = parts[1]?.toLowerCase() || 'all';
            const secrets = await manager.list(scope as 'global' | 'assistant' | 'all');

            if (secrets.length === 0) {
              context.emit('text', 'No secrets stored.\n');
              context.emit('text', 'Use /secrets add to add a secret.\n');
            } else {
              context.emit('text', `\n## Secrets (${secrets.length} secret${secrets.length === 1 ? '' : 's'})\n\n`);

              // Group by scope
              const globalSecrets = secrets.filter(s => s.scope === 'global');
              const assistantSecrets = secrets.filter(s => s.scope === 'assistant');

              if (globalSecrets.length > 0) {
                context.emit('text', '### Global Secrets\n');
                for (const secret of globalSecrets) {
                  context.emit('text', `- **${secret.name}**${secret.description ? ` - ${secret.description}` : ''}\n`);
                }
                context.emit('text', '\n');
              }

              if (assistantSecrets.length > 0) {
                context.emit('text', '### Assistant Secrets\n');
                for (const secret of assistantSecrets) {
                  context.emit('text', `- **${secret.name}**${secret.description ? ` - ${secret.description}` : ''}\n`);
                }
                context.emit('text', '\n');
              }

              const status = manager.getRateLimitStatus();
              context.emit('text', `---\nRate limit: ${status.readsUsed}/${status.maxReads} reads this hour\n`);
            }
          } catch (error) {
            context.emit('text', `Error listing secrets: ${error instanceof Error ? error.message : String(error)}\n`);
          }
          context.emit('done');
          return { handled: true };
        }

        // /secrets get <name> [scope]
        if (subcommand === 'get') {
          const name = parts[1];
          if (!name) {
            context.emit('text', 'Usage: /secrets get <name> [scope]\n');
            context.emit('done');
            return { handled: true };
          }

          const scope = parts[2]?.toLowerCase() as 'global' | 'assistant' | undefined;

          try {
            const value = await manager.get(name, scope, 'plain');
            if (value === null) {
              context.emit('text', `Secret "${name}" not found.\n`);
            } else {
              // Mask the value for display (show first 4 and last 4 chars if long enough)
              const valueStr = String(value);
              let maskedValue: string;
              if (valueStr.length <= 8) {
                maskedValue = '********';
              } else {
                maskedValue = valueStr.slice(0, 4) + '****' + valueStr.slice(-4);
              }
              context.emit('text', `\n**${name}**: ${maskedValue}\n`);
              context.emit('text', '\nTo use the full value, call secrets_get tool with the secret name.\n');
            }
          } catch (error) {
            context.emit('text', `Error: ${error instanceof Error ? error.message : String(error)}\n`);
          }
          context.emit('done');
          return { handled: true };
        }

        // /secrets set
        if (subcommand === 'add' || subcommand === 'set') {
          context.emit('done');
          return { handled: true, showPanel: 'secrets', panelValue: 'add' };
        }

        // /secrets delete <name> [scope]
        if (subcommand === 'delete') {
          const name = parts[1];
          if (!name) {
            context.emit('text', 'Usage: /secrets delete <name> [scope]\n');
            context.emit('done');
            return { handled: true };
          }

          const scope = (parts[2]?.toLowerCase() as 'global' | 'assistant') || 'assistant';

          try {
            const result = await manager.delete(name, scope);
            if (result.success) {
              context.emit('text', `${result.message}\n`);
            } else {
              context.emit('text', `Error: ${result.message}\n`);
            }
          } catch (error) {
            context.emit('text', `Error: ${error instanceof Error ? error.message : String(error)}\n`);
          }
          context.emit('done');
          return { handled: true };
        }

        // /secrets export [scope]
        if (subcommand === 'export') {
          const scope = (parts[1]?.toLowerCase() as 'global' | 'assistant' | 'all') || 'all';

          try {
            const envLines = await manager.export(scope);
            if (envLines.length === 0) {
              context.emit('text', 'No secrets to export.\n');
            } else {
              context.emit('text', '\n## Secrets Export (env format)\n\n');
              context.emit('text', '```bash\n');
              for (const line of envLines) {
                context.emit('text', `${line}\n`);
              }
              context.emit('text', '```\n');
              context.emit('text', '\nCopy these to your shell or .env file.\n');
            }
          } catch (error) {
            context.emit('text', `Error: ${error instanceof Error ? error.message : String(error)}\n`);
          }
          context.emit('done');
          return { handled: true };
        }

        // /secrets status
        if (subcommand === 'status') {
          const status = manager.getRateLimitStatus();
          const credCheck = await manager.checkCredentials();
          const storageMode = typeof (manager as any).getStorageMode === 'function'
            ? (manager as any).getStorageMode()
            : 'unknown';

          context.emit('text', '\n## Secrets Status\n\n');
          context.emit('text', `Storage: ${storageMode}\n`);
          context.emit('text', `Credentials: ${credCheck.valid ? 'Valid' : 'Invalid'}\n`);
          if (!credCheck.valid && credCheck.error) {
            context.emit('text', `  Error: ${credCheck.error}\n`);
          }
          context.emit('text', `Rate Limit: ${status.readsUsed}/${status.maxReads} reads used\n`);
          context.emit('text', `Window Reset: ${status.windowResetMinutes} minutes\n`);
          context.emit('done');
          return { handled: true };
        }

        // /secrets help
        if (subcommand === 'help') {
          context.emit('text', '\n## Secrets Commands\n\n');
          context.emit('text', '/secrets                  Interactive secrets manager\n');
          context.emit('text', '/secrets list [scope]     List secrets, optionally filtered by scope\n');
          context.emit('text', '/secrets get <name>       Get a secret value (masked)\n');
          context.emit('text', '/secrets add              Open add-secret form\n');
          context.emit('text', '/secrets set              Alias for /secrets add\n');
          context.emit('text', '/secrets delete <name>    Delete a secret\n');
          context.emit('text', '/secrets export [scope]   Export secrets as env format\n');
          context.emit('text', '/secrets status           Show status and credentials\n');
          context.emit('text', '/secrets help             Show this help\n\n');
          context.emit('text', '## Tools\n\n');
          context.emit('text', 'secrets_list              List secrets (names only)\n');
          context.emit('text', 'secrets_get               Get a secret value (rate limited)\n');
          context.emit('text', 'secrets_set               Create or update a secret\n');
          context.emit('text', 'secrets_delete            Delete a secret\n\n');
          context.emit('text', '## Scopes\n\n');
          context.emit('text', 'global - Shared across all assistants\n');
          context.emit('text', 'assistant - Specific to this assistant only\n');
          context.emit('text', 'all       - Both global and assistant (default for list)\n');
          context.emit('done');
          return { handled: true };
        }

        context.emit('text', `Unknown secrets command: ${subcommand}\n`);
        context.emit('text', 'Use /secrets help for available commands.\n');
        context.emit('done');
        return { handled: true };
      },
    };
  }

  /**
   * /jobs - List and manage background jobs
   */
  private jobsCommand(): Command {
    return {
      name: 'jobs',
      description: 'List and manage background jobs',
      builtin: true,
      selfHandled: true,
      content: '',
      handler: async (args, context) => {
        const parts = args.trim().split(/\s+/);
        const subcommand = parts[0]?.toLowerCase() || 'list';
        const arg = parts[1] || '';

        switch (subcommand) {
          case 'list':
          case '': {
            const jobs = await listJobsForSession(context.sessionId);
            if (jobs.length === 0) {
              context.emit('text', 'No jobs found for this session.\n');
              context.emit('done');
              return { handled: true };
            }

            // Sort by created time, newest first
            jobs.sort((a, b) => b.createdAt - a.createdAt);

            let output = '\n| Status | ID | Connector | Command | Age |\n';
            output += '|--------|----|-----------|---------|----- |\n';

            for (const job of jobs) {
              const age = this.formatAge(Date.now() - job.createdAt);
              const command = job.command.slice(0, 30);
              output += `| ${job.status.toUpperCase()} | ${job.id} | ${job.connectorName} | ${command} | ${age} |\n`;
            }

            context.emit('text', output);
            context.emit('done');
            return { handled: true };
          }

          case 'all': {
            const jobs = await listJobs();
            if (jobs.length === 0) {
              context.emit('text', 'No jobs found.\n');
              context.emit('done');
              return { handled: true };
            }

            jobs.sort((a, b) => b.createdAt - a.createdAt);

            let output = '\n| Status | ID | Session | Connector | Command | Age |\n';
            output += '|--------|----|---------|-----------|---------|-----|\n';

            for (const job of jobs) {
              const age = this.formatAge(Date.now() - job.createdAt);
              const command = job.command.slice(0, 20);
              output += `| ${job.status.toUpperCase()} | ${job.id} | ${job.sessionId} | ${job.connectorName} | ${command} | ${age} |\n`;
            }

            context.emit('text', output);
            context.emit('done');
            return { handled: true };
          }

          case 'cancel': {
            if (!arg) {
              context.emit('text', 'Usage: /jobs cancel <job_id>\n');
              context.emit('done');
              return { handled: true };
            }

            // Find job by partial ID
            const jobs = await listJobs();
            const matches = jobs.filter((j) => j.id.startsWith(arg) || j.id === arg);

            if (matches.length === 0) {
              context.emit('text', `Job not found: ${arg}\n`);
              context.emit('done');
              return { handled: true };
            }

            if (matches.length > 1) {
              context.emit('text', `Ambiguous job ID. Matches: ${matches.map((j) => j.id).join(', ')}\n`);
              context.emit('done');
              return { handled: true };
            }

            const job = matches[0];
            if (!['pending', 'running'].includes(job.status)) {
              context.emit('text', `Cannot cancel job ${job.id}: status is ${job.status}\n`);
              context.emit('done');
              return { handled: true };
            }

            const manager = context.getJobManager?.();
            let cancelled = false;
            if (manager && job.sessionId === context.sessionId) {
              cancelled = await manager.cancelJob(job.id);
            }
            if (!cancelled) {
              const updated = await updateJob(job.id, (j) => ({
                ...j,
                status: 'cancelled',
                completedAt: Date.now(),
                error: {
                  code: 'JOB_CANCELLED',
                  message: 'Job was cancelled by user',
                },
              }));
              cancelled = updated !== null;
            }

            if (cancelled) {
              context.emit('text', `Job ${job.id} cancelled.\n`);
            } else {
              context.emit('text', `Failed to cancel job ${job.id}.\n`);
            }
            context.emit('done');
            return { handled: true };
          }

          case 'clear': {
            const cleaned = await cleanupSessionJobs(context.sessionId);
            context.emit('text', `Cleared ${cleaned} completed job(s).\n`);
            context.emit('done');
            return { handled: true };
          }

          case 'help': {
            const help = `
/jobs               List jobs for current session
/jobs list          List jobs for current session
/jobs all           List all jobs across sessions
/jobs <id>          Show details of a specific job
/jobs cancel <id>   Cancel a running job
/jobs clear         Clear completed jobs for this session
/jobs help          Show this help
`;
            context.emit('text', help);
            context.emit('done');
            return { handled: true };
          }

          default: {
            // Assume it's a job ID
            const jobs = await listJobs();
            const matches = jobs.filter((j) => j.id.startsWith(subcommand) || j.id === subcommand);

            if (matches.length === 0) {
              context.emit('text', `Job not found: ${subcommand}\nUse /jobs help for usage.\n`);
              context.emit('done');
              return { handled: true };
            }

            if (matches.length > 1) {
              context.emit('text', `Ambiguous job ID. Matches: ${matches.map((j) => j.id).join(', ')}\n`);
              context.emit('done');
              return { handled: true };
            }

            const job = matches[0];
            let output = `
Job ID: ${job.id}
Status: ${job.status}
Connector: ${job.connectorName}
Command: ${job.command}
Session: ${job.sessionId}
Created: ${new Date(job.createdAt).toISOString()}
`;

            if (job.startedAt) {
              output += `Started: ${new Date(job.startedAt).toISOString()}\n`;
            }

            if (job.completedAt) {
              output += `Completed: ${new Date(job.completedAt).toISOString()}\n`;
              const duration = job.completedAt - (job.startedAt || job.createdAt);
              output += `Duration: ${(duration / 1000).toFixed(1)}s\n`;
            }

            output += `Timeout: ${job.timeoutMs / 1000}s\n`;

            if (job.result) {
              output += `\nResult:\n${job.result.content}\n`;
            }

            if (job.error) {
              output += `\nError (${job.error.code}): ${job.error.message}\n`;
            }

            context.emit('text', output);
            context.emit('done');
            return { handled: true };
          }
        }
      },
    };
  }

  private formatAge(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    return `${days}d`;
  }

  /**
   * /messages - Assistant-to-assistant messaging
   */
  private messagesCommand(): Command {
    return {
      name: 'messages',
      aliases: ['inbox'],
      description: 'Assistant messaging and email inbox',
      builtin: true,
      selfHandled: true,
      content: '',
      handler: async (args, context) => {
        const manager = context.getMessagesManager?.();
        const inboxManager = context.getInboxManager?.();

        // If neither is enabled, show error
        if (!manager && !inboxManager) {
          context.emit('text', 'Messages are not enabled. Configure messages in config.json.\n');
          context.emit('text', '\nTo enable:\n');
          context.emit('text', '```json\n');
          context.emit('text', '{\n');
          context.emit('text', '  "messages": {\n');
          context.emit('text', '    "enabled": true\n');
          context.emit('text', '  }\n');
          context.emit('text', '}\n');
          context.emit('text', '```\n');
          context.emit('done');
          return { handled: true };
        }

        const parts = splitArgs(args);
        const subcommand = parts[0]?.toLowerCase() || '';

        // /messages (no args) or /messages ui - show interactive panel
        if (!subcommand || subcommand === 'ui') {
          context.emit('done');
          return { handled: true, showPanel: 'messages' };
        }

        // --- Inbox subcommands (delegated to InboxManager) ---

        // /messages fetch [limit] (inbox)
        if (subcommand === 'fetch') {
          if (!inboxManager) {
            context.emit('text', 'Inbox is not enabled. Configure inbox in config.json.\n');
            context.emit('done');
            return { handled: true };
          }

          const limitArg = parts[1];
          const limit = limitArg ? parseInt(limitArg, 10) : 20;

          context.emit('text', 'Fetching emails...\n');
          try {
            const count = await inboxManager.fetch({ limit });
            if (count === 0) {
              context.emit('text', 'No new emails found.\n');
            } else {
              context.emit('text', `Fetched ${count} new email(s).\n`);
            }
          } catch (error) {
            context.emit('text', `Error fetching: ${error instanceof Error ? error.message : String(error)}\n`);
          }
          context.emit('done');
          return { handled: true };
        }

        // /messages email <id> (read email by id)
        if (subcommand === 'email') {
          if (!inboxManager) {
            context.emit('text', 'Inbox is not enabled. Configure inbox in config.json.\n');
            context.emit('done');
            return { handled: true };
          }

          const emailId = parts[1];
          if (!emailId) {
            context.emit('text', 'Usage: /messages email <id>\n');
            context.emit('done');
            return { handled: true };
          }

          try {
            const email = await inboxManager.read(emailId);
            if (!email) {
              context.emit('text', `Email ${emailId} not found.\n`);
            } else {
              const { formatEmailAsMarkdown } = await import('../inbox/parser/email-parser');
              context.emit('text', '\n' + formatEmailAsMarkdown(email) + '\n');
            }
          } catch (error) {
            context.emit('text', `Error reading: ${error instanceof Error ? error.message : String(error)}\n`);
          }
          context.emit('done');
          return { handled: true };
        }

        // /messages download <id> <index> (inbox attachment)
        if (subcommand === 'download') {
          if (!inboxManager) {
            context.emit('text', 'Inbox is not enabled. Configure inbox in config.json.\n');
            context.emit('done');
            return { handled: true };
          }

          const emailId = parts[1];
          const indexArg = parts[2];

          if (!emailId || !indexArg) {
            context.emit('text', 'Usage: /messages download <email-id> <attachment-index>\n');
            context.emit('done');
            return { handled: true };
          }

          const index = parseInt(indexArg, 10);
          if (isNaN(index) || index < 0) {
            context.emit('text', 'Invalid attachment index.\n');
            context.emit('done');
            return { handled: true };
          }

          try {
            // Validate index against actual attachment count
            const email = await inboxManager.read(emailId);
            if (email && email.attachments) {
              if (index >= email.attachments.length) {
                context.emit('text', `Invalid attachment index. Email has ${email.attachments.length} attachment(s) (0-${email.attachments.length - 1}).\n`);
                context.emit('done');
                return { handled: true };
              }
            }
            const path = await inboxManager.downloadAttachment(emailId, index);
            context.emit('text', `Downloaded to: ${path}\n`);
          } catch (error) {
            context.emit('text', `Error: ${error instanceof Error ? error.message : String(error)}\n`);
          }
          context.emit('done');
          return { handled: true };
        }

        // /messages compose <to> <subject> (inbox send)
        if (subcommand === 'compose') {
          if (!inboxManager) {
            context.emit('text', 'Inbox is not enabled. Configure inbox in config.json.\n');
            context.emit('done');
            return { handled: true };
          }

          const to = parts[1];
          const subject = parts.slice(2).join(' ');

          if (!to || !subject) {
            context.emit('text', 'Usage: /messages compose <to> <subject>\n');
            context.emit('text', 'Then type your message and send.\n');
            context.emit('done');
            return { handled: true };
          }

          context.emit('done');
          return {
            handled: false,
            prompt: `Help me compose an email to ${to} with subject "${subject}". Ask me what I want to say, then use the inbox_send tool to send it.`,
          };
        }

        // /messages address (inbox email address)
        if (subcommand === 'address') {
          if (!inboxManager) {
            context.emit('text', 'Inbox is not enabled. Configure inbox in config.json.\n');
            context.emit('done');
            return { handled: true };
          }

          const address = inboxManager.getEmailAddress();
          context.emit('text', `Assistant email address: ${address}\n`);
          context.emit('done');
          return { handled: true };
        }

        // --- Assistant messages subcommands (delegated to MessagesManager) ---

        // /messages list
        if (subcommand === 'list') {
          if (!manager) {
            context.emit('text', 'Messages are not enabled.\n');
            context.emit('done');
            return { handled: true };
          }

          const unreadOnly = parts.includes('--unread') || parts.includes('-u');
          const limitArg = parts.find((p) => p.match(/^\d+$/));
          const limit = limitArg ? parseInt(limitArg, 10) : 20;

          try {
            const messages = await manager.list({ limit, unreadOnly });
            if (messages.length === 0) {
              context.emit('text', unreadOnly ? 'No unread messages.\n' : 'Inbox is empty.\n');
            } else {
              context.emit('text', `\n## Messages (${messages.length} message${messages.length === 1 ? '' : 's'})\n\n`);
              for (const msg of messages) {
                const statusIcon = msg.status === 'read' ? '📖' : msg.status === 'injected' ? '👁️' : '📬';
                const priorityIcon =
                  msg.priority === 'urgent'
                    ? ' 🔴'
                    : msg.priority === 'high'
                    ? ' 🟠'
                    : '';
                const date = new Date(msg.createdAt).toLocaleDateString();
                context.emit('text', `${statusIcon}${priorityIcon} **${msg.id}**\n`);
                context.emit('text', `   From: ${msg.fromAssistantName}\n`);
                if (msg.subject) {
                  context.emit('text', `   Subject: ${msg.subject}\n`);
                }
                context.emit('text', `   Preview: ${msg.preview}\n`);
                context.emit('text', `   Date: ${date}${msg.replyCount > 0 ? ` | ${msg.replyCount} replies` : ''}\n\n`);
              }
            }
          } catch (error) {
            context.emit('text', `Error listing messages: ${error instanceof Error ? error.message : String(error)}\n`);
          }
          context.emit('done');
          return { handled: true };
        }

        // /messages threads
        if (subcommand === 'threads') {
          if (!manager) {
            context.emit('text', 'Messages are not enabled.\n');
            context.emit('done');
            return { handled: true };
          }

          try {
            const threads = await manager.listThreads();
            if (threads.length === 0) {
              context.emit('text', 'No conversation threads found.\n');
            } else {
              context.emit('text', `\n## Threads (${threads.length})\n\n`);
              for (const thread of threads) {
                const participants = thread.participants.map((p) => p.assistantName).join(', ');
                const updated = new Date(thread.updatedAt).toLocaleDateString();
                context.emit('text', `**${thread.threadId}**\n`);
                if (thread.subject) {
                  context.emit('text', `   Subject: ${thread.subject}\n`);
                }
                context.emit('text', `   Participants: ${participants}\n`);
                context.emit('text', `   Messages: ${thread.messageCount} (${thread.unreadCount} unread)\n`);
                context.emit('text', `   Updated: ${updated}\n\n`);
              }
            }
          } catch (error) {
            context.emit('text', `Error listing threads: ${error instanceof Error ? error.message : String(error)}\n`);
          }
          context.emit('done');
          return { handled: true };
        }

        // /messages read <id>
        if (subcommand === 'read') {
          if (!manager) {
            context.emit('text', 'Messages are not enabled.\n');
            context.emit('done');
            return { handled: true };
          }

          const messageId = parts[1];
          if (!messageId) {
            context.emit('text', 'Usage: /messages read <id>\n');
            context.emit('done');
            return { handled: true };
          }

          try {
            const message = await manager.read(messageId);
            if (!message) {
              context.emit('text', `Message ${messageId} not found.\n`);
            } else {
              context.emit('text', `\n## Message: ${message.id}\n\n`);
              context.emit('text', `**From:** ${message.fromAssistantName} (${message.fromAssistantId})\n`);
              context.emit('text', `**To:** ${message.toAssistantName} (${message.toAssistantId})\n`);
              if (message.subject) {
                context.emit('text', `**Subject:** ${message.subject}\n`);
              }
              context.emit('text', `**Priority:** ${message.priority}\n`);
              context.emit('text', `**Sent:** ${new Date(message.createdAt).toLocaleString()}\n`);
              if (message.readAt) {
                context.emit('text', `**Read:** ${new Date(message.readAt).toLocaleString()}\n`);
              }
              context.emit('text', `**Thread:** ${message.threadId}\n`);
              if (message.parentId) {
                context.emit('text', `**In reply to:** ${message.parentId}\n`);
              }
              context.emit('text', '\n---\n\n');
              context.emit('text', message.body + '\n');
            }
          } catch (error) {
            context.emit('text', `Error reading message: ${error instanceof Error ? error.message : String(error)}\n`);
          }
          context.emit('done');
          return { handled: true };
        }

        // /messages thread <id>
        if (subcommand === 'thread') {
          if (!manager) {
            context.emit('text', 'Messages are not enabled.\n');
            context.emit('done');
            return { handled: true };
          }

          const threadId = parts[1];
          if (!threadId) {
            context.emit('text', 'Usage: /messages thread <id>\n');
            context.emit('done');
            return { handled: true };
          }

          try {
            const messages = await manager.readThread(threadId);
            if (messages.length === 0) {
              context.emit('text', `Thread ${threadId} not found or empty.\n`);
            } else {
              context.emit('text', `\n## Thread: ${threadId}\n`);
              context.emit('text', `**${messages.length} message(s)**\n\n`);
              for (const msg of messages) {
                context.emit('text', '---\n');
                context.emit('text', `### From: ${msg.fromAssistantName} → ${msg.toAssistantName}\n`);
                if (msg.subject) {
                  context.emit('text', `**Subject:** ${msg.subject}\n`);
                }
                context.emit('text', `**Sent:** ${new Date(msg.createdAt).toLocaleString()}\n\n`);
                context.emit('text', msg.body + '\n');
                context.emit('text', `*ID: ${msg.id}*\n\n`);
              }
            }
          } catch (error) {
            context.emit('text', `Error reading thread: ${error instanceof Error ? error.message : String(error)}\n`);
          }
          context.emit('done');
          return { handled: true };
        }

        // /messages send <to> <subject>
        if (subcommand === 'send') {
          if (!manager) {
            context.emit('text', 'Messages are not enabled.\n');
            context.emit('done');
            return { handled: true };
          }

          context.emit('text', 'To send a message, use the messages_send tool:\n\n');
          context.emit('text', 'Example:\n');
          context.emit('text', '```\n');
          context.emit('text', 'Use messages_send with:\n');
          context.emit('text', '  to: "AssistantName"  (or assistant ID)\n');
          context.emit('text', '  body: "Your message content"\n');
          context.emit('text', '  subject: "Optional subject" (optional)\n');
          context.emit('text', '  priority: "normal" (optional: low, normal, high, urgent)\n');
          context.emit('text', '```\n');
          context.emit('done');
          return { handled: true };
        }

        // /messages reply <id>
        if (subcommand === 'reply') {
          if (!manager) {
            context.emit('text', 'Messages are not enabled.\n');
            context.emit('done');
            return { handled: true };
          }

          const messageId = parts[1];
          if (!messageId) {
            context.emit('text', 'Usage: /messages reply <id>\n');
            context.emit('done');
            return { handled: true };
          }

          context.emit('text', `To reply to message ${messageId}, use the messages_send tool:\n\n`);
          context.emit('text', 'Example:\n');
          context.emit('text', '```\n');
          context.emit('text', 'Use messages_send with:\n');
          context.emit('text', '  to: "<recipient>"\n');
          context.emit('text', '  body: "Your reply"\n');
          context.emit('text', `  replyTo: "${messageId}"\n`);
          context.emit('text', '```\n');
          context.emit('done');
          return { handled: true };
        }

        // /messages delete <id>
        if (subcommand === 'delete') {
          if (!manager) {
            context.emit('text', 'Messages are not enabled.\n');
            context.emit('done');
            return { handled: true };
          }

          const messageId = parts[1];
          if (!messageId) {
            context.emit('text', 'Usage: /messages delete <id>\n');
            context.emit('done');
            return { handled: true };
          }

          try {
            const result = await manager.delete(messageId);
            context.emit('text', result.message + '\n');
          } catch (error) {
            context.emit('text', `Error: ${error instanceof Error ? error.message : String(error)}\n`);
          }
          context.emit('done');
          return { handled: true };
        }

        // /messages assistants
        if (subcommand === 'assistants') {
          if (!manager) {
            context.emit('text', 'Messages are not enabled.\n');
            context.emit('done');
            return { handled: true };
          }

          try {
            const assistants = await manager.listAssistants();
            if (assistants.length === 0) {
              context.emit('text', 'No other assistants found. Assistants appear here after sending or receiving messages.\n');
            } else {
              context.emit('text', `\n## Known Assistants (${assistants.length})\n\n`);
              for (const assistant of assistants) {
                const lastSeen = new Date(assistant.lastSeen).toLocaleDateString();
                context.emit('text', `- **${assistant.name}** (ID: ${assistant.id})\n`);
                context.emit('text', `  Last seen: ${lastSeen}\n`);
              }
            }
          } catch (error) {
            context.emit('text', `Error: ${error instanceof Error ? error.message : String(error)}\n`);
          }
          context.emit('done');
          return { handled: true };
        }

        // /messages stats
        if (subcommand === 'stats') {
          if (!manager) {
            context.emit('text', 'Messages are not enabled.\n');
            context.emit('done');
            return { handled: true };
          }

          try {
            const stats = await manager.getStats();
            context.emit('text', '\n## Messages Statistics\n\n');
            context.emit('text', `Total Messages: ${stats.totalMessages}\n`);
            context.emit('text', `Unread: ${stats.unreadCount}\n`);
            context.emit('text', `Threads: ${stats.threadCount}\n`);
          } catch (error) {
            context.emit('text', `Error: ${error instanceof Error ? error.message : String(error)}\n`);
          }
          context.emit('done');
          return { handled: true };
        }

        // /messages help
        if (subcommand === 'help') {
          context.emit('text', '\n## Messages Commands\n\n');
          context.emit('text', '### Assistant Messages\n\n');
          context.emit('text', '/messages                Open messages panel\n');
          context.emit('text', '/messages list [--unread] List messages, optionally unread only\n');
          context.emit('text', '/messages threads        List conversation threads\n');
          context.emit('text', '/messages read <id>      Read specific message\n');
          context.emit('text', '/messages thread <id>    Read entire thread\n');
          context.emit('text', '/messages send           Show how to send messages\n');
          context.emit('text', '/messages reply <id>     Show how to reply\n');
          context.emit('text', '/messages delete <id>    Delete a message\n');
          context.emit('text', '/messages assistants     List known assistants\n');
          context.emit('text', '/messages stats          Show inbox statistics\n');
          context.emit('text', '\n### Email Inbox\n\n');
          context.emit('text', '/messages fetch [limit]     Sync emails from S3 (default: 20)\n');
          context.emit('text', '/messages email <id>        Read specific email\n');
          context.emit('text', '/messages download <id> <n> Download attachment\n');
          context.emit('text', '/messages compose <to> <subj> Compose and send email\n');
          context.emit('text', '/messages address           Show assistant email address\n');
          context.emit('text', '\n### Tools\n\n');
          context.emit('text', 'messages_send            Send a message to another assistant\n');
          context.emit('text', 'messages_list            List inbox messages\n');
          context.emit('text', 'messages_read            Read a specific message\n');
          context.emit('text', 'messages_read_thread     Read entire thread\n');
          context.emit('text', 'messages_delete          Delete a message\n');
          context.emit('text', 'messages_list_assistants  List known assistants\n');
          context.emit('text', 'inbox_fetch              Fetch emails from server\n');
          context.emit('text', 'inbox_list               List emails\n');
          context.emit('text', 'inbox_read               Read specific email\n');
          context.emit('text', 'inbox_send               Send/reply to email\n');
          context.emit('text', '\n/inbox is an alias for /messages.\n');
          context.emit('done');
          return { handled: true };
        }

        context.emit('text', `Unknown messages command: ${subcommand}\n`);
        context.emit('text', 'Use /messages help for available commands.\n');
        context.emit('done');
        return { handled: true };
      },
    };
  }

  /**
   * /webhooks - Manage webhooks for receiving external events
   */
  private webhooksCommand(): Command {
    return {
      name: 'webhooks',
      description: 'Manage webhooks for receiving push events from external sources',
      builtin: true,
      selfHandled: true,
      content: '',
      handler: async (args, context) => {
        const trimmed = args.trim();
        const [subcommand, ...rest] = trimmed.split(/\s+/);
        const subArgs = rest.join(' ');

        // /webhooks (no args) or /webhooks ui → open interactive panel
        if (!subcommand || subcommand === 'ui') {
          context.emit('done');
          return { handled: true, showPanel: 'webhooks' };
        }

        const manager = context.getWebhooksManager?.();
        if (!manager) {
          context.emit('text', 'Webhooks are not enabled. Set webhooks.enabled: true in config.\n');
          context.emit('done');
          return { handled: true };
        }

        // /webhooks list
        if (subcommand === 'list') {
          try {
            const webhooks = await manager.list();
            if (webhooks.length === 0) {
              context.emit('text', 'No webhooks registered. Use /webhooks create <name> <source> to create one.\n');
            } else {
              context.emit('text', `Webhooks (${webhooks.length}):\n\n`);
              for (const wh of webhooks) {
                const statusIcon = wh.status === 'active' ? '●' : wh.status === 'paused' ? '◐' : '✗';
                const lastDelivery = wh.lastDeliveryAt
                  ? new Date(wh.lastDeliveryAt).toLocaleDateString()
                  : 'never';
                context.emit('text', `  ${statusIcon} ${wh.name} (${wh.id})\n`);
                context.emit('text', `    Source: ${wh.source} | Events: ${wh.deliveryCount} | Last: ${lastDelivery}\n`);
              }
            }
          } catch (error) {
            context.emit('text', `Error: ${error instanceof Error ? error.message : String(error)}\n`);
          }
          context.emit('done');
          return { handled: true };
        }

        // /webhooks create <name> <source>
        if (subcommand === 'create') {
          const parts = subArgs.split(/\s+/);
          const name = parts[0];
          const source = parts[1] || 'custom';

          if (!name) {
            context.emit('text', 'Usage: /webhooks create <name> [source]\n');
            context.emit('text', 'Example: /webhooks create gmail-hook gmail\n');
            context.emit('done');
            return { handled: true };
          }

          try {
            const result = await manager.create({ name, source });
            if (result.success) {
              context.emit('text', `Webhook created!\n\n`);
              context.emit('text', `  ID:     ${result.webhookId}\n`);
              context.emit('text', `  URL:    ${result.url}\n`);
              context.emit('text', `  Secret: ${result.secret}\n`);
              context.emit('text', `\nConfigure the external source with the URL and secret above.\n`);
            } else {
              context.emit('text', `Error: ${result.message}\n`);
            }
          } catch (error) {
            context.emit('text', `Error: ${error instanceof Error ? error.message : String(error)}\n`);
          }
          context.emit('done');
          return { handled: true };
        }

        // /webhooks delete <id>
        if (subcommand === 'delete') {
          const id = subArgs.trim();
          if (!id) {
            context.emit('text', 'Usage: /webhooks delete <webhook-id>\n');
            context.emit('done');
            return { handled: true };
          }

          try {
            const result = await manager.delete(id);
            context.emit('text', `${result.message}\n`);
          } catch (error) {
            context.emit('text', `Error: ${error instanceof Error ? error.message : String(error)}\n`);
          }
          context.emit('done');
          return { handled: true };
        }

        // /webhooks events <webhookId>
        if (subcommand === 'events') {
          const webhookId = subArgs.trim();
          if (!webhookId) {
            context.emit('text', 'Usage: /webhooks events <webhook-id>\n');
            context.emit('done');
            return { handled: true };
          }

          try {
            const events = await manager.listEvents(webhookId, { limit: 20 });
            if (events.length === 0) {
              context.emit('text', 'No events received for this webhook.\n');
            } else {
              context.emit('text', `Recent events (${events.length}):\n\n`);
              for (const evt of events) {
                const statusIcon = evt.status === 'pending' ? '⏳' : evt.status === 'injected' ? '📨' : '✓';
                context.emit('text', `  ${statusIcon} ${evt.eventType} (${evt.id})\n`);
                context.emit('text', `    ${new Date(evt.timestamp).toLocaleString()} | ${evt.preview}\n`);
              }
            }
          } catch (error) {
            context.emit('text', `Error: ${error instanceof Error ? error.message : String(error)}\n`);
          }
          context.emit('done');
          return { handled: true };
        }

        // /webhooks test <id>
        if (subcommand === 'test') {
          const id = subArgs.trim();
          if (!id) {
            context.emit('text', 'Usage: /webhooks test <webhook-id>\n');
            context.emit('done');
            return { handled: true };
          }

          try {
            const result = await manager.sendTestEvent(id);
            if (result.success) {
              context.emit('text', `Test event sent! Event ID: ${result.eventId}\n`);
            } else {
              context.emit('text', `Error: ${result.message}\n`);
            }
          } catch (error) {
            context.emit('text', `Error: ${error instanceof Error ? error.message : String(error)}\n`);
          }
          context.emit('done');
          return { handled: true };
        }

        // /webhooks help
        if (subcommand === 'help') {
          context.emit('text', 'Webhook Commands:\n\n');
          context.emit('text', '/webhooks                Open webhooks panel\n');
          context.emit('text', '/webhooks list           List all webhooks\n');
          context.emit('text', '/webhooks create <name> <source>  Create a webhook\n');
          context.emit('text', '/webhooks delete <id>    Delete a webhook\n');
          context.emit('text', '/webhooks events <id>    List events for a webhook\n');
          context.emit('text', '/webhooks test <id>      Send a test event\n');
          context.emit('text', '/webhooks help           Show this help\n');
          context.emit('done');
          return { handled: true };
        }

        context.emit('text', `Unknown command: ${subcommand}\n`);
        context.emit('text', 'Use /webhooks help for available commands.\n');
        context.emit('done');
        return { handled: true };
      },
    };
  }

  /**
   * /channels - Slack-like channel collaboration
   */
  private channelsCommand(): Command {
    return {
      name: 'channels',
      description: 'Manage channels for agent collaboration',
      builtin: true,
      selfHandled: true,
      content: '',
      handler: async (args, context) => {
        const trimmed = args.trim();
        const [subcommand, ...rest] = trimmed.split(/\s+/);
        const subArgs = rest.join(' ');

        // /channels (no args) or /channels ui → open interactive panel
        if (!subcommand || subcommand === 'ui') {
          context.emit('done');
          return { handled: true, showPanel: 'channels' };
        }

        const manager = context.getChannelsManager?.();
        if (!manager) {
          context.emit('text', 'Channels are not enabled. Set channels.enabled: true in config.\n');
          context.emit('done');
          return { handled: true };
        }

        // /channels list
        if (subcommand === 'list') {
          try {
            const channels = manager.listChannels();
            if (channels.length === 0) {
              context.emit('text', 'No channels exist. Use /channels create <name> to create one.\n');
            } else {
              context.emit('text', `Channels (${channels.length}):\n\n`);
              for (const ch of channels) {
                const unread = ch.unreadCount > 0 ? ` (${ch.unreadCount} unread)` : '';
                context.emit('text', `  #${ch.name}${unread}\n`);
                if (ch.description) {
                  context.emit('text', `    ${ch.description}\n`);
                }
                context.emit('text', `    Members: ${ch.memberCount} | Last: ${ch.lastMessagePreview || 'no messages'}\n`);
              }
            }
          } catch (error) {
            context.emit('text', `Error: ${error instanceof Error ? error.message : String(error)}\n`);
          }
          context.emit('done');
          return { handled: true };
        }

        // /channels create <name> [description]
        if (subcommand === 'create') {
          const parts = splitArgs(subArgs);
          const name = parts[0];
          const description = parts.slice(1).join(' ') || undefined;

          if (!name) {
            context.emit('text', 'Usage: /channels create <name> [description]\n');
            context.emit('text', 'Example: /channels create general "Team discussion"\n');
            context.emit('done');
            return { handled: true };
          }

          try {
            const result = manager.createChannel(name, description);
            if (result.success) {
              context.emit('text', `Channel created!\n\n`);
              context.emit('text', `  Name: #${name}\n`);
              context.emit('text', `  ID:   ${result.channelId}\n`);
              if (description) {
                context.emit('text', `  Desc: ${description}\n`);
              }
            } else {
              context.emit('text', `Error: ${result.message}\n`);
            }
          } catch (error) {
            context.emit('text', `Error: ${error instanceof Error ? error.message : String(error)}\n`);
          }
          context.emit('done');
          return { handled: true };
        }

        // /channels join <channel>
        if (subcommand === 'join') {
          const channel = subArgs.trim();
          if (!channel) {
            context.emit('text', 'Usage: /channels join <channel-name>\n');
            context.emit('done');
            return { handled: true };
          }

          const result = manager.join(channel);
          context.emit('text', `${result.success ? result.message : `Error: ${result.message}`}\n`);
          context.emit('done');
          return { handled: true };
        }

        // /channels leave <channel>
        if (subcommand === 'leave') {
          const channel = subArgs.trim();
          if (!channel) {
            context.emit('text', 'Usage: /channels leave <channel-name>\n');
            context.emit('done');
            return { handled: true };
          }

          const result = manager.leave(channel);
          context.emit('text', `${result.success ? result.message : `Error: ${result.message}`}\n`);
          context.emit('done');
          return { handled: true };
        }

        // /channels send <channel> <message>
        if (subcommand === 'send') {
          const parts = splitArgs(subArgs);
          const channel = parts[0];
          const message = parts.slice(1).join(' ');

          if (!channel || !message) {
            context.emit('text', 'Usage: /channels send <channel> <message>\n');
            context.emit('done');
            return { handled: true };
          }

          // If a person is logged in, send as that person and trigger assistant response
          const peopleManager = context.getPeopleManager?.();
          const activePerson = peopleManager?.getActivePerson();
          let result;
          if (activePerson) {
            result = manager.sendAs(channel, message, activePerson.id, activePerson.name);
          } else {
            result = manager.send(channel, message);
          }
          context.emit('text', `${result.success ? result.message : `Error: ${result.message}`}\n`);
          context.emit('done');

          // When a person sends a message, trigger multi-agent responses via pool
          if (activePerson && result.success) {
            const agentPool = context.getChannelAgentPool?.();
            const members = manager.getMembers(channel);
            const currentAssistantId = context.getAssistantManager?.()?.getActive?.()?.id;
            if (agentPool && members.length > 0) {
              // Pool handles @mention filtering, concurrent sends, and client caching
              // Exclude the current assistant (it responds via the prompt return below)
              agentPool.triggerResponses(
                channel,
                activePerson.name,
                message,
                members,
                currentAssistantId || undefined,
              );
            }

            // Check @mentions — only trigger active assistant if mentioned (or no mentions)
            const mentions = parseMentions(message);
            if (mentions.length > 0) {
              const assistantMembers = members.filter((m) => m.memberType === 'assistant');
              const knownNames = assistantMembers.map((m) => ({ id: m.assistantId, name: m.assistantName }));
              const resolved = mentions
                .map((m) => resolveNameToKnown(m, knownNames))
                .filter(Boolean) as Array<{ id: string; name: string }>;
              if (resolved.length > 0) {
                // Mentions resolved — only trigger if active assistant is mentioned
                if (!resolved.some((r) => r.id === currentAssistantId)) {
                  return { handled: true };
                }
              } else {
                // Mentions present but none resolved — don't trigger anyone
                return { handled: true };
              }
            }

            // Trigger the active session's assistant via prompt return
            return {
              handled: false,
              prompt: `[Channel Message] ${activePerson.name} posted in #${channel}: "${message}"\n\nYou are in a group channel with other assistants and people. Respond in #${channel} using channel_send. Be helpful and conversational. You may reference or build on what other assistants have said.`,
            };
          }
          return { handled: true };
        }

        // /channels read <channel> [limit]
        if (subcommand === 'read') {
          const parts = subArgs.trim().split(/\s+/);
          const channel = parts[0];
          const limit = parts[1] ? parseInt(parts[1], 10) : 20;

          if (!channel) {
            context.emit('text', 'Usage: /channels read <channel> [limit]\n');
            context.emit('done');
            return { handled: true };
          }

          try {
            const result = manager.readMessages(channel, limit);
            if (!result) {
              context.emit('text', `Channel "${channel}" not found.\n`);
            } else if (result.messages.length === 0) {
              context.emit('text', `No messages in #${result.channel.name}.\n`);
            } else {
              context.emit('text', `#${result.channel.name} — Recent (${result.messages.length}):\n\n`);
              for (const msg of result.messages) {
                const date = new Date(msg.createdAt).toLocaleString();
                context.emit('text', `  [${msg.senderName}] (${date})\n`);
                context.emit('text', `  ${msg.content}\n\n`);
              }
            }
          } catch (error) {
            context.emit('text', `Error: ${error instanceof Error ? error.message : String(error)}\n`);
          }
          context.emit('done');
          return { handled: true };
        }

        // /channels members <channel>
        if (subcommand === 'members') {
          const channel = subArgs.trim();
          if (!channel) {
            context.emit('text', 'Usage: /channels members <channel>\n');
            context.emit('done');
            return { handled: true };
          }

          try {
            const ch = manager.getChannel(channel);
            if (!ch) {
              context.emit('text', `Channel "${channel}" not found.\n`);
            } else {
              const members = manager.getMembers(channel);
              context.emit('text', `#${ch.name} Members (${members.length}):\n\n`);
              for (const m of members) {
                const roleTag = m.role === 'owner' ? ' (owner)' : '';
                context.emit('text', `  ${m.assistantName}${roleTag}\n`);
              }
            }
          } catch (error) {
            context.emit('text', `Error: ${error instanceof Error ? error.message : String(error)}\n`);
          }
          context.emit('done');
          return { handled: true };
        }

        // /channels invite <channel> <name>
        if (subcommand === 'invite') {
          const parts = subArgs.trim().split(/\s+/);
          const channel = parts[0];
          const name = parts[1];

          if (!channel || !name) {
            context.emit('text', 'Usage: /channels invite <channel> <name>\n');
            context.emit('done');
            return { handled: true };
          }

          // Check if name matches a person first, then fall back to assistant
          const peopleManager = context.getPeopleManager?.();
          const person = peopleManager?.getPerson(name);
          const memberType = person ? 'person' as const : 'assistant' as const;
          const memberId = person ? person.id : name;
          const memberName = person ? person.name : name;

          const result = manager.invite(channel, memberId, memberName, memberType);
          context.emit('text', `${result.success ? result.message : `Error: ${result.message}`}\n`);
          context.emit('done');
          return { handled: true };
        }

        // /channels delete <channel>
        if (subcommand === 'delete') {
          const channel = subArgs.trim();
          if (!channel) {
            context.emit('text', 'Usage: /channels delete <channel>\n');
            context.emit('done');
            return { handled: true };
          }

          const result = manager.archiveChannel(channel);
          context.emit('text', `${result.success ? result.message : `Error: ${result.message}`}\n`);
          context.emit('done');
          return { handled: true };
        }

        // /channels help
        if (subcommand === 'help') {
          context.emit('text', 'Channel Commands:\n\n');
          context.emit('text', '/channels                      Open channels panel\n');
          context.emit('text', '/channels list                 List all channels\n');
          context.emit('text', '/channels create <name> [desc] Create a channel\n');
          context.emit('text', '/channels join <channel>       Join a channel\n');
          context.emit('text', '/channels leave <channel>      Leave a channel\n');
          context.emit('text', '/channels send <ch> <msg>      Send a message\n');
          context.emit('text', '/channels read <ch> [limit]    Read messages\n');
          context.emit('text', '/channels members <ch>         List members\n');
          context.emit('text', '/channels invite <ch> <name>   Invite person/agent\n');
          context.emit('text', '/channels delete <ch>          Archive a channel\n');
          context.emit('text', '/channels help                 Show this help\n');
          context.emit('done');
          return { handled: true };
        }

        context.emit('text', `Unknown command: ${subcommand}\n`);
        context.emit('text', 'Use /channels help for available commands.\n');
        context.emit('done');
        return { handled: true };
      },
    };
  }

  /**
   * /people - Human participant management
   */
  private peopleCommand(): Command {
    return {
      name: 'people',
      description: 'Manage human participants',
      builtin: true,
      selfHandled: true,
      content: '',
      handler: async (args, context) => {
        const trimmed = args.trim();
        const [subcommand, ...rest] = trimmed.split(/\s+/);
        const subArgs = rest.join(' ');

        // /people (no args) → open interactive panel
        if (!subcommand || subcommand === 'ui') {
          context.emit('done');
          return { handled: true, showPanel: 'people' };
        }

        const manager = context.getPeopleManager?.();
        if (!manager) {
          context.emit('text', 'People system is not available.\n');
          context.emit('done');
          return { handled: true };
        }

        // /people list
        if (subcommand === 'list') {
          const people = manager.listPeople();
          if (people.length === 0) {
            context.emit('text', 'No people registered. Use /people create <name> to add one.\n');
          } else {
            context.emit('text', `People (${people.length}):\n\n`);
            for (const p of people) {
              const active = p.isActive ? ' (active)' : '';
              const email = p.email ? ` <${p.email}>` : '';
              context.emit('text', `  ${p.name}${email}${active}\n`);
            }
          }
          context.emit('done');
          return { handled: true };
        }

        // /people create <name> [email]
        if (subcommand === 'create') {
          const parts = splitArgs(subArgs);
          const name = parts[0];
          const email = parts[1] || undefined;

          if (!name) {
            context.emit('text', 'Usage: /people create <name> [email]\n');
            context.emit('text', 'Example: /people create Andrei andrei@hasna.com\n');
            context.emit('done');
            return { handled: true };
          }

          try {
            const person = await manager.createPerson({ name, email });
            context.emit('text', `Person created: ${person.name} (${person.id})\n`);
            // Auto-login to new person
            await manager.setActivePerson(person.id);
            context.emit('text', `Logged in as ${person.name}.\n`);
          } catch (err) {
            context.emit('text', `Error: ${err instanceof Error ? err.message : String(err)}\n`);
          }
          context.emit('done');
          return { handled: true };
        }

        // /people login <name>
        if (subcommand === 'login') {
          const name = subArgs.trim();
          if (!name) {
            context.emit('text', 'Usage: /people login <name>\n');
            context.emit('done');
            return { handled: true };
          }

          try {
            const person = await manager.setActivePerson(name);
            context.emit('text', `Logged in as ${person.name} (${person.id}).\n`);
          } catch (err) {
            context.emit('text', `Error: ${err instanceof Error ? err.message : String(err)}\n`);
          }
          context.emit('done');
          return { handled: true };
        }

        // /people logout
        if (subcommand === 'logout') {
          await manager.logout();
          context.emit('text', 'Logged out.\n');
          context.emit('done');
          return { handled: true };
        }

        // /people whoami
        if (subcommand === 'whoami') {
          const active = manager.getActivePerson();
          if (active) {
            const email = active.email ? ` <${active.email}>` : '';
            context.emit('text', `${active.name}${email} (${active.id})\n`);
          } else {
            context.emit('text', 'Not logged in. Use /people login <name> to log in.\n');
          }
          context.emit('done');
          return { handled: true };
        }

        // /people delete <name>
        if (subcommand === 'delete') {
          const name = subArgs.trim();
          if (!name) {
            context.emit('text', 'Usage: /people delete <name>\n');
            context.emit('done');
            return { handled: true };
          }

          try {
            await manager.deletePerson(name);
            context.emit('text', `Person "${name}" deleted.\n`);
          } catch (err) {
            context.emit('text', `Error: ${err instanceof Error ? err.message : String(err)}\n`);
          }
          context.emit('done');
          return { handled: true };
        }

        // /people help
        if (subcommand === 'help') {
          context.emit('text', 'People Commands:\n\n');
          context.emit('text', '/people                       Open people panel\n');
          context.emit('text', '/people list                  List all people\n');
          context.emit('text', '/people create <name> [email] Create a person\n');
          context.emit('text', '/people login <name>          Switch active person\n');
          context.emit('text', '/people logout                Deactivate person\n');
          context.emit('text', '/people whoami                Show current person\n');
          context.emit('text', '/people delete <name>         Remove a person\n');
          context.emit('text', '/people help                  Show this help\n');
          context.emit('done');
          return { handled: true };
        }

        context.emit('text', `Unknown command: ${subcommand}\n`);
        context.emit('text', 'Use /people help for available commands.\n');
        context.emit('done');
        return { handled: true };
      },
    };
  }

  /**
   * /contacts - Address book management
   */
  private contactsCommand(): Command {
    return {
      name: 'contacts',
      description: 'Manage contacts address book',
      builtin: true,
      selfHandled: true,
      content: '',
      handler: async (_args, context) => {
        context.emit('done');
        return { handled: true, showPanel: 'contacts' };
      },
    };
  }

  /**
   * /communication - Telephony management (SMS, calls, WhatsApp)
   */
  private communicationCommand(): Command {
    return {
      name: 'communication',
      aliases: ['phone', 'telephony'],
      description: 'Manage communication: SMS, calls, WhatsApp, routing',
      builtin: true,
      selfHandled: true,
      content: '',
      handler: async (args, context) => {
        const trimmed = args.trim();
        const [subcommand, ...rest] = trimmed.split(/\s+/);
        const subArgs = rest.join(' ');

        // /communication (no args) → open interactive panel
        if (!subcommand || subcommand === 'ui') {
          context.emit('done');
          return { handled: true, showPanel: 'telephony' };
        }

        const manager = context.getTelephonyManager?.();
        if (!manager) {
          context.emit('text', 'Telephony is not enabled. Set telephony.enabled: true in config.\n');
          context.emit('done');
          return { handled: true };
        }

        // /communication numbers
        if (subcommand === 'numbers') {
          const numbers = manager.listPhoneNumbers();
          if (numbers.length === 0) {
            context.emit('text', 'No phone numbers configured. Use /communication sync to import from Twilio.\n');
          } else {
            context.emit('text', `Phone Numbers (${numbers.length}):\n\n`);
            for (const num of numbers) {
              const caps: string[] = [];
              if (num.capabilities.voice) caps.push('voice');
              if (num.capabilities.sms) caps.push('sms');
              if (num.capabilities.whatsapp) caps.push('whatsapp');
              const name = num.friendlyName ? ` (${num.friendlyName})` : '';
              context.emit('text', `  ${num.number}${name} [${caps.join(', ')}]\n`);
            }
          }
          context.emit('done');
          return { handled: true };
        }

        // /communication sync
        if (subcommand === 'sync') {
          context.emit('text', 'Syncing phone numbers from Twilio...\n');
          const result = await manager.syncPhoneNumbers();
          context.emit('text', `${result.success ? result.message : `Error: ${result.message}`}\n`);
          context.emit('done');
          return { handled: true };
        }

        // /communication default <number>
        if (subcommand === 'default') {
          const number = subArgs.trim();
          if (!number) {
            context.emit('text', 'Usage: /communication default <phone-number>\n');
            context.emit('done');
            return { handled: true };
          }
          const result = manager.setDefaultPhoneNumber(number);
          context.emit('text', `${result.success ? result.message : `Error: ${result.message}`}\n`);
          context.emit('done');
          return { handled: true };
        }

        // /communication sms send <to> <body>
        if (subcommand === 'sms') {
          const smsParts = subArgs.trim().split(/\s+/);
          const smsAction = smsParts[0];

          if (smsAction === 'send') {
            const to = smsParts[1];
            const body = smsParts.slice(2).join(' ');
            if (!to || !body) {
              context.emit('text', 'Usage: /communication sms send <to> <body>\n');
              context.emit('done');
              return { handled: true };
            }
            const result = await manager.sendSms(to, body);
            context.emit('text', `${result.success ? result.message : `Error: ${result.message}`}\n`);
          } else if (smsAction === 'list' || !smsAction) {
            const messages = manager.getSmsHistory({ limit: 20 });
            if (messages.length === 0) {
              context.emit('text', 'No SMS history.\n');
            } else {
              context.emit('text', `Recent SMS (${messages.length}):\n\n`);
              for (const msg of messages) {
                const dir = msg.direction === 'inbound' ? 'IN' : 'OUT';
                context.emit('text', `  [${dir}] ${msg.fromNumber} → ${msg.toNumber}: ${msg.bodyPreview}\n`);
              }
            }
          } else {
            context.emit('text', 'Usage: /communication sms [send <to> <body> | list]\n');
          }
          context.emit('done');
          return { handled: true };
        }

        // /communication call <to>
        if (subcommand === 'call') {
          const to = subArgs.trim();
          if (!to) {
            context.emit('text', 'Usage: /communication call <to>\n');
            context.emit('done');
            return { handled: true };
          }
          const result = await manager.makeCall(to);
          context.emit('text', `${result.success ? result.message : `Error: ${result.message}`}\n`);
          context.emit('done');
          return { handled: true };
        }

        // /communication calls
        if (subcommand === 'calls') {
          const calls = manager.getCallHistory({ limit: 20 });
          if (calls.length === 0) {
            context.emit('text', 'No call history.\n');
          } else {
            context.emit('text', `Recent Calls (${calls.length}):\n\n`);
            for (const call of calls) {
              const dir = call.direction === 'inbound' ? 'IN' : 'OUT';
              const dur = call.duration != null ? `${call.duration}s` : '-';
              context.emit('text', `  [${dir}] ${call.fromNumber} → ${call.toNumber} | ${call.status} | ${dur}\n`);
            }
          }
          context.emit('done');
          return { handled: true };
        }

        // /communication routes
        if (subcommand === 'routes') {
          const rules = manager.listRoutingRules();
          if (rules.length === 0) {
            context.emit('text', 'No routing rules configured.\n');
          } else {
            context.emit('text', `Routing Rules (${rules.length}):\n\n`);
            for (const rule of rules) {
              const enabled = rule.enabled ? '' : ' [DISABLED]';
              context.emit('text', `  ${rule.name} (priority: ${rule.priority})${enabled}\n`);
              context.emit('text', `    Target: ${rule.targetAssistantName} | Type: ${rule.messageType}\n`);
            }
          }
          context.emit('done');
          return { handled: true };
        }

        // /communication status
        if (subcommand === 'status') {
          const status = manager.getStatus();
          context.emit('text', 'Telephony Status:\n\n');
          context.emit('text', `  Enabled:       ${status.enabled ? 'Yes' : 'No'}\n`);
          context.emit('text', `  Twilio:        ${status.twilioConfigured ? 'Configured' : 'Not configured'}\n`);
          context.emit('text', `  ElevenLabs:    ${status.elevenLabsConfigured ? 'Configured' : 'Not configured'}\n`);
          context.emit('text', `  Default #:     ${status.defaultPhoneNumber ?? 'not set'}${status.defaultPhoneNumberSource ? ` (${status.defaultPhoneNumberSource})` : ''}\n`);
          context.emit('text', `  Numbers:       ${status.phoneNumbers}\n`);
          context.emit('text', `  Active calls:  ${status.activeCalls}\n`);
          context.emit('text', `  Routes:        ${status.routingRules}\n`);
          context.emit('done');
          return { handled: true };
        }

        // /communication help
        if (subcommand === 'help') {
          context.emit('text', 'Communication Commands:\n\n');
          context.emit('text', '/communication                         Open communication panel\n');
          context.emit('text', '/communication numbers                 List phone numbers\n');
          context.emit('text', '/communication sync                    Sync numbers from Twilio\n');
          context.emit('text', '/communication default <number>        Set default phone number\n');
          context.emit('text', '/communication sms send <to> <body>    Send SMS\n');
          context.emit('text', '/communication sms list                Recent SMS\n');
          context.emit('text', '/communication call <to>               Initiate call\n');
          context.emit('text', '/communication calls                   Recent calls\n');
          context.emit('text', '/communication routes                  Routing rules\n');
          context.emit('text', '/communication status                  Status summary\n');
          context.emit('text', '/communication help                    Show this help\n');
          context.emit('done');
          return { handled: true };
        }

        context.emit('text', `Unknown command: ${subcommand}\n`);
        context.emit('text', 'Use /communication help for available commands.\n');
        context.emit('done');
        return { handled: true };
      },
    };
  }

  /**
   * /call - Quick shortcut to initiate a phone call
   */
  private callCommand(): Command {
    return {
      name: 'call',
      description: 'Initiate a phone call (shortcut for /communication call)',
      builtin: true,
      selfHandled: true,
      content: '',
      handler: async (args, context) => {
        const to = args.trim();

        const manager = context.getTelephonyManager?.();
        if (!manager) {
          context.emit('text', 'Telephony is not enabled. Set telephony.enabled: true in config.\n');
          context.emit('done');
          return { handled: true };
        }

        if (!to) {
          context.emit('text', 'Usage: /call <phone-number>\n');
          context.emit('text', '\nExamples:\n');
          context.emit('text', '  /call +1234567890\n');
          context.emit('text', '  /call +44 20 7946 0958\n');
          context.emit('done');
          return { handled: true };
        }

        const result = await manager.makeCall(to);
        context.emit('text', `${result.success ? result.message : `Error: ${result.message}`}\n`);
        context.emit('done');
        return { handled: true };
      },
    };
  }

  /**
   * /orders - Order lifecycle management
   */
  private ordersCommand(): Command {
    return {
      name: 'orders',
      description: 'Manage orders across stores and vendors',
      builtin: true,
      selfHandled: true,
      content: '',
      handler: async (args, context) => {
        const trimmed = args.trim();
        const [subcommand, ...rest] = trimmed.split(/\s+/);
        const subArgs = rest.join(' ');

        // /orders (no args) → open interactive panel
        if (!subcommand || subcommand === 'ui') {
          context.emit('done');
          return { handled: true, showPanel: 'orders' };
        }

        const manager = context.getOrdersManager?.();
        if (!manager) {
          context.emit('text', 'Orders are not enabled. Set orders.enabled: true in config.\n');
          context.emit('done');
          return { handled: true };
        }

        // /orders list [--status X]
        if (subcommand === 'list') {
          try {
            const statusMatch = subArgs.match(/--status\s+(\S+)/);
            const status = statusMatch?.[1];
            const orders = manager.listOrders({ status: status as any, limit: 20 });
            if (orders.length === 0) {
              context.emit('text', 'No orders found.\n');
            } else {
              context.emit('text', `Orders (${orders.length}):\n\n`);
              for (const order of orders) {
                const amount = order.totalAmount != null ? ` | ${order.currency} ${order.totalAmount.toFixed(2)}` : '';
                const desc = order.description ? ` — ${order.description}` : '';
                context.emit('text', `  ${order.id}: ${order.storeName} [${order.status}]${amount}${desc}\n`);
              }
            }
          } catch (error) {
            context.emit('text', `Error: ${error instanceof Error ? error.message : String(error)}\n`);
          }
          context.emit('done');
          return { handled: true };
        }

        // /orders create <store> [description]
        if (subcommand === 'create') {
          const parts = splitArgs(subArgs);
          const store = parts[0];
          const description = parts.slice(1).join(' ') || undefined;

          if (!store) {
            context.emit('text', 'Usage: /orders create <store> [description]\n');
            context.emit('text', 'Example: /orders create Amazon "New laptop order"\n');
            context.emit('done');
            return { handled: true };
          }

          try {
            const result = manager.createOrder(store, { description });
            if (result.success) {
              context.emit('text', `Order created!\n`);
              context.emit('text', `  ID:    ${result.orderId}\n`);
              context.emit('text', `  Store: ${store}\n`);
              if (description) context.emit('text', `  Desc:  ${description}\n`);
            } else {
              context.emit('text', `Error: ${result.message}\n`);
            }
          } catch (error) {
            context.emit('text', `Error: ${error instanceof Error ? error.message : String(error)}\n`);
          }
          context.emit('done');
          return { handled: true };
        }

        // /orders get <id>
        if (subcommand === 'get') {
          const orderId = subArgs.trim();
          if (!orderId) {
            context.emit('text', 'Usage: /orders get <order-id>\n');
            context.emit('done');
            return { handled: true };
          }

          try {
            const result = manager.getOrder(orderId);
            if (!result) {
              context.emit('text', `Order "${orderId}" not found.\n`);
            } else {
              const { order, items } = result;
              context.emit('text', `Order ${order.id}\n`);
              context.emit('text', `  Store:   ${order.storeName}\n`);
              context.emit('text', `  Status:  ${order.status}\n`);
              if (order.orderNumber) context.emit('text', `  Order #: ${order.orderNumber}\n`);
              if (order.description) context.emit('text', `  Desc:    ${order.description}\n`);
              if (order.totalAmount != null) context.emit('text', `  Total:   ${order.currency} ${order.totalAmount.toFixed(2)}\n`);
              if (order.trackingNumber) context.emit('text', `  Track:   ${order.trackingNumber}\n`);
              if (items.length > 0) {
                context.emit('text', `  Items (${items.length}):\n`);
                for (const item of items) {
                  const price = item.totalPrice != null ? ` — $${item.totalPrice.toFixed(2)}` : '';
                  context.emit('text', `    - ${item.name} x${item.quantity}${price}\n`);
                }
              }
            }
          } catch (error) {
            context.emit('text', `Error: ${error instanceof Error ? error.message : String(error)}\n`);
          }
          context.emit('done');
          return { handled: true };
        }

        // /orders cancel <id>
        if (subcommand === 'cancel') {
          const orderId = subArgs.trim();
          if (!orderId) {
            context.emit('text', 'Usage: /orders cancel <order-id>\n');
            context.emit('done');
            return { handled: true };
          }

          const result = manager.cancelOrder(orderId);
          context.emit('text', `${result.success ? result.message : `Error: ${result.message}`}\n`);
          context.emit('done');
          return { handled: true };
        }

        // /orders track <id>
        if (subcommand === 'track') {
          const orderId = subArgs.trim();
          if (!orderId) {
            context.emit('text', 'Usage: /orders track <order-id>\n');
            context.emit('done');
            return { handled: true };
          }

          const tracking = manager.getTracking(orderId);
          if (!tracking) {
            context.emit('text', `Order "${orderId}" not found.\n`);
          } else {
            context.emit('text', `Tracking: ${tracking.orderId}\n`);
            context.emit('text', `  Store:    ${tracking.storeName}\n`);
            context.emit('text', `  Status:   ${tracking.status}\n`);
            context.emit('text', `  Track #:  ${tracking.trackingNumber || 'N/A'}\n`);
            if (tracking.trackingUrl) context.emit('text', `  URL:      ${tracking.trackingUrl}\n`);
          }
          context.emit('done');
          return { handled: true };
        }

        // /orders stores
        if (subcommand === 'stores') {
          // /orders stores add <name>
          if (rest[0] === 'add') {
            const name = rest.slice(1).join(' ').trim();
            if (!name) {
              context.emit('text', 'Usage: /orders stores add <store-name>\n');
              context.emit('done');
              return { handled: true };
            }
            const result = manager.addStore(name);
            context.emit('text', `${result.success ? result.message : `Error: ${result.message}`}\n`);
            context.emit('done');
            return { handled: true };
          }

          // /orders stores (list)
          try {
            const stores = manager.listStores();
            if (stores.length === 0) {
              context.emit('text', 'No stores registered. Use /orders stores add <name> to add one.\n');
            } else {
              context.emit('text', `Stores (${stores.length}):\n\n`);
              for (const store of stores) {
                const orders = store.orderCount > 0 ? ` | ${store.orderCount} orders` : '';
                context.emit('text', `  ${store.name} [${store.category}]${orders}\n`);
              }
            }
          } catch (error) {
            context.emit('text', `Error: ${error instanceof Error ? error.message : String(error)}\n`);
          }
          context.emit('done');
          return { handled: true };
        }

        // /orders help
        if (subcommand === 'help') {
          context.emit('text', 'Order Commands:\n\n');
          context.emit('text', '/orders                        Open orders panel\n');
          context.emit('text', '/orders list [--status X]      List orders\n');
          context.emit('text', '/orders create <store> [desc]  Create order\n');
          context.emit('text', '/orders get <id>               Get order details\n');
          context.emit('text', '/orders cancel <id>            Cancel order\n');
          context.emit('text', '/orders track <id>             Get tracking info\n');
          context.emit('text', '/orders stores                 List stores\n');
          context.emit('text', '/orders stores add <name>      Add store\n');
          context.emit('text', '/orders help                   Show this help\n');
          context.emit('done');
          return { handled: true };
        }

        context.emit('text', `Unknown command: ${subcommand}\n`);
        context.emit('text', 'Use /orders help for available commands.\n');
        context.emit('done');
        return { handled: true };
      },
    };
  }

  /**
   * /tasks - Task queue management
   */
  private tasksCommand(): Command {
    return {
      name: 'tasks',
      description: 'Manage task queue for assistant to execute',
      tags: ['tasks', 'queue', 'automation'],
      builtin: true,
      selfHandled: true,
      content: '',
      handler: async (args, context) => {
        const parts = splitArgs(args);
        const sub = parts[0] || '';
        const formatTaskMatch = (task: Task): string => {
          const desc = task.description.length > 60
            ? `${task.description.slice(0, 60)}...`
            : task.description;
          return `${task.id} - ${desc}`;
        };
        const emitResolveError = (id: string, matches: Task[], label: string): void => {
          if (matches.length > 1) {
            const listed = matches.slice(0, 5).map(formatTaskMatch).join('\n');
            const more = matches.length > 5 ? `\n...and ${matches.length - 5} more` : '';
            context.emit('text', `Multiple ${label} match "${id}". Use a longer ID prefix.\n${listed}${more}\n`);
            return;
          }
          context.emit('text', `${label} not found: ${id}\n`);
        };

        // Interactive UI mode - default when no args or explicit 'ui'
        if (!sub || sub === 'ui') {
          context.emit('done');
          return { handled: true, showPanel: 'tasks' as const };
        }

        // Show help with explicit help command
        if (sub === 'help') {
          const tasks = await getTasks(context.cwd);
          const counts = await getTaskCounts(context.cwd);
          const paused = await isPaused(context.cwd);

          let output = '\n📋 **Tasks** - Queue tasks for the assistant to execute\n\n';

          // Show current status
          const pendingCount = counts.pending;
          const inProgressCount = counts.in_progress;
          const completedCount = counts.completed;
          const failedCount = counts.failed;

          if (tasks.length > 0) {
            output += `**Status**: ${pendingCount} pending, ${inProgressCount} in progress, ${completedCount} completed, ${failedCount} failed\n`;
            output += `**Queue**: ${paused ? '⏸ Paused' : '▶ Active'}\n\n`;

            output += '**Recent Tasks:**\n';
            const recent = tasks.slice(0, 5);
            for (const task of recent) {
              const statusIcon = task.status === 'pending' ? '○' :
                                 task.status === 'in_progress' ? '◐' :
                                 task.status === 'completed' ? '●' : '✗';
              const priorityIcon = task.priority === 'high' ? '↑' :
                                   task.priority === 'low' ? '↓' : '-';
              output += `  ${statusIcon} [${priorityIcon}] ${task.description.slice(0, 50)}${task.description.length > 50 ? '...' : ''}\n`;
            }
            if (tasks.length > 5) {
              output += `  ... and ${tasks.length - 5} more\n`;
            }
            output += '\n';
          } else {
            output += '**Status**: No tasks in queue\n\n';
          }

          output += '**Commands:**\n';
          output += '  /tasks                   Open interactive task panel\n';
          output += '  /tasks list              List all tasks\n';
          output += '  /tasks add <desc>        Add a task (normal priority)\n';
          output += '  /tasks add -p high <desc>  Add high priority task\n';
          output += '  /tasks add -p low <desc>   Add low priority task\n';
          output += '  /tasks show <id>         Show task details\n';
          output += '  /tasks delete <id>       Delete a task\n';
          output += '  /tasks clear             Clear all pending tasks\n';
          output += '  /tasks clear done        Clear completed/failed tasks\n';
          output += '  /tasks priority <id> <high|normal|low>\n';
          output += '  /tasks pause             Pause auto-processing\n';
          output += '  /tasks resume            Resume auto-processing\n';
          output += '  /tasks run               Run next pending task\n';
          output += '  /tasks help              Show this help\n';
          output += '\nNote: You can use a unique ID prefix from /tasks list.\n';

          context.emit('text', output);
          context.emit('done');
          return { handled: true };
        }

        // List all tasks
        if (sub === 'list') {
          const tasks = await getTasks(context.cwd);
          if (tasks.length === 0) {
            context.emit('text', 'No tasks in queue.\n');
            context.emit('done');
            return { handled: true };
          }

          const paused = await isPaused(context.cwd);
          let output = `\n**Task Queue** ${paused ? '(Paused)' : ''}\n\n`;
          output += '| Status | Pri | ID | Description | Created |\n';
          output += '|--------|-----|----|-------------|----------|\n';

          for (const task of tasks) {
            const statusIcon = task.status === 'pending' ? '○' :
                               task.status === 'in_progress' ? '◐' :
                               task.status === 'completed' ? '●' : '✗';
            const priorityIcon = task.priority === 'high' ? '↑' :
                                 task.priority === 'low' ? '↓' : '-';
            const desc = task.description.slice(0, 40) + (task.description.length > 40 ? '...' : '');
            const created = new Date(task.createdAt).toLocaleDateString();
            output += `| ${statusIcon} | ${priorityIcon} | ${task.id} | ${desc} | ${created} |\n`;
          }

          context.emit('text', output);
          context.emit('done');
          return { handled: true };
        }

        // Add a task
        if (sub === 'add') {
          let priority: TaskPriority = 'normal';
          let descriptionParts = parts.slice(1);

          // Check for priority flag
          if (descriptionParts[0] === '-p' && descriptionParts[1]) {
            const p = descriptionParts[1].toLowerCase();
            if (p === 'high' || p === 'normal' || p === 'low') {
              priority = p as TaskPriority;
              descriptionParts = descriptionParts.slice(2);
            }
          }

          const description = descriptionParts.join(' ').trim();
          if (!description) {
            context.emit('text', 'Usage: /tasks add [-p high|normal|low] <description>\n');
            context.emit('done');
            return { handled: true };
          }

          const projectId = context.getActiveProjectId?.() || undefined;
          const task = await addTask(context.cwd, description, priority, projectId);
          const priorityLabel = task.priority === 'high' ? ' (high priority)' :
                                task.priority === 'low' ? ' (low priority)' : '';
          context.emit('text', `Task added${priorityLabel}: ${task.description}\n`);
          context.emit('text', `ID: ${task.id}\n`);
          context.emit('done');
          return { handled: true };
        }

        // Show task details
        if (sub === 'show') {
          const id = parts[1];
          if (!id) {
            context.emit('text', 'Usage: /tasks show <id>\n');
            context.emit('done');
            return { handled: true };
          }

          const { task, matches } = await resolveTaskId(context.cwd, id);
          if (!task) {
            emitResolveError(id, matches, 'Task');
            context.emit('done');
            return { handled: true };
          }

          let output = '\n**Task Details**\n\n';
          output += `**ID:** ${task.id}\n`;
          output += `**Description:** ${task.description}\n`;
          output += `**Status:** ${task.status}\n`;
          output += `**Priority:** ${task.priority}\n`;
          output += `**Created:** ${new Date(task.createdAt).toLocaleString()}\n`;
          if (task.startedAt) {
            output += `**Started:** ${new Date(task.startedAt).toLocaleString()}\n`;
          }
          if (task.completedAt) {
            output += `**Completed:** ${new Date(task.completedAt).toLocaleString()}\n`;
          }
          if (task.result) {
            output += `**Result:** ${task.result}\n`;
          }
          if (task.error) {
            output += `**Error:** ${task.error}\n`;
          }
          if (task.projectId) {
            output += `**Project:** ${task.projectId}\n`;
          }

          context.emit('text', output);
          context.emit('done');
          return { handled: true };
        }

        // Delete a task
        if (sub === 'delete') {
          const id = parts[1];
          if (!id) {
            context.emit('text', 'Usage: /tasks delete <id>\n');
            context.emit('done');
            return { handled: true };
          }

          const { task, matches } = await resolveTaskId(context.cwd, id);
          if (!task) {
            emitResolveError(id, matches, 'Task');
            context.emit('done');
            return { handled: true };
          }

          const deleted = await deleteTask(context.cwd, task.id);
          if (deleted) {
            context.emit('text', `Task deleted: ${task.id}\n`);
          } else {
            context.emit('text', `Task not found: ${task.id}\n`);
          }
          context.emit('done');
          return { handled: true };
        }

        // Clear tasks
        if (sub === 'clear') {
          const arg = parts[1]?.toLowerCase();
          if (arg === 'done' || arg === 'completed') {
            const count = await clearCompletedTasks(context.cwd);
            context.emit('text', `Cleared ${count} completed/failed task${count !== 1 ? 's' : ''}.\n`);
          } else {
            const count = await clearPendingTasks(context.cwd);
            context.emit('text', `Cleared ${count} pending task${count !== 1 ? 's' : ''}.\n`);
          }
          context.emit('done');
          return { handled: true };
        }

        // Change priority
        if (sub === 'priority') {
          const id = parts[1];
          const newPriority = parts[2]?.toLowerCase();
          if (!id || !newPriority) {
            context.emit('text', 'Usage: /tasks priority <id> <high|normal|low>\n');
            context.emit('done');
            return { handled: true };
          }

          if (newPriority !== 'high' && newPriority !== 'normal' && newPriority !== 'low') {
            context.emit('text', 'Priority must be high, normal, or low.\n');
            context.emit('done');
            return { handled: true };
          }

          const { task: resolved, matches } = await resolveTaskId(context.cwd, id);
          if (!resolved) {
            emitResolveError(id, matches, 'Task');
            context.emit('done');
            return { handled: true };
          }

          const task = await updateTask(context.cwd, resolved.id, { priority: newPriority as TaskPriority });
          if (task) {
            context.emit('text', `Task priority updated to ${newPriority}: ${task.description}\n`);
          } else {
            context.emit('text', `Task not found: ${resolved.id}\n`);
          }
          context.emit('done');
          return { handled: true };
        }

        // Pause queue
        if (sub === 'pause') {
          await setPaused(context.cwd, true);
          context.emit('text', 'Task queue paused. Tasks will not auto-run.\n');
          context.emit('done');
          return { handled: true };
        }

        // Resume queue
        if (sub === 'resume') {
          await setPaused(context.cwd, false);
          context.emit('text', 'Task queue resumed. Tasks will auto-run.\n');
          context.emit('done');
          return { handled: true };
        }

        // Run next task (manual run works even when auto-run is paused)
        if (sub === 'run') {
          const paused = await isPaused(context.cwd);
          if (paused) {
            context.emit('text', 'Note: Auto-run is paused. Running task manually.\n');
          }

          const nextTask = await getNextTask(context.cwd);
          if (!nextTask) {
            context.emit('text', 'No pending tasks to run.\n');
            context.emit('done');
            return { handled: true };
          }

          // Mark as in progress
          const started = await startTask(context.cwd, nextTask.id);
          if (!started) {
            context.emit('text', 'Failed to start task (locked or missing).\n');
            context.emit('done');
            return { handled: true };
          }
          context.emit('text', `Running task: ${nextTask.description}\n`);
          context.emit('done');

          // Return the task description as a prompt to execute
          return {
            handled: false,
            prompt: `Execute the following task:\n\n${nextTask.description}\n\nWhen done, report the result.`,
          };
        }

        context.emit('text', `Unknown tasks command: ${sub}\n`);
        context.emit('text', 'Use /tasks help for available commands.\n');
        context.emit('done');
        return { handled: true };
      },
    };
  }

  /**
   * /workspace - Manage shared workspaces for agent collaboration
   */
  private workspaceCommand(): Command {
    return {
      name: 'workspace',
      description: 'Manage shared workspaces for agent collaboration',
      builtin: true,
      selfHandled: true,
      content: '',
      handler: async (args, context) => {
        const { SharedWorkspaceManager, getActiveWorkspaceId, setActiveWorkspaceId } = await import('../workspace');
        const manager = new SharedWorkspaceManager();
        const trimmedArgs = args.trim();
        const parts = trimmedArgs.split(/\s+/);
        const action = parts[0]?.toLowerCase() || '';

        // /workspace (no args) - show interactive panel
        if (action === '') {
          context.emit('done');
          return { handled: true, showPanel: 'workspace' as const };
        }

        // /workspace help
        if (action === 'help') {
          let message = '\n## Workspace Commands\n\n';
          message += '/workspace                       Browse workspaces interactively\n';
          message += '/workspace list                  List all workspaces\n';
          message += '/workspace create <name>         Create a new shared workspace\n';
          message += '/workspace use <id|name>         Set active workspace\n';
          message += '/workspace current              Show active workspace\n';
          message += '/workspace clear                Clear active workspace (use global)\n';
          message += '/workspace info <id>             Show workspace details\n';
          message += '/workspace archive <id>          Archive a workspace\n';
          message += '/workspace help                  Show this help\n';
          context.emit('text', message);
          context.emit('done');
          return { handled: true };
        }

        // /workspace list
        if (action === 'list') {
          const activeId = getActiveWorkspaceId();
          const workspaces = manager.list();
          if (workspaces.length === 0) {
            context.emit('text', '\nNo shared workspaces. Use /workspace create <name> to create one.\n');
          } else {
            let message = '\n**Shared Workspaces**\n\n';
            for (const ws of workspaces) {
              const prefix = ws.id === activeId ? '* ' : '- ';
              message += `${prefix}**${ws.name}** (${ws.id})\n`;
              message += `  Participants: ${ws.participants.length} | Status: ${ws.status}\n`;
              message += `  Created: ${new Date(ws.createdAt).toLocaleString()}\n`;
            }
            context.emit('text', message);
          }
          context.emit('done');
          return { handled: true };
        }

        // /workspace create <name>
        if (action === 'create') {
          const name = parts.slice(1).join(' ').trim();
          if (!name) {
            context.emit('text', '\nUsage: /workspace create <name>\n');
            context.emit('done');
            return { handled: true };
          }
          const creatorId = context.sessionId || 'default';
          const workspace = manager.create(name, creatorId, []);
          context.emit('text', `\n✓ Workspace created: **${workspace.name}** (${workspace.id})\n`);
          context.emit('text', `  Path: ${manager.getPath(workspace.id)}\n`);
          context.emit('done');
          return { handled: true };
        }

        // /workspace use <id|name>
        if (action === 'use' || action === 'switch') {
          const target = parts.slice(1).join(' ').trim();
          if (!target) {
            context.emit('text', '\nUsage: /workspace use <id|name>\n');
            context.emit('done');
            return { handled: true };
          }
          const all = manager.list(true);
          const workspace = manager.get(target)
            || all.find((ws) => ws.name.toLowerCase() === target.toLowerCase());
          if (!workspace) {
            context.emit('text', `\nWorkspace ${target} not found.\n`);
            context.emit('done');
            return { handled: true };
          }
          setActiveWorkspaceId(workspace.id);
          context.emit('text', `\n✓ Active workspace set: **${workspace.name}** (${workspace.id})\n`);
          context.emit('done');
          return { handled: true };
        }

        // /workspace current
        if (action === 'current' || action === 'active') {
          const activeId = getActiveWorkspaceId();
          if (!activeId) {
            context.emit('text', '\nNo active workspace (using global context).\n');
            context.emit('done');
            return { handled: true };
          }
          const workspace = manager.get(activeId);
          if (!workspace) {
            context.emit('text', `\nActive workspace ${activeId} not found.\n`);
            context.emit('done');
            return { handled: true };
          }
          context.emit('text', `\nActive workspace: **${workspace.name}** (${workspace.id})\n`);
          context.emit('done');
          return { handled: true };
        }

        // /workspace clear
        if (action === 'clear' || action === 'reset') {
          setActiveWorkspaceId(null);
          context.emit('text', '\n✓ Cleared active workspace (using global context).\n');
          context.emit('done');
          return { handled: true };
        }

        // /workspace info <id>
        if (action === 'info') {
          const id = parts[1]?.trim();
          if (!id) {
            context.emit('text', '\nUsage: /workspace info <id>\n');
            context.emit('done');
            return { handled: true };
          }
          const workspace = manager.get(id);
          if (!workspace) {
            context.emit('text', `\nWorkspace ${id} not found.\n`);
          } else {
            let message = `\n**Workspace: ${workspace.name}**\n\n`;
            message += `ID: ${workspace.id}\n`;
            message += `Status: ${workspace.status}\n`;
            message += `Created by: ${workspace.createdBy}\n`;
            message += `Participants: ${workspace.participants.join(', ')}\n`;
            message += `Created: ${new Date(workspace.createdAt).toLocaleString()}\n`;
            message += `Path: ${manager.getPath(workspace.id)}\n`;
            if (workspace.description) {
              message += `Description: ${workspace.description}\n`;
            }
            context.emit('text', message);
          }
          context.emit('done');
          return { handled: true };
        }

        // /workspace archive <id>
        if (action === 'archive') {
          const id = parts[1]?.trim();
          if (!id) {
            context.emit('text', '\nUsage: /workspace archive <id>\n');
            context.emit('done');
            return { handled: true };
          }
          manager.archive(id);
          context.emit('text', `\n✓ Workspace ${id} archived.\n`);
          context.emit('done');
          return { handled: true };
        }

        context.emit('text', '\nUnknown workspace command. Use /workspace help for available commands.\n');
        context.emit('done');
        return { handled: true };
      },
    };
  }



  /**
   * /setup - Run the interactive setup wizard
   */
  private setupCommand(): Command {
    return {
      name: 'setup',
      aliases: ['onboarding'],
      description: 'Run the interactive setup wizard',
      builtin: true,
      selfHandled: true,
      content: '',
      handler: async (_args, context) => {
        context.emit('done');
        return { handled: true, showPanel: 'setup' as const };
      },
    };
  }

  private exitCommand(): Command {
    return {
      name: 'exit',
      description: 'Exit the assistant session and return to shell',
      builtin: true,
      selfHandled: true,
      content: '',
      handler: async (args, context) => {
        context.emit('text', 'Goodbye!\n');
        context.emit('done');
        // Signal exit by returning special flag
        return { handled: true, exit: true };
      },
    };
  }

  /**
   * /session - List and switch sessions
   */
  private sessionCommand(): Command {
    return {
      name: 'sessions',
      aliases: ['session'],
      description: 'Manage sessions: list, create with agent, switch, assign agent',
      builtin: true,
      selfHandled: true,
      content: '',
      handler: async (args, context) => {
        const parts = splitArgs(args);
        const sub = parts[0]?.toLowerCase() || '';

        // /session help
        if (sub === 'help') {
          let message = '\n## Session Commands\n\n';
          message += '/session                           List all sessions\n';
          message += '/session list                      List all sessions with agents\n';
          message += '/session new [label] --agent <name>  Create session with agent\n';
          message += '/session assign <agent>            Assign agent to current session\n';
          message += '/session rename [number] <label>   Rename a session (defaults to current)\n';
          message += '/session <number>                  Switch to session by number\n';
          message += '/session help                      Show this help\n';
          context.emit('text', message);
          context.emit('done');
          return { handled: true };
        }

        // /session new [label] --agent <name>
        if (sub === 'new') {
          let label: string | undefined;
          let agent: string | undefined;

          // Parse --agent flag
          const agentIdx = parts.indexOf('--agent');
          if (agentIdx !== -1 && parts[agentIdx + 1]) {
            agent = parts[agentIdx + 1];
            const labelParts = parts.slice(1, agentIdx);
            if (labelParts.length > 0) {
              label = labelParts.join(' ');
            }
          } else {
            const labelParts = parts.slice(1);
            if (labelParts.length > 0) {
              label = labelParts.join(' ');
            }
          }

          // Validate agent name if provided
          if (agent) {
            const assistantManager = context.getAssistantManager?.();
            if (assistantManager) {
              const assistants = assistantManager.listAssistants();
              const found = assistants.find(
                (a) => a.name.toLowerCase() === agent!.toLowerCase() || a.id === agent
              );
              if (!found) {
                const names = assistants.map((a) => a.name).join(', ');
                context.emit('text', `\n⚠ Agent "${agent}" not found. Available: ${names || 'none'}\n`);
                context.emit('done');
                return { handled: true };
              }
              agent = found.id;
              if (label) {
                context.emit('text', `\n✓ Creating session "${label}" with agent ${found.name}\n`);
              } else {
                context.emit('text', `\n✓ Creating session with agent ${found.name}\n`);
              }
            }
          }

          context.emit('done');
          return {
            handled: true,
            sessionAction: 'new',
            sessionLabel: label,
            sessionAgent: agent,
          };
        }

        // /session assign <agent>
        if (sub === 'assign') {
          const agentName = parts.slice(1).join(' ').trim();
          if (!agentName) {
            context.emit('text', '\nUsage: /session assign <agent-name>\n');
            context.emit('done');
            return { handled: true };
          }

          const assistantManager = context.getAssistantManager?.();
          if (!assistantManager) {
            context.emit('text', '\n⚠ Assistant manager not available.\n');
            context.emit('done');
            return { handled: true };
          }

          const assistants = assistantManager.listAssistants();
          const found = assistants.find(
            (a) => a.name.toLowerCase() === agentName.toLowerCase() || a.id === agentName
          );
          if (!found) {
            const names = assistants.map((a) => a.name).join(', ');
            context.emit('text', `\n⚠ Agent "${agentName}" not found. Available: ${names || 'none'}\n`);
            context.emit('done');
            return { handled: true };
          }

          context.emit('text', `\n✓ Assigned agent **${found.name}** to current session\n`);
          context.emit('done');
          return {
            handled: true,
            sessionAction: 'assign',
            sessionAgent: found.id,
          };
        }

        // /session rename [number] <label>
        if (sub === 'rename' || sub === 'name') {
          if (parts.length < 2) {
            context.emit('text', '\nUsage: /session rename [number] <label>\n');
            context.emit('done');
            return { handled: true };
          }

          let sessionNumber: number | undefined;
          let labelParts = parts.slice(1);
          const firstArg = parts[1];
          const parsedNumber = parseInt(firstArg, 10);
          if (!isNaN(parsedNumber) && parsedNumber > 0) {
            sessionNumber = parsedNumber;
            labelParts = parts.slice(2);
          } else if (['current', 'this', '.'].includes(firstArg.toLowerCase())) {
            labelParts = parts.slice(2);
          }

          const label = labelParts.join(' ').trim();
          if (!label) {
            context.emit('text', '\nUsage: /session rename [number] <label>\n');
            context.emit('done');
            return { handled: true };
          }

          context.emit('done');
          return {
            handled: true,
            sessionAction: 'rename',
            sessionNumber,
            sessionLabel: label,
          };
        }

        // /session <number> - switch
        const num = parseInt(sub, 10);
        if (!isNaN(num) && num > 0) {
          context.emit('done');
          return { handled: true, sessionAction: 'switch', sessionNumber: num };
        }

        // /session list or no arg - signal to show session list
        context.emit('done');
        return { handled: true, sessionAction: 'list' };
      },
    };
  }

  /**
   * /resume - Resume saved sessions
   */
  private resumeCommand(): Command {
    return {
      name: 'resume',
      description: 'Resume saved sessions from disk',
      builtin: true,
      selfHandled: true,
      content: '',
      handler: async (args, context) => {
        const trimmed = args.trim().toLowerCase();
        const showAll = trimmed.includes('--all');
        const cleanedArgs = trimmed.replace('--all', '').trim();

        if (!cleanedArgs || cleanedArgs === 'ui') {
          context.emit('done');
          return {
            handled: true,
            showPanel: 'resume',
            panelValue: showAll ? 'all' : 'cwd',
          };
        }

        if (cleanedArgs === 'list' || cleanedArgs === '--list') {
          const allSessions = SessionStorage.listAllSessions(context.getStorageDir?.());
          const normalizeCwd = (value: string) => value.replace(/\/+$/, '');
          const targetCwd = normalizeCwd(context.cwd);
          const sessions = showAll
            ? allSessions
            : allSessions.filter((session) => normalizeCwd(session.cwd) === targetCwd);

          if (sessions.length === 0) {
            context.emit(
              'text',
              showAll
                ? 'No saved sessions found.\n'
                : 'No saved sessions found for this directory.\n'
            );
            context.emit('done');
            return { handled: true };
          }

          const assistantManager = context.getAssistantManager?.();
          const assistantNames = assistantManager
            ? new Map(assistantManager.listAssistants().map((a) => [a.id, a.name]))
            : null;

          const truncate = (value: string, maxLen: number) =>
            value.length > maxLen ? `${value.slice(0, maxLen - 3)}...` : value;
          const escapeCell = (value: string) =>
            value.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

          let output = '\n';
          if (showAll) {
            output += '| ID | Assistant | Updated | Messages | CWD |\n';
            output += '|----|-----------|---------|----------|-----|\n';
          } else {
            output += '| ID | Updated | Messages | CWD |\n';
            output += '|----|---------|----------|-----|\n';
          }

          for (const session of sessions) {
            const updated = formatRelativeTime(new Date(session.updatedAt).getTime());
            const messageCount = session.messageCount ?? 0;
            const cwd = escapeCell(truncate(singleLine(session.cwd || ''), 48));
            const id = escapeCell(session.id.slice(0, 8));
            if (showAll) {
              const assistantLabel = session.assistantId
                ? assistantNames?.get(session.assistantId) || session.assistantId
                : 'default';
              output += `| ${id} | ${escapeCell(truncate(assistantLabel, 16))} | ${updated} | ${messageCount} | ${cwd} |\n`;
            } else {
              output += `| ${id} | ${updated} | ${messageCount} | ${cwd} |\n`;
            }
          }

          context.emit('text', output);
          context.emit('done');
          return { handled: true };
        }

        context.emit('text', '\n**Resume** - Load saved sessions from disk\n\n');
        context.emit('text', 'Usage:\n');
        context.emit('text', '  /resume             Open interactive panel (current folder)\n');
        context.emit('text', '  /resume --all       Open interactive panel (all sessions)\n');
        context.emit('text', '  /resume list        Show text table (current folder)\n');
        context.emit('text', '  /resume list --all  Show text table (all sessions)\n');
        context.emit('done');
        return { handled: true };
      },
    };
  }

  /**
   * /tokens - Show token usage (alias for /status)
   */
  private tokensCommand(): Command {
    return {
      name: 'tokens',
      description: 'Show token usage breakdown (input, output, cache, total)',
      builtin: true,
      selfHandled: true,
      content: '',
      handler: async (args, context) => {
        const usage = this.tokenUsage;
        const rawPercent = usage.maxContextTokens > 0
          ? Math.round((usage.totalTokens / usage.maxContextTokens) * 100)
          : 0;
        const usedPercent = Math.max(0, Math.min(100, rawPercent));

        let message = '\n**Token Usage**\n\n';
        message += `Input: ${usage.inputTokens.toLocaleString()}\n`;
        message += `Output: ${usage.outputTokens.toLocaleString()}\n`;
        message += `Total: ${usage.totalTokens.toLocaleString()} / ${usage.maxContextTokens.toLocaleString()} (${usedPercent}%)\n`;

        // Visual progress bar
        const barLength = 30;
        const filledLength = Math.max(0, Math.min(barLength, Math.round((usedPercent / 100) * barLength)));
        const bar = '█'.repeat(filledLength) + '░'.repeat(Math.max(0, barLength - filledLength));
        message += `\n[${bar}] ${usedPercent}%\n`;

        context.emit('text', message);
        context.emit('done');
        return { handled: true };
      },
    };
  }

  /**
   * /context - Manage injected project context or show context status
   */
  private contextCommand(): Command {
    return {
      name: 'context',
      description: 'Manage injected project context (files, connectors, notes) or show status',
      builtin: true,
      selfHandled: true,
      content: '',
      handler: async (args, context) => {
        const parts = splitArgs(args);
        const sub = parts[0] || 'status';

        if (sub === 'help') {
          const usage = [
            'Usage:',
            '  /context status',
            '  /context list',
            '  /context add file <path>',
            '  /context add connector <name>',
            '  /context add database <name>',
            '  /context add note <text>',
            '  /context add entity <text>',
            '  /context remove <id>',
            '  /context clear',
          ].join('\n');
          context.emit('text', `\n${usage}\n`);
          context.emit('done');
          return { handled: true };
        }

        if (sub === 'status') {
          const info = context.getContextInfo?.();
          if (!info) {
            context.emit('text', '\nContext summarization is not available.\n');
            context.emit('done');
            return { handled: true };
          }

          const { config, state } = info;
          const rawPercent = config.maxContextTokens > 0
            ? Math.round((state.totalTokens / config.maxContextTokens) * 100)
            : 0;
          const usedPercent = Math.max(0, Math.min(100, rawPercent));

          let message = '\n**Context Status**\n\n';
          message += `**Messages:** ${state.messageCount}\n`;
          message += `**Estimated Tokens:** ${state.totalTokens.toLocaleString()} / ${config.maxContextTokens.toLocaleString()} (${usedPercent}%)\n`;
          message += `**Summary Count:** ${state.summaryCount}\n`;
          message += `**Strategy:** ${config.summaryStrategy}\n`;
          message += `**Keep Recent Messages:** ${config.keepRecentMessages}\n`;

          if (state.lastSummaryAt) {
            message += `**Last Summary:** ${state.lastSummaryAt}\n`;
            if (state.lastSummaryTokensBefore && state.lastSummaryTokensAfter) {
              message += `**Last Summary Tokens:** ${state.lastSummaryTokensBefore.toLocaleString()} -> ${state.lastSummaryTokensAfter.toLocaleString()}\n`;
            }
          }

          const barLength = 30;
          const filledLength = Math.max(0, Math.min(barLength, Math.round((usedPercent / 100) * barLength)));
          const bar = '█'.repeat(filledLength) + '░'.repeat(Math.max(0, barLength - filledLength));
          message += `\n[${bar}] ${usedPercent}%\n`;

          context.emit('text', message);
          context.emit('done');
          return { handled: true };
        }

        const project = await this.ensureActiveProject(context, true);
        if (!project) {
          context.emit('text', 'No project found. Use /projects new <name> first.\n');
          context.emit('done');
          return { handled: true };
        }

        if (sub === 'list') {
          if (project.context.length === 0) {
            context.emit('text', `\nNo context entries for project "${project.name}".\n`);
            context.emit('done');
            return { handled: true };
          }
          let output = `\n**Context Entries (${singleLine(project.name)})**\n\n`;
          for (const entry of project.context) {
            const label = entry.label ? ` (${singleLine(entry.label)})` : '';
            output += `- ${entry.id} [${entry.type}] ${singleLine(entry.value)}${label}\n`;
          }
          context.emit('text', output);
          context.emit('done');
          return { handled: true };
        }

        if (sub === 'clear') {
          const updated = await updateProject(context.cwd, project.id, (current) => ({
            ...current,
            context: [],
            updatedAt: Date.now(),
          }));
          if (updated) {
            await this.applyProjectContext(context, updated);
            context.emit('text', `Cleared context entries for "${updated.name}".\n`);
            context.emit('done');
            return { handled: true };
          }
          context.emit('text', `Failed to clear context entries for "${project.name}".\n`);
          context.emit('done');
          return { handled: true };
        }

        if (sub === 'remove') {
          const id = parts[1];
          if (!id) {
            context.emit('text', 'Usage: /context remove <id>\n');
            context.emit('done');
            return { handled: true };
          }
          if (!project.context.some((entry) => entry.id === id)) {
            context.emit('text', `Context entry not found: ${id}\n`);
            context.emit('done');
            return { handled: true };
          }
          const updated = await updateProject(context.cwd, project.id, (current) => ({
            ...current,
            context: current.context.filter((entry) => entry.id !== id),
            updatedAt: Date.now(),
          }));
          if (updated) {
            await this.applyProjectContext(context, updated);
            context.emit('text', `Removed context entry ${id} from "${updated.name}".\n`);
            context.emit('done');
            return { handled: true };
          }
          context.emit('text', `Failed to remove context entry ${id} from "${project.name}".\n`);
          context.emit('done');
          return { handled: true };
        }

        if (sub === 'add') {
          const type = parts[1];
          const value = parts.slice(2).join(' ').trim();
          if (!type) {
            context.emit('text', 'Usage: /context add <type> <value>\n');
            context.emit('done');
            return { handled: true };
          }

          const allowedTypes: ProjectContextEntry['type'][] = ['file', 'connector', 'database', 'note', 'entity'];
          const entryType = allowedTypes.includes(type as ProjectContextEntry['type'])
            ? (type as ProjectContextEntry['type'])
            : 'note';
          const entryValue = entryType === 'note' && !value ? parts.slice(1).join(' ').trim() : value;
          if (!entryValue) {
            context.emit('text', 'Error: context value is required.\n');
            context.emit('done');
            return { handled: true };
          }

          const entry: ProjectContextEntry = {
            id: generateId(),
            type: entryType,
            value: entryValue,
            addedAt: Date.now(),
          };

          const updated = await updateProject(context.cwd, project.id, (current) => ({
            ...current,
            context: [...current.context, entry],
            updatedAt: Date.now(),
          }));

          if (updated) {
            await this.applyProjectContext(context, updated);
            context.emit('text', `Added ${entry.type} context to "${updated.name}".\n`);
            context.emit('done');
            return { handled: true };
          }
          context.emit('text', `Failed to add context entry to "${project.name}".\n`);
          context.emit('done');
          return { handled: true };
        }

        context.emit('text', 'Unknown /context command. Use /context help.\n');
        context.emit('done');
        return { handled: true };
      },
    };
  }

  /**
   * /projects - Manage projects in the current folder
   */
  private projectsCommand(): Command {
    return {
      name: 'projects',
      description: 'Manage projects inside this folder',
      builtin: true,
      selfHandled: true,
      content: '',
      handler: async (args, context) => {
        const parts = splitArgs(args);
        const sub = parts[0] || '';

        // Interactive UI mode - default when no args or explicit 'ui'
        if (!sub || sub === 'ui') {
          context.emit('done');
          return { handled: true, showPanel: 'projects' as const };
        }

        // Show help with explicit help command
        if (sub === 'help') {
          const projects = await listProjects(context.cwd);
          const activeId = context.getActiveProjectId?.();
          const activeProject = activeId ? projects.find(p => p.id === activeId) : null;

          let output = '\n📁 **Projects** - Manage projects in this folder\n\n';
          output += '**Commands:**\n';
          output += '  /projects                         Interactive project manager\n';
          output += '  /projects list                    List all projects\n';
          output += '  /projects new <name>              Create new project\n';
          output += '  /projects use <id|name>           Select active project\n';
          output += '  /projects show [id|name]          Show project details\n';
          output += '  /projects describe <id> <text>    Update description\n';
          output += '  /projects delete <id|name>        Delete project\n';
          output += '\n';

          if (activeProject) {
            output += `**Current:** ${singleLine(activeProject.name)} (${activeProject.id})\n`;
          } else if (projects.length > 0) {
            output += `**Projects:** ${projects.length} (none selected)\n`;
          } else {
            output += '**No projects yet.** Use `/projects new <name>` to create one.\n';
          }

          context.emit('text', output);
          context.emit('done');
          return { handled: true };
        }

        if (sub === 'list' || sub === 'ls') {
          const projects = await listProjects(context.cwd);
          if (projects.length === 0) {
            context.emit('text', '\nNo projects found. Use /projects new <name>.\n');
            context.emit('done');
            return { handled: true };
          }
          const activeId = context.getActiveProjectId?.();
          let output = '\n**Projects**\n\n';
          for (const project of projects) {
            const marker = project.id === activeId ? '*' : ' ';
            output += `${marker} ${singleLine(project.name)} (${project.id})\n`;
          }
          context.emit('text', output);
          context.emit('done');
          return { handled: true };
        }

        if (sub === 'new' || sub === 'create') {
          const name = parts.slice(1).join(' ').trim();
          if (!name) {
            context.emit('text', 'Usage: /projects new <name>\n');
            context.emit('done');
            return { handled: true };
          }
          const existing = await listProjects(context.cwd);
          if (hasProjectNameConflict(existing, name)) {
            context.emit('text', `Project "${name}" already exists.\n`);
            context.emit('done');
            return { handled: true };
          }
          const project = await createProject(context.cwd, name);
          context.setActiveProjectId?.(project.id);
          await this.applyProjectContext(context, project);
          context.emit('text', `Created project "${project.name}" (${project.id}).\n`);
          context.emit('done');
          return { handled: true };
        }

        if (sub === 'use' || sub === 'switch') {
          const target = parts.slice(1).join(' ').trim();
          if (!target) {
            context.emit('text', 'Usage: /projects use <id|name>\n');
            context.emit('done');
            return { handled: true };
          }
          const project = await this.resolveProject(context, target);
          if (!project) {
            context.emit('text', `Project not found: ${target}\n`);
            context.emit('done');
            return { handled: true };
          }
          context.setActiveProjectId?.(project.id);
          await this.applyProjectContext(context, project);
          context.emit('text', `Switched to project "${project.name}".\n`);
          context.emit('done');
          return { handled: true };
        }

        if (sub === 'show' || sub === 'info') {
          const target = parts.slice(1).join(' ').trim();
          const project = target
            ? await this.resolveProject(context, target)
            : await this.ensureActiveProject(context, false);
          if (!project) {
            context.emit('text', 'No project selected. Use /projects use <id|name>.\n');
            context.emit('done');
            return { handled: true };
          }
          let output = `\n**Project: ${singleLine(project.name)}**\n\n`;
          output += `ID: ${project.id}\n`;
          if (project.description) {
            output += `Description: ${singleLine(project.description)}\n`;
          }
          output += `Context entries: ${project.context.length}\n`;
          output += `Plans: ${project.plans.length}\n`;
          context.emit('text', output);
          context.emit('done');
          return { handled: true };
        }

        if (sub === 'describe' || sub === 'desc') {
          const target = parts[1];
          const description = parts.slice(2).join(' ').trim();
          if (!target || !description) {
            context.emit('text', 'Usage: /projects describe <id|name> <description>\n');
            context.emit('done');
            return { handled: true };
          }
          const project = await this.resolveProject(context, target);
          if (!project) {
            context.emit('text', `Project not found: ${target}\n`);
            context.emit('done');
            return { handled: true };
          }
          const updated = await updateProject(context.cwd, project.id, (current) => ({
            ...current,
            description,
            updatedAt: Date.now(),
          }));
          if (updated) {
            await this.applyProjectContext(context, updated);
            context.emit('text', `Updated project "${updated.name}".\n`);
            context.emit('done');
            return { handled: true };
          }
          context.emit('text', `Failed to update project "${project.name}".\n`);
          context.emit('done');
          return { handled: true };
        }

        if (sub === 'delete' || sub === 'rm') {
          const target = parts.slice(1).join(' ').trim();
          if (!target) {
            context.emit('text', 'Usage: /projects delete <id|name>\n');
            context.emit('done');
            return { handled: true };
          }
          const project = await this.resolveProject(context, target);
          if (!project) {
            context.emit('text', `Project not found: ${target}\n`);
            context.emit('done');
            return { handled: true };
          }
          const ok = await deleteProject(context.cwd, project.id);
          if (ok) {
            if (context.getActiveProjectId?.() === project.id) {
              context.setActiveProjectId?.(null);
              context.setProjectContext?.(null);
            }
            context.emit('text', `Deleted project "${project.name}".\n`);
            context.emit('done');
            return { handled: true };
          }
          context.emit('text', `Failed to delete project "${project.name}".\n`);
          context.emit('done');
          return { handled: true };
        }

        context.emit('text', 'Unknown /projects command. Use /projects help.\n');
        context.emit('done');
        return { handled: true };
      },
    };
  }

  /**
   * /plans - Manage plans for the active project
   */
  private plansCommand(): Command {
    return {
      name: 'plans',
      description: 'Manage plans linked to the active project',
      builtin: true,
      selfHandled: true,
      content: '',
      handler: async (args, context) => {
        const parts = splitArgs(args);
        const sub = parts[0] || '';

        // Interactive UI mode - default when no args or explicit 'ui'
        if (!sub || sub === 'ui') {
          context.emit('done');
          return { handled: true, showPanel: 'plans' as const };
        }

        // Show help with explicit help command
        if (sub === 'help') {
          const project = await this.ensureActiveProject(context, false);

          let output = '\n📋 **Plans** - Manage plans for the active project\n\n';
          output += '**Commands:**\n';
          output += '  /plans                                  Interactive plan manager\n';
          output += '  /plans list                             List all plans\n';
          output += '  /plans new <title>                      Create new plan\n';
          output += '  /plans show <planId>                    Show plan details\n';
          output += '  /plans add <planId> <step>              Add step to plan\n';
          output += '  /plans set <planId> <stepId> <status>   Update step status\n';
          output += '  /plans remove <planId> <stepId>         Remove step\n';
          output += '  /plans delete <planId>                  Delete plan\n';
          output += '\n';

          if (project) {
            output += `**Active project:** ${singleLine(project.name)} (${project.id})\n`;
            output += `**Plans:** ${project.plans.length}\n`;
          } else {
            output += '**No active project.** Use `/projects new <name>` first.\n';
          }

          context.emit('text', output);
          context.emit('done');
          return { handled: true };
        }

        const project = await this.ensureActiveProject(context, true);
        if (!project) {
          context.emit('text', 'No project found. Use /projects new <name> first.\n');
          context.emit('done');
          return { handled: true };
        }

        if (sub === 'list' || sub === 'ls') {
          if (project.plans.length === 0) {
            context.emit('text', `\nNo plans for project "${project.name}".\n`);
            context.emit('done');
            return { handled: true };
          }
          let output = `\n**Plans (${singleLine(project.name)})**\n\n`;
          for (const plan of project.plans) {
            output += `- ${plan.id} ${singleLine(plan.title)} (${plan.steps.length} steps)\n`;
          }
          context.emit('text', output);
          context.emit('done');
          return { handled: true };
        }

        if (sub === 'new' || sub === 'create') {
          const title = parts.slice(1).join(' ').trim();
          if (!title) {
            context.emit('text', 'Usage: /plans new <title>\n');
            context.emit('done');
            return { handled: true };
          }
          const now = Date.now();
          const plan: ProjectPlan = {
            id: generateId(),
            title,
            createdAt: now,
            updatedAt: now,
            steps: [],
          };
          const updated = await updateProject(context.cwd, project.id, (current) => ({
            ...current,
            plans: [...current.plans, plan],
            updatedAt: now,
          }));
          if (updated) {
            await this.applyProjectContext(context, updated);
            context.emit('text', `Created plan "${plan.title}" (${plan.id}).\n`);
            context.emit('done');
            return { handled: true };
          }
          context.emit('text', `Failed to create plan "${plan.title}".\n`);
          context.emit('done');
          return { handled: true };
        }

        if (sub === 'show') {
          const id = parts[1];
          if (!id) {
            context.emit('text', 'Usage: /plans show <planId>\n');
            context.emit('done');
            return { handled: true };
          }
          const plan = project.plans.find((p) => p.id === id);
          if (!plan) {
            context.emit('text', `Plan not found: ${id}\n`);
            context.emit('done');
            return { handled: true };
          }
          let output = `\n**Plan: ${singleLine(plan.title)}**\n\n`;
          output += `ID: ${plan.id}\n`;
          if (plan.steps.length === 0) {
            output += 'No steps yet.\n';
          } else {
            for (const step of plan.steps) {
              output += `- ${step.id} [${step.status}] ${singleLine(step.text)}\n`;
            }
          }
          context.emit('text', output);
          context.emit('done');
          return { handled: true };
        }

        if (sub === 'add') {
          const planId = parts[1];
          const text = parts.slice(2).join(' ').trim();
          if (!planId || !text) {
            context.emit('text', 'Usage: /plans add <planId> <step>\n');
            context.emit('done');
            return { handled: true };
          }
          if (!project.plans.some((plan) => plan.id === planId)) {
            context.emit('text', `Plan not found: ${planId}\n`);
            context.emit('done');
            return { handled: true };
          }
          const now = Date.now();
          const step: ProjectPlanStep = {
            id: generateId(),
            text,
            status: 'todo',
            createdAt: now,
            updatedAt: now,
          };
          const updated = await updateProject(context.cwd, project.id, (current) => ({
            ...current,
            plans: current.plans.map((plan) =>
              plan.id === planId
                ? { ...plan, steps: [...plan.steps, step], updatedAt: now }
                : plan
            ),
            updatedAt: now,
          }));
          if (updated) {
            await this.applyProjectContext(context, updated);
            context.emit('text', `Added step to plan ${planId}.\n`);
            context.emit('done');
            return { handled: true };
          }
          context.emit('text', `Failed to add step to plan ${planId}.\n`);
          context.emit('done');
          return { handled: true };
        }

        if (sub === 'set') {
          const planId = parts[1];
          const stepId = parts[2];
          const status = parts[3] as ProjectPlanStep['status'] | undefined;
          if (!planId || !stepId || !status) {
            context.emit('text', 'Usage: /plans set <planId> <stepId> <todo|doing|done|blocked>\n');
            context.emit('done');
            return { handled: true };
          }
          const plan = project.plans.find((item) => item.id === planId);
          if (!plan) {
            context.emit('text', `Plan not found: ${planId}\n`);
            context.emit('done');
            return { handled: true };
          }
          if (!plan.steps.some((step) => step.id === stepId)) {
            context.emit('text', `Step not found: ${stepId}\n`);
            context.emit('done');
            return { handled: true };
          }
          const allowed: ProjectPlanStep['status'][] = ['todo', 'doing', 'done', 'blocked'];
          if (!allowed.includes(status)) {
            context.emit('text', 'Invalid status. Use todo, doing, done, or blocked.\n');
            context.emit('done');
            return { handled: true };
          }
          const now = Date.now();
          const updated = await updateProject(context.cwd, project.id, (current) => ({
            ...current,
            plans: current.plans.map((plan) =>
              plan.id === planId
                ? {
                    ...plan,
                    steps: plan.steps.map((step) =>
                      step.id === stepId ? { ...step, status, updatedAt: now } : step
                    ),
                    updatedAt: now,
                  }
                : plan
            ),
            updatedAt: now,
          }));
          if (updated) {
            await this.applyProjectContext(context, updated);
            context.emit('text', `Updated step ${stepId} to ${status}.\n`);
            context.emit('done');
            return { handled: true };
          }
          context.emit('text', `Failed to update step ${stepId}.\n`);
          context.emit('done');
          return { handled: true };
        }

        if (sub === 'remove') {
          const planId = parts[1];
          const stepId = parts[2];
          if (!planId || !stepId) {
            context.emit('text', 'Usage: /plans remove <planId> <stepId>\n');
            context.emit('done');
            return { handled: true };
          }
          const plan = project.plans.find((item) => item.id === planId);
          if (!plan) {
            context.emit('text', `Plan not found: ${planId}\n`);
            context.emit('done');
            return { handled: true };
          }
          if (!plan.steps.some((step) => step.id === stepId)) {
            context.emit('text', `Step not found: ${stepId}\n`);
            context.emit('done');
            return { handled: true };
          }
          const now = Date.now();
          const updated = await updateProject(context.cwd, project.id, (current) => ({
            ...current,
            plans: current.plans.map((plan) =>
              plan.id === planId
                ? { ...plan, steps: plan.steps.filter((step) => step.id !== stepId), updatedAt: now }
                : plan
            ),
            updatedAt: now,
          }));
          if (updated) {
            await this.applyProjectContext(context, updated);
            context.emit('text', `Removed step ${stepId} from plan ${planId}.\n`);
            context.emit('done');
            return { handled: true };
          }
          context.emit('text', `Failed to remove step ${stepId} from plan ${planId}.\n`);
          context.emit('done');
          return { handled: true };
        }

        if (sub === 'delete' || sub === 'rm') {
          const planId = parts[1];
          if (!planId) {
            context.emit('text', 'Usage: /plans delete <planId>\n');
            context.emit('done');
            return { handled: true };
          }
          if (!project.plans.some((plan) => plan.id === planId)) {
            context.emit('text', `Plan not found: ${planId}\n`);
            context.emit('done');
            return { handled: true };
          }
          const now = Date.now();
          const updated = await updateProject(context.cwd, project.id, (current) => ({
            ...current,
            plans: current.plans.filter((plan) => plan.id !== planId),
            updatedAt: now,
          }));
          if (updated) {
            await this.applyProjectContext(context, updated);
            context.emit('text', `Deleted plan ${planId}.\n`);
            context.emit('done');
            return { handled: true };
          }
          context.emit('text', `Failed to delete plan ${planId}.\n`);
          context.emit('done');
          return { handled: true };
        }

        context.emit('text', 'Unknown /plans command. Use /plans help.\n');
        context.emit('done');
        return { handled: true };
      },
    };
  }

  /**
   * /summarize - Summarize conversation in background
   *
   * Unlike /compact (which sends a prompt to the LLM in-stream),
   * /summarize dispatches a background task to summarize the context
   * and posts results to the inbox when done.
   */
  private summarizeCommand(): Command {
    return {
      name: 'summarize',
      description: 'Summarize conversation in background (results posted to inbox)',
      builtin: true,
      selfHandled: true,
      content: '',
      handler: async (args, context) => {
        const parts = splitArgs(args);
        const flag = parts[0]?.toLowerCase();

        // /summarize help
        if (flag === 'help') {
          context.emit('text', '\n## /summarize - Background Context Summarization\n\n');
          context.emit('text', 'Dispatches a background task to summarize the current conversation.\n');
          context.emit('text', 'Results are posted to your inbox when complete.\n\n');
          context.emit('text', '**Usage:**\n');
          context.emit('text', '  /summarize         Start background summarization\n');
          context.emit('text', '  /summarize now     Summarize immediately (no background)\n');
          context.emit('text', '  /summarize help    Show this help\n\n');
          context.emit('text', '**Note:** Use `/compact` for in-stream summarization.\n');
          context.emit('done');
          return { handled: true };
        }

        // /summarize now - immediate summarization (legacy behavior)
        if (flag === 'now') {
          if (!context.summarizeContext) {
            context.emit('text', '\nContext summarization is not available.\n');
            context.emit('done');
            return { handled: true };
          }

          const result = await context.summarizeContext();
          if (!result.summarized) {
            context.emit('text', '\nNothing to summarize right now.\n');
            context.emit('done');
            return { handled: true };
          }

          let message = '\n**Context Summary Generated**\n\n';
          message += `Summarized ${result.summarizedCount} message(s).\n`;
          message += `Tokens: ${result.tokensBefore.toLocaleString()} -> ${result.tokensAfter.toLocaleString()}\n\n`;
          if (result.summary) {
            message += `${result.summary}\n`;
          }

          context.emit('text', message);
          context.emit('done');
          return { handled: true };
        }

        // Default: background summarization
        if (!context.summarizeContext) {
          context.emit('text', '\nContext summarization is not available.\n');
          context.emit('done');
          return { handled: true };
        }

        // Get context info for the summary task
        const contextInfo = context.getContextInfo?.();
        if (!contextInfo || contextInfo.state.messageCount < 2) {
          context.emit('text', '\nNot enough context to summarize yet.\n');
          context.emit('done');
          return { handled: true };
        }

        // Perform summarization - we do it immediately but present it as "background"
        // since the actual LLM work happens asynchronously
        context.emit('text', '\n📋 Starting context summarization...\n');

        try {
          const result = await context.summarizeContext();

          if (!result.summarized) {
            context.emit('text', 'Nothing to summarize right now.\n');
            context.emit('done');
            return { handled: true };
          }

          // Post result to inbox if available
          const inboxManager = context.getInboxManager?.();
          const messagesManager = context.getMessagesManager?.();

          let summaryMessage = `## Context Summary\n\n`;
          summaryMessage += `Summarized ${result.summarizedCount} message(s).\n`;
          summaryMessage += `Tokens: ${result.tokensBefore.toLocaleString()} → ${result.tokensAfter.toLocaleString()}\n\n`;
          if (result.summary) {
            summaryMessage += `${result.summary}\n`;
          }

          // Try to post to messages system for cross-session visibility
          if (messagesManager) {
            try {
              const assistant = context.getAssistantManager?.()?.getActive();
              const assistantId = assistant?.id || context.sessionId;
              const assistantName = assistant?.name || 'assistant';

              await messagesManager.send({
                to: assistantId, // Send to self for visibility in inbox
                body: summaryMessage,
                subject: 'Context Summary',
                priority: 'normal',
              });

              context.emit('text', '✓ Summary generated and posted to messages inbox.\n');
              context.emit('text', `  Use /messages to view the full summary.\n`);
            } catch {
              // If posting fails, just show inline
              context.emit('text', '✓ Summary generated:\n\n');
              context.emit('text', summaryMessage);
            }
          } else {
            // No messages system, show inline
            context.emit('text', '✓ Summary generated:\n\n');
            context.emit('text', summaryMessage);
          }

          context.emit('done');
          return { handled: true };
        } catch (error) {
          context.emit('text', `\n❌ Summarization failed: ${error instanceof Error ? error.message : String(error)}\n`);
          context.emit('done');
          return { handled: true };
        }
      },
    };
  }

  /**
   * /rest - Recharge assistant energy
   */
  private restCommand(): Command {
    return {
      name: 'rest',
      description: 'Recharge assistant energy (optional: amount, e.g. /rest 5000)',
      builtin: true,
      selfHandled: true,
      content: '',
      handler: async (args, context) => {
        if (!context.restEnergy) {
          context.emit('text', '\nEnergy system is not available.\n');
          context.emit('done');
          return { handled: true };
        }

        const parsed = parseInt(args.trim(), 10);
        const amount = Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
        context.restEnergy(amount);

        const state = context.getEnergyState?.();
        if (state) {
          const percent = Math.round((state.current / Math.max(1, state.max)) * 100);
          context.emit('text', `\nEnergy restored. Current level: ${percent}% (${state.current}/${state.max}).\n`);
        } else {
          context.emit('text', '\nEnergy restored.\n');
        }
        context.emit('done');
        return { handled: true };
      },
    };
  }

  /**
   * /skills - Interactive skills panel (merged with /skill create)
   */
  private skillsCommand(loader: CommandLoader): Command {
    return {
      name: 'skills',
      aliases: ['skill'],
      description: 'Browse, create, delete, and execute skills interactively',
      builtin: true,
      selfHandled: true,
      content: '',
      handler: async (args, context) => {
        const tokens = splitArgs(args || '');
        const subcommand = tokens.shift()?.toLowerCase();

        // /skills create <name> [options] - create flow (from old /skill command)
        if (subcommand === 'create') {
          let name: string | undefined;
          let scope: SkillScope | undefined;
          let description: string | undefined;
          let argumentHint: string | undefined;
          let content: string | undefined;
          let overwrite = false;
          let yes = false;
          let interactive = false;
          let allowedTools: string[] | undefined;

          for (let i = 0; i < tokens.length; i += 1) {
            const token = tokens[i];
            if (!token) continue;
            if (token.startsWith('--')) {
              switch (token) {
                case '--project':
                  scope = 'project';
                  break;
                case '--global':
                  scope = 'global';
                  break;
                case '--desc':
                case '--description':
                  description = tokens[i + 1];
                  i += 1;
                  break;
                case '--tools': {
                  const list = tokens[i + 1] || '';
                  allowedTools = list
                    .split(',')
                    .map((tool) => tool.trim())
                    .filter(Boolean);
                  i += 1;
                  break;
                }
                case '--hint':
                  argumentHint = tokens[i + 1];
                  i += 1;
                  break;
                case '--content':
                  content = tokens[i + 1];
                  i += 1;
                  break;
                case '--interactive':
                case '--ask':
                case '--interview':
                  interactive = true;
                  break;
                case '--force':
                case '--overwrite':
                  overwrite = true;
                  break;
                case '--yes':
                  yes = true;
                  break;
                default:
                  break;
              }
            } else if (!name) {
              name = token;
            }
          }

          if (!name) {
            context.emit('text', 'Usage: /skills create <name> [--project|--global]\n');
            context.emit('done');
            return { handled: true };
          }

          if (interactive || (!scope && !yes)) {
            const known: string[] = [];
            if (scope) known.push(`scope: ${scope}`);
            if (description) known.push(`description: ${description}`);
            if (content) known.push(`content: provided`);
            if (allowedTools && allowedTools.length > 0) known.push(`allowed_tools: ${allowedTools.join(', ')}`);
            if (argumentHint) known.push(`argument_hint: ${argumentHint}`);

            const missing: string[] = [];
            if (!scope) missing.push('scope (project/global, default project)');
            if (!description) missing.push('description');
            if (!content) missing.push('content (multi-line allowed)');
            if (!allowedTools || allowedTools.length === 0) missing.push('allowed tools (optional)');
            if (!argumentHint) missing.push('argument hint (optional)');

            const knownBlock = known.length > 0 ? `Known values:\\n- ${known.join('\\n- ')}\\n\\n` : '';
            const missingBlock = missing.length > 0 ? `Ask for:\\n- ${missing.join('\\n- ')}\\n\\n` : '';

            context.emit('done');
            return {
              handled: false,
              prompt: `We are creating a new skill named \"${name}\".\\n\\n${knownBlock}${missingBlock}` +
                'Use the ask_user tool to interview the user and collect missing fields. ' +
                'Then call skill_create with name, scope, and any provided fields. ' +
                'If the user leaves optional fields blank, omit them. ' +
                'If scope is not specified, default to project.',
            };
          }

          const finalScope: SkillScope = scope ?? 'project';

          try {
            const result = await createSkill({
              name,
              scope: finalScope,
              description,
              allowedTools,
              argumentHint,
              content,
              cwd: context.cwd,
              overwrite,
            });

            await context.refreshSkills?.();

            let message = `\nCreated skill \"${result.name}\" (${result.scope}).\n`;
            message += `Location: ${result.filePath}\n`;
            message += `Invoke with: $${result.name} [args] or /${result.name} [args]\n`;
            if (!scope) {
              message += 'Defaulted to project scope. Use --global for a global skill.\n';
            }
            context.emit('text', message);
            context.emit('done');
            return { handled: true };
          } catch (error) {
            context.emit('text', `Failed to create skill: ${error instanceof Error ? error.message : String(error)}\n`);
            context.emit('done');
            return { handled: true };
          }
        }

        // /skills install <name> [--global]
        if (subcommand === 'install') {
          const nameToken = tokens.shift()?.trim();
          if (!nameToken) {
            context.emit('text', 'Usage: /skills install <name> [--global]\n');
            context.emit('done');
            return { handled: true };
          }
          const installScope = tokens.includes('--global') ? 'global' as const : 'project' as const;
          try {
            const result = await SkillInstaller.install({ name: nameToken, scope: installScope, cwd: context.cwd });
            context.emit('text', `\nInstalled skill "${result.name}" (${result.packageName}@${result.version}).\n`);
            context.emit('text', `Location: ${result.skillDir}\n`);
            context.emit('text', `Scope: ${installScope}\n`);
            await context.refreshSkills?.();
          } catch (error) {
            context.emit('text', `Failed to install skill: ${error instanceof Error ? error.message : String(error)}\n`);
          }
          context.emit('done');
          return { handled: true };
        }

        // /skills uninstall <name> [--global]
        if (subcommand === 'uninstall' || subcommand === 'remove') {
          const nameToken = tokens.shift()?.trim();
          if (!nameToken) {
            context.emit('text', 'Usage: /skills uninstall <name> [--global]\n');
            context.emit('done');
            return { handled: true };
          }
          const uninstallScope = tokens.includes('--global') ? 'global' as const : 'project' as const;
          try {
            await SkillInstaller.uninstall(nameToken, uninstallScope, context.cwd);
            context.emit('text', `\nUninstalled skill "${nameToken}" from ${uninstallScope} scope.\n`);
            await context.refreshSkills?.();
          } catch (error) {
            context.emit('text', `Failed to uninstall skill: ${error instanceof Error ? error.message : String(error)}\n`);
          }
          context.emit('done');
          return { handled: true };
        }

        // /skills list
        if (subcommand === 'list' || subcommand === 'ls') {
          const lines: string[] = ['\n**Installed skills:**\n'];
          for (const scope of ['project', 'global'] as const) {
            const installed = await SkillInstaller.listInstalled(scope, context.cwd);
            if (installed.length > 0) {
              lines.push(`\n_${scope} (.skill/)_`);
              for (const pkg of installed) {
                lines.push(`  ${pkg.packageName} ${pkg.version}`);
              }
            }
          }
          if (lines.length === 1) {
            lines.push('No npm skills installed.');
          }
          context.emit('text', lines.join('\n') + '\n');
          context.emit('done');
          return { handled: true };
        }

        // /skills help
        if (subcommand === 'help') {
          let message = '\n**/skills commands**\n\n';
          message += '/skills                    Open interactive skills panel\n';
          message += '/skills create <name>      Create a new skill\n';
          message += '/skills install <name>     Install npm skill (@hasnaxyz/skill-*)\n';
          message += '/skills uninstall <name>   Uninstall npm skill\n';
          message += '/skills list               List installed npm skills\n';
          message += '\nOptions for create:\n';
          message += '  --project            Create in project (.skill/)\n';
          message += '  --global             Create globally (~/.skill/)\n';
          message += '  --desc "..."         Description\n';
          message += '  --tools a,b,c        Allowed tools list\n';
          message += '  --hint "..."         Argument hint\n';
          message += '  --content "..."      Skill body content\n';
          message += '  --interactive         Ask follow-up questions\n';
          message += '  --force              Overwrite existing skill\n';
          message += '  --yes                Accept default (project) scope\n';
          message += '\nOptions for install/uninstall:\n';
          message += '  --global             Use global scope (~/.skill/)\n';
          context.emit('text', message);
          context.emit('done');
          return { handled: true };
        }

        // /skills (no args or unknown) → open interactive panel
        if (!subcommand) {
          context.emit('done');
          return { handled: true, showPanel: 'skills' };
        }

        context.emit('text', `Unknown /skills subcommand: ${subcommand}\n`);
        context.emit('text', 'Use /skills help for available commands.\n');
        context.emit('done');
        return { handled: true };
      },
    };
  }

  /**
   * /status - Show current session status
   */
  private statusCommand(): Command {
    return {
      name: 'status',
      description: 'Show session overview: status, energy, identity, tokens, and runtime info',
      builtin: true,
      selfHandled: true,
      content: '',
      handler: async (args, context) => {
        const usage = this.tokenUsage;
        const rawPercent = usage.maxContextTokens > 0
          ? Math.round((usage.totalTokens / usage.maxContextTokens) * 100)
          : 0;
        const usedPercent = Math.max(0, Math.min(100, rawPercent));

        let message = '\n**Session Status**\n\n';
        message += `**Session ID:** ${context.sessionId}\n`;
        message += `**Working Directory:** ${context.cwd}\n`;

        // Identity info
        const assistant = context.getAssistantManager?.()?.getActive();
        const identity = context.getIdentityManager?.()?.getActive();
        if (assistant) {
          message += `**Assistant:** ${assistant.name}`;
          if (identity) {
            message += ` · ${identity.name}`;
          }
          message += '\n';
        }

        // Energy state
        const energyState = context.getEnergyState?.();
        if (energyState) {
          const energyPercent = Math.round((energyState.current / Math.max(1, energyState.max)) * 100);
          const energyBar = '█'.repeat(Math.round(energyPercent / 10)) + '░'.repeat(10 - Math.round(energyPercent / 10));
          const energyEmoji = energyPercent > 70 ? '⚡' : energyPercent > 30 ? '🔋' : '🪫';
          message += `**Energy:** ${energyEmoji} [${energyBar}] ${energyPercent}% (${energyState.current}/${energyState.max})\n`;
        }

        // Voice state
        const voiceState = context.getVoiceState?.();
        if (voiceState?.enabled) {
          const voiceActivity = voiceState.isSpeaking ? 'speaking' : voiceState.isListening ? 'listening' : 'idle';
          message += `**Voice:** ${voiceActivity}`;
          if (voiceState.sttProvider || voiceState.ttsProvider) {
            message += ` (STT: ${voiceState.sttProvider || 'n/a'}, TTS: ${voiceState.ttsProvider || 'n/a'})`;
          }
          message += '\n';
        }

        if (context.getActiveProjectId) {
          const projectId = context.getActiveProjectId();
          if (projectId) {
            message += `**Active Project:** ${projectId}\n`;
          }
        }
        message += `**Messages:** ${context.messages.length}\n`;
        message += `**Available Tools:** ${context.tools.length}\n\n`;

        message += '**Token Usage:**\n';
        message += `  Input: ${usage.inputTokens.toLocaleString()}\n`;
        message += `  Output: ${usage.outputTokens.toLocaleString()}\n`;
        message += `  Total: ${usage.totalTokens.toLocaleString()} / ${usage.maxContextTokens.toLocaleString()} (${usedPercent}%)\n`;

        if (usage.cacheReadTokens || usage.cacheWriteTokens) {
          message += `  Cache Read: ${(usage.cacheReadTokens || 0).toLocaleString()}\n`;
          message += `  Cache Write: ${(usage.cacheWriteTokens || 0).toLocaleString()}\n`;
        }

        // Visual progress bar
        const barLength = 30;
        const filledLength = Math.max(0, Math.min(barLength, Math.round((usedPercent / 100) * barLength)));
        const bar = '█'.repeat(filledLength) + '░'.repeat(Math.max(0, barLength - filledLength));
        message += `\n  [${bar}] ${usedPercent}%\n`;

        const contextInfo = context.getContextInfo?.();
        if (contextInfo) {
          const contextRawPercent = contextInfo.config.maxContextTokens > 0
            ? Math.round((contextInfo.state.totalTokens / contextInfo.config.maxContextTokens) * 100)
            : 0;
          const contextUsedPercent = Math.max(0, Math.min(100, contextRawPercent));
          message += '\n**Context Summary:**\n';
          message += `  Messages: ${contextInfo.state.messageCount}\n`;
          message += `  Estimated Tokens: ${contextInfo.state.totalTokens.toLocaleString()} / ${contextInfo.config.maxContextTokens.toLocaleString()} (${contextUsedPercent}%)\n`;
          message += `  Summaries: ${contextInfo.state.summaryCount}\n`;
          if (contextInfo.state.lastSummaryAt) {
            message += `  Last Summary: ${contextInfo.state.lastSummaryAt}\n`;
          }
        }

        const errorStats = context.getErrorStats?.() ?? [];
        if (errorStats.length > 0) {
          message += '\n**Recent Errors:**\n';
          message += '| Code | Count | Last Occurrence |\n';
          message += '| --- | --- | --- |\n';
          for (const stat of errorStats.slice(0, 5)) {
            message += `| ${stat.code} | ${stat.count} | ${stat.lastOccurrence} |\n`;
          }
        }

        context.emit('text', message);
        context.emit('done');
        return { handled: true };
      },
    };
  }

  /**
   * /compact - Summarize conversation to save context
   */
  private compactCommand(): Command {
    return {
      name: 'compact',
      description: 'Summarize conversation to save context space (auto-compaction)',
      builtin: true,
      selfHandled: false,
      content: `Please summarize our conversation so far into a concise format that preserves:
1. Key decisions made
2. Important context about the codebase
3. Current task/goal we're working on
4. Any constraints or requirements mentioned

Format the summary as a brief bullet-point list. This summary will replace the conversation history to save context space.`,
    };
  }

  /**
   * /config - Show or edit configuration
   */
  private configCommand(): Command {
    return {
      name: 'config',
      description: 'View and edit configuration interactively (model, context, energy, etc.)',
      builtin: true,
      selfHandled: true,
      content: '',
      handler: async (args, context) => {
        const action = args.trim().toLowerCase();

        // /config help
        if (action === 'help') {
          context.emit('text', '\n## Config Commands\n\n');
          context.emit('text', '/config                       Open interactive config panel\n');
          context.emit('text', '/config show                  Show config file locations\n');
          context.emit('text', '/config help                  Show this help\n');
          context.emit('done');
          return { handled: true };
        }

        // /config show - show file locations (legacy behavior)
        if (action === 'show' || action === 'paths') {
          const storageDir = context.getStorageDir?.() || getConfigDir();
          const configPaths = [
            join(context.cwd, '.assistants', 'config.json'),
            join(context.cwd, '.assistants', 'config.local.json'),
            join(storageDir, 'config.json'),
          ];

          let message = '\n**Configuration**\n\n';
          message += '**Config File Locations:**\n';
          for (const path of configPaths) {
            const exists = existsSync(path);
            message += `  ${exists ? '✓' : '○'} ${path}\n`;
          }

          const envHome = process.env.HOME || process.env.USERPROFILE;
          const homeDir = envHome && envHome.trim().length > 0 ? envHome : homedir();

          message += '\n**Commands Directories:**\n';
          message += `  - Project: ${join(context.cwd, '.assistants', 'commands')}\n`;
          message += `  - User/Workspace: ${join(storageDir, 'commands')}\n`;
          if (storageDir !== join(homeDir, '.assistants')) {
            message += `  - Global fallback: ${join(homeDir, '.assistants', 'commands')}\n`;
          }

          context.emit('text', message);
          context.emit('done');
          return { handled: true };
        }

        // /config (no args) - open interactive panel
        context.emit('done');
        return { handled: true, showPanel: 'config' };
      },
    };
  }

  /**
   * /budgets - Show or manage resource budgets
   */
  private budgetCommand(): Command {
    return {
      name: 'budgets',
      aliases: ['budget'],
      description: 'View and manage resource budgets (tokens, calls, duration limits)',
      builtin: true,
      selfHandled: true,
      content: '',
      handler: async (args, context) => {
        // Import budget tracker
        const { BudgetTracker } = await import('../budget');

        const rawArgs = args.trim();
        const [actionToken = '', ...actionParts] = rawArgs.length > 0
          ? rawArgs.split(/\s+/)
          : [];
        const action = actionToken.toLowerCase();
        const actionRemainder = rawArgs.length > 0
          ? rawArgs.slice(actionToken.length).trim()
          : '';
        const sessionId = context.sessionId || 'default';

        // Create a tracker instance for this session
        const tracker = new BudgetTracker(sessionId, context.budgetConfig);
        const validScopes = ['session', 'assistant', 'swarm', 'project'] as const;
        type Scope = typeof validScopes[number];

        const parseScope = (value?: string): Scope | null => {
          if (!value) return null;
          const normalized = value.trim().toLowerCase();
          if ((validScopes as readonly string[]).includes(normalized)) {
            return normalized as Scope;
          }
          return null;
        };

        const getCurrentConfig = () => {
          const config = context.budgetConfig || tracker.getConfig();
          return {
            ...config,
            session: config.session ? { ...config.session } : undefined,
            assistant: config.assistant ? { ...config.assistant } : undefined,
            swarm: config.swarm ? { ...config.swarm } : undefined,
            project: config.project ? { ...config.project } : undefined,
          };
        };

        const getSummary = () => context.getBudgetSummary?.() || tracker.getSummary();

        // /budgets help
        if (action === 'help') {
          let message = '\n## Budget Commands\n\n';
          message += '/budgets                      Show current budget status\n';
          message += '/budgets status               Show detailed budget status\n';
          message += '/budgets enable               Enable budget enforcement\n';
          message += '/budgets disable              Disable budget enforcement\n';
          message += '/budgets reset                Reset all usage counters\n';
          message += '/budgets reset session        Reset session usage only\n';
          message += '/budgets limits               Show configured limits\n';
          message += '/budgets resume               Resume from budget pause\n';
          message += '/budgets extend <tokens>      Extend token limit\n';
          message += '/budgets project [name]       Show/set project budget\n';
          message += '/budgets help                 Show this help\n';
          message += '\nAlias: /budget\n';
          context.emit('text', message);
          context.emit('done');
          return { handled: true };
        }

        // /budgets enable
        if (action === 'enable') {
          if (context.setBudgetEnabled) {
            context.setBudgetEnabled(true);
            context.emit('text', '\n✓ Budget enforcement **enabled**\n');
          } else {
            context.emit('text', '\n⚠ Budget control not available in this context\n');
          }
          context.emit('done');
          return { handled: true };
        }

        // /budgets disable
        if (action === 'disable') {
          if (context.setBudgetEnabled) {
            context.setBudgetEnabled(false);
            context.emit('text', '\n✓ Budget enforcement **disabled**\n');
          } else {
            context.emit('text', '\n⚠ Budget control not available in this context\n');
          }
          context.emit('done');
          return { handled: true };
        }

        // /budgets resume
        if (action === 'resume') {
          if (context.resumeBudget) {
            context.resumeBudget();
            context.emit('text', '\n✓ Budget pause lifted - agent will continue\n');
          } else {
            context.emit('text', '\n⚠ Budget resume not available in this context\n');
          }
          context.emit('done');
          return { handled: true };
        }

        // /budgets extend <tokens>
        if (action === 'extend') {
          const tokensStr = actionParts[0];
          if (!tokensStr) {
            context.emit('text', '\nUsage: /budgets extend <tokens>\nExample: /budgets extend 500000\n');
            context.emit('done');
            return { handled: true };
          }
          const tokens = parseInt(tokensStr, 10);
          if (isNaN(tokens) || tokens <= 0) {
            context.emit('text', '\n⚠ Invalid token count. Must be a positive number.\n');
            context.emit('done');
            return { handled: true };
          }
          const nextConfig = getCurrentConfig();
          const currentMax = nextConfig.session?.maxTotalTokens || 0;
          const nextLimit = currentMax + tokens;
          nextConfig.session = {
            ...(nextConfig.session || {}),
            maxTotalTokens: nextLimit,
          };
          if (context.setBudgetConfig) {
            context.setBudgetConfig(nextConfig);
          } else {
            tracker.updateConfig(nextConfig);
          }
          context.emit('text', `\n✓ Extended session token limit by ${tokens.toLocaleString()} (new limit: ${nextLimit.toLocaleString()})\n`);
          context.emit('done');
          return { handled: true };
        }

        // /budgets project [name]
        if (action === 'project') {
          const projectName = actionRemainder;

          if (projectName) {
            // Set active project
            if (context.setActiveProjectId) {
              context.setActiveProjectId(projectName);
            } else {
              tracker.setActiveProject(projectName);
            }
            context.emit('text', `\n✓ Active project set to: ${projectName}\n`);
          } else {
            // Show project budget
            const activeProject = context.getActiveProjectId?.() || tracker.getActiveProject();
            if (activeProject) {
              const summary = getSummary();
              if (summary.project) {
                const projectUsage = summary.project.usage;
                const projectLimits = summary.project.limits;
                let message = `\nActive project: ${activeProject}\n`;
                if (projectLimits.maxTotalTokens) {
                  const pct = Math.round((projectUsage.totalTokens / projectLimits.maxTotalTokens) * 100);
                  message += `Tokens: ${projectUsage.totalTokens.toLocaleString()} / ${projectLimits.maxTotalTokens.toLocaleString()} (${pct}%)\n`;
                } else {
                  message += `Tokens: ${projectUsage.totalTokens.toLocaleString()} (no limit)\n`;
                }
                if (projectLimits.maxLlmCalls) {
                  const pct = Math.round((projectUsage.llmCalls / projectLimits.maxLlmCalls) * 100);
                  message += `LLM Calls: ${projectUsage.llmCalls} / ${projectLimits.maxLlmCalls} (${pct}%)\n`;
                } else {
                  message += `LLM Calls: ${projectUsage.llmCalls} (no limit)\n`;
                }
                context.emit('text', message);
              } else {
                const projectStatus = tracker.formatUsage('project', activeProject);
                context.emit('text', `\n${projectStatus}\n`);
              }
            } else {
              context.emit('text', '\nNo active project. Use /budgets project <name> to set one.\n');
            }
          }
          context.emit('done');
          return { handled: true };
        }

        // /budgets reset [scope]
        if (action === 'reset') {
          const scopeInput = actionParts[0];
          const scope = parseScope(scopeInput);

          if (scopeInput && !scope) {
            context.emit('text', '\n⚠ Invalid scope. Valid scopes: session, assistant, swarm, project.\n');
            context.emit('done');
            return { handled: true };
          }

          if (context.resetBudget) {
            if (scope) {
              context.resetBudget(scope);
              context.emit('text', `\n✓ Reset ${scope} budget usage\n`);
            } else {
              context.resetBudget();
              context.emit('text', '\n✓ Reset all budget usage\n');
            }
          } else {
            if (scope) {
              tracker.resetUsage(scope);
              context.emit('text', `\n✓ Reset ${scope} budget usage\n`);
            } else {
              tracker.resetAll();
              context.emit('text', '\n✓ Reset all budget usage\n');
            }
          }
          context.emit('done');
          return { handled: true };
        }

        // /budgets limits
        if (action === 'limits') {
          const config = getCurrentConfig();
          let message = '\n**Budget Limits**\n\n';

          message += '## Session Limits\n';
          if (config.session) {
            message += `  Max tokens: ${config.session.maxTotalTokens?.toLocaleString() || 'unlimited'}\n`;
            message += `  Max LLM calls: ${config.session.maxLlmCalls?.toLocaleString() || 'unlimited'}\n`;
            message += `  Max tool calls: ${config.session.maxToolCalls?.toLocaleString() || 'unlimited'}\n`;
            const maxDurationMin = config.session.maxDurationMs ? Math.round(config.session.maxDurationMs / 60000) : null;
            message += `  Max duration: ${maxDurationMin ? `${maxDurationMin} min` : 'unlimited'}\n`;
          } else {
            message += '  No limits configured\n';
          }

          message += '\n## Assistant Limits\n';
          if (config.assistant) {
            message += `  Max tokens: ${config.assistant.maxTotalTokens?.toLocaleString() || 'unlimited'}\n`;
            message += `  Max LLM calls: ${config.assistant.maxLlmCalls?.toLocaleString() || 'unlimited'}\n`;
            message += `  Max tool calls: ${config.assistant.maxToolCalls?.toLocaleString() || 'unlimited'}\n`;
            const maxDurationMin = config.assistant.maxDurationMs ? Math.round(config.assistant.maxDurationMs / 60000) : null;
            message += `  Max duration: ${maxDurationMin ? `${maxDurationMin} min` : 'unlimited'}\n`;
          } else {
            message += '  No limits configured\n';
          }

          message += '\n## Swarm Limits\n';
          if (config.swarm) {
            message += `  Max tokens: ${config.swarm.maxTotalTokens?.toLocaleString() || 'unlimited'}\n`;
            message += `  Max LLM calls: ${config.swarm.maxLlmCalls?.toLocaleString() || 'unlimited'}\n`;
            message += `  Max tool calls: ${config.swarm.maxToolCalls?.toLocaleString() || 'unlimited'}\n`;
            const maxDurationMin = config.swarm.maxDurationMs ? Math.round(config.swarm.maxDurationMs / 60000) : null;
            message += `  Max duration: ${maxDurationMin ? `${maxDurationMin} min` : 'unlimited'}\n`;
          } else {
            message += '  No limits configured\n';
          }

          message += '\n## Project Limits\n';
          if (config.project) {
            message += `  Max tokens: ${config.project.maxTotalTokens?.toLocaleString() || 'unlimited'}\n`;
            message += `  Max LLM calls: ${config.project.maxLlmCalls?.toLocaleString() || 'unlimited'}\n`;
            message += `  Max tool calls: ${config.project.maxToolCalls?.toLocaleString() || 'unlimited'}\n`;
            const maxDurationMin = config.project.maxDurationMs ? Math.round(config.project.maxDurationMs / 60000) : null;
            message += `  Max duration: ${maxDurationMin ? `${maxDurationMin} min` : 'unlimited'}\n`;
          } else {
            message += '  No limits configured\n';
          }

          message += `\nOn exceeded: ${config.onExceeded || 'warn'}\n`;
          message += `Persistence: ${config.persist ? 'enabled' : 'disabled'}\n`;

          context.emit('text', message);
          context.emit('done');
          return { handled: true };
        }

        // /budgets - Show interactive panel
        if (!action || action === 'ui') {
          context.emit('done');
          return { handled: true, showPanel: 'budget' };
        }

        // /budgets status - Show text status
        const summary = getSummary();
        let message = '\n**Budget Status**\n\n';
        message += `Enforcement: ${summary.enabled ? '**enabled**' : 'disabled'}\n\n`;

        // Session usage
        message += '## Session\n';
        const sessionUsage = summary.session.usage;
        const sessionLimits = summary.session.limits;
        if (sessionLimits.maxTotalTokens) {
          const pct = Math.round((sessionUsage.totalTokens / sessionLimits.maxTotalTokens) * 100);
          message += `  Tokens: ${sessionUsage.totalTokens.toLocaleString()} / ${sessionLimits.maxTotalTokens.toLocaleString()} (${pct}%)\n`;
        } else {
          message += `  Tokens: ${sessionUsage.totalTokens.toLocaleString()} (no limit)\n`;
        }
        if (sessionLimits.maxLlmCalls) {
          const pct = Math.round((sessionUsage.llmCalls / sessionLimits.maxLlmCalls) * 100);
          message += `  LLM Calls: ${sessionUsage.llmCalls} / ${sessionLimits.maxLlmCalls} (${pct}%)\n`;
        } else {
          message += `  LLM Calls: ${sessionUsage.llmCalls} (no limit)\n`;
        }
        if (sessionLimits.maxToolCalls) {
          const pct = Math.round((sessionUsage.toolCalls / sessionLimits.maxToolCalls) * 100);
          message += `  Tool Calls: ${sessionUsage.toolCalls} / ${sessionLimits.maxToolCalls} (${pct}%)\n`;
        } else {
          message += `  Tool Calls: ${sessionUsage.toolCalls} (no limit)\n`;
        }
        const durationMin = Math.round(sessionUsage.durationMs / 60000);
        if (sessionLimits.maxDurationMs) {
          const limitMin = Math.round(sessionLimits.maxDurationMs / 60000);
          const pct = Math.round((sessionUsage.durationMs / sessionLimits.maxDurationMs) * 100);
          message += `  Duration: ${durationMin} min / ${limitMin} min (${pct}%)\n`;
        } else {
          message += `  Duration: ${durationMin} min (no limit)\n`;
        }

        if (summary.session.overallExceeded) {
          message += '\n  ⚠️ **SESSION BUDGET EXCEEDED**\n';
        } else if (summary.session.warningsCount > 0) {
          message += `\n  ⚡ ${summary.session.warningsCount} warning(s) - approaching limits\n`;
        }

        // Show project budget if active
        if (summary.project) {
          message += '\n## Project\n';
          const projUsage = summary.project.usage;
          const projLimits = summary.project.limits;
          if (projLimits.maxTotalTokens) {
            const pct = Math.round((projUsage.totalTokens / projLimits.maxTotalTokens) * 100);
            message += `  Tokens: ${projUsage.totalTokens.toLocaleString()} / ${projLimits.maxTotalTokens.toLocaleString()} (${pct}%)\n`;
          }
          if (projLimits.maxLlmCalls) {
            const pct = Math.round((projUsage.llmCalls / projLimits.maxLlmCalls) * 100);
            message += `  LLM Calls: ${projUsage.llmCalls} / ${projLimits.maxLlmCalls} (${pct}%)\n`;
          }
          if (summary.project.overallExceeded) {
            message += '\n  ⚠️ **PROJECT BUDGET EXCEEDED**\n';
          }
        }

        // Show assistant count if any
        if (summary.assistantCount > 0) {
          message += `\n## Assistants: ${summary.assistantCount} tracked\n`;
        }

        // Overall status
        if (summary.anyExceeded) {
          message += '\n⚠️ **BUDGET EXCEEDED** - Some limits have been reached\n';
        } else if (summary.totalWarnings > 0) {
          message += `\n⚡ ${summary.totalWarnings} total warning(s)\n`;
        } else {
          message += '\n✓ All budgets within limits\n';
        }

        context.emit('text', message);
        context.emit('done');
        return { handled: true };
      },
    };
  }

  /**
   * /registry - View and manage registered assistants (runtime instances)
   */
  private assistantsCommand(): Command {
    return {
      name: 'registry',
      description: 'View and manage registered assistants (runtime instances)',
      builtin: true,
      selfHandled: true,
      content: '',
      handler: async (args, context) => {
        // Import registry service
        const { getGlobalRegistry } = await import('../registry');

        const action = args.trim().toLowerCase();
        const registry = getGlobalRegistry();

        // /registry help
        if (action === 'help') {
          let message = '\n## Registry Commands\n\n';
          message += '/registry                         List all registered assistants\n';
          message += '/registry list                    List all registered assistants\n';
          message += '/registry status                  Show registry statistics\n';
          message += '/registry cleanup                 Remove stale/offline assistants\n';
          message += '/registry help                    Show this help\n';
          context.emit('text', message);
          context.emit('done');
          return { handled: true };
        }

        // /assistants list - Show all assistants
        if (action === 'list') {
          const assistants = registry.list();
          if (assistants.length === 0) {
            context.emit('text', '\nNo assistants currently registered.\n');
            context.emit('done');
            return { handled: true };
          }

          let message = '\n**Registered Assistants**\n\n';
          for (const entry of assistants) {
            const state = entry.status.state;
            const stateIcon = state === 'idle' ? '●' :
              state === 'processing' ? '◐' :
              state === 'error' ? '✗' :
              state === 'offline' ? '○' : '◌';
            const stateColor = state === 'idle' ? 'green' :
              state === 'processing' ? 'yellow' :
              state === 'error' ? 'red' : 'gray';

            message += `${stateIcon} **${entry.name}** (${entry.type})\n`;
            message += `   ID: ${entry.id.slice(0, 16)}...\n`;
            message += `   State: ${state}\n`;
            if (entry.status.currentTask) {
              message += `   Task: ${entry.status.currentTask}\n`;
            }
            message += `   Tools: ${entry.capabilities.tools.length} | Skills: ${entry.capabilities.skills.length}\n`;
            message += `   Load: ${entry.load.activeTasks} active, ${entry.load.queuedTasks} queued\n\n`;
          }
          context.emit('text', message);
          context.emit('done');
          return { handled: true };
        }

        // /assistants status - Show registry stats
        if (action === 'status') {
          const stats = registry.getStats();
          let message = '\n**Assistant Registry Status**\n\n';
          message += `Total Assistants: ${stats.totalAssistants}\n`;
          message += `Stale: ${stats.staleCount}\n`;
          message += `Average Load: ${(stats.averageLoad * 100).toFixed(0)}%\n`;
          message += `Uptime: ${Math.floor(stats.uptime / 60)} minutes\n\n`;

          message += '**By Type:**\n';
          message += `  Assistants: ${stats.byType.assistant}\n`;
          message += `  Subassistants: ${stats.byType.subassistant}\n`;
          message += `  Coordinators: ${stats.byType.coordinator}\n`;
          message += `  Workers: ${stats.byType.worker}\n\n`;

          message += '**By State:**\n';
          message += `  Idle: ${stats.byState.idle}\n`;
          message += `  Processing: ${stats.byState.processing}\n`;
          message += `  Waiting: ${stats.byState.waiting_input}\n`;
          message += `  Error: ${stats.byState.error}\n`;
          message += `  Offline: ${stats.byState.offline}\n`;

          context.emit('text', message);
          context.emit('done');
          return { handled: true };
        }

        // /assistants cleanup - Clean up stale assistants
        if (action === 'cleanup') {
          const beforeCount = registry.list().length;
          registry.cleanupStaleAssistants();
          const afterCount = registry.list().length;
          const removed = beforeCount - afterCount;

          if (removed > 0) {
            context.emit('text', `\n✓ Removed ${removed} stale assistant${removed > 1 ? 's' : ''}\n`);
          } else {
            context.emit('text', '\n✓ No stale assistants to clean up\n');
          }
          context.emit('done');
          return { handled: true };
        }

        // /registry with no args - show list
        if (!action) {
          // Fall through to list
          const assistantsList = registry.list();
          if (assistantsList.length === 0) {
            context.emit('text', '\nNo assistants currently registered.\n');
          } else {
            let message = '\n**Registered Assistants**\n\n';
            for (const entry of assistantsList) {
              const state = entry.status.state;
              const stateIcon = state === 'idle' ? '●' :
                state === 'processing' ? '◐' :
                state === 'error' ? '✗' :
                state === 'offline' ? '○' : '◌';
              message += `${stateIcon} **${entry.name}** (${entry.type})\n`;
              message += `   ID: ${entry.id.slice(0, 16)}...\n`;
              message += `   State: ${state}\n`;
              if (entry.status.currentTask) {
                message += `   Task: ${entry.status.currentTask}\n`;
              }
              message += `   Tools: ${entry.capabilities.tools.length} | Skills: ${entry.capabilities.skills.length}\n`;
              message += `   Load: ${entry.load.activeTasks} active, ${entry.load.queuedTasks} queued\n\n`;
            }
            context.emit('text', message);
          }
          context.emit('done');
          return { handled: true };
        }

        // Unknown subcommand
        context.emit('text', `\n⚠ Unknown command: /registry ${action}\n`);
        context.emit('text', 'Use /registry help for available commands.\n');
        context.emit('done');
        return { handled: true };
      },
    };
  }

  /**
   * /swarm - Multi-assistant swarm execution
   */
  private swarmCommand(): Command {
    return {
      name: 'swarm',
      description: 'Execute multi-assistant swarm for complex tasks',
      builtin: true,
      selfHandled: true,
      content: '',
      handler: async (args, context) => {
        // Import swarm config
        const { DEFAULT_SWARM_CONFIG } = await import('../swarm');

        const trimmedArgs = args.trim();

        // Get swarm coordinator from context (available when running in full assistant loop)
        const coordinator = context.getSwarmCoordinator?.();

        // /swarm help
        if (trimmedArgs === 'help' || trimmedArgs === '') {
          let message = '\n## Swarm Commands\n\n';
          message += '/swarm <goal>                 Execute swarm for a goal\n';
          message += '/swarm status                 Show swarm status\n';
          message += '/swarm stop                   Stop current swarm\n';
          message += '/swarm memory                 Show shared memory contents\n';
          message += '/swarm config                 Show swarm configuration\n';
          message += '/swarm help                   Show this help\n\n';
          message += '**Example:**\n';
          message += '/swarm Research and summarize the authentication patterns in this codebase\n';
          context.emit('text', message);
          context.emit('done');
          return { handled: true };
        }

        // /swarm config - Show configuration
        if (trimmedArgs === 'config') {
          let message = '\n**Swarm Configuration**\n\n';
          message += `Enabled: ${DEFAULT_SWARM_CONFIG.enabled}\n`;
          message += `Max Concurrent Workers: ${DEFAULT_SWARM_CONFIG.maxConcurrent}\n`;
          message += `Max Tasks: ${DEFAULT_SWARM_CONFIG.maxTasks}\n`;
          message += `Max Depth: ${DEFAULT_SWARM_CONFIG.maxDepth}\n`;
          message += `Task Timeout: ${Math.round(DEFAULT_SWARM_CONFIG.taskTimeoutMs / 1000)}s\n`;
          message += `Swarm Timeout: ${Math.round(DEFAULT_SWARM_CONFIG.swarmTimeoutMs / 1000)}s\n`;
          message += `Auto-Approve Plans: ${DEFAULT_SWARM_CONFIG.autoApprove}\n`;
          message += `Enable Critic: ${DEFAULT_SWARM_CONFIG.enableCritic}\n`;
          message += `Token Budget: ${DEFAULT_SWARM_CONFIG.tokenBudget || 'unlimited'}\n\n`;
          message += '**Default Tools:**\n';
          message += `  Planner: ${DEFAULT_SWARM_CONFIG.plannerTools.join(', ')}\n`;
          message += `  Worker: ${DEFAULT_SWARM_CONFIG.workerTools.join(', ')}\n`;
          message += `  Critic: ${DEFAULT_SWARM_CONFIG.criticTools.join(', ')}\n`;
          context.emit('text', message);
          context.emit('done');
          return { handled: true };
        }

        // /swarm status - Show current swarm status
        if (trimmedArgs === 'status') {
          if (!coordinator) {
            context.emit('text', '\n⚠️ Swarm coordinator not available in this context.\n');
            context.emit('done');
            return { handled: true };
          }

          const state = coordinator.getState();
          if (!state) {
            context.emit('text', '\nNo swarm currently running. Use /swarm <goal> to start.\n');
            context.emit('done');
            return { handled: true };
          }

          let message = '\n**Swarm Status**\n\n';
          message += `ID: ${state.id}\n`;
          message += `Status: ${state.status}\n`;
          if (state.plan) {
            message += `\n**Plan:** ${state.plan.goal}\n`;
            message += `Tasks: ${state.plan.tasks.length}\n`;
            message += `Approved: ${state.plan.approved ? 'Yes' : 'No'}\n`;
          }
          if (state.metrics) {
            message += '\n**Metrics:**\n';
            message += `  Completed: ${state.metrics.completedTasks}/${state.metrics.totalTasks}\n`;
            if (state.metrics.failedTasks > 0) {
              message += `  Failed: ${state.metrics.failedTasks}\n`;
            }
            message += `  Tool Calls: ${state.metrics.toolCalls}\n`;
          }
          if (state.activeAssistants && state.activeAssistants.size > 0) {
            message += `\n**Active Assistants:** ${state.activeAssistants.size}\n`;
          }
          if (state.errors && state.errors.length > 0) {
            message += '\n**Errors:**\n';
            for (const err of state.errors.slice(-3)) {
              message += `  - ${err}\n`;
            }
          }
          context.emit('text', message);
          context.emit('done');
          return { handled: true };
        }

        // /swarm memory - Show shared memory contents
        if (trimmedArgs === 'memory') {
          if (!coordinator) {
            context.emit('text', '\n⚠️ Swarm coordinator not available in this context.\n');
            context.emit('done');
            return { handled: true };
          }

          const memory = coordinator.getMemory();
          if (!memory) {
            context.emit('text', '\nShared memory is not enabled for this swarm.\nEnable it with `enableSharedMemory: true` in swarm config.\n');
            context.emit('done');
            return { handled: true };
          }

          const stats = memory.getStats();
          let message = '\n**Swarm Shared Memory**\n\n';
          message += `Total entries: ${stats.totalEntries}\n`;
          message += `Total access count: ${stats.totalAccessCount}\n\n`;

          if (stats.totalEntries > 0) {
            message += '**By Category:**\n';
            for (const [category, count] of Object.entries(stats.byCategory)) {
              if (count > 0) {
                message += `  ${category}: ${count}\n`;
              }
            }

            message += '\n**Recent Entries:**\n';
            const entries = memory.list();
            const recent = entries.slice(0, 10);
            for (const entry of recent) {
              const preview = entry.content.length > 100 ? entry.content.slice(0, 100) + '...' : entry.content;
              message += `\n- [${entry.category}] ${preview}\n`;
              message += `  Tags: ${entry.tags.join(', ')} | Relevance: ${entry.relevance}\n`;
            }
          } else {
            message += 'No entries in shared memory yet.\n';
          }

          context.emit('text', message);
          context.emit('done');
          return { handled: true };
        }

        // /swarm stop - Stop current swarm
        if (trimmedArgs === 'stop') {
          if (!coordinator) {
            context.emit('text', '\n⚠️ Swarm coordinator not available in this context.\n');
            context.emit('done');
            return { handled: true };
          }

          if (!coordinator.isRunning()) {
            context.emit('text', '\nNo swarm currently running.\n');
            context.emit('done');
            return { handled: true };
          }

          coordinator.stop();
          context.emit('text', '\n✓ Swarm execution stopped.\n');
          context.emit('done');
          return { handled: true };
        }

        // /swarm <goal> - Execute swarm
        if (!coordinator) {
          context.emit('text', '\n⚠️ Swarm coordinator not available.\n');
          context.emit('text', 'Swarm execution requires full assistant context with subassistant support.\n');
          context.emit('text', '\n**Alternatives:**\n');
          context.emit('text', '- Use the `swarm_execute` tool programmatically\n');
          context.emit('text', '- Use the `assistant_delegate` tool for complex tasks\n');
          context.emit('done');
          return { handled: true };
        }

        // Execute the swarm
        context.emit('text', `\n🐝 Starting swarm for goal: ${trimmedArgs}\n\n`);

        try {
          const result = await coordinator.execute({
            goal: trimmedArgs,
            config: {
              autoApprove: true, // Auto-approve for command-line usage
            },
          });

          if (result.success) {
            let message = '\n**✓ Swarm completed successfully**\n\n';
            if (result.result) {
              message += '**Result:**\n';
              message += result.result + '\n\n';
            }
            message += '**Metrics:**\n';
            message += `  Tasks: ${result.metrics.completedTasks}/${result.metrics.totalTasks} completed\n`;
            if (result.metrics.failedTasks > 0) {
              message += `  Failed: ${result.metrics.failedTasks}\n`;
            }
            message += `  Tool calls: ${result.metrics.toolCalls}\n`;
            message += `  Duration: ${Math.round(result.durationMs / 1000)}s\n`;
            context.emit('text', message);
          } else {
            let message = '\n**✗ Swarm execution failed**\n\n';
            message += `Error: ${result.error}\n`;
            if (Object.keys(result.taskResults).length > 0) {
              message += `\nPartial results: ${Object.keys(result.taskResults).length} tasks completed before failure\n`;
            }
            message += '\n**Metrics:**\n';
            message += `  Tasks: ${result.metrics.completedTasks}/${result.metrics.totalTasks}\n`;
            message += `  Failed: ${result.metrics.failedTasks}\n`;
            context.emit('text', message);
          }
        } catch (error) {
          context.emit('text', `\n**✗ Swarm execution error:**\n${error instanceof Error ? error.message : String(error)}\n`);
        }

        context.emit('done');
        return { handled: true };
      },
    };
  }

  /**
   * /init - Initialize assistants in current project
   */
  private initCommand(): Command {
    return {
      name: 'init',
      description: 'Initialize .assistants/ config directory with example commands and hooks',
      builtin: true,
      selfHandled: true,
      content: '',
      handler: async (args, context) => {
        const commandsDir = join(context.cwd, '.assistants', 'commands');

        // Create directories
        mkdirSync(commandsDir, { recursive: true });

        // Create example command
        const exampleCommand = `---
name: reflect
description: Reflect on the conversation and suggest next steps
tags: [reflection, next-steps]
---

# Reflection

Please summarize the last interaction and suggest 2-3 next steps.

- Keep it concise
- Focus on clarity
- Ask a follow-up question if needed
`;

        const examplePath = join(commandsDir, 'reflect.md');
        if (!existsSync(examplePath)) {
          writeFileSync(examplePath, exampleCommand);
        }

        let message = '\n**Initialized assistants**\n\n';
        message += `Created: ${commandsDir}\n`;
        message += `Example: ${examplePath}\n\n`;
        message += 'You can now:\n';
        message += '  - Add custom commands to .assistants/commands/\n';
        message += '  - Use /reflect to try the example command\n';
        message += '  - Run /help to see all available commands\n';

        context.emit('text', message);
        context.emit('done');
        return { handled: true };
      },
    };
  }

  /**
   * /cost - Show estimated cost of the session
   */
  private costCommand(): Command {
    return {
      name: 'cost',
      description: 'Show estimated API cost for this session (input + output pricing)',
      builtin: true,
      selfHandled: true,
      content: '',
      handler: async (args, context) => {
        const usage = this.tokenUsage;

        // Look up pricing from model registry based on active model
        const { getModelById } = await import('../llm/models');
        const activeModelId = context.getModel?.();
        const model = activeModelId ? getModelById(activeModelId) : null;

        const inputCostPer1M = model?.inputCostPer1M ?? 3.0;
        const outputCostPer1M = model?.outputCostPer1M ?? 15.0;
        const modelName = model?.name ?? 'Unknown model';

        const inputCost = (usage.inputTokens / 1_000_000) * inputCostPer1M;
        const outputCost = (usage.outputTokens / 1_000_000) * outputCostPer1M;
        const totalCost = inputCost + outputCost;

        // Cache savings (if applicable)
        const cacheReadCostPer1M = inputCostPer1M * 0.1; // ~10% of input cost
        const cacheSavings = usage.cacheReadTokens
          ? ((usage.cacheReadTokens / 1_000_000) * (inputCostPer1M - cacheReadCostPer1M))
          : 0;

        let message = '\n**Estimated Session Cost**\n\n';
        message += `Input tokens: ${usage.inputTokens.toLocaleString()} (~$${inputCost.toFixed(4)})\n`;
        message += `Output tokens: ${usage.outputTokens.toLocaleString()} (~$${outputCost.toFixed(4)})\n`;
        message += `**Total: ~$${totalCost.toFixed(4)}**\n`;

        if (cacheSavings > 0) {
          message += `\nCache savings: ~$${cacheSavings.toFixed(4)}\n`;
        }

        message += `\n*Based on ${modelName} pricing ($${inputCostPer1M}/1M in, $${outputCostPer1M}/1M out)*\n`;

        context.emit('text', message);
        context.emit('done');
        return { handled: true };
      },
    };
  }

  /**
   * /model - Show or change the model
   */
  private modelCommand(): Command {
    return {
      name: 'model',
      description: 'Open interactive model selector or switch directly (e.g. /model claude-sonnet-4-5-20250929)',
      builtin: true,
      selfHandled: true,
      content: '',
      handler: async (args, context) => {
        // Dynamically import model registry
        const { MODELS, getModelById, getModelsGroupedByProvider, getModelDisplayName, getProviderForModel } = await import('../llm/models');
        const { LLM_PROVIDER_IDS, getProviderLabel } = await import('@hasna/assistants-shared');

        const trimmedArgs = args.trim();
        const currentModel = context.getModel?.() || 'unknown';

        // /model (or /model ui) - Open interactive selector panel
        if (!trimmedArgs || trimmedArgs === 'ui') {
          context.emit('done');
          return { handled: true, showPanel: 'model' };
        }

        // /model status - Show current model and usage
        if (trimmedArgs === 'status' || trimmedArgs === 'current') {
          const modelDef = getModelById(currentModel);
          let message = '\n**Current Model**\n\n';
          message += `Model: ${modelDef?.name || currentModel}\n`;
          message += `ID: ${currentModel}\n`;

          // Show provider correctly, or "Unknown" if model not in registry
          if (modelDef) {
            message += `Provider: ${getProviderLabel(modelDef.provider)}\n`;
          } else {
            const inferred = getProviderForModel(currentModel);
            message += `Provider: ${inferred ? getProviderLabel(inferred) : 'Unknown'}\n`;
          }

          message += `Context: ${this.tokenUsage.maxContextTokens.toLocaleString()} tokens\n`;
          if (modelDef) {
            message += `Max output: ${modelDef.maxOutputTokens?.toLocaleString() || 'unknown'} tokens\n`;
            message += `Cost: $${modelDef.inputCostPer1M}/1M in, $${modelDef.outputCostPer1M}/1M out\n`;
          }
          message += '\n**Usage**\n';
          message += '  /model              Open interactive model selector\n';
          message += '  /model status       Show current model details\n';
          message += '  /model list         List all available models\n';
          message += '  /model <model-id>   Switch to a different model\n';

          context.emit('text', message);
          context.emit('done');
          return { handled: true };
        }

        // /model help - Show usage
        if (trimmedArgs === 'help') {
          let message = '\n**Model Commands**\n\n';
          message += '  /model              Open interactive model selector\n';
          message += '  /model status       Show current model details\n';
          message += '  /model list         List all available models\n';
          message += '  /model <model-id>   Switch to a different model\n';
          context.emit('text', message);
          context.emit('done');
          return { handled: true };
        }

        // /model list - List all available models
        if (trimmedArgs === 'list') {
          const grouped = getModelsGroupedByProvider();
          let message = '\n**Available Models**\n\n';

          for (const providerId of LLM_PROVIDER_IDS) {
            const models = grouped[providerId];
            if (!models || models.length === 0) continue;
            message += `## ${getProviderLabel(providerId)}\n`;
            for (const model of models) {
              const current = model.id === currentModel ? ' ← current' : '';
              message += `  ${model.name} (${model.id})${current}\n`;
              message += `    ${model.description}\n`;
              if (model.contextWindow && model.maxOutputTokens) {
                message += `    Context: ${(model.contextWindow / 1000).toFixed(0)}K | Max output: ${(model.maxOutputTokens / 1000).toFixed(0)}K\n`;
              } else {
                message += '    Context: unknown | Max output: unknown\n';
              }
              if (model.inputCostPer1M !== undefined && model.outputCostPer1M !== undefined) {
                message += `    Cost: $${model.inputCostPer1M}/1M in, $${model.outputCostPer1M}/1M out\n`;
              } else {
                message += '    Cost: unknown\n';
              }
              if (model.notes) {
                message += `    Note: ${model.notes}\n`;
              }
              message += '\n';
            }
          }

          message += '\nUse `/model <model-id>` to switch models.\n';

          context.emit('text', message);
          context.emit('done');
          return { handled: true };
        }

        // /model <model-id> - Switch to a different model
        const modelId = trimmedArgs;
        const modelDef = getModelById(modelId);

        if (!modelDef) {
          const inferredProvider = getProviderForModel(modelId);
          if (!inferredProvider) {
            // Try to find a close match
            const lowerInput = modelId.toLowerCase();
            const possibleMatch = MODELS.find(
              (m) =>
                m.id.toLowerCase().includes(lowerInput) ||
                m.name.toLowerCase().includes(lowerInput)
            );

            let message = `Unknown model: ${modelId}\n`;
            if (possibleMatch) {
              message += `Did you mean: ${possibleMatch.id} (${possibleMatch.name})?\n`;
            }
            message += 'Use `/model list` to see available models.\n';

            context.emit('text', message);
            context.emit('done');
            return { handled: true };
          }

          if (!context.switchModel) {
            context.emit('text', 'Model switching not available in this context.\n');
            context.emit('done');
            return { handled: true };
          }

          try {
            await context.switchModel(modelId);
            let message = `\nSwitched to **${modelId}**\n`;
            message += `Provider: ${getProviderLabel(inferredProvider)}\n`;
            message += 'Note: Model not in registry; using inferred provider.\n';
            context.emit('text', message);
          } catch (error) {
            const errMsg = error instanceof Error ? error.message : String(error);
            context.emit('text', `Failed to switch model: ${errMsg}\n`);
          }

          context.emit('done');
          return { handled: true };
        }

        // Check if already on this model
        if (modelId === currentModel) {
          context.emit('text', `Already using ${modelDef.name} (${modelId})\n`);
          context.emit('done');
          return { handled: true };
        }

        // Switch model
        if (!context.switchModel) {
          context.emit('text', 'Model switching not available in this context.\n');
          context.emit('done');
          return { handled: true };
        }

        try {
          await context.switchModel(modelId);
          let message = `\nSwitched to **${modelDef.name}** (${modelId})\n`;
          message += `Provider: ${getProviderLabel(modelDef.provider)}\n`;
          message += `Context: ${modelDef.contextWindow?.toLocaleString() || 'unknown'} tokens\n`;
          if (modelDef.notes) {
            message += `Note: ${modelDef.notes}\n`;
          }
          context.emit('text', message);
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          context.emit('text', `Failed to switch model: ${errMsg}\n`);
        }

        context.emit('done');
        return { handled: true };
      },
    };
  }

  /**
   * /memory - Manage persistent memories
   */
  private memoryCommand(): Command {
    return {
      name: 'memory',
      description: 'Manage persistent memories (list, get, set, search, delete, stats, export, import)',
      builtin: true,
      selfHandled: true,
      content: '',
      handler: async (args, context) => {
        const manager = context.getMemoryManager?.();
        if (!manager) {
          context.emit('text', 'Memory system not available. Enable it in config.\n');
          context.emit('done');
          return { handled: true };
        }

        const [action, ...rest] = args.trim().split(/\s+/).filter(Boolean);

        // No args or explicit ui - open interactive panel
        if (!action || action === 'ui') {
          context.emit('done');
          return { handled: true, showPanel: 'memory' as const };
        }

        // /memory help - show help and stats
        if (action === 'help') {
          const stats = await manager.getStats();
          context.emit('text', '\n/memory - Persistent Memory Management\n');
          context.emit('text', '───────────────────────────────────────\n\n');
          context.emit('text', `Total memories: ${stats.totalCount}\n`);
          context.emit('text', `  By scope: global=${stats.byScope.global}, shared=${stats.byScope.shared}, private=${stats.byScope.private}\n`);
          context.emit('text', `  By category: preference=${stats.byCategory.preference}, fact=${stats.byCategory.fact}, knowledge=${stats.byCategory.knowledge}, history=${stats.byCategory.history}\n\n`);
          context.emit('text', 'Commands:\n');
          context.emit('text', '  /memory                         Open interactive memory panel\n');
          context.emit('text', '  /memory list [cat] [opts]     List memories (filter by category/scope/tags)\n');
          context.emit('text', '  /memory get <key>             Get a specific memory\n');
          context.emit('text', '  /memory set <key> <value>     Save a memory (supports --scope, --scopeId)\n');
          context.emit('text', '  /memory update <key> [opts]   Update memory metadata\n');
          context.emit('text', '  /memory search <query>        Search memories\n');
          context.emit('text', '  /memory delete <key>          Delete a memory\n');
          context.emit('text', '  /memory stats                 Show detailed statistics\n');
          context.emit('text', '  /memory export [file]         Export memories to JSON\n');
          context.emit('text', '  /memory import <file>         Import memories from JSON\n');
          context.emit('text', '\nList options:\n');
          context.emit('text', '  --scope <global|shared|private>  Filter by scope\n');
          context.emit('text', '  --tags <tag1,tag2>               Filter by tags\n');
          context.emit('text', '  --importance <n>                 Minimum importance (1-10)\n');
          context.emit('text', '\nCategories: preference | fact | knowledge | history\n');
          context.emit('text', '  preference - User settings and choices (timezone, language, etc.)\n');
          context.emit('text', '  fact       - Known truths about the user or environment\n');
          context.emit('text', '  knowledge  - Learned information (patterns, API endpoints, etc.)\n');
          context.emit('text', '  history    - Session context and conversation topics\n');
          context.emit('done');
          return { handled: true };
        }

        // /memory list [category] [--scope global|shared|private] [--tags tag1,tag2] [--importance n]
        if (action === 'list') {
          const VALID_CATEGORIES = new Set(['preference', 'fact', 'knowledge', 'history']);
          const VALID_SCOPES = new Set(['global', 'shared', 'private']);
          let category: 'preference' | 'fact' | 'knowledge' | 'history' | undefined;
          let scope: 'global' | 'shared' | 'private' | undefined;
          let tags: string[] | undefined;
          let minImportance: number | undefined;

          // Parse args
          let i = 0;
          while (i < rest.length) {
            if (rest[i] === '--scope' && rest[i + 1]) {
              const scopeInput = rest[i + 1].toLowerCase();
              if (!VALID_SCOPES.has(scopeInput)) {
                context.emit('text', `Error: Invalid scope "${rest[i + 1]}". Must be one of: global, shared, private\n`);
                context.emit('done');
                return { handled: true };
              }
              scope = scopeInput as 'global' | 'shared' | 'private';
              i += 2;
            } else if (rest[i] === '--tags' && rest[i + 1]) {
              tags = rest[i + 1].split(',').map(t => t.trim()).filter(Boolean);
              i += 2;
            } else if (rest[i] === '--importance' && rest[i + 1]) {
              const impInput = parseInt(rest[i + 1], 10);
              if (isNaN(impInput) || impInput < 1 || impInput > 10) {
                context.emit('text', `Error: Invalid importance "${rest[i + 1]}". Must be a number between 1 and 10.\n`);
                context.emit('done');
                return { handled: true };
              }
              minImportance = impInput;
              i += 2;
            } else if (!rest[i].startsWith('--')) {
              // Positional argument - category
              const catInput = rest[i].toLowerCase();
              if (VALID_CATEGORIES.has(catInput)) {
                category = catInput as 'preference' | 'fact' | 'knowledge' | 'history';
              }
              i++;
            } else {
              i++;
            }
          }

          const result = await manager.query({
            category,
            scope,
            tags: tags && tags.length > 0 ? tags : undefined,
            minImportance,
            limit: 50,
            orderBy: 'importance',
            orderDir: 'desc',
          });

          if (result.memories.length === 0) {
            context.emit('text', 'No memories found.\n');
          } else {
            context.emit('text', `\nMemories (${result.memories.length}/${result.total}):\n`);
            for (const memory of result.memories) {
              const scopeTag = memory.scope === 'global' ? '[G]' : memory.scope === 'shared' ? '[S]' : '[P]';
              const summary = memory.summary || (typeof memory.value === 'string' ? memory.value.slice(0, 40) : JSON.stringify(memory.value).slice(0, 40));
              context.emit('text', `  ${scopeTag} ${memory.key}: ${summary}${summary.length >= 40 ? '...' : ''} (${memory.category}, imp=${memory.importance})\n`);
            }
          }
          context.emit('done');
          return { handled: true };
        }

        // /memory get <key>
        if (action === 'get') {
          const key = rest.join(' ');
          if (!key) {
            context.emit('text', 'Usage: /memory get <key>\n');
            context.emit('done');
            return { handled: true };
          }

          const memory = await manager.get(key);
          if (!memory) {
            context.emit('text', `Memory not found: ${key}\n`);
          } else {
            context.emit('text', `\nKey: ${memory.key}\n`);
            context.emit('text', `Category: ${memory.category}\n`);
            context.emit('text', `Scope: ${memory.scope}${memory.scopeId ? ` (${memory.scopeId})` : ''}\n`);
            context.emit('text', `Importance: ${memory.importance}/10\n`);
            context.emit('text', `Tags: ${memory.tags.length > 0 ? memory.tags.join(', ') : '(none)'}\n`);
            context.emit('text', `Created: ${memory.createdAt}\n`);
            context.emit('text', `Updated: ${memory.updatedAt}\n`);
            context.emit('text', `Accessed: ${memory.accessCount} times\n`);
            context.emit('text', `\nValue:\n${typeof memory.value === 'string' ? memory.value : JSON.stringify(memory.value, null, 2)}\n`);
          }
          context.emit('done');
          return { handled: true };
        }

        // /memory set <key> <value> [--category <cat>] [--importance <n>] [--tags <t1,t2>] [--scope <scope>] [--scopeId <id>]
        if (action === 'set') {
          if (rest.length < 2) {
            context.emit('text', 'Usage: /memory set <key> <value> [options]\n');
            context.emit('text', '\nOptions:\n');
            context.emit('text', '  --category <preference|fact|knowledge|history>  Memory category (default: fact)\n');
            context.emit('text', '  --importance <1-10>                             Importance level (default: 5)\n');
            context.emit('text', '  --tags <tag1,tag2>                              Tags for filtering\n');
            context.emit('text', '  --scope <global|shared|private>                 Memory scope (default: private)\n');
            context.emit('text', '  --scopeId <id>                                  Scope identifier (for shared/private)\n');
            context.emit('done');
            return { handled: true };
          }

          const key = rest[0];
          let value = '';
          let category: 'preference' | 'fact' | 'knowledge' | 'history' = 'fact';
          let importance = 5;
          let tags: string[] = [];
          let scope: 'global' | 'shared' | 'private' | undefined;
          let scopeId: string | undefined;

          // Valid categories and scopes for validation
          const VALID_CATEGORIES = new Set(['preference', 'fact', 'knowledge', 'history']);
          const VALID_SCOPES = new Set(['global', 'shared', 'private']);

          // Parse remaining args
          let i = 1;
          while (i < rest.length) {
            if (rest[i] === '--category' && rest[i + 1]) {
              const catInput = rest[i + 1].toLowerCase();
              if (!VALID_CATEGORIES.has(catInput)) {
                context.emit('text', `Error: Invalid category "${rest[i + 1]}". Must be one of: preference, fact, knowledge, history\n`);
                context.emit('done');
                return { handled: true };
              }
              category = catInput as 'preference' | 'fact' | 'knowledge' | 'history';
              i += 2;
            } else if (rest[i] === '--importance' && rest[i + 1]) {
              const impInput = parseInt(rest[i + 1], 10);
              if (isNaN(impInput) || impInput < 1 || impInput > 10) {
                context.emit('text', `Error: Invalid importance "${rest[i + 1]}". Must be a number between 1 and 10.\n`);
                context.emit('done');
                return { handled: true };
              }
              importance = impInput;
              i += 2;
            } else if (rest[i] === '--tags' && rest[i + 1]) {
              tags = rest[i + 1].split(',').map(t => t.trim()).filter(Boolean);
              if (tags.length > 20) {
                context.emit('text', 'Error: Too many tags. Maximum is 20.\n');
                context.emit('done');
                return { handled: true };
              }
              i += 2;
            } else if (rest[i] === '--scope' && rest[i + 1]) {
              const scopeInput = rest[i + 1].toLowerCase();
              if (!VALID_SCOPES.has(scopeInput)) {
                context.emit('text', `Error: Invalid scope "${rest[i + 1]}". Must be one of: global, shared, private\n`);
                context.emit('done');
                return { handled: true };
              }
              scope = scopeInput as 'global' | 'shared' | 'private';
              i += 2;
            } else if (rest[i] === '--scopeId' && rest[i + 1]) {
              scopeId = rest[i + 1];
              i += 2;
            } else {
              value += (value ? ' ' : '') + rest[i];
              i++;
            }
          }

          if (!value) {
            context.emit('text', 'Error: value is required.\n');
            context.emit('done');
            return { handled: true };
          }

          // Validate key length
          if (key.length > 256) {
            context.emit('text', 'Error: key is too long. Maximum is 256 characters.\n');
            context.emit('done');
            return { handled: true };
          }

          // Validate value length
          if (value.length > 65536) {
            context.emit('text', 'Error: value is too long. Maximum is 64KB.\n');
            context.emit('done');
            return { handled: true };
          }

          // Validate scopeId usage
          if (scopeId && scope === 'global') {
            context.emit('text', 'Error: scopeId cannot be used with global scope.\n');
            context.emit('done');
            return { handled: true };
          }

          const memory = await manager.set(key, value, {
            category,
            importance,
            tags,
            source: 'user',
            scope,
            scopeId,
          });
          context.emit('text', `Memory saved: ${key} (scope: ${memory.scope})\n`);
          context.emit('done');
          return { handled: true };
        }

        // /memory search <query>
        if (action === 'search') {
          const query = rest.join(' ');
          if (!query) {
            context.emit('text', 'Usage: /memory search <query>\n');
            context.emit('done');
            return { handled: true };
          }

          const result = await manager.query({ search: query, limit: 20 });
          if (result.memories.length === 0) {
            context.emit('text', `No memories found matching: ${query}\n`);
          } else {
            context.emit('text', `\nSearch results for "${query}" (${result.memories.length} found):\n`);
            for (const memory of result.memories) {
              const summary = memory.summary || (typeof memory.value === 'string' ? memory.value.slice(0, 50) : JSON.stringify(memory.value).slice(0, 50));
              context.emit('text', `  ${memory.key}: ${summary}${summary.length >= 50 ? '...' : ''}\n`);
            }
          }
          context.emit('done');
          return { handled: true };
        }

        // /memory delete <key>
        if (action === 'delete') {
          const key = rest.join(' ');
          if (!key) {
            context.emit('text', 'Usage: /memory delete <key>\n');
            context.emit('done');
            return { handled: true };
          }

          const deleted = await manager.deleteByKey(key);
          if (deleted) {
            context.emit('text', `Memory deleted: ${key}\n`);
          } else {
            context.emit('text', `Memory not found: ${key}\n`);
          }
          context.emit('done');
          return { handled: true };
        }

        // /memory update <key> [--importance n] [--tags t1,t2] [--summary text]
        if (action === 'update') {
          if (rest.length < 1) {
            context.emit('text', 'Usage: /memory update <key> [--importance 1-10] [--tags tag1,tag2] [--summary text]\n');
            context.emit('done');
            return { handled: true };
          }

          const key = rest[0];
          let importance: number | undefined;
          let tags: string[] | undefined;
          let summary: string | undefined;

          // Parse arguments
          let i = 1;
          while (i < rest.length) {
            if (rest[i] === '--importance' && rest[i + 1]) {
              const impInput = parseInt(rest[i + 1], 10);
              if (isNaN(impInput) || impInput < 1 || impInput > 10) {
                context.emit('text', `Error: Invalid importance "${rest[i + 1]}". Must be a number between 1 and 10.\n`);
                context.emit('done');
                return { handled: true };
              }
              importance = impInput;
              i += 2;
            } else if (rest[i] === '--tags' && rest[i + 1]) {
              tags = rest[i + 1].split(',').map(t => t.trim()).filter(Boolean);
              if (tags.length > 20) {
                context.emit('text', 'Error: Too many tags. Maximum is 20.\n');
                context.emit('done');
                return { handled: true };
              }
              i += 2;
            } else if (rest[i] === '--summary') {
              // Collect all remaining args for summary
              i++;
              const summaryParts: string[] = [];
              while (i < rest.length && !rest[i].startsWith('--')) {
                summaryParts.push(rest[i]);
                i++;
              }
              summary = summaryParts.join(' ');
              if (summary.length > 500) {
                context.emit('text', 'Error: Summary too long. Maximum is 500 characters.\n');
                context.emit('done');
                return { handled: true };
              }
            } else {
              i++;
            }
          }

          // Require at least one update
          if (importance === undefined && tags === undefined && summary === undefined) {
            context.emit('text', 'Error: Provide at least one update (--importance, --tags, or --summary).\n');
            context.emit('done');
            return { handled: true };
          }

          // Find the memory
          const memory = await manager.get(key);
          if (!memory) {
            context.emit('text', `Memory not found: ${key}\n`);
            context.emit('done');
            return { handled: true };
          }

          // Build updates
          const updates: Record<string, unknown> = {};
          if (importance !== undefined) updates.importance = importance;
          if (tags !== undefined) updates.tags = tags;
          if (summary !== undefined) updates.summary = summary;

          await manager.update(memory.id, updates);
          context.emit('text', `Memory updated: ${key}\n`);
          context.emit('done');
          return { handled: true };
        }

        // /memory stats
        if (action === 'stats') {
          const stats = await manager.getStats();
          context.emit('text', '\nMemory Statistics\n');
          context.emit('text', '─────────────────\n');
          context.emit('text', `Total memories: ${stats.totalCount}\n\n`);
          context.emit('text', 'By scope:\n');
          context.emit('text', `  Global:  ${stats.byScope.global}\n`);
          context.emit('text', `  Shared:  ${stats.byScope.shared}\n`);
          context.emit('text', `  Private: ${stats.byScope.private}\n\n`);
          context.emit('text', 'By category:\n');
          context.emit('text', `  Preferences: ${stats.byCategory.preference}\n`);
          context.emit('text', `  Facts:       ${stats.byCategory.fact}\n`);
          context.emit('text', `  Knowledge:   ${stats.byCategory.knowledge}\n`);
          context.emit('text', `  History:     ${stats.byCategory.history}\n\n`);
          context.emit('text', `Average importance: ${stats.avgImportance.toFixed(1)}/10\n`);
          if (stats.oldestMemory) context.emit('text', `Oldest memory: ${stats.oldestMemory}\n`);
          if (stats.newestMemory) context.emit('text', `Newest memory: ${stats.newestMemory}\n`);
          context.emit('done');
          return { handled: true };
        }

        // /memory export [file]
        if (action === 'export') {
          const filePath = rest[0] || join(context.getStorageDir?.() || getConfigDir(), 'memories-export.json');
          const memories = await manager.export();

          try {
            const content = JSON.stringify(memories, null, 2);
            writeFileSync(filePath, content, 'utf-8');
            context.emit('text', `Exported ${memories.length} memories to: ${filePath}\n`);
          } catch (error) {
            context.emit('text', `Error exporting: ${error instanceof Error ? error.message : String(error)}\n`);
          }
          context.emit('done');
          return { handled: true };
        }

        // /memory import <file> [--overwrite]
        if (action === 'import') {
          let filePath = '';
          let overwrite = false;

          // Parse arguments
          for (const arg of rest) {
            if (arg === '--overwrite') {
              overwrite = true;
            } else if (!filePath) {
              filePath = arg;
            }
          }

          if (!filePath) {
            context.emit('text', 'Usage: /memory import <file> [--overwrite]\n');
            context.emit('text', '  --overwrite  Replace existing memories with same key\n');
            context.emit('done');
            return { handled: true };
          }

          try {
            const runtime = getRuntime();
            const file = runtime.file(filePath);
            if (!(await file.exists())) {
              context.emit('text', `File not found: ${filePath}\n`);
              context.emit('done');
              return { handled: true };
            }
            const content = await file.text();

            // Parse JSON
            let parsed: unknown;
            try {
              parsed = JSON.parse(content);
            } catch {
              context.emit('text', 'Error: Invalid JSON format.\n');
              context.emit('done');
              return { handled: true };
            }

            // Validate structure - must be an array
            if (!Array.isArray(parsed)) {
              context.emit('text', 'Error: File must contain a JSON array of memory objects.\n');
              context.emit('done');
              return { handled: true };
            }

            // Validate each memory entry
            const VALID_SCOPES = new Set(['global', 'shared', 'private']);
            const VALID_CATEGORIES = new Set(['preference', 'fact', 'knowledge', 'history']);
            const VALID_SOURCES = new Set(['user', 'assistant', 'system']);
            const validMemories: unknown[] = [];
            const errors: string[] = [];

            for (let i = 0; i < parsed.length; i++) {
              const entry = parsed[i] as Record<string, unknown>;

              // Validate required fields
              if (!entry || typeof entry !== 'object') {
                errors.push(`Entry ${i}: Must be an object`);
                continue;
              }

              if (!entry.key || typeof entry.key !== 'string') {
                errors.push(`Entry ${i}: Missing or invalid "key" (must be a string)`);
                continue;
              }

              if (entry.value === undefined) {
                errors.push(`Entry ${i}: Missing "value" field`);
                continue;
              }

              if (!entry.category || !VALID_CATEGORIES.has(entry.category as string)) {
                errors.push(`Entry ${i}: Invalid "category" (must be one of: preference, fact, knowledge, history)`);
                continue;
              }

              // Validate optional fields
              if (entry.scope && !VALID_SCOPES.has(entry.scope as string)) {
                errors.push(`Entry ${i}: Invalid "scope" (must be one of: global, shared, private)`);
                continue;
              }

              if (entry.source && !VALID_SOURCES.has(entry.source as string)) {
                errors.push(`Entry ${i}: Invalid "source" (must be one of: user, assistant, system)`);
                continue;
              }

              if (entry.importance !== undefined) {
                const imp = entry.importance as number;
                if (typeof imp !== 'number' || imp < 1 || imp > 10) {
                  errors.push(`Entry ${i}: Invalid "importance" (must be 1-10)`);
                  continue;
                }
              }

              if (entry.tags !== undefined) {
                if (!Array.isArray(entry.tags) || !entry.tags.every((t: unknown) => typeof t === 'string')) {
                  errors.push(`Entry ${i}: Invalid "tags" (must be array of strings)`);
                  continue;
                }
              }

              validMemories.push(entry);
            }

            // Report validation errors
            if (errors.length > 0) {
              context.emit('text', `Validation errors (${errors.length}):\n`);
              for (const err of errors.slice(0, 10)) {
                context.emit('text', `  - ${err}\n`);
              }
              if (errors.length > 10) {
                context.emit('text', `  ... and ${errors.length - 10} more errors\n`);
              }

              if (validMemories.length === 0) {
                context.emit('text', '\nNo valid entries to import. Please fix the errors and try again.\n');
                context.emit('done');
                return { handled: true };
              }

              // Import valid entries and skip invalid ones
              context.emit('text', `\nImporting ${validMemories.length} valid entries (skipping ${errors.length} invalid)...\n`);
            }

            // Import valid memories
            const imported = await manager.import(validMemories as Parameters<typeof manager.import>[0], { overwrite });
            context.emit('text', `Imported ${imported} memories from: ${filePath}${overwrite ? ' (with overwrite)' : ''}${errors.length > 0 ? ` (${errors.length} skipped)` : ''}\n`);
          } catch (error) {
            context.emit('text', `Error importing: ${error instanceof Error ? error.message : String(error)}\n`);
          }
          context.emit('done');
          return { handled: true };
        }

        // Unknown action
        context.emit('text', `Unknown action: ${action}\n`);
        context.emit('text', 'Use /memory for help.\n');
        context.emit('done');
        return { handled: true };
      },
    };
  }

  /**
   * /schedule - Schedule a command
   */
  /**
   * /schedules - Browse and manage all scheduled commands
   */
  private schedulesCommand(): Command {
    return {
      name: 'schedules',
      description: 'Browse and manage all scheduled commands (active, paused, completed)',
      builtin: true,
      selfHandled: true,
      content: '',
      handler: async (args, context) => {
        const trimmed = args.trim().toLowerCase();
        const showAll = trimmed.includes('--all');
        const cleanedArgs = trimmed.replace('--all', '').trim();

        // Show interactive panel for no args or 'ui' command
        if (!cleanedArgs || cleanedArgs === 'ui') {
          context.emit('done');
          return { handled: true, showPanel: 'schedules' };
        }

        // Text-based list for 'list' or '--list'
        if (cleanedArgs === 'list' || cleanedArgs === '--list') {
          // By default only show schedules for current session + global
          const schedules = await listSchedules(context.cwd, showAll ? { global: true } : { sessionId: context.sessionId });
          if (schedules.length === 0) {
            context.emit('text', showAll ? 'No schedules found.\n' : 'No schedules found for this session.\n');
            context.emit('done');
            return { handled: true };
          }

          const escapeCell = (value: string) =>
            value.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

          let output = '\n| ID | Status | Next Run | Command |\n';
          output += '|----|--------|----------|---------|\n';
          for (const schedule of schedules.sort((a, b) => (a.nextRunAt || 0) - (b.nextRunAt || 0))) {
            const next = formatRelativeTime(schedule.nextRunAt);
            const cmd = escapeCell(schedule.command.slice(0, 40) + (schedule.command.length > 40 ? '...' : ''));
            output += `| ${schedule.id} | ${schedule.status} | ${next} | ${cmd} |\n`;
          }
          context.emit('text', output);
          context.emit('done');
          return { handled: true };
        }

        // Show help
        context.emit('text', '\n**Schedules** - Manage scheduled commands\n\n');
        context.emit('text', 'Usage:\n');
        context.emit('text', '  /schedules             Open interactive panel (create, delete, pause, resume)\n');
        context.emit('text', '  /schedules ui          Open interactive panel\n');
        context.emit('text', '  /schedules list        Show text table (this session)\n');
        context.emit('text', '  /schedules list --all  Show all schedules\n');
        context.emit('done');
        return { handled: true };
      },
    };
  }

  /**
   * /heartbeat - View heartbeat status and run history
   */
  private heartbeatCommand(): Command {
    return {
      name: 'heartbeat',
      description: 'View heartbeat status and recent heartbeat runs',
      builtin: true,
      selfHandled: true,
      content: '',
      handler: async (args, context) => {
        const trimmed = args.trim().toLowerCase();
        const showAll = trimmed.includes('--all');
        const cleanedArgs = trimmed.replace('--all', '').trim();

        const heartbeatState = context.getHeartbeatState?.() ?? null;
        const heartbeatConfig = context.getHeartbeatConfig?.() ?? null;
        const historyPathTemplate = heartbeatConfig?.historyPath;
        const storageDir = context.getStorageDir?.();
        const runsDir = storageDir ? join(storageDir, 'heartbeats', 'runs') : undefined;

        // Show interactive panel for no args or 'ui' command
        if (!cleanedArgs || cleanedArgs === 'ui') {
          context.emit('done');
          return { handled: true, showPanel: 'heartbeat' };
        }

        // Text-based list for 'list' or '--list'
        if (cleanedArgs === 'list' || cleanedArgs === '--list') {
          const canEnumerate =
            !historyPathTemplate || historyPathTemplate.includes('{sessionId}');
          const sessionIds = showAll && canEnumerate
            ? listHeartbeatHistorySessions(runsDir)
            : [context.sessionId];

          const rows: Array<{ sessionId: string; run: Heartbeat }> = [];
          for (const sessionId of sessionIds) {
            const historyPath = resolveHeartbeatHistoryPath(sessionId, historyPathTemplate, storageDir);
            const runs = await readHeartbeatHistory(historyPath, { order: 'desc' });
            for (const run of runs) {
              rows.push({ sessionId, run });
            }
          }

          if (rows.length === 0) {
            context.emit(
              'text',
              showAll
                ? 'No heartbeat runs found.\n'
                : 'No heartbeat runs found for this session.\n'
            );
            context.emit('done');
            return { handled: true };
          }

          rows.sort((a, b) => {
            const aTime = new Date(a.run.timestamp).getTime();
            const bTime = new Date(b.run.timestamp).getTime();
            return bTime - aTime;
          });

          const rel = (iso?: string) =>
            formatRelativeTime(iso ? new Date(iso).getTime() : undefined);

          if (heartbeatState) {
            const stateLine = `State: ${heartbeatState.state} | ` +
              `Stale: ${heartbeatState.isStale ? 'yes' : 'no'} | ` +
              `Last Activity: ${rel(heartbeatState.lastActivity)}`;
            context.emit('text', `\n**Heartbeat Status**\n${stateLine}\n\n`);
          }

          const escapeCell = (value: string) =>
            value.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

          let output = '\n';
          if (showAll) {
            output += '| Session | Time | State | Last Activity | Msgs | Tools | Errors |\n';
            output += '|--------|------|-------|---------------|------|-------|--------|\n';
          } else {
            output += '| Time | State | Last Activity | Msgs | Tools | Errors |\n';
            output += '|------|-------|---------------|------|-------|--------|\n';
          }

          for (const { sessionId, run } of rows) {
            const time = rel(run.timestamp);
            const activity = rel(run.lastActivity);
            const stats = run.stats || { messagesProcessed: 0, toolCallsExecuted: 0, errorsEncountered: 0 };
            if (showAll) {
              output += `| ${escapeCell(sessionId.slice(0, 8))} | ${time} | ${run.state} | ${activity} | ${stats.messagesProcessed} | ${stats.toolCallsExecuted} | ${stats.errorsEncountered} |\n`;
            } else {
              output += `| ${time} | ${run.state} | ${activity} | ${stats.messagesProcessed} | ${stats.toolCallsExecuted} | ${stats.errorsEncountered} |\n`;
            }
          }

          context.emit('text', output);
          if (showAll && historyPathTemplate && !historyPathTemplate.includes('{sessionId}')) {
            context.emit('text', '\nNote: custom heartbeat historyPath does not include {sessionId}; showing current session only.\n');
          }
          context.emit('done');
          return { handled: true };
        }

        if (cleanedArgs === 'status') {
          if (!heartbeatState) {
            context.emit('text', 'Heartbeat status unavailable.\n');
            context.emit('done');
            return { handled: true };
          }
          const rel = (iso?: string) =>
            formatRelativeTime(iso ? new Date(iso).getTime() : undefined);
          context.emit('text', '\n**Heartbeat Status**\n');
          context.emit('text', `State: ${heartbeatState.state}\n`);
          context.emit('text', `Enabled: ${heartbeatState.enabled ? 'yes' : 'no'}\n`);
          context.emit('text', `Stale: ${heartbeatState.isStale ? 'yes' : 'no'}\n`);
          context.emit('text', `Last Activity: ${rel(heartbeatState.lastActivity)}\n`);
          context.emit('text', `Uptime: ${heartbeatState.uptimeSeconds}s\n`);
          context.emit('done');
          return { handled: true };
        }

        // Show help
        context.emit('text', '\n**Heartbeat** - View heartbeat status and run history\n\n');
        context.emit('text', 'Usage:\n');
        context.emit('text', '  /heartbeat             Open interactive panel\n');
        context.emit('text', '  /heartbeat ui          Open interactive panel\n');
        context.emit('text', '  /heartbeat list        Show text table (this session)\n');
        context.emit('text', '  /heartbeat list --all  Show text table for all sessions\n');
        context.emit('text', '  /heartbeat status      Show current heartbeat status\n');
        context.emit('done');
        return { handled: true };
      },
    };
  }

  /**
   * /connectors - List and manage connectors
   *
   * Usage:
   *   /connectors              - Open interactive panel (default)
   *   /connectors <name>       - Open panel at specific connector
   *   /connectors --list       - Show text-based table (non-interactive)
   *   /connectors --list <name> - Show text-based detail for specific connector
   *   /connectors refresh      - Refresh connector cache and re-discover
   *   /connectors status       - Show connector cache status
   */
  private connectorsCommand(): Command {
    return {
      name: 'connectors',
      description: 'Browse and search connectors interactively (view commands, refresh)',
      builtin: true,
      selfHandled: true,
      content: '',
      handler: async (args, context) => {
        const trimmedArgs = args.trim();
        const firstArg = trimmedArgs.split(/\s+/)[0]?.toLowerCase();

        // Handle refresh subcommand
        if (firstArg === 'refresh') {
          if (!context.refreshConnectors) {
            context.emit('text', 'Connector refresh is not available.\n');
            context.emit('done');
            return { handled: true };
          }

          context.emit('text', 'Refreshing connectors...\n');
          try {
            const result = await context.refreshConnectors();
            context.emit('text', `✓ Discovered ${result.count} connector(s).\n`);
            if (result.names.length > 0) {
              context.emit('text', `  ${result.names.join(', ')}\n`);
            }
          } catch (error) {
            context.emit('text', `✗ Refresh failed: ${error instanceof Error ? error.message : String(error)}\n`);
          }
          context.emit('done');
          return { handled: true };
        }

        // Handle status subcommand
        if (firstArg === 'status') {
          const count = context.connectors.length;
          context.emit('text', '\n**Connector Status**\n\n');
          context.emit('text', `Loaded: ${count} connector(s)\n`);
          if (count > 0) {
            context.emit('text', `Names: ${context.connectors.map(c => c.name).join(', ')}\n`);
          }
          context.emit('text', '\n**Commands:**\n');
          context.emit('text', '  `/connectors refresh` - Clear cache and re-discover connectors\n');
          context.emit('text', '  `/connectors --list` - Show detailed connector list\n');
          context.emit('done');
          return { handled: true };
        }

        const hasListFlag = trimmedArgs.includes('--list');
        const argWithoutFlag = trimmedArgs.replace('--list', '').trim().toLowerCase();

        // Interactive mode (default): open the connectors panel
        if (!hasListFlag) {
          context.emit('done');
          return {
            handled: true,
            showPanel: 'connectors' as const,
            panelValue: argWithoutFlag || undefined,
          };
        }

        // Text-based mode with --list flag
        const connectorName = argWithoutFlag;

        // If a specific connector is requested, show details
        if (connectorName) {
          let connector: typeof context.connectors[number] | undefined;
          for (const item of context.connectors) {
            if (item.name.toLowerCase() === connectorName) {
              connector = item;
              break;
            }
          }

          if (!connector) {
            context.emit('text', `\nConnector "${connectorName}" not found.\n`);
            context.emit('text', `Use /connectors --list to see available connectors.\n`);
            context.emit('done');
            return { handled: true };
          }

          // Show detailed info for this connector
          const cli = connector.cli || `connect-${connector.name}`;
          const description = connector.description?.trim() || 'No description provided.';
          let message = `\n**${connector.name}** Connector\n\n`;
          message += `CLI: \`${cli}\`\n`;
          message += `Description: ${description}\n\n`;

          // Check auth status
          try {
            let timeoutId: ReturnType<typeof setTimeout> | null = null;
            const timeoutPromise = new Promise<{ exitCode: number; stdout: { toString: () => string } }>((resolve) => {
              timeoutId = setTimeout(resolveAuthTimeout, 1000, resolve);
            });

            const runtime = getRuntime();
            const cli = connector.cli || `connect-${connector.name}`;
            const execPromise = (async () => {
              const cmdParts = buildCommandArgs(cli, ['auth', 'status', '--format', 'json']);
              const proc = runtime.spawn(cmdParts, {
                cwd: process.cwd(),
                stdin: 'ignore',
                stdout: 'pipe',
                stderr: 'ignore',
              });
              const stdout = proc.stdout ? await new Response(proc.stdout).text() : '';
              const exitCode = await proc.exited;
              return { exitCode, stdout: { toString: () => stdout } };
            })();
            const result = await Promise.race([execPromise, timeoutPromise]);

            if (timeoutId) {
              clearTimeout(timeoutId);
            }
            if (result.exitCode === 0) {
              const status = JSON.parse(result.stdout.toString());
              message += `**Auth Status:** ${status.authenticated ? '✓ Authenticated' : '○ Not authenticated'}\n`;
              if (status.user || status.email) {
                message += `**Account:** ${status.user || status.email}\n`;
              }
            } else {
              message += `**Auth Status:** ○ Not authenticated\n`;
            }
          } catch {
            message += `**Auth Status:** ? Unable to check\n`;
          }

          message += `\n**Available Commands:**\n`;
          const commands = connector.commands || [];
          if (commands.length === 0) {
            message += '  (no commands discovered)\n';
          } else {
            for (const cmd of commands) {
              message += `  ${cmd.name} - ${cmd.description}\n`;
            }
          }

          message += `\n**Usage:**\n`;
          message += `  Ask the AI to use ${connector.name} (e.g., "list my ${connector.name} items")\n`;
          message += `  Or run directly: \`${connector.cli} <command>\`\n`;

          context.emit('text', message);
          context.emit('done');
          return { handled: true };
        }

        // List all connectors (text mode)
        let message = '\n**Available Connectors**\n\n';

        if (context.connectors.length === 0) {
          message += 'No connectors found.\n\n';
          message += 'Install connectors using the `connectors` CLI:\n';
          message += '  `connectors install <name>` (e.g. `connectors install gmail`)\n\n';
          message += 'Or install standalone `connect-*` CLIs:\n';
          message += '  `bun add -g connect-<name>`\n\n';
          message += 'Then run `/connectors` again to verify it is detected.\n';
        } else {
          // Check auth status for each
          const checkAuth = async (connector: typeof context.connectors[number]): Promise<string> => {
            let status = '○';
            let timeoutId: ReturnType<typeof setTimeout> | null = null;
            try {
              const cli = connector.cli || `connect-${connector.name}`;
              const timeoutPromise = new Promise<{ exitCode: number; stdout: { toString: () => string } }>((resolve) => {
                timeoutId = setTimeout(resolveAuthTimeout, 1000, resolve);
              });

              const runtime = getRuntime();
              const execPromise = (async () => {
                const cmdParts = buildCommandArgs(cli, ['auth', 'status', '--format', 'json']);
                const proc = runtime.spawn(cmdParts, {
                  cwd: process.cwd(),
                  stdin: 'ignore',
                  stdout: 'pipe',
                  stderr: 'ignore',
                });
                const stdout = proc.stdout ? await new Response(proc.stdout).text() : '';
                const exitCode = await proc.exited;
                return { exitCode, stdout: { toString: () => stdout } };
              })();
              const result = await Promise.race([execPromise, timeoutPromise]);

              if (result.exitCode === 0) {
                try {
                  const parsed = JSON.parse(result.stdout.toString());
                  status = parsed.authenticated ? '✓' : '○';
                } catch {
                  status = '○';
                }
              }
            } catch {
              status = '?';
            } finally {
              if (timeoutId) {
                clearTimeout(timeoutId);
              }
            }
            return status;
          };

          const statuses = await Promise.all(context.connectors.map((connector) => checkAuth(connector)));

          const escapeCell = (value: string) => value.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
          message += '| Status | Connector | Commands |\n';
          message += '|--------|-----------|----------|\n';

          for (let i = 0; i < context.connectors.length; i++) {
            const connector = context.connectors[i];
            const status = statuses[i];
            const cmdCount = connector.commands?.length ?? 0;
            message += `| ${status} | ${escapeCell(connector.name)} | ${cmdCount} commands |\n`;
          }

          message += `\n${context.connectors.length} connector(s) available.\n\n`;
          message += '**Legend:** ✓ authenticated | ○ not authenticated | ? unknown\n\n';
          message += '**Commands:**\n';
          message += '  `/connectors` - Open interactive browser\n';
          message += '  `/connectors <name>` - Open browser at specific connector\n';
          message += '  `connect-<name> auth login` - Authenticate a connector\n';
        }

        context.emit('text', message);
        context.emit('done');
        return { handled: true };
      },
    };
  }

  /**
   * /logs - Show recent security events (interactive panel)
   */
  private securityLogCommand(): Command {
    return {
      name: 'logs',
      aliases: ['security-log'],
      description: 'View security event logs with filtering and navigation',
      builtin: true,
      selfHandled: true,
      content: '',
      handler: async (_args, _context) => {
        return { handled: true, showPanel: 'logs' as const };
      },
    };
  }

  /**
   * /feedback - Submit feedback or report issues
   */
  private feedbackCommand(): Command {
    return {
      name: 'feedback',
      description: 'Submit feedback (good/bad/bug/idea) or report an issue on GitHub',
      builtin: true,
      selfHandled: true,
      content: '',
      handler: async (args, context) => {
        const rawArgs = args.trim();
        const [maybeType, ...rest] = rawArgs.split(/\s+/);
        const normalizedType = maybeType?.toLowerCase();
        const typeMap: Record<string, FeedbackType> = {
          bug: 'bug',
          issue: 'bug',
          feature: 'feature',
          request: 'feature',
          feedback: 'feedback',
        };
        const typeToken = normalizedType && typeMap[normalizedType] ? normalizedType : null;
        const feedbackType: FeedbackType = typeToken ? typeMap[typeToken] : 'feedback';
        const summary = typeToken ? rest.join(' ').trim() : rawArgs;

        // Collect system info
        const runtime = getRuntime();
        const systemInfo = {
          version: VERSION,
          platform: platform(),
          release: release(),
          arch: arch(),
          nodeVersion: process.version,
          runtimeName: runtime.name,
          runtimeVersion: runtime.version,
        };

        // GitHub repo URL
        const repoUrl = 'https://github.com/hasna/assistants';

        // Build issue body template
        const issueBody = `## Description

<!-- Describe the issue or feedback here -->

## Steps to Reproduce (if bug)

1.
2.
3.

## Expected Behavior

<!-- What did you expect to happen? -->

## Actual Behavior

<!-- What actually happened? -->

## System Information

- **assistants version**: ${systemInfo.version}
- **Platform**: ${systemInfo.platform} ${systemInfo.release} (${systemInfo.arch})
- **Runtime**: ${systemInfo.runtimeName} ${systemInfo.runtimeVersion}
- **Node version**: ${systemInfo.nodeVersion}

## Additional Context

<!-- Add any other context about the problem here -->
`;

        // Determine issue template based on feedback type
        let issueTitle = '';
        let labels = '';

        if (feedbackType === 'bug') {
          issueTitle = '[Bug] ';
          labels = 'bug';
        } else if (feedbackType === 'feature') {
          issueTitle = '[Feature Request] ';
          labels = 'enhancement';
        } else {
          issueTitle = '[Feedback] ';
          labels = 'feedback';
        }

        // Save locally
        const localEntry = {
          id: generateId(),
          createdAt: new Date().toISOString(),
          type: feedbackType,
          title: summary || (feedbackType === 'bug' ? 'Bug report' : feedbackType === 'feature' ? 'Feature request' : 'Feedback'),
          description: summary || 'Submitted via /feedback',
          source: 'command',
          metadata: {
            cwd: context.cwd,
          },
        };
        let localPath = '';
        try {
          const saved = saveFeedbackEntry(localEntry, context.cwd);
          localPath = saved.path;
        } catch {
          localPath = '';
        }

        // Build GitHub new issue URL
        const issueUrl = new URL(`${repoUrl}/issues/new`);
        issueUrl.searchParams.set('title', issueTitle);
        issueUrl.searchParams.set('body', issueBody);
        if (labels) {
          issueUrl.searchParams.set('labels', labels);
        }

        // Truncate URL if too long (GitHub has limits)
        let finalUrl = issueUrl.toString();
        if (finalUrl.length > 8000) {
          // Shorten the body if URL is too long
          const shortBody = `## Description

<!-- Describe the issue or feedback here -->

## System Information

- **assistants version**: ${systemInfo.version}
- **Platform**: ${systemInfo.platform} (${systemInfo.arch})
- **Runtime**: ${systemInfo.runtimeName} ${systemInfo.runtimeVersion}
`;
          const shortUrl = new URL(`${repoUrl}/issues/new`);
          shortUrl.searchParams.set('title', issueTitle);
          shortUrl.searchParams.set('body', shortBody);
          if (labels) {
            shortUrl.searchParams.set('labels', labels);
          }
          finalUrl = shortUrl.toString();
        }

        // Open browser
        try {
          const openCmd = platform() === 'darwin' ? 'open' :
                         platform() === 'win32' ? 'start' : 'xdg-open';

          const runtime = getRuntime();
          await runtime.shell`${openCmd} ${finalUrl}`.quiet();

          let message = '\n**Opening GitHub to submit feedback...**\n\n';
          message += 'A browser window should open with a pre-filled issue template.\n';
          message += 'Please fill in the details and submit.\n\n';
          if (localPath) {
            message += `Saved locally: ${localPath}\n\n`;
          }
          message += `If the browser doesn't open, visit:\n${repoUrl}/issues/new\n`;

          context.emit('text', message);
        } catch {
          let message = '\n**Submit Feedback**\n\n';
          message += `Please visit: ${repoUrl}/issues/new\n\n`;
          if (localPath) {
            message += `Saved locally: ${localPath}\n\n`;
          }
          message += '**System Information:**\n';
          message += `- assistants version: ${systemInfo.version}\n`;
          message += `- Platform: ${systemInfo.platform} ${systemInfo.release}\n`;
          message += `- Runtime: ${systemInfo.runtimeName} ${systemInfo.runtimeVersion}\n`;

          context.emit('text', message);
        }

        context.emit('done');
        return { handled: true };
      },
    };
  }

  /**
   * /diff - Show git diff
   */
  private diffCommand(): Command {
    return {
      name: 'diff',
      description: 'Show git diff of current changes (supports --staged, <file>)',
      builtin: true,
      selfHandled: true,
      content: '',
      handler: async (args, context) => {
        const { exec } = await import('child_process');
        const { promisify } = await import('util');
        const execAsync = promisify(exec);
        const parts = splitArgs(args);

        try {
          // Build git diff command
          let diffCmd = 'git diff';
          let statCmd = 'git diff --stat';

          if (parts.includes('--staged') || parts.includes('--cached')) {
            diffCmd += ' --staged';
            statCmd += ' --staged';
            const fileArgs = parts.filter(p => p !== '--staged' && p !== '--cached');
            if (fileArgs.length > 0) {
              const files = fileArgs.map(f => `'${f.replace(/'/g, "'\\''")}'`).join(' ');
              diffCmd += ` -- ${files}`;
              statCmd += ` -- ${files}`;
            }
          } else if (parts.length > 0) {
            const files = parts.map(f => `'${f.replace(/'/g, "'\\''")}'`).join(' ');
            diffCmd += ` -- ${files}`;
            statCmd += ` -- ${files}`;
          }

          const opts = { cwd: context.cwd, maxBuffer: 1024 * 1024 };

          const [statResult, diffResult] = await Promise.all([
            execAsync(statCmd, opts).catch(() => ({ stdout: '' })),
            execAsync(diffCmd, opts).catch(() => ({ stdout: '' })),
          ]);

          const statOutput = (statResult.stdout || '').trim();
          const diffOutput = (diffResult.stdout || '').trim();

          if (!statOutput && !diffOutput) {
            context.emit('text', '\nNo changes detected.\n');
            context.emit('done');
            return { handled: true };
          }

          let message = '\n**Git Diff**\n\n';
          if (statOutput) {
            message += '**Summary:**\n```\n' + statOutput + '\n```\n\n';
          }
          if (diffOutput) {
            message += '**Changes:**\n```diff\n' + diffOutput + '\n```\n';
          }

          context.emit('text', message);
        } catch {
          context.emit('text', '\nNot a git repository or git not available.\n');
        }

        context.emit('done');
        return { handled: true };
      },
    };
  }

  /**
   * /undo - Revert uncommitted changes
   */
  private undoCommand(): Command {
    return {
      name: 'undo',
      description: 'Revert uncommitted changes (file, all, or show preview)',
      builtin: true,
      selfHandled: true,
      content: '',
      handler: async (args, context) => {
        const { exec } = await import('child_process');
        const { promisify } = await import('util');
        const execAsync = promisify(exec);
        const parts = splitArgs(args);
        const opts = { cwd: context.cwd };

        try {
          if (parts.length === 0) {
            const { stdout } = await execAsync('git diff --stat', opts);
            const statOutput = stdout.trim();

            if (!statOutput) {
              context.emit('text', '\nNo uncommitted changes to undo.\n');
              context.emit('done');
              return { handled: true };
            }

            let message = '\n**Uncommitted Changes:**\n```\n' + statOutput + '\n```\n\n';
            message += 'Use `/undo <file>` to revert a specific file\n';
            message += 'Use `/undo all` to revert all changes\n';

            context.emit('text', message);
            context.emit('done');
            return { handled: true };
          }

          if (parts[0] === 'all') {
            const { stdout } = await execAsync('git diff --stat', opts);
            const statOutput = stdout.trim();

            if (!statOutput) {
              context.emit('text', '\nNo uncommitted changes to undo.\n');
              context.emit('done');
              return { handled: true };
            }

            await execAsync('git checkout -- .', opts);
            context.emit('text', '\n**Reverted all uncommitted changes:**\n```\n' + statOutput + '\n```\n');
            context.emit('done');
            return { handled: true };
          }

          // Revert specific file(s)
          const escaped = parts.map(f => `'${f.replace(/'/g, "'\\''")}'`).join(' ');
          const { stdout } = await execAsync(`git diff --stat -- ${escaped}`, opts);
          const checkOutput = stdout.trim();

          if (!checkOutput) {
            context.emit('text', `\nNo changes found for: ${parts.join(' ')}\n`);
            context.emit('done');
            return { handled: true };
          }

          await execAsync(`git checkout -- ${escaped}`, opts);
          context.emit('text', `\n**Reverted:** ${parts.join(' ')}\n`);
        } catch {
          context.emit('text', '\nNot a git repository or git not available.\n');
        }

        context.emit('done');
        return { handled: true };
      },
    };
  }

  private async resolveProject(context: CommandContext, target: string): Promise<ProjectRecord | null> {
    const byId = await readProject(context.cwd, target);
    if (byId) return byId;
    return findProjectByName(context.cwd, target);
  }

  private async ensureActiveProject(
    context: CommandContext,
    createIfMissing: boolean
  ): Promise<ProjectRecord | null> {
    const activeId = context.getActiveProjectId?.();
    if (activeId) {
      const project = await readProject(context.cwd, activeId);
      if (project) return project;
    }

    if (!createIfMissing) return null;

    const project = await ensureDefaultProject(context.cwd);
    context.setActiveProjectId?.(project.id);
    await this.applyProjectContext(context, project);
    return project;
  }

  private async applyProjectContext(context: CommandContext, project: ProjectRecord): Promise<void> {
    if (!context.setProjectContext) return;
    const projectContext = await buildProjectContext(project, {
      cwd: context.cwd,
      connectors: context.connectors,
    });
    context.setProjectContext(projectContext);
  }
}

export const __test__ = {
  resolveAuthTimeout,
};
