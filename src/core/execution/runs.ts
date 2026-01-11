/**
 * Runs Service
 *
 * Manages run tracking, step retrieval, and run lifecycle.
 * Runs represent individual executions of goals.
 */

import { eq, and, desc } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DrizzleDB } from '../../db/client.js';
import { runs, steps } from '../../db/schema.js';
import type { Run, Step } from '../../types/index.js';
import { NotFoundError } from '../../errors/index.js';
import { getLogger } from '../../util/logger.js';

/**
 * Create a run ID with 'run_' prefix
 */
export function generateRunId(): string {
  return `run_${nanoid(21)}`;
}

/**
 * Create a step ID with 'step_' prefix
 */
export function generateStepId(): string {
  return `step_${nanoid(21)}`;
}

/**
 * RunsService handles all run-related operations
 */
export class RunsService {
  private db: DrizzleDB;
  private logger = getLogger();

  constructor(db: DrizzleDB) {
    this.db = db;
  }

  /**
   * Get a run by ID
   */
  async get(id: string): Promise<Run> {
    const run = await this.db.query.runs.findFirst({
      where: eq(runs.id, id),
      with: {
        goal: true,
      },
    });

    if (!run) {
      throw new NotFoundError('Run', id);
    }

    return this.mapRun(run);
  }

  /**
   * List runs with optional filtering
   */
  async list(filter?: Record<string, any>): Promise<Run[]> {
    const conditions = [];

    if (filter?.goalId) {
      conditions.push(eq(runs.goalId, filter.goalId));
    }

    if (filter?.status) {
      conditions.push(eq(runs.status, filter.status));
    }

    const allRuns = await this.db.query.runs.findMany({
      where: conditions.length > 0 ? and(...conditions) : undefined,
      with: {
        goal: true,
      },
      orderBy: [desc(runs.createdAt)],
      limit: filter?.limit || 50,
      offset: filter?.offset || 0,
    });

    return allRuns.map((r) => this.mapRun(r));
  }

  /**
   * Get steps for a run
   */
  async getSteps(runId: string): Promise<Step[]> {
    const run = await this.db.query.runs.findFirst({
      where: eq(runs.id, runId),
    });

    if (!run) {
      throw new NotFoundError('Run', runId);
    }

    const runSteps = await this.db.query.steps.findMany({
      where: eq(steps.runId, runId),
      orderBy: [steps.stepNo],
    });

    return runSteps.map((s) => this.mapStep(s));
  }

  /**
   * Delete a run
   */
  async delete(id: string): Promise<void> {
    const existing = await this.db.query.runs.findFirst({
      where: eq(runs.id, id),
    });

    if (!existing) {
      throw new NotFoundError('Run', id);
    }

    await this.db.delete(runs).where(eq(runs.id, id));
    this.logger.debug(`Deleted run: ${id}`);
  }

  /**
   * Internal: Create a new run (used by orchestrator)
   */
  async _create(goalId: string, stepBudget: number): Promise<Run> {
    const runId = generateRunId();
    const now = new Date();

    await this.db.insert(runs).values({
      id: runId,
      goalId,
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

    return this.mapRun(run);
  }

  /**
   * Internal: Add a step to a run
   */
  async _addStep(
    runId: string,
    stepNo: number,
    thought: string,
    toolName?: string,
    toolInput?: Record<string, any>,
    observation?: string,
    durationMs: number = 0,
    error?: string
  ): Promise<Step> {
    const stepId = generateStepId();
    const now = new Date();

    await this.db.insert(steps).values({
      id: stepId,
      runId,
      stepNo,
      thought,
      toolName,
      toolInput,
      observation,
      durationMs,
      error,
      createdAt: now,
    });

    const step = await this.db.query.steps.findFirst({
      where: eq(steps.id, stepId),
    });

    if (!step) {
      throw new Error('Failed to create step');
    }

    return this.mapStep(step);
  }

  /**
   * Internal: Update run status
   */
  async _updateStatus(
    runId: string,
    status: 'pending' | 'running' | 'completed' | 'failed',
    error?: string
  ): Promise<void> {
    const updateData: Record<string, any> = {
      status,
    };

    if (status === 'running') {
      updateData.startedAt = new Date();
    } else if (status === 'completed' || status === 'failed') {
      updateData.endedAt = new Date();
    }

    if (error) {
      updateData.error = error;
    }

    await this.db.update(runs)
      .set(updateData)
      .where(eq(runs.id, runId));
  }

  /**
   * Internal: Update working memory
   */
  async _updateWorkingMemory(
    runId: string,
    memory: Record<string, any>
  ): Promise<void> {
    await this.db.update(runs)
      .set({ workingMemory: memory })
      .where(eq(runs.id, runId));
  }

  /**
   * Map database record to Run type
   */
  private mapRun(record: any): Run {
    return {
      id: record.id,
      goalId: record.goalId,
      status: record.status,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      completedAt: record.endedAt,
      failureReason: record.error,
      metadata: {
        stepsExecuted: record.stepsExecuted,
        stepBudget: record.stepBudget,
      },
    };
  }

  /**
   * Map database record to Step type
   */
  private mapStep(record: any): Step {
    return {
      id: record.id,
      runId: record.runId,
      index: record.stepNo,
      type:
        record.observation ?
          ('tool_result' as const)
        : record.toolName ?
          ('tool_call' as const)
          : ('thought' as const),
      content: record.thought,
      toolName: record.toolName,
      toolInput: record.toolInput,
      toolOutput: record.observation,
      timestamp: record.createdAt,
      metadata: {
        durationMs: record.durationMs,
        error: record.error,
      },
    };
  }
}
