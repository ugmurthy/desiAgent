/**
 * Costs Service
 *
 * Provides cost tracking functionality for DAG planning and execution.
 * Tracks usage and costs at planning, execution, and sub-step levels.
 */

import { eq } from 'drizzle-orm';
import type { DrizzleDB } from '../../db/client.js';
import { dags, dagExecutions, dagSubSteps } from '../../db/schema.js';
import { NotFoundError } from '../../errors/index.js';
import { getLogger } from '../../util/logger.js';

/**
 * Usage information for token tracking
 */
export interface UsageInfo {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

/**
 * Planning usage total (aggregate over all attempts)
 */
export interface PlanningUsageTotal {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/**
 * Individual planning attempt details
 */
export interface PlanningAttempt {
  attempt: number;
  reason: 'initial' | 'retry_gaps' | 'retry_parse_error' | 'retry_validation' | 'title_master';
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  costUsd?: number | null;
  errorMessage?: string;
  generationStats?: Record<string, any>;
}

/**
 * Sub-step cost information
 */
export interface SubStepCost {
  id: string;
  taskId: string;
  actionType: string;
  toolOrPromptName: string;
  usage: UsageInfo | null;
  costUsd: string | null;
}

/**
 * Synthesis cost information
 */
export interface SynthesisCost {
  usage: UsageInfo | null;
  costUsd: string | null;
}

/**
 * Execution cost breakdown
 */
export interface ExecutionCostBreakdown {
  dagId: string | null;
  executionId: string;
  planning: {
    totalUsage: PlanningUsageTotal | null;
    totalCostUsd: string | null;
    attempts: PlanningAttempt[] | null;
  } | null;
  execution: {
    totalUsage: UsageInfo | null;
    totalCostUsd: string | null;
    subSteps: SubStepCost[];
    synthesis: SynthesisCost | null;
  };
  totals: {
    planningCostUsd: string;
    executionCostUsd: string;
    grandTotalCostUsd: string;
  };
}

/**
 * Execution summary for DAG costs
 */
export interface ExecutionSummary {
  executionId: string;
  status: string;
  totalCostUsd: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
}

/**
 * DAG cost breakdown
 */
export interface DagCostBreakdown {
  dagId: string;
  planning: {
    totalUsage: PlanningUsageTotal | null;
    totalCostUsd: string | null;
    attempts: PlanningAttempt[] | null;
  };
  executions: ExecutionSummary[];
  totals: {
    planningCostUsd: string;
    executionsCostUsd: string;
    grandTotalCostUsd: string;
  };
}

/**
 * Cost summary by date
 */
export interface CostSummaryEntry {
  date: string;
  planningCostUsd: string;
  executionCostUsd: string;
  totalCostUsd: string;
}

/**
 * Aggregated cost summary result
 */
export interface CostSummaryResult {
  dateRange: {
    from: string;
    to: string;
    groupBy: string;
  };
  summary: CostSummaryEntry[];
  totals: {
    planningCostUsd: string;
    executionCostUsd: string;
    totalCostUsd: string;
  };
}

/**
 * Options for cost summary aggregation
 */
export interface CostSummaryOptions {
  from?: Date;
  to?: Date;
  groupBy?: 'day' | 'week' | 'month';
}

/**
 * Parses a date string or returns default date
 */
function parseDate(dateStr: string | Date | undefined, defaultDate: Date): Date {
  if (!dateStr) return defaultDate;
  if (dateStr instanceof Date) return dateStr;
  return new Date(dateStr);
}

/**
 * Formats a date according to the specified grouping
 */
function formatDateByGroup(date: Date, groupBy: 'day' | 'week' | 'month'): string {
  switch (groupBy) {
    case 'week': {
      const d = new Date(date);
      d.setDate(d.getDate() - d.getDay());
      return d.toISOString().split('T')[0];
    }
    case 'month':
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    default:
      return date.toISOString().split('T')[0];
  }
}

/**
 * CostsService handles cost tracking and aggregation
 */
export class CostsService {
  private db: DrizzleDB;
  private logger = getLogger();

  constructor(db: DrizzleDB) {
    this.db = db;
  }

  /**
   * Get cost breakdown for a specific execution
   */
  async getExecutionCosts(executionId: string): Promise<ExecutionCostBreakdown> {
    const execution = await this.db.query.dagExecutions.findFirst({
      where: eq(dagExecutions.id, executionId),
    });

    if (!execution) {
      throw new NotFoundError('Execution', executionId);
    }

    const dag = execution.dagId
      ? await this.db.query.dags.findFirst({ where: eq(dags.id, execution.dagId) })
      : null;

    const allSubSteps = await this.db.query.dagSubSteps.findMany({
      where: eq(dagSubSteps.executionId, executionId),
    });

    const synthesisStep = allSubSteps.find(s => s.toolOrPromptName === '__synthesis__');
    const taskSteps = allSubSteps.filter(s => s.toolOrPromptName !== '__synthesis__');

    const planningCost = parseFloat(dag?.planningTotalCostUsd ?? '0');
    const executionCost = parseFloat(execution.totalCostUsd ?? '0');

    this.logger.debug({ executionId, planningCost, executionCost }, 'Retrieved execution costs');

    return {
      dagId: execution.dagId,
      executionId,
      planning: dag ? {
        totalUsage: dag.planningTotalUsage as PlanningUsageTotal | null,
        totalCostUsd: dag.planningTotalCostUsd ?? null,
        attempts: dag.planningAttempts as PlanningAttempt[] | null,
      } : null,
      execution: {
        totalUsage: execution.totalUsage as UsageInfo | null,
        totalCostUsd: execution.totalCostUsd ?? null,
        subSteps: taskSteps.map(s => ({
          id: s.id,
          taskId: s.taskId,
          actionType: s.actionType,
          toolOrPromptName: s.toolOrPromptName,
          usage: s.usage as UsageInfo | null,
          costUsd: s.costUsd ?? null,
        })),
        synthesis: synthesisStep ? {
          usage: synthesisStep.usage as UsageInfo | null,
          costUsd: synthesisStep.costUsd ?? null,
        } : null,
      },
      totals: {
        planningCostUsd: dag?.planningTotalCostUsd ?? '0',
        executionCostUsd: execution.totalCostUsd ?? '0',
        grandTotalCostUsd: (planningCost + executionCost).toString(),
      },
    };
  }

