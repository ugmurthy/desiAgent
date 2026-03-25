import type { DecomposerJob } from '../../types/dag.js';
import type { ToolRegistry } from '../tools/registry.js';
import { ExecutionPlanCompiler } from '../execution/planCompiler.js';
import type { PolicyDecision, PolicyEngine, PolicyEvaluationContext, PolicyViolation } from './types.js';

const POLICY_VERSION = 'policy/v1-lenient';

export class LenientPolicyEngine implements PolicyEngine {
  private readonly toolRegistry: ToolRegistry;
  private readonly maxParallelismCap: number;

  constructor(toolRegistry: ToolRegistry, maxParallelismCap: number = 5) {
    this.toolRegistry = toolRegistry;
    this.maxParallelismCap = maxParallelismCap;
  }

  evaluate(job: DecomposerJob, context: PolicyEvaluationContext = {}): PolicyDecision {
    const violations: PolicyViolation[] = [];

    try {
      ExecutionPlanCompiler.compile(job.sub_tasks);
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
    }

    const directives = {
      maxParallelism: Math.max(1, Math.min(context.requestedMaxParallelism ?? this.maxParallelismCap, this.maxParallelismCap)),
      maxRetriesPerTask: 1,
      retryBackoffMs: 1000,
    };

    const hasCritical = violations.some((violation) => violation.severity === 'critical');
    const outcome = hasCritical ? 'deny' : 'allow';
    const rationale = hasCritical
      ? 'Denied by lenient policy due to critical preflight violations.'
      : 'Allowed by lenient policy; no critical preflight violations found.';

    return {
      outcome,
      directives,
      violations,
      rationale,
      policyVersion: POLICY_VERSION,
      mode: 'lenient',
    };
  }
}
