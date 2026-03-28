import { z } from 'zod';
import { homedir } from 'os';
import { resolve, dirname, join } from 'path';

/**
 * Supported LLM providers for desiAgent
 */
export type LLMProvider = 'openai' | 'openrouter' | 'ollama';

/**
 * Logging levels
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

export type PolicyEnforcement = 'soft' | 'hard';
export type PolicyMode = 'lenient' | 'strict';

export interface PolicyThresholdConfig {
  softTokenBudget: number;
  hardTokenBudget: number;
  softCostBudgetUsd: number;
  hardCostBudgetUsd: number;
  sideEffectDenseTaskCount: number;
  parallelSideEffectsViolationThreshold: number;
  sideEffectParallelismCap: number;
  directiveBudgetHeadroomMultiplier: number;
}

const DEFAULT_POLICY_THRESHOLDS: PolicyThresholdConfig = Object.freeze({
  softTokenBudget: 12000,
  hardTokenBudget: 30000,
  softCostBudgetUsd: 0.03,
  hardCostBudgetUsd: 0.1,
  sideEffectDenseTaskCount: 3,
  parallelSideEffectsViolationThreshold: 1,
  sideEffectParallelismCap: 2,
  directiveBudgetHeadroomMultiplier: 1.25,
});

const PolicyThresholdsSchema = z.object({
  softTokenBudget: z.number().int().positive().optional(),
  hardTokenBudget: z.number().int().positive().optional(),
  softCostBudgetUsd: z.number().positive().optional(),
  hardCostBudgetUsd: z.number().positive().optional(),
  sideEffectDenseTaskCount: z.number().int().positive().optional(),
  parallelSideEffectsViolationThreshold: z.number().int().min(0).optional(),
  sideEffectParallelismCap: z.number().int().positive().optional(),
  directiveBudgetHeadroomMultiplier: z.number().positive().optional(),
});

/**
 * Zod schema for validating configuration
 */
export const DesiAgentConfigSchema = z.object({
  // Database
  databasePath: z.string().optional().default(() => {
    return resolve(homedir(), '.desiAgent', 'data', 'agent.db');
  }),

  // Artifacts directory (defaults to sibling of database file)
  artifactsDir: z.string().optional(),

  // LLM Provider
  llmProvider: z.enum(['openai', 'openrouter', 'ollama']),
  openaiApiKey: z.string().min(1).optional(),
  openrouterApiKey: z.string().min(1).optional(),
  ollamaBaseUrl: z.string().optional(),
  modelName: z.string(),

  // Agent definitions
  agentDefinitionsPath: z.string().optional().default(() => {
    return resolve(homedir(), '.desiAgent', 'agents');
  }),

  // Logging
  logLevel: z.enum(['debug', 'info', 'warn', 'error', 'silent']).optional().default('info').catch('info'),

  // Lifecycle callbacks
  onExecutionStart: z.function().optional(),
  onExecutionEnd: z.function().optional(),

  // Workspace root for skill discovery
  workspaceRoot: z.string().optional().default(() => process.cwd()),

  // Feature flags
  autoStartScheduler: z.boolean().optional().default(true),
  policyEnforcement: z.enum(['soft', 'hard']).optional().default('hard'),
  policyMode: z.enum(['lenient', 'strict']).optional().default('lenient'),
  policyRulePackId: z.string().min(1).optional().default('core'),
  policyRulePackVersion: z.string().min(1).optional().default('2026.03'),
  policyThresholds: PolicyThresholdsSchema.optional(),
  enableToolValidation: z.boolean().optional().default(true),
  skipGenerationStats: z.boolean().optional().default(false),
  statsReconcileIntervalMs: z.number().int().positive().optional().default(30_000),
  statsReconcileBatchSize: z.number().int().positive().optional().default(50),
});

/**
 * desiAgent Configuration Interface
 *
 * @example
 * ```typescript
 * const config: DesiAgentConfig = {
 *   llmProvider: 'openai',
 *   openaiApiKey: process.env.OPENAI_API_KEY,
 *   modelName: 'gpt-4o',
 *   databasePath: '~/.desiAgent/data/agent.db',
 *   logLevel: 'info',
 * };
 * ```
 */
export interface DesiAgentConfig {
  // Database location (auto-created if not exists)
  databasePath?: string;

  // Artifacts directory (defaults to sibling of database file)
  artifactsDir?: string;

  // LLM Provider setup
  llmProvider: LLMProvider;
  openaiApiKey?: string;
  openrouterApiKey?: string;
  ollamaBaseUrl?: string;
  modelName: string; // e.g., 'gpt-4o', 'mistral', 'claude-3.5-sonnet'

