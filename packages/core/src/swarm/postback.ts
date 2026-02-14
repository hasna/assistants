/**
 * Swarm Postback
 *
 * Injects structured summaries and artifacts back into the main session.
 * Handles task outcomes, links, and user-visible final responses.
 */

import type { SwarmTask, SwarmResult, SwarmPlan, SwarmMetrics } from './types';
import type { AggregatedResult, AggregationMetadata } from './aggregator';
import type { CriticReview, CriticIssue, FollowUpAction } from './critic';
import type { SubassistantResult } from '../agent/subagent-manager';

/**
 * Artifact type
 */
export type ArtifactType =
  | 'code'
  | 'file'
  | 'data'
  | 'text'
  | 'config'
  | 'log'
  | 'error'
  | 'link';

/**
 * Artifact entry
 */
export interface SwarmArtifact {
  /** Artifact ID */
  id: string;
  /** Artifact type */
  type: ArtifactType;
  /** Artifact name/title */
  name: string;
  /** Artifact content */
  content: string;
  /** File path (if type is file) */
  path?: string;
  /** URL (if type is link) */
  url?: string;
  /** Source task ID */
  sourceTaskId?: string;
  /** Language (for code) */
  language?: string;
  /** Size in bytes */
  size?: number;
  /** Metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Task outcome summary
 */
export interface TaskOutcome {
  /** Task ID */
  taskId: string;
  /** Task description */
  description: string;
  /** Task role */
  role: string;
  /** Outcome status */
  status: 'completed' | 'failed' | 'partial' | 'skipped';
  /** Result summary (truncated) */
  summary?: string;
  /** Full result */
  result?: string;
  /** Error if failed */
  error?: string;
  /** Duration in milliseconds */
  durationMs?: number;
  /** Artifacts produced */
  artifacts: SwarmArtifact[];
}

/**
 * Postback message format
 */
export type PostbackFormat = 'markdown' | 'json' | 'plain' | 'structured';

/**
 * Postback message
 */
export interface PostbackMessage {
  /** Message ID */
  id: string;
  /** Message format */
  format: PostbackFormat;
  /** Message content */
  content: string;
  /** Structured data (if format is structured) */
  structuredData?: PostbackStructuredData;
  /** Message timestamp */
  timestamp: number;
  /** Swarm ID */
  swarmId: string;
  /** Session ID */
  sessionId: string;
}

/**
 * Structured postback data
 */
export interface PostbackStructuredData {
  /** Overall summary */
  summary: string;
  /** Swarm goal */
  goal: string;
  /** Overall success */
  success: boolean;
  /** Quality score (0-1) */
  qualityScore: number;
  /** Task outcomes */
  taskOutcomes: TaskOutcome[];
  /** Artifacts */
  artifacts: SwarmArtifact[];
  /** Issues (from critic) */
  issues: CriticIssue[];
  /** Follow-up actions */
  followUps: FollowUpAction[];
  /** Metrics */
  metrics: SwarmMetrics;
  /** Metadata */
  metadata: AggregationMetadata;
  /** Duration */
  durationMs: number;
}

/**
 * Postback configuration
 */
export interface PostbackConfig {
  /** Output format */
  format: PostbackFormat;
  /** Include task details */
  includeTaskDetails: boolean;
  /** Include artifacts */
  includeArtifacts: boolean;
  /** Include metrics */
  includeMetrics: boolean;
  /** Include issues */
  includeIssues: boolean;
  /** Include follow-ups */
  includeFollowUps: boolean;
  /** Maximum content length */
  maxContentLength: number;
  /** Maximum artifacts */
  maxArtifacts: number;
  /** Truncate long results */
  truncateResults: boolean;
  /** Truncation length */
  truncationLength: number;
  /** Show code blocks */
  showCodeBlocks: boolean;
  /** Show duration */
  showDuration: boolean;
  /** Custom template (for markdown format) */
  customTemplate?: string;
}

/**
 * Default postback configuration
 */
export const DEFAULT_POSTBACK_CONFIG: PostbackConfig = {
  format: 'markdown',
  includeTaskDetails: true,
  includeArtifacts: true,
  includeMetrics: true,
  includeIssues: true,
  includeFollowUps: true,
  maxContentLength: 10000,
  maxArtifacts: 20,
  truncateResults: true,
  truncationLength: 500,
  showCodeBlocks: true,
  showDuration: true,
};

/**
 * Swarm Postback Manager
 *
 * Formats and injects swarm results back into the session.
 */
export class SwarmPostback {
  private config: PostbackConfig;

