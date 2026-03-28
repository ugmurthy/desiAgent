import type { DecomposerJob } from '../../types/dag.js';
import type { ToolRegistry } from '../tools/registry.js';
import { ExecutionPlanCompiler } from '../execution/planCompiler.js';
import type {
  PolicyDecision,
  PolicyEngine,
  PolicyEvaluationContext,
  PolicyMode,
  PolicyRulePack,
  PolicyThresholds,
  PolicyViolation,
} from './types.js';

const POLICY_ENGINE_VERSION = 'v2';

export const DEFAULT_POLICY_RULE_PACK: PolicyRulePack = Object.freeze({
  id: 'core',
  version: '2026.03',
});

export const DEFAULT_POLICY_THRESHOLDS: PolicyThresholds = Object.freeze({
  softTokenBudget: 12000,
  hardTokenBudget: 30000,
  softCostBudgetUsd: 0.03,
  hardCostBudgetUsd: 0.1,
  sideEffectDenseTaskCount: 3,
  parallelSideEffectsViolationThreshold: 1,
  sideEffectParallelismCap: 2,
  directiveBudgetHeadroomMultiplier: 1.25,
});

const MIN_EXECUTION_TOKENS = 10000;
const MIN_EXECUTION_COST_USD = 0.005;

const SIDE_EFFECT_TOOLS = new Set(['bash', 'writeFile', 'edit', 'sendEmail', 'sendWebhook']);
const HIGH_RISK_TOOLS = new Set(['sendEmail', 'sendWebhook']);
const NETWORK_TOOLS = new Set(['webSearch', 'fetchPage', 'fetchURLs', 'sendWebhook']);

const ESTIMATED_TOKENS = {
  inferenceTask: 100000,
  skillTask: 100000,
  networkToolTask: 50000,
  localToolTask: 2000,
};

const ESTIMATED_COST_USD = {
  inferenceTask: 0.1,
  skillTask: 0.1,
  networkToolTask: 0.0008,
  localToolTask: 0.0002,
};

const DANGEROUS_BASH_PATTERNS = [/\brm\s+-rf\b/i, /\bcurl\b[^\n]*\|[^\n]*\bsh\b/i, /\bwget\b[^\n]*\|[^\n]*\bsh\b/i];

interface RiskSummary {
  sideEffectTaskCount: number;
  hasNetworkTasks: boolean;
  maxParallelSideEffectsInWave: number;
  clarificationRequired: boolean;
}

interface BudgetEstimate {
  estimatedTokens: number;
  estimatedCostUsd: number;
}

export interface PolicyEngineOptions {
  mode?: PolicyMode;
  maxParallelismCap?: number;
  thresholds?: Partial<PolicyThresholds>;
  rulePack?: Partial<PolicyRulePack>;
}

function normalizeThresholds(input?: Partial<PolicyThresholds>): PolicyThresholds {
  const merged: PolicyThresholds = {
    ...DEFAULT_POLICY_THRESHOLDS,
    ...(input || {}),
  };

  const softTokenBudget = Math.max(1, Math.floor(merged.softTokenBudget));
  const hardTokenBudget = Math.max(softTokenBudget, Math.floor(merged.hardTokenBudget));
  const softCostBudgetUsd = Number(Math.max(0.0001, merged.softCostBudgetUsd).toFixed(4));
  const hardCostBudgetUsd = Number(Math.max(softCostBudgetUsd, merged.hardCostBudgetUsd).toFixed(4));

  return {
    softTokenBudget,
    hardTokenBudget,
    softCostBudgetUsd,
    hardCostBudgetUsd,
    sideEffectDenseTaskCount: Math.max(1, Math.floor(merged.sideEffectDenseTaskCount)),
    parallelSideEffectsViolationThreshold: Math.max(0, Math.floor(merged.parallelSideEffectsViolationThreshold)),
    sideEffectParallelismCap: Math.max(1, Math.floor(merged.sideEffectParallelismCap)),
    directiveBudgetHeadroomMultiplier: Math.max(1, merged.directiveBudgetHeadroomMultiplier),
  };
}

export class DefaultPolicyEngine implements PolicyEngine {
  private readonly toolRegistry: ToolRegistry;
  private readonly mode: PolicyMode;
  private readonly maxParallelismCap: number;
  private readonly thresholds: PolicyThresholds;
  private readonly rulePack: PolicyRulePack;

