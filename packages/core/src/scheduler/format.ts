/**
 * Scheduler formatting utilities
 */

/**
 * Format a timestamp as relative time (e.g., "in 5m", "2h ago")
 * @param timestamp - Unix timestamp in milliseconds
 * @param now - Current time (defaults to Date.now())
 * @returns Formatted relative time string
 */
export function formatRelativeTime(
  timestamp: number | undefined,
  now: number = Date.now()
): string {
  if (!timestamp) return 'n/a';

  const diff = timestamp - now;
  const absDiff = Math.abs(diff);
  const isPast = diff < 0;

  const seconds = Math.floor(absDiff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  let timeStr: string;
  if (days > 0) {
    timeStr = `${days}d ${hours % 24}h`;
  } else if (hours > 0) {
    timeStr = `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    timeStr = `${minutes}m ${seconds % 60}s`;
  } else {
    timeStr = `${seconds}s`;
  }

  return isPast ? `${timeStr} ago` : `in ${timeStr}`;
}

/**
 * Format a timestamp as absolute time for display
 * @param timestamp - Unix timestamp in milliseconds
 * @returns Formatted date/time string or 'n/a'
 */
export function formatAbsoluteTime(timestamp: number | undefined): string {
  if (!timestamp) return 'n/a';
  return new Date(timestamp).toLocaleString();
}