  constructor(config?: Partial<PostbackConfig>) {
    this.config = { ...DEFAULT_POSTBACK_CONFIG, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): PostbackConfig {
    return { ...this.config };
  }

  /**
   * Create postback message from swarm result
   */
  createPostback(params: {
    swarmId: string;
    sessionId: string;
    goal: string;
    plan: SwarmPlan;
    result: SwarmResult;
    aggregatedResult?: AggregatedResult;
    criticReview?: CriticReview;
  }): PostbackMessage {
    const { swarmId, sessionId, goal, plan, result, aggregatedResult, criticReview } = params;

    // Extract task outcomes
    const taskOutcomes = this.extractTaskOutcomes(plan.tasks, result);

    // Extract artifacts
    const artifacts = this.extractArtifacts(result, taskOutcomes);

    // Build structured data
    const structuredData: PostbackStructuredData = {
      summary: this.generateSummary(result, criticReview),
      goal,
      success: result.success,
      qualityScore: criticReview?.qualityScore ?? (result.success ? 0.8 : 0.3),
      taskOutcomes,
      artifacts: artifacts.slice(0, this.config.maxArtifacts),
      issues: criticReview?.issues || [],
      followUps: criticReview?.followUps || [],
      metrics: result.metrics,
      metadata: aggregatedResult?.metadata || this.createDefaultMetadata(result),
      durationMs: result.durationMs,
    };

    // Format content based on configuration
    const content = this.formatContent(structuredData);

    return {
      id: `postback-${swarmId}`,
      format: this.config.format,
      content,
      structuredData: this.config.format === 'structured' ? structuredData : undefined,
      timestamp: Date.now(),
      swarmId,
      sessionId,
    };
  }

  /**
   * Format as markdown string
   */
  formatAsMarkdown(data: PostbackStructuredData): string {
    if (this.config.customTemplate) {
      return this.applyTemplate(this.config.customTemplate, data);
    }

    const parts: string[] = [];

    // Header
    const statusIcon = data.success ? '✅' : '❌';
    parts.push(`## ${statusIcon} Swarm Execution Complete`);
    parts.push('');

    // Summary
    parts.push(`**Goal:** ${data.goal}`);
    parts.push('');
    parts.push(data.summary);
    parts.push('');

    // Metrics
    if (this.config.includeMetrics) {
      parts.push('### Metrics');
      parts.push(`- Tasks: ${data.metrics.completedTasks}/${data.metrics.totalTasks} completed`);
      if (data.metrics.failedTasks > 0) {
        parts.push(`- Failed: ${data.metrics.failedTasks}`);
      }
      parts.push(`- Tool calls: ${data.metrics.toolCalls}`);
      if (this.config.showDuration) {
        parts.push(`- Duration: ${this.formatDuration(data.durationMs)}`);
      }
      parts.push(`- Quality: ${(data.qualityScore * 100).toFixed(0)}%`);
      parts.push('');
    }

    // Task outcomes
    if (this.config.includeTaskDetails && data.taskOutcomes.length > 0) {
      parts.push('### Task Outcomes');
      for (const outcome of data.taskOutcomes) {
        const statusEmoji = this.getStatusEmoji(outcome.status);
        parts.push(`${statusEmoji} **${outcome.description}**`);
        if (outcome.summary) {
          parts.push(`   ${outcome.summary}`);
        }
        if (outcome.error) {
          parts.push(`   ⚠️ Error: ${outcome.error}`);
        }
      }
      parts.push('');
    }

    // Artifacts
    if (this.config.includeArtifacts && data.artifacts.length > 0) {
      parts.push('### Artifacts');
      for (const artifact of data.artifacts) {
        if (artifact.type === 'code' && this.config.showCodeBlocks) {
          parts.push(`**${artifact.name}** (${artifact.language || 'code'})`);
          parts.push('```' + (artifact.language || ''));
          parts.push(this.truncate(artifact.content));
          parts.push('```');
        } else if (artifact.type === 'file') {
          parts.push(`📄 **${artifact.name}**: \`${artifact.path}\``);
        } else if (artifact.type === 'link') {
          parts.push(`🔗 **${artifact.name}**: ${artifact.url}`);
        } else {
          parts.push(`- **${artifact.name}**: ${this.truncate(artifact.content)}`);
        }
      }
      parts.push('');
    }

    // Issues
    if (this.config.includeIssues && data.issues.length > 0) {
      parts.push('### Issues Found');
      for (const issue of data.issues) {
        const severityEmoji = this.getSeverityEmoji(issue.severity);
        parts.push(`${severityEmoji} **${issue.title}** (${issue.severity})`);
        parts.push(`   ${issue.description}`);
        if (issue.suggestedFix) {
          parts.push(`   💡 Fix: ${issue.suggestedFix}`);
        }
      }
      parts.push('');
    }

    // Follow-ups
    if (this.config.includeFollowUps && data.followUps.length > 0) {
      const required = data.followUps.filter(f => f.required);
      if (required.length > 0) {
        parts.push('### Required Follow-ups');
        for (const followUp of required) {
          parts.push(`- [ ] ${followUp.description}`);
        }
        parts.push('');
      }
    }

    return parts.join('\n').slice(0, this.config.maxContentLength);
  }

  /**
   * Format as JSON string
   */
  formatAsJson(data: PostbackStructuredData): string {
    return JSON.stringify(data, null, 2);
  }

  /**
   * Format as plain text
   */
  formatAsPlain(data: PostbackStructuredData): string {
    const parts: string[] = [];

    parts.push(`SWARM EXECUTION ${data.success ? 'COMPLETE' : 'FAILED'}`);
    parts.push(`Goal: ${data.goal}`);
    parts.push('');
    parts.push(data.summary);
    parts.push('');

    if (this.config.includeMetrics) {
      parts.push(`Tasks: ${data.metrics.completedTasks}/${data.metrics.totalTasks}`);
      parts.push(`Duration: ${this.formatDuration(data.durationMs)}`);
      parts.push('');
    }

    if (this.config.includeTaskDetails) {
      parts.push('TASKS:');
      for (const outcome of data.taskOutcomes) {
        parts.push(`[${outcome.status.toUpperCase()}] ${outcome.description}`);
      }
      parts.push('');
    }

    if (this.config.includeIssues && data.issues.length > 0) {
      parts.push('ISSUES:');
      for (const issue of data.issues) {
        parts.push(`[${issue.severity.toUpperCase()}] ${issue.title}`);
      }
    }

    return parts.join('\n').slice(0, this.config.maxContentLength);
  }

  /**
   * Create inbox-compatible message
   */
  createInboxMessage(postback: PostbackMessage): {
    type: 'swarm_result';
    title: string;
    content: string;
    metadata: Record<string, unknown>;
  } {
    return {
      type: 'swarm_result',
      title: `Swarm completed: ${postback.structuredData?.goal || 'Unknown'}`,
      content: postback.content,
      metadata: {
        swarmId: postback.swarmId,
        sessionId: postback.sessionId,
        success: postback.structuredData?.success,
        qualityScore: postback.structuredData?.qualityScore,
        taskCount: postback.structuredData?.taskOutcomes.length,
        artifactCount: postback.structuredData?.artifacts.length,
        issueCount: postback.structuredData?.issues.length,
        durationMs: postback.structuredData?.durationMs,
      },
    };
  }

  // ============================================
  // Private Methods
  // ============================================

  /**
   * Extract task outcomes from results
   */
  private extractTaskOutcomes(
    tasks: SwarmTask[],
    result: SwarmResult
  ): TaskOutcome[] {
    const outcomes: TaskOutcome[] = [];

    for (const task of tasks) {
      const taskResult = result.taskResults[task.id];

      const outcome: TaskOutcome = {
        taskId: task.id,
        description: task.description,
        role: task.role,
        status: this.mapTaskStatus(task.status, taskResult),
        summary: taskResult?.result
          ? this.truncate(taskResult.result)
          : undefined,
        result: taskResult?.result,
        error: taskResult?.error,
        durationMs: task.completedAt && task.startedAt
          ? task.completedAt - task.startedAt
          : undefined,
        artifacts: this.extractArtifactsFromResult(task.id, taskResult),
      };

      outcomes.push(outcome);
    }

    return outcomes;
  }

  /**
   * Extract artifacts from all results
   */
  private extractArtifacts(
    result: SwarmResult,
    outcomes: TaskOutcome[]
  ): SwarmArtifact[] {
    const artifacts: SwarmArtifact[] = [];

    // Collect from outcomes
    for (const outcome of outcomes) {
      artifacts.push(...outcome.artifacts);
    }

    return artifacts;
  }

  /**
   * Extract artifacts from a single task result
   */
  private extractArtifactsFromResult(
    taskId: string,
    result?: SubassistantResult
  ): SwarmArtifact[] {
    if (!result?.result) return [];

    const artifacts: SwarmArtifact[] = [];
    let artifactId = 0;

    // Extract code blocks
    const codeBlockPattern = /```(\w+)?\n([\s\S]*?)```/g;
    let match;

    while ((match = codeBlockPattern.exec(result.result)) !== null) {
      const language = match[1] || 'text';
      const content = match[2].trim();

      if (content.length > 20) {
        artifacts.push({
          id: `${taskId}-code-${artifactId++}`,
          type: 'code',
          name: `Code block ${artifactId}`,
          content,
          sourceTaskId: taskId,
          language,
          size: content.length,
        });
      }
    }

    // Extract file paths
    const filePattern = /(?:created?|wrote?|saved?|output|file).*?[`"']([^`"'\s]+\.\w+)[`"']/gi;
    while ((match = filePattern.exec(result.result)) !== null) {
      artifacts.push({
        id: `${taskId}-file-${artifactId++}`,
        type: 'file',
        name: match[1].split('/').pop() || match[1],
        content: '',
        path: match[1],
        sourceTaskId: taskId,
      });
    }

    // Extract URLs
    const urlPattern = /https?:\/\/[^\s<>"']+/g;
    while ((match = urlPattern.exec(result.result)) !== null) {
      artifacts.push({
        id: `${taskId}-link-${artifactId++}`,
        type: 'link',
        name: 'Link',
        content: match[0],
        url: match[0],
        sourceTaskId: taskId,
      });
    }

    return artifacts;
  }

  /**
   * Map task status to outcome status
   */
  private mapTaskStatus(
    taskStatus: string,
    result?: SubassistantResult
  ): TaskOutcome['status'] {
    if (taskStatus === 'completed' && result?.success) return 'completed';
    if (taskStatus === 'completed' && !result?.success) return 'partial';
    if (taskStatus === 'failed') return 'failed';
    if (taskStatus === 'blocked' || taskStatus === 'cancelled') return 'skipped';
    return 'partial';
  }

  /**
   * Generate summary text
   */
  private generateSummary(result: SwarmResult, criticReview?: CriticReview): string {
    const parts: string[] = [];

    if (result.success) {
      parts.push(`Successfully completed ${result.metrics.completedTasks} tasks.`);
    } else {
      parts.push(`Execution encountered issues: ${result.error || 'Unknown error'}`);
    }

    if (criticReview) {
      if (criticReview.approved) {
        parts.push('Critic review passed.');
      } else {
        parts.push(`Critic found ${criticReview.issues.length} issues.`);
      }
    }

    if (result.result) {
      parts.push('');
      parts.push(this.truncate(result.result, 300));
    }

    return parts.join(' ');
  }

  /**
   * Create default metadata when aggregation not available
   */
  private createDefaultMetadata(result: SwarmResult): AggregationMetadata {
    return {
      confidence: result.success ? 0.7 : 0.3,
      coverage: result.metrics.completedTasks / Math.max(result.metrics.totalTasks, 1),
      contributingTasks: result.metrics.completedTasks,
      failedTasks: result.metrics.failedTasks,
      conflictCount: 0,
      deduplicationCount: 0,
      sectionCount: Object.keys(result.taskResults).length,
      totalLength: result.result?.length || 0,
      strategy: 'merge',
      conflictResolution: 'highest_conf',
      aggregatedAt: Date.now(),
    };
  }

  /**
   * Format content based on configuration
   */
  private formatContent(data: PostbackStructuredData): string {
    switch (this.config.format) {
      case 'markdown':
        return this.formatAsMarkdown(data);
      case 'json':
        return this.formatAsJson(data);
      case 'plain':
        return this.formatAsPlain(data);
      case 'structured':
        return this.formatAsMarkdown(data); // Use markdown as display
      default:
        return this.formatAsMarkdown(data);
    }
  }

  /**
   * Apply custom template
   */
  private applyTemplate(template: string, data: PostbackStructuredData): string {
    return template
      .replace(/\{\{goal\}\}/g, data.goal)
      .replace(/\{\{summary\}\}/g, data.summary)
      .replace(/\{\{success\}\}/g, String(data.success))
      .replace(/\{\{qualityScore\}\}/g, String(data.qualityScore))
      .replace(/\{\{taskCount\}\}/g, String(data.taskOutcomes.length))
      .replace(/\{\{completedTasks\}\}/g, String(data.metrics.completedTasks))
      .replace(/\{\{failedTasks\}\}/g, String(data.metrics.failedTasks))
      .replace(/\{\{duration\}\}/g, this.formatDuration(data.durationMs))
      .replace(/\{\{issueCount\}\}/g, String(data.issues.length));
  }

  /**
   * Truncate text
   */
  private truncate(text: string, maxLength?: number): string {
    const limit = maxLength || this.config.truncationLength;
    if (!this.config.truncateResults || text.length <= limit) {
      return text;
    }
    return text.slice(0, limit) + '...';
  }

  /**
   * Format duration
   */
  private formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.round((ms % 60000) / 1000);
    return `${minutes}m ${seconds}s`;
  }

  /**
   * Get status emoji
   */
  private getStatusEmoji(status: TaskOutcome['status']): string {
    switch (status) {
      case 'completed': return '✅';
      case 'failed': return '❌';
      case 'partial': return '⚠️';
      case 'skipped': return '⏭️';
      default: return '•';
    }
  }

  /**
   * Get severity emoji
   */
  private getSeverityEmoji(severity: string): string {
    switch (severity) {
      case 'critical': return '🔴';
      case 'high': return '🟠';
      case 'medium': return '🟡';
      case 'low': return '🟢';
      case 'info': return 'ℹ️';
      default: return '•';
    }
  }
}

/**
 * Create a postback manager with default configuration
 */
export function createSwarmPostback(config?: Partial<PostbackConfig>): SwarmPostback {
  return new SwarmPostback(config);
}
