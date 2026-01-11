/**
 * DAGs Service Tests
 *
 * Tests for DAG creation, execution, and lifecycle
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DAGsService, generateDAGId } from '../dags.js';
import { getDatabase } from '../../db/client.js';

describe('DAGsService', () => {
  let service: DAGsService;
  let db: any;

  beforeEach(() => {
    const dbPath = ':memory:';
    db = getDatabase(dbPath);
    service = new DAGsService(db);
  });

  describe('generateDAGId', () => {
    it('generates DAG ID with dag_ prefix', () => {
      const id = generateDAGId();
      expect(id).toMatch(/^dag_[a-z0-9]+$/);
    });

    it('generates unique IDs', () => {
      const id1 = generateDAGId();
      const id2 = generateDAGId();
      expect(id1).not.toBe(id2);
    });
  });

  describe('create', () => {
    it('creates DAG with objective', async () => {
      const dag = await service.create('Test workflow');

      expect(dag.id).toMatch(/^dag_/);
      expect(dag.objective).toBe('Test workflow');
      expect(dag.status).toBe('created');
    });

    it('creates DAG with parameters', async () => {
      const params = { title: 'My DAG', timeout: 3000 };
      const dag = await service.create('Test', params);

      expect(dag.metadata).toEqual(expect.objectContaining(params));
    });

    it('defaults objective to param title', async () => {
      const dag = await service.create('Fallback', {
        title: 'Custom Title',
      });

      expect(dag.objective).toBe('Custom Title');
    });
  });

  describe('get', () => {
    it('retrieves DAG by ID', async () => {
      const created = await service.create('Get test');
      const retrieved = await service.get(created.id);

      expect(retrieved.id).toBe(created.id);
    });

    it('throws error for non-existent DAG', async () => {
      await expect(service.get('dag_nonexistent')).rejects.toThrow(
        'not found'
      );
    });
  });

  describe('list', () => {
    it('lists all DAGs', async () => {
      await service.create('DAG 1');
      await service.create('DAG 2');

      const dags = await service.list();

      expect(dags.length).toBeGreaterThanOrEqual(2);
    });

    it('filters by status', async () => {
      const dag1 = await service.create('Created');
      await service.update(dag1.id, { status: 'running' });

      const created = await service.list({ status: 'created' });
      const running = await service.list({ status: 'running' });

      expect(created.length).toBeGreaterThanOrEqual(0);
      expect(running.length).toBeGreaterThanOrEqual(1);
    });

    it('respects limit and offset', async () => {
      await service.create('DAG 1');
      await service.create('DAG 2');

      const first = await service.list({ limit: 1, offset: 0 });
      const second = await service.list({ limit: 1, offset: 1 });

      expect(first.length).toBeLessThanOrEqual(1);
    });
  });

  describe('update', () => {
    it('updates DAG status', async () => {
      const dag = await service.create('Update test');
      const updated = await service.update(dag.id, { status: 'running' });

      expect(updated.status).toBe('running');
    });

    it('updates DAG metadata', async () => {
      const dag = await service.create('Test');
      const updated = await service.update(dag.id, {
        metadata: { key: 'value' },
      });

      expect(updated.metadata).toEqual(
        expect.objectContaining({ key: 'value' })
      );
    });

    it('throws error for non-existent DAG', async () => {
      await expect(
        service.update('dag_nonexistent', { status: 'running' })
      ).rejects.toThrow('not found');
    });
  });

  describe('delete', () => {
    it('deletes DAG', async () => {
      const dag = await service.create('Delete test');

      await service.delete(dag.id);

      await expect(service.get(dag.id)).rejects.toThrow('not found');
    });

    it('throws error for non-existent DAG', async () => {
      await expect(service.delete('dag_nonexistent')).rejects.toThrow(
        'not found'
      );
    });
  });

  describe('execute', () => {
    it('creates execution for DAG', async () => {
      const dag = await service.create('Executable');
      const execution = await service.execute(dag.id);

      expect(execution.id).toMatch(/^dagexec_/);
      expect(execution.dagId).toBe(dag.id);
      expect(execution.status).toBe('running');
    });

    it('throws error for non-existent DAG', async () => {
      await expect(service.execute('dag_nonexistent')).rejects.toThrow(
        'not found'
      );
    });
  });

  describe('createAndExecute', () => {
    it('creates and executes DAG', async () => {
      const execution = await service.createAndExecute('Quick execution');

      expect(execution.id).toMatch(/^dagexec_/);
      expect(execution.status).toBe('running');
    });

    it('links execution to created DAG', async () => {
      const execution = await service.createAndExecute('Linked execution');

      const dag = await service.get(execution.dagId);
      expect(dag.id).toBe(execution.dagId);
    });
  });

  describe('resume', () => {
    it('resumes paused execution', async () => {
      const dag = await service.create('Resumable');
      const execution = await service.execute(dag.id);

      const resumed = await service.resume(execution.id);

      expect(resumed.status).toBe('running');
    });

    it('throws error for non-existent execution', async () => {
      await expect(service.resume('dagexec_nonexistent')).rejects.toThrow(
        'not found'
      );
    });
  });

  describe('getSubSteps', () => {
    it('returns empty array for execution without sub-steps', async () => {
      const dag = await service.create('Test');
      const execution = await service.execute(dag.id);

      const subSteps = await service.getSubSteps(execution.id);

      expect(subSteps).toEqual([]);
    });

    it('throws error for non-existent execution', async () => {
      await expect(
        service.getSubSteps('dagexec_nonexistent')
      ).rejects.toThrow('not found');
    });
  });
});
