# Core Optimization And Policy Layer Proposal

## Objective

This proposal reviews the core execution components and recommends changes to improve:

1. Speed/throughput.
1. Maintainability/readability.
1. Simplicity.
1. Algorithmic quality where it matters.

Constraint honored: **no change to external API calling convention** (`setupDesiAgent`, `dags.createFromGoal`, `dags.execute`, `executions.*`, etc.).

## Current Core Flow

The current flow is clean conceptually but concentrated in very large classes.

1. Planner: `DAGsService.createFromGoal()` generates `DecomposerJob` and persists in `dags.result`.
1. Executor kickoff: `DAGsService.execute()` reads DAG, creates execution rows, invokes `DAGExecutor.execute()` in background.
1. Runtime: `DAGExecutor.execute()` runs tasks by dependency waves, persists each task update, then synthesizes final output.

Primary files:

1. `src/core/execution/dags.ts`
1. `src/core/execution/dagExecutor.ts`
1. `src/core/execution/executions.ts`
1. `src/db/schema.ts`
1. `src/types/dag.ts`

## Key Findings

## Strengths

1. Good separation between planning (`DAGsService`) and execution (`DAGExecutor`).
1. Event model already improved and useful for UX streaming.
1. Retries + validation loop in planning are practical.
1. Cost/usage data model is already valuable for governance.

## Main Bottlenecks And Complexity Drivers

1. **Monolithic classes:** `dagExecutor.ts` (~1179 LOC) and `dags.ts` (~1697 LOC) are doing orchestration, validation, prompting, persistence, scheduling, and recovery together.
1. **Duplicate logic:** `buildGlobalContext`, `buildInferencePrompt`, status derivation, and usage/cost aggregation exist in both planner and executor paths.
1. **Wave scheduling scans all tasks every iteration** (simple and correct, but not optimal for larger DAGs).
1. **DB write amplification:** per-wave updates still issue many row-level updates; each completed task writes independently.
1. **Dependency substitution is runtime-heavy and string-regex based** per task execution, instead of a compiled plan pass.
1. **Agent resolution coupling is brittle:** inference task identity is overloaded via `tool_or_prompt.name`, which can conflict with `'inference'` literal usage.
1. **Policy/governance checks are implicit** (spread across prompt rules + tool restrictions), not explicit as a first-class enforcement layer.

## Optimization Proposal (No API Signature Changes)

## A. Execution Speed

1. **Compile execution plan once before run** (`ExecutionPlanCompiler`) to precompute:
   - adjacency/in-degree maps,
   - topological levels,
   - dependency placeholder bindings,
   - task risk class and expected cost/time hints.
1. **Use Kahn’s algorithm (O(V+E))** to derive execution levels and deadlock/cycle diagnostics deterministically.
1. **Reduce DB writes by transaction-batching per wave**:
   - one write for wave start,
   - one batched completion write,
   - one execution aggregate update.
1. **Reuse runtime helpers per execution** (single `LlmExecuteTool` instance, reusable serializers) to reduce repeated object creation.
1. **Bound parallelism with adaptive concurrency** instead of unconstrained `Promise.allSettled`:
   - start with `min(cpuBound=4, ioBound=8)` style defaults,
   - raise/lower based on observed latency/error rate.

## B. Maintainability And Readability

1. Split `DAGExecutor` into small units:
   - `ExecutionPlanCompiler`,
   - `DependencyResolver`,
   - `WaveRunner`,
   - `SynthesisRunner`,
   - `ExecutionPersistence`.
1. Split `DAGsService` planning concerns:
   - `PlanGenerator` (LLM calls + retries),
   - `PlanValidator`,
   - `DagRepository`.
1. Move shared prompt-context helpers into a single module (`execution/contextBuilder.ts`).
1. Introduce strict internal interfaces (`ExecutionTask`, `CompiledTask`, `PolicyDecision`) to reduce ad-hoc `Record<string, any>` use.

## C. Simplicity

1. Normalize inference task contract internally:
   - explicit `agentName` field in compiled form,
   - keep existing external schema backward-compatible by deriving `agentName` during compile.