  // Agent definitions directory
  agentDefinitionsPath?: string;

  // Logging
  logLevel?: LogLevel;

  // Optional event handlers
  onExecutionStart?: (executionId: string) => void;
  onExecutionEnd?: (executionId: string, result: Record<string, any>) => void;

  // Workspace root for skill discovery
  workspaceRoot?: string;

  // Feature flags
  autoStartScheduler?: boolean;
  policyEnforcement?: PolicyEnforcement;
  policyMode?: PolicyMode;
  policyRulePackId?: string;
  policyRulePackVersion?: string;
  policyThresholds?: Partial<PolicyThresholdConfig>;
  enableToolValidation?: boolean;
  skipGenerationStats?: boolean;
  statsReconcileIntervalMs?: number;
  statsReconcileBatchSize?: number;
}

export interface ResolvedConfig {
  databasePath: string;
  isMemoryDb: boolean;
  artifactsDir: string;

  llmProvider: 'openai' | 'openrouter' | 'ollama';
  modelName: string;
  apiKey: string | undefined;
  ollamaBaseUrl: string;

  agentDefinitionsPath: string;

  workspaceRoot: string;

  logLevel: LogLevel;
  logDest: 'console' | 'file' | 'both';
  logDir: string;

  smtp: Readonly<{
    host: string | undefined;
    port: number;
    user: string | undefined;
    pass: string | undefined;
    from: string | undefined;
  }>;

  imap: Readonly<{
    host: string;
    port: number;
    user: string | undefined;
    pass: string | undefined;
  }>;

  staleExecutionMinutes: number;
  autoStartScheduler: boolean;
  policyEnforcement: PolicyEnforcement;
  policyMode: PolicyMode;
  policyRulePackId: string;
  policyRulePackVersion: string;
  policyThresholds: PolicyThresholdConfig;
  enableToolValidation: boolean;
  skipGenerationStats: boolean;
  statsReconcileIntervalMs: number;
  statsReconcileBatchSize: number;
}

/**
 * Validated and processed configuration after parsing
 */
export type ProcessedDesiAgentConfig = ResolvedConfig;

function envNumber(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') {
    return undefined;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function positiveInt(value: number | undefined, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  return fallback;
}

function nonNegativeInt(value: number | undefined, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  return fallback;
}

function positiveNumber(value: number | undefined, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }
  return fallback;
}

