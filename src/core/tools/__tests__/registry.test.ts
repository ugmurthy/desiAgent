/**
 * Tool Registry Tests
 *
 * Tests for tool registration and management
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ToolRegistry } from '../registry.js';
import { BaseTool } from '../base.js';
import { z } from 'zod';

class TestTool extends BaseTool<{ input: string }, { output: string }> {
  name = 'testTool';
  description = 'A test tool';
  inputSchema = z.object({
    input: z.string().describe('Input string'),
  });

  async execute(
    input: { input: string }
  ): Promise<{ output: string }> {
    return { output: input.input.toUpperCase() };
  }
}

class AnotherTestTool extends BaseTool<
  { value: number },
  { result: number }
> {
  name = 'anotherTool';
  description = 'Another test tool';
  inputSchema = z.object({
    value: z.number().describe('A number'),
  });

  async execute(input: { value: number }): Promise<{ result: number }> {
    return { result: input.value * 2 };
  }
}

describe('ToolRegistry', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  describe('initialization', () => {
    it('registers default tools on creation', () => {
      expect(registry.getAll().length).toBe(4);
    });

    it('includes bash tool', () => {
      expect(registry.hasTool('bash')).toBe(true);
    });

    it('includes readFile tool', () => {
      expect(registry.hasTool('readFile')).toBe(true);
    });

    it('includes writeFile tool', () => {
      expect(registry.hasTool('writeFile')).toBe(true);
    });

    it('includes fetchPage tool', () => {
      expect(registry.hasTool('fetchPage')).toBe(true);
    });
  });

  describe('register', () => {
    it('registers custom tool', () => {
      const tool = new TestTool();
      registry.register(tool);

      expect(registry.hasTool('testTool')).toBe(true);
    });

    it('retrieves registered tool', () => {
      const tool = new TestTool();
      registry.register(tool);

      const retrieved = registry.get('testTool');
      expect(retrieved).toBe(tool);
    });

    it('allows multiple custom tools', () => {
      const tool1 = new TestTool();
      const tool2 = new AnotherTestTool();

      registry.register(tool1);
      registry.register(tool2);

      expect(registry.hasTool('testTool')).toBe(true);
      expect(registry.hasTool('anotherTool')).toBe(true);
    });

    it('overwrites tool with same name', () => {
      const tool1 = new TestTool();
      const tool2 = new TestTool();

      registry.register(tool1);
      registry.register(tool2);

      const retrieved = registry.get('testTool');
      expect(retrieved).toBe(tool2);
    });
  });

  describe('get', () => {
    it('returns tool by name', () => {
      const tool = new TestTool();
      registry.register(tool);

      const retrieved = registry.get('testTool');
      expect(retrieved?.name).toBe('testTool');
    });

    it('returns undefined for non-existent tool', () => {
      const retrieved = registry.get('nonExistent');
      expect(retrieved).toBeUndefined();
    });
  });

  describe('getAll', () => {
    it('returns all registered tools', () => {
      const tool = new TestTool();
      registry.register(tool);

      const all = registry.getAll();
      expect(all.length).toBeGreaterThan(4);
      expect(all.some((t) => t.name === 'testTool')).toBe(true);
    });
  });

  describe('getAllDefinitions', () => {
    it('returns JSON schemas for all tools', () => {
      const definitions = registry.getAllDefinitions();

      expect(definitions.length).toBe(4);
      expect(definitions[0]).toHaveProperty('name');
      expect(definitions[0]).toHaveProperty('description');
      expect(definitions[0]).toHaveProperty('parameters');
    });

    it('includes custom tool definitions', () => {
      const tool = new TestTool();
      registry.register(tool);

      const definitions = registry.getAllDefinitions();
      const testDef = definitions.find((d) => d.name === 'testTool');

      expect(testDef).toBeDefined();
      expect(testDef?.description).toBe('A test tool');
    });
  });

  describe('hasTool', () => {
    it('returns true for registered tool', () => {
      const tool = new TestTool();
      registry.register(tool);

      expect(registry.hasTool('testTool')).toBe(true);
    });

    it('returns false for non-existent tool', () => {
      expect(registry.hasTool('nonExistent')).toBe(false);
    });

    it('checks default tools', () => {
      expect(registry.hasTool('bash')).toBe(true);
      expect(registry.hasTool('readFile')).toBe(true);
    });
  });

  describe('filterByNames', () => {
    it('returns all tools when no filter provided', () => {
      const all = registry.getAll();
      const filtered = registry.filterByNames();

      expect(filtered.length).toBe(all.length);
    });

    it('filters tools by name', () => {
      const filtered = registry.filterByNames(['bash', 'readFile']);

      expect(filtered.length).toBe(2);
      expect(filtered.some((t) => t.name === 'bash')).toBe(true);
      expect(filtered.some((t) => t.name === 'readFile')).toBe(true);
    });

    it('returns empty array for invalid names', () => {
      const filtered = registry.filterByNames([
        'nonExistent1',
        'nonExistent2',
      ]);

      expect(filtered.length).toBe(0);
    });

    it('filters by single name', () => {
      const filtered = registry.filterByNames(['bash']);

      expect(filtered.length).toBe(1);
      expect(filtered[0].name).toBe('bash');
    });

    it('ignores non-existent names in mixed list', () => {
      const filtered = registry.filterByNames(['bash', 'nonExistent']);

      expect(filtered.length).toBe(1);
      expect(filtered[0].name).toBe('bash');
    });
  });

  describe('execute', () => {
    it('executes registered tool', async () => {
      const tool = new TestTool();
      registry.register(tool);

      const result = await registry.execute(
        'testTool',
        { input: 'hello' },
        {
          logger: {
            debug: () => {},
            info: () => {},
            warn: () => {},
            error: () => {},
          },
          artifactsDir: '/tmp/test-artifacts',
        }
      );

      expect(result.output).toBe('HELLO');
    });

    it('throws error for non-existent tool', async () => {
      await expect(
        registry.execute(
          'nonExistent',
          {},
          {
            logger: {
              debug: () => {},
              info: () => {},
              warn: () => {},
              error: () => {},
            },
            artifactsDir: '/tmp/test-artifacts',
          }
        )
      ).rejects.toThrow('Tool not found');
    });

    it('passes context to tool', async () => {
      const tool = new TestTool();
      registry.register(tool);

      const contextLogger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      await registry.execute(
        'testTool',
        { input: 'test' },
        {
          logger: contextLogger,
          artifactsDir: '/tmp/test-artifacts',
        }
      );

      expect(contextLogger.debug).toHaveBeenCalled();
    });
  });
});

import { vi } from 'vitest';