  /**
   * Get total costs for a DAG (planning + all executions)
   */
  async getDagCosts(dagId: string): Promise<DagCostBreakdown> {
    const dag = await this.db.query.dags.findFirst({
      where: eq(dags.id, dagId),
    });

    if (!dag) {
      throw new NotFoundError('DAG', dagId);
    }

    const allExecutions = await this.db.query.dagExecutions.findMany({
      where: eq(dagExecutions.dagId, dagId),
    });

    const executionTotalCost = allExecutions.reduce(
      (sum, e) => sum + parseFloat(e.totalCostUsd ?? '0'),
      0
    );

    const planningCost = parseFloat(dag.planningTotalCostUsd ?? '0');

    this.logger.debug({ dagId, planningCost, executionTotalCost }, 'Retrieved DAG costs');

    return {
      dagId,
      planning: {
        totalUsage: dag.planningTotalUsage as PlanningUsageTotal | null,
        totalCostUsd: dag.planningTotalCostUsd ?? null,
        attempts: dag.planningAttempts as PlanningAttempt[] | null,
      },
      executions: allExecutions.map(e => ({
        executionId: e.id,
        status: e.status,
        totalCostUsd: e.totalCostUsd ?? null,
        startedAt: e.startedAt ?? null,
        completedAt: e.completedAt ?? null,
      })),
      totals: {
        planningCostUsd: dag.planningTotalCostUsd ?? '0',
        executionsCostUsd: executionTotalCost.toString(),
        grandTotalCostUsd: (planningCost + executionTotalCost).toString(),
      },
    };
  }

  /**
   * Get cost summary aggregated by date
   */
  async getCostSummary(opts: CostSummaryOptions = {}): Promise<CostSummaryResult> {
    const groupBy = opts.groupBy ?? 'day';
    const fromDate = parseDate(opts.from, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
    const toDate = parseDate(opts.to, new Date());

    const allDags = await this.db.query.dags.findMany();
    const allExecutions = await this.db.query.dagExecutions.findMany();

    const costsByDate = new Map<string, { planningCostUsd: number; executionCostUsd: number }>();

    for (const dag of allDags) {
      if (!dag.createdAt) continue;
      const dagDate = dag.createdAt instanceof Date ? dag.createdAt : new Date(dag.createdAt as string | number);
      if (dagDate < fromDate || dagDate > toDate) continue;

      const dateKey = formatDateByGroup(dagDate, groupBy);
      const existing = costsByDate.get(dateKey) ?? { planningCostUsd: 0, executionCostUsd: 0 };
      existing.planningCostUsd += parseFloat(dag.planningTotalCostUsd ?? '0');
      costsByDate.set(dateKey, existing);
    }

    for (const exec of allExecutions) {
      if (!exec.completedAt) continue;
      const execDate = exec.completedAt instanceof Date ? exec.completedAt : new Date(exec.completedAt as string | number);
      if (execDate < fromDate || execDate > toDate) continue;

      const dateKey = formatDateByGroup(execDate, groupBy);
      const existing = costsByDate.get(dateKey) ?? { planningCostUsd: 0, executionCostUsd: 0 };
      existing.executionCostUsd += parseFloat(exec.totalCostUsd ?? '0');
      costsByDate.set(dateKey, existing);
    }

    const summary = Array.from(costsByDate.entries())
      .map(([date, costs]) => ({
        date,
        planningCostUsd: costs.planningCostUsd.toString(),
        executionCostUsd: costs.executionCostUsd.toString(),
        totalCostUsd: (costs.planningCostUsd + costs.executionCostUsd).toString(),
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const totals = summary.reduce(
      (acc, day) => ({
        planningCostUsd: acc.planningCostUsd + parseFloat(day.planningCostUsd),
        executionCostUsd: acc.executionCostUsd + parseFloat(day.executionCostUsd),
        totalCostUsd: acc.totalCostUsd + parseFloat(day.totalCostUsd),
      }),
      { planningCostUsd: 0, executionCostUsd: 0, totalCostUsd: 0 }
    );

    this.logger.debug({ from: fromDate, to: toDate, groupBy, entries: summary.length }, 'Retrieved cost summary');

    return {
      dateRange: {
        from: fromDate.toISOString(),
        to: toDate.toISOString(),
        groupBy,
      },
      summary,
      totals: {
        planningCostUsd: totals.planningCostUsd.toString(),
        executionCostUsd: totals.executionCostUsd.toString(),
        totalCostUsd: totals.totalCostUsd.toString(),
      },
    };
  }
}
