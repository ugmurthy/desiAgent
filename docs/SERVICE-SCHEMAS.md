# desiAgent Service Schemas

This document describes the input and output schemas for each service in desiAgent.

## Table of Contents

- [AgentsService](#agentsservice)
- [DAGsService](#dagsservice)
- [ExecutionsService](#executionsservice)
- [ToolsService](#toolsservice)
- [ArtifactsService](#artifactsservice)
- [CostsService](#costsservice)
- [LLM Provider](#llm-provider)

---

## AgentsService

Manages AI agents with their configurations and capabilities.

### `create(name, version, systemPrompt, params?)`

**Input:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | `string` | ✓ | Agent name |
| `version` | `string` | ✓ | Semantic version |
| `systemPrompt` | `string` | ✓ | System prompt for the agent |
| `params` | `Record<string, any>` | | Additional parameters |

**Output:** [`Agent`](#agent)

### `list(filter?)`

**Input:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `filter` | `Record<string, any>` | | Filter criteria |

**Output:** `Agent[]`

### `get(id)`

**Input:** `id: string`

**Output:** [`Agent`](#agent)

### `update(id, updates)`

**Input:**
| Parameter | Type | Required |
|-----------|------|----------|
| `id` | `string` | ✓ |
| `updates` | `Partial<Agent>` | ✓ |

**Output:** [`Agent`](#agent)

### `delete(id)`

**Input:** `id: string`

**Output:** `void`

### `activate(id)`

**Input:** `id: string`

**Output:** [`Agent`](#agent)

### `resolve(name)`

**Input:** `name: string`

**Output:** `Agent | null`

---

## DAGsService

Manages DAG (Directed Acyclic Graph) workflows from goals.

### `createFromGoal(options)`

**Input:** [`CreateDAGFromGoalOptions`](#createdagfromgoaloptions)

```typescript
interface CreateDAGFromGoalOptions {
  goalText: string;               // The goal/objective to decompose
  agentName: string;              // Agent to use for planning
  provider?: 'openai' | 'openrouter' | 'ollama';
  model?: string;
  temperature?: number;
  maxTokens?: number;
  seed?: number;
  cronSchedule?: string;          // Cron expression for scheduling
  scheduleActive?: boolean;
  timezone?: string;
}
```

**Output:** [`DAGPlanningResult`](#dagplanningresult)

```typescript
type DAGPlanningResult = 
  | { status: 'success'; dagId: string }
  | { status: 'clarification_required'; dagId: string; clarificationQuery: string }
  | { status: 'validation_error'; dagId: string };
```

### `createAndExecuteFromGoal(options)`

**Input:** [`CreateDAGFromGoalOptions`](#createdagfromgoaloptions)

**Output:**
```typescript
{ dagId: string; executionId: string }
```

### `resumeFromClarification(dagId, userResponse)`

**Input:**
| Parameter | Type | Required |
|-----------|------|----------|
| `dagId` | `string` | ✓ |
| `userResponse` | `string` | ✓ |

**Output:** [`DAGPlanningResult`](#dagplanningresult)

### `execute(dagId, options?)`

**Input:**
| Parameter | Type | Required |
|-----------|------|----------|
| `dagId` | `string` | ✓ |
| `options.provider` | `string` | |
| `options.model` | `string` | |

**Output:** `{ id: string; status: string }`

### `executeDefinition(options)`

**Input:**
```typescript
{
  definition: DecomposerJob;
  originalGoalText: string;
}
```

**Output:** `{ id: string; status: string }`

### `resume(executionId)`

**Input:** `executionId: string`

**Output:** `{ id: string; status: string; retryCount: number }`

### `get(id)`

**Input:** `id: string`

**Output:** [`DAG`](#dag)

### `list(filter?)`

**Input:** [`DAGFilter`](#dagfilter)

```typescript
interface DAGFilter {
  status?: ExecutionStatus;
  createdAfter?: Date;
  createdBefore?: Date;
  limit?: number;
  offset?: number;
}
```

**Output:** `DAG[]`

### `listScheduled()`

**Output:** [`ScheduledDAGInfo[]`](#scheduleddaginfo)

```typescript
interface ScheduledDAGInfo {
  id: string;
  dagTitle: string | null;
  cronSchedule: string | null;
  scheduleDescription: string;
  scheduleActive: boolean | null;
}
```

### `update(id, updates)`

**Input:**
```typescript
{
  id: string;
  updates: Partial<{
    status: string;
    result: any;
    params: Record<string, any>;
    cronSchedule: string | null;
    scheduleActive: boolean;
    timezone: string;
    dagTitle: string;
  }>;
}
```

**Output:** [`DAG`](#dag)

### `safeDelete(id)`

**Input:** `id: string`

**Output:** `void`

### `runExperiments(input)`

**Input:** [`RunExperimentsInput`](#runexperimentsinput)

```typescript
interface RunExperimentsInput {
  goalText: string;
  agentName: string;
  provider: 'openai' | 'openrouter' | 'ollama';
  models: string[];
  temperatures: number[];
  seed?: number;
}
```

**Output:**
```typescript
{
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
}
```

### `getSubSteps(executionId)`

**Input:** `executionId: string`

**Output:** [`SubStep[]`](#substep)

---

## ExecutionsService

Manages DAG execution lifecycle and monitoring.

### `list(filter?)`

**Input:**
```typescript
{
  dagId?: string;
  status?: DAGExecutionStatus;
  limit?: number;
  offset?: number;
}
```

**Output:** [`DAGExecution[]`](#dagexecution)

### `get(id)`

**Input:** `id: string`

**Output:** [`DAGExecution`](#dagexecution)

### `getWithSubSteps(id)`

**Input:** `id: string`

**Output:** [`DAGExecutionWithSteps`](#dagexecutionwithsteps)

```typescript
interface DAGExecutionWithSteps extends DAGExecution {
  subSteps: SubStep[];
}
```

### `listForDag(dagId, opts?)`

**Input:**
| Parameter | Type | Required |
|-----------|------|----------|
| `dagId` | `string` | ✓ |
| `opts.status` | `DAGExecutionStatus` | |
| `opts.limit` | `number` | |
| `opts.offset` | `number` | |

**Output:** [`DagExecutionListResult`](#dagexecutionlistresult)

```typescript
interface DagExecutionListResult {
  executions: DAGExecution[];
  total: number;
  limit: number;
  offset: number;
}
```

### `getSubSteps(id)`

**Input:** `id: string`

**Output:** [`SubStep[]`](#substep)

### `delete(id)`

**Input:** `id: string`

**Output:** `void`

### `streamEvents(id)`

**Input:** `id: string`

**Output:** `AsyncIterable<ExecutionEvent>`

---

## ToolsService

Lists available tools for agent use.

### `list(filter?)`

**Input:** `filter?: Record<string, any>`

**Output:** [`ToolDefinition[]`](#tooldefinition)

---

## ArtifactsService

Manages file artifacts produced during execution.

### `list()`

**Output:** `string[]` (list of filenames)

### `get(filename)`

**Input:** `filename: string`

**Output:** `Buffer`

---

## CostsService

Tracks LLM usage and costs.

### `getExecutionCosts(executionId)`

**Input:** `executionId: string`

**Output:** [`ExecutionCostBreakdown`](#executioncostbreakdown)

```typescript
interface ExecutionCostBreakdown {
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
```

### `getDagCosts(dagId)`

**Input:** `dagId: string`

**Output:** [`DagCostBreakdown`](#dagcostbreakdown)

```typescript
interface DagCostBreakdown {
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
```

### `getCostSummary(opts?)`

**Input:** [`CostSummaryOptions`](#costsummaryoptions)

```typescript
interface CostSummaryOptions {
  from?: Date;
  to?: Date;
  groupBy?: 'day' | 'week' | 'month';
}
```

**Output:** [`CostSummaryResult`](#costsummaryresult)

```typescript
interface CostSummaryResult {
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
```

---

## LLM Provider

Interface for LLM backends (OpenAI, OpenRouter, Ollama).

### `chat(params)`

**Input:** [`ChatParams`](#chatparams)

```typescript
interface ChatParams {
  messages: Message[];
  temperature?: number;
  maxTokens?: number;
}

interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}
```

**Output:** [`ChatResponse`](#chatresponse)

```typescript
interface ChatResponse {
  content: string;
  usage?: UsageInfo;
  costUsd?: number;
  generationStats?: Record<string, any>;
}
```

### `callWithTools(params)`

**Input:** [`LLMCallParams`](#llmcallparams)

```typescript
interface LLMCallParams {
  messages: Message[];
  tools: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
}
```

**Output:** [`LLMResponse`](#llmresponse)

```typescript
interface LLMResponse {
  thought: string;
  toolCalls?: ToolCall[];
  finishReason: 'stop' | 'tool_calls' | 'length' | 'content_filter' | 'error';
  usage?: UsageInfo;
  costUsd?: number;
  generationStats?: Record<string, any>;
}

interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
}
```

---

## Core Type Definitions

### Agent

```typescript
interface Agent {
  id: string;
  name: string;
  version: string;
  description?: string;
  systemPrompt: string;
  provider: 'openai' | 'openrouter' | 'ollama';
  model: string;
  isActive: boolean;
  allowedTools?: string[];
  constraints?: AgentConstraints;
  createdAt: Date;
  updatedAt: Date;
  metadata?: Record<string, any>;
}

interface AgentConstraints {
  maxTokens?: number;
  temperature?: number;           // 0-2
  topP?: number;                  // 0-1
  frequencyPenalty?: number;      // -2 to 2
  presencePenalty?: number;       // -2 to 2
  maxSteps?: number;
  timeout?: number;               // milliseconds
}
```

### DAG

```typescript
interface DAG {
  id: string;
  objective: string;
  nodes: DAGNode[];
  edges: DAGEdge[];
  status: ExecutionStatus;
  createdAt: Date;
  updatedAt: Date;
  metadata?: Record<string, any>;
}

interface DAGNode {
  id: string;
  label: string;
  description: string;
  agentId?: string;
  type: 'task' | 'decision' | 'parallel' | 'sequential';
}

interface DAGEdge {
  from: string;
  to: string;
  condition?: string;
  metadata?: Record<string, any>;
}
```

### DAGExecution

```typescript
interface DAGExecution {
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

type DAGExecutionStatus = 
  | 'pending' | 'running' | 'waiting' 
  | 'completed' | 'failed' | 'partial' | 'suspended';
```

### SubStep

```typescript
interface SubStep {
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

type SubStepStatus = 'pending' | 'running' | 'waiting' | 'completed' | 'failed';
```

### ToolDefinition

```typescript
interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>;  // JSON Schema
  };
}
```

### DecomposerJob

The internal schema for decomposed task planning:

```typescript
interface DecomposerJob {
  original_request: string;
  intent: {
    primary: string;
    sub_intents: string[];
  };
  entities: Array<{
    entity: string;
    type: string;
    grounded_value: string;
  }>;
  sub_tasks: SubTask[];
  synthesis_plan: string;
  validation: {
    coverage: string;
    gaps: string[];
    iteration_triggers: string[];
  };
  clarification_needed: boolean;
  clarification_query?: string;  // Required when clarification_needed is true
}

interface SubTask {
  id: string;
  description: string;
  thought: string;
  action_type: 'tool' | 'inference';
  tool_or_prompt: {
    name: string;
    params?: Record<string, any>;
  };
  expected_output: string;
  dependencies: string[];
}
```

### ExecutionEvent

For streaming execution updates:

```typescript
interface ExecutionEvent {
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

enum ExecutionEventType {
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
```

### UsageInfo

```typescript
interface UsageInfo {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}
```

---

## Enums

### ExecutionStatus

```typescript
enum ExecutionStatus {
  Pending = 'pending',
  Active = 'active',
  Paused = 'paused',
  Completed = 'completed',
  Failed = 'failed',
  Cancelled = 'cancelled',
}
```

### LLMProvider

```typescript
type LLMProvider = 'openai' | 'openrouter' | 'ollama';
```

### LogLevel

```typescript
type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';
```
