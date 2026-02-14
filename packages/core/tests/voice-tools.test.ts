import { describe, expect, test, mock, beforeEach } from 'bun:test';
import type { VoiceState } from '../src/voice/types';
import type { VoiceManager } from '../src/voice/manager';
import {
  voiceTools,
  voiceEnableTool,
  voiceDisableTool,
  voiceStatusTool,
  voiceSayTool,
  voiceListenTool,
  voiceStopTool,
  createVoiceToolExecutors,
  registerVoiceTools,
} from '../src/tools/voice';
import { ToolRegistry } from '../src/tools/registry';

// Mock VoiceManager
function createMockVoiceManager(state: Partial<VoiceState> = {}): VoiceManager {
  const defaultState: VoiceState = {
    enabled: true,
    isSpeaking: false,
    isListening: false,
    sttProvider: 'whisper',
    ttsProvider: 'elevenlabs',
    ...state,
  };

  let currentState = { ...defaultState };

  return {
    enable: mock(() => {
      currentState.enabled = true;
    }),
    disable: mock(() => {
      currentState.enabled = false;
      currentState.isSpeaking = false;
      currentState.isListening = false;
    }),
    isEnabled: mock(() => currentState.enabled),
    getState: mock(() => ({ ...currentState })),
    speak: mock(async (text: string) => {
      if (!currentState.enabled) {
        throw new Error('Voice mode is disabled. Use /voice on to enable.');
      }
      currentState.isSpeaking = true;
      // Simulate speaking
      await new Promise(resolve => setTimeout(resolve, 10));
      currentState.isSpeaking = false;
    }),
    listen: mock(async () => {
      if (!currentState.enabled) {
        throw new Error('Voice mode is disabled. Use /voice on to enable.');
      }
      currentState.isListening = true;
      // Simulate listening
      await new Promise(resolve => setTimeout(resolve, 10));
      currentState.isListening = false;
      return 'Hello, this is a test transcription';
    }),
    stopTalking: mock(() => {
      currentState.isSpeaking = false;
    }),
    stopSpeaking: mock(() => {
      currentState.isSpeaking = false;
    }),
    stopListening: mock(() => {
      currentState.isListening = false;
    }),
  } as unknown as VoiceManager;
}

describe('voice tools definitions', () => {
  test('voiceTools array contains all 7 tools', () => {
    expect(voiceTools.length).toBe(7);
    const names = voiceTools.map(t => t.name);
    expect(names).toContain('voice_enable');
    expect(names).toContain('voice_disable');
    expect(names).toContain('voice_status');
    expect(names).toContain('voice_say');
    expect(names).toContain('voice_listen');
    expect(names).toContain('voice_stop');
    expect(names).toContain('voice_talk');
  });

  test('voice_enable tool has correct definition', () => {
    expect(voiceEnableTool.name).toBe('voice_enable');
    expect(voiceEnableTool.description).toContain('Enable voice mode');
    expect(voiceEnableTool.parameters.type).toBe('object');
  });

  test('voice_disable tool has correct definition', () => {
    expect(voiceDisableTool.name).toBe('voice_disable');
    expect(voiceDisableTool.description).toContain('Disable voice mode');
  });

  test('voice_status tool has correct definition', () => {
    expect(voiceStatusTool.name).toBe('voice_status');
    expect(voiceStatusTool.description).toContain('status');
  });

  test('voice_say tool has correct definition', () => {
    expect(voiceSayTool.name).toBe('voice_say');
    expect(voiceSayTool.description).toContain('Speak text');
    expect(voiceSayTool.parameters.required).toContain('text');
  });

  test('voice_listen tool has correct definition', () => {
    expect(voiceListenTool.name).toBe('voice_listen');
    expect(voiceListenTool.description).toContain('transcribe');
    expect(voiceListenTool.parameters.properties.durationSeconds).toBeDefined();
  });

  test('voice_stop tool has correct definition', () => {
    expect(voiceStopTool.name).toBe('voice_stop');
    expect(voiceStopTool.description).toContain('Stop');
    expect(voiceStopTool.parameters.properties.action).toBeDefined();
  });
});

