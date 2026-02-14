/**
 * Swarm Decision Policy
 *
 * Defines when and how to automatically trigger swarm execution.
 * Analyzes task complexity, parallelizability, and risk to determine
 * if a task should be handled by a single assistant or a swarm.
 */

/**
 * Complexity level
 */
export type ComplexityLevel = 'trivial' | 'simple' | 'moderate' | 'complex' | 'very_complex';

/**
 * Risk level
 */
export type RiskLevel = 'none' | 'low' | 'medium' | 'high' | 'critical';

/**
 * Swarm trigger reason
 */
export type SwarmTriggerReason =
  | 'high_complexity'      // Task is too complex for single assistant
  | 'parallelizable'       // Task can be split into parallel subtasks
  | 'multi_domain'         // Task spans multiple domains/skills
  | 'time_sensitive'       // Task needs fast completion via parallelism
  | 'high_stakes'          // Task needs review/verification
  | 'explicit_request'     // User explicitly requested swarm
  | 'user_preference';     // User prefers swarm for this type

/**
 * Decision result
 */
export type SwarmDecision = 'single_assistant' | 'swarm' | 'ask_user';

/**
 * Task analysis result
 */
export interface TaskAnalysis {
  /** Estimated complexity */
  complexity: ComplexityLevel;
  /** Complexity score (0-1) */
  complexityScore: number;
  /** Risk level */
  risk: RiskLevel;
  /** Risk score (0-1) */
  riskScore: number;
  /** Whether task is parallelizable */
  parallelizable: boolean;
  /** Estimated subtask count if parallelized */
  estimatedSubtasks: number;
  /** Domains/skills required */
  requiredDomains: string[];
  /** Whether multiple files/resources are involved */
  multiResource: boolean;
  /** Whether task involves modifications */
  hasModifications: boolean;
  /** Whether task involves external systems */
  hasExternalDeps: boolean;
  /** Keywords that influenced analysis */
  keywords: string[];
}

/**
 * Decision policy configuration
 */
export interface DecisionPolicyConfig {
  /** Enable auto-swarm decisions (default: true) */
  enabled: boolean;
  /** Complexity threshold for swarm (0-1, default: 0.6) */
  complexityThreshold: number;
  /** Risk threshold that requires review (0-1, default: 0.7) */
  riskThreshold: number;
  /** Minimum subtasks to consider parallelization (default: 3) */
  minSubtasksForParallel: number;
  /** Auto-swarm without asking (default: false) */
  autoSwarm: boolean;
  /** Always ask for high-risk tasks (default: true) */
  askForHighRisk: boolean;
  /** Always swarm for multi-domain tasks (default: true) */
  swarmMultiDomain: boolean;
  /** Domains that always trigger swarm when combined */
  triggerDomains: string[][];
  /** Keywords that increase complexity */
  complexityKeywords: string[];
  /** Keywords that increase risk */
  riskKeywords: string[];
  /** Keywords that suggest parallelization */
  parallelKeywords: string[];
}

/**
 * Default decision policy configuration
 */
export const DEFAULT_DECISION_POLICY: DecisionPolicyConfig = {
  enabled: true,
  complexityThreshold: 0.6,
  riskThreshold: 0.7,
  minSubtasksForParallel: 3,
  autoSwarm: false,
  askForHighRisk: true,
  swarmMultiDomain: true,
  triggerDomains: [
    ['frontend', 'backend'],
    ['database', 'api'],
    ['test', 'implementation'],
    ['refactor', 'test'],
  ],
  complexityKeywords: [
    'implement', 'build', 'create', 'design', 'architect',
    'refactor', 'migrate', 'integrate', 'optimize',
    'entire', 'complete', 'full', 'comprehensive',
    'system', 'framework', 'infrastructure',
    'multiple', 'several', 'all', 'every',
  ],
  riskKeywords: [
    'delete', 'remove', 'drop', 'destroy',
    'production', 'database', 'credentials', 'secrets',
    'security', 'authentication', 'authorization',
    'payment', 'billing', 'financial',
    'migration', 'deploy', 'release',
    'breaking', 'change', 'modify',
  ],
  parallelKeywords: [
    'and', 'also', 'then', 'after',
    'multiple', 'several', 'each', 'all',
    'files', 'components', 'modules', 'services',
    'tests', 'endpoints', 'pages', 'features',
    'simultaneously', 'parallel', 'concurrently',
  ],
};

/**
 * Domain keywords for classification
 */
