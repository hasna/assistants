import { spawn, type ChildProcess } from 'child_process';
import type { STTOptions, STTResult, StreamingSTTCallbacks } from './types';
import { loadApiKeyFromSecrets, findExecutable } from './utils';

/**
 * Speech-to-Text using OpenAI Whisper API
 */
export class WhisperSTT {
  private apiKey: string;
  private model: string;
  private language?: string;

  constructor(options: STTOptions = {}) {
    this.apiKey = options.apiKey
      || process.env.OPENAI_API_KEY
      || loadApiKeyFromSecrets('OPENAI_API_KEY')
      || '';
    this.model = options.model || 'whisper-1';
    this.language = options.language;
  }

  /**
   * Transcribe audio to text
   */
  async transcribe(audioBuffer: ArrayBuffer): Promise<STTResult> {
    if (!this.apiKey) {
      throw new Error('Missing OPENAI_API_KEY for Whisper STT. Set it in env or ~/.secrets.');
    }

    const form = new FormData();
    form.append('file', new Blob([audioBuffer], { type: 'audio/wav' }), 'audio.wav');
    form.append('model', this.model);
    if (this.language) {
      form.append('language', this.language);
    }

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: form,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Whisper STT failed (${response.status}): ${errorText || response.statusText}`);
    }

    const result = await response.json() as { text?: string; language?: string };
    return {
      text: result.text || '',
      confidence: 1,
      language: result.language,
    };
  }
}

/**
 * Speech-to-Text using ElevenLabs Scribe v2 API.
 * Supports both batch transcription and real-time streaming via WebSocket.
 */
export class ElevenLabsSTT {
  private apiKey: string;
  private model: string;
  private language?: string;

  constructor(options: STTOptions = {}) {
    this.apiKey = options.apiKey
      || process.env.ELEVENLABS_API_KEY
      || loadApiKeyFromSecrets('ELEVENLABS_API_KEY')
      || '';
    this.model = options.model || 'scribe_v2';
    this.language = options.language;
  }

  /**
   * Batch transcribe audio to text (POST /v1/speech-to-text)
   */
  async transcribe(audioBuffer: ArrayBuffer): Promise<STTResult> {
    if (!this.apiKey) {
      throw new Error('Missing ELEVENLABS_API_KEY for ElevenLabs STT. Set it in env or ~/.secrets.');
    }

    const form = new FormData();
    form.append('file', new Blob([audioBuffer], { type: 'audio/wav' }), 'audio.wav');
    form.append('model_id', this.model);
    if (this.language) {
      form.append('language_code', this.language);
    }

    const response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST',
      headers: {
        'xi-api-key': this.apiKey,
      },
      body: form,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`ElevenLabs STT failed (${response.status}): ${errorText || response.statusText}`);
    }

    const result = await response.json() as { text?: string; language_code?: string };
    return {
      text: result.text || '',
      confidence: 1,
      language: result.language_code,
    };
  }

  /**
   * Stream audio from microphone with real-time partial transcripts.
   * Uses ElevenLabs Scribe v2 Realtime WebSocket API.
   *
   * Spawns sox/ffmpeg to capture raw PCM audio from the mic, sends base64-encoded
   * chunks over WebSocket, and receives partial/committed transcripts in real-time.
   *
   * @param callbacks - onPartial for live text, onFinal for committed segments, onDone when finished
   * @param options - autoSend: use VAD auto-commit (default true), silenceThreshold: seconds (default 1.5)
   * @returns { stop } function to manually stop recording
   */
  async streamFromMic(
    callbacks: StreamingSTTCallbacks,
    options: { autoSend?: boolean; silenceThreshold?: number } = {},
  ): Promise<{ stop: () => void }> {
    if (!this.apiKey) {
      throw new Error('Missing ELEVENLABS_API_KEY for ElevenLabs STT. Set it in env or ~/.secrets.');
    }

    const autoSend = options.autoSend !== false;
    const silenceThreshold = options.silenceThreshold ?? 1.5;
    const sampleRate = 16000;
    let stopped = false;
    let ws: WebSocket | null = null;
    let recProcess: ChildProcess | null = null;
    let fullText = '';

    // Build WebSocket URL with query params
    const params = new URLSearchParams({
      model_id: this.model,
      audio_format: `pcm_${sampleRate}`,
      commit_strategy: autoSend ? 'vad' : 'manual',
      vad_silence_threshold_secs: String(silenceThreshold),
      vad_threshold: '0.4',
      min_speech_duration_ms: '100',
      min_silence_duration_ms: '100',
    });
    if (this.language) {
      params.set('language_code', this.language);
    }

    const wsUrl = `wss://api.elevenlabs.io/v1/speech-to-text/realtime?${params.toString()}`;

    return new Promise<{ stop: () => void }>((resolve, reject) => {
      try {
        ws = new WebSocket(wsUrl, {
          headers: { 'xi-api-key': this.apiKey },
        } as unknown as string[]);
      } catch (err) {
        reject(new Error(`Failed to create WebSocket: ${err instanceof Error ? err.message : String(err)}`));
        return;
      }

      const cleanup = () => {
        stopped = true;
        if (recProcess) {
          try { recProcess.kill('SIGINT'); } catch {}
          recProcess = null;
        }
        if (ws && ws.readyState === WebSocket.OPEN) {
          try { ws.close(); } catch {}
        }
        ws = null;
      };

      const stop = () => {
        if (stopped) return;
        cleanup();
        callbacks.onDone?.(fullText);
      };

      ws.onopen = () => {
        // Start recording raw PCM from mic
        recProcess = spawnMicRecorder(sampleRate);
        if (!recProcess || !recProcess.stdout) {
          cleanup();
          reject(new Error('Failed to start microphone recording. Install sox or ffmpeg.'));
          return;
        }

        // Stream audio chunks to WebSocket
        recProcess.stdout.on('data', (chunk: Buffer) => {
          if (stopped || !ws || ws.readyState !== WebSocket.OPEN) return;
          const base64 = chunk.toString('base64');
          ws.send(JSON.stringify({
            message_type: 'input_audio_chunk',
            audio_base_64: base64,
          }));
        });

        recProcess.on('close', () => {
          recProcess = null;
          // If recording ended naturally (not stopped by user), finalize
          if (!stopped && ws && ws.readyState === WebSocket.OPEN) {
            // Send a final commit for manual mode
            if (!autoSend) {
              ws.send(JSON.stringify({
                message_type: 'input_audio_chunk',
                audio_base_64: '',
                commit: true,
              }));
            }
            // Give server a moment to send final transcript then close
            setTimeout(() => {
              if (!stopped) stop();
            }, 500);
          }
        });

        recProcess.on('error', () => {
          if (!stopped) {
            cleanup();
            reject(new Error('Microphone recording process failed.'));
          }
        });

        resolve({ stop });
      };

      ws.onmessage = (event) => {
        if (stopped) return;
        try {
          const msg = JSON.parse(String(event.data)) as {
            message_type: string;
            text?: string;
            error?: string;
          };

          switch (msg.message_type) {
            case 'partial_transcript':
              if (msg.text) {
                callbacks.onPartial?.(msg.text);
              }
              break;

            case 'committed_transcript':
            case 'committed_transcript_with_timestamps':
              if (msg.text) {
                fullText = fullText ? `${fullText} ${msg.text}` : msg.text;
                callbacks.onFinal?.(msg.text);
              }
              break;

            case 'session_started':
              // Connection established, already recording
              break;

            default:
              // Handle error types
              if (msg.error) {
                cleanup();
                callbacks.onDone?.(fullText);
              }
              break;
          }
        } catch {
          // Ignore malformed messages
        }
      };

      ws.onerror = (event) => {
        if (!stopped) {
          cleanup();
          const errMsg = event instanceof ErrorEvent ? event.message : 'WebSocket error';
          reject(new Error(`ElevenLabs realtime STT WebSocket error: ${errMsg}`));
        }
      };

      ws.onclose = () => {
        if (!stopped) {
          stopped = true;
          if (recProcess) {
            try { recProcess.kill('SIGINT'); } catch {}
            recProcess = null;
          }
          callbacks.onDone?.(fullText);
        }
      };
    });
  }
}

