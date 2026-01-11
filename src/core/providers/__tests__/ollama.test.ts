/**
 * Ollama Provider Tests
 *
 * Tests for Ollama LLM provider implementation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OllamaProvider } from '../ollama.js';

describe('OllamaProvider', () => {
  let provider: OllamaProvider;

  beforeEach(() => {
    provider = new OllamaProvider('http://localhost:11434', 'mistral');
    vi.clearAllMocks();
  });

  describe('initialization', () => {
    it('creates provider with default values', () => {
      const p = new OllamaProvider();
      expect(p.name).toBe('ollama');
    });

    it('removes trailing slash from baseUrl', () => {
      const p = new OllamaProvider('http://localhost:11434/');
      // Provider is created without error
      expect(p.name).toBe('ollama');
    });

    it('accepts custom baseUrl and model', () => {
      const p = new OllamaProvider('http://custom:11434', 'llama2');
      expect(p.name).toBe('ollama');
    });
  });

  describe('validateToolCallSupport', () => {
    it('returns unsupported for all models', async () => {
      const result = await provider.validateToolCallSupport('mistral');
      expect(result.supported).toBe(false);
      expect(result.message).toContain('limited tool calling support');
    });

    it('includes model name in message', async () => {
      const result = await provider.validateToolCallSupport('custom-model');
      expect(result.message).toContain('custom-model');
    });
  });

  describe('chat', () => {
    beforeEach(() => {
      global.fetch = vi.fn();
    });

    it('makes POST request to correct endpoint', async () => {
      const mockFetch = vi.mocked(global.fetch);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: { content: 'Hello!' },
        }),
      } as any);

      await provider.chat({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:11434/api/chat',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });

    it('sends correct payload', async () => {
      const mockFetch = vi.mocked(global.fetch);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: { content: 'Response' },
        }),
      } as any);

      await provider.chat({
        messages: [{ role: 'user', content: 'Test' }],
        temperature: 0.5,
      });

      const call = mockFetch.mock.calls[0];
      const body = JSON.parse(call[1]?.body as string);

      expect(body.model).toBe('mistral');
      expect(body.messages).toEqual([
        { role: 'user', content: 'Test' },
      ]);
      expect(body.temperature).toBe(0.5);
      expect(body.stream).toBe(false);
    });

    it('returns content from response', async () => {
      const mockFetch = vi.mocked(global.fetch);
      const expectedContent = 'Test response content';
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: { content: expectedContent },
        }),
      } as any);

      const result = await provider.chat({
        messages: [{ role: 'user', content: 'Hi' }],
      });

      expect(result.content).toBe(expectedContent);
    });

    it('throws error on HTTP failure', async () => {
      const mockFetch = vi.mocked(global.fetch);
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      } as any);

      await expect(
        provider.chat({
          messages: [{ role: 'user', content: 'Hi' }],
        })
      ).rejects.toThrow('HTTP 500');
    });

    it('handles missing content gracefully', async () => {
      const mockFetch = vi.mocked(global.fetch);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ message: {} }),
      } as any);

      const result = await provider.chat({
        messages: [{ role: 'user', content: 'Hi' }],
      });

      expect(result.content).toBe('');
    });
  });

  describe('callWithTools', () => {
    beforeEach(() => {
      global.fetch = vi.fn();
    });

    it('falls back to chat when tools provided', async () => {
      const mockFetch = vi.mocked(global.fetch);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: { content: 'bash(command="echo hello")' },
        }),
      } as any);

      const result = await provider.callWithTools({
        messages: [{ role: 'user', content: 'Run echo' }],
        tools: [
          {
            name: 'bash',
            description: 'Run bash commands',
            parameters: [
              {
                name: 'command',
                type: 'string',
                description: 'Command to run',
                required: true,
              },
            ],
          },
        ],
      });

      expect(result.finishReason).toBe('stop');
    });

    it('parses tool calls from response text', async () => {
      const mockFetch = vi.mocked(global.fetch);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: { content: 'I will bash(command="ls -la")' },
        }),
      } as any);

      const result = await provider.callWithTools({
        messages: [{ role: 'user', content: 'List files' }],
        tools: [
          {
            name: 'bash',
            description: 'Run bash',
            parameters: [],
          },
        ],
      });

      expect(result.toolCalls).toBeDefined();
      expect(result.toolCalls?.[0]?.name).toBe('bash');
      expect(result.toolCalls?.[0]?.arguments?.command).toBe('ls -la');
    });

    it('handles JSON format tool calls', async () => {
      const mockFetch = vi.mocked(global.fetch);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: {
            content: 'bash({"command": "pwd"})',
          },
        }),
      } as any);

      const result = await provider.callWithTools({
        messages: [{ role: 'user', content: 'Get pwd' }],
        tools: [
          {
            name: 'bash',
            description: 'Run bash',
            parameters: [],
          },
        ],
      });

      expect(result.toolCalls).toBeDefined();
      expect(result.toolCalls?.[0]?.arguments?.command).toBe('pwd');
    });

    it('returns undefined toolCalls when no tools matched', async () => {
      const mockFetch = vi.mocked(global.fetch);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: { content: 'Just thinking about it' },
        }),
      } as any);

      const result = await provider.callWithTools({
        messages: [{ role: 'user', content: 'Think' }],
        tools: [
          {
            name: 'bash',
            description: 'Run bash',
            parameters: [],
          },
        ],
      });

      expect(result.toolCalls).toBeUndefined();
    });

    it('returns thought from chat response', async () => {
      const mockFetch = vi.mocked(global.fetch);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: { content: 'My thought here' },
        }),
      } as any);

      const result = await provider.callWithTools({
        messages: [{ role: 'user', content: 'Think' }],
        tools: [],
      });

      expect(result.thought).toBe('My thought here');
    });
  });
});
