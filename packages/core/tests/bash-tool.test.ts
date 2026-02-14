import { describe, expect, test } from 'bun:test';
import { mkdtemp, writeFile, mkdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { BashTool } from '../src/tools/bash';
import { ToolExecutionError } from '../src/errors';

describe('BashTool allowEnv toggle', () => {
  test('blocks env/printenv when allowEnv is disabled', async () => {
    const base = await mkdtemp(join(tmpdir(), 'assistants-bash-'));
    const configDir = join(base, '.assistants');
    await mkdir(configDir, { recursive: true });
    await writeFile(
      join(configDir, 'config.json'),
      JSON.stringify({
        validation: {
          perTool: {
            bash: {
              allowEnv: false,
            },
          },
        },
      })
    );

    await expect(
      BashTool.executor({ command: 'env', cwd: base })
    ).rejects.toThrow(ToolExecutionError);

    await expect(
      BashTool.executor({ command: 'printenv', cwd: base })
    ).rejects.toThrow('env/printenv disabled');
  });
});
