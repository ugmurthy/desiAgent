import type {
  DAG,
  DAGExecution,
  DAGExecutionWithSteps,
  DagExecutionListResult,
  DAGExecutionStatus,
  SubStep,
  ExecutionEvent,
  DAGFilter,
} from './execution.js';
import type { Agent, ToolDefinition } from './agent.js';

/**
 * Agents service interface
 */
export interface AgentsService {
  create(name: string, version: string, systemPrompt: string, params?: Record<string, any>): Promise<Agent>;
  list(filter?: Record<string, any>): Promise<Agent[]>;
  get(id: string): Promise<Agent>;
  update(id: string, updates: Partial<Agent>): Promise<Agent>;
  delete(id: string): Promise<void>;
  activate(id: string): Promise<Agent>;
  resolve(name: string): Promise<Agent | null>;
}

/**
 * Options for creating a DAG from a goal
 */
export interface CreateDAGFromGoalOptions {
  goalText: string;
  agentName: string;
  provider?: 'openai' | 'openrouter' | 'ollama';
  model?: string;
  temperature?: number;
  maxTokens?: number;
  seed?: number;
  cronSchedule?: string;
  scheduleActive?: boolean;
  timezone?: string;
}

/**
 * DAG planning result types
 */
export interface ClarificationRequiredResult {
  status: 'clarification_required';
  clarificationQuery: string;
  result: any;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number } | null;
  generationStats?: Record<string, any> | null;
}

export interface DAGCreatedResult {
  status: 'success';
  dagId: string;
}

export interface UnpersistedResult {
  status: 'success';
  result: any;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number } | null;
  generationStats?: Record<string, any> | null;
  attempts: number;
}

export type DAGPlanningResult = ClarificationRequiredResult | DAGCreatedResult | UnpersistedResult;

/**
 * Scheduled DAG info
 */
export interface ScheduledDAGInfo {
  id: string;
  dagTitle: string | null;
  cronSchedule: string | null;
  scheduleDescription: string;
  scheduleActive: boolean | null;
}

/**
 * Run experiments input
 */
export interface RunExperimentsInput {
  goalText: string;
  agentName: string;
  provider: 'openai' | 'openrouter' | 'ollama';
  models: string[];
  temperatures: number[];
  seed?: number;
}

/**
 * DAGs service interface
 */
export interface DAGsService {
  createFromGoal(options: CreateDAGFromGoalOptions): Promise<DAGPlanningResult>;
  createAndExecuteFromGoal(options: CreateDAGFromGoalOptions): Promise<{ dagId?: string; executionId: string }>;
  execute(dagId: string, options?: { provider?: string; model?: string }): Promise<{ id: string; status: string }>;
  executeDefinition(options: { definition: any; originalGoalText: string }): Promise<{ id: string; status: string }>;
  resume(executionId: string): Promise<{ id: string; status: string; retryCount: number }>;
  get(id: string): Promise<DAG>;
  list(filter?: DAGFilter): Promise<DAG[]>;
  listScheduled(): Promise<ScheduledDAGInfo[]>;
  update(id: string, updates: Partial<{
    status: string;
    result: any;
    params: Record<string, any>;
    cronSchedule: string | null;
    scheduleActive: boolean;
    timezone: string;
    dagTitle: string;
  }>): Promise<DAG>;
  safeDelete(id: string): Promise<void>;
  runExperiments(input: RunExperimentsInput): Promise<{
    status: string;
    totalExperiments: number;
    successCount: number;
    failureCount: number;
    results: Array<{
      model: string;
      temperature: number;
      dagId: string | null;
      success: boolean;
      error?: string;
    }>;
  }>;
  getSubSteps(executionId: string): Promise<SubStep[]>;
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
 * Executions service interface
 */
export interface ExecutionsService {
  list(filter?: {
    dagId?: string;
    status?: DAGExecutionStatus;
    limit?: number;
    offset?: number;
  }): Promise<DAGExecution[]>;
  get(id: string): Promise<DAGExecution>;
  getWithSubSteps(id: string): Promise<DAGExecutionWithSteps>;
  listForDag(dagId: string, opts?: ListForDagOptions): Promise<DagExecutionListResult>;
  getSubSteps(id: string): Promise<SubStep[]>;
  delete(id: string): Promise<void>;
  streamEvents(id: string): AsyncIterable<ExecutionEvent>;
}

/**
 * Tools service interface
 */
export interface ToolsService {
  list(filter?: Record<string, any>): Promise<ToolDefinition[]>;
}

/**
 * Artifacts service interface
 */
export interface ArtifactsService {
  list(): Promise<string[]>;
  get(filename: string): Promise<Buffer>;
}

/**
 * Usage information
 */
export interface UsageInfo {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

/**
 * Planning usage total
 */
export interface PlanningUsageTotal {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/**
 * Planning attempt details
 */
export interface PlanningAttempt {
  attempt: number;
  reason: 'initial' | 'retry_gaps' | 'retry_parse_error' | 'retry_validation' | 'title_master';
  usage?: UsageInfo;
  costUsd?: number | null;
  errorMessage?: string;
  generationStats?: Record<string, any>;
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
    subSteps: Array<{
      id: string;
      taskId: string;
      actionType: string;
      toolOrPromptName: string;
      usage: UsageInfo | null;
      costUsd: string | null;
    }>;
    synthesis: {
      usage: UsageInfo | null;
      costUsd: string | null;
    } | null;
  };
  totals: {
    planningCostUsd: string;
    executionCostUsd: string;
    grandTotalCostUsd: string;
  };
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
  executions: Array<{
    executionId: string;
    status: string;
    totalCostUsd: string | null;
    startedAt: Date | null;
    completedAt: Date | null;
  }>;
  totals: {
    planningCostUsd: string;
    executionsCostUsd: string;
    grandTotalCostUsd: string;
  };
}

/**
 * Cost summary result
 */
export interface CostSummaryResult {
  dateRange: {
    from: string;
    to: string;
    groupBy: string;
  };
  summary: Array<{
    date: string;
    planningCostUsd: string;
    executionCostUsd: string;
    totalCostUsd: string;
  }>;
  totals: {
    planningCostUsd: string;
    executionCostUsd: string;
    totalCostUsd: string;
  };
}

/**
 * Cost summary options
 */
export interface CostSummaryOptions {
  from?: Date;
  to?: Date;
  groupBy?: 'day' | 'week' | 'month';
}

/**
 * Costs service interface
 */
export interface CostsService {
  getExecutionCosts(executionId: string): Promise<ExecutionCostBreakdown>;
  getDagCosts(dagId: string): Promise<DagCostBreakdown>;
  getCostSummary(opts?: CostSummaryOptions): Promise<CostSummaryResult>;
}

/**
 * Main DesiAgent client interface
 */
export interface DesiAgentClient {
  // Services
  agents: AgentsService;
  dags: DAGsService;
  executions: ExecutionsService;
  tools: ToolsService;
  artifacts: ArtifactsService;
  costs: CostsService;
  version: string

  // Task execution
  executeTask(agent: Agent, task: string, files?: Buffer[]): Promise<any>;

  // Lifecycle
  shutdown(): Promise<void>;
}
