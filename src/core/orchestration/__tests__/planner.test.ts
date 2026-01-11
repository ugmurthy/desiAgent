/**
 * Agent Planner Tests
 *
 * Tests for planning logic and LLM integration
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentPlanner } from '../planner.js';
import type { LLMProvider } from '../../providers/types.js';

describe('AgentPlanner', () => {
  let planner: AgentPlanner;
  let mockProvider: any;

  beforeEach(() => {
    mockProvider = {
      name: 'test-provider',
      callWithTools: vi.fn(),
      chat: vi.fn(),
      validateToolCallSupport: vi.fn(),
    } as unknown as LLMProvider;

    planner = new AgentPlanner(mockProvider);
  });

  describe('initialization', () => {
    it('creates planner with provider', () => {
      expect(planner).toBeDefined();
    });

    it('accepts custom prompt', () => {
      const custom = new AgentPlanner(mockProvider, 'Custom prompt');
      expect(custom).toBeDefined();
    });
  });

  describe('plan', () => {
    it('calls LLM provider with correct parameters', async () => {
      mockProvider.callWithTools.mockResolvedValueOnce({
        thought: 'Thinking...',
        toolCalls: [],
        finishReason: 'stop',
      });

      const context = {
        objective: 'Test objective',
        workingMemory: {},
        stepHistory: [],
        stepsRemaining: 10,
        tools: [
          {
            name: 'bash',
            description: 'Run bash',
            parameters: [],
          },
        ],
        temperature: 0.7,
        maxTokens: 1024,
      };

      await planner.plan(context);

      expect(mockProvider.callWithTools).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({ role: 'system' }),
            expect.objectContaining({ role: 'user' }),
          ]),
          tools: context.tools,
          temperature: 0.7,
          maxTokens: 1024,
        })
      );
    });

    it('returns thought from LLM response', async () => {
      mockProvider.callWithTools.mockResolvedValueOnce({
        thought: 'My thought process',
        toolCalls: [],
        finishReason: 'stop',
      });

      const result = await planner.plan({
        objective: 'Test',
        workingMemory: {},
        stepHistory: [],
        stepsRemaining: 10,
        tools: [],
      });

      expect(result.thought).toBe('My thought process');
    });

    it('returns tool calls from LLM response', async () => {
      mockProvider.callWithTools.mockResolvedValueOnce({
        thought: 'Calling bash',
        toolCalls: [
          {
            id: 'call_1',
            name: 'bash',
            arguments: { command: 'ls' },
          },
        ],
        finishReason: 'tool_calls',
      });

      const result = await planner.plan({
        objective: 'Test',
        workingMemory: {},
        stepHistory: [],
        stepsRemaining: 10,
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
          id: 'call_1',
          name: 'bash',
          arguments: { command: 'ls' },
        },
      ]);
    });

    it('sets shouldFinish=true when finish_reason is stop', async () => {
      mockProvider.callWithTools.mockResolvedValueOnce({
        thought: 'Done',
        toolCalls: [],
        finishReason: 'stop',
      });

      const result = await planner.plan({
        objective: 'Test',
        workingMemory: {},
        stepHistory: [],
        stepsRemaining: 1,
        tools: [],
      });

      expect(result.shouldFinish).toBe(true);
    });

    it('sets shouldFinish=true when steps remaining <= 1', async () => {
      mockProvider.callWithTools.mockResolvedValueOnce({
        thought: 'More work needed',
        toolCalls: [
          {
            id: 'call_1',
            name: 'bash',
            arguments: {},
          },
        ],
        finishReason: 'tool_calls',
      });

      const result = await planner.plan({
        objective: 'Test',
        workingMemory: {},
        stepHistory: [],
        stepsRemaining: 1,
        tools: [
          {
            name: 'bash',
            description: 'Run',
            parameters: [],
          },
        ],
      });

      expect(result.shouldFinish).toBe(true);
    });

    it('sets shouldFinish=false when tool calls and steps remaining', async () => {
      mockProvider.callWithTools.mockResolvedValueOnce({
        thought: 'Continue',
        toolCalls: [
          {
            id: 'call_1',
            name: 'bash',
            arguments: {},
          },
        ],
        finishReason: 'tool_calls',
      });

      const result = await planner.plan({
        objective: 'Test',
        workingMemory: {},
        stepHistory: [],
        stepsRemaining: 5,
        tools: [
          {
            name: 'bash',
            description: 'Run',
            parameters: [],
          },
        ],
      });

      expect(result.shouldFinish).toBe(false);
    });

    it('includes working memory in system prompt', async () => {
      mockProvider.callWithTools.mockResolvedValueOnce({
        thought: 'Test',
        toolCalls: [],
        finishReason: 'stop',
      });

      await planner.plan({
        objective: 'Test',
        workingMemory: { key: 'value' },
        stepHistory: [],
        stepsRemaining: 10,
        tools: [],
      });

      const call = mockProvider.callWithTools.mock.calls[0][0];
      const systemMsg = call.messages[0].content;

      expect(systemMsg).toContain('key');
      expect(systemMsg).toContain('value');
    });

    it('includes step history in user prompt', async () => {
      mockProvider.callWithTools.mockResolvedValueOnce({
        thought: 'Test',
        toolCalls: [],
        finishReason: 'stop',
      });

      await planner.plan({
        objective: 'Test',
        workingMemory: {},
        stepHistory: [
          {
            stepNo: 1,
            thought: 'First step',
            toolName: 'bash',
            observation: 'Result',
          },
        ],
        stepsRemaining: 10,
        tools: [],
      });

      const call = mockProvider.callWithTools.mock.calls[0][0];
      const userMsg = call.messages[1].content;

      expect(userMsg).toContain('First step');
      expect(userMsg).toContain('bash');
      expect(userMsg).toContain('Result');
    });

    it('uses custom prompt when provided', async () => {
      const customPrompt = 'You are a custom agent';
      const customPlanner = new AgentPlanner(mockProvider, customPrompt);

      mockProvider.callWithTools.mockResolvedValueOnce({
        thought: 'Test',
        toolCalls: [],
        finishReason: 'stop',
      });

      await customPlanner.plan({
        objective: 'Test',
        workingMemory: {},
        stepHistory: [],
        stepsRemaining: 10,
        tools: [],
      });

      const call = mockProvider.callWithTools.mock.calls[0][0];
      const systemMsg = call.messages[0].content;

      expect(systemMsg).toBe(customPrompt);
    });

    it('throws error when LLM call fails', async () => {
      mockProvider.callWithTools.mockRejectedValueOnce(
        new Error('LLM Error')
      );

      await expect(
        planner.plan({
          objective: 'Test',
          workingMemory: {},
          stepHistory: [],
          stepsRemaining: 10,
          tools: [],
        })
      ).rejects.toThrow('Planning failed');
    });

    it('uses default temperature when not specified', async () => {
      mockProvider.callWithTools.mockResolvedValueOnce({
        thought: 'Test',
        toolCalls: [],
        finishReason: 'stop',
      });

      await planner.plan({
        objective: 'Test',
        workingMemory: {},
        stepHistory: [],
        stepsRemaining: 10,
        tools: [],
      });

      const call = mockProvider.callWithTools.mock.calls[0][0];
      expect(call.temperature).toBe(0.7);
    });

    it('uses default maxTokens when not specified', async () => {
      mockProvider.callWithTools.mockResolvedValueOnce({
        thought: 'Test',
        toolCalls: [],
        finishReason: 'stop',
      });

      await planner.plan({
        objective: 'Test',
        workingMemory: {},
        stepHistory: [],
        stepsRemaining: 10,
        tools: [],
      });

      const call = mockProvider.callWithTools.mock.calls[0][0];
      expect(call.maxTokens).toBe(4096);
    });
  });
});
