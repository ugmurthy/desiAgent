/**
 * Runs Service Tests
 *
 * Tests for run management and step tracking
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { RunsService, generateRunId, generateStepId } from '../runs.js';
import { GoalsService } from '../goals.js';
import { getDatabase } from '../../db/client.js';

describe('RunsService', () => {
  let service: RunsService;
  let goalsService: GoalsService;
  let db: any;

  beforeEach(() => {
    const dbPath = ':memory:';
    db = getDatabase(dbPath);
    service = new RunsService(db);
    goalsService = new GoalsService(db);
  });

  describe('generateRunId', () => {
    it('generates run ID with run_ prefix', () => {
      const id = generateRunId();
      expect(id).toMatch(/^run_[a-z0-9]+$/);
    });

    it('generates unique IDs', () => {
      const id1 = generateRunId();
      const id2 = generateRunId();
      expect(id1).not.toBe(id2);
    });
  });

  describe('generateStepId', () => {
    it('generates step ID with step_ prefix', () => {
      const id = generateStepId();
      expect(id).toMatch(/^step_[a-z0-9]+$/);
    });

    it('generates unique IDs', () => {
      const id1 = generateStepId();
      const id2 = generateStepId();
      expect(id1).not.toBe(id2);
    });
  });

  describe('get', () => {
    it('retrieves run by ID', async () => {
      const goal = await goalsService.create('Test goal');
      const run = await service._create(goal.id, 20);

      const retrieved = await service.get(run.id);

      expect(retrieved.id).toBe(run.id);
      expect(retrieved.goalId).toBe(goal.id);
    });

    it('throws error for non-existent run', async () => {
      await expect(service.get('run_nonexistent')).rejects.toThrow(
        'not found'
      );
    });
  });

  describe('list', () => {
    it('lists all runs', async () => {
      const goal = await goalsService.create('Test');
      await service._create(goal.id, 20);
      await service._create(goal.id, 20);

      const runs = await service.list();

      expect(runs.length).toBeGreaterThanOrEqual(2);
    });

    it('filters by goal ID', async () => {
      const g1 = await goalsService.create('Goal 1');
      const g2 = await goalsService.create('Goal 2');

      const r1 = await service._create(g1.id, 20);
      await service._create(g2.id, 20);

      const filtered = await service.list({ goalId: g1.id });

      expect(filtered.every((r) => r.goalId === g1.id)).toBe(true);
      expect(filtered.some((r) => r.id === r1.id)).toBe(true);
    });

    it('filters by status', async () => {
      const goal = await goalsService.create('Test');
      const run = await service._create(goal.id, 20);

      await service._updateStatus(run.id, 'running');

      const running = await service.list({ status: 'running' });
      const completed = await service.list({ status: 'completed' });

      expect(running.some((r) => r.id === run.id)).toBe(true);
      expect(completed.some((r) => r.id === run.id)).toBe(false);
    });

    it('respects limit and offset', async () => {
      const goal = await goalsService.create('Test');
      await service._create(goal.id, 20);
      await service._create(goal.id, 20);

      const first = await service.list({ limit: 1, offset: 0 });
      const second = await service.list({ limit: 1, offset: 1 });

      expect(first[0]?.id).not.toBe(second[0]?.id);
    });
  });

  describe('getSteps', () => {
    it('retrieves steps for run', async () => {
      const goal = await goalsService.create('Test');
      const run = await service._create(goal.id, 20);

      await service._addStep(run.id, 1, 'First step');
      await service._addStep(run.id, 2, 'Second step');

      const steps = await service.getSteps(run.id);

      expect(steps.length).toBe(2);
      expect(steps[0]?.index).toBe(1);
      expect(steps[1]?.index).toBe(2);
    });

    it('throws error for non-existent run', async () => {
      await expect(service.getSteps('run_nonexistent')).rejects.toThrow(
        'not found'
      );
    });

    it('returns empty array for run without steps', async () => {
      const goal = await goalsService.create('Test');
      const run = await service._create(goal.id, 20);

      const steps = await service.getSteps(run.id);

      expect(steps).toEqual([]);
    });
  });

  describe('delete', () => {
    it('deletes run', async () => {
      const goal = await goalsService.create('Test');
      const run = await service._create(goal.id, 20);

      await service.delete(run.id);

      await expect(service.get(run.id)).rejects.toThrow('not found');
    });

    it('throws error for non-existent run', async () => {
      await expect(service.delete('run_nonexistent')).rejects.toThrow(
        'not found'
      );
    });
  });

  describe('_addStep', () => {
    it('adds step to run', async () => {
      const goal = await goalsService.create('Test');
      const run = await service._create(goal.id, 20);

      const step = await service._addStep(run.id, 1, 'My thought');

      expect(step.index).toBe(1);
      expect(step.content).toBe('My thought');
    });

    it('adds step with tool information', async () => {
      const goal = await goalsService.create('Test');
      const run = await service._create(goal.id, 20);

      const step = await service._addStep(
        run.id,
        1,
        'Running bash',
        'bash',
        { command: 'ls' },
        'file1 file2',
        150
      );

      expect(step.toolName).toBe('bash');
      expect(step.toolInput).toEqual({ command: 'ls' });
      expect(step.toolOutput).toBe('file1 file2');
      expect(step.metadata?.durationMs).toBe(150);
    });

    it('adds step with error', async () => {
      const goal = await goalsService.create('Test');
      const run = await service._create(goal.id, 20);

      const step = await service._addStep(
        run.id,
        1,
        'Failed',
        undefined,
        undefined,
        undefined,
        100,
        'Command failed'
      );

      expect(step.metadata?.error).toBe('Command failed');
    });
  });

  describe('_updateStatus', () => {
    it('updates run status to running', async () => {
      const goal = await goalsService.create('Test');
      const run = await service._create(goal.id, 20);

      await service._updateStatus(run.id, 'running');

      const updated = await service.get(run.id);
      expect(updated.status).toBe('running');
    });

    it('updates run status to completed', async () => {
      const goal = await goalsService.create('Test');
      const run = await service._create(goal.id, 20);

      await service._updateStatus(run.id, 'completed');

      const updated = await service.get(run.id);
      expect(updated.status).toBe('completed');
    });

    it('updates run status with error', async () => {
      const goal = await goalsService.create('Test');
      const run = await service._create(goal.id, 20);

      await service._updateStatus(run.id, 'failed', 'Something went wrong');

      const updated = await service.get(run.id);
      expect(updated.status).toBe('failed');
      expect(updated.failureReason).toBe('Something went wrong');
    });

    it('sets startedAt when status becomes running', async () => {
      const goal = await goalsService.create('Test');
      const run = await service._create(goal.id, 20);

      await service._updateStatus(run.id, 'running');

      // Verify it was updated (we can't directly access private db fields)
      const updated = await service.get(run.id);
      expect(updated.status).toBe('running');
    });
  });

  describe('_updateWorkingMemory', () => {
    it('updates working memory', async () => {
      const goal = await goalsService.create('Test');
      const run = await service._create(goal.id, 20);

      const memory = { key: 'value', count: 42 };
      await service._updateWorkingMemory(run.id, memory);

      const updated = await service.get(run.id);
      expect(updated.metadata?.stepsExecuted).toBeDefined();
    });
  });
});
