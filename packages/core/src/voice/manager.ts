import type { VoiceConfig } from '@hasna/assistants-shared';
import type { STTProvider, TTSProvider, VoiceState } from './types';
import type { RecordOptions } from './recorder';
import { WhisperSTT, ElevenLabsSTT, SystemSTT } from './stt';
import { ElevenLabsTTS, OpenAITTS, SystemTTS } from './tts';
import { AudioPlayer, type PlayOptions } from './player';
import { AudioRecorder } from './recorder';

export interface AudioPlayerLike {
  play: (audio: ArrayBuffer, options?: PlayOptions) => Promise<void>;
  playStream?: (chunks: AsyncGenerator<ArrayBuffer>, options?: PlayOptions) => Promise<void>;
  stop: () => void;
  isPlaying: () => boolean;
}

export interface AudioRecorderLike {
  record: (options?: RecordOptions) => Promise<ArrayBuffer>;
  recordUntilSilence?: (options?: RecordOptions) => Promise<ArrayBuffer>;
  stop: () => void;
}

export interface VoiceManagerOptions {
  stt?: STTProvider;
  tts?: TTSProvider;
  player?: AudioPlayerLike;
  recorder?: AudioRecorderLike;
}

export class VoiceManager {
  private config: VoiceConfig;
  private stt: STTProvider;
  private tts: TTSProvider;
  private player: AudioPlayerLike;
  private recorder: AudioRecorderLike;
  private enabled: boolean;
  private isSpeaking = false;
  private isListening = false;
  private isTalking = false;
  private streamingStop: (() => void) | null = null;

  constructor(config: VoiceConfig, options: VoiceManagerOptions = {}) {
    this.config = config;
    this.enabled = config.enabled ?? false;
    this.player = options.player ?? new AudioPlayer();
    this.recorder = options.recorder ?? new AudioRecorder();
    this.stt = options.stt ?? this.createSttProvider();
    this.tts = options.tts ?? this.createTtsProvider();
  }

  enable(): void {
    this.enabled = true;
    this.config.enabled = true;
  }

