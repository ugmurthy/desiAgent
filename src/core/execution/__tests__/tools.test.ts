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
    it('returns all available (non-restricted) tools', async () => {
      const tools = await service.list();

      expect(Array.isArray(tools)).toBe(true);
      // 12 default tools minus 1 restricted (sendWebhook) = 11
      expect(tools.length).toBe(11);
    });

    it('filters by tool name', async () => {
      const filtered = await service.list({ name: 'bash' });

      expect(filtered.length).toBe(1);
      expect(filtered[0]?.function.name).toBe('bash');
    });

    it('returns empty when filtering by unknown name', async () => {
      const filtered = await service.list({ name: 'nonexistent' });

      expect(filtered.length).toBe(0);
    });

    it('returns tools with correct ToolDefinition shape', async () => {
      const tools = await service.list();

      tools.forEach((tool) => {
        expect(tool.type).toBe('function');
        expect(tool.function.name).toBeDefined();
        expect(tool.function.description).toBeDefined();
        expect(tool.function.parameters).toBeDefined();
      });
    });

    it('excludes restricted tools', async () => {
      const tools = await service.list();
      const names = tools.map((t) => t.function.name);

      expect(names).not.toContain('sendWebhook');
    });
  });

  describe('get', () => {
    it('retrieves tool by name', async () => {
      const tool = await service.get('bash');

      expect(tool).not.toBeNull();
      expect(tool?.function.name).toBe('bash');
    });

    it('returns null for non-existent tool', async () => {
      const tool = await service.get('nonexistent');

      expect(tool).toBeNull();
    });

    it('returns null for restricted tool', async () => {
      const tool = await service.get('sendWebhook');

      expect(tool).toBeNull();
    });

    it('returns tool with full schema', async () => {
      const tool = await service.get('bash');

      expect(tool?.type).toBe('function');
      expect(tool?.function.description).toBeDefined();
      expect(tool?.function.parameters).toBeDefined();
    });
  });

  describe('tool discovery', () => {
    it('includes bash tool', async () => {
      const bash = await service.get('bash');
      expect(bash).not.toBeNull();
    });

    it('includes readFile tool', async () => {
      const readFile = await service.get('readFile');
      expect(readFile).not.toBeNull();
    });

    it('includes writeFile tool', async () => {
      const writeFile = await service.get('writeFile');
      expect(writeFile).not.toBeNull();
    });

    it('includes fetchPage tool', async () => {
      const fetchPage = await service.get('fetchPage');
      expect(fetchPage).not.toBeNull();
    });
  });

  describe('bash tool schema', () => {
    it('has command parameter', async () => {
      const bash = await service.get('bash');
      const props = bash?.function.parameters?.properties;

      expect(props).toHaveProperty('command');
      expect(props?.command?.type).toBe('string');
    });

    it('includes optional parameters', async () => {
      const bash = await service.get('bash');
      const props = bash?.function.parameters?.properties ?? {};

      expect('cwd' in props || 'timeoutMs' in props).toBe(true);
    });
  });

  describe('readFile tool schema', () => {
    it('has path parameter', async () => {
      const readFile = await service.get('readFile');
      const props = readFile?.function.parameters?.properties;

      expect(props).toHaveProperty('path');
      expect(props?.path?.type).toBe('string');
    });
  });

  describe('writeFile tool schema', () => {
    it('has path and content parameters', async () => {
      const writeFile = await service.get('writeFile');
      const props = writeFile?.function.parameters?.properties ?? {};

      expect('path' in props).toBe(true);
      expect('content' in props).toBe(true);
    });
  });

  describe('fetchPage tool schema', () => {
    it('has url parameter', async () => {
      const fetchPage = await service.get('fetchPage');
      const props = fetchPage?.function.parameters?.properties;

      expect(props).toHaveProperty('url');
      expect(props?.url?.type).toBe('string');
    });
  });

  describe('isRestricted / isAllowed', () => {
    it('reports sendWebhook as restricted', () => {
      expect(service.isRestricted('sendWebhook')).toBe(true);
      expect(service.isAllowed('sendWebhook')).toBe(false);
    });

    it('reports bash as allowed', () => {
      expect(service.isRestricted('bash')).toBe(false);
      expect(service.isAllowed('bash')).toBe(true);
    });
  });
});
