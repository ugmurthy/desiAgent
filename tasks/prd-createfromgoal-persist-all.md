# PRD: createFromGoal() Unified Persistence & Response Refactor

## Introduction

Refactor the `createFromGoal()` method in DAGsService to persist all DAG creation attempts to the database, regardless of outcome (success, validation error, or clarification required). Currently, only successful DAGs are persisted, while errors are thrown and clarifications return without persistence. This change enables better tracking, debugging, and analytics of all DAG planning attempts.

## Goals

- Persist all DAG creation outcomes to the database (success, validation_error, pending)
- Return a unified response structure with `dagId` for all outcomes
- Remove thrown ValidationErrors from the planning loop, returning status instead
- Store failed validation content in the `result` field for debugging
- Enable downstream consumers to handle all outcomes uniformly via `dagId`

## User Stories

### US-001: Persist clarification-needed DAGs
**Description:** As a system operator, I want clarification-needed DAGs persisted so that I can track incomplete planning attempts and resume them later.

**Acceptance Criteria:**
- [ ] When `clarification_needed` is true, insert DAG record with status `'pending'`
- [ ] Store the DecomposerJob result in the `result` field (JSON stringified)
- [ ] Include `dagTitle` from TitleMaster if available
- [ ] Return `{ status: 'clarification_required', dagId: string, clarificationQuery: string }`
- [ ] Typecheck passes

### US-002: Persist validation-failed DAGs
**Description:** As a developer, I want failed DAG validations persisted so that I can debug why certain goals produce invalid structures.

**Acceptance Criteria:**
- [ ] When DAG validation fails after max attempts, insert DAG record with status `'validation_error'`
- [ ] Store the raw failed response string in the `result` field (not JSON parsed)
- [ ] Do NOT throw ValidationError - return response instead
- [ ] Return `{ status: 'validation_error', dagId: string }`
- [ ] Include all planning attempts and usage tracking in the persisted record
- [ ] Typecheck passes

### US-003: Unify return type for all outcomes
**Description:** As an API consumer, I want all createFromGoal outcomes to return a dagId so I can track and reference the planning attempt.

**Acceptance Criteria:**
- [ ] Update `DAGPlanningResult` type to always include `dagId: string`
- [ ] Success case: `{ status: 'success', dagId: string }`
- [ ] Clarification case: `{ status: 'clarification_required', dagId: string, clarificationQuery: string }`
- [ ] Validation error case: `{ status: 'validation_error', dagId: string }`
- [ ] Remove `UnpersistedResult` type (no longer needed)
- [ ] Typecheck passes

### US-004: Update createAndExecuteFromGoal() caller
**Description:** As a developer, I want createAndExecuteFromGoal to handle the new unified response format.

**Acceptance Criteria:**
- [ ] Update to check status field instead of type narrowing
- [ ] Handle `'validation_error'` status appropriately (throw or return error)
- [ ] Handle `'clarification_required'` status (throw as before)
- [ ] Typecheck passes

### US-005: Resume clarification via dagId
**Description:** As a user, I want to resume a clarification-required DAG by providing my response so that I don't have to restart planning from scratch.

**Acceptance Criteria:**
- [ ] Add `resumeFromClarification(dagId: string, userResponse: string)` method to DAGsService
- [ ] Fetch existing DAG record by dagId, validate status is `'pending'`
- [ ] Append user response to original goal text and re-run planning
- [ ] Reuse existing `createFromGoal` logic (DRY)
- [ ] On success, update the existing DAG record (don't create new one)
- [ ] Return same unified response format
- [ ] Typecheck passes

## Functional Requirements

- FR-1: Generate `dagId` at start of method for all code paths
- FR-2: Build `baseInsertData` structure that can be reused across all outcomes
- FR-3: On `clarification_needed === true`: insert with status `'pending'`, return with `dagId`
- FR-4: On validation failure (parse error or schema validation) after max attempts: insert with status `'validation_error'`, store raw response string in `result`, return with `dagId`
- FR-5: On success: insert with status `'success'` (existing behavior), return with `dagId`
- FR-6: Remove all `throw ValidationError` calls within the planning retry loop
- FR-7: Update `DAGPlanningResult` union type to require `dagId` in all variants
- FR-8: Remove `ClarificationRequiredResult.result` field (use dagId to fetch if needed)
- FR-9: Add `resumeFromClarification(dagId, userResponse)` method that updates existing pending DAG
- FR-10: Extract shared planning logic into reusable helper to keep code DRY

## Non-Goals

- No changes to how successful DAGs are stored
- No changes to execution logic
- No changes to cron scheduling registration
- No migration of existing data
- No API endpoint changes (response structure changes are internal)

## Technical Considerations

- The `result` column in `dags` table is `TEXT` with `mode: 'json'` - storing a raw string for validation errors will work since it's TEXT underneath
- `baseInsertData` should be constructed early with nullable `result` and `status` to be set per outcome
- TitleMaster generation can still run for clarification cases to provide context
- Planning attempts array should be fully populated before any insert
- **DRY Principle**: Extract LLM planning loop into a private helper method (e.g., `_runPlanningLoop()`) that returns the planning outcome without persistence. Both `createFromGoal` and `resumeFromClarification` call this helper, then handle persistence appropriately

## Success Metrics

- All `createFromGoal()` calls result in a persisted DAG record
- No ValidationErrors thrown from the planning loop
- Callers can uniformly access `dagId` from all responses
- Failed planning attempts are queryable for debugging

## Open Questions

None - all resolved.
