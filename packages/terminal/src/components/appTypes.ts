export interface QueuedMessage {
  id: string;
  sessionId: string;
  content: string;
  queuedAt: number;
  mode: 'queued' | 'inline';
}
