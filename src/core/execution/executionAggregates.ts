export type ExecutionStatus = 'pending' | 'running' | 'waiting' | 'completed' | 'failed' | 'partial';

export interface UsageLike {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface AggregatedUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface StepStatusLike {
  status: string;
}

export interface StepUsageLike {
  usage?: UsageLike | null;
}

export interface StepCostLike {
  costUsd?: string | null;
}

export interface DerivedExecutionStatus {
  status: ExecutionStatus;
  completedTasks: number;
  failedTasks: number;
  waitingTasks: number;
}

export function deriveExecutionStatus(subSteps: StepStatusLike[]): DerivedExecutionStatus {
  const completed = subSteps.filter((s) => s.status === 'completed').length;
  const failed = subSteps.filter((s) => s.status === 'failed').length;
  const running = subSteps.filter((s) => s.status === 'running').length;
  const waiting = subSteps.filter((s) => s.status === 'waiting').length;
  const total = subSteps.filter((s) => s.status !== 'deleted').length;

  let status: ExecutionStatus;

  if (waiting > 0) {
    status = 'waiting';
  } else if (failed > 0 && completed + failed === total) {
    status = failed === total ? 'failed' : 'partial';
  } else if (completed === total) {
    status = 'completed';
  } else if (running > 0 || completed > 0) {
    status = 'running';
  } else {
    status = 'pending';
  }

  return { status, completedTasks: completed, failedTasks: failed, waitingTasks: waiting };
}

export function aggregateUsage(subSteps: StepUsageLike[]): AggregatedUsage | null {
  let hasUsage = false;
  let promptTokens = 0;
  let completionTokens = 0;
  let totalTokens = 0;

  for (const step of subSteps) {
    if (step.usage) {
      hasUsage = true;
      promptTokens += step.usage.promptTokens ?? 0;
      completionTokens += step.usage.completionTokens ?? 0;
      totalTokens += step.usage.totalTokens ?? 0;
    }
  }

  return hasUsage ? { promptTokens, completionTokens, totalTokens } : null;
}

export function aggregateCost(subSteps: StepCostLike[]): number | null {
  let totalCost = 0;
  let hasCost = false;

  for (const step of subSteps) {
    if (step.costUsd) {
      hasCost = true;
      totalCost += parseFloat(step.costUsd);
    }
  }

  return hasCost ? totalCost : null;
}
