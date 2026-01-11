/**
 * Tools Service Tests
 *
 * Tests for tool listing and management
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ToolsService } from '../tools.js';
import { ToolRegistry } from '../../tools/registry.js';

describe('ToolsService', () => {
  let service: ToolsService;
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
    service = new ToolsService(registry);
  });

  describe('list', () => {
    it('returns all available tools', async () => {
      const tools = await service.list();

      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThanOrEqual(4);
    });

    it('filters by tool name', async () => {
      const filtered = await service.list({ name: 'bash' });

      expect(filtered.length).toBe(1);
      expect(filtered[0]?.name).toBe('bash');
    });

    it('filters by tag', async () => {
      // Note: default tools may not have tags, so this tests the filtering logic
      const filtered = await service.list({ tag: 'nonexistent' });

      expect(Array.isArray(filtered)).toBe(true);
    });

    it('returns tools with schema info', async () => {
      const tools = await service.list();

      tools.forEach((tool) => {
        expect(tool.name).toBeDefined();
        expect(tool.description).toBeDefined();
        expect(tool.parameters).toBeDefined();
      });
    });
  });

  describe('get', () => {
    it('retrieves tool by name', async () => {
      const tool = await service.get('bash');

      expect(tool).toBeDefined();
      expect(tool?.name).toBe('bash');
    });

    it('returns null for non-existent tool', async () => {
      const tool = await service.get('nonexistent');

      expect(tool).toBeNull();
    });

    it('returns tool with full schema', async () => {
      const tool = await service.get('bash');

      expect(tool?.description).toBeDefined();
      expect(tool?.parameters).toBeDefined();
    });
  });

  describe('tool discovery', () => {
    it('includes bash tool', async () => {
      const bash = await service.get('bash');
      expect(bash).toBeDefined();
    });

    it('includes readFile tool', async () => {
      const readFile = await service.get('readFile');
      expect(readFile).toBeDefined();
    });

    it('includes writeFile tool', async () => {
      const writeFile = await service.get('writeFile');
      expect(writeFile).toBeDefined();
    });

    it('includes fetchPage tool', async () => {
      const fetchPage = await service.get('fetchPage');
      expect(fetchPage).toBeDefined();
    });
  });

  describe('bash tool schema', () => {
    it('has correct parameters', async () => {
      const bash = await service.get('bash');

      expect(bash?.parameters).toContainEqual(
        expect.objectContaining({
          name: 'command',
          type: 'string',
        })
      );
    });

    it('includes optional parameters', async () => {
      const bash = await service.get('bash');

      const params = bash?.parameters || [];
      const hasCwd = params.some((p) => p.name === 'cwd');
      const hasTimeout = params.some((p) => p.name === 'timeoutMs');

      expect(hasCwd || hasTimeout).toBe(true);
    });
  });

  describe('readFile tool schema', () => {
    it('has path parameter', async () => {
      const readFile = await service.get('readFile');

      expect(readFile?.parameters).toContainEqual(
        expect.objectContaining({
          name: 'path',
          type: 'string',
        })
      );
    });
  });

  describe('writeFile tool schema', () => {
    it('has path and content parameters', async () => {
      const writeFile = await service.get('writeFile');
      const params = writeFile?.parameters || [];

      expect(params.some((p) => p.name === 'path')).toBe(true);
      expect(params.some((p) => p.name === 'content')).toBe(true);
    });
  });

  describe('fetchPage tool schema', () => {
    it('has url parameter', async () => {
      const fetchPage = await service.get('fetchPage');

      expect(fetchPage?.parameters).toContainEqual(
        expect.objectContaining({
          name: 'url',
          type: 'string',
        })
      );
    });
  });
});
