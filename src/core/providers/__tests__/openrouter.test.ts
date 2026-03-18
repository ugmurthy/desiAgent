/**
 * OpenRouter Provider Tests
 *
 * Tests for OpenRouter LLM provider implementation (fetch-based)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenRouterProvider } from '../openrouter.js';

const makeJsonResponse = (body: any, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('OpenRouterProvider', () => {
  let provider: OpenRouterProvider;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // skipGenerationStats=true to avoid generation stats fetch calls in tests
    provider = new OpenRouterProvider('test-key-123', 'openai/gpt-4o', 4096, true);
    fetchSpy = vi.spyOn(globalThis, 'fetch');
    vi.clearAllMocks();
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  describe('initialization', () => {
    it('creates provider with API key', () => {
      expect(provider.name).toBe('openrouter');
    });

    it('throws error without API key', () => {
      expect(() => {
        new OpenRouterProvider('', 'openai/gpt-4o');
      }).toThrow('OpenRouter API key is required');
    });
  });

  describe('validateToolCallSupport', () => {
    it('returns supported when API confirms tools', async () => {
      fetchSpy.mockResolvedValueOnce(
        makeJsonResponse({ supported_parameters: ['tools', 'temperature'] })
      );

      const result = await provider.validateToolCallSupport('openai/gpt-4o');

      expect(result.supported).toBe(true);
    });

    it('returns unsupported when model lacks tools', async () => {
      fetchSpy.mockResolvedValueOnce(
        makeJsonResponse({ supported_parameters: ['temperature'] })
      );

      const result = await provider.validateToolCallSupport('some/model');

      expect(result.supported).toBe(false);
      expect(result.message).toContain('does not support tool calling');
    });

    it('returns unsupported for 404 (model not found)', async () => {
      fetchSpy.mockResolvedValueOnce(makeJsonResponse({}, 404));

      const result = await provider.validateToolCallSupport('fake/model');

      expect(result.supported).toBe(false);
      expect(result.message).toContain('not found');
    });

    it('assumes supported on fetch error', async () => {
      fetchSpy.mockRejectedValueOnce(new Error('Network error'));

      const result = await provider.validateToolCallSupport('openai/gpt-4o');

      expect(result.supported).toBe(true);
    });

    it('assumes supported on non-404 error status', async () => {
      fetchSpy.mockResolvedValueOnce(makeJsonResponse({}, 500));

      const result = await provider.validateToolCallSupport('openai/gpt-4o');

      expect(result.supported).toBe(true);
    });
  });

  describe('chat', () => {
    it('sends correct request body', async () => {
      fetchSpy.mockResolvedValueOnce(
        makeJsonResponse({
          id: 'gen-123',
          choices: [{ message: { content: 'Hello!' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        })
      );

      await provider.chat({
        messages: [{ role: 'user', content: 'Hi' }],
        temperature: 0.5,
        maxTokens: 100,
      });

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://openrouter.ai/api/v1/chat/completions',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            model: 'openai/gpt-4o',
            messages: [{ role: 'user', content: 'Hi' }],
            temperature: 0.5,
            max_tokens: 100,
          }),
        })
      );
    });

    it('returns content and usage', async () => {
      fetchSpy.mockResolvedValueOnce(
        makeJsonResponse({
          id: 'gen-123',
          choices: [{ message: { content: 'Test response' } }],
          usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
        })
      );

      const result = await provider.chat({
        messages: [{ role: 'user', content: 'Hi' }],
      });

      expect(result.content).toBe('Test response');
      expect(result.usage).toEqual({
        promptTokens: 20,
        completionTokens: 10,
        totalTokens: 30,
      });
    });

    it('handles missing usage info', async () => {
      fetchSpy.mockResolvedValueOnce(
        makeJsonResponse({
          id: 'gen-123',
          choices: [{ message: { content: 'Hello!' } }],
        })
      );

      const result = await provider.chat({
        messages: [{ role: 'user', content: 'Hi' }],
      });

      expect(result.usage).toBeUndefined();
    });

    it('uses default temperature and maxTokens', async () => {
      fetchSpy.mockResolvedValueOnce(
        makeJsonResponse({
          id: 'gen-123',
          choices: [{ message: { content: 'Ok' } }],
        })
      );

      await provider.chat({
        messages: [{ role: 'user', content: 'Hi' }],
      });

      const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(body.temperature).toBe(0.7);
      expect(body.max_tokens).toBe(4096);
    });

    it('throws error on API failure', async () => {
      fetchSpy.mockResolvedValueOnce(
        makeJsonResponse({ error: { message: 'Bad request' } }, 400)
      );

      await expect(
        provider.chat({
          messages: [{ role: 'user', content: 'Hi' }],
        })
      ).rejects.toThrow('OpenRouter chat call failed');
    });

    it('includes generationId in response', async () => {
      fetchSpy.mockResolvedValueOnce(
        makeJsonResponse({
          id: 'gen-abc-456',
          choices: [{ message: { content: 'Ok' } }],
        })
      );

      const result = await provider.chat({
        messages: [{ role: 'user', content: 'Hi' }],
      });

      expect(result.generationId).toBe('gen-abc-456');
    });
  });

  describe('callWithTools', () => {
    it('passes tools through to the API', async () => {
      fetchSpy.mockResolvedValueOnce(
        makeJsonResponse({
          id: 'gen-123',
          choices: [
            {
              message: { content: 'Let me help', tool_calls: [] },
              finish_reason: 'stop',
            },
          ],
        })
      );

      const toolDef = {
        type: 'function' as const,
        function: {
          name: 'bash',
          description: 'Run bash commands',
          parameters: {
            type: 'object',
            properties: {
              command: { type: 'string', description: 'The command' },
            },
            required: ['command'],
          },
        },
      };

      await provider.callWithTools({
        messages: [{ role: 'user', content: 'Help' }],
        tools: [toolDef],
      });

      const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(body.tools).toEqual([toolDef]);
    });

    it('parses tool calls from response', async () => {
      fetchSpy.mockResolvedValueOnce(
        makeJsonResponse({
          id: 'gen-123',
          choices: [
            {
              message: {
                content: 'Executing',
                tool_calls: [
                  {
                    id: 'call_123',
                    type: 'function',
                    function: {
                      name: 'bash',
                      arguments: '{"command": "ls -la"}',
                    },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
        })
      );

      const result = await provider.callWithTools({
        messages: [{ role: 'user', content: 'List files' }],
        tools: [],
      });

      expect(result.toolCalls).toEqual([
        {
          id: 'call_123',
          name: 'bash',
          arguments: { command: 'ls -la' },
        },
      ]);
    });

    it('returns stop finish reason', async () => {
      fetchSpy.mockResolvedValueOnce(
        makeJsonResponse({
          id: 'gen-123',
          choices: [
            {
              message: { content: 'Done' },
              finish_reason: 'stop',
            },
          ],
        })
      );

      const result = await provider.callWithTools({
        messages: [{ role: 'user', content: 'Hi' }],
        tools: [],
      });

      expect(result.finishReason).toBe('stop');
    });

    it('returns tool_calls finish reason', async () => {
      fetchSpy.mockResolvedValueOnce(
        makeJsonResponse({
          id: 'gen-123',
          choices: [
            {
              message: {
                content: 'Using tool',
                tool_calls: [
                  {
                    id: 'call_456',
                    type: 'function',
                    function: { name: 'bash', arguments: '{}' },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
        })
      );

      const result = await provider.callWithTools({
        messages: [{ role: 'user', content: 'Run' }],
        tools: [],
      });

      expect(result.finishReason).toBe('tool_calls');
    });

    it('handles invalid JSON in arguments gracefully', async () => {
      fetchSpy.mockResolvedValueOnce(
        makeJsonResponse({
          id: 'gen-123',
          choices: [
            {
              message: {
                content: 'Calling tool',
                tool_calls: [
                  {
                    id: 'call_789',
                    type: 'function',
                    function: {
                      name: 'bash',
                      arguments: 'invalid json',
                    },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
        })
      );

      // OpenRouter uses jsonParseSafe which returns the raw string on failure
      const result = await provider.callWithTools({
        messages: [{ role: 'user', content: 'Run' }],
        tools: [],
      });

      expect(result.toolCalls?.[0]?.arguments).toBe('invalid json');
    });

    it('includes usage in response', async () => {
      fetchSpy.mockResolvedValueOnce(
        makeJsonResponse({
          id: 'gen-123',
          choices: [
            {
              message: { content: 'Done' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 },
        })
      );

      const result = await provider.callWithTools({
        messages: [{ role: 'user', content: 'Hi' }],
        tools: [],
      });

      expect(result.usage).toEqual({
        promptTokens: 50,
        completionTokens: 20,
        totalTokens: 70,
      });
    });

    it('throws on API error', async () => {
      fetchSpy.mockResolvedValueOnce(
        makeJsonResponse({ error: { message: 'Server error' } }, 500)
      );

      await expect(
        provider.callWithTools({
          messages: [{ role: 'user', content: 'Hi' }],
          tools: [],
        })
      ).rejects.toThrow('OpenRouter API call failed');
    });
  });
});
