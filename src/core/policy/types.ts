import type { DecomposerJob } from '../../types/dag.js';

export type PolicyMode = 'lenient' | 'strict';

export type PolicyEnforcement = 'soft' | 'hard';

export type PolicyOutcome = 'allow' | 'deny' | 'needs_clarification' | 'rewrite';

export interface PolicyViolation {
  code: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  taskId?: string;
  message: string;
  recommendation?: string;
}

export interface PolicyThresholds {
  softTokenBudget: number;
  hardTokenBudget: number;
  softCostBudgetUsd: number;
  hardCostBudgetUsd: number;
  sideEffectDenseTaskCount: number;
  parallelSideEffectsViolationThreshold: number;
  sideEffectParallelismCap: number;
  directiveBudgetHeadroomMultiplier: number;
}

export interface PolicyRulePack {
  id: string;
  version: string;
}

export interface ExecutionDirectives {
  maxParallelism: number;
  maxRetriesPerTask: number;
  retryBackoffMs: number;
  timeoutMsPerTask?: number;
  maxExecutionCostUsd?: number;
  maxExecutionTokens?: number;
}

export interface PolicyDecision {
  outcome: PolicyOutcome;
  rewrittenJob?: DecomposerJob;
  directives: ExecutionDirectives;
  violations: PolicyViolation[];
  rationale: string;
  policyVersion: string;
  mode: PolicyMode;
  rulePack: PolicyRulePack;
}

export interface PolicyEvaluationContext {
  dagId?: string;
  executionId?: string;
  requestedMaxParallelism?: number;
  requestedMaxExecutionCostUsd?: number;
  requestedMaxExecutionTokens?: number;
  sideEffectApproval?: boolean;
}

export interface PolicyEngine {
  evaluate(job: DecomposerJob, context?: PolicyEvaluationContext): PolicyDecision;
}
