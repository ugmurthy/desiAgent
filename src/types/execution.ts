import { z } from 'zod';

/**
 * Status states for goals, runs, and executions
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
 * Goal represents a high-level objective for an agent to accomplish
 */
export interface Goal {
  id: string;
  objective: string;
  status: ExecutionStatus;
  createdAt: Date;
  updatedAt: Date;
  stepBudget?: number;
  allowedTools?: string[];
  constraints?: Record<string, any>;
  metadata?: Record<string, any>;
}

/**
 * Run represents a single execution of a goal
 */
export interface Run {
  id: string;
  goalId: string;
  status: ExecutionStatus;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
  failureReason?: string;
  metadata?: Record<string, any>;
}

/**
 * Step represents a single action taken during a run
 */
export interface Step {
  id: string;
  runId: string;
  index: number;
  type: 'thought' | 'tool_call' | 'tool_result' | 'final_answer';
  content: string;
  toolName?: string;
  toolInput?: Record<string, any>;
  toolOutput?: Record<string, any>;
  timestamp: Date;
  metadata?: Record<string, any>;
}

/**
 * DAG (Directed Acyclic Graph) represents a decomposed workflow
 */
export interface DAG {
  id: string;
  objective: string;
  nodes: DAGNode[];
  edges: DAGEdge[];
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
 * Filter options for querying goals
 */
export interface GoalFilter {
  status?: ExecutionStatus;
  createdAfter?: Date;
  createdBefore?: Date;
  limit?: number;
  offset?: number;
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
 * Schedule configuration for recurring goals/DAGs
 */
export interface Schedule {
  id: string;
  goalOrDagId: string;
  cronExpression: string;
  nextRun?: Date;
  lastRun?: Date;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
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

export const GoalSchema = z.object({
  id: z.string(),
  objective: z.string(),
  status: ExecutionStatusSchema,
  createdAt: z.date(),
  updatedAt: z.date(),
  stepBudget: z.number().optional(),
  allowedTools: z.array(z.string()).optional(),
  constraints: z.record(z.any()).optional(),
  metadata: z.record(z.any()).optional(),
});

export const RunSchema = z.object({
  id: z.string(),
  goalId: z.string(),
  status: ExecutionStatusSchema,
  createdAt: z.date(),
  updatedAt: z.date(),
  completedAt: z.date().optional(),
  failureReason: z.string().optional(),
  metadata: z.record(z.any()).optional(),
});
