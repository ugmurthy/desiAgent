import { z } from 'zod';

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
    const home = process.env.HOME || process.env.USERPROFILE || '~';
    return `${home}/.desiAgent/data/agent.db`;
  }),

  // Artifacts directory (defaults to sibling of database file)
  artifactsDir: z.string().optional(),

  // LLM Provider
  llmProvider: z.enum(['openai', 'openrouter', 'ollama']),
  openaiApiKey: z.string().optional(),
  openrouterApiKey: z.string().optional(),
  ollamaBaseUrl: z.string().optional(),
  modelName: z.string(),

  // Agent definitions
  agentDefinitionsPath: z.string().optional().default(() => {
    const home = process.env.HOME || process.env.USERPROFILE || '~';
    return `${home}/.desiAgent/agents`;
  }),

  // Logging
  logLevel: z.enum(['debug', 'info', 'warn', 'error', 'silent']).optional().default('info'),

  // Lifecycle callbacks
  onExecutionStart: z.function().optional(),
  onExecutionEnd: z.function().optional(),

  // Feature flags
  autoStartScheduler: z.boolean().optional().default(true),
  enableToolValidation: z.boolean().optional().default(true),
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
}

/**
 * Validated and processed configuration after parsing
 */
export interface ProcessedDesiAgentConfig extends DesiAgentConfig {
  databasePath: string;
  artifactsDir: string;
  agentDefinitionsPath: string;
  logLevel: LogLevel;
  autoStartScheduler: boolean;
  enableToolValidation: boolean;
}
