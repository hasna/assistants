import { dirname } from 'path';
import type { Skill } from '@hasna/assistants-shared';
import { substituteVariables } from '@hasna/assistants-shared';
import { getRuntime } from '../runtime';

/**
 * Skill executor - prepares and executes skills
 */
export class SkillExecutor {
  constructor() {}

  /**
   * Prepare skill content with argument substitution
   */
  async prepare(skill: Skill, args: string[]): Promise<string> {
    let content = skill.content;

    // Substitute variables
    content = substituteVariables(content, args);

    // If $ARGUMENTS wasn't in the content, append it
    if (!skill.content.includes('$ARGUMENTS') && args.length > 0) {
      content += `\n\nARGUMENTS: ${args.join(' ')}`;
    }

    // Execute dynamic context injection (backtick commands)
    content = await this.executeDynamicContext(content, skill.filePath);

    return content;
  }

  /**
   * Execute backtick commands for dynamic context injection
   * Syntax: !`command`
   */
  private async executeDynamicContext(content: string, skillFilePath: string): Promise<string> {
    const backtickPattern = /!\`([^`]+)\`/g;
    const matches = [...content.matchAll(backtickPattern)];

    if (matches.length === 0) {
      return content;
    }

    // Get the skill's directory for relative command execution
    const skillDir = dirname(skillFilePath);
    let result = content;
    const runtime = getRuntime();

    for (const match of matches) {
      const fullMatch = match[0];
      const command = match[1];

      try {
        // Execute the command in the skill's directory
        const output = await runtime.shell`${command}`.cwd(skillDir).quiet().text();
        result = result.replace(fullMatch, output.trim());
      } catch (error) {
        // If command fails, include error message
        const errorMsg = error instanceof Error ? error.message : String(error);
        result = result.replace(fullMatch, `[Command failed: ${errorMsg}]`);
      }
    }

    return result;
  }

  /**
   * Check if a skill should be auto-invoked based on user message
   */
  shouldAutoInvoke(skill: Skill, userMessage: string): boolean {
    if (skill.disableModelInvocation) {
      return false;
    }

    // Simple keyword matching - could be enhanced with embeddings
    const keywords = skill.description.toLowerCase().split(/\s+/);
    const messageWords = userMessage.toLowerCase().split(/\s+/);

    let matchCount = 0;
    for (const keyword of keywords) {
      if (keyword.length > 3 && messageWords.includes(keyword)) {
        matchCount++;
      }
    }

    // Require at least 2 keyword matches
    return matchCount >= 2;
  }
}
