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
import type { DesiAgentClient, Agent } from './types/index.js';
import {
  ConfigurationError,
  InitializationError,
} from './errors/index.js';
import { initializeLogger, getLogger } from './util/logger.js';
import { getDatabase, closeDatabase } from './db/client.js';
import { seedAgents } from './services/initDB.js';
import { AgentsService } from './core/execution/agents.js';
import { DAGsService } from './core/execution/dags.js';
import { ExecutionsService } from './core/execution/executions.js';
import { ToolsService } from './core/execution/tools.js';
import { SkillsService } from './core/execution/skills.js';
import { ArtifactsService } from './core/execution/artifacts.js';
import { CostsService } from './core/execution/costs.js';
import { createToolRegistry, ToolExecutor } from './core/tools/index.js';
import { createLLMProvider, validateLLMSetup } from './core/providers/factory.js';
import type { Message, ImageContentPart, TextContentPart, MessageContent, LLMProvider as LLMProviderInterface } from './core/providers/types.js';
import type { ResolvedConfig } from './types/config.js';
import { SkillRegistry } from './core/skills/registry.js';
import { StatsQueue } from './core/workers/statsQueue.js';
import { NodeCronDagScheduler } from './core/execution/dagScheduler.js';

function detectImageMime(buf: Buffer): string | null {
  if (buf[0] === 0xFF && buf[1] === 0xD8) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return 'image/png';
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'image/gif';
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return 'image/webp';
  return null;
}

/**
 * DesiAgent client implementation
 */
class DesiAgentClientImpl implements DesiAgentClient {
  agents: AgentsService;
  dags: DAGsService;
  executions: ExecutionsService;
  tools: ToolsService;
  skills: SkillsService;
  artifacts: ArtifactsService;
  costs: CostsService;
  version: string = packageJson.version;
  private logger = getLogger();
  private isMemoryDb: boolean;
  private statsQueue?: StatsQueue;
  private dagScheduler?: NodeCronDagScheduler;
  //private _llmProvider!: LLMProviderInterface;
  private _resolved!: ResolvedConfig;

  constructor(
    agents: AgentsService,
    dags: DAGsService,
    executions: ExecutionsService,
    tools: ToolsService,
    skills: SkillsService,
    artifacts: ArtifactsService,
    costs: CostsService,
    isMemoryDb: boolean = false,
    statsQueue?: StatsQueue,
    dagScheduler?: NodeCronDagScheduler,
  ) {
    this.agents = agents;
    this.dags = dags;
    this.executions = executions;
    this.tools = tools;
    this.skills = skills;
    this.artifacts = artifacts;
    this.costs = costs;
    this.isMemoryDb = isMemoryDb;
    this.statsQueue = statsQueue;
    this.dagScheduler = dagScheduler;
  }

  async executeTask(agent: Agent, task: string, files?: Buffer[]): Promise<any> {
    const provider = agent.provider || this._resolved.llmProvider;
    const model = agent.model || this._resolved.modelName;
    const temperature = agent.constraints?.temperature ?? 0.7;
    const maxTokens = agent.constraints?.maxTokens;

    this.logger.info({
      agentName: agent.name,
      provider,
      model,
    }, 'Executing task');

    const llmProvider = createLLMProvider({
      provider,
      model,
      apiKey: this._resolved.apiKey,
      baseUrl: this._resolved.ollamaBaseUrl,
      skipGenerationStats: this._resolved.skipGenerationStats,
    });

    let userContent: MessageContent = task;

    if (files && files.length > 0) {
      const contentParts: (TextContentPart | ImageContentPart)[] = [
        { type: 'text', text: task },
      ];
      for (const buf of files) {
        const mimeType = detectImageMime(buf) || 'image/jpeg';
        const dataUrl = `data:${mimeType};base64,${buf.toString('base64')}`;
        contentParts.push({
          type: 'image_url',
          image_url: { url: dataUrl, detail: 'auto' },
        });
      }
      userContent = contentParts;
      this.logger.info({ fileCount: files.length }, 'Attached files to task message');
    }

    const messages: Message[] = [
      { role: 'system', content: agent.systemPrompt },
      { role: 'user', content: userContent },
    ];

    const response = await llmProvider.chat({
      messages,
      temperature,
      maxTokens,
    });

    this.logger.info({ agentName: agent.name }, 'Task execution completed');

    return {
      agentName: agent.name,
      agentVersion: agent.version,
      provider,
      model,
      response: response.content,
      usage: response.usage,
      costUsd: response.costUsd,
      finishReason: 'stop',
    };
  }

