import { describe, expect, test } from 'bun:test';
import { parseArgs, main, type HeadlessOptions, type MainDependencies } from '../src/cli/main';

describe('parseArgs', () => {
  test('parses --version flag', () => {
    const options = parseArgs(['node', 'cli', '--version']);
    expect(options.version).toBe(true);
  });

  test('parses -v flag', () => {
    const options = parseArgs(['node', 'cli', '-v']);
    expect(options.version).toBe(true);
  });

  test('parses --help flag', () => {
    const options = parseArgs(['node', 'cli', '--help']);
    expect(options.help).toBe(true);
  });

  test('parses -h flag', () => {
    const options = parseArgs(['node', 'cli', '-h']);
    expect(options.help).toBe(true);
  });

  test('parses --print with prompt', () => {
    const options = parseArgs(['node', 'cli', '--print', 'hello world']);
    expect(options.print).toBe('hello world');
  });

  test('parses -p with prompt', () => {
    const options = parseArgs(['node', 'cli', '-p', 'hello world']);
    expect(options.print).toBe('hello world');
  });

  test('parses -p with positional prompt', () => {
    const options = parseArgs(['node', 'cli', '-p', '', 'positional prompt']);
    expect(options.print).toBe('positional prompt');
  });

  test('parses --output-format text', () => {
    const options = parseArgs(['node', 'cli', '-p', 'test', '--output-format', 'text']);
    expect(options.outputFormat).toBe('text');
  });

  test('parses --output-format json', () => {
    const options = parseArgs(['node', 'cli', '-p', 'test', '--output-format', 'json']);
    expect(options.outputFormat).toBe('json');
  });

  test('parses --output-format stream-json', () => {
    const options = parseArgs(['node', 'cli', '-p', 'test', '--output-format', 'stream-json']);
    expect(options.outputFormat).toBe('stream-json');
  });

  test('ignores invalid --output-format', () => {
    const options = parseArgs(['node', 'cli', '-p', 'test', '--output-format', 'invalid']);
    expect(options.outputFormat).toBe('text'); // default
  });

  test('parses --allowed-tools', () => {
    const options = parseArgs(['node', 'cli', '-p', 'test', '--allowed-tools', 'Read,Edit,Bash']);
    expect(options.allowedTools).toEqual(['Read', 'Edit', 'Bash']);
  });

  test('parses --allowedTools (alias)', () => {
    const options = parseArgs(['node', 'cli', '-p', 'test', '--allowedTools', 'Glob,Grep']);
    expect(options.allowedTools).toEqual(['Glob', 'Grep']);
  });

  test('trims whitespace from allowed tools', () => {
    const options = parseArgs(['node', 'cli', '-p', 'test', '--allowed-tools', ' Read , Edit ']);
    expect(options.allowedTools).toEqual(['Read', 'Edit']);
  });

  test('parses --system-prompt', () => {
    const options = parseArgs(['node', 'cli', '-p', 'test', '--system-prompt', 'You are helpful']);
    expect(options.systemPrompt).toBe('You are helpful');
  });

  test('parses --json-schema', () => {
    const schema = '{"type":"object"}';
    const options = parseArgs(['node', 'cli', '-p', 'test', '--json-schema', schema]);
    expect(options.jsonSchema).toBe(schema);
  });

  test('parses --headless-timeout-ms', () => {
    const options = parseArgs(['node', 'cli', '-p', 'test', '--headless-timeout-ms', '15000']);
    expect(options.headlessTimeoutMs).toBe(15000);
  });

  test('parses --continue flag', () => {
    const options = parseArgs(['node', 'cli', '-p', 'test', '--continue']);
    expect(options.continue).toBe(true);
  });

  test('parses -c flag', () => {
    const options = parseArgs(['node', 'cli', '-p', 'test', '-c']);
    expect(options.continue).toBe(true);
  });

  test('parses --resume with session id', () => {
    const options = parseArgs(['node', 'cli', '-p', 'test', '--resume', 'session-123']);
    expect(options.resume).toBe('session-123');
  });

  test('parses -r with session id', () => {
    const options = parseArgs(['node', 'cli', '-p', 'test', '-r', 'session-456']);
    expect(options.resume).toBe('session-456');
  });

  test('parses --cwd with path', () => {
    const options = parseArgs(['node', 'cli', '-p', 'test', '--cwd', '/custom/path']);
    expect(options.cwd).toBe('/custom/path');
    expect(options.cwdProvided).toBe(true);
  });

  test('cwdProvided is false when --cwd not specified', () => {
    const options = parseArgs(['node', 'cli', '-p', 'test']);
    expect(options.cwdProvided).toBe(false);
  });

  test('parses all headless options together', () => {
    const options = parseArgs([
      'node',
      'cli',
      '-p',
      'test prompt',
      '--output-format',
      'json',
      '--allowed-tools',
      'Read,Write',
      '--system-prompt',
      'custom system',
      '--json-schema',
      '{"type":"string"}',
      '--continue',
      '--cwd',
      '/work',
    ]);

    expect(options.print).toBe('test prompt');
    expect(options.outputFormat).toBe('json');
    expect(options.allowedTools).toEqual(['Read', 'Write']);
    expect(options.systemPrompt).toBe('custom system');
    expect(options.jsonSchema).toBe('{"type":"string"}');
    expect(options.continue).toBe(true);
    expect(options.cwd).toBe('/work');
    expect(options.cwdProvided).toBe(true);
  });

  test('defaults are set correctly', () => {
    const options = parseArgs(['node', 'cli']);
    expect(options.version).toBe(false);
    expect(options.help).toBe(false);
    expect(options.print).toBeNull();
    expect(options.outputFormat).toBe('text');
    expect(options.allowedTools).toEqual([]);
    expect(options.systemPrompt).toBeNull();
    expect(options.jsonSchema).toBeNull();
    expect(options.headlessTimeoutMs).toBeNull();
    expect(options.continue).toBe(false);
    expect(options.resume).toBeNull();
    expect(options.cwdProvided).toBe(false);
    expect(options.errors).toEqual([]);
  });
});

