import { describe, expect, test } from 'bun:test';
import { WebSearchTool } from '../src/tools/web';

describe('WebSearchTool', () => {
  test('parses DuckDuckGo HTML results', async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      const html = `
        <a class="result__a" href="https://example.com">Example Result</a>
        <a class="result__snippet">Example snippet</a>
      `;
      return new Response(html, { status: 200 });
    }) as typeof fetch;

    try {
      const output = await WebSearchTool.executor({ query: 'example', max_results: 3 });
      expect(calls).toBe(1);
      expect(output).toContain('Example Result');
      expect(output).toContain('https://example.com');
      expect(output).toContain('Example snippet');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('falls back to Instant Answer API when HTML is blocked', async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      if (calls === 1) {
        const html = `<form id="challenge-form">anomaly.js</form>`;
        return new Response(html, { status: 200 });
      }
      const json = JSON.stringify({
        Heading: 'OpenAI',
        AbstractText: 'OpenAI is an AI research organization.',
        AbstractURL: 'https://openai.com',
        Results: [
          { Text: 'OpenAI homepage', FirstURL: 'https://openai.com/' },
        ],
      });
      return new Response(json, { status: 200 });
    }) as typeof fetch;

    try {
      const output = await WebSearchTool.executor({ query: 'openai', max_results: 2 });
      expect(calls).toBe(2);
      expect(output).toContain('OpenAI');
      expect(output).toContain('https://openai.com');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
