import { z } from 'zod';

/**
 * Status states for DAG executions
 */
export enum ExecutionStatus {
  Pending = 'pending',
  Active = 'active',
  Paused = 'paused',
  Completed = 'completed',
  Failed = 'failed',
  Cancelled = 'cancelled',
}

/**
 * DAG (Directed Acyclic Graph) represents a decomposed workflow
 */
export interface DAG {
  id: string;
  dagTitle: string;
  status: ExecutionStatus;
  createdAt: Date;
  updatedAt: Date;
  metadata?: Record<string, any>;
}

/**
 * Node in a DAG
 */
export interface DAGNode {
  id: string;
  label: string;
  description: string;
  agentId?: string;
  type: 'task' | 'decision' | 'parallel' | 'sequential';
}

/**
 * Edge connecting nodes in a DAG
 */
export interface DAGEdge {
  from: string;
  to: string;
  condition?: string;
  metadata?: Record<string, any>;
}

/**
 * DAG execution status enum
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
  | 'failed';

/**
 * Execution of a DAG
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
 * Sub-step within a DAG execution
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
 * Execution event for streaming
 */
export enum ExecutionEventType {
  Started = 'execution:started',
  StepCompleted = 'execution:step_completed',
  StepFailed = 'execution:step_failed',
  ToolCalled = 'execution:tool_called',
  ToolCompleted = 'execution:tool_completed',
  ToolFailed = 'execution:tool_failed',
  Completed = 'execution:completed',
  Failed = 'execution:failed',
  Paused = 'execution:paused',
  Resumed = 'execution:resumed',
}

/**
 * Stream-friendly execution event
 */
export interface ExecutionEvent {
  type: ExecutionEventType;
  executionId: string;
  timestamp: Date;
  stepIndex?: number;
  data?: Record<string, any>;
  error?: {
    message: string;
    code?: string;
  };
}

/**
 * Filter options for querying DAGs
 */
export interface DAGFilter {
  status?: ExecutionStatus;
  createdAfter?: Date;
  createdBefore?: Date;
  limit?: number;
  offset?: number;
}

/**
 * Zod schema for validation
 */
export const ExecutionStatusSchema = z.enum([
  'pending',
  'active',
  'paused',
  'completed',
  'failed',
  'cancelled',
]);