  disable(): void {
    this.enabled = false;
    this.config.enabled = false;
    this.stopSpeaking();
    this.stopListening();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getAutoSend(): boolean {
    return this.config.autoSend !== false;
  }

  setAutoSend(enabled: boolean): void {
    this.config.autoSend = enabled;
  }

  getState(): VoiceState {
    return {
      enabled: this.enabled,
      isSpeaking: this.isSpeaking,
      isListening: this.isListening,
      isTalking: this.isTalking,
      sttProvider: this.config.stt.provider,
      ttsProvider: this.config.tts.provider,
    };
  }

  async speak(text: string): Promise<void> {
    if (!this.enabled) {
      throw new Error('Voice mode is disabled. Use /voice on to enable.');
    }
    const trimmed = text.trim();
    if (!trimmed) return;

    this.isSpeaking = true;
    try {
      if (this.tts.stream && this.player.playStream) {
        const format = (this.config.tts.provider === 'elevenlabs' || this.config.tts.provider === 'openai') ? 'mp3' : 'wav';
        await this.player.playStream(this.tts.stream(trimmed), { format });
      } else {
        const result = await this.tts.synthesize(trimmed);
        await this.player.play(result.audio, { format: result.format });
      }
    } finally {
      this.isSpeaking = false;
    }
  }

  async listen(options?: RecordOptions): Promise<string> {
    if (!this.enabled) {
      throw new Error('Voice mode is disabled. Use /voice on to enable.');
    }
    this.isListening = true;
    try {
      const audio = await this.recorder.record(options);
      const result = await this.stt.transcribe(audio);
      return result.text;
    } finally {
      this.isListening = false;
    }
  }

  /**
   * Start a continuous voice conversation loop.
   *
   * If the STT provider supports streaming (ElevenLabs), uses real-time WebSocket
   * transcription with live partial transcripts streamed to onPartialTranscript.
   * When VAD detects silence (autoSend=true), the committed transcript is sent.
   * If autoSend=false, waits for manual commit (user presses Enter).
   *
   * Falls back to batch record→transcribe for non-streaming providers (Whisper).
   */
  async talk(options: {
    onTranscript: (text: string) => void;
    onPartialTranscript?: (text: string) => void;
    onResponse: (text: string) => void;
    sendMessage: (text: string) => Promise<string>;
    /** Called when a committed transcript is ready but autoSend is off.
     *  Returns a promise that resolves when user confirms (e.g. presses Enter). */
    waitForConfirm?: (text: string) => Promise<boolean>;
  }): Promise<void> {
    // Reset any stale state from previous talk sessions
    this.stopSpeaking();
    this.stopListening();
    this.resetVoiceState();
    this.enable();
    this.isTalking = true;

    const useStreaming = this.stt.streamFromMic != null;
    const autoSend = this.getAutoSend();

    try {
      if (useStreaming) {
        await this.talkStreaming(options, autoSend);
      } else {
        await this.talkBatch(options);
      }
    } finally {
      this.stopSpeaking();
      this.stopListening();
      this.isTalking = false;
      this.streamingStop = null;
    }
  }

  /**
   * Streaming talk mode using real-time WebSocket STT.
   * Partial transcripts are streamed live. Committed transcripts trigger agent responses.
   */
  private async talkStreaming(
    options: {
      onTranscript: (text: string) => void;
      onPartialTranscript?: (text: string) => void;
      onResponse: (text: string) => void;
      sendMessage: (text: string) => Promise<string>;
      waitForConfirm?: (text: string) => Promise<boolean>;
    },
    autoSend: boolean,
  ): Promise<void> {
    while (this.isTalking) {
      try {
        // Wait for a committed transcript from the streaming STT
        const transcript = await this.streamOneTurn(options, autoSend);
        if (!transcript || !this.isTalking) break;

        // If autoSend is off, wait for user confirmation
        if (!autoSend && options.waitForConfirm) {
          const confirmed = await options.waitForConfirm(transcript);
          if (!confirmed || !this.isTalking) continue;
        }

        // Notify final transcript
        options.onTranscript(transcript);

        if (!this.isTalking) break;

        // Send to agent and get response
        const response = await options.sendMessage(transcript);

        if (!this.isTalking) break;

        options.onResponse(response);

        // Speak response aloud
        await this.speakResponse(response);
      } catch (err) {
        if (!this.isTalking) break;
        // Transient errors - continue the loop
      }
    }
  }

  /**
   * Stream one turn: start mic → receive partials → wait for committed transcript.
   * Returns the committed transcript text, or empty string if stopped.
   */
  private async streamOneTurn(
    options: {
      onPartialTranscript?: (text: string) => void;
    },
    autoSend: boolean,
  ): Promise<string> {
    this.isListening = true;

    return new Promise<string>(async (resolve) => {
      let resolved = false;
      const finish = (text: string) => {
        if (resolved) return;
        resolved = true;
        this.isListening = false;
        this.streamingStop = null;
        resolve(text);
      };

      try {
        const { stop } = await this.stt.streamFromMic!(
          {
            onPartial: (text) => {
              if (!this.isTalking) {
                stop();
                finish('');
                return;
              }
              options.onPartialTranscript?.(text);
            },
            onFinal: (text) => {
              if (autoSend && text.trim()) {
                stop();
                finish(text.trim());
              }
            },
            onDone: (fullText) => {
              finish(fullText.trim());
            },
          },
          {
            autoSend,
            silenceThreshold: 1.5,
          },
        );

        this.streamingStop = () => {
          stop();
          finish('');
        };
      } catch (err) {
        // Streaming not available - fall back to batch for this turn
        this.isListening = false;
        resolve('');
      }
    });
  }

  /**
   * Batch talk mode (record → transcribe → send → speak) for non-streaming providers.
   */
  private async talkBatch(options: {
    onTranscript: (text: string) => void;
    onResponse: (text: string) => void;
    sendMessage: (text: string) => Promise<string>;
  }): Promise<void> {
    while (this.isTalking) {
      try {
        // 1. Record until silence (VAD) or fall back to fixed duration
        this.isListening = true;
        let audio: ArrayBuffer;
        try {
          if (this.recorder.recordUntilSilence) {
            audio = await this.recorder.recordUntilSilence();
          } else {
            audio = await this.recorder.record({ durationSeconds: 5 });
          }
        } finally {
          this.isListening = false;
        }

        if (!this.isTalking) break;

        // 2. Transcribe
        const result = await this.stt.transcribe(audio);
        if (!result.text.trim()) continue;

        // 3. Notify transcript
        options.onTranscript(result.text);

        if (!this.isTalking) break;

        // 4. Send to agent and get response
        const response = await options.sendMessage(result.text);

        if (!this.isTalking) break;

        options.onResponse(response);

        // 5. Speak response aloud
        await this.speakResponse(response);
      } catch (err) {
        // If talk was stopped, break out cleanly
        if (!this.isTalking) break;
        // Transient errors - continue the loop
      }
    }
  }

  /**
   * Speak a response using TTS. Shared between streaming and batch talk modes.
   */
  private async speakResponse(text: string): Promise<void> {
    if (!text.trim() || !this.isTalking) return;
    this.isSpeaking = true;
    try {
      if (this.tts.stream && this.player.playStream) {
        const format = (this.config.tts.provider === 'elevenlabs' || this.config.tts.provider === 'openai') ? 'mp3' : 'wav';
        await this.player.playStream(this.tts.stream(text), { format });
      } else {
        const ttsResult = await this.tts.synthesize(text);
        await this.player.play(ttsResult.audio, { format: ttsResult.format });
      }
    } finally {
      this.isSpeaking = false;
    }
  }

  stopTalking(): void {
    this.isTalking = false;
    if (this.streamingStop) {
      this.streamingStop();
      this.streamingStop = null;
    }
    this.stopSpeaking();
    this.stopListening();
  }

  /**
   * Reset all voice state flags to allow a fresh talk/listen/speak session.
   * Called at the start of talk() to ensure no stale state from a previous session.
   */
  private resetVoiceState(): void {
    this.isSpeaking = false;
    this.isListening = false;
    this.isTalking = false;
    this.streamingStop = null;
  }

  stopSpeaking(): void {
    this.player.stop();
    this.isSpeaking = false;
  }

  stopListening(): void {
    if (this.streamingStop) {
      this.streamingStop();
      this.streamingStop = null;
    }
    this.recorder.stop();
    this.isListening = false;
  }

  private createSttProvider(): STTProvider {
    if (this.config.stt.provider === 'system') {
      return new SystemSTT();
    }
    if (this.config.stt.provider === 'elevenlabs') {
      return new ElevenLabsSTT({
        model: this.config.stt.model,
        language: this.config.stt.language,
      });
    }
    return new WhisperSTT({
      model: this.config.stt.model,
      language: this.config.stt.language,
    });
  }

  private createTtsProvider(): TTSProvider {
    if (this.config.tts.provider === 'system') {
      return new SystemTTS({
        voiceId: this.config.tts.voiceId,
        model: this.config.tts.model,
        stability: this.config.tts.stability,
        similarityBoost: this.config.tts.similarityBoost,
        speed: this.config.tts.speed,
      });
    }
    if (this.config.tts.provider === 'openai') {
      return new OpenAITTS({
        voiceId: this.config.tts.voiceId,
        model: this.config.tts.model,
        speed: this.config.tts.speed,
        instructions: this.config.tts.instructions,
      });
    }
    return new ElevenLabsTTS({
      voiceId: this.config.tts.voiceId,
      model: this.config.tts.model,
      stability: this.config.tts.stability,
      similarityBoost: this.config.tts.similarityBoost,
      speed: this.config.tts.speed,
    });
  }
}
