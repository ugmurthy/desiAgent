/**
 * desiAgent - Library-first async agent system
 *
 * Main entry point for the desiAgent library.
 * Exports the setupDesiAgent function and all public types.
 */

import type { DesiAgentConfig, ProcessedDesiAgentConfig } from './types/config.js';
import { DesiAgentConfigSchema } from './types/config.js';
import packageJson from '../package.json' with { type: 'json' };
import type { DesiAgentClient } from './types/index.js';
import {
  ConfigurationError,
  InitializationError,
} from './errors/index.js';
import { initializeLogger, getLogger } from './util/logger.js';
import { getDatabase, closeDatabase } from './db/client.js';
import { dirname, resolve } from 'path';
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

  constructor(
    agents: AgentsService,
    dags: DAGsService,
    executions: ExecutionsService,
    tools: ToolsService,
    artifacts: ArtifactsService,
    costs: CostsService
  ) {
    this.agents = agents;
    this.dags = dags;
    this.executions = executions;
    this.tools = tools;
    this.artifacts = artifacts;
    this.costs = costs;
  }

  async executeTask(_agent: any, _task: string, _files?: Buffer[]): Promise<any> {
    // TODO: Phase 2+ - Implement task execution with agent orchestration
    throw new Error('Task execution not yet implemented');
  }

  async shutdown(): Promise<void> {
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
    // Validate and process configuration
    const validatedConfig = validateConfig(config);

    // Initialize logger
    initializeLogger(validatedConfig.logLevel);
    const logger = getLogger();

    logger.info(`desiAgent version ${packageJson.version}`);
   
    logger.info( {
      provider: validatedConfig.llmProvider,
      model: validatedConfig.modelName,
      logLevel: validatedConfig.logLevel,
    },'Initializing desiAgent');

    // Initialize database
    const db = getDatabase(validatedConfig.databasePath);
    logger.info('Database initialized');

    // Compute artifacts directory from config or database path
    const artifactsDir = validatedConfig.artifactsDir 
      || resolve(dirname(validatedConfig.databasePath), 'artifacts');
    logger.debug({ artifactsDir }, 'Artifacts directory configured');

    // Initialize services
    const agentsService = new AgentsService(db);
    const executionsService = new ExecutionsService(db);

    // Initialize tool registry
    const toolRegistry = createToolRegistry();
    const toolsService = new ToolsService(toolRegistry);
    const toolExecutor = new ToolExecutor(toolRegistry, artifactsDir);

    // Initialize LLM provider
    const llmProviderConfig = {
      provider: validatedConfig.llmProvider as 'openai' | 'openrouter' | 'ollama',
      apiKey: validatedConfig.llmProvider === 'openrouter' 
        ? validatedConfig.openrouterApiKey 
        : validatedConfig.openaiApiKey,
      baseUrl: validatedConfig.ollamaBaseUrl,
      model: validatedConfig.modelName,
    };

    const llmProvider = createLLMProvider(llmProviderConfig);
    await validateLLMSetup(llmProvider, validatedConfig.modelName);

    // Initialize DAGs service (requires llmProvider, toolRegistry, agentsService)
    const dagsService = new DAGsService({
      db,
      llmProvider,
      toolRegistry,
      agentsService,
      artifactsDir,
    });

    // Initialize artifacts service
    const artifactsService = new ArtifactsService(artifactsDir);

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
    );

    logger.info('desiAgent initialized successfully', {
      provider: llmProvider.name,
      model: validatedConfig.modelName,
      tools: toolRegistry.getAllDefinitions().length,
    });

    // Store internal services on client
    (client as any)._toolExecutor = toolExecutor;
    (client as any)._llmProvider = llmProvider;

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
function validateConfig(config: DesiAgentConfig): ProcessedDesiAgentConfig {
  try {
    return DesiAgentConfigSchema.parse(config) as ProcessedDesiAgentConfig;
  } catch (error) {
    throw new ConfigurationError(
      `Invalid configuration: ${error instanceof Error ? error.message : String(error)}`,
      error instanceof Error ? error : undefined
    );
  }
}

// Export all public types and errors
export type { DesiAgentConfig, ProcessedDesiAgentConfig } from './types/config.js';
export { DesiAgentConfigSchema } from './types/config.js';
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
  UnpersistedResult,
  ExecuteOptions,
  ExecuteDefinitionOptions,
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

// Database initialization
export { initDB, type InitDBOptions, type InitDBResult } from './services/initDB.js';
