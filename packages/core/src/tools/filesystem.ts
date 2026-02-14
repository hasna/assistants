import type { Tool } from '@hasna/assistants-shared';
import type { ToolExecutor, ToolRegistry } from './registry';
import { join, resolve, dirname, sep } from 'path';
import { homedir } from 'os';
import { mkdir } from 'fs/promises';
import { getProjectDataDir } from '../config';
import { getRuntime } from '../runtime';
import { ErrorCodes, ToolExecutionError } from '../errors';
import { validatePath } from '../validation/paths';
import { exceedsFileReadLimit, getLimits } from '../validation/limits';
import { getSecurityLogger } from '../security/logger';
import { isPathSafe } from '../security/path-validator';

// Session ID for temp folder (set during registration)
let currentSessionId: string = 'default';

/**
 * Get the scripts folder path for the current session
 */
function getScriptsFolder(cwd: string, sessionId?: string): string {
  const resolvedSessionId = sessionId || currentSessionId;
  return join(getProjectDataDir(cwd), 'scripts', resolvedSessionId);
}

/**
 * Check if a path is within the allowed scripts folder
 */
function isInScriptsFolder(path: string, cwd: string, sessionId?: string): boolean {
  const scriptsFolder = resolve(getScriptsFolder(cwd, sessionId));
  const resolved = resolve(path);
  if (resolved === scriptsFolder) return true;
  return resolved.startsWith(`${scriptsFolder}${sep}`);
}

/**
 * Filesystem tools - read, write, glob, grep
 * Write operations are RESTRICTED to the project scripts folder (.assistants-data/scripts/{session-id}/)
 */
export class FilesystemTools {
  private static resolveInputPath(baseCwd: string, inputPath: string): string {
    const envHome = process.env.HOME || process.env.USERPROFILE;
    const home = envHome && envHome.trim().length > 0 ? envHome : homedir();
    if (inputPath === '~') {
      return home;
    }
    if (inputPath.startsWith('~/')) {
      return resolve(home, inputPath.slice(2));
    }
    return resolve(baseCwd, inputPath);
  }
  /**
   * Register all filesystem tools with session context
   */
  static registerAll(registry: ToolRegistry, sessionId?: string): void {
    if (sessionId) {
      currentSessionId = sessionId;
    }
    registry.register(this.readTool, this.readExecutor);
    registry.register(this.writeTool, this.writeExecutor);
    registry.register(this.globTool, this.globExecutor);
    registry.register(this.grepTool, this.grepExecutor);
    registry.register(this.readPdfTool, this.readPdfExecutor);
  }

  /**
   * Set the session ID for temp folder
   */
  static setSessionId(sessionId: string): void {
    currentSessionId = sessionId;
  }

  // ============================================
  // Read Tool
  // ============================================

