/**
 * Executions Service
 *
 * Manages execution tracking, event streaming, and lifecycle.
 * Provides real-time streaming of execution events.
 */

import { eq, desc, and, sql } from 'drizzle-orm';
import type { DrizzleDB } from '../../db/client.js';
import { dagExecutions, dagSubSteps, dags } from '../../db/schema.js';
import type { ExecutionEvent } from '../../types/index.js';
import { NotFoundError } from '../../errors/index.js';
import { getLogger } from '../../util/logger.js';
import { EventEmitter } from 'events';

/**
 * Execution status enum matching new schema
 */
export type DAGExecutionStatus =
  | 'pending'
  | 'running'
  | 'waiting'
  | 'completed'
  | 'failed'
  | 'partial'
  | 'suspended';

/**
 * SubStep status enum
 */
export type SubStepStatus =
  | 'pending'
  | 'running'
  | 'waiting'
  | 'completed'
  | 'failed'
  | 'deleted';

/**
 * SubStep type matching new dagSubSteps schema
 */
export interface SubStep {
  id: string;
  executionId: string;
  taskId: string;
  description: string;
  thought: string;
  actionType: 'tool' | 'inference';
  toolOrPromptName: string;
  toolOrPromptParams: Record<string, any> | null;
  dependencies: string[];
  status: SubStepStatus;
  startedAt: Date | null;
  completedAt: Date | null;
  durationMs: number | null;
  result: any | null;
  error: string | null;
  usage: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  } | null;
  costUsd: string | null;
  generationStats: Record<string, any> | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * DAGExecution type matching new dagExecutions schema
 */
export interface DAGExecution {
  id: string;
  dagId: string | null;
  originalRequest: string;
  primaryIntent: string;
  status: DAGExecutionStatus;
  startedAt: Date | null;
  completedAt: Date | null;
  durationMs: number | null;
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  waitingTasks: number;
  finalResult: string | null;
  synthesisResult: string | null;
  suspendedReason: string | null;
  suspendedAt: Date | null;
  retryCount: number;
  lastRetryAt: Date | null;
  totalUsage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  } | null;
  totalCostUsd: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * DAGExecution with included subSteps
 */
export interface DAGExecutionWithSteps extends DAGExecution {
  subSteps: SubStep[];
}

/**
 * Result from listForDag method
 */
