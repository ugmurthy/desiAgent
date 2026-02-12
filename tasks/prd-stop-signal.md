# PRD: Stop Signal for DAG Creation & Execution

## Introduction

Add a stop signal capability to desiAgent that allows external consumers to request graceful abort of DAG creation or pause of DAG execution. A DB-backed `dagStopRequests` table stores stop requests. Public service methods are exposed so that callers — both internal code and external packages importing desiAgent — can request stops without breaking existing APIs or response shapes.

## Goals

- Allow DAG creation (`createFromGoal`) to be aborted mid-flight, deleting the partially-created DAG and returning `status: 'failed'`.
- Allow DAG execution to be paused, setting execution and in-flight sub-steps to `pending`.
- Persist stop requests in a `dagStopRequests` SQLite table for multi-process reliability.
- Expose public service methods suitable for use when desiAgent is imported as a library.
- Zero breaking changes to existing public APIs, response shapes, or error types.

## User Stories

### US-001: Add `dagStopRequests` table to DB schema
**Description:** As a developer, I need a persistent table to store stop requests so they survive across processes and can be queried by `dagId` or `executionId`.

**Acceptance Criteria:**
- [ ] New `dagStopRequests` table added to `src/db/schema.ts` with columns: `id` (text, PK), `dagId` (text, nullable), `executionId` (text, nullable), `status` (text, enum `requested` | `handled`), `requestedAt` (integer, timestamp), `handledAt` (integer, timestamp, nullable)
- [ ] Drizzle type exports added: `DagStopRequest`, `NewDagStopRequest`
- [ ] DB migration generated and applies cleanly
- [ ] Typecheck passes (`bun run typecheck` or equivalent)

### US-002: Add stop-request helper functions
**Description:** As a developer, I need helper functions to create, query, and mark-as-handled stop requests so the service layer has a clean data-access API.

**Acceptance Criteria:**
- [ ] Helper to insert a stop request for a given `dagId` (sets `status: 'requested'`, `requestedAt: now`)
- [ ] Helper to insert a stop request for a given `executionId`
- [ ] Helper to check if an active (`status: 'requested'`) stop request exists for a `dagId`
- [ ] Helper to check if an active stop request exists for an `executionId`
- [ ] Helper to mark a stop request as `handled` (sets `status: 'handled'`, `handledAt: now`)
- [ ] All helpers accept a `DrizzleDB` instance as parameter (no singletons)
- [ ] Typecheck passes

### US-003: Public service methods to request stop
**Description:** As a consumer importing desiAgent, I want to call `requestStopForDag(dagId)` or `requestStopForExecution(executionId)` to record a stop request without directly touching the DB.

**Acceptance Criteria:**
- [ ] `DAGsService` exposes `async requestStopForDag(dagId: string): Promise<void>`
- [ ] `DAGsService` exposes `async requestStopForExecution(executionId: string): Promise<void>`
- [ ] Both methods insert a row into `dagStopRequests` via the helpers from US-002
- [ ] Methods are public and available when desiAgent is imported as a package
- [ ] Calling stop for a non-existent `dagId`/`executionId` does NOT throw (idempotent insert)
- [ ] Typecheck passes

### US-004: AbortController registry in DAGsService
**Description:** As a developer, I need a centralized in-memory registry of `AbortController` instances keyed by `dagId` and `executionId` so that stop-request methods can immediately abort in-flight LLM calls and stop checks can query active controllers.

**Acceptance Criteria:**
- [ ] `DAGsService` has a private `Map<string, AbortController>` (e.g., `activeControllers`) to track in-flight creation and execution controllers
- [ ] `createFromGoal` creates an `AbortController`, registers it under the DAG's `id`, and removes it on completion, failure, or abort
- [ ] `executeDAG` (or the path that instantiates `DAGExecutor.execute`) creates an `AbortController`, registers it under the `executionId`, and removes it on completion, failure, or abort
- [ ] If the caller passes an external `abortSignal` in options, both the external signal and the internal controller's signal are respected (either triggers abort); use a combined/linked signal approach
- [ ] Registry entries are always cleaned up (no leaks) — verified by ensuring the map size returns to its pre-call value after any creation/execution completes
- [ ] Typecheck passes

### US-005: Stop check during DAG creation
**Description:** As a consumer, when I request a stop for a DAG that is currently being created via `createFromGoal`, the creation should abort, delete the partially-created DAG record, and return `status: 'failed'`.

**Acceptance Criteria:**
- [ ] Stop signal checked before each LLM call inside the `createFromGoal` retry loop
- [ ] Stop signal checked before persisting the final DAG record
- [ ] If stop detected and a DAG record was already inserted in this attempt, that record is deleted
- [ ] Method returns a result with `status: 'failed'` (reuses existing `DAGPlanningResult` union — no new type)
- [ ] Stop request marked as `handled` after abort
- [ ] A log entry is emitted with `dagId` explaining the stop
- [ ] Existing `createFromGoal` behavior is unchanged when no stop is requested
- [ ] Typecheck passes

### US-006: Stop check during DAG execution
**Description:** As a consumer, when I request a stop for a running execution, the executor should pause gracefully, setting the execution and any in-flight sub-steps to `pending`.