describe('voice_enable executor', () => {
  test('returns error when voice manager not available', async () => {
    const executors = createVoiceToolExecutors({
      getVoiceManager: () => null,
    });

    const result = await executors.voice_enable({});
    const parsed = JSON.parse(result);

    expect(parsed.error).toBeDefined();
    expect(parsed.error).toContain('not available');
  });

  test('enables voice mode successfully', async () => {
    const manager = createMockVoiceManager({ enabled: false });
    const executors = createVoiceToolExecutors({
      getVoiceManager: () => manager,
    });

    const result = await executors.voice_enable({});
    const parsed = JSON.parse(result);

    expect(parsed.success).toBe(true);
    expect(parsed.message).toContain('enabled');
    expect(manager.enable).toHaveBeenCalled();
  });
});

describe('voice_disable executor', () => {
  test('returns error when voice manager not available', async () => {
    const executors = createVoiceToolExecutors({
      getVoiceManager: () => null,
    });

    const result = await executors.voice_disable({});
    const parsed = JSON.parse(result);

    expect(parsed.error).toBeDefined();
  });

  test('disables voice mode successfully', async () => {
    const manager = createMockVoiceManager({ enabled: true });
    const executors = createVoiceToolExecutors({
      getVoiceManager: () => manager,
    });

    const result = await executors.voice_disable({});
    const parsed = JSON.parse(result);

    expect(parsed.success).toBe(true);
    expect(parsed.message).toContain('disabled');
    expect(manager.disable).toHaveBeenCalled();
  });
});

describe('voice_status executor', () => {
  test('returns error when voice manager not available', async () => {
    const executors = createVoiceToolExecutors({
      getVoiceManager: () => null,
    });

    const result = await executors.voice_status({});
    const parsed = JSON.parse(result);

    expect(parsed.available).toBe(false);
    expect(parsed.error).toBeDefined();
  });

  test('returns full status when available', async () => {
    const manager = createMockVoiceManager({
      enabled: true,
      isSpeaking: false,
      isListening: false,
      sttProvider: 'whisper',
      ttsProvider: 'elevenlabs',
    });
    const executors = createVoiceToolExecutors({
      getVoiceManager: () => manager,
    });

    const result = await executors.voice_status({});
    const parsed = JSON.parse(result);

    expect(parsed.available).toBe(true);
    expect(parsed.enabled).toBe(true);
    expect(parsed.isSpeaking).toBe(false);
    expect(parsed.isListening).toBe(false);
    expect(parsed.providers.stt).toBe('whisper');
    expect(parsed.providers.tts).toBe('elevenlabs');
  });
});

describe('voice_say executor', () => {
  test('returns error when voice manager not available', async () => {
    const executors = createVoiceToolExecutors({
      getVoiceManager: () => null,
    });

    const result = await executors.voice_say({ text: 'Hello' });
    const parsed = JSON.parse(result);

    expect(parsed.error).toBeDefined();
  });

  test('returns error when text is missing', async () => {
    const manager = createMockVoiceManager();
    const executors = createVoiceToolExecutors({
      getVoiceManager: () => manager,
    });

    const result = await executors.voice_say({});
    const parsed = JSON.parse(result);

    expect(parsed.error).toContain('Missing required parameter');
  });

  test('speaks text successfully', async () => {
    const manager = createMockVoiceManager();
    const executors = createVoiceToolExecutors({
      getVoiceManager: () => manager,
    });

    const result = await executors.voice_say({ text: 'Hello world!' });
    const parsed = JSON.parse(result);

    expect(parsed.success).toBe(true);
    expect(parsed.textLength).toBe(12);
    expect(manager.speak).toHaveBeenCalledWith('Hello world!');
  });

  test('returns error when voice mode disabled', async () => {
    const manager = createMockVoiceManager({ enabled: false });
    const executors = createVoiceToolExecutors({
      getVoiceManager: () => manager,
    });

    const result = await executors.voice_say({ text: 'Hello' });
    const parsed = JSON.parse(result);

    expect(parsed.error).toBeDefined();
    expect(parsed.suggestion).toContain('voice_enable');
  });
});