const DOMAIN_KEYWORDS: Record<string, string[]> = {
  frontend: ['ui', 'component', 'react', 'vue', 'angular', 'css', 'style', 'layout', 'page', 'form', 'button'],
  backend: ['api', 'server', 'endpoint', 'route', 'controller', 'service', 'middleware', 'handler'],
  database: ['database', 'db', 'sql', 'query', 'table', 'schema', 'migration', 'model', 'orm'],
  test: ['test', 'spec', 'e2e', 'unit', 'integration', 'coverage', 'mock', 'stub'],
  docs: ['document', 'readme', 'docs', 'comment', 'jsdoc', 'annotation'],
  devops: ['deploy', 'ci', 'cd', 'docker', 'kubernetes', 'pipeline', 'build', 'release'],
  security: ['security', 'auth', 'permission', 'role', 'encrypt', 'token', 'credential'],
  data: ['data', 'analytics', 'report', 'dashboard', 'chart', 'visualization'],
  refactor: ['refactor', 'cleanup', 'optimize', 'improve', 'restructure'],
  implementation: ['implement', 'build', 'create', 'add', 'develop', 'code'],
};

/**
 * Swarm Decision Policy
 *
 * Analyzes tasks and determines whether to use swarm execution.
 */
export class SwarmDecisionPolicy {
  private config: DecisionPolicyConfig;

  constructor(config: Partial<DecisionPolicyConfig> = {}) {
    this.config = { ...DEFAULT_DECISION_POLICY, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): DecisionPolicyConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<DecisionPolicyConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  /**
   * Analyze a task to determine its characteristics
   */
  analyzeTask(task: string, context?: string): TaskAnalysis {
    const text = `${task} ${context || ''}`.toLowerCase();
    const words = text.split(/\s+/);

    // Find matching keywords
    const complexityMatches = this.findMatches(words, this.config.complexityKeywords);
    const riskMatches = this.findMatches(words, this.config.riskKeywords);
    const parallelMatches = this.findMatches(words, this.config.parallelKeywords);

    // Calculate complexity score
    const complexityScore = this.calculateScore(
      complexityMatches.length,
      words.length,
      this.config.complexityKeywords.length
    );

    // Calculate risk score
    const riskScore = this.calculateScore(
      riskMatches.length,
      words.length,
      this.config.riskKeywords.length
    );

    // Detect required domains
    const requiredDomains = this.detectDomains(words);

    // Estimate subtasks
    const estimatedSubtasks = this.estimateSubtasks(text, parallelMatches.length);

    // Check for multi-resource indicators
    const multiResource = this.hasMultiResourceIndicators(text);

    // Check for modifications
    const hasModifications = this.hasModificationIndicators(text);

    // Check for external dependencies
    const hasExternalDeps = this.hasExternalDepIndicators(text);

    return {
      complexity: this.scoreToLevel(complexityScore),
      complexityScore,
      risk: this.riskScoreToLevel(riskScore),
      riskScore,
      parallelizable: estimatedSubtasks >= this.config.minSubtasksForParallel,
      estimatedSubtasks,
      requiredDomains,
      multiResource,
      hasModifications,
      hasExternalDeps,
      keywords: [...complexityMatches, ...riskMatches, ...parallelMatches],
    };
  }

  /**
   * Make a decision about whether to use swarm
   */
  decide(analysis: TaskAnalysis): {
    decision: SwarmDecision;
    reasons: SwarmTriggerReason[];
    confidence: number;
  } {
    if (!this.config.enabled) {
      return {
        decision: 'single_assistant',
        reasons: [],
        confidence: 1.0,
      };
    }

    const reasons: SwarmTriggerReason[] = [];
    let swarmScore = 0;
    let askScore = 0;

    // Check complexity threshold
    if (analysis.complexityScore >= this.config.complexityThreshold) {
      reasons.push('high_complexity');
      swarmScore += 0.3;
    }

    // Check parallelizability
    if (analysis.parallelizable) {
      reasons.push('parallelizable');
      swarmScore += 0.25;
    }

    // Check multi-domain
    if (analysis.requiredDomains.length >= 2 && this.config.swarmMultiDomain) {
      reasons.push('multi_domain');
      swarmScore += 0.25;

      // Check for trigger domain combinations
      for (const combo of this.config.triggerDomains) {
        if (combo.every(d => analysis.requiredDomains.includes(d))) {
          swarmScore += 0.1;
          break;
        }
      }
    }

    // Check high stakes / risk
    if (analysis.riskScore >= this.config.riskThreshold) {
      reasons.push('high_stakes');
      if (this.config.askForHighRisk) {
        askScore += 0.4;
      } else {
        swarmScore += 0.2; // Use swarm for verification
      }
    }

    // Determine decision
    let decision: SwarmDecision;
    let confidence: number;

    if (reasons.length === 0) {
      decision = 'single_assistant';
      confidence = 1.0 - analysis.complexityScore;
    } else if (askScore > swarmScore && !this.config.autoSwarm) {
      decision = 'ask_user';
      confidence = askScore / (askScore + swarmScore);
    } else if (swarmScore >= 0.4 && (this.config.autoSwarm || swarmScore > askScore)) {
      decision = 'swarm';
      confidence = Math.min(swarmScore, 1.0);
    } else {
      decision = 'ask_user';
      confidence = 0.5 + (swarmScore + askScore) / 4;
    }

    return {
      decision,
      reasons,
      confidence,
    };
  }

  /**
   * Full analysis and decision
   */
  evaluate(task: string, context?: string): {
    analysis: TaskAnalysis;
    decision: SwarmDecision;
    reasons: SwarmTriggerReason[];
    confidence: number;
  } {
    const analysis = this.analyzeTask(task, context);
    const { decision, reasons, confidence } = this.decide(analysis);
    return { analysis, decision, reasons, confidence };
  }

  // ============================================
  // Private Helpers
  // ============================================

  private findMatches(words: string[], keywords: string[]): string[] {
    const matches: string[] = [];
    for (const word of words) {
      if (keywords.some(k => word.includes(k) || k.includes(word))) {
        matches.push(word);
      }
    }
    return [...new Set(matches)];
  }

  private calculateScore(matches: number, totalWords: number, totalKeywords: number): number {
    // Normalized score based on match density and coverage
    const density = Math.min(matches / Math.max(totalWords / 10, 1), 1);
    const coverage = Math.min(matches / 5, 1); // Cap at 5 matches for full coverage score
    return (density * 0.4 + coverage * 0.6);
  }

  private scoreToLevel(score: number): ComplexityLevel {
    if (score < 0.2) return 'trivial';
    if (score < 0.4) return 'simple';
    if (score < 0.6) return 'moderate';
    if (score < 0.8) return 'complex';
    return 'very_complex';
  }

  private riskScoreToLevel(score: number): RiskLevel {
    if (score < 0.1) return 'none';
    if (score < 0.3) return 'low';
    if (score < 0.5) return 'medium';
    if (score < 0.7) return 'high';
    return 'critical';
  }

  private detectDomains(words: string[]): string[] {
    const domains: Set<string> = new Set();

    for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
      for (const word of words) {
        if (keywords.some(k => word.includes(k))) {
          domains.add(domain);
          break;
        }
      }
    }

    return Array.from(domains);
  }

