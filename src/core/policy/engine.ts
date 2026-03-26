import type { DecomposerJob } from '../../types/dag.js';
import type { ToolRegistry } from '../tools/registry.js';
import { ExecutionPlanCompiler } from '../execution/planCompiler.js';
import type { PolicyDecision, PolicyEngine, PolicyEvaluationContext, PolicyViolation } from './types.js';

const POLICY_VERSION = 'policy/v1-lenient';

const SIDE_EFFECT_TOOLS = new Set(['bash', 'writeFile', 'edit', 'sendEmail', 'sendWebhook']);
const HIGH_RISK_TOOLS = new Set(['sendEmail', 'sendWebhook']);
const NETWORK_TOOLS = new Set(['webSearch', 'fetchPage', 'fetchURLs', 'sendWebhook']);

const SOFT_TOKEN_BUDGET = 12000;
const HARD_TOKEN_BUDGET = 30000;
const SOFT_COST_BUDGET_USD = 0.03;
const HARD_COST_BUDGET_USD = 0.1;

const ESTIMATED_TOKENS = {
  inferenceTask: 1400,
  skillTask: 900,
  networkToolTask: 500,
  localToolTask: 200,
};

const ESTIMATED_COST_USD = {
  inferenceTask: 0.003,
  skillTask: 0.002,
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

export class LenientPolicyEngine implements PolicyEngine {
  private readonly toolRegistry: ToolRegistry;
  private readonly maxParallelismCap: number;

  constructor(toolRegistry: ToolRegistry, maxParallelismCap: number = 5) {
    this.toolRegistry = toolRegistry;
    this.maxParallelismCap = maxParallelismCap;
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

    const risk = this.evaluateRisk(job, waves, violations);
    const budget = this.evaluateBudget(job, violations);

    const maxParallelismFromPolicy = risk.maxParallelSideEffectsInWave > 1 ? 2 : this.maxParallelismCap;
    const maxParallelism = Math.max(
      1,
      Math.min(
        context.requestedMaxParallelism ?? this.maxParallelismCap,
        this.maxParallelismCap,
        maxParallelismFromPolicy,
      ),
    );

    const maxExecutionTokens = Math.max(
      500000,
      Math.min(
        Math.ceil(budget.estimatedTokens * 1.25),
        context.requestedMaxExecutionTokens ?? HARD_TOKEN_BUDGET,
        HARD_TOKEN_BUDGET,
      ),
    );

    const maxExecutionCostUsd = Number(
      Math.max(
        0.50,
        Math.min(
          Number((budget.estimatedCostUsd * 1.25).toFixed(4)),
          context.requestedMaxExecutionCostUsd ?? HARD_COST_BUDGET_USD,
          HARD_COST_BUDGET_USD,
        ),
      ).toFixed(4),
    );

    const directives = {
      maxParallelism,
      maxRetriesPerTask: risk.sideEffectTaskCount > 0 ? 1 : 2,
      retryBackoffMs: risk.sideEffectTaskCount > 0 ? 1500 : 1000,
      timeoutMsPerTask: risk.hasNetworkTasks ? 45000 : 30000,
      maxExecutionTokens,
      maxExecutionCostUsd,
    };

    const hasCritical = violations.some((violation) => violation.severity === 'critical');
    const outcome = hasCritical ? 'deny' : risk.clarificationRequired ? 'needs_clarification' : 'allow';
    const rationale = hasCritical
      ? 'Denied by lenient policy due to critical preflight violations.'
      : outcome === 'needs_clarification'
      ? 'Execution requires clarification because plan includes high-risk side effects without supporting dependencies.'
      : violations.length > 0
      ? 'Allowed by lenient policy with non-critical warnings and execution guardrails.'
      : 'Allowed by lenient policy; no preflight violations found.';

    return {
      outcome,
      directives,
      violations,
      rationale,
      policyVersion: POLICY_VERSION,
      mode: 'lenient',
    };
  }

  private evaluateRisk(
    job: DecomposerJob,
    waves: Array<Array<{ id: string; action_type: string; tool_or_prompt: { name: string } }>>,
    violations: PolicyViolation[],
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

    if (sideEffectTaskCount >= 3) {
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

    if (maxParallelSideEffectsInWave > 1) {
      violations.push({
        code: 'PARALLEL_SIDE_EFFECTS_LIMITED',
        severity: 'medium',
        message: `Detected ${maxParallelSideEffectsInWave} parallel side-effecting tasks in a single wave.`,
        recommendation: 'Policy will cap runtime parallelism to reduce blast radius.',
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

    if (estimated.estimatedTokens > HARD_TOKEN_BUDGET || roundedCost > HARD_COST_BUDGET_USD) {
      violations.push({
        code: 'BUDGET_EXCEEDS_HARD_LIMIT',
        severity: 'critical',
        message: `Estimated budget ${estimated.estimatedTokens} tokens / $${roundedCost.toFixed(4)} exceeds hard limit ${HARD_TOKEN_BUDGET} tokens / $${HARD_COST_BUDGET_USD.toFixed(4)}.`,
        recommendation: 'Reduce plan scope or split execution into smaller DAGs.',
      });
    } else if (estimated.estimatedTokens > SOFT_TOKEN_BUDGET || roundedCost > SOFT_COST_BUDGET_USD) {
      violations.push({
        code: 'BUDGET_EXCEEDS_SOFT_LIMIT',
        severity: 'medium',
        message: `Estimated budget ${estimated.estimatedTokens} tokens / $${roundedCost.toFixed(4)} exceeds soft guidance ${SOFT_TOKEN_BUDGET} tokens / $${SOFT_COST_BUDGET_USD.toFixed(4)}.`,
        recommendation: 'Policy allows execution but applies tighter execution guardrails.',
      });
    }

    return {
      estimatedTokens: estimated.estimatedTokens,
      estimatedCostUsd: roundedCost,
    };
  }
}