  constructor(toolRegistry: ToolRegistry, options: PolicyEngineOptions = {}) {
    this.toolRegistry = toolRegistry;
    this.mode = options.mode ?? 'lenient';
    this.maxParallelismCap = Math.max(1, Math.floor(options.maxParallelismCap ?? 5));
    this.thresholds = normalizeThresholds(options.thresholds);
    this.rulePack = {
      id: options.rulePack?.id?.trim() || DEFAULT_POLICY_RULE_PACK.id,
      version: options.rulePack?.version?.trim() || DEFAULT_POLICY_RULE_PACK.version,
    };
  }

  evaluate(job: DecomposerJob, context: PolicyEvaluationContext = {}): PolicyDecision {
    const violations: PolicyViolation[] = [];
    let waves: Array<Array<{ id: string; action_type: string; tool_or_prompt: { name: string } }>> = [];

    try {
      const compiled = ExecutionPlanCompiler.compile(job.sub_tasks);
      waves = compiled.waves as Array<Array<{ id: string; action_type: string; tool_or_prompt: { name: string } }>>;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      violations.push({
        code: 'DAG_INVALID_GRAPH',
        severity: 'critical',
        message,
        recommendation: 'Fix DAG dependencies before execution.',
      });
    }

    for (const task of job.sub_tasks) {
      if (!task.tool_or_prompt?.name?.trim()) {
        violations.push({
          code: 'TASK_ACTION_NAME_MISSING',
          severity: 'critical',
          taskId: task.id,
          message: `Task ${task.id} is missing tool_or_prompt.name.`,
          recommendation: 'Regenerate the plan so every task has a concrete action name.',
        });
        continue;
      }

      if (task.action_type !== 'tool') {
        continue;
      }

      const toolName = task.tool_or_prompt.name;
      if (toolName === 'inference') {
        continue;
      }

      if (!this.toolRegistry.get(toolName)) {
        violations.push({
          code: 'TOOL_NOT_FOUND',
          severity: 'critical',
          taskId: task.id,
          message: `Task ${task.id} references unknown tool '${toolName}'.`,
          recommendation: 'Use a registered tool or regenerate the plan.',
        });
      }

      if (toolName === 'bash') {
        const command = task.tool_or_prompt.params?.command;
        if (typeof command === 'string' && DANGEROUS_BASH_PATTERNS.some((pattern) => pattern.test(command))) {
          violations.push({
            code: 'BASH_COMMAND_DANGEROUS',
            severity: 'critical',
            taskId: task.id,
            message: `Task ${task.id} contains a high-risk shell command pattern.`,
            recommendation: 'Use safer, scoped shell commands or a dedicated tool.',
          });
        }
      }
    }

    const risk = this.evaluateRisk(job, waves, violations, context);
    const budget = this.evaluateBudget(job, violations);

    const maxParallelismFromPolicy = risk.maxParallelSideEffectsInWave > this.thresholds.parallelSideEffectsViolationThreshold
      ? Math.min(this.thresholds.sideEffectParallelismCap, this.maxParallelismCap)
      : this.maxParallelismCap;

    const maxParallelism = Math.max(
      1,
      Math.min(
        context.requestedMaxParallelism ?? this.maxParallelismCap,
        this.maxParallelismCap,
        maxParallelismFromPolicy,
      ),
    );

    const tokenCeiling = Math.min(
      context.requestedMaxExecutionTokens ?? this.thresholds.hardTokenBudget,
      this.thresholds.hardTokenBudget,
    );
    const proposedTokenLimit = Math.max(
      MIN_EXECUTION_TOKENS,
      Math.ceil(budget.estimatedTokens * this.thresholds.directiveBudgetHeadroomMultiplier),
    );
    const maxExecutionTokens = Math.max(1, Math.min(proposedTokenLimit, tokenCeiling));

    const costCeiling = Math.min(
      context.requestedMaxExecutionCostUsd ?? this.thresholds.hardCostBudgetUsd,
      this.thresholds.hardCostBudgetUsd,
    );
    const proposedCostLimit = Math.max(
      MIN_EXECUTION_COST_USD,
      budget.estimatedCostUsd * this.thresholds.directiveBudgetHeadroomMultiplier,
    );
    const maxExecutionCostUsd = Number(Math.max(0.0001, Math.min(proposedCostLimit, costCeiling)).toFixed(4));

    const directives = {
      maxParallelism,
      maxRetriesPerTask: risk.sideEffectTaskCount > 0 ? 1 : 2,
      retryBackoffMs: risk.sideEffectTaskCount > 0 ? 1500 : 1000,
      timeoutMsPerTask: risk.hasNetworkTasks ? 45000 : 30000,
      maxExecutionTokens,
      maxExecutionCostUsd,
    };

    const hasCritical = violations.some((violation) => violation.severity === 'critical');
    const hasMediumOrHigher = violations.some((violation) =>
      violation.severity === 'medium' || violation.severity === 'high' || violation.severity === 'critical'
    );

    const outcome = hasCritical
      ? 'deny'
      : this.mode === 'strict' && hasMediumOrHigher
      ? 'deny'
      : risk.clarificationRequired
      ? 'needs_clarification'
      : 'allow';

    const policyVersion = `policy/${POLICY_ENGINE_VERSION}-${this.mode}`;
    const rationale = this.buildRationale(outcome, violations.length);

    return {
      outcome,
      directives,
      violations,
      rationale,
      policyVersion,
      mode: this.mode,
      rulePack: this.rulePack,
    };
  }