describe('parseArgs - validation errors', () => {
  test('--output-format missing value adds error', () => {
    const options = parseArgs(['node', 'cli', '-p', 'test', '--output-format']);
    expect(options.errors).toContain('--output-format requires a value (text, json, or stream-json)');
  });

  test('--output-format followed by flag adds error', () => {
    const options = parseArgs(['node', 'cli', '-p', 'test', '--output-format', '--continue']);
    expect(options.errors).toContain('--output-format requires a value (text, json, or stream-json)');
    expect(options.continue).toBe(true);
  });

  test('--output-format invalid value adds error', () => {
    const options = parseArgs(['node', 'cli', '-p', 'test', '--output-format', 'xml']);
    expect(options.errors).toContain('Invalid output format "xml". Valid options: text, json, stream-json');
  });

  test('--allowed-tools missing value adds error', () => {
    const options = parseArgs(['node', 'cli', '-p', 'test', '--allowed-tools']);
    expect(options.errors).toContain('--allowed-tools requires a comma-separated list of tool names');
  });

  test('--allowedTools missing value adds error (alias)', () => {
    const options = parseArgs(['node', 'cli', '-p', 'test', '--allowedTools', '--continue']);
    expect(options.errors).toContain('--allowedTools requires a comma-separated list of tool names');
  });

  test('--system-prompt missing value adds error', () => {
    const options = parseArgs(['node', 'cli', '-p', 'test', '--system-prompt']);
    expect(options.errors).toContain('--system-prompt requires a value');
  });

  test('--system-prompt followed by flag adds error', () => {
    const options = parseArgs(['node', 'cli', '-p', 'test', '--system-prompt', '-v']);
    expect(options.errors).toContain('--system-prompt requires a value');
    expect(options.version).toBe(true);
  });

  test('--json-schema missing value adds error', () => {
    const options = parseArgs(['node', 'cli', '-p', 'test', '--json-schema']);
    expect(options.errors).toContain('--json-schema requires a JSON schema string');
  });

  test('--json-schema followed by flag adds error', () => {
    const options = parseArgs(['node', 'cli', '-p', 'test', '--json-schema', '--continue']);
    expect(options.errors).toContain('--json-schema requires a JSON schema string');
    expect(options.continue).toBe(true);
  });

  test('--headless-timeout-ms missing value adds error', () => {
    const options = parseArgs(['node', 'cli', '-p', 'test', '--headless-timeout-ms']);
    expect(options.errors).toContain('--headless-timeout-ms requires a millisecond value');
  });

  test('--headless-timeout-ms invalid value adds error', () => {
    const options = parseArgs(['node', 'cli', '-p', 'test', '--headless-timeout-ms', 'nope']);
    expect(options.errors).toContain('--headless-timeout-ms must be a positive number of milliseconds');
  });

  test('--resume missing value adds error', () => {
    const options = parseArgs(['node', 'cli', '-p', 'test', '--resume']);
    expect(options.errors).toContain('--resume requires a session ID');
  });

  test('-r missing value adds error', () => {
    const options = parseArgs(['node', 'cli', '-p', 'test', '-r', '--continue']);
    expect(options.errors).toContain('-r requires a session ID');
    expect(options.continue).toBe(true);
  });

  test('--cwd missing value adds error', () => {
    const options = parseArgs(['node', 'cli', '-p', 'test', '--cwd']);
    expect(options.errors).toContain('--cwd requires a path');
  });

  test('--cwd followed by flag adds error', () => {
    const options = parseArgs(['node', 'cli', '-p', 'test', '--cwd', '-v']);
    expect(options.errors).toContain('--cwd requires a path');
    expect(options.version).toBe(true);
  });

  test('multiple errors can be collected', () => {
    const options = parseArgs(['node', 'cli', '-p', 'test', '--output-format', 'bad', '--cwd']);
    expect(options.errors.length).toBe(2);
    expect(options.errors).toContain('Invalid output format "bad". Valid options: text, json, stream-json');
    expect(options.errors).toContain('--cwd requires a path');
  });
});

