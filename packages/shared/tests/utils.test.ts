import { describe, expect, test } from 'bun:test';
import {
  generateId,
  now,
  sleep,
  parseFrontmatter,
  substituteVariables,
  truncate,
  formatBytes,
  formatDuration,
} from '../src/utils';

describe('generateId', () => {
  test('should generate a valid UUID', () => {
    const id = generateId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  test('should generate unique IDs', () => {
    const ids = new Set();
    for (let i = 0; i < 100; i++) {
      ids.add(generateId());
    }
    expect(ids.size).toBe(100);
  });
});

describe('now', () => {
  test('should return current timestamp', () => {
    const before = Date.now();
    const timestamp = now();
    const after = Date.now();
    expect(timestamp).toBeGreaterThanOrEqual(before);
    expect(timestamp).toBeLessThanOrEqual(after);
  });
});

describe('sleep', () => {
  test('should sleep for specified duration', async () => {
    const start = Date.now();
    await sleep(50);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(45); // Allow some tolerance
  });
});

describe('parseFrontmatter', () => {
  test('should parse simple frontmatter', () => {
    const content = `---
name: test-skill
description: A test skill
---

# Content here`;

    const result = parseFrontmatter(content);
    expect(result.frontmatter).toEqual({
      name: 'test-skill',
      description: 'A test skill',
    });
    expect(result.content).toBe('# Content here');
  });

  test('should parse boolean values', () => {
    const content = `---
enabled: true
disabled: false
---

Content`;

    const result = parseFrontmatter(content);
    expect(result.frontmatter.enabled).toBe(true);
    expect(result.frontmatter.disabled).toBe(false);
  });

  test('should parse numeric values', () => {
    const content = `---
count: 42
price: 19.99
---

Content`;

    const result = parseFrontmatter(content);
    expect(result.frontmatter.count).toBe(42);
    expect(result.frontmatter.price).toBe(19.99);
  });

  test('should handle quoted strings', () => {
    const content = `---
name: "quoted value"
---

Content`;

    const result = parseFrontmatter(content);
    expect(result.frontmatter.name).toBe('quoted value');
  });

  test('should parse array values', () => {
    const content = `---
tags: [one, "two", three]
---

Content`;

    const result = parseFrontmatter(content);
    expect(result.frontmatter.tags).toEqual(['one', 'two', 'three']);
  });

  test('should parse frontmatter with CRLF newlines', () => {
    const content = `---\r\nname: test\r\n---\r\n\r\nBody`;
    const result = parseFrontmatter(content);
    expect(result.frontmatter.name).toBe('test');
    expect(result.content).toBe('Body');
  });

  test('should parse single-item array values', () => {
    const content = `---
tags: [single]
---

Content`;

    const result = parseFrontmatter(content);
    expect(result.frontmatter.tags).toEqual(['single']);
  });

  test('should parse empty array values', () => {
    const content = `---
tags: []
---

Content`;

    const result = parseFrontmatter(content);
    expect(result.frontmatter.tags).toEqual([]);
  });

  test('should not treat bracketed argument hints as arrays', () => {
    const content = `---
argument-hint: [arg1] [arg2]
---

Content`;

    const result = parseFrontmatter(content);
    expect(result.frontmatter['argument-hint']).toBe('[arg1] [arg2]');
  });

  test('should return empty frontmatter for content without frontmatter', () => {
    const content = '# Just content\n\nNo frontmatter here';
    const result = parseFrontmatter(content);
    expect(result.frontmatter).toEqual({});
    expect(result.content).toBe(content);
  });

  test('should handle empty content after frontmatter', () => {
    const content = `---
name: test
---
`;

    const result = parseFrontmatter(content);
    expect(result.frontmatter.name).toBe('test');
    expect(result.content).toBe('');
  });
});

describe('substituteVariables', () => {
  test('should substitute $ARGUMENTS', () => {
    const result = substituteVariables('Hello $ARGUMENTS', ['world', 'test']);
    expect(result).toBe('Hello world test');
  });

  test('should substitute positional args $0, $1', () => {
    const result = substituteVariables('$0 and $1', ['first', 'second']);
    expect(result).toBe('first and second');
  });

  test('should substitute $ARGUMENTS[n]', () => {
    const result = substituteVariables('$ARGUMENTS[0] then $ARGUMENTS[1]', ['a', 'b']);
    expect(result).toBe('a then b');
  });

  test('should substitute ${VAR} from env param', () => {
    const result = substituteVariables('Value is ${MY_VAR}', [], { MY_VAR: 'test' });
    expect(result).toBe('Value is test');
  });

  test('should return empty string for missing env vars', () => {
    const result = substituteVariables('Value is ${NONEXISTENT}', [], {});
    expect(result).toBe('Value is ');
  });

  test('should fallback to process.env when env param missing', () => {
    const original = process.env.TEST_ENV_VALUE;
    process.env.TEST_ENV_VALUE = 'from-process';
    const result = substituteVariables('Value is ${TEST_ENV_VALUE}', [], {});
    expect(result).toBe('Value is from-process');
    if (original === undefined) {
      delete process.env.TEST_ENV_VALUE;
    } else {
      process.env.TEST_ENV_VALUE = original;
    }
  });

  test('should handle multiple substitutions', () => {
    const result = substituteVariables(
      '$0: $ARGUMENTS - ${VAR}',
      ['prefix', 'arg1', 'arg2'],
      { VAR: 'suffix' }
    );
    expect(result).toBe('prefix: prefix arg1 arg2 - suffix');
  });
});

describe('truncate', () => {
  test('should not truncate short strings', () => {
    expect(truncate('hello', 10)).toBe('hello');
  });

  test('should truncate long strings', () => {
    expect(truncate('hello world', 8)).toBe('hello...');
  });

  test('should use custom suffix', () => {
    expect(truncate('hello world', 8, '…')).toBe('hello w…');
  });

  test('should handle exact length', () => {
    expect(truncate('hello', 5)).toBe('hello');
  });
});

describe('formatBytes', () => {
  test('should format bytes', () => {
    expect(formatBytes(500)).toBe('500.0 B');
  });

  test('should format kilobytes', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
  });

  test('should format megabytes', () => {
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
  });

  test('should format gigabytes', () => {
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1.0 GB');
  });
});

describe('formatDuration', () => {
  test('should format milliseconds', () => {
    expect(formatDuration(500)).toBe('500ms');
  });

  test('should format seconds', () => {
    expect(formatDuration(1500)).toBe('1.5s');
    expect(formatDuration(30000)).toBe('30.0s');
  });

  test('should format minutes and seconds', () => {
    expect(formatDuration(90000)).toBe('1m 30s');
  });

  test('should format hours and minutes', () => {
    expect(formatDuration(3661000)).toBe('1h 1m');
  });
});
