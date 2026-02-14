import { existsSync, writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join, basename } from 'path';
import type { Tool } from '@hasna/assistants-shared';
import type { ToolExecutor } from './registry';
import { generateId } from '@hasna/assistants-shared';
import { isPrivateHostOrResolved } from '../security/network-validator';
import { fetchWithTimeout } from '../utils/fetch-with-timeout';
import { ErrorCodes, ToolExecutionError } from '../errors';

// Security limits for image fetching
const FETCH_TIMEOUT_MS = 30_000; // 30 seconds
const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

/**
 * ImageDisplay tool - display images in the terminal
 *
 * Returns a structured JSON result with the image path so the terminal UI
 * can render it inline using ink-picture (supports Kitty, iTerm2, Sixel, ASCII).
 */
export class ImageDisplayTool {
  static readonly tool: Tool = {
    name: 'display_image',
    description: 'Display an image in the terminal. Works with local files and URLs. Supports PNG, JPG, GIF, BMP, WebP, and other common formats. The image renders inline using the best available terminal graphics protocol.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the image file or URL to fetch',
        },
        width: {
          type: 'number',
          description: 'Width in characters (optional, defaults to 60)',
        },
        height: {
          type: 'number',
          description: 'Height in characters (optional, defaults to 20)',
        },
      },
      required: ['path'],
    },
  };

  static readonly executor: ToolExecutor = async (input) => {
    const imagePath = input.path as string;
    const width = input.width as number | undefined;
    const height = input.height as number | undefined;

    let localPath = imagePath;

    // If it's a URL, download to temp file
    if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
      try {
        // SSRF protection: block private/internal network addresses
        const url = new URL(imagePath);
        if (await isPrivateHostOrResolved(url.hostname)) {
          return 'Error: Cannot fetch from local/private network addresses for security reasons';
        }

        // Fetch with timeout
        const response = await fetchWithTimeout(imagePath, {
          timeout: FETCH_TIMEOUT_MS,
        });

        if (!response.ok) {
          return `Error: Failed to fetch image: HTTP ${response.status}`;
        }

        const contentType = response.headers.get('content-type') || '';
        if (!contentType.startsWith('image/')) {
          return `Error: URL does not point to an image (content-type: ${contentType})`;
        }

        // Check Content-Length if available
        const contentLength = response.headers.get('content-length');
        if (contentLength) {
          const size = parseInt(contentLength, 10);
          if (!isNaN(size) && size > MAX_IMAGE_SIZE_BYTES) {
            return `Error: Image too large (${Math.round(size / 1024 / 1024)}MB exceeds ${MAX_IMAGE_SIZE_BYTES / 1024 / 1024}MB limit)`;
          }
        }

        // Stream the response and enforce size limit
        const chunks: Uint8Array[] = [];
        let totalSize = 0;
        const reader = response.body?.getReader();

        if (!reader) {
          return 'Error: Failed to read image response';
        }

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            totalSize += value.length;
            if (totalSize > MAX_IMAGE_SIZE_BYTES) {
              return `Error: Image too large (exceeds ${MAX_IMAGE_SIZE_BYTES / 1024 / 1024}MB limit)`;
            }
            chunks.push(value);
          }
        } finally {
          reader.releaseLock();
        }

        const buffer = new Uint8Array(totalSize);
        let offset = 0;
        for (const chunk of chunks) {
          buffer.set(chunk, offset);
          offset += chunk.length;
        }

        const ext = contentType.split('/')[1]?.split(';')[0] || 'png';
        const tempFile = join(tmpdir(), `assistants-image-${generateId()}.${ext}`);
        writeFileSync(tempFile, buffer);
        localPath = tempFile;
      } catch (error) {
        // fetchWithTimeout wraps AbortError in a ToolExecutionError with TOOL_TIMEOUT code
        if (error instanceof ToolExecutionError && error.code === ErrorCodes.TOOL_TIMEOUT) {
          return `Error: Image fetch timed out after ${FETCH_TIMEOUT_MS / 1000} seconds`;
        }
        if (error instanceof Error && error.name === 'AbortError') {
          return `Error: Image fetch timed out after ${FETCH_TIMEOUT_MS / 1000} seconds`;
        }
        return `Error: Failed to fetch image: ${error instanceof Error ? error.message : String(error)}`;
      }
    }

    // Check if local file exists
    if (!existsSync(localPath)) {
      return `Error: Image file not found: ${localPath}`;
    }

    // Return structured JSON so the terminal UI can render it with ink-picture
    return JSON.stringify({
      displayed: true,
      path: localPath,
      alt: basename(imagePath),
      ...(width ? { width } : {}),
      ...(height ? { height } : {}),
    });
  };
}