  async shutdown(): Promise<void> {
    if (this.isMemoryDb) {
      this.logger.warn('Shutting down in-memory database — all data will be lost');
    }
    this.dagScheduler?.stopAll();
    await this.statsQueue?.terminate();
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
      const sqlite = (db as any).$client as any;
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

    // Initialize SkillRegistry and discover skills
    const skillRegistry = new SkillRegistry(resolved.workspaceRoot);
    await skillRegistry.discover();
    const allSkills = skillRegistry.getAll();
    const skillNames = allSkills.map(s => s.name);
    logger.info({ skillCount: allSkills.length, skillNames }, 'Skills discovered');

    // Initialize skills service
    const skillsService = new SkillsService({
      skillRegistry,
      defaultProvider: resolved.llmProvider,
      defaultModel: resolved.modelName,
      artifactsDir: resolved.artifactsDir,
      apiKey: resolved.apiKey,
      ollamaBaseUrl: resolved.ollamaBaseUrl,
      skipGenerationStats: resolved.skipGenerationStats,
    });

    // Initialize background stats worker for OpenRouter
    let statsQueue: StatsQueue | undefined;
    if (resolved.llmProvider === 'openrouter' && !resolved.skipGenerationStats && resolved.apiKey) {
      statsQueue = new StatsQueue(resolved.databasePath, resolved.apiKey, {
        reconcileIntervalMs: resolved.statsReconcileIntervalMs,
        reconcileBatchSize: resolved.statsReconcileBatchSize,
      });
      statsQueue.start();
      logger.info('Background stats worker started for OpenRouter');
    }

    // Initialize DAG scheduler and DAGs service
    let dagsService!: DAGsService;
    const dagScheduler = resolved.autoStartScheduler
      ? new NodeCronDagScheduler({
        db,
        executeDAG: async (dagId: string) => dagsService.execute(dagId),
      })
      : undefined;

    dagsService = new DAGsService({
      db,
      llmProvider,
      toolRegistry,
      agentsService,
      scheduler: dagScheduler,
      artifactsDir: resolved.artifactsDir,
      staleExecutionMinutes: resolved.staleExecutionMinutes,
      apiKey: resolved.apiKey,
      ollamaBaseUrl: resolved.ollamaBaseUrl,
      skipGenerationStats: resolved.skipGenerationStats,
      skillRegistry,
      statsQueue,
    });

    if (dagScheduler) {
      await dagScheduler.hydrateFromDatabase();
      logger.info('DAG scheduler started');
    } else {
      logger.info('DAG scheduler disabled by configuration');
    }

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
      skillsService,
      artifactsService,
      costsService,
      resolved.isMemoryDb,
      statsQueue,
      dagScheduler,
    );

    logger.info('desiAgent initialized successfully', {
      provider: llmProvider.name,
      model: resolved.modelName,
      tools: toolRegistry.getAllDefinitions().length,
    });

    // Store internal services on client
    (client as any)._toolExecutor = toolExecutor;
    client._llmProvider = llmProvider;
    client._resolved = resolved;

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
  type SkillTestableProvider,
  type SkillListOptions,
  type SkillTestInput,
  type SkillTestResult,
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
export { NodeCronDagScheduler } from './core/execution/dagScheduler.js';
export { AgentsService } from './core/execution/agents.js';
export { ToolsService } from './core/execution/tools.js';
export { SkillsService } from './core/execution/skills.js';
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

// Skills
export { SkillRegistry, type SkillMeta } from './core/skills/registry.js';
export { MinimalSkillDetector, type SkillDetector } from './core/skills/detector.js';

// Background stats worker
export { StatsQueue, type StatsJob } from './core/workers/statsQueue.js';

// Database initialization
export { initDB, seedAgents, type InitDBOptions, type InitDBResult } from './services/initDB.js';