  private buildRationale(outcome: PolicyDecision['outcome'], violationCount: number): string {
    if (this.mode === 'strict') {
      if (outcome === 'deny') {
        return 'Denied by strict policy due to medium-or-higher preflight violations.';
      }
      if (outcome === 'needs_clarification') {
        return 'Strict policy requires clarification/approval before running side-effecting actions.';
      }
      if (violationCount > 0) {
        return 'Allowed by strict policy with low-severity warnings and runtime guardrails.';
      }
      return 'Allowed by strict policy; no preflight violations found.';
    }

    if (outcome === 'deny') {
      return 'Denied by lenient policy due to critical preflight violations.';
    }
    if (outcome === 'needs_clarification') {
      return 'Execution requires clarification because plan includes high-risk side effects without supporting dependencies.';
    }
    if (violationCount > 0) {
      return 'Allowed by lenient policy with non-critical warnings and execution guardrails.';
    }
    return 'Allowed by lenient policy; no preflight violations found.';
  }

  private evaluateRisk(
    job: DecomposerJob,
    waves: Array<Array<{ id: string; action_type: string; tool_or_prompt: { name: string } }>>,
    violations: PolicyViolation[],
    context: PolicyEvaluationContext,
  ): RiskSummary {
    let sideEffectTaskCount = 0;
    let hasNetworkTasks = false;
    let clarificationRequired = false;

    for (const task of job.sub_tasks) {
      if (task.action_type !== 'tool') {
        continue;
      }

      const toolName = task.tool_or_prompt.name;
      if (SIDE_EFFECT_TOOLS.has(toolName)) {
        sideEffectTaskCount++;
      }
      if (NETWORK_TOOLS.has(toolName)) {
        hasNetworkTasks = true;
      }

      if (HIGH_RISK_TOOLS.has(toolName) && task.dependencies.filter((dep) => dep !== 'none').length === 0) {
        clarificationRequired = true;
        violations.push({
          code: 'HIGH_RISK_SIDE_EFFECT_WITHOUT_DEPENDENCIES',
          severity: 'high',
          taskId: task.id,
          message: `Task ${task.id} uses '${toolName}' without any dependency context.`,
          recommendation: 'Gather evidence in earlier tasks or request user clarification before side effects.',
        });
      }
    }

    if (sideEffectTaskCount >= this.thresholds.sideEffectDenseTaskCount) {
      violations.push({
        code: 'SIDE_EFFECT_DENSE_PLAN',
        severity: 'medium',
        message: `Plan includes ${sideEffectTaskCount} side-effecting tasks.`,
        recommendation: 'Prefer read-only discovery steps before taking many side effects.',
      });
    }

    const maxParallelSideEffectsInWave = waves.reduce((max, wave) => {
      const sideEffectsInWave = wave.filter(
        (task) => task.action_type === 'tool' && SIDE_EFFECT_TOOLS.has(task.tool_or_prompt.name),
      ).length;
      return Math.max(max, sideEffectsInWave);
    }, 0);

    if (maxParallelSideEffectsInWave > this.thresholds.parallelSideEffectsViolationThreshold) {
      violations.push({
        code: 'PARALLEL_SIDE_EFFECTS_LIMITED',
        severity: 'medium',
        message: `Detected ${maxParallelSideEffectsInWave} parallel side-effecting tasks in a single wave.`,
        recommendation: 'Policy will cap runtime parallelism to reduce blast radius.',
      });
    }

    if (this.mode === 'strict' && sideEffectTaskCount > 0 && !context.sideEffectApproval) {
      clarificationRequired = true;
      violations.push({
        code: 'STRICT_MODE_SIDE_EFFECT_APPROVAL_REQUIRED',
        severity: 'low',
        message: 'Strict mode requires explicit side-effect approval before execution can continue.',
        recommendation: 'Retry execute/resume with sideEffectApproval=true after confirming intent.',
      });
    }

    return {
      sideEffectTaskCount,
      hasNetworkTasks,
      maxParallelSideEffectsInWave,
      clarificationRequired,
    };
  }

