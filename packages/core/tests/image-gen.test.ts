import { describe, expect, test } from 'bun:test';
import { ImageGenerateTool, ImageTools } from '../src/tools/image';

describe('ImageGenerateTool', () => {
  describe('tool definition', () => {
    test('should have correct name', () => {
      expect(ImageGenerateTool.tool.name).toBe('generate_image');
    });

    test('should have description mentioning image generation', () => {
      expect(ImageGenerateTool.tool.description).toContain('Generate');
      expect(ImageGenerateTool.tool.description).toContain('image');
    });

    test('should require prompt parameter', () => {
      expect(ImageGenerateTool.tool.parameters.required).toContain('prompt');
    });

    test('should have model parameter with enum', () => {
      const modelProp = ImageGenerateTool.tool.parameters.properties.model;
      expect(modelProp).toBeDefined();
      expect(modelProp.enum).toContain('gpt-image-1');
    });

    test('should have size parameter with valid sizes', () => {
      const sizeProp = ImageGenerateTool.tool.parameters.properties.size;
      expect(sizeProp).toBeDefined();
      expect(sizeProp.enum).toContain('1024x1024');
      expect(sizeProp.enum).toContain('1024x1536');
      expect(sizeProp.enum).toContain('1536x1024');
    });

    test('should have quality parameter', () => {
      const qualityProp = ImageGenerateTool.tool.parameters.properties.quality;
      expect(qualityProp).toBeDefined();
      expect(qualityProp.enum).toContain('low');
      expect(qualityProp.enum).toContain('medium');
      expect(qualityProp.enum).toContain('high');
    });

    test('should have output_format parameter', () => {
      const formatProp = ImageGenerateTool.tool.parameters.properties.output_format;
      expect(formatProp).toBeDefined();
      expect(formatProp.enum).toContain('png');
      expect(formatProp.enum).toContain('jpeg');
      expect(formatProp.enum).toContain('webp');
    });
  });

  describe('executor', () => {
    test('should return error when prompt is missing', async () => {
      const result = await ImageGenerateTool.executor({});
      expect(result).toContain('Error');
      expect(result).toContain('prompt');
    });

    test('should return error when OPENAI_API_KEY is not set', async () => {
      const originalKey = process.env.OPENAI_API_KEY;
      delete process.env.OPENAI_API_KEY;
      try {
        const result = await ImageGenerateTool.executor({ prompt: 'a cat' });
        expect(result).toContain('OPENAI_API_KEY');
      } finally {
        if (originalKey) process.env.OPENAI_API_KEY = originalKey;
      }
    });
  });

  describe('registerAll', () => {
    test('should register both display_image and generate_image tools', () => {
      const registered: string[] = [];
      const mockRegistry = {
        register: (tool: any, _executor: any) => {
          registered.push(tool.name);
        },
      };
      ImageTools.registerAll(mockRegistry);
      expect(registered).toContain('display_image');
      expect(registered).toContain('generate_image');
    });
  });
});
