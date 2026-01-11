/**
 * Goals Service Tests
 *
 * Tests for goal management and lifecycle
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GoalsService, generateGoalId } from '../goals.js';
import { getDatabase } from '../../db/client.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

describe('GoalsService', () => {
  let service: GoalsService;
  let db: any;

  beforeEach(async () => {
    // Create in-memory test database
    const dbPath = ':memory:';
    db = getDatabase(dbPath);
    service = new GoalsService(db);
  });

  describe('generateGoalId', () => {
    it('generates goal ID with goal_ prefix', () => {
      const id = generateGoalId();
      expect(id).toMatch(/^goal_[a-z0-9]+$/);
    });

    it('generates unique IDs', () => {
      const id1 = generateGoalId();
      const id2 = generateGoalId();
      expect(id1).not.toBe(id2);
    });

    it('generates 26 character IDs (goal_ + 21 chars)', () => {
      const id = generateGoalId();
      expect(id.length).toBe(26);
    });
  });

  describe('create', () => {
    it('creates goal with objective', async () => {
      const goal = await service.create('Test objective');

      expect(goal.id).toMatch(/^goal_/);
      expect(goal.objective).toBe('Test objective');
      expect(goal.status).toBe('active');
      expect(goal.createdAt).toBeInstanceOf(Date);
      expect(goal.updatedAt).toBeInstanceOf(Date);
    });

    it('creates goal with parameters', async () => {
      const params = {
        stepBudget: 30,
        allowedTools: ['bash', 'readFile'],
      };

      const goal = await service.create('Objective with params', params);

      expect(goal.metadata).toEqual(expect.objectContaining(params));
    });

    it('defaults status to active', async () => {
      const goal = await service.create('Test');

      expect(goal.status).toBe('active');
    });
  });

  describe('get', () => {
    it('retrieves goal by ID', async () => {
      const created = await service.create('Get test');
      const retrieved = await service.get(created.id);

      expect(retrieved.id).toBe(created.id);
      expect(retrieved.objective).toBe('Get test');
    });

    it('throws error for non-existent goal', async () => {
      await expect(service.get('goal_nonexistent')).rejects.toThrow('not found');
    });
  });

  describe('list', () => {
    it('lists all goals', async () => {
      await service.create('Goal 1');
      await service.create('Goal 2');

      const goals = await service.list();

      expect(goals.length).toBeGreaterThanOrEqual(2);
    });

    it('filters by status', async () => {
      const g1 = await service.create('Active goal');
      const g2 = await service.create('Paused goal');

      await service.pause(g2.id);

      const active = await service.list({ status: 'active' });
      const paused = await service.list({ status: 'paused' });

      expect(active.some((g) => g.id === g1.id)).toBe(true);
      expect(paused.some((g) => g.id === g2.id)).toBe(true);
    });

    it('respects limit', async () => {
      await service.create('Goal 1');
      await service.create('Goal 2');
      await service.create('Goal 3');

      const goals = await service.list({ limit: 2 });

      expect(goals.length).toBeLessThanOrEqual(2);
    });

    it('respects offset', async () => {
      await service.create('Goal 1');
      await service.create('Goal 2');

      const firstPage = await service.list({ limit: 1, offset: 0 });
      const secondPage = await service.list({ limit: 1, offset: 1 });

      expect(firstPage[0]?.id).not.toBe(secondPage[0]?.id);
    });
  });

  describe('update', () => {
    it('updates goal objective', async () => {
      const goal = await service.create('Original');
      const updated = await service.update(goal.id, {
        objective: 'Updated',
      });

      expect(updated.objective).toBe('Updated');
    });

    it('updates goal status', async () => {
      const goal = await service.create('Test');
      const updated = await service.update(goal.id, {
        status: 'paused',
      });

      expect(updated.status).toBe('paused');
    });

    it('throws error for non-existent goal', async () => {
      await expect(
        service.update('goal_nonexistent', { objective: 'New' })
      ).rejects.toThrow('not found');
    });

    it('updates updatedAt timestamp', async () => {
      const goal = await service.create('Test');
      const updated = await service.update(goal.id, {
        objective: 'Updated',
      });

      expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(
        goal.updatedAt.getTime()
      );
    });
  });

  describe('delete', () => {
    it('deletes goal', async () => {
      const goal = await service.create('Delete test');

      await service.delete(goal.id);

      await expect(service.get(goal.id)).rejects.toThrow('not found');
    });

    it('throws error for non-existent goal', async () => {
      await expect(service.delete('goal_nonexistent')).rejects.toThrow(
        'not found'
      );
    });
  });

  describe('pause and resume', () => {
    it('pauses active goal', async () => {
      const goal = await service.create('Pauseable');
      const paused = await service.pause(goal.id);

      expect(paused.status).toBe('paused');
    });

    it('resumes paused goal', async () => {
      const goal = await service.create('Pauseable');
      await service.pause(goal.id);
      const resumed = await service.resume(goal.id);

      expect(resumed.status).toBe('active');
    });

    it('throws error pausing non-existent goal', async () => {
      await expect(service.pause('goal_nonexistent')).rejects.toThrow(
        'not found'
      );
    });

    it('throws error resuming non-existent goal', async () => {
      await expect(service.resume('goal_nonexistent')).rejects.toThrow(
        'not found'
      );
    });
  });

  describe('run', () => {
    it('creates run for goal', async () => {
      const goal = await service.create('Runnable goal');
      const run = await service.run(goal.id);

      expect(run.id).toMatch(/^run_/);
      expect(run.goalId).toBe(goal.id);
      expect(run.status).toBe('pending');
    });

    it('throws error running non-active goal', async () => {
      const goal = await service.create('Non-active');
      await service.pause(goal.id);

      await expect(service.run(goal.id)).rejects.toThrow(
        'Cannot run goal with status'
      );
    });

    it('initializes run with step budget', async () => {
      const goal = await service.create('Test', { stepBudget: 50 });
      const run = await service.run(goal.id);

      expect(run.metadata?.stepBudget).toBe(50);
    });

    it('uses default step budget', async () => {
      const goal = await service.create('Test');
      const run = await service.run(goal.id);

      expect(run.metadata?.stepBudget).toBe(20);
    });
  });
});
