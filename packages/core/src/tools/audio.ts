import { resolve } from 'path';
import { homedir } from 'os';
import type { Tool } from '@hasna/assistants-shared';
import type { ToolExecutor, ToolRegistry } from './registry';
import { ErrorCodes, ToolExecutionError } from '../errors';
import { validatePath } from '../validation/paths';
import { isPathSafe } from '../security/path-validator';
import { getSecurityLogger } from '../security/logger';
import { getRuntime } from '../runtime';
import { ElevenLabsSTT } from '../voice/stt';

// Supported audio extensions
const AUDIO_EXTENSIONS = new Set([
  '.wav', '.mp3', '.m4a', '.flac', '.ogg', '.webm', '.aac',
]);

// Max audio file size (25MB - ElevenLabs limit)
const MAX_AUDIO_SIZE = 25 * 1024 * 1024;

function resolveInputPath(baseCwd: string, inputPath: string): string {
  const envHome = process.env.HOME || process.env.USERPROFILE;
  const home = envHome && envHome.trim().length > 0 ? envHome : homedir();
  if (inputPath === '~') return home;
  if (inputPath.startsWith('~/')) return resolve(home, inputPath.slice(2));
  return resolve(baseCwd, inputPath);
}

/**
 * Audio reading tool - transcribes audio files to text
 */
