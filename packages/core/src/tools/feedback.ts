import type { Tool } from '@hasna/assistants-shared';
import type { ToolExecutor } from './registry';
import { generateId } from '@hasna/assistants-shared';
import { join } from 'path';
import { mkdirSync, writeFileSync } from 'fs';
import { getProjectDataDir } from '../config';

export type FeedbackType = 'bug' | 'feature' | 'feedback';

export interface FeedbackEntry {
  id: string;
  createdAt: string;
  type: FeedbackType;
  title: string;
  description: string;
  steps?: string;
  expected?: string;
  actual?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  source?: string;
}

function normalizeTags(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const tags = value.map((t) => String(t).trim()).filter(Boolean);
    return tags.length > 0 ? tags : undefined;
  }
  if (typeof value === 'string') {
    const tags = value.split(',').map((t) => t.trim()).filter(Boolean);
    return tags.length > 0 ? tags : undefined;
  }
  return undefined;
}

function resolveFeedbackDir(cwd?: string): string {
  const baseCwd = cwd && cwd.trim().length > 0 ? cwd : process.cwd();
  return join(getProjectDataDir(baseCwd), 'feedback');
}

export function saveFeedbackEntry(entry: FeedbackEntry, cwd?: string): { path: string } {
  const feedbackDir = resolveFeedbackDir(cwd);
  mkdirSync(feedbackDir, { recursive: true });
  const path = join(feedbackDir, `${entry.id}.json`);
  writeFileSync(path, JSON.stringify(entry, null, 2));
  return { path };
}

function buildEntry(input: Record<string, unknown>, overrides?: Partial<FeedbackEntry>): FeedbackEntry {
  const typeValue = String(input.type || 'feedback').toLowerCase();
  const type: FeedbackType = typeValue === 'bug' || typeValue === 'feature' ? typeValue : 'feedback';
  const title = String(input.title || 'Feedback').trim() || 'Feedback';
  const description = String(input.description || input.message || '').trim();
  const steps = String(input.steps || '').trim();
  const expected = String(input.expected || '').trim();
  const actual = String(input.actual || '').trim();
  const tags = normalizeTags(input.tags);
  const metadata = (input.metadata && typeof input.metadata === 'object') ? (input.metadata as Record<string, unknown>) : undefined;
  const source = typeof input.source === 'string' ? input.source : undefined;

  const entry: FeedbackEntry = {
    id: generateId(),
    createdAt: new Date().toISOString(),
    type,
    title,
    description,
    steps: steps || undefined,
    expected: expected || undefined,
    actual: actual || undefined,
    tags,
    metadata,
    source,
    ...overrides,
  };

  return entry;
}

export class FeedbackTool {
  static readonly tool: Tool = {
    name: 'submit_feedback',
    description: 'Submit product feedback and save it locally. Use for bugs, feature requests, or general feedback.',
    parameters: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description: 'Feedback type: bug, feature, or feedback',
          enum: ['bug', 'feature', 'feedback'],
          default: 'feedback',
        },
        title: {
          type: 'string',
          description: 'Short summary title',
        },
        description: {
          type: 'string',
          description: 'Detailed description of the feedback',
        },
        steps: {
          type: 'string',
          description: 'Steps to reproduce (for bugs)',
        },
        expected: {
          type: 'string',
          description: 'Expected behavior (for bugs)',
        },
        actual: {
          type: 'string',
          description: 'Actual behavior (for bugs)',
        },
        tags: {
          type: 'array',
          description: 'Optional tags',
          items: { type: 'string', description: 'Tag' },
        },
        metadata: {
          type: 'object',
          description: 'Optional metadata (key-value)',
        },
        source: {
          type: 'string',
          description: 'Source of feedback (optional)',
        },
      },
      required: ['title', 'description'],
    },
  };

  static readonly executor: ToolExecutor = async (input) => {
    try {
      const entry = buildEntry(input, { source: (input.source as string) || 'tool' });
      const { path } = saveFeedbackEntry(entry, typeof input.cwd === 'string' ? input.cwd : undefined);
      return `Feedback saved locally.\nID: ${entry.id}\nPath: ${path}`;
    } catch (error) {
      return `Error: ${error instanceof Error ? error.message : String(error)}`;
    }
  };
}

export const __test__ = {
  buildEntry,
  saveFeedbackEntry,
};
