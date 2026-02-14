/**
 * Voice Tools
 *
 * Tools that allow assistants to control voice mode and interact with
 * text-to-speech and speech-to-text capabilities.
 */

import type { Tool } from '@hasna/assistants-shared';
import type { ToolExecutor, ToolRegistry } from './registry';
import type { VoiceManager } from '../voice/manager';

/**
 * Context required for voice tools
 */
export interface VoiceToolContext {
  getVoiceManager: () => VoiceManager | null;
  /** Process a message during talk mode (for voice_talk tool) */
  processForTalk?: (text: string) => Promise<string>;
  /** Emit events to the terminal (for voice_talk tool) */
  emit?: (event: { type: string; content?: string; error?: string }) => void;
}

// ============================================
// Tool Definitions
// ============================================

export const voiceEnableTool: Tool = {
  name: 'voice_enable',
  description: 'Enable voice mode for text-to-speech output and speech-to-text input.',
  parameters: {
    type: 'object',
    properties: {},
  },
};

export const voiceDisableTool: Tool = {
  name: 'voice_disable',
  description: 'Disable voice mode. Stops any active speaking or listening.',
  parameters: {
    type: 'object',
    properties: {},
  },
};

export const voiceStatusTool: Tool = {
  name: 'voice_status',
  description: 'Get the current voice mode status including enabled state, speaking/listening activity, and configured providers.',
  parameters: {
    type: 'object',
    properties: {},
  },
};

export const voiceSayTool: Tool = {
  name: 'voice_say',
  description: 'Speak text aloud using text-to-speech. Voice mode must be enabled.',
  parameters: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: 'The text to speak aloud',
      },
    },
    required: ['text'],
  },
};

export const voiceListenTool: Tool = {
  name: 'voice_listen',
  description: 'Listen for speech and transcribe it to text. Voice mode must be enabled. Returns the transcribed text.',
  parameters: {
    type: 'object',
    properties: {
      durationSeconds: {
        type: 'number',
        description: 'Maximum recording duration in seconds (optional)',
      },
    },
  },
};

export const voiceStopTool: Tool = {
  name: 'voice_stop',
  description: 'Stop any active speaking, listening, or talk mode.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['speaking', 'listening', 'talking', 'all'],
        description: 'What to stop: speaking, listening, talking, or all (default: all)',
      },
    },
  },
};

export const voiceTalkTool: Tool = {
  name: 'voice_talk',
  description: 'Start live voice conversation mode. The user can speak naturally and the assistant will respond via voice. Uses real-time streaming transcription with automatic silence detection. Auto-send can be toggled. Call this when the user wants to have a voice conversation or when voice interaction would be more natural.',
  parameters: {
    type: 'object',
    properties: {
      autoSend: {
        type: 'boolean',
        description: 'Whether to automatically send messages after silence (default: true). Set to false to require user confirmation.',
      },
    },
  },
};

// ============================================
// Tool Array
// ============================================

export const voiceTools: Tool[] = [
  voiceEnableTool,
  voiceDisableTool,
  voiceStatusTool,
  voiceSayTool,
  voiceListenTool,
  voiceStopTool,
  voiceTalkTool,
];

// ============================================
// Tool Executors
// ============================================

