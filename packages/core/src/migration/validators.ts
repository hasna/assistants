import { existsSync } from 'fs';

export function assertNoExistingTarget(targetPath: string): void {
  if (existsSync(targetPath)) {
    throw new Error(`Target already exists at ${targetPath}`);
  }
}