describe('parseArgs - allowed-tools normalization', () => {
  test('filters empty entries from allowed tools', () => {
    const options = parseArgs(['node', 'cli', '-p', 'test', '--allowed-tools', 'Read,,Bash']);
    expect(options.allowedTools).toEqual(['Read', 'Bash']);
  });

  test('filters whitespace-only entries from allowed tools', () => {
    const options = parseArgs(['node', 'cli', '-p', 'test', '--allowed-tools', 'Read, ,Bash']);
    expect(options.allowedTools).toEqual(['Read', 'Bash']);
  });

  test('deduplicates allowed tools while preserving order', () => {
    const options = parseArgs(['node', 'cli', '-p', 'test', '--allowed-tools', 'Read,Bash,Read,Edit,Bash']);
    expect(options.allowedTools).toEqual(['Read', 'Bash', 'Edit']);
  });

  test('handles complex normalization: trim, filter, dedupe', () => {
    const options = parseArgs(['node', 'cli', '-p', 'test', '--allowed-tools', 'Read, , Bash,Read']);
    expect(options.allowedTools).toEqual(['Read', 'Bash']);
  });

  test('--allowedTools alias has same normalization behavior', () => {
    const options = parseArgs(['node', 'cli', '-p', 'test', '--allowedTools', 'Read, , Bash,Read']);
    expect(options.allowedTools).toEqual(['Read', 'Bash']);
  });

  test('handles single tool with extra commas', () => {
    const options = parseArgs(['node', 'cli', '-p', 'test', '--allowed-tools', ',Read,']);
    expect(options.allowedTools).toEqual(['Read']);
  });

  test('handles all empty entries', () => {
    const options = parseArgs(['node', 'cli', '-p', 'test', '--allowed-tools', ', , ,']);
    expect(options.allowedTools).toEqual([]);
  });

  test('preserves case of tool names', () => {
    const options = parseArgs(['node', 'cli', '-p', 'test', '--allowed-tools', 'Read,BASH,edit']);
    expect(options.allowedTools).toEqual(['Read', 'BASH', 'edit']);
  });
});