export function createVoiceToolExecutors(context: VoiceToolContext): Record<string, ToolExecutor> {
  return {
    voice_enable: async (): Promise<string> => {
      const manager = context.getVoiceManager();
      if (!manager) {
        return JSON.stringify({
          error: 'Voice support is not available in this environment',
          suggestion: 'Voice features require a runtime with audio capabilities',
        });
      }

      manager.enable();
      return JSON.stringify({
        success: true,
        message: 'Voice mode enabled',
        state: manager.getState(),
      });
    },

    voice_disable: async (): Promise<string> => {
      const manager = context.getVoiceManager();
      if (!manager) {
        return JSON.stringify({
          error: 'Voice support is not available in this environment',
        });
      }

      manager.disable();
      return JSON.stringify({
        success: true,
        message: 'Voice mode disabled',
        state: manager.getState(),
      });
    },

    voice_status: async (): Promise<string> => {
      const manager = context.getVoiceManager();
      if (!manager) {
        return JSON.stringify({
          available: false,
          error: 'Voice support is not available in this environment',
        });
      }

      const state = manager.getState();
      return JSON.stringify({
        available: true,
        enabled: state.enabled,
        isSpeaking: state.isSpeaking,
        isListening: state.isListening,
        providers: {
          stt: state.sttProvider || 'unknown',
          tts: state.ttsProvider || 'unknown',
        },
      }, null, 2);
    },

    voice_say: async (input: Record<string, unknown>): Promise<string> => {
      const manager = context.getVoiceManager();
      if (!manager) {
        return JSON.stringify({
          error: 'Voice support is not available in this environment',
        });
      }

      const text = input.text as string;
      if (!text || typeof text !== 'string') {
        return JSON.stringify({
          error: 'Missing required parameter: text',
          suggestion: 'Provide text to speak: voice_say({ text: "Hello!" })',
        });
      }

      try {
        await manager.speak(text);
        return JSON.stringify({
          success: true,
          message: 'Text spoken successfully',
          textLength: text.length,
        });
      } catch (error) {
        return JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
          suggestion: manager.isEnabled()
            ? 'Check audio output device'
            : 'Enable voice mode first with voice_enable',
        });
      }
    },

    voice_listen: async (input: Record<string, unknown>): Promise<string> => {
      const manager = context.getVoiceManager();
      if (!manager) {
        return JSON.stringify({
          error: 'Voice support is not available in this environment',
        });
      }

      const durationSeconds = typeof input.durationSeconds === 'number'
        ? input.durationSeconds
        : undefined;

      try {
        const text = await manager.listen({ durationSeconds });
        return JSON.stringify({
          success: true,
          text: text.trim(),
          empty: !text.trim(),
        });
      } catch (error) {
        return JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
          suggestion: manager.isEnabled()
            ? 'Check microphone permissions and audio input device'
            : 'Enable voice mode first with voice_enable',
        });
      }
    },

    voice_stop: async (input: Record<string, unknown>): Promise<string> => {
      const manager = context.getVoiceManager();
      if (!manager) {
        return JSON.stringify({
          error: 'Voice support is not available in this environment',
        });
      }

      const action = (input.action as string) || 'all';
      const stopped = new Set<string>();

      if (action === 'talking' || action === 'all') {
        manager.stopTalking();
        stopped.add('talking');
      }
      if (action === 'speaking' || action === 'all') {
        manager.stopSpeaking();
        stopped.add('speaking');
      }
      if (action === 'listening' || action === 'all') {
        manager.stopListening();
        stopped.add('listening');
      }

      return JSON.stringify({
        success: true,
        stopped: Array.from(stopped),
        state: manager.getState(),
      });
    },

    voice_talk: async (input: Record<string, unknown>): Promise<string> => {
      const manager = context.getVoiceManager();
      if (!manager) {
        return JSON.stringify({
          error: 'Voice support is not available in this environment',
          suggestion: 'Voice features require a runtime with audio capabilities',
        });
      }

      if (!context.processForTalk || !context.emit) {
        return JSON.stringify({
          error: 'Talk mode is not available in this context',
          suggestion: 'Use /talk command from the terminal',
        });
      }

      const autoSend = input.autoSend !== false;
      manager.setAutoSend(autoSend);

      const processForTalk = context.processForTalk;
      const emit = context.emit;

      const sendMode = autoSend
        ? 'Speak naturally — silence auto-sends.'
        : 'Speak, then press Enter to send.';

      emit({ type: 'text', content: `\n## Talk Mode\n\nLive conversation started. ${sendMode}\nSay "stop" or press Ctrl+C to exit.\n\n` });

      try {
        await manager.talk({
          onPartialTranscript: (text) => {
            emit({ type: 'partial_transcript', content: text });
          },
          onTranscript: (text) => {
            emit({ type: 'partial_transcript', content: '' });
            emit({ type: 'text', content: `**You:** ${text}\n\n` });
          },
          onResponse: () => {
            // Response is streamed to chat by processForTalk
          },
          sendMessage: async (text) => {
            return processForTalk(text);
          },
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (msg !== 'Talk mode stopped') {
          return JSON.stringify({ error: msg });
        }
      }

      return JSON.stringify({
        success: true,
        message: 'Talk mode ended',
        state: manager.getState(),
      });
    },
  };
}

// ============================================
// Registration
// ============================================

export function registerVoiceTools(
  registry: ToolRegistry,
  context: VoiceToolContext
): void {
  const executors = createVoiceToolExecutors(context);

  for (const tool of voiceTools) {
    registry.register(tool, executors[tool.name]);
  }
}
