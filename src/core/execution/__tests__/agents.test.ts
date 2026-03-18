/**
 * Agents Service Tests
 *
 * Tests for agent management and activation
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentsService, generateAgentId } from '../agents.js';
import { agents } from '../../../db/schema.js';

vi.mock('../../../util/logger.js', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

type InMemoryState = {
  agents: any[];
};

const TABLE_NAME = Symbol.for('drizzle:Name');

function tableNameOf(table: any): keyof InMemoryState {
  return table?.[TABLE_NAME] as keyof InMemoryState;
}

function clone<T>(value: T): T {
  if (value === undefined || value === null) return value as T;
  return JSON.parse(JSON.stringify(value));
}

function rowKeyForColumn(row: Record<string, any>, columnName: string): string {
  if (columnName in row) return columnName;
  const camel = columnName.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
  if (camel in row) return camel;
  return columnName;
}

function chunkText(chunk: any): string {
  if (chunk?.value && Array.isArray(chunk.value)) return chunk.value.join('');
  return '';
}

function isSqlNode(node: any): node is { queryChunks: any[] } {
  return !!node && Array.isArray(node.queryChunks);
}

function evaluateSqlCondition(sqlNode: any, row: Record<string, any>): boolean {
  if (!isSqlNode(sqlNode)) return true;

  const chunks = sqlNode.queryChunks;

  // Unwrap parentheses: ( <inner> )
  if (
    chunks.length === 3 &&
    chunkText(chunks[0]).trim() === '(' &&
    isSqlNode(chunks[1]) &&
    chunkText(chunks[2]).trim() === ')'
  ) {
    return evaluateSqlCondition(chunks[1], row);
  }

  // Single-condition wrapper: and() with one argument yields { queryChunks: [sqlNode] }
  if (chunks.length === 1 && isSqlNode(chunks[0])) {
    return evaluateSqlCondition(chunks[0], row);
  }

  // AND at this level: chunks contain SQL-node parts separated by ' and ' text chunks
  const hasAndText = chunks.some(
    (chunk: any) => !isSqlNode(chunk) && chunkText(chunk).includes(' and ')
  );
  if (hasAndText) {
    return chunks
      .filter(isSqlNode)
      .every((part: any) => evaluateSqlCondition(part, row));
  }

  // AND wrapped in a nested SQL node (drizzle sometimes nests differently)
  const andWrapper = chunks.find(
    (chunk: any) =>
      isSqlNode(chunk) &&
      chunk.queryChunks.some((c: any) => chunkText(c).includes(' and '))
  );
  if (andWrapper) {
    return andWrapper.queryChunks
      .filter(isSqlNode)
      .every((part: any) => evaluateSqlCondition(part, row));
  }

  const textChunks = chunks.map(chunkText).join('');
  const columnChunk = chunks.find(
    (chunk: any) => typeof chunk?.name === 'string'
  );
  if (!columnChunk) return true;

  const key = rowKeyForColumn(row, columnChunk.name);

  if (textChunks.includes(' is not null')) {
    return row[key] !== null && row[key] !== undefined;
  }

  const paramChunk = chunks.find(
    (chunk: any) =>
      chunk?.constructor?.name === 'Param' ||
      (typeof chunk?.value !== 'undefined' && !Array.isArray(chunk.value))
  );
  const rhs = paramChunk?.value;

  if (textChunks.includes(' = ')) return row[key] === rhs;
  if (textChunks.includes(' >= ')) return row[key] >= rhs;
  if (textChunks.includes(' <= ')) return row[key] <= rhs;

  return true;
}

function createInMemoryDb(): any {
  const state: InMemoryState = {
    agents: [],
  };

  const db: any = {
    __state: state,
    query: {
      agents: {
        findFirst: async (opts: any) =>
          clone(
            state.agents.find((row) =>
              evaluateSqlCondition(opts?.where, row)
            )
          ),
        findMany: async (opts: any) =>
          clone(
            state.agents.filter((row) =>
              evaluateSqlCondition(opts?.where, row)
            )
          ),
      },
    },
    insert: (table: any) => ({
      values: async (values: any | any[]) => {
        const key = tableNameOf(table);
        const records = Array.isArray(values) ? values : [values];
        state[key].push(...clone(records));
      },
    }),
    update: (table: any) => ({
      set: (patch: Record<string, any>) => ({
        where: async (condition: any) => {
          const key = tableNameOf(table);
          state[key] = state[key].map((row) => {
            if (!evaluateSqlCondition(condition, row)) return row;
            const next = { ...row };
            for (const [field, value] of Object.entries(patch)) {
              next[field] = value;
            }
            return next;
          });
        },
      }),
    }),
    delete: (table: any) => ({
      where: async (condition: any) => {
        const key = tableNameOf(table);
        state[key] = state[key].filter(
          (row) => !evaluateSqlCondition(condition, row)
        );
      },
    }),
  };

  return db;
}

describe('AgentsService', () => {
  let service: AgentsService;
  let db: any;

  beforeEach(() => {
    AgentsService.clearCache();
    db = createInMemoryDb();
    service = new AgentsService(db);
  });

  describe('generateAgentId', () => {
    it('generates agent ID with agent_ prefix', () => {
      const id = generateAgentId();
      expect(id).toMatch(/^agent_[A-Za-z0-9_-]+$/);
    });

    it('generates unique IDs', () => {
      const id1 = generateAgentId();
      const id2 = generateAgentId();
      expect(id1).not.toBe(id2);
    });
  });

  describe('create', () => {
    it('creates agent with required fields', async () => {
      const agent = await service.create(
        'TestAgent',
        '1.0.0',
        'You are helpful',
        { provider: 'openai' }
      );

      expect(agent.id).toMatch(/^agent_/);
      expect(agent.name).toBe('TestAgent');
      expect(agent.version).toBe('1.0.0');
      expect(agent.systemPrompt).toBe('You are helpful');
      expect(agent.isActive).toBe(false);
    });

    it('rejects duplicate name+version', async () => {
      await service.create('TestAgent', '1.0.0', 'Prompt', {});

      await expect(
        service.create('TestAgent', '1.0.0', 'Different', {})
      ).rejects.toThrow('already exists');
    });

    it('allows same name with different version', async () => {
      await service.create('TestAgent', '1.0.0', 'Prompt', {});
      const agent2 = await service.create('TestAgent', '2.0.0', 'Prompt', {});

      expect(agent2.version).toBe('2.0.0');
    });

    it('stores agent metadata', async () => {
      const metadata = { description: 'Test agent' };
      const agent = await service.create(
        'TestAgent',
        '1.0.0',
        'Prompt',
        { metadata }
      );

      expect(agent.metadata).toEqual(expect.objectContaining(metadata));
    });
  });

  describe('get', () => {
    it('retrieves agent by ID', async () => {
      const created = await service.create('TestAgent', '1.0.0', 'Prompt', {});
      const retrieved = await service.get(created.id);

      expect(retrieved.id).toBe(created.id);
      expect(retrieved.name).toBe('TestAgent');
    });

    it('throws error for non-existent agent', async () => {
      await expect(service.get('agent_nonexistent')).rejects.toThrow(
        'not found'
      );
    });
  });

  describe('list', () => {
    it('lists all agents', async () => {
      await service.create('Agent1', '1.0.0', 'P1', {});
      await service.create('Agent2', '1.0.0', 'P2', {});

      const agents = await service.list();

      expect(agents.length).toBeGreaterThanOrEqual(2);
    });

    it('filters by name', async () => {
      await service.create('Agent1', '1.0.0', 'P1', {});
      await service.create('Agent2', '1.0.0', 'P2', {});

      const filtered = await service.list({ name: 'Agent1' });

      expect(filtered.every((a) => a.name === 'Agent1')).toBe(true);
    });

    it('filters by active status', async () => {
      const a1 = await service.create('Agent1', '1.0.0', 'P1', {});
      const a2 = await service.create('Agent2', '1.0.0', 'P2', {});

      await service.activate(a1.id);

      const active = await service.list({ active: true });
      const inactive = await service.list({ active: false });

      expect(active.some((a) => a.id === a1.id)).toBe(true);
      expect(inactive.some((a) => a.id === a2.id)).toBe(true);
    });
  });

  describe('update', () => {
    it('updates agent fields', async () => {
      const agent = await service.create('TestAgent', '1.0.0', 'Prompt', {});
      const updated = await service.update(agent.id, {
        name: 'UpdatedAgent',
      });

      expect(updated.name).toBe('UpdatedAgent');
    });

    it('rejects duplicate name+version on update', async () => {
      await service.create('Agent1', '1.0.0', 'P1', {});
      const agent2 = await service.create('Agent2', '1.0.0', 'P2', {});

      await expect(
        service.update(agent2.id, { name: 'Agent1' })
      ).rejects.toThrow('already exists');
    });

    it('allows self-update', async () => {
      const agent = await service.create('TestAgent', '1.0.0', 'Prompt', {});
      const updated = await service.update(agent.id, {
        systemPrompt: 'New prompt',
      });

      expect(updated.systemPrompt).toBe('New prompt');
    });

    it('throws error for non-existent agent', async () => {
      await expect(
        service.update('agent_nonexistent', { name: 'New' })
      ).rejects.toThrow('not found');
    });

    it('updates provider correctly', async () => {
      const agent = await service.create('TestAgent', '1.0.0', 'Prompt', { provider: 'openai' });
      const updated = await service.update(agent.id, { provider: 'ollama' } as any);
      expect(updated.provider).toBe('ollama');
    });

    it('updates model correctly', async () => {
      const agent = await service.create('TestAgent', '1.0.0', 'Prompt', { provider: 'openai', model: 'gpt-4o' });
      const updated = await service.update(agent.id, { model: 'gpt-3.5-turbo' } as any);
      expect(updated.model).toBe('gpt-3.5-turbo');
    });

    it('updates isActive correctly', async () => {
      const agent = await service.create('TestAgent', '1.0.0', 'Prompt', {});
      const updated = await service.update(agent.id, { isActive: true } as any);
      expect(updated.isActive).toBe(true);
    });

    it('updates metadata correctly', async () => {
      const agent = await service.create('TestAgent', '1.0.0', 'Prompt', { metadata: { key1: 'value1' } });
      const updated = await service.update(agent.id, { metadata: { newKey: 'newValue' } } as any);
      expect(updated.metadata).toEqual({ newKey: 'newValue' });
    });

    it('updates description correctly (stored in metadata)', async () => {
      const agent = await service.create('TestAgent', '1.0.0', 'Prompt', {});
      const updated = await service.update(agent.id, { description: 'A test description' } as any);
      expect(updated.description).toBe('A test description');
      expect(updated.metadata?.description).toBe('A test description');
    });

    it('description preserves existing metadata', async () => {
      const agent = await service.create('TestAgent', '1.0.0', 'Prompt', {});
      await service.update(agent.id, { metadata: { key1: 'value1', key2: 'value2' } } as any);
      const updated = await service.update(agent.id, { description: 'Updated desc' } as any);
      expect(updated.description).toBe('Updated desc');
      expect(updated.metadata?.key1).toBe('value1');
      expect(updated.metadata?.key2).toBe('value2');
    });

    it('sending both metadata and description preserves both', async () => {
      const agent = await service.create('TestAgent', '1.0.0', 'Prompt', {});
      const updated = await service.update(agent.id, {
        metadata: { foo: 'bar' },
        description: 'My description',
      } as any);
      expect(updated.description).toBe('My description');
      expect(updated.metadata?.foo).toBe('bar');
      expect(updated.metadata?.description).toBe('My description');
    });

    it('constraints.maxTokens should NOT overwrite model', async () => {
      const agent = await service.create('TestAgent', '1.0.0', 'Prompt', { provider: 'openai', model: 'gpt-4o' });
      const updated = await service.update(agent.id, {
        constraints: { maxTokens: 4096 },
      } as any);
      expect(updated.model).toBe('gpt-4o');
      expect(typeof updated.model).toBe('string');
    });

    it('constraints.maxTokens with model update - model should win', async () => {
      const agent = await service.create('TestAgent', '1.0.0', 'Prompt', { provider: 'openai', model: 'gpt-4o' });
      const updated = await service.update(agent.id, {
        constraints: { maxTokens: 4096 },
        model: 'gpt-3.5-turbo',
      } as any);
      expect(updated.model).toBe('gpt-3.5-turbo');
    });

    it('constraints stored in metadata, not overwriting model', async () => {
      const agent = await service.create('TestAgent', '1.0.0', 'Prompt', { provider: 'openai', model: 'gpt-4o' });
      const updated = await service.update(agent.id, {
        constraints: { maxTokens: 4096, temperature: 0.7 },
      } as any);
      expect(updated.model).toBe('gpt-4o');
      expect(updated.metadata?.constraints).toEqual({ maxTokens: 4096, temperature: 0.7 });
    });

    it('all three: metadata + description + constraints preserved together', async () => {
      const agent = await service.create('TestAgent', '1.0.0', 'Prompt', { provider: 'openai', model: 'gpt-4o' });
      const updated = await service.update(agent.id, {
        metadata: { foo: 'bar' },
        description: 'My desc',
        constraints: { maxTokens: 2048 },
      } as any);
      expect(updated.metadata?.foo).toBe('bar');
      expect(updated.metadata?.description).toBe('My desc');
      expect(updated.metadata?.constraints).toEqual({ maxTokens: 2048 });
      expect(updated.model).toBe('gpt-4o');
    });

    it('updates updatedAt timestamp on every update', async () => {
      const agent = await service.create('TestAgent', '1.0.0', 'Prompt', {});
      const before = await service.get(agent.id);
      await new Promise((r) => setTimeout(r, 50));
      const updated = await service.update(agent.id, { name: 'time-test' });
      expect(new Date(updated.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(before.updatedAt).getTime());
    });
  });

  describe('activate', () => {
    it('activates agent', async () => {
      const agent = await service.create('TestAgent', '1.0.0', 'Prompt', {});
      const activated = await service.activate(agent.id);

      expect(activated.isActive).toBe(true);
    });

    it('deactivates other agents with same name', async () => {
      const a1 = await service.create('TestAgent', '1.0.0', 'P1', {});
      const a2 = await service.create('TestAgent', '2.0.0', 'P2', {});

      await service.activate(a1.id);
      await service.activate(a2.id);

      const refreshed1 = await service.get(a1.id);
      const refreshed2 = await service.get(a2.id);

      expect(refreshed1.isActive).toBe(false);
      expect(refreshed2.isActive).toBe(true);
    });

    it('throws error for non-existent agent', async () => {
      await expect(service.activate('agent_nonexistent')).rejects.toThrow(
        'not found'
      );
    });
  });

  describe('resolve', () => {
    it('resolves active agent by name', async () => {
      const agent = await service.create('TestAgent', '1.0.0', 'Prompt', {});
      await service.activate(agent.id);

      const resolved = await service.resolve('TestAgent');

      expect(resolved?.id).toBe(agent.id);
    });

    it('returns null when no active agent', async () => {
      const resolved = await service.resolve('NonExistent');

      expect(resolved).toBeNull();
    });

    it('returns null for inactive agent', async () => {
      await service.create('TestAgent', '1.0.0', 'Prompt', {});

      const resolved = await service.resolve('TestAgent');

      expect(resolved).toBeNull();
    });
  });

  describe('delete', () => {
    it('deletes inactive agent', async () => {
      const agent = await service.create('TestAgent', '1.0.0', 'Prompt', {});

      await service.delete(agent.id);

      await expect(service.get(agent.id)).rejects.toThrow('not found');
    });

    it('throws error deleting active agent', async () => {
      const agent = await service.create('TestAgent', '1.0.0', 'Prompt', {});
      await service.activate(agent.id);

      await expect(service.delete(agent.id)).rejects.toThrow(
        'Cannot delete active agent'
      );
    });

    it('throws error for non-existent agent', async () => {
      await expect(service.delete('agent_nonexistent')).rejects.toThrow(
        'not found'
      );
    });
  });
});
