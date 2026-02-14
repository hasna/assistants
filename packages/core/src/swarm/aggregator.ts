/**
 * Swarm Results Aggregator
 *
 * Merges subassistant outputs into a single coherent response.
 * Handles deduplication, conflict resolution, and partial results.
 * Attaches confidence and coverage metadata.
 */

import type { SubassistantResult } from '../agent/subagent-manager';
import type { SwarmTask } from './types';

/**
 * Aggregation strategy
 */
export type AggregationStrategy =
  | 'concatenate'  // Simple concatenation
  | 'merge'        // Intelligent merge with deduplication
  | 'best_effort'  // Use best result, fallback to partials
  | 'voting'       // Use most common answer for overlapping content
  | 'synthesis';   // LLM-based synthesis

/**
 * Conflict resolution strategy
 */
export type ConflictResolution =
  | 'first'        // Keep first encountered
  | 'last'         // Keep last encountered
  | 'longest'      // Keep longest version
  | 'highest_conf' // Keep highest confidence
  | 'merge';       // Attempt to merge

/**
 * Task result for aggregation
 */
export interface TaskResultInput {
  /** Task ID */
  taskId: string;
  /** Original task */
  task: SwarmTask;
  /** Subassistant result */
  result: SubassistantResult;
  /** Task order/priority */
  order: number;
  /** Custom weight for this result */
  weight?: number;
}

/**
 * Aggregated result section
 */
export interface AggregatedSection {
  /** Section identifier */
  id: string;
  /** Section title/description */
  title: string;
  /** Section content */
  content: string;
  /** Source task IDs */
  sources: string[];
  /** Confidence score (0-1) */
  confidence: number;
  /** Whether this section had conflicts */
  hasConflicts: boolean;
  /** Conflict details if any */
  conflictDetails?: string;
}

/**
 * Aggregation metadata
 */
export interface AggregationMetadata {
  /** Overall confidence score (0-1) */
  confidence: number;
  /** Coverage score (0-1) - how much of expected output is present */
  coverage: number;
  /** Number of tasks that contributed */
  contributingTasks: number;
  /** Number of tasks that failed */
  failedTasks: number;
  /** Number of conflicts detected */
  conflictCount: number;
  /** Number of duplicates removed */
  deduplicationCount: number;
  /** Sections in the result */
  sectionCount: number;
  /** Total character count */
  totalLength: number;
  /** Aggregation strategy used */
  strategy: AggregationStrategy;
  /** Conflict resolution used */
  conflictResolution: ConflictResolution;
  /** Timestamp */
  aggregatedAt: number;
}

/**
 * Aggregated result
 */
export interface AggregatedResult {
  /** Final aggregated content */
  content: string;
  /** Sections breakdown */
  sections: AggregatedSection[];
  /** Metadata */
  metadata: AggregationMetadata;
  /** Partial results (from failed/incomplete tasks) */
  partials: Array<{
    taskId: string;
    content: string;
    reason: string;
  }>;
  /** Warnings */
  warnings: string[];
}

/**
 * Aggregator configuration
 */
export interface AggregatorConfig {
  /** Aggregation strategy */
  strategy: AggregationStrategy;
  /** Conflict resolution strategy */
  conflictResolution: ConflictResolution;
  /** Minimum confidence to include a result */
  minConfidence: number;
  /** Include partial results from failed tasks */
  includePartials: boolean;
  /** Deduplicate overlapping content */
  deduplicateContent: boolean;
  /** Similarity threshold for deduplication (0-1) */
  deduplicationThreshold: number;
  /** Maximum output length */
  maxOutputLength: number;
  /** Section separator */
  sectionSeparator: string;
  /** Add task references */
  addTaskReferences: boolean;
}

/**
 * Default aggregator configuration
 */
export const DEFAULT_AGGREGATOR_CONFIG: AggregatorConfig = {
  strategy: 'merge',
  conflictResolution: 'highest_conf',
  minConfidence: 0.3,
  includePartials: true,
  deduplicateContent: true,
  deduplicationThreshold: 0.8,
  maxOutputLength: 50000,
  sectionSeparator: '\n\n---\n\n',
  addTaskReferences: false,
};

