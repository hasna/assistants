import type { ErrorCode } from './codes';
import { AssistantError } from './types';

export interface ErrorStats {
  code: ErrorCode;
  count: number;
  lastOccurrence: string;
  samples: string[];
}

export class ErrorAggregator {
  private stats: Map<ErrorCode, ErrorStats> = new Map();

  record(error: AssistantError): void {
    const existing = this.stats.get(error.code);
    if (existing) {
      existing.count += 1;
      existing.lastOccurrence = new Date().toISOString();
      if (existing.samples.length < 5) {
        existing.samples.push(error.message);
      }
    } else {
      this.stats.set(error.code, {
        code: error.code,
        count: 1,
        lastOccurrence: new Date().toISOString(),
        samples: [error.message],
      });
    }
  }

  getStats(): ErrorStats[] {
    return Array.from(this.stats.values());
  }

  clear(): void {
    this.stats.clear();
  }
}
