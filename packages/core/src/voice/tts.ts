import { spawnSync } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import { readFileSync, unlinkSync } from 'fs';
import type { TTSOptions, TTSResult } from './types';
import { loadApiKeyFromSecrets, findExecutable } from './utils';

/**
 * Text-to-Speech using ElevenLabs API
 */
export class ElevenLabsTTS {
  private apiKey: string;
  private voiceId: string;
  private model: string;
  private stability?: number;
  private similarityBoost?: number;
  private speed?: number;

  constructor(options: TTSOptions) {
    this.apiKey = options.apiKey
      || process.env.ELEVENLABS_API_KEY
      || loadApiKeyFromSecrets('ELEVENLABS_API_KEY')
      || '';
    this.voiceId = options.voiceId
      || process.env.ELEVENLABS_VOICE_ID
      || '';
    this.model = options.model || 'eleven_v3';
    this.stability = options.stability;
    this.similarityBoost = options.similarityBoost;
    this.speed = options.speed;
  }

  /**
   * Convert text to speech
   */
  async synthesize(text: string): Promise<TTSResult> {
    if (!this.apiKey) {
      throw new Error('Missing ELEVENLABS_API_KEY for ElevenLabs TTS. Set it in env or ~/.secrets.');
    }
    if (!this.voiceId) {
      throw new Error('Missing ElevenLabs voice ID. Set voiceId in config or ELEVENLABS_VOICE_ID.');
    }

    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}`,
      {
        method: 'POST',
        headers: {
          Accept: 'audio/mpeg',
          'Content-Type': 'application/json',
          'xi-api-key': this.apiKey,
        },
        body: JSON.stringify({
          text,
          model_id: this.model,
          voice_settings: {
            stability: this.stability ?? 0.5,
            similarity_boost: this.similarityBoost ?? 0.75,
            ...(this.speed ? { speed: this.speed } : {}),
          },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`ElevenLabs TTS failed (${response.status}): ${errorText || response.statusText}`);
    }

    const audio = await response.arrayBuffer();
    return { audio, format: 'mp3' };
  }

  /**
   * Stream text to speech (for real-time playback)
   */
  async *stream(text: string): AsyncGenerator<ArrayBuffer> {
    if (!this.apiKey) {
      throw new Error('Missing ELEVENLABS_API_KEY for ElevenLabs TTS. Set it in env or ~/.secrets.');
    }
    if (!this.voiceId) {
      throw new Error('Missing ElevenLabs voice ID. Set voiceId in config or ELEVENLABS_VOICE_ID.');
    }

    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}/stream`,
      {
        method: 'POST',
        headers: {
          Accept: 'audio/mpeg',
          'Content-Type': 'application/json',
          'xi-api-key': this.apiKey,
        },
        body: JSON.stringify({
          text,
          model_id: this.model,
          voice_settings: {
            stability: this.stability ?? 0.5,
            similarity_boost: this.similarityBoost ?? 0.75,
            ...(this.speed ? { speed: this.speed } : {}),
          },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`ElevenLabs TTS stream failed (${response.status}): ${errorText || response.statusText}`);
    }

    if (!response.body) {
      return;
    }

    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        yield value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
      }
    }
  }
}

export class SystemTTS {
  private voiceId?: string;
  private speed?: number;

  constructor(options: TTSOptions = {}) {
    this.voiceId = options.voiceId;
    this.speed = options.speed;
  }

  async synthesize(text: string): Promise<TTSResult> {
    if (process.platform === 'darwin') {
      const say = findExecutable('say');
      if (!say) {
        throw new Error('System TTS not available: missing "say" command.');
      }
      const output = join(tmpdir(), `assistants-tts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.aiff`);
      const args: string[] = [];
      if (this.voiceId) {
        args.push('-v', this.voiceId);
      }
      if (this.speed) {
        args.push('-r', String(Math.round(200 * this.speed)));
      }
      args.push('-o', output, text);
      const result = spawnSync(say, args, { encoding: 'utf-8' });
      if (result.status !== 0) {
        throw new Error(`System TTS failed: ${result.stderr || 'unknown error'}`);
      }
      const audio = readFileSync(output);
      unlinkSync(output);
      return {
        audio: audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength),
        format: 'aiff',
      };
    }

    const espeak = findExecutable('espeak') || findExecutable('espeak-ng');
    if (espeak) {
      const output = join(tmpdir(), `assistants-tts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.wav`);
      const args: string[] = ['-w', output];
      if (this.voiceId) {
        args.push('-v', this.voiceId);
      }
      if (this.speed) {
        args.push('-s', String(Math.round(175 * this.speed)));
      }
      args.push(text);
      const result = spawnSync(espeak, args, { encoding: 'utf-8' });
      if (result.status !== 0) {
        throw new Error(`System TTS failed: ${result.stderr || 'unknown error'}`);
      }
      const audio = readFileSync(output);
      unlinkSync(output);
      return {
        audio: audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength),
        format: 'wav',
      };
    }

    throw new Error('System TTS is not available on this platform.');
  }
}