/**
 * Swarm Results Aggregator
 *
 * Merges outputs from multiple subassistants into a coherent response.
 */
export class SwarmResultsAggregator {
  private config: AggregatorConfig;

  constructor(config?: Partial<AggregatorConfig>) {
    this.config = { ...DEFAULT_AGGREGATOR_CONFIG, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): AggregatorConfig {
    return { ...this.config };
  }

  /**
   * Aggregate results from multiple tasks
   */
  aggregate(inputs: TaskResultInput[]): AggregatedResult {
    const warnings: string[] = [];
    const partials: AggregatedResult['partials'] = [];

    // Sort inputs by order/priority
    const sortedInputs = [...inputs].sort((a, b) => a.order - b.order);

    // Separate successful and failed results
    const successful: TaskResultInput[] = [];
    const failed: TaskResultInput[] = [];

    for (const input of sortedInputs) {
      if (input.result.success && input.result.result) {
        successful.push(input);
      } else {
        failed.push(input);
        if (this.config.includePartials && input.result.result) {
          partials.push({
            taskId: input.taskId,
            content: input.result.result,
            reason: input.result.error || 'Task failed',
          });
        }
      }
    }

    if (successful.length === 0) {
      warnings.push('No successful task results to aggregate');
      return this.createEmptyResult(warnings, partials);
    }

    // Extract sections from each result
    const allSections = this.extractSections(successful);

    // Deduplicate if enabled
    let processedSections = allSections;
    let deduplicationCount = 0;

    if (this.config.deduplicateContent) {
      const { sections, removed } = this.deduplicateSections(allSections);
      processedSections = sections;
      deduplicationCount = removed;
    }

    // Detect and resolve conflicts
    const { sections: resolvedSections, conflicts } = this.resolveConflicts(processedSections);

    // Build final content based on strategy
    const { content, sections } = this.buildFinalContent(resolvedSections);

    // Calculate metadata
    const metadata = this.calculateMetadata({
      strategy: this.config.strategy,
      conflictResolution: this.config.conflictResolution,
      contributingTasks: successful.length,
      failedTasks: failed.length,
      conflictCount: conflicts,
      deduplicationCount,
      sections,
      content,
    });

    // Add warnings for issues
    if (failed.length > 0) {
      warnings.push(`${failed.length} task(s) failed and were excluded`);
    }
    if (conflicts > 0) {
      warnings.push(`${conflicts} conflict(s) were detected and resolved`);
    }

    return {
      content,
      sections,
      metadata,
      partials,
      warnings,
    };
  }

  /**
   * Quick aggregate for simple concatenation
   */
  concatenate(results: Array<{ taskId: string; result: string }>): string {
    return results
      .map(r => r.result)
      .join(this.config.sectionSeparator);
  }

  /**
   * Calculate confidence for a result
   */
  calculateResultConfidence(result: SubassistantResult): number {
    if (!result.success) return 0;

    let confidence = 0.5; // Base confidence

    // Boost for having a result
    if (result.result && result.result.length > 0) {
      confidence += 0.2;
    }

    // Boost for completing within reasonable tool calls
    if (result.toolCalls > 0 && result.toolCalls <= 10) {
      confidence += 0.1;
    }

    // Reduce for errors
    if (result.error) {
      confidence -= 0.2;
    }

    // Reduce for very short results (might be incomplete)
    if (result.result && result.result.length < 50) {
      confidence -= 0.1;
    }

    return Math.max(0, Math.min(1, confidence));
  }

  // ============================================
  // Private Methods
  // ============================================

  /**
   * Extract sections from results
   */
  private extractSections(inputs: TaskResultInput[]): AggregatedSection[] {
    const sections: AggregatedSection[] = [];

    for (const input of inputs) {
      const content = input.result.result || '';
      const confidence = this.calculateResultConfidence(input.result);

      // Check if result has markdown headers
      const headerPattern = /^(#{1,3})\s+(.+)$/gm;
      const matches = [...content.matchAll(headerPattern)];

      if (matches.length > 1) {
        // Split by headers
        let lastIndex = 0;
        for (let i = 0; i < matches.length; i++) {
          const match = matches[i];
          const nextMatch = matches[i + 1];
          const startIndex = match.index!;
          const endIndex = nextMatch ? nextMatch.index! : content.length;

          const sectionContent = content.slice(startIndex, endIndex).trim();

          sections.push({
            id: `${input.taskId}-${i}`,
            title: match[2],
            content: sectionContent,
            sources: [input.taskId],
            confidence,
            hasConflicts: false,
          });

          lastIndex = endIndex;
        }
      } else {
        // Treat entire result as single section
        sections.push({
          id: input.taskId,
          title: input.task.description.slice(0, 50),
          content,
          sources: [input.taskId],
          confidence,
          hasConflicts: false,
        });
      }
    }

    return sections;
  }

  /**
   * Deduplicate similar sections
   */
  private deduplicateSections(sections: AggregatedSection[]): {
    sections: AggregatedSection[];
    removed: number;
  } {
    const result: AggregatedSection[] = [];
    let removed = 0;

    for (const section of sections) {
      // Check if similar section already exists
      const similarIndex = result.findIndex(existing =>
        this.calculateSimilarity(existing.content, section.content) >= this.config.deduplicationThreshold
      );

      if (similarIndex >= 0) {
        // Merge with existing
        const existing = result[similarIndex];

        // Keep the one with higher confidence
        if (section.confidence > existing.confidence) {
          existing.content = section.content;
          existing.confidence = section.confidence;
        }

        // Merge sources
        existing.sources = [...new Set([...existing.sources, ...section.sources])];
        removed++;
      } else {
        result.push({ ...section });
      }
    }

    return { sections: result, removed };
  }

  /**
   * Resolve conflicts between sections
   */
  private resolveConflicts(sections: AggregatedSection[]): {
    sections: AggregatedSection[];
    conflicts: number;
  } {
    const result: AggregatedSection[] = [];
    let conflicts = 0;

    // Group sections by similar titles
    const groups = new Map<string, AggregatedSection[]>();

    for (const section of sections) {
      const normalizedTitle = this.normalizeTitle(section.title);
      const existing = groups.get(normalizedTitle);

      if (existing) {
        existing.push(section);
      } else {
        groups.set(normalizedTitle, [section]);
      }
    }

    // Resolve each group
    for (const [_, group] of groups) {
      if (group.length === 1) {
        result.push(group[0]);
        continue;
      }

      // Conflict detected
      conflicts++;
      const resolved = this.resolveConflictGroup(group);
      result.push(resolved);
    }

    return { sections: result, conflicts };
  }

  /**
   * Resolve a group of conflicting sections
   */
  private resolveConflictGroup(sections: AggregatedSection[]): AggregatedSection {
    let winner: AggregatedSection;

    switch (this.config.conflictResolution) {
      case 'first':
        winner = sections[0];
        break;

      case 'last':
        winner = sections[sections.length - 1];
        break;

      case 'longest':
        winner = sections.reduce((a, b) =>
          a.content.length >= b.content.length ? a : b
        );
        break;

      case 'highest_conf':
        winner = sections.reduce((a, b) =>
          a.confidence >= b.confidence ? a : b
        );
        break;

      case 'merge':
        // Merge all content
        const mergedContent = sections
          .map(s => s.content)
          .join('\n\n');
        const mergedSources = [...new Set(sections.flatMap(s => s.sources))];
        const avgConfidence = sections.reduce((sum, s) => sum + s.confidence, 0) / sections.length;

        return {
          id: sections[0].id,
          title: sections[0].title,
          content: mergedContent,
          sources: mergedSources,
          confidence: avgConfidence,
          hasConflicts: true,
          conflictDetails: `Merged ${sections.length} conflicting sections`,
        };

      default:
        winner = sections[0];
    }

    return {
      ...winner,
      sources: [...new Set(sections.flatMap(s => s.sources))],
      hasConflicts: true,
      conflictDetails: `Resolved conflict using '${this.config.conflictResolution}' strategy`,
    };
  }

  /**
   * Build final content from sections
   */
  private buildFinalContent(sections: AggregatedSection[]): {
    content: string;
    sections: AggregatedSection[];
  } {
    // Sort sections (maintain original order mostly)
    const sortedSections = [...sections];

    // Build content
    let content: string;

    switch (this.config.strategy) {
      case 'concatenate':
        content = sortedSections
          .map(s => s.content)
          .join(this.config.sectionSeparator);
        break;

      case 'merge':
      case 'best_effort':
      case 'voting':
      case 'synthesis':
      default:
        // Build structured content
        const parts: string[] = [];

        for (const section of sortedSections) {
          let sectionContent = section.content;

          if (this.config.addTaskReferences) {
            sectionContent += `\n\n_Sources: ${section.sources.join(', ')}_`;
          }

          parts.push(sectionContent);
        }

        content = parts.join(this.config.sectionSeparator);
        break;
    }

    // Truncate if needed
    if (content.length > this.config.maxOutputLength) {
      content = content.slice(0, this.config.maxOutputLength) + '\n\n[Truncated...]';
    }

    return { content, sections: sortedSections };
  }

  /**
   * Calculate aggregation metadata
   */
  private calculateMetadata(params: {
    strategy: AggregationStrategy;
    conflictResolution: ConflictResolution;
    contributingTasks: number;
    failedTasks: number;
    conflictCount: number;
    deduplicationCount: number;
    sections: AggregatedSection[];
    content: string;
  }): AggregationMetadata {
    const totalTasks = params.contributingTasks + params.failedTasks;

    // Calculate overall confidence
    const avgConfidence = params.sections.length > 0
      ? params.sections.reduce((sum, s) => sum + s.confidence, 0) / params.sections.length
      : 0;

    // Calculate coverage (based on contributing vs total)
    const coverage = totalTasks > 0 ? params.contributingTasks / totalTasks : 0;

    return {
      confidence: avgConfidence,
      coverage,
      contributingTasks: params.contributingTasks,
      failedTasks: params.failedTasks,
      conflictCount: params.conflictCount,
      deduplicationCount: params.deduplicationCount,
      sectionCount: params.sections.length,
      totalLength: params.content.length,
      strategy: params.strategy,
      conflictResolution: params.conflictResolution,
      aggregatedAt: Date.now(),
    };
  }

  /**
   * Calculate text similarity (simple word overlap)
   */
  private calculateSimilarity(text1: string, text2: string): number {
    const words1 = new Set(text1.toLowerCase().split(/\s+/));
    const words2 = new Set(text2.toLowerCase().split(/\s+/));

    const intersection = new Set([...words1].filter(w => words2.has(w)));
    const union = new Set([...words1, ...words2]);

    return union.size > 0 ? intersection.size / union.size : 0;
  }

  /**
   * Normalize title for grouping
   */
  private normalizeTitle(title: string): string {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Create empty result
   */
  private createEmptyResult(
    warnings: string[],
    partials: AggregatedResult['partials']
  ): AggregatedResult {
    return {
      content: '',
      sections: [],
      metadata: {
        confidence: 0,
        coverage: 0,
        contributingTasks: 0,
        failedTasks: partials.length,
        conflictCount: 0,
        deduplicationCount: 0,
        sectionCount: 0,
        totalLength: 0,
        strategy: this.config.strategy,
        conflictResolution: this.config.conflictResolution,
        aggregatedAt: Date.now(),
      },
      partials,
      warnings,
    };
  }
}

/**
 * Create an aggregator with default configuration
 */
export function createSwarmAggregator(
  config?: Partial<AggregatorConfig>
): SwarmResultsAggregator {
  return new SwarmResultsAggregator(config);
}

/**
 * Quick aggregate helper function
 */
export function quickAggregate(
  results: Map<string, SubassistantResult>,
  tasks: SwarmTask[]
): AggregatedResult {
  const aggregator = new SwarmResultsAggregator();

  const inputs: TaskResultInput[] = [];
  let order = 0;

  for (const task of tasks) {
    const result = results.get(task.id);
    if (result) {
      inputs.push({
        taskId: task.id,
        task,
        result,
        order: order++,
      });
    }
  }

  return aggregator.aggregate(inputs);
}
