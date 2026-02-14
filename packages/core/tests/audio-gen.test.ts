import { describe, expect, test } from 'bun:test';
import { AudioTools } from '../src/tools/audio';

describe('AudioTools generate_audio', () => {
  describe('tool definition', () => {
    test('should have correct name', () => {
      expect(AudioTools.generateAudioTool.name).toBe('generate_audio');
    });

    test('should have description mentioning speech generation', () => {
      expect(AudioTools.generateAudioTool.description).toContain('speech');
      expect(AudioTools.generateAudioTool.description).toContain('OpenAI');
    });

    test('should require text parameter', () => {
      expect(AudioTools.generateAudioTool.parameters.required).toContain('text');
    });

    test('should have voice parameter with all options', () => {
      const voiceProp = AudioTools.generateAudioTool.parameters.properties.voice;
      expect(voiceProp).toBeDefined();
      expect(voiceProp.enum).toContain('nova');
      expect(voiceProp.enum).toContain('alloy');
      expect(voiceProp.enum).toContain('echo');
      expect(voiceProp.enum).toContain('shimmer');
    });

    test('should have model parameter', () => {
      const modelProp = AudioTools.generateAudioTool.parameters.properties.model;
      expect(modelProp).toBeDefined();
      expect(modelProp.enum).toContain('gpt-4o-mini-tts');
      expect(modelProp.enum).toContain('tts-1');
      expect(modelProp.enum).toContain('tts-1-hd');
    });

    test('should have speed parameter', () => {
      const speedProp = AudioTools.generateAudioTool.parameters.properties.speed;
      expect(speedProp).toBeDefined();
      expect(speedProp.type).toBe('number');
    });

    test('should have instructions parameter', () => {
      const instrProp = AudioTools.generateAudioTool.parameters.properties.instructions;
      expect(instrProp).toBeDefined();
      expect(instrProp.type).toBe('string');
    });
  });

  describe('executor', () => {
    test('should throw when text is missing', async () => {
      await expect(
        AudioTools.generateAudioExecutor({})
      ).rejects.toThrow('Text is required');
    });

    test('should throw when OPENAI_API_KEY is not set', async () => {
      const originalKey = process.env.OPENAI_API_KEY;
      delete process.env.OPENAI_API_KEY;
      try {
        await expect(
          AudioTools.generateAudioExecutor({ text: 'hello' })
        ).rejects.toThrow('OPENAI_API_KEY');
      } finally {
        if (originalKey) process.env.OPENAI_API_KEY = originalKey;
      }
    });
  });

  describe('registerAll', () => {
    test('should register both read_audio and generate_audio tools', () => {
      const registered: string[] = [];
      const mockRegistry = {
        register: (tool: any, _executor: any) => {
          registered.push(tool.name);
        },
      };
      AudioTools.registerAll(mockRegistry as any);
      expect(registered).toContain('read_audio');
      expect(registered).toContain('generate_audio');
    });
  });
});
