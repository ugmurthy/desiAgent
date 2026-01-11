/**
 * Agents Service Tests
 *
 * Tests for agent management and activation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AgentsService, generateAgentId } from '../agents.js';
import { getDatabase } from '../../db/client.js';

describe('AgentsService', () => {
  let service: AgentsService;
  let db: any;

  beforeEach(() => {
    const dbPath = ':memory:';
    db = getDatabase(dbPath);
    service = new AgentsService(db);
  });

  describe('generateAgentId', () => {
    it('generates agent ID with agent_ prefix', () => {
      const id = generateAgentId();
      expect(id).toMatch(/^agent_[a-z0-9]+$/);
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
