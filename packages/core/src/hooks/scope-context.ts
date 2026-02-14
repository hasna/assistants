import type { ScopeContext, Message, ScopeVerificationConfig } from '@hasna/assistants-shared';
import type { LLMClient } from '../llm/client';
import { generateId } from '@hasna/assistants-shared';

/**
 * Default patterns that indicate simple questions/greetings
 * that don't need scope verification
 */
const DEFAULT_EXCLUDE_PATTERNS = [
  /^(hi|hello|hey|good\s+(morning|afternoon|evening))[\s!.,]*$/i,
  /^(thanks|thank\s+you|ty|thx)[\s!.,]*$/i,
  /^(bye|goodbye|see\s+you|later)[\s!.,]*$/i,
  /^what\s+(is|are)\s+/i,
  /^how\s+(do|does|can|could)\s+/i,
  /^(can|could)\s+you\s+(tell|explain|describe)\s+/i,
  /^(who|when|where|why)\s+(is|are|was|were|did)\s+/i,
  /^\?+$/,
];

/**
 * Manages scope context for goal tracking and verification
 */
export class ScopeContextManager {
  private scopeContext: ScopeContext | null = null;
  private config: ScopeVerificationConfig;

  constructor(config: ScopeVerificationConfig = {}) {
    this.config = {
      enabled: config.enabled ?? true,
      maxRetries: config.maxRetries ?? 2,
      excludePatterns: config.excludePatterns ?? [],
    };
  }

  /**
   * Update configuration
   */
  setConfig(config: ScopeVerificationConfig): void {
    this.config = {
      enabled: config.enabled ?? this.config.enabled,
      maxRetries: config.maxRetries ?? this.config.maxRetries,
      excludePatterns: config.excludePatterns ?? this.config.excludePatterns,
    };
  }

  /**
   * Check if verification is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled !== false;
  }

  /**
   * Check if a message should be excluded from verification
   */
  shouldExclude(message: string): boolean {
    const trimmed = message.trim();

    // Check default exclude patterns
    for (const pattern of DEFAULT_EXCLUDE_PATTERNS) {
      if (pattern.test(trimmed)) {
        return true;
      }
    }

    // Check user-configured exclude patterns
    const userPatterns = this.config.excludePatterns || [];
    for (const patternStr of userPatterns) {
      try {
        const pattern = new RegExp(patternStr, 'i');
        if (pattern.test(trimmed)) {
          return true;
        }
      } catch {
        // Invalid regex, skip
        continue;
      }
    }

    // Check for skip prefix (! at start)
    if (trimmed.startsWith('!')) {
      return true;
    }

    return false;
  }

  /**
   * Create scope context from user message
   * Uses LLM to extract goals from the message
   */
  async createContext(
    message: string,
    llmClient?: LLMClient
  ): Promise<ScopeContext | null> {
    if (!this.isEnabled()) {
      return null;
    }

    if (this.shouldExclude(message)) {
      return null;
    }

    const goals = await this.extractGoals(message, llmClient);
    if (goals.length === 0) {
      return null;
    }

    this.scopeContext = {
      originalMessage: message,
      extractedGoals: goals,
      timestamp: Date.now(),
      verificationAttempts: 0,
      maxAttempts: this.config.maxRetries ?? 2,
    };

    return this.scopeContext;
  }

  /**
   * Extract goals from a user message
   */
  private async extractGoals(
    message: string,
    llmClient?: LLMClient
  ): Promise<string[]> {
    // If no LLM client, use simple heuristics
    if (!llmClient) {
      return this.extractGoalsHeuristic(message);
    }

    try {
      const prompt = `Analyze the following user request and extract the specific goals or tasks they want accomplished.
Return a JSON array of strings, where each string is a concise, actionable goal.
If the message is just a greeting, question, or doesn't contain actionable goals, return an empty array [].

User request: "${message}"

Respond with ONLY a JSON array, no other text. Example: ["goal 1", "goal 2"]`;

      const messages: Message[] = [
        { id: generateId(), role: 'user', content: prompt, timestamp: Date.now() },
      ];

      let response = '';
      for await (const chunk of llmClient.chat(messages)) {
        if (chunk.type === 'text' && chunk.content) {
          response += chunk.content;
        }
      }

      // Parse the JSON response
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const goals = JSON.parse(jsonMatch[0]);
        if (Array.isArray(goals) && goals.every((g) => typeof g === 'string')) {
          return goals.filter((g) => g.trim().length > 0);
        }
      }

      // Fallback to heuristics if parsing fails
      return this.extractGoalsHeuristic(message);
    } catch (error) {
      // Fallback to heuristics on error
      console.error('Goal extraction error:', error);
      return this.extractGoalsHeuristic(message);
    }
  }

  /**
   * Simple heuristic goal extraction (fallback when no LLM)
   */
  private extractGoalsHeuristic(message: string): string[] {
    const goals: string[] = [];
    const trimmed = message.trim();

    // Skip very short messages
    if (trimmed.length < 10) {
      return goals;
    }

    // Look for imperative verbs that indicate tasks
    const taskIndicators = [
      /^(create|make|build|write|implement|add|fix|update|change|modify|remove|delete|refactor)/i,
      /^(find|search|look for|locate|get|fetch)/i,
      /^(run|execute|test|deploy|install|configure|setup)/i,
      /^(explain|describe|document|analyze|review)/i,
    ];

    for (const pattern of taskIndicators) {
      if (pattern.test(trimmed)) {
        // The whole message is likely a goal
        goals.push(trimmed);
        return goals;
      }
    }

    // Look for numbered lists or bullet points
    const lines = trimmed.split(/\n/);
    for (const line of lines) {
      const listMatch = line.match(/^[\d\-\*\•]\s*[.)\]:]?\s*(.+)/);
      if (listMatch && listMatch[1].trim().length > 5) {
        goals.push(listMatch[1].trim());
      }
    }

    // If no specific goals found but message is substantial, treat whole thing as one goal
    if (goals.length === 0 && trimmed.length >= 20) {
      goals.push(trimmed);
    }

    return goals;
  }

  /**
   * Get current scope context
   */
  getContext(): ScopeContext | null {
    return this.scopeContext;
  }

  /**
   * Set scope context directly (for restoring from storage)
   */
  setContext(context: ScopeContext | null): void {
    this.scopeContext = context;
  }

  /**
   * Increment verification attempt counter
   */
  incrementAttempts(): void {
    if (this.scopeContext) {
      this.scopeContext.verificationAttempts++;
    }
  }

  /**
   * Check if max verification attempts reached
   */
  hasReachedMaxAttempts(): boolean {
    if (!this.scopeContext) {
      return true;
    }
    return this.scopeContext.verificationAttempts >= this.scopeContext.maxAttempts;
  }

  /**
   * Clear scope context (on session end or new message)
   */
  clear(): void {
    this.scopeContext = null;
  }
}
