# Background StatsWorker — Design Document

> Offloads OpenRouter generation stats fetching to a background Bun Worker thread, keeping the DAG execution hot path fast.

## Problem

OpenRouter does not return generation stats (cost, latency, token counts) inline with chat completions. Instead, stats must be fetched via a separate API call:

```
GET https://openrouter.ai/api/v1/generation?id={generationId}
```

This call uses exponential backoff starting at 2 seconds with up to 5 retry attempts — potentially blocking the main thread for 10+ seconds per LLM call. Previously, stats were fetched either inline (blocking) or via fire-and-forget promises (no graceful shutdown, risk of lost updates). The StatsWorker moves all of this to a dedicated thread.

## Architecture Overview

```
┌─────────────────────────────────────────────────┐
│                  Main Thread                     │
│                                                  │
│  DAGExecutor / DAGsService                       │
│       │                                          │
│       ▼                                          │
│  StatsQueue                                      │
│   - enqueue(job)  ──postMessage──►  ┌──────────┐ │
│   - terminate()                     │  Worker  │ │
│   - pendingCount                    │  Thread  │ │
│       ◄──onmessage──────────────    │          │ │
│                                     │ statsW.  │ │
│                                     │          │ │
│                                     │ Own DB   │ │
│                                     │ conn.    │ │
│                                     └──────────┘ │
└─────────────────────────────────────────────────┘
```

### Components

| Component       | File                              | Thread     | Role                                                                                                                                                                           |
| --------------- | --------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **StatsQueue**  | `src/core/workers/statsQueue.ts`  | Main       | Spawns the worker, provides `enqueue(job)` and `terminate()`. Tracks `pendingCount` on the main-thread side.                                                                   |
| **statsWorker** | `src/core/workers/statsWorker.ts` | Bun Worker | Receives jobs via `onmessage`, fetches stats from OpenRouter, updates DB rows. Has its own SQLite connection (WAL mode allows concurrent readers/writers on the same DB file). |
| **Consumers**   | `dagExecutor.ts`, `dags.ts`       | Main       | Call `statsQueue.enqueue()` after LLM calls instead of fetching stats inline.                                                                                                  |

## Message Protocol

Communication uses Bun Worker `postMessage` / `onmessage`:

### Main → Worker

| `type`     | Payload              | When                                    |
| ---------- | -------------------- | --------------------------------------- |
| `init`     | `{ dbPath, apiKey }` | Once, immediately after worker creation |
| `job`      | `{ job: StatsJob }`  | Each time a stats update is needed      |
| `shutdown` | —                    | During graceful termination             |

### Worker → Main

| `type`    | Payload                | When                                               |
| --------- | ---------------------- | -------------------------------------------------- |
| `done`    | `{ table, id }`        | Job completed successfully                         |
| `error`   | `{ table, id, error }` | Job failed (logged, not retried)                   |
| `drained` | —                      | All in-flight jobs finished after shutdown request |

## StatsJob Interface

```typescript
interface StatsJob {
  table: "sub_steps" | "dag_executions" | "dags";
  id: string;
  generationId: string;
  taskId?: string; // sub_steps: composite key with executionId
  executionId?: string; // sub_steps: composite key with taskId
  attemptIndex?: number; // dags: which planningAttempts entry to patch
}
```

### Per-Table Update Logic

#### `sub_steps`

Fetches generation stats from OpenRouter, then updates the row matching `(taskId, executionId)` with:

- `generationStats` — filtered stats object (latency, model, generation_time, finish_reason, total_cost, id)
- `costUsd` — extracted `total_cost` as string

#### `dag_executions`

Aggregates costs and usage across all `sub_steps` for a given execution. The worker waits 1 second before reading sub_steps to allow concurrent sub_step stats jobs to finish first. Sets:

- `totalUsage` — sum of `{ promptTokens, completionTokens, totalTokens }` from all sub_steps
- `totalCostUsd` — sum of all sub_step `costUsd` values

Note: `generationId` is passed as empty string (`''`) for this job type since no OpenRouter fetch is needed — it's a pure aggregation.

#### `dags`

Fetches stats for a planning LLM call and patches `planningAttempts[attemptIndex]` with `costUsd` and `generationStats`. Then recalculates `planningTotalCostUsd` by summing all attempt costs. Also sets `generationStats` at the DAG level.

## Graceful Shutdown / Drain

The `terminate()` method ensures all enqueued jobs complete before the worker exits:

```
terminate() called
    │
    ▼
pendingCount === 0? ──yes──► worker.terminate() immediately
    │
    no
    ▼
worker.ref()          ← keep process alive during drain
    │
    ▼
postMessage({ type: 'shutdown' })
    │
    ▼
await Promise.race([
    worker 'drained' message,    ← worker sends this when its pendingCount hits 0
    30-second timeout            ← force-terminate if drain takes too long
])
    │
    ▼
worker.terminate()
this.worker = null
```

