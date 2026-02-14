import { describe, expect, test, afterEach, beforeEach } from 'bun:test';
import { ElevenLabsTTS } from '../src/voice/tts';
import { WhisperSTT } from '../src/voice/stt';
import { VoiceManager } from '../src/voice/manager';
import type { STTProvider, TTSProvider } from '../src/voice/types';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const originalFetch = globalThis.fetch;
const originalHome = process.env.HOME;
let tempHome: string | null = null;

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), 'assistants-voice-test-'));
  process.env.HOME = tempHome;
  delete process.env.OPENAI_API_KEY;
  delete process.env.ELEVENLABS_API_KEY;
  delete process.env.ELEVENLABS_VOICE_ID;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.OPENAI_API_KEY;
  delete process.env.ELEVENLABS_API_KEY;
  delete process.env.ELEVENLABS_VOICE_ID;
  if (tempHome) {
    rmSync(tempHome, { recursive: true, force: true });
    tempHome = null;
  }
  process.env.HOME = originalHome;
});

describe('WhisperSTT', () => {
  test('throws when API key is missing', async () => {
    const stt = new WhisperSTT();
    await expect(stt.transcribe(new ArrayBuffer(1))).rejects.toThrow('OPENAI_API_KEY');
  });

  test('transcribes audio via API', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string> | undefined;
      expect(headers?.Authorization).toBe('Bearer test-key');
      return new Response(JSON.stringify({ text: 'hello', language: 'en' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const stt = new WhisperSTT();
    const result = await stt.transcribe(new ArrayBuffer(2));
    expect(result.text).toBe('hello');
    expect(result.language).toBe('en');
  });
});

describe('ElevenLabsTTS', () => {
  test('throws when API key is missing', async () => {
    const tts = new ElevenLabsTTS({ voiceId: 'voice' });
    await expect(tts.synthesize('hi')).rejects.toThrow('ELEVENLABS_API_KEY');
  });

  test('synthesizes audio via API', async () => {
    process.env.ELEVENLABS_API_KEY = 'el-key';
    const payload = new Uint8Array([1, 2, 3]).buffer;
    globalThis.fetch = (async (_input: RequestInfo | URL) => {
      return new Response(payload, { status: 200 });
    }) as typeof fetch;

    const tts = new ElevenLabsTTS({ voiceId: 'voice' });
    const result = await tts.synthesize('hello');
    expect(result.audio).toBeInstanceOf(ArrayBuffer);
    expect(result.format).toBe('mp3');
  });

  test('streams audio chunks', async () => {
    process.env.ELEVENLABS_API_KEY = 'el-key';
    const chunk = new Uint8Array([4, 5, 6]);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk);
        controller.close();
      },
    });

    globalThis.fetch = (async () => {
      return new Response(stream, { status: 200 });
    }) as typeof fetch;

    const tts = new ElevenLabsTTS({ voiceId: 'voice' });
    const generator = tts.stream('hello');
    const first = await generator.next();
    expect(first.done).toBe(false);
    expect(first.value).toBeInstanceOf(ArrayBuffer);
  });
});