  private evaluateBudget(job: DecomposerJob, violations: PolicyViolation[]): BudgetEstimate {
    const estimated = job.sub_tasks.reduce(
      (acc, task) => {
        const toolName = task.tool_or_prompt.name;

        if (task.action_type === 'inference' || toolName === 'inference') {
          acc.estimatedTokens += ESTIMATED_TOKENS.inferenceTask;
          acc.estimatedCostUsd += ESTIMATED_COST_USD.inferenceTask;
          return acc;
        }

        if (task.action_type === 'skill') {
          acc.estimatedTokens += ESTIMATED_TOKENS.skillTask;
          acc.estimatedCostUsd += ESTIMATED_COST_USD.skillTask;
          return acc;
        }

        if (NETWORK_TOOLS.has(toolName)) {
          acc.estimatedTokens += ESTIMATED_TOKENS.networkToolTask;
          acc.estimatedCostUsd += ESTIMATED_COST_USD.networkToolTask;
        } else {
          acc.estimatedTokens += ESTIMATED_TOKENS.localToolTask;
          acc.estimatedCostUsd += ESTIMATED_COST_USD.localToolTask;
        }

        return acc;
      },
      { estimatedTokens: 0, estimatedCostUsd: 0 },
    );

    const roundedCost = Number(estimated.estimatedCostUsd.toFixed(4));

    if (estimated.estimatedTokens > this.thresholds.hardTokenBudget || roundedCost > this.thresholds.hardCostBudgetUsd) {
      violations.push({
        code: 'BUDGET_EXCEEDS_HARD_LIMIT',
        severity: 'critical',
        message: `Estimated budget ${estimated.estimatedTokens} tokens / $${roundedCost.toFixed(4)} exceeds hard limit ${this.thresholds.hardTokenBudget} tokens / $${this.thresholds.hardCostBudgetUsd.toFixed(4)}.`,
        recommendation: 'Reduce plan scope or split execution into smaller DAGs.',
      });
    } else if (estimated.estimatedTokens > this.thresholds.softTokenBudget || roundedCost > this.thresholds.softCostBudgetUsd) {
      violations.push({
        code: 'BUDGET_EXCEEDS_SOFT_LIMIT',
        severity: 'medium',
        message: `Estimated budget ${estimated.estimatedTokens} tokens / $${roundedCost.toFixed(4)} exceeds soft guidance ${this.thresholds.softTokenBudget} tokens / $${this.thresholds.softCostBudgetUsd.toFixed(4)}.`,
        recommendation: 'Policy allows execution but applies tighter execution guardrails.',
      });
    }

    return {
      estimatedTokens: estimated.estimatedTokens,
      estimatedCostUsd: roundedCost,
    };
  }
}

export class LenientPolicyEngine extends DefaultPolicyEngine {
  constructor(toolRegistry: ToolRegistry, maxParallelismCap: number = 5, options: Omit<PolicyEngineOptions, 'mode' | 'maxParallelismCap'> = {}) {
    super(toolRegistry, {
      ...options,
      mode: 'lenient',
      maxParallelismCap,
    });
  }
}

export class StrictPolicyEngine extends DefaultPolicyEngine {
  constructor(toolRegistry: ToolRegistry, maxParallelismCap: number = 5, options: Omit<PolicyEngineOptions, 'mode' | 'maxParallelismCap'> = {}) {
    super(toolRegistry, {
      ...options,
      mode: 'strict',
      maxParallelismCap,
    });
  }
}
