# Policy Layer Guide

This guide explains how to configure and use desiAgent's policy layer for:

1. Preflight governance before execution.
1. Runtime guardrails (parallelism, retries, budgets).
1. Auditability through persisted policy artifacts.
1. Querying and summarizing policy decisions.

The policy layer sits between DAG planning and DAG execution. It evaluates each runnable plan and returns a `PolicyDecision` with an `outcome`, `violations`, and runtime `directives`.

## What The Policy Layer Does

Before `dags.execute()` or `dags.resume()` starts task execution, policy evaluation runs and can:

1. Allow execution.
1. Deny execution.
1. Request clarification (for risky plans).
1. Rewrite plans (if your policy engine supports rewrites).

Each decision is persisted to `policy_artifacts` with:

1. Outcome and mode (`lenient` or `strict`).
1. Policy version and rule-pack metadata.
1. Violations and rationale.
1. Runtime directives.

## Policy Concepts

### Mode (`policyMode`)

1. `lenient`: denies only critical preflight violations by default.
1. `strict`: tighter governance; medium+ violations are denied.

### Enforcement (`policyEnforcement`)

1. `hard`: blocking outcomes (`deny`, `needs_clarification`) stop execution.
1. `soft`: blocking outcomes are logged as warnings; execution continues.

#### How Enforcement Affects Directives

Enforcement mode controls whether policy directives override user-provided `executionConfig` values:

| Enforcement | User provides value | User provides nothing |
|-------------|---------------------|-----------------------|
| `soft`      | User's value wins   | Policy directive applies as default |
| `hard`      | Policy directive wins (overrides user) | Policy directive applies |

**Important:** In both modes, if no explicit `executionConfig` is provided, policy directives become the active limits. For example, a policy directive of `maxExecutionTokens: 2000` will suspend execution when exceeded — even in `soft` mode — unless you pass an explicit override.

### Changing Default Directives

There are three ways to adjust the default directives that the policy engine computes:

1. **Per-call override (recommended):** Pass an explicit `executionConfig` when calling `execute()` or `resume()`. In `soft` mode your values take precedence over policy directives.

   ```ts
   await client.dags.execute(dagId, {
     executionConfig: {
       maxExecutionTokens: 100_000,
       maxExecutionCostUsd: 0.10,
     },
   });
   ```

1. **At setup via `policyThresholds`:** Configure budget thresholds in `setupDesiAgent()` to change how the engine computes directives.

   ```ts
   const client = await setupDesiAgent({
     // ...
     policyThresholds: {
       softTokenBudget: 50_000,
       hardTokenBudget: 120_000,
       softCostBudgetUsd: 0.10,
       hardCostBudgetUsd: 0.50,
       directiveBudgetHeadroomMultiplier: 1.5,
     },
   });
   ```