/**
 * Spawn a process to record raw PCM audio from the default microphone.
 * Outputs 16-bit signed LE PCM on stdout at the given sample rate.
 */
function spawnMicRecorder(sampleRate: number): ChildProcess {
  const sox = findExecutable('sox');
  if (sox) {
    // sox: record from default device, output raw PCM to stdout
    return spawn(sox, [
      '-d',                    // default input device
      '-t', 'raw',             // raw output format
      '-r', String(sampleRate),
      '-e', 'signed-integer',
      '-b', '16',              // 16-bit
      '-c', '1',               // mono
      '-',                     // output to stdout
    ], { stdio: ['ignore', 'pipe', 'ignore'] });
  }

  const ffmpeg = findExecutable('ffmpeg');
  if (ffmpeg) {
    const inputArgs = process.platform === 'darwin'
      ? ['-f', 'avfoundation', '-i', ':0']
      : process.platform === 'linux'
        ? ['-f', 'alsa', '-i', 'default']
        : ['-f', 'dshow', '-i', 'audio=default'];

    return spawn(ffmpeg, [
      ...inputArgs,
      '-ac', '1',
      '-ar', String(sampleRate),
      '-f', 's16le',           // raw PCM 16-bit signed LE
      '-acodec', 'pcm_s16le',
      'pipe:1',                // output to stdout
    ], { stdio: ['ignore', 'pipe', 'ignore'] });
  }

  throw new Error('No supported audio recorder found. Install sox or ffmpeg.');
}

export class SystemSTT {
  async transcribe(_audioBuffer: ArrayBuffer): Promise<STTResult> {
    throw new Error('System STT is not available yet. Use Whisper STT instead.');
  }
}
