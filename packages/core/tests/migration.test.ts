import { describe, expect, test } from 'bun:test';
import { mkdir } from 'fs/promises';
import { join } from 'path';
import { assertNoExistingTarget } from '../src/migration/validators';
import { withTempDir } from './fixtures/helpers';

describe('migration validators', () => {
  test('assertNoExistingTarget throws when path exists', async () => {
    await withTempDir(async (dir) => {
      const target = join(dir, 'existing');
      await mkdir(target, { recursive: true });
      expect(() => assertNoExistingTarget(target)).toThrow('Target already exists');
    });
  });

  test('assertNoExistingTarget passes when path missing', async () => {
    await withTempDir(async (dir) => {
      const target = join(dir, 'missing');
      expect(() => assertNoExistingTarget(target)).not.toThrow();
    });
  });
});
