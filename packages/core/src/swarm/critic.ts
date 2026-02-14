/**
 * Swarm Critic/Verification
 *
 * Validates aggregated results, checks for conflicts/missing steps/unsafe actions,
 * and produces fixes or follow-up recommendations.
 */

import type { SubassistantManager, SubassistantConfig, SubassistantResult } from '../agent/subagent-manager';
import type { SwarmTask, SwarmRole } from './types';
import { ROLE_SYSTEM_PROMPTS } from './types';
import type { AggregatedResult } from './aggregator';

/**
 * Issue severity
 */
export type IssueSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

/**
 * Issue category
 */
export type IssueCategory =
  | 'conflict'         // Contradictory information
  | 'missing_step'     // Missing implementation step
  | 'unsafe_action'    // Potentially dangerous operation
  | 'incomplete'       // Task not fully addressed
  | 'quality'          // Quality/style issue
  | 'consistency'      // Inconsistent with context
  | 'security'         // Security concern
  | 'performance'      // Performance concern
  | 'correctness';     // Logical/factual error

/**
 * Identified issue
 */
export interface CriticIssue {
  /** Issue ID */
  id: string;
  /** Issue category */
  category: IssueCategory;
  /** Severity level */
  severity: IssueSeverity;
  /** Issue title */
  title: string;
  /** Detailed description */
  description: string;
  /** Location in the output (if applicable) */
  location?: string;
  /** Related task IDs */
  relatedTasks?: string[];
  /** Suggested fix */
  suggestedFix?: string;
  /** Whether fix is auto-applicable */
  autoFixable: boolean;
}

/**
 * Follow-up action
 */
export interface FollowUpAction {
  /** Action ID */
  id: string;
  /** Action type */
  type: 'task' | 'revision' | 'manual' | 'verification';
  /** Action description */
  description: string;
  /** Priority (1 = highest) */
  priority: number;
  /** Related issues */
  relatedIssues: string[];
  /** Task definition if type is 'task' */
  taskDefinition?: Partial<SwarmTask>;
  /** Whether action is required */
  required: boolean;
}

/**
 * Critic review result
 */
export interface CriticReview {
  /** Whether the review passed */
  approved: boolean;
  /** Overall quality score (0-1) */
  qualityScore: number;
  /** Confidence in the review */
  confidence: number;
  /** Issues found */
  issues: CriticIssue[];
  /** Follow-up actions */
  followUps: FollowUpAction[];
  /** Summary of the review */
  summary: string;
  /** Detailed feedback */
  feedback: string;
  /** Review timestamp */
  reviewedAt: number;
  /** Review duration */
  durationMs: number;
}

/**
 * Critic configuration
 */
export interface CriticConfig {
  /** Enable critic review */
  enabled: boolean;
  /** Severity threshold for blocking (issues at or above this block approval) */
  blockingSeverity: IssueSeverity;
  /** Maximum issues before auto-fail */
  maxIssues: number;
  /** Categories that always block */
  blockingCategories: IssueCategory[];
  /** Enable security checks */
  checkSecurity: boolean;
  /** Enable performance checks */
  checkPerformance: boolean;
  /** Enable consistency checks */
  checkConsistency: boolean;
  /** Custom review prompt additions */
  customPrompt?: string;
  /** Maximum turns for critic assistant */
  maxTurns: number;
  /** Tools available to critic */
  criticTools: string[];
  /** Timeout for review */
  timeoutMs: number;
}

/**
 * Default critic configuration
 */
export const DEFAULT_CRITIC_CONFIG: CriticConfig = {
  enabled: true,
  blockingSeverity: 'high',
  maxIssues: 10,
  blockingCategories: ['unsafe_action', 'security', 'correctness'],
  checkSecurity: true,
  checkPerformance: true,
  checkConsistency: true,
  maxTurns: 10,
  criticTools: ['read', 'grep', 'glob'],
  timeoutMs: 60000,
};

/**
 * Severity weight for scoring
 */
const SEVERITY_WEIGHTS: Record<IssueSeverity, number> = {
  critical: 1.0,
  high: 0.7,
  medium: 0.4,
  low: 0.2,
  info: 0.05,
};

/**
 * Swarm Critic
 *
 * Validates swarm results and identifies issues.
 */
export class SwarmCritic {
  private config: CriticConfig;

