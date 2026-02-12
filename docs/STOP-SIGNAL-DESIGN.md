# Stop Signal Design

## Goal
Add a stop signal capability that allows:
- DAG creation to abort and return `failed`, deleting any created DAG.
- DAG execution to pause and return `pending` for execution and any in-flight sub-steps.
- No breaking changes to public APIs or existing flows.

## Context
Primary integration points:
- `src/core/execution/dags.ts`
- `src/core/execution/dagExecutor.ts`
- `src/db/schema.ts`

## Non-Goals
- Cancelling or reverting already-completed sub-steps.
- Changing existing response shapes or error types.
- Changing scheduling behavior (cron) beyond a stop check.

## Proposed Design

### 1. Stop Signal Registry
A minimal stop-request storage layer, queryable by `dagId` and `executionId`.

Options (both non-breaking):
- In-memory registry for single-process deployments.
- DB-backed table `dagStopRequests` for multi-process reliability.

Suggested DB schema (if using DB-backed):
- `id` (string, primary key)
- `dagId` (string, nullable)
- `executionId` (string, nullable)
- `status` (`requested` | `handled`)
- `requestedAt` (timestamp)
- `handledAt` (timestamp, nullable)

### 2. Stop Signal API
Add service methods (and optionally HTTP endpoints) that only record stop requests:
- `requestStopForDag(dagId)`
- `requestStopForExecution(executionId)`
These do not modify DAG/execution directly.

### 3. DAG Creation Stop
Inject stop checks into `createFromGoal`:
- Check stop signal before each LLM call and before persisting new DAG records.
- If stop requested and a new DAG was created in this attempt:
  - Delete that DAG record.
  - Return `status: 'failed'` (reuse existing failure path to avoid response changes).

### 4. DAG Execution Stop
Inject stop checks into the execution loop:
- Check stop before starting a task and after each task finishes.
- If stop requested:
  - Update `dagExecutions.status = 'pending'`.
  - Update any in-flight sub-steps to `pending`.
  - Leave completed/failed sub-steps unchanged.
- Execution returns without throwing.

### 5. Observability
Log stop events with `dagId`/`executionId` to clarify why a run ended early.

## Implementation Checklist

### Data Layer
1. Decide stop signal storage: in-memory or DB-backed.
2. If DB-backed, add `dagStopRequests` table to `src/db/schema.ts`.
3. Add helper functions to read/write stop requests.

### Service Layer
1. Add stop request methods in a service module (new or existing).
2. Wire stop registry into `src/core/execution/dags.ts` via dependency injection.
3. Add stop checks in `createFromGoal` around each attempt and before persistence.

### Execution Layer
1. Add stop checks inside `src/core/execution/dagExecutor.ts` loop.
2. On stop, update `dagExecutions` and `dagSubSteps` statuses to `pending`.

### API/CLI (if applicable)
1. Add an endpoint or CLI command to trigger stop requests.
2. Ensure no existing API signatures change.

### Tests
1. Add tests for “stop during creation” to assert DAG is deleted and status is `failed`.
2. Add tests for “stop during execution” to assert `pending` on execution and in-flight sub-steps.
