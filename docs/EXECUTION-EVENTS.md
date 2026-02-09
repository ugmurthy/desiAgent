# Execution Events — Design Document

> Redesigned event system for real-time progress tracking in DAG executions.

## Motivation

The original event system had several issues:

1. **Misused types** — `StepCompleted` was emitted when a task *started*, confusing clients.
2. **No wave visibility** — clients couldn't see which tasks run in parallel.
3. **No synthesis events** — the synthesis LLM call was invisible to the client.
4. **Heavy payloads** — `Completed` included the full `finalResult` (potentially huge markdown), and every step event carried `usage`/`generationStats`/`costUsd`.
5. **Inconsistent error handling** — `suspendExecution` bypassed `emitEventIfEnabled` and reused `Failed` type for a semantically different event (suspension).
6. **No progress counters** — clients had to track `completed/total` themselves.
7. **Unused types** — `Paused` and `Resumed` were defined but never emitted.

## Event Types

```typescript
enum ExecutionEventType {
  // Lifecycle
  Started              = 'execution:started',
  Completed            = 'execution:completed',
  Failed               = 'execution:failed',
  Suspended            = 'execution:suspended',

  // Wave-level
  WaveStarted          = 'execution:wave_started',
  WaveCompleted        = 'execution:wave_completed',

  // Task-level
  TaskStarted          = 'execution:task_started',
  TaskProgress         = 'execution:task_progress',
  TaskCompleted        = 'execution:task_completed',
  TaskFailed           = 'execution:task_failed',

  // Synthesis
  SynthesisStarted     = 'execution:synthesis_started',
  SynthesisCompleted   = 'execution:synthesis_completed',
}
```

## Event Envelope

```typescript
interface ExecutionEvent {
  type: ExecutionEventType;
  executionId: string;
  ts: number;               // epoch ms — lightweight, no serialization ambiguity
  data?: Record<string, any>;
  error?: { message: string; code?: string };
}
```

## Per-Type Data Shapes

| Event | `data` | `error` | Notes |
|-------|--------|---------|-------|
| `Started` | `{ total, request }` | — | `request` is the original request string |
| `WaveStarted` | `{ wave, taskIds, parallel }` | — | `parallel` = count of tasks in wave |
| `TaskStarted` | `{ taskId, type, tool, description }` | — | `type` is `'tool'` or `'inference'` |
| `TaskProgress` | `{ taskId, message }` | — | Live progress from the tool itself |
| `TaskCompleted` | `{ taskId, durationMs }` | — | No usage/cost — query DB for those |
| `TaskFailed` | `{ taskId, durationMs }` | `{ message }` | |
| `WaveCompleted` | `{ wave, completedTasks, totalTasks, durationMs }` | — | Running totals for progress bar |
| `SynthesisStarted` | `{}` | — | Signal-only |
| `SynthesisCompleted` | `{ durationMs }` | — | |
| `Completed` | `{ status, completedTasks, failedTasks, durationMs }` | — | **No `finalResult`** — client GETs it |
| `Failed` | `{ completedTasks, failedTasks }` | `{ message }` | |
| `Suspended` | `{}` | `{ message }` | Replaces the catch-block `Failed` |

## Emission Points in `dagExecutor.ts`

| # | Location | Event |
|---|----------|-------|
| 1 | `execute()` — after setting status to running | `Started` |
| 2 | Wave loop — before executing wave tasks | `WaveStarted` |
| 3 | `executeTask()` — task begins | `TaskStarted` |
| 4 | `toolCtx.emitEvent.progress` callback | `TaskProgress` |
| 5 | `toolCtx.emitEvent.completed` callback | `TaskProgress` (tool-level completion is still mid-task progress) |
| 6 | Wave loop — task succeeds | `TaskCompleted` |
| 7 | Wave loop — task fails | `TaskFailed` |
| 8 | Wave loop — after all wave tasks settle | `WaveCompleted` |
| 9 | Before synthesis call | `SynthesisStarted` |
| 10 | After synthesis call | `SynthesisCompleted` |
| 11 | End of execute — success/partial | `Completed` |
| 12 | End of execute — all failed | `Failed` |
| 13 | `suspendExecution()` — catch block | `Suspended` |

## Stream Termination

`streamEvents()` closes on receiving any of: `execution:completed`, `execution:failed`, or `execution:suspended`.

## Client UX Example

```
[■■■□□] 3/5 tasks — Wave 2 running
  ✓ Task 1: webSearch (1.2s)
  ✓ Task 2: fetchURLs (0.8s)
  ⟳ Task 3: inference — "Analyzing results..."
  ○ Task 4: writeFile (waiting)
  ○ Task 5: sendEmail (waiting)
```

## Design Decisions

1. **`ts: number` over `timestamp: Date`** — smaller on the wire, no serialization ambiguity between JSON `string` and JS `Date`.
2. **No `finalResult` in events** — can be megabytes of markdown. Client fetches via `GET /executions/:id`.
3. **No `usage`/`costUsd`/`generationStats` in task events** — available via substep queries. Keeps events under ~200 bytes.
4. **Wave events** — enables parallel-task visualization without client-side DAG resolution.
5. **`Suspended` vs `Failed`** — semantically different (transient vs terminal). `Suspended` implies potential retry; `Failed` is final.
6. **`emitEventIfEnabled` consistency** — all emissions (including `suspendExecution`) now respect the `skipEvents` config.
7. **Removed `Paused`/`Resumed`** — were never emitted. Can be re-added when pause/resume is implemented.
8. **`toolCtx.emitEvent.completed` maps to `TaskProgress`** — a tool's internal "completed" message is still progress from the task's perspective. The true `TaskCompleted` is emitted after the tool returns.
