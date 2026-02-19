/**
 * desiAgent - Library-first async agent system
 *
 * Main entry point for the desiAgent library.
 * Exports the setupDesiAgent function and all public types.
 */

import type { DesiAgentConfig } from './types/config.js';
import { DesiAgentConfigSchema, resolveConfig } from './types/config.js';
import { z } from 'zod';
import packageJson from '../package.json' with { type: 'json' };
import type { DesiAgentClient } from './types/index.js';
import {
  ConfigurationError,
  InitializationError,
} from './errors/index.js';
import { initializeLogger, getLogger } from './util/logger.js';
import { getDatabase, closeDatabase } from './db/client.js';
import { seedAgents } from './services/initDB.js';
import { Database } from 'bun:sqlite';
import { AgentsService } from './core/execution/agents.js';
import { DAGsService } from './core/execution/dags.js';
import { ExecutionsService } from './core/execution/executions.js';
import { ToolsService } from './core/execution/tools.js';
import { ArtifactsService } from './core/execution/artifacts.js';
import { CostsService } from './core/execution/costs.js';
import { createToolRegistry, ToolExecutor } from './core/tools/index.js';
import { createLLMProvider, validateLLMSetup } from './core/providers/factory.js';

/**
 * DesiAgent client implementation
 */
class DesiAgentClientImpl implements DesiAgentClient {
  agents: AgentsService;
  dags: DAGsService;
  executions: ExecutionsService;
  tools: ToolsService;
  artifacts: ArtifactsService;
  costs: CostsService;
  version: string = packageJson.version;
  private logger = getLogger();
  private isMemoryDb: boolean;

  constructor(
    agents: AgentsService,
    dags: DAGsService,
    executions: ExecutionsService,
    tools: ToolsService,
    artifacts: ArtifactsService,
    costs: CostsService,
    isMemoryDb: boolean = false
  ) {
    this.agents = agents;
    this.dags = dags;
    this.executions = executions;
    this.tools = tools;
    this.artifacts = artifacts;
    this.costs = costs;
    this.isMemoryDb = isMemoryDb;
  }

  async executeTask(_agent: any, _task: string, _files?: Buffer[]): Promise<any> {
    // TODO: Phase 2+ - Implement task execution with agent orchestration
    throw new Error('Task execution not yet implemented');
  }

  async shutdown(): Promise<void> {
    if (this.isMemoryDb) {
      this.logger.warn('Shutting down in-memory database — all data will be lost');
    }
    this.logger.info('Shutting down desiAgent');
    closeDatabase();
  }
}

/**
 * Setup and initialize a desiAgent client
 *
 * @param config - Configuration object for desiAgent
 * @returns Initialized DesiAgentClient
 *
 * @example
 * ```typescript
 * import { setupDesiAgent } from 'desiagent';
 *
 * const client = await setupDesiAgent({
 *   llmProvider: 'openai',
 *   openaiApiKey: process.env.OPENAI_API_KEY,
 *   modelName: 'gpt-4o',
 * });
 *
 * // Use DAGs for task decomposition and execution
 * const result = await client.dags.createFromGoal({
 *   goalText: 'Analyze this document',
 *   agentName: 'analyst',
 * });
 *
 * await client.shutdown();
 * ```
 */
export async function setupDesiAgent(config: DesiAgentConfig): Promise<DesiAgentClient> {
  try {
    // Validate configuration via Zod
    const validated = validateConfig(config);

    // Resolve all defaults into a frozen ResolvedConfig
    const resolved = resolveConfig(validated);

    // Initialize logger with resolved values
    initializeLogger(resolved.logLevel, resolved.logDest, resolved.logDir);
    const logger = getLogger();

    logger.info(`desiAgent version ${packageJson.version}`);
   
    logger.info( {
      provider: resolved.llmProvider,
      model: resolved.modelName,
      logLevel: resolved.logLevel,
    },'Initializing desiAgent');

    // Initialize database
    const db = getDatabase(resolved.databasePath, resolved.isMemoryDb);
    logger.info('Database initialized');

    // Seed agents for in-memory databases
    if (resolved.isMemoryDb) {
      const sqlite = (db as any).$client as Database;
      const seeded = seedAgents(sqlite);
      logger.info({ agentsSeeded: seeded }, 'In-memory database seeded');
    }

    logger.debug({ artifactsDir: resolved.artifactsDir }, 'Artifacts directory configured');

    // Initialize services
    const agentsService = new AgentsService(db);
    const executionsService = new ExecutionsService(db);

    // Initialize tool registry
    const toolRegistry = createToolRegistry();
    const toolsService = new ToolsService(toolRegistry);
    const toolExecutor = new ToolExecutor(toolRegistry, resolved.artifactsDir, resolved.smtp, resolved.imap);

    // Initialize LLM provider
    const llmProvider = createLLMProvider({
      provider: resolved.llmProvider,
      apiKey: resolved.apiKey,
      baseUrl: resolved.ollamaBaseUrl,
      model: resolved.modelName,
      skipGenerationStats: resolved.skipGenerationStats,
    });
    await validateLLMSetup(llmProvider, resolved.modelName);

    // Initialize DAGs service
    const dagsService = new DAGsService({
      db,
      llmProvider,
      toolRegistry,
      agentsService,
      artifactsDir: resolved.artifactsDir,
      staleExecutionMinutes: resolved.staleExecutionMinutes,
      apiKey: resolved.apiKey,
      ollamaBaseUrl: resolved.ollamaBaseUrl,
      skipGenerationStats: resolved.skipGenerationStats,
    });

    // Initialize artifacts service
    const artifactsService = new ArtifactsService(resolved.artifactsDir);

    // Initialize costs service
    const costsService = new CostsService(db);

    // Create and return client
    const client = new DesiAgentClientImpl(
      agentsService,
      dagsService,
      executionsService,
      toolsService,
      artifactsService,
      costsService,
      resolved.isMemoryDb,
    );

    logger.info('desiAgent initialized successfully', {
      provider: llmProvider.name,
      model: resolved.modelName,
      tools: toolRegistry.getAllDefinitions().length,
    });

    // Store internal services on client
    (client as any)._toolExecutor = toolExecutor;
    (client as any)._llmProvider = llmProvider;
    (client as any)._resolved = resolved;

    return client;
  } catch (error) {
    if (error instanceof ConfigurationError) {
      throw error;
    }
    throw new InitializationError(
      `Failed to initialize desiAgent: ${error instanceof Error ? error.message : String(error)}`,
      'setupDesiAgent',
      error instanceof Error ? error : undefined
    );
  }
}