1. Centralize dependency placeholder parsing once (compile-time), not repeatedly during tool execution.
1. Isolate side-effects behind small adapter interfaces (DB, tool execution, LLM invocation).

## D. Better Algorithms Where Applicable

1. **Topological scheduling:** Kahn’s algorithm for correctness + O(V+E).
1. **Critical path heuristic:** prioritize tasks with longer downstream path to reduce makespan for heterogeneous DAGs.
1. **Retry strategy:** exponential backoff with jitter for transient failures (already partly present in provider/stats paths, should be standardized in execution policy).
1. **Cost guardrail algorithm:** incremental budget accounting with hard and soft thresholds.

## Proposed Policy Layer (Planner → Policy → Executor)

## Why This Layer

Today planning output goes directly to execution. A policy layer gives deterministic governance before side effects.

This aligns with best practices from:

1. Policy-as-code systems (OPA/Rego, Cedar style authorization).
1. Safety/constitutional constraints in LLM systems (rule-based preflight checks before action).
1. Workflow engines that separate planning from admission control.

## Placement

Inserted in `DAGsService.execute()` after parsing/validation and before creating runnable execution state.

Flow becomes:

1. Planner emits `DecomposerJob`.
1. **Policy engine evaluates + rewrites/annotates plan**.
1. Executor runs only approved/rewritten plan.

No public method signature changes are required.

## Policy Layer Responsibilities

1. Structural validity checks (missing dependencies, cycles, unreachable nodes).
1. Tool/skill governance (allowlist, denylist, environment constraints, egress constraints).
1. Risk scoring (side-effecting tools, networked actions, external comms).
1. Budgeting (max planned tokens/cost/time).
1. Concurrency and retry directives (per task class).
1. Optional safe rewrites (e.g., enforce `webSearch -> fetchURLs` sequence where needed).
1. Human escalation gates for high-risk plans.

## Policy Decision Contract

```ts
type PolicyOutcome = 'allow' | 'deny' | 'needs_clarification' | 'rewrite';

interface PolicyViolation {
  code: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  taskId?: string;
  message: string;
  recommendation?: string;
}

interface ExecutionDirectives {
  maxParallelism: number;
  maxRetriesPerTask: number;
  retryBackoffMs: number;
  timeoutMsPerTask?: number;
  maxExecutionCostUsd?: number;
  maxExecutionTokens?: number;
}

interface PolicyDecision {
  outcome: PolicyOutcome;
  rewrittenJob?: DecomposerJob;
  directives: ExecutionDirectives;
  violations: PolicyViolation[];
  rationale: string;
  policyVersion: string;
}
```

## Policy Evaluation Stages

1. **Stage 1: Static graph checks**
   - Kahn cycle check,
   - dependency existence check,
   - duplicate task ID check.
1. **Stage 2: Capability checks**
   - unknown tool/skill,
   - forbidden side-effect combinations,
   - send-email/webhook gating.
1. **Stage 3: Risk and budget checks**
   - estimate token/cost envelope,
   - cap parallel side-effecting tasks,
   - enforce “high-risk requires clarification”.
1. **Stage 4: Scheduling directives**
   - set `maxParallelism`, retry policy, task timeout defaults.
1. **Stage 5: Persist policy artifact**
   - store decision/rationale with execution metadata for audit.

## Default Policy Modes

1. **Lenient (default for backward compatibility):** warns and rewrites where safe; only denies critical violations.
1. **Strict (opt-in config):** denies on medium+ violations and requires explicit user confirmation for side-effect plans.

## Selected Defaults (Implemented)

1. Policy mode: **lenient only** for now.
1. Policy artifact persistence: **dedicated DB table** (`policy_artifacts`).
1. Inference agent resolution: supports explicit internal `agentName` while preserving backward compatibility.
1. Max runtime parallelism cap: **5**.

## Suggested Internal Modules