describe('parseArgs - end-of-options and flag handling', () => {
  test('-p followed by flag results in empty prompt', () => {
    // -p --continue should NOT use --continue as the prompt
    const options = parseArgs(['node', 'cli', '-p', '--continue']);
    expect(options.print).toBe('');
    expect(options.continue).toBe(true);
  });

  test('-p followed by another -p flag results in empty prompt', () => {
    const options = parseArgs(['node', 'cli', '-p', '-p', 'real prompt']);
    // First -p has no value (next is -p), second -p gets 'real prompt'
    expect(options.print).toBe('real prompt');
  });

  test('-p at end of args results in empty prompt', () => {
    const options = parseArgs(['node', 'cli', '-p']);
    expect(options.print).toBe('');
  });

  test('-- end-of-options allows prompt starting with dash', () => {
    const options = parseArgs(['node', 'cli', '-p', '--', '-prompt-with-dash']);
    expect(options.print).toBe('-prompt-with-dash');
  });

  test('-- end-of-options joins multiple args as prompt', () => {
    const options = parseArgs(['node', 'cli', '-p', '--', '-flag', 'not', 'a', 'flag']);
    expect(options.print).toBe('-flag not a flag');
  });

  test('-- without -p still treats remaining as prompt', () => {
    const options = parseArgs(['node', 'cli', '--', '-prompt-starting-with-dash']);
    expect(options.print).toBe('-prompt-starting-with-dash');
  });

  test('flags after -- are not parsed', () => {
    const options = parseArgs(['node', 'cli', '-p', '--', '--version', '-h']);
    expect(options.print).toBe('--version -h');
    expect(options.version).toBe(false);
    expect(options.help).toBe(false);
  });

  test('options before -- still work with -- prompt', () => {
    const options = parseArgs([
      'node',
      'cli',
      '-p',
      '--continue',
      '--output-format',
      'json',
      '--',
      '-my',
      'prompt',
    ]);
    // -p --continue means empty print (--continue is flag), but then -- -my prompt fills it
    expect(options.print).toBe('-my prompt');
    expect(options.continue).toBe(true);
    expect(options.outputFormat).toBe('json');
  });

  test('--resume followed by flag has no value and adds error', () => {
    const options = parseArgs(['node', 'cli', '-p', 'test', '--resume', '--continue']);
    expect(options.resume).toBeNull();
    expect(options.continue).toBe(true);
    expect(options.errors).toContain('--resume requires a session ID');
  });

  test('--cwd followed by flag has no value and adds error', () => {
    const options = parseArgs(['node', 'cli', '-p', 'test', '--cwd', '--continue']);
    expect(options.cwdProvided).toBe(false);
    expect(options.continue).toBe(true);
    expect(options.errors).toContain('--cwd requires a path');
  });

  test('--system-prompt followed by flag has no value and adds error', () => {
    const options = parseArgs(['node', 'cli', '-p', 'test', '--system-prompt', '--continue']);
    expect(options.systemPrompt).toBeNull();
    expect(options.continue).toBe(true);
    expect(options.errors).toContain('--system-prompt requires a value');
  });

  test('--json-schema followed by flag has no value and adds error', () => {
    const options = parseArgs(['node', 'cli', '-p', 'test', '--json-schema', '--continue']);
    expect(options.jsonSchema).toBeNull();
    expect(options.continue).toBe(true);
    expect(options.errors).toContain('--json-schema requires a JSON schema string');
  });

  test('--allowed-tools followed by flag has no value and adds error', () => {
    const options = parseArgs(['node', 'cli', '-p', 'test', '--allowed-tools', '--continue']);
    expect(options.allowedTools).toEqual([]);
    expect(options.continue).toBe(true);
    expect(options.errors).toContain('--allowed-tools requires a comma-separated list of tool names');
  });

  test('--output-format followed by flag keeps default and adds error', () => {
    const options = parseArgs(['node', 'cli', '-p', 'test', '--output-format', '--continue']);
    expect(options.outputFormat).toBe('text');
    expect(options.continue).toBe(true);
    expect(options.errors).toContain('--output-format requires a value (text, json, or stream-json)');
  });
});