/**
 * Validate and process configuration
 */
function validateConfig(config: DesiAgentConfig): z.infer<typeof DesiAgentConfigSchema> {
  try {
    return DesiAgentConfigSchema.parse(config);
  } catch (error) {
    throw new ConfigurationError(
      `Invalid configuration: ${error instanceof Error ? error.message : String(error)}`,
      error instanceof Error ? error : undefined
    );
  }
}

// Export all public types and errors
export type { DesiAgentConfig, ProcessedDesiAgentConfig, ResolvedConfig } from './types/config.js';
export { DesiAgentConfigSchema, resolveConfig } from './types/config.js';
export type { DesiAgentClient } from './types/index.js';
export {
  ExecutionStatus,
  ExecutionEventType,
  type DAG,
  type DAGNode,
  type DAGEdge,
  type DAGExecution,
  type DAGExecutionWithSteps,
  type DagExecutionListResult,
  type DAGExecutionStatus,
  type SubStep,
  type SubStepStatus,
  type ExecutionEvent,
  type DAGFilter,
  type Agent,
  type AgentConstraints,
  type Tool,
  type ToolParameter,
  type ToolCall,
  type ToolResult,
  type AgentDefinition,
} from './types/index.js';

// DAG-specific types
export {
  DecomposerJobSchema,
  SubTaskSchema,
  type DecomposerJob,
  type SubTask,
} from './types/dag.js';

// DAG service types
export type {
  CreateDAGFromGoalOptions,
  DAGPlanningResult,
  ClarificationRequiredResult,
  DAGCreatedResult,
  ValidationErrorResult,
  ExecuteOptions,
  RunExperimentsInput,
  DagScheduler,
  DAGsServiceDeps,
} from './core/execution/dags.js';

// Costs service types
export type {
  UsageInfo,
  PlanningUsageTotal,
  PlanningAttempt,
  SubStepCost,
  SynthesisCost,
  ExecutionCostBreakdown,
  ExecutionSummary,
  DagCostBreakdown,
  CostSummaryEntry,
  CostSummaryResult,
  CostSummaryOptions,
} from './core/execution/costs.js';

// Service classes (for advanced use cases)
export { DAGsService } from './core/execution/dags.js';
export { ExecutionsService } from './core/execution/executions.js';
export { CostsService } from './core/execution/costs.js';
export { AgentsService } from './core/execution/agents.js';
export { ToolsService } from './core/execution/tools.js';
export { ArtifactsService } from './core/execution/artifacts.js';

// Custom inference
export {
  customInference,
  CustomInferenceInputSchema,
  type CustomInferenceInput,
  type CustomInferenceOutput,
  type InferenceContext,
} from './core/execution/inference.js';

// Utility exports
export { validateCronExpression } from './util/cron-validator.js';
export {
  extractCodeBlock,
  extractJsonCodeBlock,
  renumberSubTasks,
  truncate,
  truncateForLog,
  parseDate,
  formatDateByGroup,
} from './util/dag-utils.js';

export {
  DesiAgentError,
  ConfigurationError,
  NotFoundError,
  ValidationError,
  ExecutionError,
  DatabaseError,
  LLMProviderError,
  ToolError,
  TimeoutError,
  InitializationError,
} from './errors/index.js';

// Email tool
export {
  sendEmailTool,
  SendEmailInputSchema,
  type SendEmailInput,
  type SendEmailOutput,
} from './util/sendEmailTool.js';

// Database initialization
export { initDB, seedAgents, type InitDBOptions, type InitDBResult } from './services/initDB.js';