/**
 * ImageGenerate tool - generate images using OpenAI gpt-image models
 *
 * Uses the OpenAI Images API to generate images from text prompts.
 * Returns a structured JSON result with the image path for terminal display.
 */
export class ImageGenerateTool {
  static readonly tool: Tool = {
    name: 'generate_image',
    description:
      'Generate an image from a text description using AI (OpenAI gpt-image). ' +
      'Returns the generated image for display. Requires OPENAI_API_KEY.',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'Text description of the desired image',
        },
        model: {
          type: 'string',
          description: 'Image model to use (default: gpt-image-1)',
          enum: ['gpt-image-1'],
        },
        size: {
          type: 'string',
          description: 'Image size (default: 1024x1024)',
          enum: ['1024x1024', '1024x1536', '1536x1024'],
        },
        quality: {
          type: 'string',
          description: 'Image quality (default: medium)',
          enum: ['low', 'medium', 'high'],
        },
        output_format: {
          type: 'string',
          description: 'Output format (default: png)',
          enum: ['png', 'jpeg', 'webp'],
        },
      },
      required: ['prompt'],
    },
  };

  static readonly executor: ToolExecutor = async (input) => {
    const prompt = input.prompt as string;
    const model = (input.model as string) || 'gpt-image-1';
    const size = (input.size as string) || '1024x1024';
    const quality = (input.quality as string) || 'medium';
    const outputFormat = (input.output_format as string) || 'png';

    if (!prompt || typeof prompt !== 'string') {
      return 'Error: prompt is required';
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return 'Error: OPENAI_API_KEY is required for image generation. Set it in env or ~/.secrets.';
    }

    try {
      const response = await fetchWithTimeout('https://api.openai.com/v1/images/generations', {
        timeout: 120_000, // 2 min - image gen can be slow
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          prompt,
          n: 1,
          size,
          quality,
          output_format: outputFormat,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return `Error: Image generation failed (${response.status}): ${errorText || response.statusText}`;
      }

      const result = (await response.json()) as {
        data?: Array<{ b64_json?: string; url?: string }>;
      };

      const imageData = result.data?.[0];
      if (!imageData) {
        return 'Error: No image returned from API';
      }

      if (imageData.b64_json) {
        // Save base64 image to temp file
        const buffer = Buffer.from(imageData.b64_json, 'base64');
        const tempFile = join(tmpdir(), `assistants-imagegen-${generateId()}.${outputFormat}`);
        writeFileSync(tempFile, buffer);

        return JSON.stringify({
          generated: true,
          path: tempFile,
          alt: prompt.slice(0, 100),
          model,
          size,
          quality,
        });
      }

      if (imageData.url) {
        return JSON.stringify({
          generated: true,
          url: imageData.url,
          alt: prompt.slice(0, 100),
          model,
          size,
          quality,
        });
      }

      return 'Error: Unexpected API response format';
    } catch (error) {
      if (error instanceof ToolExecutionError && error.code === ErrorCodes.TOOL_TIMEOUT) {
        return 'Error: Image generation timed out after 120 seconds';
      }
      return `Error: Image generation failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  };
}

/**
 * Image tools collection
 */
export class ImageTools {
  static registerAll(registry: { register: (tool: Tool, executor: ToolExecutor) => void }): void {
    registry.register(ImageDisplayTool.tool, ImageDisplayTool.executor);
    registry.register(ImageGenerateTool.tool, ImageGenerateTool.executor);
  }
}

export const __test__ = {
  FETCH_TIMEOUT_MS,
  MAX_IMAGE_SIZE_BYTES,
};
