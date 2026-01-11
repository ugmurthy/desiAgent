/**
 * Goals Service
 *
 * Manages goal creation, updates, listing, and execution.
 * Goals represent high-level objectives for agents to accomplish.
 */

import { eq, and, desc } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DrizzleDB } from '../../db/client.js';
import { goals, schedules, runs } from '../../db/schema.js';
import type { Goal, GoalFilter, Run, ExecutionStatus } from '../../types/index.js';
import { NotFoundError, ValidationError } from '../../errors/index.js';
import { getLogger } from '../../util/logger.js';

/**
 * Create a goal ID with 'goal_' prefix
 */
export function generateGoalId(): string {
  return `goal_${nanoid(21)}`;
}

/**
 * Create a schedule ID with 'sched_' prefix
 */
export function generateScheduleId(): string {
  return `sched_${nanoid(21)}`;
}

/**
 * GoalsService handles all goal-related operations
 */
export class GoalsService {
  private db: DrizzleDB;
  private logger = getLogger();

  constructor(db: DrizzleDB) {
    this.db = db;
  }

  /**
   * Create a new goal
   */
  async create(
    objective: string,
    params?: Record<string, any>
  ): Promise<Goal> {
    this.logger.debug(`Creating goal: ${objective}`);

    const goalId = generateGoalId();
    const now = new Date();

    await this.db.insert(goals).values({
      id: goalId,
      objective,
      params: params || {},
      status: 'active' as const,
      createdAt: now,
      updatedAt: now,
    });

    const goal = await this.db.query.goals.findFirst({
      where: eq(goals.id, goalId),
    });

    if (!goal) {
      throw new Error('Failed to create goal');
    }

    return this.mapGoal(goal);
  }

  /**
   * Get a goal by ID
   */
  async get(id: string): Promise<Goal> {
    const goal = await this.db.query.goals.findFirst({
      where: eq(goals.id, id),
      with: {
        schedules: true,
      },
    });

    if (!goal) {
      throw new NotFoundError('Goal', id);
    }

    return this.mapGoal(goal);
  }

  /**
   * List all goals with optional filtering
   */
  async list(filter?: GoalFilter): Promise<Goal[]> {
    const conditions: any[] = [];

    if (filter?.status) {
      conditions.push(eq(goals.status, filter.status as any));
    }

    const query = this.db.query.goals.findMany({
      where: conditions.length > 0 ? and(...conditions) : undefined,
      orderBy: [desc(goals.createdAt)],
      with: {
        schedules: true,
      },
      limit: filter?.limit || 100,
      offset: filter?.offset || 0,
    });

    const allGoals = await query;
    return allGoals.map((g) => this.mapGoal(g));
  }

  /**
   * Update a goal
   */
  async update(id: string, updates: Partial<Goal>): Promise<Goal> {
    const existing = await this.db.query.goals.findFirst({
      where: eq(goals.id, id),
    });

    if (!existing) {
      throw new NotFoundError('Goal', id);
    }

    const updateData: Record<string, any> = {
      updatedAt: new Date(),
    };

    if (updates.objective !== undefined) {
      updateData.objective = updates.objective;
    }
    if ((updates as any).params !== undefined) {
      updateData.params = (updates as any).params;
    }
    if (updates.status !== undefined) {
      updateData.status = updates.status;
    }

    await this.db.update(goals).set(updateData).where(eq(goals.id, id));

    const updated = await this.db.query.goals.findFirst({
      where: eq(goals.id, id),
    });

    if (!updated) {
      throw new Error('Failed to update goal');
    }

    return this.mapGoal(updated);
  }

  /**
   * Delete a goal
   */
  async delete(id: string): Promise<void> {
    const existing = await this.db.query.goals.findFirst({
      where: eq(goals.id, id),
    });

    if (!existing) {
      throw new NotFoundError('Goal', id);
    }

    await this.db.delete(goals).where(eq(goals.id, id));
    this.logger.debug(`Deleted goal: ${id}`);
  }

  /**
   * Pause a goal (deactivate schedules)
   */
  async pause(id: string): Promise<Goal> {
    const existing = await this.db.query.goals.findFirst({
      where: eq(goals.id, id),
    });

    if (!existing) {
      throw new NotFoundError('Goal', id);
    }

    await this.db.update(goals)
      .set({ status: 'paused' as const, updatedAt: new Date() })
      .where(eq(goals.id, id));

    // Mark all schedules as inactive
    await this.db.update(schedules)
      .set({ active: false })
      .where(eq(schedules.goalId, id));

    const updated = await this.db.query.goals.findFirst({
      where: eq(goals.id, id),
    });

    if (!updated) {
      throw new Error('Failed to pause goal');
    }

    return this.mapGoal(updated);
  }

  /**
   * Resume a paused goal (reactivate schedules)
   */
  async resume(id: string): Promise<Goal> {
    const existing = await this.db.query.goals.findFirst({
      where: eq(goals.id, id),
    });

    if (!existing) {
      throw new NotFoundError('Goal', id);
    }

    await this.db.update(goals)
      .set({ status: 'active' as const, updatedAt: new Date() })
      .where(eq(goals.id, id));

    // Mark all schedules as active
    await this.db.update(schedules)
      .set({ active: true })
      .where(eq(schedules.goalId, id));

    const updated = await this.db.query.goals.findFirst({
      where: eq(goals.id, id),
    });

    if (!updated) {
      throw new Error('Failed to resume goal');
    }

    return this.mapGoal(updated);
  }

  /**
   * Trigger goal execution (creates a run)
   * Note: Actual execution is handled by the orchestrator
   */
  async run(id: string): Promise<Run> {
    const goal = await this.get(id);

    if (goal.status !== 'active') {
      throw new ValidationError(
        `Cannot run goal with status: ${goal.status}`,
        'status',
        goal.status
      );
    }

    // Create a new run
    const runId = `run_${nanoid(21)}`;
    const now = new Date();
    const stepBudget = (goal.metadata as any)?.stepBudget || 20;

    await this.db.insert(runs).values({
      id: runId,
      goalId: id,
      status: 'pending' as const,
      stepBudget,
      stepsExecuted: 0,
      workingMemory: {},
      createdAt: now,
    });

    const run = await this.db.query.runs.findFirst({
      where: eq(runs.id, runId),
    });

    if (!run) {
      throw new Error('Failed to create run');
    }

    this.logger.info(`Created run: ${runId} for goal: ${id}`);

    // Run is now in orchestrator's hands
    // The orchestrator will execute it asynchronously
    return {
      id: run.id,
      goalId: run.goalId,
      status: run.status as ExecutionStatus,
      createdAt: run.createdAt,
      updatedAt: run.createdAt,
      metadata: {
        stepsExecuted: run.stepsExecuted,
        stepBudget: run.stepBudget,
      },
    };
  }

  /**
   * Map database record to Goal type
   */
  private mapGoal(record: any): Goal {
    return {
      id: record.id,
      objective: record.objective,
      status: record.status as ExecutionStatus,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      metadata: {
        ...record.params,
        ...record.metadata,
      },
    };
  }
}