describe('main - headless wiring', () => {
  function createMockDeps(): {
    deps: MainDependencies;
    getState: () => {
      printed: string[];
      exitCode: number | null;
      headlessOptions: HeadlessOptions | null;
    };
  } {
    const printed: string[] = [];
    let exitCode: number | null = null;
    let headlessOptions: HeadlessOptions | null = null;

    const deps: MainDependencies = {
      runHeadless: async (options: HeadlessOptions) => {
        headlessOptions = options;
      },
      print: (message: string) => {
        printed.push(message);
      },
      exit: (code: number) => {
        exitCode = code;
      },
      VERSION: '1.0.0-test',
    };

    return {
      deps,
      getState: () => ({ printed, exitCode, headlessOptions }),
    };
  }

  test('passes prompt to runHeadless', async () => {
    const { deps, getState } = createMockDeps();
    await main(['node', 'cli', '-p', 'test prompt'], deps);

    expect(getState().headlessOptions?.prompt).toBe('test prompt');
  });

  test('passes outputFormat to runHeadless', async () => {
    const { deps, getState } = createMockDeps();
    await main(['node', 'cli', '-p', 'test', '--output-format', 'json'], deps);

    expect(getState().headlessOptions?.outputFormat).toBe('json');
  });

  test('passes stream-json outputFormat to runHeadless', async () => {
    const { deps, getState } = createMockDeps();
    await main(['node', 'cli', '-p', 'test', '--output-format', 'stream-json'], deps);

    expect(getState().headlessOptions?.outputFormat).toBe('stream-json');
  });

  test('passes allowedTools to runHeadless', async () => {
    const { deps, getState } = createMockDeps();
    await main(['node', 'cli', '-p', 'test', '--allowed-tools', 'Read,Edit,Bash'], deps);

    expect(getState().headlessOptions?.allowedTools).toEqual(['Read', 'Edit', 'Bash']);
  });

  test('omits allowedTools when empty', async () => {
    const { deps, getState } = createMockDeps();
    await main(['node', 'cli', '-p', 'test'], deps);

    expect(getState().headlessOptions?.allowedTools).toBeUndefined();
  });

  test('passes systemPrompt to runHeadless', async () => {
    const { deps, getState } = createMockDeps();
    await main(['node', 'cli', '-p', 'test', '--system-prompt', 'Be concise'], deps);

    expect(getState().headlessOptions?.systemPrompt).toBe('Be concise');
  });

  test('passes jsonSchema to runHeadless', async () => {
    const schema = '{"type":"array"}';
    const { deps, getState } = createMockDeps();
    await main(['node', 'cli', '-p', 'test', '--json-schema', schema], deps);

    expect(getState().headlessOptions?.jsonSchema).toBe(schema);
  });

  test('passes continue flag to runHeadless', async () => {
    const { deps, getState } = createMockDeps();
    await main(['node', 'cli', '-p', 'test', '--continue'], deps);

    expect(getState().headlessOptions?.continue).toBe(true);
  });

  test('passes resume session id to runHeadless', async () => {
    const { deps, getState } = createMockDeps();
    await main(['node', 'cli', '-p', 'test', '--resume', 'session-xyz'], deps);

    expect(getState().headlessOptions?.resume).toBe('session-xyz');
  });

  test('passes cwd to runHeadless', async () => {
    const { deps, getState } = createMockDeps();
    await main(['node', 'cli', '-p', 'test', '--cwd', '/custom/dir'], deps);

    expect(getState().headlessOptions?.cwd).toBe('/custom/dir');
  });

  test('passes cwdProvided true when --cwd specified', async () => {
    const { deps, getState } = createMockDeps();
    await main(['node', 'cli', '-p', 'test', '--cwd', '/custom/dir'], deps);

    expect(getState().headlessOptions?.cwdProvided).toBe(true);
  });

  test('passes cwdProvided false when --cwd not specified', async () => {
    const { deps, getState } = createMockDeps();
    await main(['node', 'cli', '-p', 'test'], deps);

    expect(getState().headlessOptions?.cwdProvided).toBe(false);
  });

  test('passes all options together to runHeadless', async () => {
    const { deps, getState } = createMockDeps();
    await main(
      [
        'node',
        'cli',
        '-p',
        'full test',
        '--output-format',
        'json',
        '--allowed-tools',
        'Read,Grep',
        '--system-prompt',
        'Be helpful',
        '--json-schema',
        '{"type":"object"}',
        '--continue',
        '--cwd',
        '/my/path',
      ],
      deps
    );

    expect(getState().headlessOptions).toEqual({
      prompt: 'full test',
      cwd: '/my/path',
      outputFormat: 'json',
      allowedTools: ['Read', 'Grep'],
      systemPrompt: 'Be helpful',
      jsonSchema: '{"type":"object"}',
      continue: true,
      resume: null,
      cwdProvided: true,
      timeoutMs: null,
    });
  });
});