describe('voice_listen executor', () => {
  test('returns error when voice manager not available', async () => {
    const executors = createVoiceToolExecutors({
      getVoiceManager: () => null,
    });

    const result = await executors.voice_listen({});
    const parsed = JSON.parse(result);

    expect(parsed.error).toBeDefined();
  });

  test('listens and returns transcription', async () => {
    const manager = createMockVoiceManager();
    const executors = createVoiceToolExecutors({
      getVoiceManager: () => manager,
    });

    const result = await executors.voice_listen({});
    const parsed = JSON.parse(result);

    expect(parsed.success).toBe(true);
    expect(parsed.text).toBe('Hello, this is a test transcription');
    expect(parsed.empty).toBe(false);
    expect(manager.listen).toHaveBeenCalled();
  });

  test('passes duration parameter', async () => {
    const manager = createMockVoiceManager();
    const executors = createVoiceToolExecutors({
      getVoiceManager: () => manager,
    });

    await executors.voice_listen({ durationSeconds: 10 });

    expect(manager.listen).toHaveBeenCalledWith({ durationSeconds: 10 });
  });

  test('returns error when voice mode disabled', async () => {
    const manager = createMockVoiceManager({ enabled: false });
    const executors = createVoiceToolExecutors({
      getVoiceManager: () => manager,
    });

    const result = await executors.voice_listen({});
    const parsed = JSON.parse(result);

    expect(parsed.error).toBeDefined();
    expect(parsed.suggestion).toContain('voice_enable');
  });
});

describe('voice_stop executor', () => {
  test('returns error when voice manager not available', async () => {
    const executors = createVoiceToolExecutors({
      getVoiceManager: () => null,
    });

    const result = await executors.voice_stop({});
    const parsed = JSON.parse(result);

    expect(parsed.error).toBeDefined();
  });

  test('stops all by default', async () => {
    const manager = createMockVoiceManager({ isSpeaking: true, isListening: true });
    const executors = createVoiceToolExecutors({
      getVoiceManager: () => manager,
    });

    const result = await executors.voice_stop({});
    const parsed = JSON.parse(result);

    expect(parsed.success).toBe(true);
    expect(parsed.stopped).toContain('talking');
    expect(parsed.stopped).toContain('speaking');
    expect(parsed.stopped).toContain('listening');
    expect(manager.stopTalking).toHaveBeenCalled();
    expect(manager.stopSpeaking).toHaveBeenCalled();
    expect(manager.stopListening).toHaveBeenCalled();
  });

  test('stops only speaking when specified', async () => {
    const manager = createMockVoiceManager({ isSpeaking: true });
    const executors = createVoiceToolExecutors({
      getVoiceManager: () => manager,
    });

    const result = await executors.voice_stop({ action: 'speaking' });
    const parsed = JSON.parse(result);

    expect(parsed.success).toBe(true);
    expect(parsed.stopped).toContain('speaking');
    expect(parsed.stopped).not.toContain('listening');
  });

  test('stops only listening when specified', async () => {
    const manager = createMockVoiceManager({ isListening: true });
    const executors = createVoiceToolExecutors({
      getVoiceManager: () => manager,
    });

    const result = await executors.voice_stop({ action: 'listening' });
    const parsed = JSON.parse(result);

    expect(parsed.success).toBe(true);
    expect(parsed.stopped).toContain('listening');
    expect(parsed.stopped).not.toContain('speaking');
  });
});

describe('registerVoiceTools', () => {
  test('registers all voice tools to registry', () => {
    const registry = new ToolRegistry();
    const manager = createMockVoiceManager();

    registerVoiceTools(registry, {
      getVoiceManager: () => manager,
    });

    const tools = registry.getTools();
    const toolNames = tools.map(t => t.name);

    expect(toolNames).toContain('voice_enable');
    expect(toolNames).toContain('voice_disable');
    expect(toolNames).toContain('voice_status');
    expect(toolNames).toContain('voice_say');
    expect(toolNames).toContain('voice_listen');
    expect(toolNames).toContain('voice_stop');
  });
});
