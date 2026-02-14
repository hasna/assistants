/**
 * Swarm Policy Enforcer
 *
 * Integrates decision policy with capability, budget, and guardrails enforcement.
 * Provides user-visible rationale for swarm decisions.
 */

import type { BudgetTracker } from '../budget';
import type { GuardrailsPolicy } from '../guardrails/types';
import type { CapabilityEnforcer } from '../capabilities/enforcer';
import {
  SwarmDecisionPolicy,
  type TaskAnalysis,
  type SwarmDecision,
  type SwarmTriggerReason,
  type DecisionPolicyConfig,
} from './decision-policy';
import type { SwarmConfig } from './types';

/**
 * Enforcement context
 */
export interface EnforcementContext {
  /** Current session ID */
  sessionId: string;
  /** Current assistant ID */
  assistantId?: string;
  /** Current depth */
  depth: number;
  /** Available tools */
  availableTools: string[];
  /** Active budget tracker */
  budgetTracker?: BudgetTracker;
  /** Capability enforcer */
  capabilityEnforcer?: CapabilityEnforcer;
  /** Active guardrails policies */
  guardrailsPolicies?: GuardrailsPolicy[];
}

/**
 * Enforcement result
 */
export interface EnforcementResult {
  /** Whether swarm can be used */
  allowed: boolean;
  /** Final decision */
  decision: SwarmDecision;
  /** Reasons for the decision */
  reasons: SwarmTriggerReason[];
  /** Confidence score */
  confidence: number;
  /** Task analysis */
  analysis: TaskAnalysis;
  /** User-visible rationale */
  rationale: string;
  /** Warnings */
  warnings: string[];
  /** Blocked reasons (if not allowed) */
  blockedReasons: string[];
  /** Suggested configuration */
  suggestedConfig?: Partial<SwarmConfig>;
}

/**
 * Enforcement check type
 */
export type EnforcementCheckType = 'budget' | 'capability' | 'guardrails' | 'depth';

/**
 * Swarm Policy Enforcer
 *
 * Enforces decision policy with additional constraints.
 */
export class SwarmPolicyEnforcer {
  private decisionPolicy: SwarmDecisionPolicy;
  private maxSwarmDepth: number;

  constructor(
    policyConfig?: Partial<DecisionPolicyConfig>,
    maxSwarmDepth: number = 2
  ) {
    this.decisionPolicy = new SwarmDecisionPolicy(policyConfig);
    this.maxSwarmDepth = maxSwarmDepth;
  }

  /**
   * Get the decision policy
   */
  getDecisionPolicy(): SwarmDecisionPolicy {
    return this.decisionPolicy;
  }

  /**
   * Evaluate a task and enforce constraints
   */
  evaluate(
    task: string,
    context: EnforcementContext,
    taskContext?: string
  ): EnforcementResult {
    const warnings: string[] = [];
    const blockedReasons: string[] = [];

    // Get base decision from policy
    const { analysis, decision: baseDecision, reasons, confidence } =
      this.decisionPolicy.evaluate(task, taskContext);

    // Check depth limit
    if (context.depth >= this.maxSwarmDepth) {
      blockedReasons.push(`Maximum swarm depth (${this.maxSwarmDepth}) reached`);
    }

    // Check budget constraints
    if (context.budgetTracker) {
      const budgetStatus = context.budgetTracker.checkBudget('swarm');
      if (budgetStatus.overallExceeded) {
        blockedReasons.push('Swarm budget exceeded');
      } else if (budgetStatus.warningsCount > 0) {
        warnings.push(`Swarm budget has ${budgetStatus.warningsCount} warning(s)`);
      }
    }

    // Check capability constraints
    if (context.capabilityEnforcer) {
      const canSwarm = context.capabilityEnforcer.canSpawnSubassistant({
        assistantId: context.assistantId,
        sessionId: context.sessionId,
        depth: context.depth,
      });
      if (!canSwarm.allowed) {
        blockedReasons.push(`Capability check failed: ${canSwarm.reason}`);
      }
    }

    // Check guardrails
    if (context.guardrailsPolicies && context.guardrailsPolicies.length > 0) {
      for (const policy of context.guardrailsPolicies) {
        if (policy.tools?.rules?.some(r => r.pattern === 'assistant_spawn' && r.action === 'deny')) {
          blockedReasons.push(`Guardrails policy "${policy.name || 'unnamed'}" blocks assistant spawning`);
          break;
        }
      }
    }

    // Check tool availability
    const requiredTools = ['assistant_spawn', 'assistant_delegate'];
    const missingTools = requiredTools.filter(t => !context.availableTools.includes(t));
    if (missingTools.length > 0) {
      blockedReasons.push(`Missing required tools: ${missingTools.join(', ')}`);
    }

    // Determine final decision
    const allowed = blockedReasons.length === 0;
    let finalDecision = baseDecision;

    if (!allowed) {
      finalDecision = 'single_assistant';
    }

    // Build rationale
    const rationale = this.buildRationale(analysis, finalDecision, reasons, blockedReasons, warnings);

    // Build suggested config
    const suggestedConfig = this.buildSuggestedConfig(analysis);

    return {
      allowed,
      decision: finalDecision,
      reasons,
      confidence: allowed ? confidence : 0,
      analysis,
      rationale,
      warnings,
      blockedReasons,
      suggestedConfig: allowed ? suggestedConfig : undefined,
    };
  }