  private estimateSubtasks(text: string, parallelMatches: number): number {
    // Base estimate from parallel keywords
    let estimate = Math.max(1, parallelMatches);

    // Look for numeric indicators
    const numbers = text.match(/\b(\d+)\s*(files?|components?|modules?|endpoints?|tests?|pages?)/gi);
    if (numbers) {
      for (const match of numbers) {
        const num = parseInt(match.match(/\d+/)?.[0] || '0');
        if (num > estimate) estimate = num;
      }
    }

    // Look for list indicators
    const listItems = text.match(/(?:^|\n)\s*[-*\d.]\s+/g);
    if (listItems && listItems.length > estimate) {
      estimate = listItems.length;
    }

    // Look for "and" conjunctions suggesting multiple items
    const ands = (text.match(/\band\b/g) || []).length;
    estimate = Math.max(estimate, ands + 1);

    return Math.min(estimate, 20); // Cap at 20
  }

  private hasMultiResourceIndicators(text: string): boolean {
    return /\b(files?|components?|modules?|services?|endpoints?)\b/i.test(text) &&
           /\b(multiple|several|many|all|each|every)\b/i.test(text);
  }

  private hasModificationIndicators(text: string): boolean {
    return /\b(update|modify|change|edit|refactor|delete|remove|replace|add|create)\b/i.test(text);
  }

  private hasExternalDepIndicators(text: string): boolean {
    return /\b(api|external|third-party|service|webhook|integration|deploy|production)\b/i.test(text);
  }
}
