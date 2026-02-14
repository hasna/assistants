import { describe, expect, mock, test } from 'bun:test';
import { ToolExecutionError } from '../src/errors';
import { withTempDir } from './fixtures/helpers';

const { SkillTool, SkillInstallTool, SkillUninstallTool, createSkillListTool, createSkillReadTool } = await import('../src/tools/skills');

describe('Skill tools', () => {
  test('SkillTool.executor validates input and returns summary', async () => {
    await expect(SkillTool.executor({})).rejects.toBeInstanceOf(ToolExecutionError);
    await expect(SkillTool.executor({ name: 'test' })).rejects.toBeInstanceOf(ToolExecutionError);
    await withTempDir(async (dir) => {
      const output = await SkillTool.executor({
        name: 'test',
        scope: 'project',
        description: 'desc',
        content: 'body',
        allowed_tools: 'read,write',
        argument_hint: 'arg',
        overwrite: true,
        cwd: dir,
      });

      expect(output).toContain('Created skill');
      // Should create under .skill/ directory
      expect(output).toContain('.skill');
      expect(output).toContain(dir);
    });
  });

  test('createSkillListTool handles loader and empty results', async () => {
    const loader = {
      loadAll: mock(async () => {}),
      getSkillDescriptions: mock(() => ''),
    };
    const { executor } = createSkillListTool(() => loader as any);
    const output = await executor({ cwd: '/tmp' });
    expect(output).toBe('No skills loaded.');

    const { executor: missingExecutor } = createSkillListTool(() => null);
    await expect(missingExecutor({})).rejects.toBeInstanceOf(ToolExecutionError);
  });

  test('createSkillReadTool handles missing loader and skill', async () => {
    const { executor: missing } = createSkillReadTool(() => null);
    await expect(missing({ name: 'skill' })).rejects.toBeInstanceOf(ToolExecutionError);

    const loader = {
      ensureSkillContent: mock(async () => null),
    };
    const { executor } = createSkillReadTool(() => loader as any);
    await expect(executor({ name: 'missing' })).rejects.toBeInstanceOf(ToolExecutionError);

    loader.ensureSkillContent = mock(async () => ({ name: 'my-skill', content: 'hello' }));
    const content = await executor({ name: 'my-skill' });
    expect(content).toBe('hello');
  });

  test('SkillInstallTool.executor validates name', async () => {
    await expect(SkillInstallTool.executor({})).rejects.toBeInstanceOf(ToolExecutionError);
    await expect(SkillInstallTool.executor({ name: '' })).rejects.toBeInstanceOf(ToolExecutionError);
  });

  test('SkillUninstallTool.executor validates name', async () => {
    await expect(SkillUninstallTool.executor({})).rejects.toBeInstanceOf(ToolExecutionError);
    await expect(SkillUninstallTool.executor({ name: '' })).rejects.toBeInstanceOf(ToolExecutionError);
  });

  test('SkillInstallTool and SkillUninstallTool have correct tool definitions', () => {
    expect(SkillInstallTool.tool.name).toBe('skill_install');
    expect(SkillInstallTool.tool.parameters.required).toEqual(['name']);
    expect(SkillUninstallTool.tool.name).toBe('skill_uninstall');
    expect(SkillUninstallTool.tool.parameters.required).toEqual(['name']);
  });
});