export function resolveConfig(validated: z.infer<typeof DesiAgentConfigSchema>): ResolvedConfig {
  const databasePath = validated.databasePath;
  const isMemoryDb = databasePath === ':memory:';

  // Resolve API key based on the active provider
  let apiKey: string | undefined;
  switch (validated.llmProvider) {
    case 'openai':
      apiKey = validated.openaiApiKey;
      break;
    case 'openrouter':
      apiKey = validated.openrouterApiKey;
      break;
    case 'ollama':
      apiKey = undefined;
      break;
  }

  const artifactsDir = validated.artifactsDir
    ?? (isMemoryDb
      ? resolve(homedir(), '.desiAgent', 'artifacts')
      : resolve(dirname(databasePath), 'artifacts'));

  const logDest = (() => {
    const dest = process.env.LOG_DEST?.toLowerCase();
    if (dest === 'file' || dest === 'both') return dest;
    return 'console' as const;
  })();

  const logDir = process.env.LOG_DIR || join(homedir(), '.desiAgent', 'logs');

  const statsReconcileIntervalMs = parseInt(
    process.env.STATS_RECONCILE_INTERVAL_MS || String(validated.statsReconcileIntervalMs),
    10
  );
  const statsReconcileBatchSize = parseInt(
    process.env.STATS_RECONCILE_BATCH_SIZE || String(validated.statsReconcileBatchSize),
    10
  );

  const requestedPolicyThresholds = validated.policyThresholds || {};
  const softTokenBudget = positiveInt(
    envNumber('POLICY_SOFT_TOKEN_BUDGET') ?? requestedPolicyThresholds.softTokenBudget,
    DEFAULT_POLICY_THRESHOLDS.softTokenBudget,
  );
  const hardTokenBudget = Math.max(
    softTokenBudget,
    positiveInt(
      envNumber('POLICY_HARD_TOKEN_BUDGET') ?? requestedPolicyThresholds.hardTokenBudget,
      DEFAULT_POLICY_THRESHOLDS.hardTokenBudget,
    ),
  );
  const softCostBudgetUsd = Number(
    positiveNumber(
      envNumber('POLICY_SOFT_COST_BUDGET_USD') ?? requestedPolicyThresholds.softCostBudgetUsd,
      DEFAULT_POLICY_THRESHOLDS.softCostBudgetUsd,
    ).toFixed(4),
  );
  const hardCostBudgetUsd = Number(
    Math.max(
      softCostBudgetUsd,
      positiveNumber(
        envNumber('POLICY_HARD_COST_BUDGET_USD') ?? requestedPolicyThresholds.hardCostBudgetUsd,
        DEFAULT_POLICY_THRESHOLDS.hardCostBudgetUsd,
      ),
    ).toFixed(4),
  );

  const policyThresholds: PolicyThresholdConfig = {
    softTokenBudget,
    hardTokenBudget,
    softCostBudgetUsd,
    hardCostBudgetUsd,
    sideEffectDenseTaskCount: positiveInt(
      envNumber('POLICY_SIDE_EFFECT_DENSE_TASK_COUNT') ?? requestedPolicyThresholds.sideEffectDenseTaskCount,
      DEFAULT_POLICY_THRESHOLDS.sideEffectDenseTaskCount,
    ),
    parallelSideEffectsViolationThreshold: nonNegativeInt(
      envNumber('POLICY_PARALLEL_SIDE_EFFECTS_VIOLATION_THRESHOLD')
      ?? requestedPolicyThresholds.parallelSideEffectsViolationThreshold,
      DEFAULT_POLICY_THRESHOLDS.parallelSideEffectsViolationThreshold,
    ),
    sideEffectParallelismCap: positiveInt(
      envNumber('POLICY_SIDE_EFFECT_PARALLELISM_CAP') ?? requestedPolicyThresholds.sideEffectParallelismCap,
      DEFAULT_POLICY_THRESHOLDS.sideEffectParallelismCap,
    ),
    directiveBudgetHeadroomMultiplier: positiveNumber(
      envNumber('POLICY_DIRECTIVE_BUDGET_HEADROOM_MULTIPLIER')
      ?? requestedPolicyThresholds.directiveBudgetHeadroomMultiplier,
      DEFAULT_POLICY_THRESHOLDS.directiveBudgetHeadroomMultiplier,
    ),
  };

  const modeFromEnv = process.env.POLICY_MODE?.toLowerCase();
  const policyMode: PolicyMode = modeFromEnv === 'strict' || modeFromEnv === 'lenient'
    ? modeFromEnv
    : validated.policyMode;
  const policyRulePackId = process.env.POLICY_RULE_PACK_ID?.trim() || validated.policyRulePackId;
  const policyRulePackVersion = process.env.POLICY_RULE_PACK_VERSION?.trim() || validated.policyRulePackVersion;

  return Object.freeze({
    databasePath,
    isMemoryDb,
    artifactsDir,

    llmProvider: validated.llmProvider,
    modelName: validated.modelName,
    apiKey,
    ollamaBaseUrl: validated.ollamaBaseUrl || 'http://localhost:11434',

    agentDefinitionsPath: validated.agentDefinitionsPath,

    workspaceRoot: validated.workspaceRoot,

    logLevel: validated.logLevel as LogLevel,
    logDest,
    logDir,

    smtp: Object.freeze({
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT, 10) : 587,
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
      from: process.env.SMTP_FROM,
    }),

    imap: Object.freeze({
      host: process.env.IMAP_HOST || 'imap.gmail.com',
      port: process.env.IMAP_PORT ? parseInt(process.env.IMAP_PORT, 10) : 993,
      user: process.env.IMAP_USER || process.env.SMTP_USER,
      pass: process.env.IMAP_PASS || process.env.SMTP_PASS,
    }),

    staleExecutionMinutes: parseInt(process.env.STALE_EXECUTION_MINUTES || '5', 10),
    autoStartScheduler: validated.autoStartScheduler,
    policyEnforcement: validated.policyEnforcement,
    policyMode,
    policyRulePackId,
    policyRulePackVersion,
    policyThresholds: Object.freeze(policyThresholds),
    enableToolValidation: validated.enableToolValidation,
    skipGenerationStats: validated.skipGenerationStats,
    statsReconcileIntervalMs: Number.isFinite(statsReconcileIntervalMs) && statsReconcileIntervalMs > 0
      ? statsReconcileIntervalMs
      : validated.statsReconcileIntervalMs,
    statsReconcileBatchSize: Number.isFinite(statsReconcileBatchSize) && statsReconcileBatchSize > 0
      ? statsReconcileBatchSize
      : validated.statsReconcileBatchSize,
  });
}
