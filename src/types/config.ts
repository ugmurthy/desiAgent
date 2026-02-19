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

  // Feature flags
  autoStartScheduler: z.boolean().optional().default(true),
  enableToolValidation: z.boolean().optional().default(true),
  skipGenerationStats: z.boolean().optional().default(false),
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

  // Feature flags
  autoStartScheduler?: boolean;
  enableToolValidation?: boolean;
  skipGenerationStats?: boolean;
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
  enableToolValidation: boolean;
  skipGenerationStats: boolean;
}

/**
 * Validated and processed configuration after parsing
 */
export type ProcessedDesiAgentConfig = ResolvedConfig;

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

  return Object.freeze({
    databasePath,
    isMemoryDb,
    artifactsDir,

    llmProvider: validated.llmProvider,
    modelName: validated.modelName,
    apiKey,
    ollamaBaseUrl: validated.ollamaBaseUrl || 'http://localhost:11434',

    agentDefinitionsPath: validated.agentDefinitionsPath,

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
    enableToolValidation: validated.enableToolValidation,
    skipGenerationStats: validated.skipGenerationStats,
  });
}
