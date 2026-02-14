/**
 * Atomic file write utility
 *
 * Writes to a temporary file first, then renames over the target.
 * This prevents partial writes from corrupting JSON files during
 * concurrent access.
 */

import { writeFileSync, renameSync, unlinkSync } from 'fs';
import { writeFile, rename, unlink } from 'fs/promises';

/**
 * Atomically write data to a file.
 * Writes to a .tmp file first, then renames over the target.
 */
export function atomicWriteFileSync(path: string, data: string): void {
  const tmpPath = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(tmpPath, data);
    renameSync(tmpPath, path);
  } catch (error) {
    // Clean up temp file on failure
    try {
      unlinkSync(tmpPath);
    } catch {
      // Ignore cleanup errors
    }
    throw error;
  }
}

/**
 * Atomically write JSON data to a file.
 */
export function atomicWriteJsonSync(path: string, data: unknown, indent: number = 2): void {
  atomicWriteFileSync(path, JSON.stringify(data, null, indent));
}

/**
 * Async atomic write.
 */
export async function atomicWriteFile(path: string, data: string): Promise<void> {
  const tmpPath = `${path}.${process.pid}.tmp`;
  try {
    await writeFile(tmpPath, data);
    await rename(tmpPath, path);
  } catch (error) {
    try {
      await unlink(tmpPath);
    } catch {
      // Ignore cleanup errors
    }
    throw error;
  }
}
