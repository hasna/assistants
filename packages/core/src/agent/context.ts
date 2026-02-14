import type { Message, ToolCall, ToolResult, ScopeContext, DocumentAttachment } from '@hasna/assistants-shared';
import { generateId, now } from '@hasna/assistants-shared';

/**
 * Assistant context - manages conversation state
 */
export class AssistantContext {
  private messages: Message[] = [];
  private maxMessages: number;
  private scopeContext: ScopeContext | null = null;

  constructor(maxMessages: number = 100) {
    this.maxMessages = maxMessages;
  }

  /**
   * Update maximum message count
   */
  setMaxMessages(maxMessages: number): void {
    this.maxMessages = maxMessages;
    this.prune();
  }

  /**
   * Add a user message
   */
  addUserMessage(content: string): Message {
    const message: Message = {
      id: generateId(),
      role: 'user',
      content,
      timestamp: now(),
    };
    this.messages.push(message);
    this.prune();
    return message;
  }

  /**
   * Add an assistant message
   */
  addAssistantMessage(content: string, toolCalls?: ToolCall[]): Message {
    const message: Message = {
      id: generateId(),
      role: 'assistant',
      content,
      timestamp: now(),
      toolCalls,
    };
    this.messages.push(message);
    this.prune();
    return message;
  }

  /**
   * Add tool results as a user message
   * Also extracts any PDF attachments from tool results
   */
  addToolResults(results: ToolResult[]): Message {
    const documents: DocumentAttachment[] = [];
    const processedResults: ToolResult[] = [];

    for (const result of results) {
      const rawContent = result.rawContent ?? result.content;
      // Check if this is a PDF attachment
      const pdfAttachment = this.extractPdfAttachment(rawContent);
      if (pdfAttachment) {
        documents.push(pdfAttachment);
        // Replace the tool result content with a friendly message
        processedResults.push({
          ...result,
          content: `PDF loaded: ${pdfAttachment.name || 'document.pdf'} (${this.formatBytes(pdfAttachment.source.type === 'base64' ? pdfAttachment.source.data.length * 0.75 : 0)})`,
          rawContent: `PDF loaded: ${pdfAttachment.name || 'document.pdf'} (${this.formatBytes(pdfAttachment.source.type === 'base64' ? pdfAttachment.source.data.length * 0.75 : 0)})`,
          truncated: false,
        });
      } else {
        // Check if this is an image attachment
        const imageAttachment = this.extractImageAttachment(rawContent);
        if (imageAttachment) {
          documents.push(imageAttachment);
          processedResults.push({
            ...result,
            content: `Image loaded: ${imageAttachment.name || 'image'} (${this.formatBytes(imageAttachment.source.type === 'base64' ? imageAttachment.source.data.length * 0.75 : 0)})`,
            rawContent: `Image loaded: ${imageAttachment.name || 'image'} (${this.formatBytes(imageAttachment.source.type === 'base64' ? imageAttachment.source.data.length * 0.75 : 0)})`,
            truncated: false,
          });
        } else {
          processedResults.push({
            ...result,
            rawContent,
          });
        }
      }
    }

    const message: Message = {
      id: generateId(),
      role: 'user',
      content: '',
      timestamp: now(),
      toolResults: processedResults,
      documents: documents.length > 0 ? documents : undefined,
    };
    this.messages.push(message);
    this.prune();
    return message;
  }

  /**
   * Extract PDF attachment from tool result if present
   */
  private extractPdfAttachment(content: string): DocumentAttachment | null {
    if (!content) return null;
    try {
      const parsed = JSON.parse(content);
      if (parsed && parsed.__pdf_attachment__ === true) {
        if (!parsed.data || typeof parsed.data !== 'string') {
          return null;
        }
        return {
          type: 'pdf',
          source: {
            type: 'base64',
            mediaType: parsed.mediaType || 'application/pdf',
            data: parsed.data,
          },
          name: parsed.name,
        };
      }
    } catch {
      // Not JSON or not a PDF attachment
    }
    return null;
  }