describe('VoiceManager', () => {
  test('coordinates listen and speak with injected providers', async () => {
    const stt: STTProvider = {
      transcribe: async () => ({ text: 'transcribed', confidence: 1 }),
    };
    const tts: TTSProvider = {
      synthesize: async () => ({ audio: new ArrayBuffer(1), format: 'mp3' }),
    };
    const player = {
      play: async () => {},
      stop: () => {},
      isPlaying: () => false,
    };
    const recorder = {
      record: async () => new ArrayBuffer(1),
      stop: () => {},
    };

    const manager = new VoiceManager(
      {
        enabled: true,
        stt: { provider: 'whisper', model: 'whisper-1', language: 'en' },
        tts: { provider: 'elevenlabs', voiceId: 'voice' },
      },
      {
        stt,
        tts,
        player,
        recorder,
      }
    );

    const transcript = await manager.listen({ durationSeconds: 1 });
    expect(transcript).toBe('transcribed');
    await expect(manager.speak('hello')).resolves.toBeUndefined();
  });

  test('getState includes isTalking field', () => {
    const manager = new VoiceManager(
      {
        enabled: false,
        stt: { provider: 'whisper', model: 'whisper-1', language: 'en' },
        tts: { provider: 'elevenlabs', voiceId: 'voice' },
      },
      {
        stt: { transcribe: async () => ({ text: '', confidence: 0 }) },
        tts: { synthesize: async () => ({ audio: new ArrayBuffer(0), format: 'mp3' }) },
        player: { play: async () => {}, stop: () => {}, isPlaying: () => false },
        recorder: { record: async () => new ArrayBuffer(0), stop: () => {} },
      }
    );

    const state = manager.getState();
    expect(state.isTalking).toBe(false);
    expect(state.enabled).toBe(false);
    expect(state.isSpeaking).toBe(false);
    expect(state.isListening).toBe(false);
  });

  test('talk() loops through record→transcribe→send→speak and stops on stopTalking()', async () => {
    let recordCallCount = 0;
    let transcribeCallCount = 0;
    let speakCallCount = 0;
    const transcripts: string[] = [];
    const responses: string[] = [];

    const stt: STTProvider = {
      transcribe: async () => {
        transcribeCallCount++;
        return { text: `utterance ${transcribeCallCount}`, confidence: 1 };
      },
    };
    const tts: TTSProvider = {
      synthesize: async () => {
        speakCallCount++;
        return { audio: new ArrayBuffer(1), format: 'mp3' };
      },
    };
    const player = {
      play: async () => {},
      stop: () => {},
      isPlaying: () => false,
    };

    let managerRef: VoiceManager | null = null;
    const recorder = {
      record: async () => {
        recordCallCount++;
        return new ArrayBuffer(1);
      },
      recordUntilSilence: async () => {
        recordCallCount++;
        // On 3rd record attempt (after 2 complete iterations), stop
        if (recordCallCount > 2) {
          managerRef?.stopTalking();
          // Return empty audio that will produce empty transcript and be skipped,
          // then loop check sees isTalking=false and exits
        }
        return new ArrayBuffer(1);
      },
      stop: () => {},
    };

    const manager = new VoiceManager(
      {
        enabled: false,
        stt: { provider: 'whisper', model: 'whisper-1', language: 'en' },
        tts: { provider: 'elevenlabs', voiceId: 'voice' },
      },
      { stt, tts, player, recorder }
    );
    managerRef = manager;

    const talkPromise = manager.talk({
      onTranscript: (text) => { transcripts.push(text); },
      onResponse: (text) => { responses.push(text); },
      sendMessage: async (text) => {
        return `response to ${text}`;
      },
    });

    await talkPromise;

    expect(recordCallCount).toBeGreaterThanOrEqual(2);
    expect(transcribeCallCount).toBeGreaterThanOrEqual(2);
    expect(speakCallCount).toBeGreaterThanOrEqual(2);
    expect(transcripts[0]).toBe('utterance 1');
    expect(transcripts[1]).toBe('utterance 2');
    expect(responses[0]).toBe('response to utterance 1');
    expect(responses[1]).toBe('response to utterance 2');

    // After talk ends, state should be clean
    const state = manager.getState();
    expect(state.isTalking).toBe(false);
    expect(state.isListening).toBe(false);
    expect(state.isSpeaking).toBe(false);
    // talk() auto-enables voice
    expect(state.enabled).toBe(true);
  });

  test('talk() skips empty transcripts', async () => {
    let transcribeCount = 0;
    const transcripts: string[] = [];

    const stt: STTProvider = {
      transcribe: async () => {
        transcribeCount++;
        // First call: empty, second call: real text
        if (transcribeCount === 1) return { text: '  ', confidence: 0 };
        return { text: 'hello', confidence: 1 };
      },
    };
    const tts: TTSProvider = {
      synthesize: async () => ({ audio: new ArrayBuffer(1), format: 'mp3' }),
    };

    const manager = new VoiceManager(
      {
        enabled: false,
        stt: { provider: 'whisper', model: 'whisper-1', language: 'en' },
        tts: { provider: 'elevenlabs', voiceId: 'voice' },
      },
      {
        stt,
        tts,
        player: { play: async () => {}, stop: () => {}, isPlaying: () => false },
        recorder: {
          record: async () => new ArrayBuffer(1),
          recordUntilSilence: async () => new ArrayBuffer(1),
          stop: () => {},
        },
      }
    );

    const talkPromise = manager.talk({
      onTranscript: (text) => { transcripts.push(text); },
      onResponse: () => {},
      sendMessage: async (text) => {
        manager.stopTalking();
        return `response to ${text}`;
      },
    });

    await talkPromise;

    // Only "hello" should appear (empty was skipped)
    expect(transcripts).toEqual(['hello']);
    expect(transcribeCount).toBe(2);
  });

  test('talk() uses recordUntilSilence when available', async () => {
    let usedVad = false;
    let usedRegular = false;

    const manager = new VoiceManager(
      {
        enabled: false,
        stt: { provider: 'whisper', model: 'whisper-1', language: 'en' },
        tts: { provider: 'elevenlabs', voiceId: 'voice' },
      },
      {
        stt: { transcribe: async () => ({ text: 'test', confidence: 1 }) },
        tts: { synthesize: async () => ({ audio: new ArrayBuffer(1), format: 'mp3' }) },
        player: { play: async () => {}, stop: () => {}, isPlaying: () => false },
        recorder: {
          record: async () => { usedRegular = true; return new ArrayBuffer(1); },
          recordUntilSilence: async () => { usedVad = true; return new ArrayBuffer(1); },
          stop: () => {},
        },
      }
    );

    const talkPromise = manager.talk({
      onTranscript: () => {},
      onResponse: () => {},
      sendMessage: async () => { manager.stopTalking(); return 'ok'; },
    });

    await talkPromise;

    expect(usedVad).toBe(true);
    expect(usedRegular).toBe(false);
  });

  test('talk() falls back to record() when recordUntilSilence is not available', async () => {
    let usedRegular = false;

    const manager = new VoiceManager(
      {
        enabled: false,
        stt: { provider: 'whisper', model: 'whisper-1', language: 'en' },
        tts: { provider: 'elevenlabs', voiceId: 'voice' },
      },
      {
        stt: { transcribe: async () => ({ text: 'test', confidence: 1 }) },
        tts: { synthesize: async () => ({ audio: new ArrayBuffer(1), format: 'mp3' }) },
        player: { play: async () => {}, stop: () => {}, isPlaying: () => false },
        recorder: {
          record: async () => { usedRegular = true; return new ArrayBuffer(1); },
          // No recordUntilSilence
          stop: () => {},
        },
      }
    );

    const talkPromise = manager.talk({
      onTranscript: () => {},
      onResponse: () => {},
      sendMessage: async () => { manager.stopTalking(); return 'ok'; },
    });

    await talkPromise;

    expect(usedRegular).toBe(true);
  });

  test('stopTalking() cleans up all state', async () => {
    const manager = new VoiceManager(
      {
        enabled: false,
        stt: { provider: 'whisper', model: 'whisper-1', language: 'en' },
        tts: { provider: 'elevenlabs', voiceId: 'voice' },
      },
      {
        stt: { transcribe: async () => ({ text: 'test', confidence: 1 }) },
        tts: { synthesize: async () => ({ audio: new ArrayBuffer(1), format: 'mp3' }) },
        player: { play: async () => {}, stop: () => {}, isPlaying: () => false },
        recorder: {
          record: async () => new ArrayBuffer(1),
          recordUntilSilence: async () => new ArrayBuffer(1),
          stop: () => {},
        },
      }
    );

    // Start talk and immediately stop
    const talkPromise = manager.talk({
      onTranscript: () => {},
      onResponse: () => {},
      sendMessage: async () => { manager.stopTalking(); return 'ok'; },
    });

    await talkPromise;

    const state = manager.getState();
    expect(state.isTalking).toBe(false);
    expect(state.isListening).toBe(false);
    expect(state.isSpeaking).toBe(false);
  });

  test('talk() uses streaming TTS when available', async () => {
    let usedStream = false;
    let usedSynthesize = false;
    let managerRef: VoiceManager | null = null;
    let recordCount = 0;

    const manager = new VoiceManager(
      {
        enabled: false,
        stt: { provider: 'whisper', model: 'whisper-1', language: 'en' },
        tts: { provider: 'elevenlabs', voiceId: 'voice' },
      },
      {
        stt: { transcribe: async () => ({ text: 'test', confidence: 1 }) },
        tts: {
          synthesize: async () => { usedSynthesize = true; return { audio: new ArrayBuffer(1), format: 'mp3' as const }; },
          stream: async function* () { usedStream = true; yield new ArrayBuffer(1); },
        },
        player: {
          play: async () => {},
          playStream: async (chunks: AsyncGenerator<ArrayBuffer>) => {
            // Consume the generator like the real player does
            for await (const _chunk of chunks) { /* drain */ }
          },
          stop: () => {},
          isPlaying: () => false,
        },
        recorder: {
          record: async () => new ArrayBuffer(1),
          recordUntilSilence: async () => {
            recordCount++;
            // Stop after first complete iteration (which includes TTS)
            if (recordCount > 1) {
              managerRef?.stopTalking();
            }
            return new ArrayBuffer(1);
          },
          stop: () => {},
        },
      }
    );
    managerRef = manager;

    const talkPromise = manager.talk({
      onTranscript: () => {},
      onResponse: () => {},
      sendMessage: async () => 'ok',
    });

    await talkPromise;

    expect(usedStream).toBe(true);
    expect(usedSynthesize).toBe(false);
  });
});
