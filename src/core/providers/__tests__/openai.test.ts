/**
 * OpenAI Provider Tests
 *
 * Tests for OpenAI LLM provider implementation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAIProvider } from '../openai.js';
import OpenAI from 'openai';

vi.mock('openai');

describe('OpenAIProvider', () => {
  let provider: OpenAIProvider;
  let mockClient: any;

  beforeEach(() => {
    mockClient = {
      chat: {
        completions: {
          create: vi.fn(),
        },
      },
    };
    vi.mocked(OpenAI).mockImplementation(() => mockClient as any);
    provider = new OpenAIProvider('test-key-123', 'gpt-4o');
    vi.clearAllMocks();
  });

  describe('initialization', () => {
    it('creates provider with API key', () => {
      expect(provider.name).toBe('openai');
    });

    it('throws error without API key', () => {
      expect(() => {
        new OpenAIProvider('');
      }).toThrow('OpenAI API key is required');
    });

    it('uses custom model', () => {
      const p = new OpenAIProvider('key', 'gpt-3.5-turbo');
      expect(p.name).toBe('openai');
    });

    it('initializes OpenAI client', () => {
      new OpenAIProvider('my-key');
      expect(vi.mocked(OpenAI)).toHaveBeenCalledWith({
        apiKey: 'my-key',
      });
    });
  });

  describe('validateToolCallSupport', () => {
    it('supports gpt-4', async () => {
      const result = await provider.validateToolCallSupport('gpt-4');
      expect(result.supported).toBe(true);
    });

    it('supports gpt-4o', async () => {
      const result = await provider.validateToolCallSupport('gpt-4o');
      expect(result.supported).toBe(true);
    });

    it('supports gpt-4-turbo', async () => {
      const result = await provider.validateToolCallSupport('gpt-4-turbo');
      expect(result.supported).toBe(true);
    });

    it('supports gpt-3.5-turbo', async () => {
      const result = await provider.validateToolCallSupport('gpt-3.5-turbo');
      expect(result.supported).toBe(true);
    });

    it('rejects unsupported models', async () => {
      const result = await provider.validateToolCallSupport('gpt-2');
      expect(result.supported).toBe(false);
      expect(result.message).toContain('may not support tool calling');
    });

    it('is case insensitive', async () => {
      const result = await provider.validateToolCallSupport('GPT-4O');
      expect(result.supported).toBe(true);
    });
  });

  describe('chat', () => {
    it('calls API with correct parameters', async () => {
      mockClient.chat.completions.create.mockResolvedValueOnce({
        choices: [{ message: { content: 'Hello!' } }],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
        },
      });

      await provider.chat({
        messages: [{ role: 'user', content: 'Hi' }],
        temperature: 0.5,
        maxTokens: 100,
      });

      expect(mockClient.chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gpt-4o',
          messages: [{ role: 'user', content: 'Hi' }],
          temperature: 0.5,
          max_tokens: 100,
        })
      );
    });

    it('uses default temperature and maxTokens', async () => {
      mockClient.chat.completions.create.mockResolvedValueOnce({
        choices: [{ message: { content: 'Hello!' } }],
      });

      await provider.chat({
        messages: [{ role: 'user', content: 'Hi' }],
      });

      expect(mockClient.chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0.7,
          max_tokens: 4096,
        })
      );
    });

    it('returns content and usage', async () => {
      mockClient.chat.completions.create.mockResolvedValueOnce({
        choices: [{ message: { content: 'Test response' } }],
        usage: {
          prompt_tokens: 20,
          completion_tokens: 10,
          total_tokens: 30,
        },
        model: 'gpt-4o',
      });

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
      mockClient.chat.completions.create.mockResolvedValueOnce({
        choices: [{ message: { content: 'Hello!' } }],
      });

      const result = await provider.chat({
        messages: [{ role: 'user', content: 'Hi' }],
      });

      expect(result.usage).toBeUndefined();
    });

    it('throws error on API failure', async () => {
      mockClient.chat.completions.create.mockRejectedValueOnce(
        new Error('API Error')
      );

      await expect(
        provider.chat({
          messages: [{ role: 'user', content: 'Hi' }],
        })
      ).rejects.toThrow('OpenAI chat call failed');
    });
  });

  describe('callWithTools', () => {
    it('converts tools to OpenAI format', async () => {
      mockClient.chat.completions.create.mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: 'Let me help',
              tool_calls: [],
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 50,
          completion_tokens: 20,
          total_tokens: 70,
        },
      });

      await provider.callWithTools({
        messages: [{ role: 'user', content: 'Help' }],
        tools: [
          {
            name: 'bash',
            description: 'Run bash commands',
            parameters: [
              {
                name: 'command',
                type: 'string',
                description: 'The command',
                required: true,
              },
            ],
          },
        ],
      });

      const call = mockClient.chat.completions.create.mock.calls[0][0];
      expect(call.tools).toBeDefined();
      expect(call.tools[0]).toEqual(
        expect.objectContaining({
          type: 'function',
          function: expect.objectContaining({
            name: 'bash',
            description: 'Run bash commands',
            parameters: expect.objectContaining({
              type: 'object',
              properties: {
                command: {
                  type: 'string',
                  description: 'The command',
                },
              },
              required: ['command'],
            }),
          }),
        })
      );
    });

    it('parses tool calls from response', async () => {
      mockClient.chat.completions.create.mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: 'Executing command',
              tool_calls: [
                {
                  id: 'call_123',
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
      });

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

      expect(result.toolCalls).toEqual([
        {
          id: 'call_123',
          name: 'bash',
          arguments: { command: 'ls -la' },
        },
      ]);
    });

    it('sets correct finish reason', async () => {
      mockClient.chat.completions.create.mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: 'Done',
              tool_calls: [],
            },
            finish_reason: 'stop',
          },
        ],
      });

      const result = await provider.callWithTools({
        messages: [{ role: 'user', content: 'Hi' }],
        tools: [],
      });

      expect(result.finishReason).toBe('stop');
    });

    it('returns tool_calls finish reason', async () => {
      mockClient.chat.completions.create.mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: 'Using tool',
              tool_calls: [
                {
                  id: 'call_456',
                  function: { name: 'bash', arguments: '{}' },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      });

      const result = await provider.callWithTools({
        messages: [{ role: 'user', content: 'Run' }],
        tools: [
          {
            name: 'bash',
            description: 'Run',
            parameters: [],
          },
        ],
      });

      expect(result.finishReason).toBe('tool_calls');
    });

    it('handles invalid JSON in arguments', async () => {
      mockClient.chat.completions.create.mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: 'Calling tool',
              tool_calls: [
                {
                  id: 'call_789',
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
      });

      await expect(
        provider.callWithTools({
          messages: [{ role: 'user', content: 'Run' }],
          tools: [
            {
              name: 'bash',
              description: 'Run',
              parameters: [],
            },
          ],
        })
      ).rejects.toThrow();
    });
  });
});