1. `src/core/policy/types.ts`
1. `src/core/policy/engine.ts`
1. `src/core/policy/rules/graphRules.ts`
1. `src/core/policy/rules/toolRules.ts`
1. `src/core/policy/rules/budgetRules.ts`
1. `src/core/policy/rules/riskRules.ts`
1. `src/core/policy/policyRepository.ts`

## Non-Breaking Integration Plan

1. Add optional `policyEngine` dependency to `DAGsServiceDeps` with no public breaking API.
1. In `DAGsService.execute()`:
   - parse DAG job,
   - call `policyEngine.evaluate(job, context)`,
   - if deny/clarification, create execution record with terminal/suspended semantics as currently used,
   - else run rewritten/original plan with directives passed into executor config.
1. Extend `ExecutionConfig` internally with policy directives while keeping existing fields valid.

## Performance Impact Expectations

1. **Compile + Kahn scheduling:** reduced runtime overhead for large DAGs; better deadlock diagnostics.
1. **Batched persistence:** lower DB round-trips (largest speed win in I/O-heavy workflows).
1. **Adaptive concurrency:** better latency under mixed tool workloads.
1. **Policy preflight:** small fixed overhead, but fewer failed runs and better safety.

## Rollout Plan

## Phase 0 (Low risk, immediate)

1. Extract duplicated helpers.
1. Add execution plan compiler and graph validation utilities.
1. Add benchmark harness (`small`, `medium`, `large` DAG fixtures).

## Current Status

1. Phase 0 is implemented: shared helper extraction, execution plan compiler, and benchmark harness are added.
1. Phase 1 foundation is implemented in lenient mode: graph + capability + risk + budget preflight checks now run before execute/resume.
1. Policy artifacts are persisted for both allow and deny outcomes, and integration tests validate this end-to-end.
1. `execute/resume` now handle all policy outcomes safely (`allow`, `deny`, `needs_clarification`, `rewrite`) without API signature changes.
1. Phase 2 runtime work is now implemented: wave-level batched persistence uses transactions when available (with safe fallback), policy directives are wired into executor runtime config, adaptive concurrency is enabled, and retry/timeout handling is standardized by task class.
1. Phase 3 governance work is now implemented: configurable policy thresholds are available via config/env, strict policy mode is supported with explicit side-effect approval gates, and policy rule-pack metadata plus repository audit queries are persisted for diagnostics/dashboards.

## Phase 1 (Policy layer foundation)

1. Introduce `PolicyEngine` with staged graph/capability/risk/budget checks in lenient mode.
1. Persist policy decisions as metadata artifacts for observability and auditability.
1. Keep outcome mostly `allow`, while using `needs_clarification` for high-risk side-effect plans lacking dependency evidence.

## Phase 2 (Runtime optimization)

1. Enable batched wave persistence transactions.
1. Enable adaptive concurrency directives from policy.
1. Standardize retry/timeout behavior per task class.
1. Add runtime budget guardrails using policy-provided token/cost limits.

## Phase 3 (Advanced governance)

1. Configurable budget-aware denial/clarification thresholds (instead of fixed defaults).
1. Strict mode.
1. Rule pack versioning and audit tooling.

## Metrics To Track

1. Median and P95 total execution latency.
1. Median and P95 per-wave duration.
1. DB writes per execution.
1. Failure/suspension rate by rule code.
1. Cost overrun incidents prevented by policy.

## Risk Notes

1. Overly strict policy can reduce completion rate; start with lenient mode.
1. Rewrites can surprise users if opaque; persist rationale and expose in execution metadata.
1. Policy correctness becomes critical path; keep rules deterministic and heavily unit-tested.

## Concrete Next Steps

1. Harden and benchmark policy-directive propagation in executor runtime under mixed workloads.
1. Tune adaptive concurrency and retry heuristics with benchmark-driven thresholds.
1. Add configurable policy thresholds via runtime config/env while keeping backward-compatible defaults.
1. Add richer policy repository/query surfaces for debugging and dashboards.
1. Add budget-guardrail telemetry to execution traces and dashboards.
1. Add performance regression tests for representative DAG sizes.