export interface DagExecutionListResult {
  executions: DAGExecution[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * Options for listForDag
 */
export interface ListForDagOptions {
  status?: DAGExecutionStatus;
  limit?: number;
  offset?: number;
}

/**
 * Execution event emitter (in-memory for Phase 2)
 * Using per-execution channels for better performance
 */
const executionEventBus = new EventEmitter();
executionEventBus.setMaxListeners(100); // Allow more concurrent executions

/**
 * ExecutionsService handles execution tracking and events
 */
export class ExecutionsService {
  private db: DrizzleDB;
  private logger = getLogger();

  constructor(db: DrizzleDB) {
    this.db = db;
  }

  /**
   * Get a DAG execution by ID
   */
  async get(id: string): Promise<DAGExecution> {
    const execution = await this.db.query.dagExecutions.findFirst({
      where: eq(dagExecutions.id, id),
    });

    if (!execution) {
      throw new NotFoundError('Execution', id);
    }

    return this.mapExecution(execution);
  }

  /**
   * Get a DAG execution by ID with substeps included
   */
  async getWithSubSteps(id: string): Promise<DAGExecutionWithSteps> {
    const execution = await this.db.query.dagExecutions.findFirst({
      where: eq(dagExecutions.id, id),
      with: {
        subSteps: true,
      },
    });

    if (!execution) {
      throw new NotFoundError('Execution', id);
    }

    return {
      ...this.mapExecution(execution),
      subSteps: (execution.subSteps || []).map((s) => this.mapSubStep(s)),
    };
  }

  /**
   * List executions for a specific DAG with total count
   */
  async listForDag(
    dagId: string,
    opts?: ListForDagOptions
  ): Promise<DagExecutionListResult> {
    const dag = await this.db.query.dags.findFirst({
      where: eq(dags.id, dagId),
    });

    if (!dag) {
      throw new NotFoundError('DAG', dagId);
    }

    const limit = opts?.limit ?? 50;
    const offset = opts?.offset ?? 0;

    const conditions = [eq(dagExecutions.dagId, dagId)];
    if (opts?.status) {
      conditions.push(eq(dagExecutions.status, opts.status));
    }

    const executionsList = await this.db.query.dagExecutions.findMany({
      where: and(...conditions),
      orderBy: [desc(dagExecutions.createdAt)],
      limit,
      offset,
    });

    const countResult = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(dagExecutions)
      .where(and(...conditions));

    const total = countResult[0]?.count ?? 0;

    return {
      executions: executionsList.map((e) => this.mapExecution(e)),
      total,
      limit,
      offset,
    };
  }

  /**
   * List executions with optional filtering
   */
  async list(filter?: {
    dagId?: string;
    status?: DAGExecutionStatus;
    limit?: number;
    offset?: number;
  }): Promise<DAGExecution[]> {
    const conditions = [];

    if (filter?.dagId) {
      conditions.push(eq(dagExecutions.dagId, filter.dagId));
    }

    if (filter?.status) {
      conditions.push(eq(dagExecutions.status, filter.status));
    }

    const allExecutions = await this.db.query.dagExecutions.findMany({
      where: conditions.length > 0 ? and(...conditions) : undefined,
      orderBy: [desc(dagExecutions.createdAt)],
      limit: filter?.limit || 50,
      offset: filter?.offset || 0,
    });

    return allExecutions.map((e) => this.mapExecution(e));
  }

  /**
   * Get sub-steps for an execution
   */
  async getSubSteps(executionId: string): Promise<SubStep[]> {
    const execution = await this.db.query.dagExecutions.findFirst({
      where: eq(dagExecutions.id, executionId),
    });

    if (!execution) {
      throw new NotFoundError('Execution', executionId);
    }

    const subStepsList = await this.db.query.dagSubSteps.findMany({
      where: eq(dagSubSteps.executionId, executionId),
      orderBy: [dagSubSteps.taskId],
    });

    return subStepsList.map((s) => this.mapSubStep(s));
  }

  /**
   * Stream events for an execution
   *
   * Returns an async iterable of execution events.
   * In Phase 2, this uses an in-memory event bus.
   * Phase 3+ will implement database polling or WebSocket streaming.
   */
  async *streamEvents(executionId: string): AsyncIterable<ExecutionEvent> {
    const execution = await this.get(executionId);

    if (!execution) {
      throw new NotFoundError('Execution', executionId);
    }

    // Fast path: if already completed, no need to stream
    if (execution.status === 'completed' || execution.status === 'failed') {
      return;
    }

    const eventQueue: ExecutionEvent[] = [];
    let isOpen = true;

    // Use execution-specific channel (no filtering needed)
    const listener = (event: ExecutionEvent) => {
      if (isOpen) {
        eventQueue.push(event);
      }
    };

    const channelName = `execution:${executionId}`;
    executionEventBus.on(channelName, listener);

    try {
      while (isOpen) {
        if (eventQueue.length > 0) {
          const event = eventQueue.shift()!;
          yield event;

          if (
            event.type === 'execution:completed' ||
            event.type === 'execution:failed' ||
            event.type === 'execution:suspended'
          ) {
            isOpen = false;
          }
        } else {
          // Reduced polling interval, no DB query (rely on events)
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      }
    } finally {
      executionEventBus.off(channelName, listener);
    }
  }

  /**
   * Delete an execution
   */
  async delete(id: string): Promise<void> {
    const existing = await this.db.query.dagExecutions.findFirst({
      where: eq(dagExecutions.id, id),
      with: {
        subSteps: true,
      },
    });

    if (!existing) {
      throw new NotFoundError('Execution', id);
    }

    const subStepsCount = existing.subSteps?.length ?? 0;

    await this.db.delete(dagExecutions).where(eq(dagExecutions.id, id));
    this.logger.debug(
      `Deleted execution: ${id} (cascade deleted ${subStepsCount} substeps)`
    );
  }

  /**
   * Internal: Emit an execution event (async, non-blocking)
   * Uses execution-specific channels for reduced filtering overhead
   */
  static emitEvent(event: ExecutionEvent): void {
    setImmediate(() => {
      // Emit to execution-specific channel (primary)
      executionEventBus.emit(`execution:${event.executionId}`, event);
      // Also emit to global channel for backward compatibility
      executionEventBus.emit('execution:event', event);
    });
  }

  /**
   * Map database record to DAGExecution type
   */
  private mapExecution(record: any): DAGExecution {
    return {
      id: record.id,
      dagId: record.dagId,
      originalRequest: record.originalRequest,
      primaryIntent: record.primaryIntent,
      status: record.status as DAGExecutionStatus,
      startedAt: record.startedAt,
      completedAt: record.completedAt,
      durationMs: record.durationMs,
      totalTasks: record.totalTasks,
      completedTasks: record.completedTasks,
      failedTasks: record.failedTasks,
      waitingTasks: record.waitingTasks,
      finalResult: record.finalResult,
      synthesisResult: record.synthesisResult,
      suspendedReason: record.suspendedReason,
      suspendedAt: record.suspendedAt,
      retryCount: record.retryCount,
      lastRetryAt: record.lastRetryAt,
      totalUsage: record.totalUsage,
      totalCostUsd: record.totalCostUsd,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  /**
   * Map database record to SubStep type
   */
  private mapSubStep(record: any): SubStep {
    return {
      id: record.id,
      executionId: record.executionId,
      taskId: record.taskId,
      description: record.description,
      thought: record.thought,
      actionType: record.actionType as 'tool' | 'inference',
      toolOrPromptName: record.toolOrPromptName,
      toolOrPromptParams: record.toolOrPromptParams,
      dependencies: record.dependencies || [],
      status: record.status as SubStepStatus,
      startedAt: record.startedAt,
      completedAt: record.completedAt,
      durationMs: record.durationMs,
      result: record.result,
      error: record.error,
      usage: record.usage,
      costUsd: record.costUsd,
      generationStats: record.generationStats,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