  /**
   * Build user-visible rationale
   */
  private buildRationale(
    analysis: TaskAnalysis,
    decision: SwarmDecision,
    reasons: SwarmTriggerReason[],
    blockedReasons: string[],
    warnings: string[]
  ): string {
    const parts: string[] = [];

    // Decision summary
    switch (decision) {
      case 'swarm':
        parts.push('**Recommendation: Use swarm execution**');
        break;
      case 'ask_user':
        parts.push('**Recommendation: This task may benefit from swarm execution**');
        break;
      case 'single_assistant':
        if (blockedReasons.length > 0) {
          parts.push('**Decision: Single assistant (swarm blocked)**');
        } else {
          parts.push('**Decision: Single assistant execution**');
        }
        break;
    }

    // Analysis summary
    parts.push('');
    parts.push(`Complexity: ${analysis.complexity} (${Math.round(analysis.complexityScore * 100)}%)`);
    parts.push(`Risk: ${analysis.risk} (${Math.round(analysis.riskScore * 100)}%)`);

    if (analysis.parallelizable) {
      parts.push(`Parallelizable: Yes (est. ${analysis.estimatedSubtasks} subtasks)`);
    }

    if (analysis.requiredDomains.length > 0) {
      parts.push(`Domains: ${analysis.requiredDomains.join(', ')}`);
    }

    // Reasons
    if (reasons.length > 0) {
      parts.push('');
      parts.push('**Why swarm was considered:**');
      for (const reason of reasons) {
        parts.push(`- ${this.reasonToText(reason)}`);
      }
    }

    // Blocked reasons
    if (blockedReasons.length > 0) {
      parts.push('');
      parts.push('**Blocked because:**');
      for (const reason of blockedReasons) {
        parts.push(`- ${reason}`);
      }
    }

    // Warnings
    if (warnings.length > 0) {
      parts.push('');
      parts.push('**Warnings:**');
      for (const warning of warnings) {
        parts.push(`- ${warning}`);
      }
    }

    return parts.join('\n');
  }

  /**
   * Convert reason enum to readable text
   */
  private reasonToText(reason: SwarmTriggerReason): string {
    switch (reason) {
      case 'high_complexity':
        return 'Task complexity is high and would benefit from decomposition';
      case 'parallelizable':
        return 'Task can be split into parallel subtasks for faster completion';
      case 'multi_domain':
        return 'Task spans multiple domains requiring different expertise';
      case 'time_sensitive':
        return 'Task is time-sensitive and parallelism would help';
      case 'high_stakes':
        return 'Task is high-stakes and needs review/verification';
      case 'explicit_request':
        return 'User explicitly requested swarm execution';
      case 'user_preference':
        return 'User prefers swarm for this type of task';
      default:
        return reason;
    }
  }

  /**
   * Build suggested swarm configuration based on analysis
   */
  private buildSuggestedConfig(analysis: TaskAnalysis): Partial<SwarmConfig> {
    const config: Partial<SwarmConfig> = {};

    // Adjust concurrency based on subtasks
    if (analysis.estimatedSubtasks > 5) {
      config.maxConcurrent = Math.min(5, Math.ceil(analysis.estimatedSubtasks / 2));
    } else if (analysis.estimatedSubtasks <= 3) {
      config.maxConcurrent = 2;
    }

    // Adjust max tasks
    config.maxTasks = Math.min(20, analysis.estimatedSubtasks + 3);

    // Enable critic for high-risk or high-complexity
    config.enableCritic = analysis.riskScore > 0.5 || analysis.complexityScore > 0.7;

    // Auto-approve for low-risk simple tasks
    config.autoApprove = analysis.riskScore < 0.3 && analysis.complexityScore < 0.5;

    return config;
  }

  /**
   * Generate a concise explanation for display
   */
  generateExplanation(result: EnforcementResult): string {
    const { decision, analysis, reasons, warnings } = result;

    if (decision === 'single_assistant' && result.blockedReasons.length > 0) {
      return `Single assistant (blocked: ${result.blockedReasons[0]})`;
    }

    if (decision === 'single_assistant') {
      return 'Single assistant - task is straightforward';
    }

    if (decision === 'swarm') {
      const primaryReason = reasons[0];
      const reasonText = this.reasonToText(primaryReason).toLowerCase();
      return `Swarm recommended - ${reasonText}`;
    }

    // ask_user
    return `Consider swarm? ${analysis.complexity} complexity, ${analysis.estimatedSubtasks} potential subtasks`;
  }
}