describe('main - version and help', () => {
  function createMockDeps(): {
    deps: MainDependencies;
    getState: () => {
      printed: string[];
      exitCode: number | null;
    };
  } {
    const printed: string[] = [];
    let exitCode: number | null = null;

    const deps: MainDependencies = {
      runHeadless: async () => {},
      print: (message: string) => {
        printed.push(message);
      },
      exit: (code: number) => {
        exitCode = code;
      },
      VERSION: '1.2.3',
    };

    return {
      deps,
      getState: () => ({ printed, exitCode }),
    };
  }

  test('prints version and exits with 0', async () => {
    const { deps, getState } = createMockDeps();
    await main(['node', 'cli', '--version'], deps);

    expect(getState().printed).toContain('assistants v1.2.3');
    expect(getState().exitCode).toBe(0);
  });

  test('prints help and exits with 0', async () => {
    const { deps, getState } = createMockDeps();
    await main(['node', 'cli', '--help'], deps);

    expect(getState().printed.some((p) => p.includes('Usage:'))).toBe(true);
    expect(getState().printed.some((p) => p.includes('Options:'))).toBe(true);
    expect(getState().exitCode).toBe(0);
  });

  test('errors on empty prompt and exits with 1', async () => {
    const { deps, getState } = createMockDeps();
    await main(['node', 'cli', '-p', ''], deps);

    expect(getState().printed.some((p) => p.includes('Prompt is required'))).toBe(true);
    expect(getState().exitCode).toBe(1);
  });

  test('errors on whitespace-only prompt and exits with 1', async () => {
    const { deps, getState } = createMockDeps();
    await main(['node', 'cli', '-p', '   '], deps);

    expect(getState().printed.some((p) => p.includes('Prompt is required'))).toBe(true);
    expect(getState().exitCode).toBe(1);
  });

  test('errors when -p is followed by another flag (missing prompt)', async () => {
    const { deps, getState } = createMockDeps();
    await main(['node', 'cli', '-p', '--continue'], deps);

    // -p without a value should result in empty print which triggers the prompt error
    expect(getState().printed.some((p) => p.includes('Prompt is required'))).toBe(true);
    expect(getState().exitCode).toBe(1);
  });

  test('errors when -p is at end of args (missing prompt)', async () => {
    const { deps, getState } = createMockDeps();
    await main(['node', 'cli', '-p'], deps);

    expect(getState().printed.some((p) => p.includes('Prompt is required'))).toBe(true);
    expect(getState().exitCode).toBe(1);
  });

  test('exits with 1 on parsing errors', async () => {
    const { deps, getState } = createMockDeps();
    await main(['node', 'cli', '-p', 'test', '--output-format', 'invalid'], deps);

    expect(getState().printed.some((p) => p.includes('Error:'))).toBe(true);
    expect(getState().printed.some((p) => p.includes('Invalid output format'))).toBe(true);
    expect(getState().exitCode).toBe(1);
  });

  test('prints all parsing errors before exiting', async () => {
    const { deps, getState } = createMockDeps();
    await main(['node', 'cli', '-p', 'test', '--output-format', 'bad', '--cwd'], deps);

    const errors = getState().printed.filter((p) => p.includes('Error:'));
    expect(errors.length).toBe(2);
    expect(getState().exitCode).toBe(1);
  });

  test('does not call runHeadless when there are parsing errors', async () => {
    let runHeadlessCalled = false;
    const deps: MainDependencies = {
      runHeadless: async () => {
        runHeadlessCalled = true;
      },
      print: () => {},
      exit: () => {},
      VERSION: '1.0.0',
    };

    await main(['node', 'cli', '-p', 'test', '--cwd'], deps);
    expect(runHeadlessCalled).toBe(false);
  });
});
