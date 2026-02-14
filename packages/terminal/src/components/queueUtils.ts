import type { QueuedMessage } from './appTypes';

export function takeNextQueuedMessage(
  queue: QueuedMessage[],
  sessionId: string
): { next: QueuedMessage | null; remaining: QueuedMessage[] } {
  const next = queue.find((msg) => msg.sessionId === sessionId);
  if (!next) {
    return { next: null, remaining: queue };
  }
  return {
    next,
    remaining: queue.filter((msg) => msg.id !== next.id),
  };
}