**Acceptance Criteria:**
- [ ] Stop signal checked before starting each task in `DAGExecutor.execute`
- [ ] Stop signal checked after each task completes
- [ ] If stop detected: `dagExecutions.status` set to `pending`
- [ ] If stop detected: any sub-steps with `status: 'running'` or `status: 'pending'` remain/reset to `pending`
- [ ] Already `completed` or `failed` sub-steps are NOT modified
- [ ] Execution returns without throwing (graceful exit)
- [ ] Stop request marked as `handled`
- [ ] A log entry is emitted with `executionId` explaining the stop
- [ ] Existing execution behavior is unchanged when no stop is requested
- [ ] Typecheck passes

### US-007: Abort in-flight LLM calls on stop request
**Description:** As a consumer, when I request a stop I want any in-flight LLM inference call to be cancelled immediately rather than waiting for it to complete before the next poll-based stop check.

**Acceptance Criteria:**
- [ ] `createFromGoal` creates an internal `AbortController` at the start of the flow and passes its `signal` as `abortSignal` to all LLM calls (the `abortSignal` plumbing in `ChatParams`, providers, and executor already exists)
- [ ] `DAGExecutor.execute` creates an internal `AbortController` at the start and passes its `signal` through `ExecutionConfig.abortSignal` to all task/synthesis LLM calls
- [ ] `requestStopForDag(dagId)` triggers `.abort()` on the controller associated with the active `createFromGoal` call for that DAG
- [ ] `requestStopForExecution(executionId)` triggers `.abort()` on the controller associated with the active `execute` call for that execution
- [ ] A `Map<string, AbortController>` (or similar registry) in `DAGsService` tracks active controllers keyed by `dagId` / `executionId`; entries are removed on completion or abort
- [ ] When an LLM call is aborted, the resulting error is caught gracefully (not re-thrown as unhandled) and the same stop-handling logic from US-005 / US-006 applies (delete DAG / set pending)
- [ ] If the caller also passed an external `abortSignal` in options, both signals are respected (either one can trigger abort)
- [ ] Typecheck passes

### US-008: Observability logging for stop events
**Description:** As an operator, I want clear log entries when a stop signal is detected so I can understand why a creation or execution ended early.

**Acceptance Criteria:**
- [ ] Log at `info` level when a stop request is recorded (with `dagId` or `executionId`)
- [ ] Log at `info` level when a stop is detected and acted upon during creation (with `dagId`)
- [ ] Log at `info` level when a stop is detected and acted upon during execution (with `executionId`)
- [ ] Logs use the existing `getLogger()` utility
- [ ] Typecheck passes

## Functional Requirements

- FR-1: Add `dagStopRequests` SQLite table with columns `id`, `dagId`, `executionId`, `status`, `requestedAt`, `handledAt`
- FR-2: `status` column is an enum of `requested` | `handled`
- FR-3: Provide data-access helpers for insert, query-active, and mark-handled operations on `dagStopRequests`
- FR-4: `DAGsService.requestStopForDag(dagId)` inserts a stop request row targeting a DAG
- FR-5: `DAGsService.requestStopForExecution(executionId)` inserts a stop request row targeting an execution
- FR-6: `createFromGoal` checks for active stop requests before each LLM call and before persisting
- FR-7: On stop during creation: delete the new DAG record (if created), return `status: 'failed'`
- FR-8: `DAGExecutor.execute` checks for active stop requests before and after each task
- FR-9: On stop during execution: set execution status to `pending`, set in-flight sub-steps to `pending`, leave completed/failed sub-steps unchanged, return gracefully
- FR-10: Mark stop requests as `handled` after they are acted upon
- FR-11: `DAGsService` maintains an in-memory `Map<string, AbortController>` registry of active creation/execution controllers
- FR-12: `requestStopForDag` and `requestStopForExecution` call `.abort()` on the matching controller to immediately cancel in-flight LLM HTTP requests
- FR-13: Abort errors from LLM calls are caught gracefully and routed into the existing stop-handling logic (US-005/US-006)
- FR-14: If the caller provides an external `abortSignal` in options, it is merged with the internal controller signal so either can trigger cancellation
- FR-15: Log all stop-related events at `info` level with relevant IDs

## Non-Goals (Out of Scope)

- Cancelling or reverting already-completed sub-steps
- Changing existing response shapes, types, or error types
- Changing scheduling/cron behavior beyond checking stop signals
- HTTP REST endpoints or CLI commands for stop requests
- Automatic retry after a stop-paused execution
- Tests (will be a separate follow-up)

## Technical Considerations

- **Schema file:** `src/db/schema.ts` — add table alongside existing `dags`, `dagExecutions`, `dagSubSteps`
- **DAG creation:** `src/core/execution/dags.ts` — inject checks into the `while (attempt < maxAttempts)` loop in `createFromGoal`
- **DAG execution:** `src/core/execution/dagExecutor.ts` — inject checks into the wave-based task loop in `execute`
- **Dependency injection:** Stop-request helpers should be injected into `DAGsService` and `DAGExecutor` via their existing dependency/config objects (`DAGsServiceDeps`, `DAGExecutorConfig`) to keep them testable
- **Performance:** Stop checks are simple DB reads (single row lookup by indexed column); negligible overhead per task
- **Migration:** A new Drizzle migration is needed for the `dagStopRequests` table

## Success Metrics

- DAG creation aborts within one LLM-call boundary of a stop request
- DAG execution pauses within one task boundary of a stop request
- No existing tests break after changes
- Stop methods are importable and callable from external packages using desiAgent as a dependency

## Open Questions

- Should `requestStopForDag` also stop all active executions for that DAG, or only the creation flow?
- Should there be a `clearStopRequest` / `cancelStop` method to withdraw a stop before it's acted upon?