  constructor(config?: Partial<CriticConfig>) {
    this.config = { ...DEFAULT_CRITIC_CONFIG, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): CriticConfig {
    return { ...this.config };
  }

  /**
   * Check if critic is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Run critic review using subassistant
   */
  async review(params: {
    goal: string;
    tasks: SwarmTask[];
    aggregatedResult: AggregatedResult;
    subassistantManager: SubassistantManager;
    sessionId: string;
    cwd: string;
    depth: number;
  }): Promise<CriticReview> {
    if (!this.config.enabled) {
      return this.createPassingReview('Critic disabled');
    }

    const startTime = Date.now();

    // Build critic prompt
    const prompt = this.buildCriticPrompt(params);

    // Run critic assistant
    const result = await this.runCriticAssistant({
      prompt,
      subassistantManager: params.subassistantManager,
      sessionId: params.sessionId,
      cwd: params.cwd,
      depth: params.depth,
    });

    // Parse critic output
    const review = this.parseCriticOutput(result, startTime);

    // Apply static checks
    const staticIssues = this.runStaticChecks(params.aggregatedResult, params.tasks);
    review.issues.push(...staticIssues);

    // Recalculate scores with static issues
    this.recalculateScores(review);

    return review;
  }

  /**
   * Run static validation checks (without LLM)
   */
  runStaticChecks(
    result: AggregatedResult,
    tasks: SwarmTask[]
  ): CriticIssue[] {
    const issues: CriticIssue[] = [];
    let issueId = 0;

    // Check for low confidence
    if (result.metadata.confidence < 0.5) {
      issues.push({
        id: `static-${issueId++}`,
        category: 'quality',
        severity: 'medium',
        title: 'Low confidence score',
        description: `Aggregated result has low confidence (${(result.metadata.confidence * 100).toFixed(1)}%)`,
        autoFixable: false,
      });
    }

    // Check for high failure rate
    if (result.metadata.failedTasks > 0) {
      const failRate = result.metadata.failedTasks /
        (result.metadata.contributingTasks + result.metadata.failedTasks);

      if (failRate > 0.3) {
        issues.push({
          id: `static-${issueId++}`,
          category: 'incomplete',
          severity: failRate > 0.5 ? 'high' : 'medium',
          title: 'High task failure rate',
          description: `${result.metadata.failedTasks} tasks failed (${(failRate * 100).toFixed(1)}% failure rate)`,
          autoFixable: false,
        });
      }
    }

    // Check for conflicts
    if (result.metadata.conflictCount > 0) {
      issues.push({
        id: `static-${issueId++}`,
        category: 'conflict',
        severity: result.metadata.conflictCount > 3 ? 'high' : 'medium',
        title: 'Conflicts detected',
        description: `${result.metadata.conflictCount} conflicts were detected and resolved. Manual review recommended.`,
        autoFixable: false,
      });
    }

    // Check for empty result
    if (!result.content || result.content.length < 50) {
      issues.push({
        id: `static-${issueId++}`,
        category: 'incomplete',
        severity: 'critical',
        title: 'Empty or minimal result',
        description: 'The aggregated result is empty or very short',
        autoFixable: false,
      });
    }

    // Check for unsafe patterns in content
    if (this.config.checkSecurity) {
      const securityIssues = this.checkSecurityPatterns(result.content);
      issues.push(...securityIssues.map(i => ({
        ...i,
        id: `static-${issueId++}`,
      })));
    }

    // Check task coverage
    const coveredTaskIds = new Set(result.sections.flatMap(s => s.sources));
    const uncoveredTasks = tasks.filter(t => !coveredTaskIds.has(t.id));

    if (uncoveredTasks.length > 0) {
      issues.push({
        id: `static-${issueId++}`,
        category: 'missing_step',
        severity: uncoveredTasks.length > 2 ? 'high' : 'medium',
        title: 'Tasks not covered in result',
        description: `${uncoveredTasks.length} tasks have no corresponding content in the result`,
        relatedTasks: uncoveredTasks.map(t => t.id),
        autoFixable: false,
      });
    }

    return issues;
  }

  /**
   * Check for blocking issues
   */
  hasBlockingIssues(review: CriticReview): boolean {
    const blockingThreshold = SEVERITY_WEIGHTS[this.config.blockingSeverity];

    for (const issue of review.issues) {
      // Check severity
      if (SEVERITY_WEIGHTS[issue.severity] >= blockingThreshold) {
        return true;
      }

      // Check blocking categories
      if (this.config.blockingCategories.includes(issue.category)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Generate follow-up tasks from issues
   */
  generateFollowUps(review: CriticReview): FollowUpAction[] {
    const followUps: FollowUpAction[] = [];
    let actionId = 0;

    for (const issue of review.issues) {
      if (issue.severity === 'info') continue;

      const action: FollowUpAction = {
        id: `followup-${actionId++}`,
        type: issue.autoFixable ? 'revision' : 'manual',
        description: issue.suggestedFix || `Address: ${issue.title}`,
        priority: this.severityToPriority(issue.severity),
        relatedIssues: [issue.id],
        required: SEVERITY_WEIGHTS[issue.severity] >= SEVERITY_WEIGHTS['high'],
      };

      // Create task definition for fixable issues
      if (issue.autoFixable || issue.category === 'missing_step') {
        action.type = 'task';
        action.taskDefinition = {
          description: `Fix: ${issue.title}\n\n${issue.description}\n\nSuggested fix: ${issue.suggestedFix || 'Address the issue'}`,
          role: 'worker',
          priority: action.priority,
        };
      }

      followUps.push(action);
    }

    return followUps;
  }

  // ============================================
  // Private Methods
  // ============================================

  /**
   * Build critic prompt
   */
  private buildCriticPrompt(params: {
    goal: string;
    tasks: SwarmTask[];
    aggregatedResult: AggregatedResult;
  }): string {
    const taskSummary = params.tasks.map(t =>
      `- [${t.id}] ${t.description}`
    ).join('\n');

    let prompt = `# Critic Review Task

## Original Goal
${params.goal}

## Tasks Executed
${taskSummary}

## Aggregated Result
${params.aggregatedResult.content}

## Metadata
- Contributing tasks: ${params.aggregatedResult.metadata.contributingTasks}
- Failed tasks: ${params.aggregatedResult.metadata.failedTasks}
- Confidence: ${(params.aggregatedResult.metadata.confidence * 100).toFixed(1)}%
- Conflicts: ${params.aggregatedResult.metadata.conflictCount}

## Review Instructions

Analyze the result and provide your assessment as JSON with:
- "approved": boolean - whether the result meets quality standards
- "qualityScore": number (0-1) - overall quality assessment
- "issues": array of issues found, each with:
  - "category": one of "conflict", "missing_step", "unsafe_action", "incomplete", "quality", "consistency", "security", "performance", "correctness"
  - "severity": one of "critical", "high", "medium", "low", "info"
  - "title": brief issue title
  - "description": detailed description
  - "suggestedFix": suggested resolution (optional)
- "summary": brief summary of findings
- "feedback": detailed feedback for improvement

Check for:
`;

    if (this.config.checkSecurity) {
      prompt += '- Security issues (credentials, unsafe operations)\n';
    }
    if (this.config.checkPerformance) {
      prompt += '- Performance concerns\n';
    }
    if (this.config.checkConsistency) {
      prompt += '- Consistency with the original goal\n';
    }

    prompt += `- Completeness of the response
- Correctness of information
- Missing steps or tasks
- Conflicting information

`;

    if (this.config.customPrompt) {
      prompt += `\n## Additional Instructions\n${this.config.customPrompt}\n`;
    }

    return prompt;
  }

  /**
   * Run critic assistant
   */
  private async runCriticAssistant(params: {
    prompt: string;
    subassistantManager: SubassistantManager;
    sessionId: string;
    cwd: string;
    depth: number;
  }): Promise<SubassistantResult> {
    const systemPrompt = ROLE_SYSTEM_PROMPTS.critic;

    const config: SubassistantConfig = {
      task: `${systemPrompt}\n\n---\n\n${params.prompt}`,
      tools: this.config.criticTools,
      maxTurns: this.config.maxTurns,
      parentSessionId: params.sessionId,
      depth: params.depth + 1,
      cwd: params.cwd,
    };

    // Execute with timeout
    const timeoutPromise = new Promise<SubassistantResult>((_, reject) => {
      setTimeout(() => reject(new Error('Critic timeout')), this.config.timeoutMs);
    });

    try {
      return await Promise.race([
        params.subassistantManager.spawn(config),
        timeoutPromise,
      ]);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        toolCalls: 0,
        turns: 0,
      };
    }
  }

  /**
   * Parse critic output
   */
  private parseCriticOutput(result: SubassistantResult, startTime: number): CriticReview {
    const durationMs = Date.now() - startTime;

    if (!result.success || !result.result) {
      return {
        approved: false,
        qualityScore: 0,
        confidence: 0,
        issues: [{
          id: 'parse-error',
          category: 'quality',
          severity: 'high',
          title: 'Critic review failed',
          description: result.error || 'No result from critic assistant',
          autoFixable: false,
        }],
        followUps: [],
        summary: 'Critic review failed',
        feedback: result.error || 'No output from critic',
        reviewedAt: Date.now(),
        durationMs,
      };
    }

    try {
      // Extract JSON from output
      const jsonMatch = result.result.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in critic output');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      return {
        approved: parsed.approved ?? false,
        qualityScore: parsed.qualityScore ?? 0.5,
        confidence: 0.8, // Default confidence in critic's assessment
        issues: (parsed.issues || []).map((issue: CriticIssue, index: number) => ({
          id: `critic-${index}`,
          category: issue.category || 'quality',
          severity: issue.severity || 'medium',
          title: issue.title || 'Unknown issue',
          description: issue.description || '',
          suggestedFix: issue.suggestedFix,
          autoFixable: !!issue.suggestedFix,
        })),
        followUps: [],
        summary: parsed.summary || '',
        feedback: parsed.feedback || '',
        reviewedAt: Date.now(),
        durationMs,
      };
    } catch (error) {
      // Couldn't parse JSON, create basic review from text
      const approved = result.result.toLowerCase().includes('approved') &&
                      !result.result.toLowerCase().includes('not approved');

      return {
        approved,
        qualityScore: approved ? 0.7 : 0.3,
        confidence: 0.5,
        issues: [],
        followUps: [],
        summary: result.result.slice(0, 200),
        feedback: result.result,
        reviewedAt: Date.now(),
        durationMs,
      };
    }
  }

  /**
   * Check for security patterns
   */
  private checkSecurityPatterns(content: string): Omit<CriticIssue, 'id'>[] {
    const issues: Omit<CriticIssue, 'id'>[] = [];

    // Check for potential credential exposure
    const credentialPatterns = [
      /api[_-]?key\s*[=:]\s*['"][^'"]+['"]/i,
      /password\s*[=:]\s*['"][^'"]+['"]/i,
      /secret\s*[=:]\s*['"][^'"]+['"]/i,
      /token\s*[=:]\s*['"][^'"]+['"]/i,
    ];

    for (const pattern of credentialPatterns) {
      if (pattern.test(content)) {
        issues.push({
          category: 'security',
          severity: 'critical',
          title: 'Potential credential exposure',
          description: 'Content may contain hardcoded credentials',
          suggestedFix: 'Remove or mask sensitive values',
          autoFixable: false,
        });
        break;
      }
    }

    // Check for unsafe operations
    const unsafePatterns = [
      { pattern: /rm\s+-rf\s+[/*]/, title: 'Dangerous file deletion' },
      { pattern: /drop\s+database/i, title: 'Database deletion' },
      { pattern: /truncate\s+table/i, title: 'Table truncation' },
      { pattern: /--force/, title: 'Force flag usage' },
    ];

    for (const { pattern, title } of unsafePatterns) {
      if (pattern.test(content)) {
        issues.push({
          category: 'unsafe_action',
          severity: 'high',
          title,
          description: `Found potentially unsafe operation: ${pattern.source}`,
          autoFixable: false,
        });
      }
    }

    return issues;
  }

  /**
   * Recalculate scores based on issues
   */
  private recalculateScores(review: CriticReview): void {
    if (review.issues.length === 0) {
      review.qualityScore = Math.max(review.qualityScore, 0.8);
      return;
    }

    // Calculate penalty from issues
    let totalPenalty = 0;
    for (const issue of review.issues) {
      totalPenalty += SEVERITY_WEIGHTS[issue.severity];
    }

    // Apply penalty (capped)
    const penalty = Math.min(totalPenalty * 0.15, 0.8);
    review.qualityScore = Math.max(0, review.qualityScore - penalty);

    // Update approved status
    if (this.hasBlockingIssues(review)) {
      review.approved = false;
    }

    // Generate follow-ups
    review.followUps = this.generateFollowUps(review);
  }

  /**
   * Convert severity to priority
   */
  private severityToPriority(severity: IssueSeverity): number {
    switch (severity) {
      case 'critical': return 1;
      case 'high': return 2;
      case 'medium': return 3;
      case 'low': return 4;
      case 'info': return 5;
      default: return 3;
    }
  }

  /**
   * Create a passing review
   */
  private createPassingReview(reason: string): CriticReview {
    return {
      approved: true,
      qualityScore: 1.0,
      confidence: 1.0,
      issues: [],
      followUps: [],
      summary: reason,
      feedback: '',
      reviewedAt: Date.now(),
      durationMs: 0,
    };
  }
}

/**
 * Create a critic with default configuration
 */
export function createSwarmCritic(config?: Partial<CriticConfig>): SwarmCritic {
  return new SwarmCritic(config);
}
