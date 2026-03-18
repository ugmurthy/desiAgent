/**
 * Tool Executor Tests
 *
 * Tests for tool execution and validation
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ToolExecutor } from '../executor.js';
import { ToolRegistry } from '../registry.js';
import { BaseTool } from '../base.js';
import { z } from 'zod';

class MockTool extends BaseTool<{ value: string }, { result: string }> {
  name = 'mockTool';
  description = 'Mock tool for testing';
  inputSchema = z.object({
    value: z.string().describe('Test value'),
  });

  async execute(input: { value: string }): Promise<{ result: string }> {
    return { result: `processed: ${input.value}` };
  }
}

class FailingTool extends BaseTool<any, any> {
  name = 'failingTool';
  description = 'Tool that fails';
  inputSchema = z.object({});

  async execute(): Promise<any> {
    throw new Error('Tool execution failed');
  }
}

describe('ToolExecutor', () => {
  let executor: ToolExecutor;
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
    executor = new ToolExecutor(registry, '/tmp/test-artifacts');
  });

  describe('execute', () => {
    it('executes tool successfully', async () => {
      registry.register(new MockTool());

      const result = await executor.execute('mockTool', { value: 'test' });

      expect(result.status).toBe('success');
      expect(result.toolName).toBe('mockTool');
      expect(result.output).toEqual({ result: 'processed: test' });
    });

    it('includes timestamp in result', async () => {
      registry.register(new MockTool());

      const result = await executor.execute('mockTool', { value: 'test' });

      expect(result.timestamp).toBeInstanceOf(Date);
    });

    it('returns error status on failure', async () => {
      registry.register(new FailingTool());

      const result = await executor.execute('failingTool', {});

      expect(result.status).toBe('error');
      expect(result.error).toBeDefined();
      expect(result.error?.message).toBe('Tool execution failed');
    });

    it('throws error for non-existent tool', async () => {
      await expect(
        executor.execute('nonExistent', {})
      ).rejects.toThrow('Tool not found: nonExistent');
    });

    it('includes tool call ID in result', async () => {
      registry.register(new MockTool());

      const result = await executor.execute('mockTool', { value: 'test' }, 'call_123');

      expect(result.toolCallId).toBe('call_123');
    });

    it('lists built-in bash tool', () => {
      const tools = executor.listTools();
      expect(tools.some((t) => t.function.name === 'bash')).toBe(true);
    });

    it('lists built-in readFile tool', () => {
      const tools = executor.listTools();
      expect(tools.some((t) => t.function.name === 'readFile')).toBe(true);
    });

    it('lists built-in writeFile tool', () => {
      const tools = executor.listTools();
      expect(tools.some((t) => t.function.name === 'writeFile')).toBe(true);
    });

    it('lists built-in fetchPage tool', () => {
      const tools = executor.listTools();
      expect(tools.some((t) => t.function.name === 'fetchPage')).toBe(true);
    });
  });

  describe('validateToolInput', () => {
    it('validates correct input', () => {
      registry.register(new MockTool());

      const isValid = executor.validateToolInput('mockTool', { value: 'test' });

      expect(isValid).toBe(true);
    });

    it('rejects invalid input', () => {
      registry.register(new MockTool());

      const isValid = executor.validateToolInput('mockTool', { value: 123 });

      expect(isValid).toBe(false);
    });

    it('rejects non-existent tool', () => {
      const isValid = executor.validateToolInput('nonExistent', {});

      expect(isValid).toBe(false);
    });

    it('validates missing required field', () => {
      registry.register(new MockTool());

      const isValid = executor.validateToolInput('mockTool', {});

      expect(isValid).toBe(false);
    });
  });

  describe('getToolSchema', () => {
    it('returns schema for registered tool', () => {
      registry.register(new MockTool());

      const schema = executor.getToolSchema('mockTool');

      expect(schema).toBeDefined();
      expect(schema?.type).toBe('function');
      expect(schema?.function.name).toBe('mockTool');
      expect(schema?.function.description).toBe('Mock tool for testing');
      expect(schema?.function.parameters).toBeDefined();
    });

    it('returns null for non-existent tool', () => {
      const schema = executor.getToolSchema('nonExistent');

      expect(schema).toBeNull();
    });

    it('includes parameter info in JSON Schema format', () => {
      registry.register(new MockTool());

      const schema = executor.getToolSchema('mockTool');
      const props = schema?.function.parameters?.properties;

      expect(props).toHaveProperty('value');
      expect(props?.value?.type).toBe('string');
    });
  });

  describe('listTools', () => {
    it('returns all available tools', () => {
      const tools = executor.listTools();

      expect(tools.length).toBe(12);
    });

    it('includes default tools', () => {
      const tools = executor.listTools();

      const names = tools.map((t) => t.function.name);
      expect(names).toContain('bash');
      expect(names).toContain('readFile');
      expect(names).toContain('writeFile');
      expect(names).toContain('fetchPage');
    });

    it('includes custom registered tools', () => {
      registry.register(new MockTool());

      const tools = executor.listTools();

      expect(tools.some((t) => t.function.name === 'mockTool')).toBe(true);
    });

    it('returns tool definitions with correct shape', () => {
      const tools = executor.listTools();

      tools.forEach((tool) => {
        expect(tool.type).toBe('function');
        expect(tool.function.name).toBeDefined();
        expect(tool.function.description).toBeDefined();
        expect(tool.function.parameters).toBeDefined();
      });
    });
  });

  describe('error handling', () => {
    it('preserves error details on failure', async () => {
      registry.register(new FailingTool());

      const result = await executor.execute('failingTool', {});

      expect(result.status).toBe('error');
      expect(result.error?.message).toContain('failed');
    });

    it('handles non-Error exceptions', async () => {
      class ThrowingTool extends BaseTool<any, any> {
        name = 'throwingTool';
        description = 'Throws non-Error';
        inputSchema = z.object({});

        async execute(): Promise<any> {
          throw 'string error';
        }
      }

      registry.register(new ThrowingTool());

      const result = await executor.execute('throwingTool', {});

      expect(result.status).toBe('error');
      expect(result.error?.message).toBe('string error');
    });
  });
});
