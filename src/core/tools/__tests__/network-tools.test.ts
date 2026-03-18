/**
 * Network Tools Tests
 *
 * Tests for FetchPageTool, FetchURLsTool, SendWebhookTool, WebSearchTool
 * All tests mock globalThis.fetch to avoid real network requests.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ToolContext } from '../base.js';
import { FetchPageTool } from '../fetchPage.js';
import { FetchURLsTool } from '../fetchURLs.js';
import { SendWebhookTool } from '../sendWebhook.js';
import { WebSearchTool } from '../webSearch.js';

const makeCtx = (overrides?: Partial<ToolContext>): ToolContext => ({
  logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
  artifactsDir: '/tmp/test-artifacts',
  ...overrides,
});

const originalFetch = globalThis.fetch;

const mockFetch = (response: Partial<Response>) => {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers({ 'content-type': 'text/html' }),
    text: () => Promise.resolve(''),
    json: () => Promise.resolve({}),
    ...response,
  }) as any;
};

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// --- FetchPageTool ---

describe('FetchPageTool', () => {
  let tool: FetchPageTool;

  beforeEach(() => {
    tool = new FetchPageTool();
  });

  it('returns status, content, and contentType on success', async () => {
    mockFetch({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
      text: () => Promise.resolve('<h1>Hello</h1>'),
    });

    const result = await tool.execute(
      { url: 'https://example.com', maxLength: 50000, timeout: 5000 },
      makeCtx()
    );

    expect(result.status).toBe(200);
    expect(result.content).toBe('<h1>Hello</h1>');
    expect(result.contentType).toBe('text/html; charset=utf-8');
    expect(result.url).toBe('https://example.com');
    expect(result.truncated).toBe(false);
  });

  it('truncates content exceeding maxLength', async () => {
    const longContent = 'A'.repeat(200);
    mockFetch({
      text: () => Promise.resolve(longContent),
    });

    const result = await tool.execute(
      { url: 'https://example.com', maxLength: 50, timeout: 5000 },
      makeCtx()
    );

    expect(result.truncated).toBe(true);
    expect(result.content.length).toBe(50);
    expect(result.content).toBe('A'.repeat(50));
  });

  it('returns error object for non-ok responses (HTTP 404)', async () => {
    mockFetch({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      headers: new Headers({ 'content-type': 'text/html' }),
    });

    const result = await tool.execute(
      { url: 'https://example.com/missing', maxLength: 50000, timeout: 5000 },
      makeCtx()
    );

    expect(result.status).toBe(404);
    expect(result.content).toBe('HTTP 404: Not Found');
    expect(result.truncated).toBe(false);
  });

  it('returns error object when fetch throws (network error)', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) as any;

    const result = await tool.execute(
      { url: 'https://example.com', maxLength: 50000, timeout: 5000 },
      makeCtx()
    );

    expect(result.status).toBe(0);
    expect(result.content).toContain('Fetch failed');
    expect(result.content).toContain('ECONNREFUSED');
  });

  it('calls onEvent on success', async () => {
    mockFetch({
      text: () => Promise.resolve('page content'),
    });

    const onEvent = vi.fn();
    const result = await tool.execute(
      { url: 'https://example.com', maxLength: 50000, timeout: 5000 },
      makeCtx({ onEvent })
    );

    expect(onEvent).toHaveBeenCalledWith('tool:fetchPage:completed', {
      url: 'https://example.com',
      status: 200,
      contentLength: expect.any(Number),
      truncated: false,
    });
  });
});

// --- FetchURLsTool ---

describe('FetchURLsTool', () => {
  let tool: FetchURLsTool;

  beforeEach(() => {
    tool = new FetchURLsTool();
  });

  it('extracts URLs from string array and fetches each', async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'text/html' }),
        text: () => Promise.resolve(`content-${callCount}`),
        json: () => Promise.resolve({}),
      });
    }) as any;

    const result = await tool.execute(
      { urls: ['https://example.com/a', 'https://example.com/b'] },
      makeCtx()
    );

    expect(result).toHaveLength(2);
    expect(result[0].url).toBe('https://example.com/a');
    expect(result[1].url).toBe('https://example.com/b');
  });

  it('extracts URLs from objects with url/URL/link/href/uri keys', async () => {
    mockFetch({
      text: () => Promise.resolve('ok'),
    });

    const result = await tool.execute(
      {
        urls: [
          { url: 'https://example.com/1' },
          { URL: 'https://example.com/2' },
          { link: 'https://example.com/3' },
          { href: 'https://example.com/4' },
          { uri: 'https://example.com/5' },
        ],
      },
      makeCtx()
    );

    expect(result).toHaveLength(5);
    expect(result.map((r) => r.url)).toEqual([
      'https://example.com/1',
      'https://example.com/2',
      'https://example.com/3',
      'https://example.com/4',
      'https://example.com/5',
    ]);
  });

  it('skips invalid URLs with warning', async () => {
    mockFetch({
      text: () => Promise.resolve('ok'),
    });

    const warn = vi.fn();
    const result = await tool.execute(
      { urls: ['not-a-url', 'https://example.com/valid'] },
      makeCtx({ logger: { debug: () => {}, info: () => {}, warn, error: () => {} } })
    );

    expect(result).toHaveLength(1);
    expect(result[0].url).toBe('https://example.com/valid');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Invalid URL'));
  });

  it('handles objects with no valid URL key', async () => {
    mockFetch({
      text: () => Promise.resolve('ok'),
    });

    const warn = vi.fn();
    const result = await tool.execute(
      { urls: [{ name: 'test', value: 42 }] },
      makeCtx({ logger: { debug: () => {}, info: () => {}, warn, error: () => {} } })
    );

    expect(result).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('No valid URL found'));
  });

  it('handles fetch failure for individual URLs gracefully', async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.reject(new Error('Network error'));
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'text/html' }),
        text: () => Promise.resolve('ok'),
        json: () => Promise.resolve({}),
      });
    }) as any;

    const errorFn = vi.fn();
    const result = await tool.execute(
      { urls: ['https://fail.com', 'https://success.com'] },
      makeCtx({ logger: { debug: () => {}, info: () => {}, warn: () => {}, error: errorFn } })
    );

    // FetchPageTool catches errors internally and returns error result,
    // so both URLs should produce results
    expect(result).toHaveLength(2);
    expect(result[0].content).toContain('Fetch failed');
    expect(result[1].content).toBe('ok');
  });
});

// --- SendWebhookTool ---

describe('SendWebhookTool', () => {
  let tool: SendWebhookTool;

  beforeEach(() => {
    tool = new SendWebhookTool();
  });

  it('sends POST with JSON payload successfully', async () => {
    mockFetch({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve({ received: true }),
    });

    const result = await tool.execute(
      { url: 'https://hooks.example.com/webhook', payload: { event: 'test' } },
      makeCtx()
    );

    expect(result.success).toBe(true);
    expect(result.status).toBe(200);
    expect(result.response).toEqual({ received: true });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://hooks.example.com/webhook',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ event: 'test' }),
      })
    );
  });

  it('includes custom headers', async () => {
    mockFetch({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve({}),
    });

    await tool.execute(
      {
        url: 'https://hooks.example.com/webhook',
        payload: { data: 1 },
        headers: { 'X-Custom': 'value' },
      },
      makeCtx()
    );

    const callArgs = (globalThis.fetch as any).mock.calls[0];
    expect(callArgs[1].headers).toMatchObject({
      'Content-Type': 'application/json',
      'X-Custom': 'value',
    });
  });

  it('parses JSON response', async () => {
    mockFetch({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve({ id: 123, status: 'ok' }),
    });

    const result = await tool.execute(
      { url: 'https://hooks.example.com/webhook', payload: {} },
      makeCtx()
    );

    expect(result.response).toEqual({ id: 123, status: 'ok' });
  });

  it('parses text response when content-type is not JSON', async () => {
    mockFetch({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-type': 'text/plain' }),
      text: () => Promise.resolve('OK received'),
    });

    const result = await tool.execute(
      { url: 'https://hooks.example.com/webhook', payload: {} },
      makeCtx()
    );

    expect(result.response).toBe('OK received');
  });

  it('throws on network failure after retries', async () => {
    // Mock fetch to reject immediately — retry backoff delays still apply
    // but the promises resolve/reject quickly.
    globalThis.fetch = vi.fn().mockImplementation(() =>
      Promise.reject(new Error('Connection refused'))
    ) as any;

    // Spy on retry's internal setTimeout to make delays instant
    const originalSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = ((fn: (...args: any[]) => void, _delay?: number, ...args: any[]) => {
      return originalSetTimeout(fn, 0, ...args);
    }) as any;

    try {
      await expect(
        tool.execute(
          { url: 'https://hooks.example.com/webhook', payload: {} },
          makeCtx()
        )
      ).rejects.toThrow('Connection refused');

      expect(globalThis.fetch).toHaveBeenCalledTimes(3);
    } finally {
      globalThis.setTimeout = originalSetTimeout;
    }
  });
});

// --- WebSearchTool ---

describe('WebSearchTool', () => {
  let tool: WebSearchTool;

  const mockDuckDuckGoHtml = `
<div class="result">
  <a class="result__a" href="?uddg=https%3A%2F%2Fexample.com%2Fpage1">Example Page 1</a>
  <a class="result__snippet">This is a snippet for page 1</a>
</div>
<div class="result">
  <a class="result__a" href="?uddg=https%3A%2F%2Fexample.com%2Fpage2">Example Page 2</a>
  <a class="result__snippet">This is a snippet for page 2</a>
</div>
`;

  beforeEach(() => {
    tool = new WebSearchTool();
  });

  it('executes search and parses results', async () => {
    mockFetch({
      ok: true,
      status: 200,
      text: () => Promise.resolve(mockDuckDuckGoHtml),
    });

    const result = await tool.execute(
      { query: 'test search', limit: 10 },
      makeCtx({ emitEvent: { progress: () => {} } })
    );

    expect(result).toHaveLength(2);
    expect(result[0].title).toBe('Example Page 1');
    expect(result[0].url).toBe('https://example.com/page1');
    expect(result[0].snippet).toBe('This is a snippet for page 1');
    expect(result[1].title).toBe('Example Page 2');
    expect(result[1].url).toBe('https://example.com/page2');
  });

  it('handles array query input', async () => {
    mockFetch({
      ok: true,
      status: 200,
      text: () => Promise.resolve(mockDuckDuckGoHtml),
    });

    const result = await tool.execute(
      { query: ['query one', 'query two'], limit: 10 },
      makeCtx({ emitEvent: { progress: () => {} } })
    );

    // Two queries means fetch is called twice
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    // Each call returns 2 results → 4 total
    expect(result).toHaveLength(4);
  });

  it('returns fallback when no results parsed', async () => {
    mockFetch({
      ok: true,
      status: 200,
      text: () => Promise.resolve('<html><body>No results</body></html>'),
    });

    const result = await tool.execute(
      { query: 'obscure query', limit: 10 },
      makeCtx({ emitEvent: { progress: () => {} } })
    );

    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Search results unavailable');
    expect(result[0].url).toBe('https://duckduckgo.com');
  });

  it('handles non-ok response', async () => {
    mockFetch({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
    });

    await expect(
      tool.execute(
        { query: 'test', limit: 10 },
        makeCtx({ emitEvent: { progress: () => {} } })
      )
    ).rejects.toThrow('Search failed with status 503');
  });

  it('cleanUrl extracts from uddg parameter', () => {
    // Access private method via bracket notation
    const url = (tool as any).cleanUrl('?uddg=https%3A%2F%2Fexample.com%2Fpath');
    expect(url).toBe('https://example.com/path');
  });

  it('cleanUrl returns raw url when no uddg', () => {
    const url = (tool as any).cleanUrl('https://direct.example.com');
    expect(url).toBe('https://direct.example.com');
  });

  it('extractSearchQueries handles bullet points, numbered lists, quoted strings', () => {
    const text = `1. first query
* second query
- third query
• fourth query
"quoted query"
plain query`;

    const queries = (tool as any).extractSearchQueries(text);

    expect(queries).toContain('first query');
    expect(queries).toContain('second query');
    expect(queries).toContain('third query');
    expect(queries).toContain('fourth query');
    expect(queries).toContain('quoted query');
    expect(queries).toContain('plain query');
    expect(queries).toHaveLength(6);
  });

  it('emitEvent is called', async () => {
    mockFetch({
      ok: true,
      status: 200,
      text: () => Promise.resolve(mockDuckDuckGoHtml),
    });

    const progress = vi.fn();
    await tool.execute(
      { query: 'test', limit: 10 },
      makeCtx({ emitEvent: { progress } })
    );

    expect(progress).toHaveBeenCalledWith(expect.stringContaining('🔎'));
    expect(progress).toHaveBeenCalledTimes(2);
  });
});