  // Image extensions that can be sent to the LLM for analysis
  private static readonly IMAGE_EXTENSIONS = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp',
  ]);

  // Maximum image size for LLM analysis (20MB - Anthropic limit)
  private static readonly MAX_IMAGE_SIZE = 20 * 1024 * 1024;

  // Map file extensions to MIME types
  private static readonly IMAGE_MIME_TYPES: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
  };

  static readonly readTool: Tool = {
    name: 'read',
    description: 'Read the contents of a file. For images (png, jpg, gif, webp, bmp), the file is sent to the LLM for visual analysis. For PDFs, the file is attached as a document. For all other files, returns text content with line numbers.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'The file path to read (absolute or relative to cwd)',
        },
        cwd: {
          type: 'string',
          description: 'Base working directory for relative paths (optional)',
        },
        offset: {
          type: 'number',
          description: 'Line number to start reading from (1-indexed)',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of lines to read',
        },
      },
      required: ['path'],
    },
  };

  static readonly readExecutor: ToolExecutor = async (input) => {
    const baseCwd = (input.cwd as string) || process.cwd();
    const rawPath = String(input.path || '').trim();
    if (!rawPath) {
      throw new ToolExecutionError('File path is required', {
        toolName: 'read',
        toolInput: input,
        code: ErrorCodes.VALIDATION_OUT_OF_RANGE,
        recoverable: false,
        retryable: false,
        suggestion: 'Provide a valid file path.',
      });
    }
    const path = FilesystemTools.resolveInputPath(baseCwd, rawPath);
    const offset = ((input.offset as number) || 1) - 1;
    const limitRaw = input.limit as number | undefined;
    const limit = typeof limitRaw === 'number' && limitRaw > 0 ? Math.floor(limitRaw) : undefined;

    try {
      const safety = await isPathSafe(path, 'read', { cwd: baseCwd });
      if (!safety.safe) {
        getSecurityLogger().log({
          eventType: 'path_violation',
          severity: 'high',
          details: {
            tool: 'read',
            path,
            reason: safety.reason || 'Blocked path',
          },
          sessionId: (input.sessionId as string) || 'unknown',
        });
        throw new ToolExecutionError(safety.reason || 'Blocked path', {
          toolName: 'read',
          toolInput: input,
          code: ErrorCodes.TOOL_PERMISSION_DENIED,
          recoverable: false,
          retryable: false,
        });
      }

      const validated = await validatePath(path, { allowSymlinks: true });
      if (!validated.valid) {
        throw new ToolExecutionError(validated.error || 'Invalid path', {
          toolName: 'read',
          toolInput: input,
          code: ErrorCodes.VALIDATION_OUT_OF_RANGE,
          recoverable: false,
          retryable: false,
          suggestion: 'Provide a valid file path.',
        });
      }

      const runtime = getRuntime();
      const file = runtime.file(validated.resolved);
      if (!(await file.exists())) {
        throw new ToolExecutionError(`File not found: ${path}`, {
          toolName: 'read',
          toolInput: input,
          code: ErrorCodes.TOOL_EXECUTION_FAILED,
          recoverable: false,
          retryable: false,
          suggestion: 'Check the file path and try again.',
        });
      }

      // Auto-detect file type by extension
      const ext = '.' + path.split('.').pop()?.toLowerCase();

      // Handle PDF files - delegate to readPdfExecutor
      if (ext === '.pdf') {
        return FilesystemTools.readPdfExecutor(input);
      }

      // Handle image files - base64 encode for LLM vision
      if (FilesystemTools.IMAGE_EXTENSIONS.has(ext)) {
        if (file.size > FilesystemTools.MAX_IMAGE_SIZE) {
          throw new ToolExecutionError(
            `Image file too large: ${(file.size / 1024 / 1024).toFixed(1)}MB (max 20MB)`,
            {
              toolName: 'read',
              toolInput: input,
              code: ErrorCodes.VALIDATION_OUT_OF_RANGE,
              recoverable: false,
              retryable: false,
              suggestion: 'Use a smaller image file (max 20MB).',
            }
          );
        }

        const buffer = await file.arrayBuffer();
        const base64Data = Buffer.from(buffer).toString('base64');
        const mediaType = FilesystemTools.IMAGE_MIME_TYPES[ext] || 'image/png';

        return JSON.stringify({
          __image_attachment__: true,
          path: validated.resolved,
          name: path.split('/').pop() || 'image',
          mediaType,
          data: base64Data,
          size: file.size,
        });
      }

      // Default: read as text
      const limits = getLimits();
      if (exceedsFileReadLimit(file.size, limits.maxFileReadSize)) {
        throw new ToolExecutionError(`File exceeds size limit (${limits.maxFileReadSize} bytes)`, {
          toolName: 'read',
          toolInput: input,
          code: ErrorCodes.VALIDATION_OUT_OF_RANGE,
          recoverable: false,
          retryable: false,
          suggestion: 'Use a smaller file or narrow the read range.',
        });
      }

      const content = await file.text();
      const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      const lines = normalized.split('\n');

      const startLine = Math.max(0, offset);
      const endLine = limit ? startLine + limit : lines.length;
      const selectedLines = lines.slice(startLine, endLine);

      // Format with line numbers
      const formattedLines: string[] = [];
      for (let i = 0; i < selectedLines.length; i++) {
        formattedLines.push(`${String(startLine + i + 1).padStart(6)}  ${selectedLines[i]}`);
      }
      const formatted = formattedLines.join('\n');

      return formatted || '(empty file)';
    } catch (error) {
      if (error instanceof ToolExecutionError) throw error;
      throw new ToolExecutionError(error instanceof Error ? error.message : String(error), {
        toolName: 'read',
        toolInput: input,
        code: ErrorCodes.TOOL_EXECUTION_FAILED,
        recoverable: true,
        retryable: false,
      });
    }
  };

  // ============================================
  // Write Tool (RESTRICTED to temp folder)
  // ============================================

  static readonly writeTool: Tool = {
    name: 'write',
    description: 'Write content to a file. RESTRICTED: Can only write to the project scripts folder (.assistants-data/scripts/{session}). Provide a filename and it will be saved under the scripts folder.',
    parameters: {
      type: 'object',
      properties: {
        filename: {
          type: 'string',
          description: 'The filename to write to (saved in the project scripts folder)',
        },
        content: {
          type: 'string',
          description: 'The content to write',
        },
        cwd: {
          type: 'string',
          description: 'Base working directory for the project (optional)',
        },
      },
      required: ['filename', 'content'],
    },
  };

  static readonly writeExecutor: ToolExecutor = async (input) => {
    const filename = input.filename as string || input.path as string;
    const content = input.content as string;
    const baseCwd = (input.cwd as string) || process.cwd();

    if (typeof content !== 'string') {
      throw new ToolExecutionError('Content must be a string', {
        toolName: 'write',
        toolInput: input,
        code: ErrorCodes.VALIDATION_OUT_OF_RANGE,
        recoverable: false,
        retryable: false,
        suggestion: 'Provide string content to write.',
      });
    }

    // Always write to scripts folder
    const scriptsFolder = getScriptsFolder(baseCwd, input.sessionId as string | undefined);

    if (!filename || !filename.trim()) {
      throw new ToolExecutionError('Filename is required', {
        toolName: 'write',
        toolInput: input,
        code: ErrorCodes.TOOL_EXECUTION_FAILED,
        recoverable: false,
        retryable: false,
        suggestion: 'Provide a filename and try again.',
      });
    }

    // Sanitize filename - remove any path traversal attempts
    const sanitizedFilename = filename
      .replace(/\.\.[/\\]/g, '')
      .replace(/\.\./g, '')
      .replace(/^[/\\]+/, '');
    const path = join(scriptsFolder, sanitizedFilename);

    // Double check we're in scripts folder
    if (!isInScriptsFolder(path, baseCwd, input.sessionId as string | undefined)) {
      throw new ToolExecutionError(`Cannot write outside scripts folder. Files are saved to ${scriptsFolder}`, {
        toolName: 'write',
        toolInput: input,
        code: ErrorCodes.TOOL_PERMISSION_DENIED,
        recoverable: false,
        retryable: false,
        suggestion: 'Write only within the project scripts folder.',
      });
    }

    try {
      // Ensure scripts directory exists
      const validated = await validatePath(path, { allowSymlinks: false, allowedPaths: [scriptsFolder] });
      if (!validated.valid) {
        throw new ToolExecutionError(validated.error || 'Invalid path', {
          toolName: 'write',
          toolInput: input,
          code: ErrorCodes.VALIDATION_OUT_OF_RANGE,
          recoverable: false,
          retryable: false,
          suggestion: 'Write only within the allowed scripts folder.',
        });
      }

      const safety = await isPathSafe(validated.resolved, 'write', { cwd: baseCwd });
      if (!safety.safe) {
        getSecurityLogger().log({
          eventType: 'path_violation',
          severity: 'high',
          details: {
            tool: 'write',
            path: validated.resolved,
            reason: safety.reason || 'Blocked path',
          },
          sessionId: (input.sessionId as string) || 'unknown',
        });
        throw new ToolExecutionError(safety.reason || 'Blocked path', {
          toolName: 'write',
          toolInput: input,
          code: ErrorCodes.TOOL_PERMISSION_DENIED,
          recoverable: false,
          retryable: false,
        });
      }

      const dir = dirname(validated.resolved);
      await mkdir(dir, { recursive: true });

      const runtime = getRuntime();
      await runtime.write(validated.resolved, content);
      return `Successfully wrote ${content.length} characters to ${validated.resolved}`;
    } catch (error) {
      if (error instanceof ToolExecutionError) throw error;
      throw new ToolExecutionError(error instanceof Error ? error.message : String(error), {
        toolName: 'write',
        toolInput: input,
        code: ErrorCodes.TOOL_EXECUTION_FAILED,
        recoverable: true,
        retryable: false,
      });
    }
  };

  // ============================================
  // Glob Tool
  // ============================================

  static readonly globTool: Tool = {
    name: 'glob',
    description: 'Find files matching a glob pattern',
    parameters: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Glob pattern (e.g., "**/*.ts", "src/**/*.tsx")',
        },
        path: {
          type: 'string',
          description: 'Directory to search in (default: cwd)',
        },
        cwd: {
          type: 'string',
          description: 'Base working directory for relative paths (optional)',
        },
      },
      required: ['pattern'],
    },
  };

  static readonly globExecutor: ToolExecutor = async (input) => {
    const pattern = String(input.pattern || '').trim();
    const baseCwd = (input.cwd as string) || process.cwd();
    const searchPath = FilesystemTools.resolveInputPath(baseCwd, (input.path as string) || '.');

    try {
      if (!pattern) {
        throw new ToolExecutionError('Pattern is required', {
          toolName: 'glob',
          toolInput: input,
          code: ErrorCodes.VALIDATION_OUT_OF_RANGE,
          recoverable: false,
          retryable: false,
        });
      }

      const safety = await isPathSafe(searchPath, 'read', { cwd: baseCwd });
      if (!safety.safe) {
        getSecurityLogger().log({
          eventType: 'path_violation',
          severity: 'high',
          details: {
            tool: 'glob',
            path: searchPath,
            reason: safety.reason || 'Blocked path',
          },
          sessionId: (input.sessionId as string) || 'unknown',
        });
        throw new ToolExecutionError(safety.reason || 'Blocked path', {
          toolName: 'glob',
          toolInput: input,
          code: ErrorCodes.TOOL_PERMISSION_DENIED,
          recoverable: false,
          retryable: false,
        });
      }

      const validated = await validatePath(searchPath, {
        allowSymlinks: true,
        allowedPaths: [baseCwd, searchPath],
      });
      if (!validated.valid) {
        throw new ToolExecutionError(validated.error || 'Invalid path', {
          toolName: 'glob',
          toolInput: input,
          code: ErrorCodes.VALIDATION_OUT_OF_RANGE,
          recoverable: false,
          retryable: false,
        });
      }

      const runtime = getRuntime();
      const matches: string[] = [];

      try {
        for await (const file of runtime.glob(pattern, { cwd: validated.resolved })) {
          // Skip system directories
          if (file.includes('.Trash') || file.includes('.Spotlight-V100') || file.includes('.fseventsd')) {
            continue;
          }
          matches.push(file);
          if (matches.length >= 1000) break; // Limit results
        }
      } catch (scanError) {
        // Handle permission errors gracefully
        const errMsg = scanError instanceof Error ? scanError.message : String(scanError);
        if (errMsg.includes('operation not permitted') || errMsg.includes('EPERM') || errMsg.includes('EACCES')) {
          // Continue with whatever matches we have
        } else {
          throw scanError;
        }
      }

      if (matches.length === 0) {
        return 'No files found matching pattern';
      }

      return matches.join('\n');
    } catch (error) {
      if (error instanceof ToolExecutionError) throw error;
      throw new ToolExecutionError(error instanceof Error ? error.message : String(error), {
        toolName: 'glob',
        toolInput: input,
        code: ErrorCodes.TOOL_EXECUTION_FAILED,
        recoverable: true,
        retryable: false,
      });
    }
  };

  // ============================================
  // Grep Tool
  // ============================================

  static readonly grepTool: Tool = {
    name: 'grep',
    description: 'Search for a pattern in files',
    parameters: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Regex pattern to search for',
        },
        path: {
          type: 'string',
          description: 'File or directory to search in',
        },
        cwd: {
          type: 'string',
          description: 'Base working directory for relative paths (optional)',
        },
        glob: {
          type: 'string',
          description: 'Glob pattern to filter files (e.g., "*.ts")',
        },
        caseSensitive: {
          type: 'boolean',
          description: 'Case sensitive search (default: false)',
        },
      },
      required: ['pattern'],
    },
  };

  static readonly grepExecutor: ToolExecutor = async (input) => {
    const pattern = String(input.pattern || '').trim();
    const baseCwd = (input.cwd as string) || process.cwd();
    const searchPath = FilesystemTools.resolveInputPath(baseCwd, (input.path as string) || '.');
    const globPattern = (input.glob as string) || '**/*';
    const caseSensitive = (input.caseSensitive as boolean) || false;

    try {
      if (!pattern) {
        throw new ToolExecutionError('Pattern is required', {
          toolName: 'grep',
          toolInput: input,
          code: ErrorCodes.VALIDATION_OUT_OF_RANGE,
          recoverable: false,
          retryable: false,
        });
      }

      const safety = await isPathSafe(searchPath, 'read', { cwd: baseCwd });
      if (!safety.safe) {
        getSecurityLogger().log({
          eventType: 'path_violation',
          severity: 'high',
          details: {
            tool: 'grep',
            path: searchPath,
            reason: safety.reason || 'Blocked path',
          },
          sessionId: (input.sessionId as string) || 'unknown',
        });
        throw new ToolExecutionError(safety.reason || 'Blocked path', {
          toolName: 'grep',
          toolInput: input,
          code: ErrorCodes.TOOL_PERMISSION_DENIED,
          recoverable: false,
          retryable: false,
        });
      }

      const validated = await validatePath(searchPath, {
        allowSymlinks: true,
        allowedPaths: [baseCwd, searchPath],
      });
      if (!validated.valid) {
        throw new ToolExecutionError(validated.error || 'Invalid path', {
          toolName: 'grep',
          toolInput: input,
          code: ErrorCodes.VALIDATION_OUT_OF_RANGE,
          recoverable: false,
          retryable: false,
        });
      }

      // Don't use global flag - it causes stateful behavior with .test()
      const flags = caseSensitive ? '' : 'i';
      const regex = new RegExp(pattern, flags);
      const results: string[] = [];

      const runtime = getRuntime();

      try {
        for await (const file of runtime.glob(globPattern, { cwd: validated.resolved })) {
          // Skip system directories
          if (file.includes('.Trash') || file.includes('.Spotlight-V100') || file.includes('.fseventsd')) {
            continue;
          }
          const filePath = join(validated.resolved, file);

          try {
            const content = await runtime.file(filePath).text();
            const lines = content.split('\n');

            for (let i = 0; i < lines.length; i++) {
              if (regex.test(lines[i])) {
                results.push(`${file}:${i + 1}: ${lines[i].trim()}`);
                if (results.length >= 500) break; // Limit results
              }
            }
          } catch {
            // Skip files that can't be read
          }

          if (results.length >= 500) break;
        }
      } catch (scanError) {
        // Handle permission errors gracefully
        const errMsg = scanError instanceof Error ? scanError.message : String(scanError);
        if (errMsg.includes('operation not permitted') || errMsg.includes('EPERM') || errMsg.includes('EACCES')) {
          // Continue with whatever results we have
        } else {
          throw scanError;
        }
      }

      if (results.length === 0) {
        return 'No matches found';
      }

      return results.join('\n');
    } catch (error) {
      if (error instanceof ToolExecutionError) throw error;
      throw new ToolExecutionError(error instanceof Error ? error.message : String(error), {
        toolName: 'grep',
        toolInput: input,
        code: ErrorCodes.TOOL_EXECUTION_FAILED,
        recoverable: true,
        retryable: false,
      });
    }
  };

  // ============================================
  // Read PDF Tool
  // ============================================

  static readonly readPdfTool: Tool = {
    name: 'read_pdf',
    description:
      'Read a PDF file and attach it to the conversation for analysis. ' +
      'Claude can analyze text, images, charts, and tables in the PDF. ' +
      'Max 32MB, 100 pages. Returns a reference that allows Claude to see the PDF content.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'The PDF file path to read (absolute or relative to cwd)',
        },
        cwd: {
          type: 'string',
          description: 'Base working directory for relative paths (optional)',
        },
      },
      required: ['path'],
    },
  };

  static readonly readPdfExecutor: ToolExecutor = async (input) => {
    const baseCwd = (input.cwd as string) || process.cwd();
    const path = FilesystemTools.resolveInputPath(baseCwd, String(input.path || ''));

    try {
      // Validate path safety
      const safety = await isPathSafe(path, 'read', { cwd: baseCwd });
      if (!safety.safe) {
        getSecurityLogger().log({
          eventType: 'path_violation',
          severity: 'high',
          details: {
            tool: 'read_pdf',
            path,
            reason: safety.reason || 'Blocked path',
          },
          sessionId: (input.sessionId as string) || 'unknown',
        });
        throw new ToolExecutionError(safety.reason || 'Blocked path', {
          toolName: 'read_pdf',
          toolInput: input,
          code: ErrorCodes.TOOL_PERMISSION_DENIED,
          recoverable: false,
          retryable: false,
        });
      }

      const validated = await validatePath(path, { allowSymlinks: true });
      if (!validated.valid) {
        throw new ToolExecutionError(validated.error || 'Invalid path', {
          toolName: 'read_pdf',
          toolInput: input,
          code: ErrorCodes.VALIDATION_OUT_OF_RANGE,
          recoverable: false,
          retryable: false,
          suggestion: 'Provide a valid PDF file path.',
        });
      }

      const runtime = getRuntime();
      const file = runtime.file(validated.resolved);
      if (!(await file.exists())) {
        throw new ToolExecutionError(`PDF file not found: ${path}`, {
          toolName: 'read_pdf',
          toolInput: input,
          code: ErrorCodes.TOOL_EXECUTION_FAILED,
          recoverable: false,
          retryable: false,
          suggestion: 'Check the file path and try again.',
        });
      }

      // Check file extension
      if (!path.toLowerCase().endsWith('.pdf')) {
        throw new ToolExecutionError(`File is not a PDF: ${path}`, {
          toolName: 'read_pdf',
          toolInput: input,
          code: ErrorCodes.VALIDATION_OUT_OF_RANGE,
          recoverable: false,
          retryable: false,
          suggestion: 'Provide a .pdf file.',
        });
      }

      // Check file size (max 32MB for Anthropic API)
      const maxSize = 32 * 1024 * 1024; // 32MB
      if (file.size > maxSize) {
        throw new ToolExecutionError(
          `PDF file too large: ${(file.size / 1024 / 1024).toFixed(1)}MB (max 32MB)`,
          {
            toolName: 'read_pdf',
            toolInput: input,
            code: ErrorCodes.VALIDATION_OUT_OF_RANGE,
            recoverable: false,
            retryable: false,
            suggestion: 'Use a smaller PDF file (max 32MB, 100 pages).',
          }
        );
      }

      // Read and base64 encode the PDF
      const buffer = await file.arrayBuffer();
      const base64Data = Buffer.from(buffer).toString('base64');

      // Return a special format that the assistant loop will recognize
      // and convert to a document attachment
      return JSON.stringify({
        __pdf_attachment__: true,
        path: validated.resolved,
        name: path.split('/').pop() || 'document.pdf',
        mediaType: 'application/pdf',
        data: base64Data,
        size: file.size,
      });
    } catch (error) {
      if (error instanceof ToolExecutionError) throw error;
      throw new ToolExecutionError(error instanceof Error ? error.message : String(error), {
        toolName: 'read_pdf',
        toolInput: input,
        code: ErrorCodes.TOOL_EXECUTION_FAILED,
        recoverable: true,
        retryable: false,
      });
    }
  };
}

export const __test__ = {
  getScriptsFolder,
  isInScriptsFolder,
};