**Worker side:** After receiving `shutdown`, the worker sets `shutdownRequested = true` and stops accepting new jobs. `checkDrain()` runs in the `finally` block of each job — when `pendingCount` reaches 0, it posts `{ type: 'drained' }` and calls `process.exit(0)`.

**Worker ref/unref:** During normal operation, the worker is `unref()`'d so it doesn't prevent the Node/Bun process from exiting. During drain, it's `ref()`'d to keep the process alive until jobs complete.

## Wiring in `setupDesiAgent`

In `src/index.ts`, the StatsQueue is created conditionally:

```typescript
// Only created when ALL conditions are met:
// 1. llmProvider === 'openrouter'
// 2. skipGenerationStats is false (or unset)
// 3. apiKey is present
if (llmProvider === "openrouter" && !skipGenerationStats && apiKey) {
  statsQueue = new StatsQueue(dbPath, apiKey);
  statsQueue.start();
}
```

The queue is passed through the dependency chain:

```
setupDesiAgent
  └─► DAGsService({ statsQueue })     // via DAGsServiceDeps
        └─► DAGExecutor({ statsQueue })  // via DAGExecutorConfig
```

On shutdown:

```typescript
client.shutdown = async () => {
  await statsQueue?.terminate(); // drain before closing DB
  closeDatabase();
};
```

## Backward Compatibility

`statsQueue` is **optional** at every level (`DAGsServiceDeps`, `DAGExecutorConfig`). When absent, all code falls back to the original inline behavior:

```typescript
// In dagExecutor.ts (both per-task and batch update paths):
if (this.statsQueue && execResult.generationId) {
  // Background: enqueue stats fetch to worker
  this.statsQueue.enqueue({
    table: "sub_steps",
    id: task.id,
    taskId: task.id,
    executionId: execId,
    generationId: execResult.generationId,
  });
} else {
  // Inline: write stats directly in the DB update
  subStepUpdate.costUsd = execResult.costUsd?.toString();
  subStepUpdate.generationStats = execResult.generationStats;
}
```

This means:

- **Ollama** users are unaffected (Ollama returns stats inline, no generationId).
- **OpenRouter with `skipGenerationStats: true`** skips stats entirely (no queue created).
- **Existing deployments** continue working without configuration changes.

When the statsQueue handles `dag_executions`, the execution record is written without `totalUsage` / `totalCostUsd` — these fields are `null` initially and filled in asynchronously by the worker's aggregation job.

## generationId Flow

The `generationId` originates from the OpenRouter API response and flows through the system to the StatsJob:

```
OpenRouter API response
  { id: "gen-xxxx", ... }
        │
        ▼
OpenRouterProvider.chat()
  returns ChatResponse { generationId: data.id, ... }
        │
        ▼
LlmExecuteTool.execute()
  passes through generationId in its output
        │
        ▼
DAGExecutor — TaskExecutionResult { generationId }
        │
        ▼
statsQueue.enqueue({ generationId, table, id, ... })
        │
        ▼
statsWorker — fetchGenerationStats(generationId)
  GET /api/v1/generation?id={generationId}
```

The `generationId` field was added to:

- `ChatResponse` in `src/core/providers/types.ts`
- `TaskExecutionResult` in `src/core/execution/dagExecutor.ts`

The OpenRouter provider returns `generationId` in all code paths (inline stats, deferred stats, and skip-stats mode).

## Key Design Decisions

| Decision                                  | Rationale                                                                                                                              |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Worker has its own DB connection          | SQLite WAL mode supports concurrent readers and a single writer. The worker opens a separate connection to avoid cross-thread sharing. |
| Jobs processed serially                   | SQLite has a single-writer constraint. Serial processing avoids write contention.                                                      |
| Only OpenRouter needs this                | Ollama returns stats inline in the chat response. OpenAI could be added later if needed.                                               |
| Failed stats fetches are silently skipped | Stats are non-critical — a failed fetch logs a warning but doesn't affect execution results.                                           |
| `dag_executions` aggregation waits 1s     | Heuristic delay to let concurrent sub_step stats jobs finish before aggregating. Not guaranteed but reduces stale reads.               |
| Title generation stays on main thread     | Explicit design requirement — title updates happen via `backgroundUpdateDag` in `dags.ts`, not through the worker.                     |
| 30-second drain timeout                   | Balance between allowing slow OpenRouter responses to complete and not blocking shutdown indefinitely.                                 |

## Key Files

| File                                | Purpose                                    |
| ----------------------------------- | ------------------------------------------ |
| `src/core/workers/statsQueue.ts`    | Main-thread queue interface                |
| `src/core/workers/statsWorker.ts`   | Background worker thread                   |
| `src/core/execution/dagExecutor.ts` | Enqueues sub_steps and dag_executions jobs |
| `src/core/execution/dags.ts`        | Enqueues dags planning stats jobs          |
| `src/core/providers/openrouter.ts`  | Source of generationId                     |
| `src/core/providers/types.ts`       | ChatResponse with generationId field       |
| `src/index.ts`                      | Conditional creation and shutdown wiring   |
