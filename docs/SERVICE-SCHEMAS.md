# desiAgent Service Schemas

This document reflects the current `src/core` services and types.

## Table of Contents

- [AgentsService](#agentsservice)
- [DAGsService](#dagsservice)
- [ExecutionsService](#executionsservice)
- [ToolsService](#toolsservice)
- [ArtifactsService](#artifactsservice)
- [CostsService](#costsservice)
- [LLM Provider](#llm-provider)
- [Core Types](#core-types)

---

## AgentsService

### `create(name, version, systemPrompt, params?)`

**Input**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | `string` | ✓ | Agent name |
| `version` | `string` | ✓ | Semantic version |
| `systemPrompt` | `string` | ✓ | System prompt for the agent |
| `params` | `Record<string, any>` | | Additional parameters (`provider`, `model`, `metadata`) |

**Output:** [`Agent`](#agent)

### `list(filter?)`

**Input**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `filter` | `Record<string, any>` | | `name`, `active` |

**Output:** `Agent[]`

### `get(id)`

**Input:** `id: string`

**Output:** [`Agent`](#agent)

### `update(id, updates)`

**Input**
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

### `createFromGoal(options)`

**Input:** [`CreateDAGFromGoalOptions`](#createdagfromgoaloptions)

```typescript
interface CreateDAGFromGoalOptions {
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
  abortSignal?: AbortSignal;
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

**Output**
```typescript
{ status: string; dagId: string; executionId: string }
```

### `resumeFromClarification(dagId, userResponse)`

**Input**
| Parameter | Type | Required |
|-----------|------|----------|
| `dagId` | `string` | ✓ |
| `userResponse` | `string` | ✓ |

**Output:** [`DAGPlanningResult`](#dagplanningresult)

### `execute(dagId, options?)`

**Input**
| Parameter | Type | Required |
|-----------|------|----------|
| `dagId` | `string` | ✓ |
| `options.provider` | `string` | |
| `options.model` | `string` | |
| `options.executionConfig` | `ExecutionConfig` | |

**Output:** `{ id: string; status: string }`

### `resume(executionId, executionConfig?)`

**Input:** `executionId: string`, `executionConfig?: ExecutionConfig`

**Output:** `{ id: string; status: string; retryCount: number }`

### `redoInference(executionId, params?)`

**Input:** `executionId: string`, `params?: { provider?: 'openai' | 'openrouter' | 'ollama'; model?: string }`

**Output:** `{ id: string; rerunCount: number }`

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

**Input**
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

**Output**
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

### `list(filter?)`

**Input**
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

**Input**
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

### `list(filter?)`

**Input:** `filter?: Record<string, any>`

**Output:** [`ToolDefinition[]`](#tooldefinition)

---

## ArtifactsService

### `list()`

**Output:** `string[]`

### `get(filename)`

**Input:** `filename: string`

**Output:** `Buffer`

---

## CostsService

### `getExecutionCosts(executionId)`

**Input:** `executionId: string`

**Output:** [`ExecutionCostBreakdown`](#executioncostbreakdown)

### `getDagCosts(dagId)`

**Input:** `dagId: string`

**Output:** [`DagCostBreakdown`](#dagcostbreakdown)

### `getCostSummary(opts?)`

**Input:** [`CostSummaryOptions`](#costsummaryoptions)

---

## LLM Provider

### `chat(params)`

**Input:** [`ChatParams`](#chatparams)

### `callWithTools(params)`

**Input:** [`LLMCallParams`](#llmcallparams)

---

## Core Types

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
  temperature?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  maxSteps?: number;
  timeout?: number;
}
```

### DAG

```typescript
interface DAG {
  id: string;
  dagTitle: string;
  status: ExecutionStatus;
  createdAt: Date;
  updatedAt: Date;
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
  | 'pending'
  | 'running'
  | 'waiting'
  | 'completed'
  | 'failed'
  | 'partial'
  | 'suspended';
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

type SubStepStatus =
  | 'pending'
  | 'running'
  | 'waiting'
  | 'completed'
  | 'failed'
  | 'deleted';
```

### ExecutionEvent

```typescript
interface ExecutionEvent {
  type: ExecutionEventType;
  executionId: string;
  ts: number;
  data?: Record<string, any>;
  error?: {
    message: string;
    code?: string;
  };
}

enum ExecutionEventType {
  Started = 'execution:started',
  Completed = 'execution:completed',
  Failed = 'execution:failed',
  Suspended = 'execution:suspended',
  WaveStarted = 'execution:wave_started',
  WaveCompleted = 'execution:wave_completed',
  TaskStarted = 'execution:task_started',
  TaskProgress = 'execution:task_progress',
  TaskCompleted = 'execution:task_completed',
  TaskFailed = 'execution:task_failed',
  SynthesisStarted = 'execution:synthesis_started',
  SynthesisCompleted = 'execution:synthesis_completed'
}
```

### ToolDefinition

```typescript
interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>;
  };
}
```

### CreateDAGFromGoalOptions

```typescript
interface CreateDAGFromGoalOptions {
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
  abortSignal?: AbortSignal;
}
```

### RunExperimentsInput

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

### ExecutionConfig

```typescript
interface ExecutionConfig {
  skipEvents?: boolean;
  batchDbUpdates?: boolean;
  abortSignal?: AbortSignal;
}
```

### ChatParams

```typescript
interface ChatParams {
  messages: Message[];
  temperature?: number;
  maxTokens?: number;
  abortSignal?: AbortSignal;
}

interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string | Array<{ type: 'text' | 'image_url'; text?: string; image_url?: { url: string; detail?: 'auto' | 'low' | 'high' } }>;
}
```

### LLMCallParams

```typescript
interface LLMCallParams {
  messages: Message[];
  tools: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  abortSignal?: AbortSignal;
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
  Cancelled = 'cancelled'
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