export class AudioTools {
  static readonly readAudioTool: Tool = {
    name: 'read_audio',
    description:
      'Transcribe an audio file to text using ElevenLabs Scribe. ' +
      'Supports wav, mp3, m4a, flac, ogg, webm, aac. Max 25MB. ' +
      'Requires ELEVENLABS_API_KEY.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the audio file (absolute or relative to cwd)',
        },
        language: {
          type: 'string',
          description: 'Language code for transcription (optional, auto-detected)',
        },
        cwd: {
          type: 'string',
          description: 'Base working directory for relative paths (optional)',
        },
      },
      required: ['path'],
    },
  };

  static readonly readAudioExecutor: ToolExecutor = async (input) => {
    const baseCwd = (input.cwd as string) || process.cwd();
    const rawPath = String(input.path || '').trim();
    const language = input.language as string | undefined;

    if (!rawPath) {
      throw new ToolExecutionError('Audio file path is required', {
        toolName: 'read_audio',
        toolInput: input,
        code: ErrorCodes.VALIDATION_OUT_OF_RANGE,
        recoverable: false,
        retryable: false,
        suggestion: 'Provide a valid audio file path.',
      });
    }

    const path = resolveInputPath(baseCwd, rawPath);

    try {
      // Validate path safety
      const safety = await isPathSafe(path, 'read', { cwd: baseCwd });
      if (!safety.safe) {
        getSecurityLogger().log({
          eventType: 'path_violation',
          severity: 'high',
          details: {
            tool: 'read_audio',
            path,
            reason: safety.reason || 'Blocked path',
          },
          sessionId: (input.sessionId as string) || 'unknown',
        });
        throw new ToolExecutionError(safety.reason || 'Blocked path', {
          toolName: 'read_audio',
          toolInput: input,
          code: ErrorCodes.TOOL_PERMISSION_DENIED,
          recoverable: false,
          retryable: false,
        });
      }

      const validated = await validatePath(path, { allowSymlinks: true });
      if (!validated.valid) {
        throw new ToolExecutionError(validated.error || 'Invalid path', {
          toolName: 'read_audio',
          toolInput: input,
          code: ErrorCodes.VALIDATION_OUT_OF_RANGE,
          recoverable: false,
          retryable: false,
          suggestion: 'Provide a valid audio file path.',
        });
      }

      const runtime = getRuntime();
      const file = runtime.file(validated.resolved);
      if (!(await file.exists())) {
        throw new ToolExecutionError(`Audio file not found: ${path}`, {
          toolName: 'read_audio',
          toolInput: input,
          code: ErrorCodes.TOOL_EXECUTION_FAILED,
          recoverable: false,
          retryable: false,
          suggestion: 'Check the file path and try again.',
        });
      }

      // Check extension
      const ext = '.' + path.split('.').pop()?.toLowerCase();
      if (!AUDIO_EXTENSIONS.has(ext)) {
        throw new ToolExecutionError(
          `Unsupported audio format: ${ext}. Supported: ${[...AUDIO_EXTENSIONS].join(', ')}`,
          {
            toolName: 'read_audio',
            toolInput: input,
            code: ErrorCodes.VALIDATION_OUT_OF_RANGE,
            recoverable: false,
            retryable: false,
            suggestion: `Use one of: ${[...AUDIO_EXTENSIONS].join(', ')}`,
          }
        );
      }

      // Check file size
      if (file.size > MAX_AUDIO_SIZE) {
        throw new ToolExecutionError(
          `Audio file too large: ${(file.size / 1024 / 1024).toFixed(1)}MB (max 25MB)`,
          {
            toolName: 'read_audio',
            toolInput: input,
            code: ErrorCodes.VALIDATION_OUT_OF_RANGE,
            recoverable: false,
            retryable: false,
            suggestion: 'Use a smaller audio file (max 25MB).',
          }
        );
      }

      // Read file and transcribe
      const buffer = await file.arrayBuffer();
      const stt = new ElevenLabsSTT({ language });
      const result = await stt.transcribe(buffer);

      const fileName = path.split('/').pop() || 'audio';
      const duration = result.duration ? ` (${result.duration}s)` : '';
      const lang = result.language ? ` [${result.language}]` : '';

      return `Transcription of ${fileName}${duration}${lang}:\n\n${result.text}`;
    } catch (error) {
      if (error instanceof ToolExecutionError) throw error;
      throw new ToolExecutionError(error instanceof Error ? error.message : String(error), {
        toolName: 'read_audio',
        toolInput: input,
        code: ErrorCodes.TOOL_EXECUTION_FAILED,
        recoverable: true,
        retryable: false,
      });
    }
  };

  // ============================================
  // generate_audio tool - OpenAI TTS
  // ============================================

  static readonly generateAudioTool: Tool = {
    name: 'generate_audio',
    description:
      'Generate speech audio from text using OpenAI TTS. ' +
      'Saves the audio to a file and plays it. Requires OPENAI_API_KEY. ' +
      'Voices: alloy, ash, ballad, coral, echo, fable, onyx, nova, sage, shimmer, verse.',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Text to convert to speech',
        },
        voice: {
          type: 'string',
          description: 'Voice to use (default: nova)',
          enum: ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'onyx', 'nova', 'sage', 'shimmer', 'verse'],
        },
        model: {
          type: 'string',
          description: 'TTS model (default: gpt-4o-mini-tts)',
          enum: ['gpt-4o-mini-tts', 'tts-1', 'tts-1-hd'],
        },
        speed: {
          type: 'number',
          description: 'Playback speed (0.25 to 4.0, default: 1.0)',
        },
        instructions: {
          type: 'string',
          description: 'Speaking style instructions (gpt-4o-mini-tts only)',
        },
      },
      required: ['text'],
    },
  };

  static readonly generateAudioExecutor: ToolExecutor = async (input) => {
    const text = input.text as string;
    const voice = (input.voice as string) || 'nova';
    const model = (input.model as string) || 'gpt-4o-mini-tts';
    const speed = (input.speed as number) || 1.0;
    const instructions = input.instructions as string | undefined;

    if (!text || typeof text !== 'string') {
      throw new ToolExecutionError('Text is required', {
        toolName: 'generate_audio',
        toolInput: input,
        code: ErrorCodes.VALIDATION_OUT_OF_RANGE,
        recoverable: false,
        retryable: false,
        suggestion: 'Provide text to convert to speech.',
      });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new ToolExecutionError(
        'OPENAI_API_KEY is required for audio generation. Set it in env or ~/.secrets.',
        {
          toolName: 'generate_audio',
          toolInput: input,
          code: ErrorCodes.TOOL_PERMISSION_DENIED,
          recoverable: false,
          retryable: false,
        }
      );
    }

    try {
      const body: Record<string, unknown> = {
        model,
        input: text,
        voice,
        speed: Math.max(0.25, Math.min(4.0, speed)),
        response_format: 'mp3',
      };
      if (instructions && model === 'gpt-4o-mini-tts') {
        body.instructions = instructions;
      }

      const response = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new ToolExecutionError(
          `Audio generation failed (${response.status}): ${errorText || response.statusText}`,
          {
            toolName: 'generate_audio',
            toolInput: input,
            code: ErrorCodes.TOOL_EXECUTION_FAILED,
            recoverable: true,
            retryable: false,
          }
        );
      }

      const audioBuffer = await response.arrayBuffer();
      const tempFile = resolve(
        homedir(),
        '.assistants',
        'audio',
        `speech-${Date.now()}.mp3`
      );

      // Ensure directory exists
      const runtime = getRuntime();
      const dir = resolve(homedir(), '.assistants', 'audio');
      try {
        await runtime.file(dir).exists();
      } catch {
        // directory may not exist
      }
      const { mkdirSync } = await import('fs');
      mkdirSync(dir, { recursive: true });

      const { writeFileSync } = await import('fs');
      writeFileSync(tempFile, Buffer.from(audioBuffer));

      // Play the audio file
      try {
        const { spawnSync } = await import('child_process');
        if (process.platform === 'darwin') {
          spawnSync('afplay', [tempFile], { timeout: 60_000 });
        } else if (process.platform === 'linux') {
          spawnSync('aplay', [tempFile], { timeout: 60_000 });
        }
      } catch {
        // Playback is best-effort
      }

      return JSON.stringify({
        success: true,
        path: tempFile,
        model,
        voice,
        textLength: text.length,
        message: `Audio generated and saved to ${tempFile}`,
      });
    } catch (error) {
      if (error instanceof ToolExecutionError) throw error;
      throw new ToolExecutionError(
        error instanceof Error ? error.message : String(error),
        {
          toolName: 'generate_audio',
          toolInput: input,
          code: ErrorCodes.TOOL_EXECUTION_FAILED,
          recoverable: true,
          retryable: false,
        }
      );
    }
  };

  /**
   * Register all audio tools
   */
  static registerAll(registry: ToolRegistry): void {
    registry.register(AudioTools.readAudioTool, AudioTools.readAudioExecutor);
    registry.register(AudioTools.generateAudioTool, AudioTools.generateAudioExecutor);
  }
}
