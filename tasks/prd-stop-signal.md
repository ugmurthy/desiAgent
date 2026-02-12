# PRD: Stop Signal Capability

## Introduction

Add a stop signal capability to allow DAG creation to abort and DAG execution to pause without breaking existing APIs. The system will accept stop requests, persist them in a DB-backed registry, and check for stop signals during creation/execution to return consistent statuses and clean up any newly created DAG records.

## Goals

- Allow DAG creation to abort early and return `failed` while deleting any newly created DAG record.
- Allow DAG execution to pause and return `pending`, with in-flight sub-steps marked `pending`.
- Persist stop requests in the database for multi-process reliability and auditability.
- Avoid breaking changes to public APIs or response shapes.

## User Stories

### US-001: Persist stop requests in a DB-backed registry
**Description:** As a developer, I want stop requests stored in the database so multiple workers can detect them and they survive restarts.

**Acceptance Criteria:**
- [ ] Add `dagStopRequests` table with fields: `id`, `dagId`, `executionId`, `status`, `requestedAt`, `handledAt`.
- [ ] Queries can find the most recent `requested` stop request for a `dagId` or `executionId`.
- [ ] A stop request can be marked as `handled` with `handledAt`.
- [ ] Typecheck/lint passes.

### US-002: Expose stop request service methods
**Description:** As a module consumer, I want service methods to request stops without changing public APIs.

**Acceptance Criteria:**
- [ ] Add service methods `requestStopForDag(dagId)` and `requestStopForExecution(executionId)`.
- [ ] Methods only record stop requests and do not mutate DAGs/executions directly.
- [ ] Methods are usable by other layers without changing existing public API shapes.
- [ ] Typecheck/lint passes.

### US-003: Abort DAG creation on stop
**Description:** As a system operator, I want DAG creation to abort when a stop is requested so partial DAGs are not persisted.

**Acceptance Criteria:**
- [ ] Stop checks occur before each LLM call (including retries) and before persisting new DAG records in `createFromGoal`.
- [ ] If a stop is detected and a new DAG was created in the attempt, that DAG record is deleted.
- [ ] The creation response returns `status: 'failed'` using the existing failure path.
- [ ] Stop events are logged with `dagId` and/or `executionId`.
- [ ] Typecheck/lint passes.

### US-004: Pause DAG execution on stop
**Description:** As a system operator, I want DAG execution to pause on stop so in-flight work is marked `pending` and can resume later.

**Acceptance Criteria:**
- [ ] Stop checks occur before starting a task and after each task finishes.
- [ ] If stop detected after a task finishes, update `dagExecutions.status = 'pending'`.
- [ ] Update any in-flight `dagSubSteps` to `pending`, leaving completed/failed unchanged.
- [ ] Execution returns without throwing.
- [ ] Stop events are logged with `dagId`/`executionId`.
- [ ] Typecheck/lint passes.

### US-005: Abort in-progress LLM calls when stop requested
**Description:** As a developer, I want LLM calls to cancel promptly when a stop is requested to reduce wasted work.

**Acceptance Criteria:**
- [ ] Pass an `AbortController` signal to all LLM provider calls (OpenAI, OpenRouter, Ollama).
- [ ] When a stop request is detected, the controller is aborted to cancel the in-flight LLM call.
- [ ] Typecheck/lint passes.

## Functional Requirements

1. FR-1: The system must store stop requests in a DB-backed table `dagStopRequests`.
2. FR-2: The system must provide `requestStopForDag(dagId)` and `requestStopForExecution(executionId)` service methods that only record stop requests.
3. FR-3: `createFromGoal` must check for stop requests before each LLM call and before persisting DAG records.
4. FR-4: If a stop is detected during creation, the newly created DAG (if any) must be deleted and status returned as `failed`.
5. FR-5: The execution loop must check for stop requests before starting each task and after each task finishes.
6. FR-6: If a stop is detected during execution, set `dagExecutions.status = 'pending'` and mark in-flight `dagSubSteps` as `pending`.
7. FR-7: Stop events must be logged with `dagId` and/or `executionId`.
8. FR-8: In-flight LLM calls must be aborted on stop using `AbortController` for OpenAI, OpenRouter, and Ollama providers.

## Non-Goals

- Cancelling or reverting already-completed sub-steps.
- Changing existing response shapes or error types.
- Changing scheduling behavior (cron) beyond a stop check.
- Adding public HTTP or CLI endpoints for stop requests.

## Design Considerations

- No UI changes are required.
- Ensure stop checks are lightweight to avoid latency regressions.

## Technical Considerations

- DB-backed registry is required for multi-process deployments and stop request durability.
- Add indexes to `dagStopRequests` for `dagId`, `executionId`, and `status` to ensure quick lookups.
- Abort support is available for OpenAI, OpenRouter, and Ollama; wire an `AbortController` into stop-aware flows and trigger `abort()` when stop is detected.
- Consider a cleanup strategy for old `handled` stop requests (e.g., periodic purge) to prevent table growth.

## Success Metrics

- Stop requests are detected and handled within one task boundary during execution.
- DAG creation returns `failed` and removes any newly created DAG record when stop is requested.
- Stop requests are durable across process restarts.

## Open Questions

- Should stop requests be auto-expired or remain indefinitely for audit purposes?