1. **Via environment variables:** Set `POLICY_SOFT_TOKEN_BUDGET`, `POLICY_HARD_TOKEN_BUDGET`, etc. (see [Environment Variable Overrides](#environment-variable-overrides) below).

The engine calculates `maxExecutionTokens` dynamically from task count × per-task token estimates, clamped to a floor of `1000` tokens. Raising the threshold budgets or the headroom multiplier increases the resulting directive values.

### Rule Pack Metadata

Every decision stores:

1. `rulePackId` (default: `core`).
1. `rulePackVersion` (default: `2026.03`).

Use this to compare behavior across policy revisions.

### Side-Effect Approval At Execution Time

`dags.execute()` and `dags.resume()` accept `sideEffectApproval?: boolean`.

In strict mode, this is useful when the plan has side-effecting actions and you want explicit user/operator approval recorded in the execution call path.

## Setup In `setupDesiAgent`

### Basic Policy Configuration

```ts
import { setupDesiAgent } from '@ugm/desiagent';

const client = await setupDesiAgent({
  llmProvider: 'openrouter',
  openrouterApiKey: process.env.OPENROUTER_API_KEY,
  modelName: 'openai/gpt-4o',

  policyMode: 'lenient',
  policyEnforcement: 'hard',
  policyRulePackId: 'core',
  policyRulePackVersion: '2026.03',

  policyThresholds: {
    softTokenBudget: 12_000,
    hardTokenBudget: 30_000,
    softCostBudgetUsd: 0.03,
    hardCostBudgetUsd: 0.10,
    sideEffectDenseTaskCount: 3,
    parallelSideEffectsViolationThreshold: 1,
    sideEffectParallelismCap: 2,
    directiveBudgetHeadroomMultiplier: 1.25,
  },
});
```

### Strict Mode Example

```ts
const client = await setupDesiAgent({
  llmProvider: 'openai',
  openaiApiKey: process.env.OPENAI_API_KEY,
  modelName: 'gpt-4o',

  policyMode: 'strict',
  policyEnforcement: 'hard',
  policyRulePackId: 'org-security',
  policyRulePackVersion: '2026.03.1',
});
```

### Environment Variable Overrides

You can configure policy globally using env vars.

```bash
POLICY_MODE=strict
POLICY_RULE_PACK_ID=org-security
POLICY_RULE_PACK_VERSION=2026.03.1

POLICY_SOFT_TOKEN_BUDGET=12000
POLICY_HARD_TOKEN_BUDGET=30000
POLICY_SOFT_COST_BUDGET_USD=0.03
POLICY_HARD_COST_BUDGET_USD=0.10

POLICY_SIDE_EFFECT_DENSE_TASK_COUNT=3
POLICY_PARALLEL_SIDE_EFFECTS_VIOLATION_THRESHOLD=1
POLICY_SIDE_EFFECT_PARALLELISM_CAP=2
POLICY_DIRECTIVE_BUDGET_HEADROOM_MULTIPLIER=1.25
```

These env vars override defaults and are combined with `policyThresholds` in config.

## Advanced Wiring (Custom Engine/Repository)

If you are embedding services manually (instead of only using `setupDesiAgent()`), you can inject your own policy engine and repository into `DAGsService`.

```ts
import {
  DAGsService,
  DefaultPolicyEngine,
  PolicyRepository,
} from '@ugm/desiagent';

const policyEngine = new DefaultPolicyEngine(toolRegistry, {
  mode: 'strict',
  maxParallelismCap: 5,
  rulePack: { id: 'org-security', version: '2026.03.1' },
  thresholds: {
    hardTokenBudget: 40_000,
    hardCostBudgetUsd: 0.2,
  },
});

const policyRepository = new PolicyRepository(db);

const dagsService = new DAGsService({
  db,
  llmProvider,
  toolRegistry,
  agentsService,
  artifactsDir,
  policyEngine,
  policyRepository,
  policyEnforcement: 'hard',
});
```

## Execute And Resume With Policy Controls

### Normal Execute

```ts
const started = await client.dags.execute(dagId, {
  policyEnforcement: 'hard',
  executionConfig: {
    maxParallelism: 4,
  },
});
```

### Strict Mode With Explicit Side-Effect Approval

```ts
const started = await client.dags.execute(dagId, {
  policyEnforcement: 'hard',
  sideEffectApproval: true,
});
```

### Resume With Approval

```ts
const resumed = await client.dags.resume(executionId, {
  policyEnforcement: 'hard',
  sideEffectApproval: true,
  executionConfig: {
    timeoutMsPerTask: 45_000,
  },
});
```

### Handling Blocking Outcomes

With hard enforcement, a deny/clarification decision throws a `ValidationError`.

```ts
import { ValidationError } from '@ugm/desiagent';

try {
  await client.dags.execute(dagId, { policyEnforcement: 'hard' });
} catch (error) {
  if (error instanceof ValidationError) {
    console.error('Policy blocked execution:', error.message);
  }
}
```

Common messages include:

1. `Execution denied by policy: ...`
1. `Execution requires policy clarification: ...`

### Soft Enforcement Behavior

With `policyEnforcement: 'soft'`:

1. Blocking outcomes are recorded and logged.
1. Execution continues.
1. Policy directives are applied as defaults, but explicit `executionConfig` overrides are respected.

## Query And Audit Policy Decisions

`DAGsService` now exposes three policy-audit methods:

1. `getPolicyArtifact(id)`
1. `listPolicyArtifacts(filter?)`
1. `summarizePolicyArtifacts(filter?)`

### `getPolicyArtifact(id)`

```ts
const artifact = await client.dags.getPolicyArtifact('policy_abc123');

if (artifact) {
  console.log(artifact.outcome, artifact.policyVersion);
}
```

### `listPolicyArtifacts(filter?)`

Supported filters:

1. `dagId`
1. `executionId`
1. `outcome`
1. `mode`
1. `policyVersion`
1. `rulePackId`
1. `rulePackVersion`
1. `violationCode`
1. `createdAfter`
1. `createdBefore`
1. `limit`
1. `offset`

Example:

```ts
const artifacts = await client.dags.listPolicyArtifacts({
  dagId,
  mode: 'strict',
  outcome: 'deny',
  violationCode: 'TOOL_NOT_FOUND',
  createdAfter: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
  limit: 100,
});

for (const a of artifacts) {
  console.log({
    id: a.id,
    executionId: a.executionId,
    outcome: a.outcome,
    mode: a.mode,
    policyVersion: a.policyVersion,
    rulePack: `${a.rulePackId}@${a.rulePackVersion}`,
  });
}
```

### `summarizePolicyArtifacts(filter?)`

Returns aggregated policy telemetry useful for dashboards.

```ts
const summary = await client.dags.summarizePolicyArtifacts({
  createdAfter: new Date(Date.now() - 24 * 60 * 60 * 1000),
});

console.log('Total:', summary.total);
console.log('By outcome:', summary.byOutcome);
console.log('By mode:', summary.byMode);
console.log('By policy version:', summary.byPolicyVersion);
console.log('By rule pack:', summary.byRulePack);
console.log('Top violation codes:', summary.topViolationCodes);
```

Example shape:

```json
{
  "total": 42,
  "byOutcome": {
    "allow": 30,
    "deny": 7,
    "needs_clarification": 5,
    "rewrite": 0
  },
  "byMode": {
    "lenient": 28,
    "strict": 14
  },
  "byPolicyVersion": [
    { "policyVersion": "policy/v2-lenient", "count": 28 },
    { "policyVersion": "policy/v2-strict", "count": 14 }
  ],
  "byRulePack": [
    { "rulePackId": "core", "rulePackVersion": "2026.03", "count": 19 },
    { "rulePackId": "org-security", "rulePackVersion": "2026.03.1", "count": 23 }
  ],
  "topViolationCodes": [
    { "code": "PARALLEL_SIDE_EFFECTS_LIMITED", "count": 11 },
    { "code": "BUDGET_EXCEEDS_SOFT_LIMIT", "count": 8 }
  ]
}
```

## End-To-End Example

```ts
import { setupDesiAgent, ValidationError } from '@ugm/desiagent';

const client = await setupDesiAgent({
  llmProvider: 'openrouter',
  openrouterApiKey: process.env.OPENROUTER_API_KEY,
  modelName: 'openai/gpt-4o',
  policyMode: 'strict',
  policyEnforcement: 'hard',
  policyRulePackId: 'org-security',
  policyRulePackVersion: '2026.03.1',
});

const plan = await client.dags.createFromGoal({
  goalText: 'Research market updates and send summary email to stakeholders',
  agentName: 'inference',
});

if (plan.status === 'success') {
  try {
    const exec = await client.dags.execute(plan.dagId, {
      sideEffectApproval: true,
      policyEnforcement: 'hard',
    });
    console.log('Execution started:', exec.id);
  } catch (error) {
    if (error instanceof ValidationError) {
      console.error('Blocked by policy:', error.message);
    }
  }

  const latest = await client.dags.listPolicyArtifacts({ dagId: plan.dagId, limit: 10 });
  console.log('Recent policy decisions:', latest.length);

  const summary = await client.dags.summarizePolicyArtifacts({ dagId: plan.dagId });
  console.log('Policy summary:', summary);
}

await client.shutdown();
```

## One-Time Upgrade Fix For Existing Databases

If you upgraded from a build created before rule-pack columns were added, existing DBs may miss:

1. `policy_artifacts.rule_pack_id`
1. `policy_artifacts.rule_pack_version`
1. Sometimes `sub_steps.generation_id`

From this build onward, desiAgent applies a **one-time compatibility preflight automatically at startup**. It only runs when columns are missing, and then never re-applies for that DB.

Look for this log message on first successful upgrade startup:

```text
Applied one-time database compatibility migration(s) for legacy schema
```

If your environment is currently blocked and you need a manual one-time patch per DB file, run [scripts/one-time-db-fix.ts](../scripts/one-time-db-fix.ts) once per database path.

```bash
bun run scripts/one-time-db-fix.ts /absolute/path/to/agent.db
```

## Troubleshooting

1. If strict mode is unexpectedly blocking runs, start by checking the latest artifact via `listPolicyArtifacts({ dagId, limit: 1 })` and inspect `violations`.
1. If you want observability without blocking in production, use `policyEnforcement: 'soft'` and monitor summaries.
1. If budget-related denials are frequent, tune `policyThresholds` and track `BUDGET_EXCEEDS_SOFT_LIMIT` and `BUDGET_EXCEEDS_HARD_LIMIT` frequencies.
1. Use `rulePackId` and `rulePackVersion` aggressively so behavior changes are auditable across deployments.