  /**
   * Extract image attachment from tool result if present
   */
  private extractImageAttachment(content: string): DocumentAttachment | null {
    if (!content) return null;
    try {
      const parsed = JSON.parse(content);
      if (parsed && parsed.__image_attachment__ === true) {
        if (!parsed.data || typeof parsed.data !== 'string') {
          return null;
        }
        return {
          type: 'image',
          source: {
            type: 'base64',
            mediaType: parsed.mediaType || 'image/png',
            data: parsed.data,
          },
          name: parsed.name,
          mediaType: parsed.mediaType,
        };
      }
    } catch {
      // Not JSON or not an image attachment
    }
    return null;
  }

  /**
   * Format bytes to human readable string
   */
  private formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  /**
   * Add a system message
   */
  addSystemMessage(content: string): Message {
    const message: Message = {
      id: generateId(),
      role: 'system',
      content,
      timestamp: now(),
    };
    this.messages.push(message);
    return message;
  }

  /**
   * Remove system messages matching a predicate
   */
  removeSystemMessages(predicate: (content: string) => boolean): void {
    this.messages = this.messages.filter((msg) => {
      if (msg.role !== 'system') return true;
      const content = msg.content ?? '';
      return !predicate(content);
    });
  }

  /**
   * Get all messages
   */
  getMessages(): Message[] {
    return [...this.messages];
  }

  /**
   * Get the last N messages
   */
  getLastMessages(n: number): Message[] {
    return this.messages.slice(-n);
  }

  /**
   * Clear all messages
   */
  clear(): void {
    this.messages = [];
  }

  /**
   * Prune old messages if over limit
   * Ensures tool_use/tool_result pairs are kept together
   */
  private prune(): void {
    if (this.messages.length <= this.maxMessages) {
      return;
    }

    // Keep system messages
    let systemMessages = this.messages.filter((m) => m.role === 'system');
    const nonSystemMessages = this.messages.filter((m) => m.role !== 'system');

    if (systemMessages.length > this.maxMessages) {
      systemMessages = systemMessages.slice(-this.maxMessages);
    }

    const targetCount = Math.max(0, this.maxMessages - systemMessages.length);
    let recentMessages = targetCount > 0 ? nonSystemMessages.slice(-targetCount) : [];

    // Ensure we don't start with tool_results (orphaned from their tool_use)
    // If the first message has tool_results, we need to find its corresponding
    // assistant message with tool_use
    while (recentMessages.length > 0 && recentMessages[0].toolResults) {
      // Find the previous assistant message that has the matching tool_use
      const firstIndex = nonSystemMessages.indexOf(recentMessages[0]);
      if (firstIndex > 0) {
        // Include the previous message
        recentMessages = nonSystemMessages.slice(firstIndex - 1);
        // But limit to target count + 1 to include the pair
        if (recentMessages.length > targetCount + 1 && targetCount > 0) {
          recentMessages = recentMessages.slice(-(targetCount + 1));
        }
      } else {
        // Can't find the matching message, remove the orphan
        recentMessages = recentMessages.slice(1);
      }
    }

    this.messages = [...systemMessages, ...recentMessages];
  }

  /**
   * Export context for persistence
   */
  export(): Message[] {
    return this.messages;
  }

  /**
   * Import context from persistence
   */
  import(messages: Message[]): void {
    this.messages = messages;
  }

  /**
   * Set scope context for goal tracking
   */
  setScopeContext(scope: ScopeContext | null): void {
    this.scopeContext = scope;
  }

  /**
   * Get current scope context
   */
  getScopeContext(): ScopeContext | null {
    return this.scopeContext;
  }

  /**
   * Clear scope context
   */
  clearScopeContext(): void {
    this.scopeContext = null;
  }
}
