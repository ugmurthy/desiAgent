/**
 * DAG Executor
 *
 * Executes DAG (Directed Acyclic Graph) workflows by running tasks
 * in dependency order with parallel execution where possible.
 */

import { eq, and } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DrizzleDB } from '../../db/client.js';
import { dagExecutions, dagSubSteps, agents } from '../../db/schema.js';
import type { LLMProvider } from '../providers/types.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { ToolContext } from '../tools/base.js';
import { LlmExecuteTool } from '../tools/llmExecute.js';
import { ExecutionsService } from './executions.js';
import { ExecutionEventType } from '../../types/execution.js';
import { getLogger } from '../../util/logger.js';
import type { SkillRegistry } from '../skills/registry.js';
import type { ResolvedConfig } from '../../types/config.js';
import type { StatsQueue } from '../workers/statsQueue.js';
import { buildGlobalContext as buildGlobalContextShared, buildInferencePrompt as buildInferencePromptShared } from './contextBuilder.js';
import { deriveExecutionStatus as deriveExecutionStatusShared, aggregateUsage as aggregateUsageShared, aggregateCost as aggregateCostShared } from './executionAggregates.js';
import { ExecutionPlanCompiler } from './planCompiler.js';


export interface SubTask {
  id: string;
  description: string;
  thought: string;
  action_type: 'tool' | 'inference' | 'skill';
  tool_or_prompt: {
    name: string;
    params?: Record<string, any>;
  };
  expected_output: string;
  dependencies: string[];
}

export interface DecomposerJob {
  original_request: string;
  title?: string;
  intent: {
    primary: string;
    sub_intents: string[];
  };
  entities: Array<{
    entity: string;
    type: string;
    grounded_value: string;
  }>;
  sub_tasks: SubTask[];
  synthesis_plan: string;
  validation: {
    coverage: string;
    gaps: string[];
    iteration_triggers: string[];
  };
  clarification_needed: boolean;
  clarification_query?: string;
}

export interface DAGExecutorConfig {
  db: DrizzleDB;
  llmProvider: LLMProvider;
  toolRegistry: ToolRegistry;
  artifactsDir: string;
  smtp?: ResolvedConfig['smtp'];
  imap?: ResolvedConfig['imap'];
  apiKey?: string;
  ollamaBaseUrl?: string;
  skipGenerationStats?: boolean;
  skillRegistry?: SkillRegistry;
  statsQueue?: StatsQueue;
}

/**
 * Execution configuration for performance tuning
 */
export interface ExecutionConfig {
  /**
   * Skip event emission for maximum speed when streaming not needed.
   * Default: false (events enabled)
   */
  skipEvents?: boolean;
  /**
   * Batch DB updates per wave instead of per-task.
   * Default: true
   */
  batchDbUpdates?: boolean;
  /**
   * Optional abort signal to cancel in-flight tool/LLM calls.
   */
  abortSignal?: AbortSignal;
  /**
   * Maximum number of tasks to execute concurrently.
   * Default: 5
   */
  maxParallelism?: number;
}

/**
 * Pre-fetched agent data for inference tasks
 */
interface AgentData {
  name: string;
  provider: 'openai' | 'openrouter' | 'ollama';
  model: string;
  promptTemplate: string;
}

export interface GlobalContext {
  formatted: string;
  totalTasks: number;
}

export interface TaskExecutionResult {
  content: any;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  costUsd?: number;
  generationStats?: Record<string, any>;
  generationId?: string;
}

function generateSubStepId(): string {
  return `substep_${nanoid(21)}`;
}

function chunkTasks<T>(tasks: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < tasks.length; i += chunkSize) {
    chunks.push(tasks.slice(i, i + chunkSize));
  }
  return chunks;
}

export class DAGExecutor {
  private db: DrizzleDB;
  private llmProvider: LLMProvider;
  private toolRegistry: ToolRegistry;
  private artifactsDir: string;
  private smtp?: ResolvedConfig['smtp'];
  private imap?: ResolvedConfig['imap'];
  private apiKey?: string;
  private ollamaBaseUrl?: string;
  private skipGenerationStats?: boolean;
  private skillRegistry?: SkillRegistry;
  private logger = getLogger();

  constructor(config: DAGExecutorConfig) {
    this.db = config.db;
    this.llmProvider = config.llmProvider;
    this.toolRegistry = config.toolRegistry;
    this.artifactsDir = config.artifactsDir;
    this.smtp = config.smtp;
    this.imap = config.imap;
    this.apiKey = config.apiKey;
    this.ollamaBaseUrl = config.ollamaBaseUrl;
    this.skipGenerationStats = config.skipGenerationStats;
    this.skillRegistry = config.skillRegistry;

    this.logger.debug({
      provider: this.llmProvider.name,
    }, 'DAGExecutor created');
  }

  private extractUrls(text: string): string[] {
    const urlRegex = /(https?:\/\/)?(?:www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_\+.~#?&//=]*)/gi;
    const matches = text.match(urlRegex) || [];
    
    return matches.map(url => {
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        return 'https://' + url;
      }
      return url;
    }).filter(url => url.length > 0);
  }

  private buildGlobalContext(job: DecomposerJob): GlobalContext {
    return buildGlobalContextShared(job);
  }

  private buildInferencePrompt(
    task: SubTask,
    globalContext: GlobalContext,
    taskResults: Map<string, any>
  ): string {
    return buildInferencePromptShared(task, globalContext, taskResults);
  }

  private resolveInferenceAgentName(task: SubTask): string {
    const explicitAgentName = task.tool_or_prompt.params?.agentName;
    if (typeof explicitAgentName === 'string' && explicitAgentName.trim().length > 0) {
      return explicitAgentName.trim();
    }

    if (task.tool_or_prompt.name && task.tool_or_prompt.name !== 'inference') {
      return task.tool_or_prompt.name;
    }

    return 'inference';
  }

  private resolveDependencies(
    task: Record<string, any>,
    taskResults: Map<string, any>
  ): { resolvedParams: Record<string, any>; singleDependency: any | null } {
    const params = task.tool_or_prompt.params || {};
    const resolvedParams = { ...params };
    let singleDependency: any = null;

    for (const [key, value] of Object.entries(resolvedParams)) {
      this.handleMultipleMatches(value, key, task, taskResults, resolvedParams);
    }

    return { resolvedParams, singleDependency };
  }

  private handleMultipleMatches(
    value: any,
    key: string,
    task: Record<string, any>,
    taskResults: Map<string, any>,
    resolvedParams: Record<string, any>
  ): void {
    const tool = task.tool_or_prompt.name;
    const DEPENDENCY_PATTERN = /<Results? (?:from|of) Task (\d+)>/g;
    const matches = [...String(value).matchAll(DEPENDENCY_PATTERN)];
    this.logger.info(`╰─dependency reference in: Task ${task.id} -tool: ${tool} key: ${key}`);
    if (tool === 'fetchURLs') {
      resolvedParams[key] = this.resolveFetchURLs(task, key, taskResults);
      
    } else if (tool === 'writeFile' && key === 'content') {
      resolvedParams[key] = this.resolveWriteFileContent(task, taskResults);
    } else if (tool === 'sendEmail' && key === 'attachments') {
      if (Array.isArray(resolvedParams[key]) && resolvedParams[key].length > 0) {
        resolvedParams[key][0]['content'] = this.resolveEmailContent(task, taskResults);
      }
    } else if (tool === 'sendEmail' && key === 'body') {
      resolvedParams[key] = this.resolveEmailContent(task, taskResults);
    } else if (tool === 'sendEmail' && (key === 'to' || key === 'subject' || key === 'cc' || key === 'bcc')) {
      // When a sendEmail param references a dependency whose result is a JSON string
      // containing email fields (to, subject, body, etc.), extract the specific field.
      resolvedParams[key] = this.resolveSendEmailField(key, value, matches, task, taskResults, resolvedParams);
    }
    
    else {
      resolvedParams[key] = this.resolveStringReplacements(value, matches, key, taskResults);
    }
  }

  private resolveEmailContent(
    task: Record<string, any>,
    taskResults: Map<string, any>
  ): string {
    const contentArray: string[] = [];
    
    for (const deps of task.dependencies) {

      let depResult = taskResults.get(deps);

      this.logger.info(`╰─resolveEmailContent for task ${task.id} dependent on task:${deps} `);
      this.logger.info(`  ╰─type of depResult - ${typeof depResult}}`);
      
      if (typeof depResult === 'string') {
        const lines = depResult.split('\n');
        
        // strip html bodies of back ticks
        if (lines.length > 1) {
          this.logger.info(`  ╰─ is String line 2:${lines[1]} `);
          if (lines[0].includes('```html')){
            depResult = lines.slice(1, -1).join('\n');
          }
        }
        // check if the string is a JSON object 
        try {
          const candidate = JSON.parse(depResult);
          if (typeof candidate === 'object' && candidate !== null) {
            
            if (candidate.body) {
              depResult = candidate.body;
              this.logger.info(`  ╰─ is JSON object - found 'body' `);
            }
            // strin html bodies of back ticks
            const lines = depResult.split('\n');
            if (lines.length > 1) {
                this.logger.info(`  ╰─ body- line 2:${lines[1]} `);
                if (lines[0].includes('```html')){
                  depResult = lines.slice(1, -1).join('\n');
            }
        }
            
          }
        } catch {
          // not JSON, ignore
        }
       

        contentArray.push(depResult);
      } else if (typeof depResult === 'object' && depResult?.content) {
        contentArray.push(depResult.content);
      }
    }

    return contentArray.join('\n');
  }

  private resolveSendEmailField(
    key: string,
    value: any,
    matches: RegExpMatchArray[],
    task: Record<string, any>,
    taskResults: Map<string, any>,
    resolvedParams: Record<string, any>
  ): any {
    // If there are no dependency references, keep original value
    

    // Try to extract the field from a dependency result that is a JSON object
    for (const depId of task.dependencies) {
      const depResult = taskResults.get(depId);
      if (depResult == null) continue;

      let parsed: Record<string, any> | null = null;
      if (typeof depResult === 'object' && depResult !== null) {
        parsed = depResult;
      } else if (typeof depResult === 'string') {
        try {
          const candidate = JSON.parse(depResult);
          if (typeof candidate === 'object' && candidate !== null) {
            parsed = candidate;
          }
        } catch {
          // not JSON, ignore
        }
      }

      if (parsed && key in parsed) {
        this.logger.info(`╰─resolveSendEmailField: extracted '${key}' from dependency Task ${depId}`);
        //this.logger.info(`╰─sendEmail: extracted '${key}' from dependency Task ${depId}`);
        // Also backfill body/subject if present and not yet resolved
        for (const autoKey of ['to', 'subject', 'body', 'cc', 'bcc'] as const) {
          if (autoKey in parsed && !(autoKey in resolvedParams && resolvedParams[autoKey] !== value)) {
            resolvedParams[autoKey] = parsed[autoKey];
          }
        }
        return parsed[key];
      }
    }

    // Fallback to normal string replacement
    return this.resolveStringReplacements(value, matches, key, taskResults);
  }

  private resolveWriteFileContent(
    task: Record<string, any>,
    taskResults: Map<string, any>
  ): string {
    const contentArray: string[] = [];
    
    for (const deps of task.dependencies) {
      const depResult = taskResults.get(deps);
      
      if (typeof depResult === 'string') {
        this.logger.debug(`╰─dependency reference in: Task ${deps} - content`);
        contentArray.push(depResult);
      } else if (typeof depResult === 'object' && depResult?.content) {
        contentArray.push(depResult.content);
        this.logger.debug(`╰─dependency reference in: Task ${deps} - content`);
      }
    }

    return contentArray.join('\n');
  }

  private resolveFetchURLs(
    task: Record<string, any>,
    key: string,
    taskResults: Map<string, any>
  ): string[] {
    const urlArray: string[] = [];

    for (const deps of task.dependencies) {
      const depResult = taskResults.get(deps);
      
      const urls = Array.isArray(depResult)
        ? depResult.map((obj) => obj.url).filter(Boolean)
        : typeof depResult === 'string'
        ? this.extractUrls(depResult)
        : [];

      if (urls.length) {
        urlArray.push(...urls);
      }

      this.logger.debug(`╰─dependency reference in '${key}': Task ${deps} result has - ${urls.length} URLs`);
    }
    this.logger.debug(`╰─Total URLs resolved for ${key}: ${urlArray.length} sample ${urlArray[0]}`);
    return urlArray;
  }

  private resolveStringReplacements(
    value: any,
    matches: RegExpMatchArray[],
    key: string,
    taskResults: Map<string, any>
  ): any {
    if (typeof value !== 'string') {
      return value;
    }

    let resolvedValue = value;

    for (const match of matches) {
      const depTaskId = match[1];
      const depResult = taskResults.get(depTaskId);

      if (depResult !== undefined) {
        const replacementValue = typeof depResult === 'string' ? depResult : JSON.stringify(depResult);
        resolvedValue = resolvedValue.replace(match[0], replacementValue);
        this.logger.info(`╰─dependency reference in '${key}': Task ${depTaskId} - string replacements`);
      }
    }

    return resolvedValue;
  }

  /**
   * Pre-fetch all agents needed for inference tasks
   * Reduces DB queries during execution from O(n) to O(1) per agent
   */
  private async prefetchAgents(job: DecomposerJob): Promise<Map<string, AgentData>> {
    const agentNames = new Set<string>();
    
    for (const task of job.sub_tasks) {
      if (task.action_type === 'inference' || task.tool_or_prompt.name === 'inference') {
        agentNames.add(this.resolveInferenceAgentName(task));
      }
    }

    const agentMap = new Map<string, AgentData>();
    
    if (agentNames.size === 0) {
      return agentMap;
    }

    this.logger.debug({ agentNames: [...agentNames] }, 'Pre-fetching agents for inference tasks');

    const fetchPromises = [...agentNames].map(async (name) => {
      const agent = await this.db.query.agents.findFirst({
        where: eq(agents.name, name),
      });
      
      if (agent && agent.provider && agent.model) {
        agentMap.set(name, {
          name: agent.name,
          provider: agent.provider as 'openai' | 'openrouter' | 'ollama',
          model: agent.model,
          promptTemplate: agent.promptTemplate,
        });
      }
    });

    await Promise.all(fetchPromises);
    
    this.logger.debug({ cachedAgents: agentMap.size }, 'Agents pre-fetched');
    return agentMap;
  }

  /**
   * Conditionally emit event based on config
   */
  private emitEventIfEnabled(config: ExecutionConfig, event: Parameters<typeof ExecutionsService.emitEvent>[0]): void {
    if (!config.skipEvents) {
      ExecutionsService.emitEvent(event);
    }
  }

  async execute(
    job: DecomposerJob,
    executionId: string,
    dagId?: string,
    originalRequest?: string,
    config: ExecutionConfig = {}
  ): Promise<string> {
    const effectiveOriginalRequest = originalRequest || job.original_request;
    const execConfig: ExecutionConfig = {
      skipEvents: config.skipEvents ?? false,
      batchDbUpdates: config.batchDbUpdates ?? true,
      abortSignal: config.abortSignal,
      maxParallelism: Math.max(1, Math.min(config.maxParallelism ?? 5, 5)),
    };

    if (job.clarification_needed) {
      throw new Error(`Clarification needed: ${job.clarification_query}`);
    }

    const execId = executionId;
    const startTime = Date.now();

    this.logger.debug({
      executionId: execId,
      dagId,
      totalTasks: job.sub_tasks.length,
      primaryIntent: job.intent.primary,
      config: execConfig,
    }, 'Starting DAG execution');

    try {
      // Pre-fetch all agents needed for inference tasks
      const agentCache = await this.prefetchAgents(job);

      // Update execution status to running
      await this.db.update(dagExecutions)
        .set({ status: 'running', startedAt: new Date() })
        .where(eq(dagExecutions.id, execId));

      this.emitEventIfEnabled(execConfig, {
        type: ExecutionEventType.Started,
        executionId: execId,
        ts: Date.now(),
        data: {
          total: job.sub_tasks.length,
          request: effectiveOriginalRequest,
        },
      });

      const taskResults = new Map<string, any>();
      const executedTasks = new Set<string>();
      const globalContext = this.buildGlobalContext(job);
      const compiledPlan = ExecutionPlanCompiler.compile(job.sub_tasks);

      // Track task execution results for batch updates
      interface TaskWaveResult {
        taskId: string;
        startTime: number;
        result?: TaskExecutionResult;
        error?: string;
      }

      const executeTask = async (task: SubTask): Promise<TaskExecutionResult> => {
        const symbols: Record<string, string> = {
          writeFile: '📄',
          readFile: '📖',
          inference: '✨',
          webSearch: '🔎',
          fetchURLs: '🌐',
          readEmail: '📧',
          sendEmail: '✉️',
          default:'🛠️'
        };
        const displaySym = symbols[task.tool_or_prompt.name] || symbols['default'];
        this.logger.info(`${displaySym} Executing sub-task ${task.id} ${task.description.slice(0, 50)}...`);

        // Skip individual DB update if batching enabled - will batch at wave end
        if (!execConfig.batchDbUpdates) {
          await this.db.update(dagSubSteps)
            .set({ status: 'running', startedAt: new Date() })
            .where(and(
              eq(dagSubSteps.taskId, task.id),
              eq(dagSubSteps.executionId, execId)
            ));
        }

        this.emitEventIfEnabled(execConfig, {
          type: ExecutionEventType.TaskStarted,
          executionId: execId,
          ts: Date.now(),
          data: {
            taskId: task.id,
            type: task.action_type,
            tool: task.tool_or_prompt.name,
            description: task.description,
            thought: task.thought,
          },
        });

        const toolCtx: ToolContext = {
          logger: this.logger,
          db: this.db,
          runId: `dag-${Date.now()}`,
          abortSignal: execConfig.abortSignal,
          executionId: execId,
          subStepId: task.id,
          artifactsDir: this.artifactsDir,
          smtp: this.smtp,
          imap: this.imap,
          onEvent: (event: string, data?: any) => {
            this.emitEventIfEnabled(execConfig, {
              type: ExecutionEventType.TaskProgress,
              executionId: execId,
              ts: Date.now(),
              data: { taskId: task.id, message: `[${event}] ${JSON.stringify(data)}` },
            });
          },
          emitEvent: {
            progress: (message: string) => {
              this.emitEventIfEnabled(execConfig, {
                type: ExecutionEventType.TaskProgress,
                executionId: execId,
                ts: Date.now(),
                data: { taskId: task.id, message },
              });
            },
            completed: (message: string) => {
              this.emitEventIfEnabled(execConfig, {
                type: ExecutionEventType.TaskProgress,
                executionId: execId,
                ts: Date.now(),
                data: { taskId: task.id, message },
              });
            },
          },
        };

        if (task.action_type === 'tool' && task.tool_or_prompt.name !== 'inference') {
          const tool = this.toolRegistry.get(task.tool_or_prompt.name);
          if (!tool) {
            throw new Error(`Tool not found: ${task.tool_or_prompt.name}`);
          }

          const { resolvedParams } = this.resolveDependencies(task, taskResults);
          this.logger.debug (`Executing tool ${task.tool_or_prompt.name} with params: ${JSON.stringify(resolvedParams)} before validation`);
          const validatedInput = tool.inputSchema.parse(resolvedParams)
          const result = await tool.execute(validatedInput, toolCtx);
          return { content: result };
        } else if (task.action_type === 'inference' || task.tool_or_prompt.name === 'inference') {
          const fullPrompt = this.buildInferencePrompt(task, globalContext, taskResults);

          const agentName = this.resolveInferenceAgentName(task);
          
          // Use pre-fetched agent from cache instead of DB query
          const agent = agentCache.get(agentName);
          if (!agent) {
            throw new Error(`No agent found with name: ${agentName} (not in pre-fetch cache)`);
          }

          const llmExecuteTool = new LlmExecuteTool({ apiKey: this.apiKey, baseUrl: this.ollamaBaseUrl, skipGenerationStats: this.skipGenerationStats });

          const result = await llmExecuteTool.execute({
            provider: agent.provider,
            model: agent.model,
            task: agent.promptTemplate,
            prompt: fullPrompt,
          }, toolCtx);

          return {
            content: result.content,
            usage: result.usage,
            costUsd: result.costUsd,
            generationStats: result.generationStats,
            generationId: result.generationId,
          };
        } else if (task.action_type === 'skill') {
          const skillName = task.tool_or_prompt.name;

          if (!this.skillRegistry) {
            throw new Error(`Skill "${skillName}" requested but no SkillRegistry configured`);
          }

          const skillMeta = this.skillRegistry.getByName(skillName);
          if (!skillMeta) {
            throw new Error(`Skill not found: ${skillName}`);
          }

          if (skillMeta.type === 'executable') {
            const handlerPath = skillMeta.filePath.replace(/SKILL\.md$/, 'handler.ts');
            try {
              const mod = await import(`file://${handlerPath}`);
              const handler = mod.default || mod.handler;
              if (!handler) {
                throw new Error(`Skill "${skillName}" is not executable or missing handler`);
              }
              const handlerResult = await handler(task.tool_or_prompt.params || {});
              return { content: handlerResult };
            } catch (err) {
              if (err instanceof Error && err.message.includes('is not executable or missing handler')) {
                throw err;
              }
              throw new Error(`Skill "${skillName}" is not executable or missing handler`);
            }
          }

          // Context skill: load content and run via LlmExecuteTool
          const skillBody = await this.skillRegistry.loadContent(skillName);
          if (!skillBody) {
            throw new Error(`Skill not found: ${skillName}`);
          }

          const fullPrompt = this.buildInferencePrompt(task, globalContext, taskResults);

          // Resolve provider/model from skill frontmatter, falling back to inference agent
          let skillProvider: 'openai' | 'openrouter' | 'ollama' = 'openai';
          let skillModel = 'gpt-4o';

          if (skillMeta.provider && skillMeta.model) {
            skillProvider = skillMeta.provider as 'openai' | 'openrouter' | 'ollama';
            skillModel = skillMeta.model;
          } else {
            // Fall back to inference agent from cache
            const inferenceAgent = agentCache.get(task.tool_or_prompt.name) || agentCache.values().next().value;
            if (inferenceAgent) {
              skillProvider = inferenceAgent.provider;
              skillModel = inferenceAgent.model;
            }
          }

          const llmExecuteTool = new LlmExecuteTool({ apiKey: this.apiKey, baseUrl: this.ollamaBaseUrl, skipGenerationStats: this.skipGenerationStats });

          const result = await llmExecuteTool.execute({
            provider: skillProvider,
            model: skillModel,
            task: skillBody,
            prompt: fullPrompt,
          }, toolCtx);

          return {
            content: result.content,
            usage: result.usage,
            costUsd: result.costUsd,
            generationStats: result.generationStats,
          };
        }

        throw new Error(`Unknown action type: ${task.action_type}`);
      };

      // Execute tasks in dependency order with wave-based batching
      let waveNumber = 0;

      for (const readyTasksInWave of compiledPlan.waves) {
        waveNumber++;
        const readyTasks = readyTasksInWave.filter((task) => !executedTasks.has(task.id));

        if (readyTasks.length === 0) {
          continue;
        }

        const waveStartTime = Date.now();
        const taskBatches = chunkTasks(readyTasks, execConfig.maxParallelism ?? 5);

        this.emitEventIfEnabled(execConfig, {
          type: ExecutionEventType.WaveStarted,
          executionId: execId,
          ts: Date.now(),
          data: {
            wave: waveNumber,
            taskIds: readyTasks.map((task) => task.id),
            parallel: Math.min(readyTasks.length, execConfig.maxParallelism ?? 5),
          },
        });

        for (const taskBatch of taskBatches) {
          const batchResults: TaskWaveResult[] = [];

          if (execConfig.batchDbUpdates && taskBatch.length > 0) {
            const updatePromises = taskBatch.map((task) =>
              this.db.update(dagSubSteps)
                .set({ status: 'running', startedAt: new Date() })
                .where(and(
                  eq(dagSubSteps.taskId, task.id),
                  eq(dagSubSteps.executionId, execId)
                ))
            );
            await Promise.all(updatePromises);
            this.logger.debug({ batchSize: taskBatch.length }, 'Batch updated tasks to running');
          }

          const batchExecutionResults = await Promise.allSettled(
            taskBatch.map(async (task) => {
              const taskExecStartTime = Date.now();
              const waveResult: TaskWaveResult = { taskId: task.id, startTime: taskExecStartTime };
              batchResults.push(waveResult);

              try {
                const execResult = await executeTask(task);
                taskResults.set(task.id, execResult.content);
                executedTasks.add(task.id);
                waveResult.result = execResult;

                const serializedResult = typeof execResult.content === 'string'
                  ? execResult.content
                  : JSON.stringify(execResult.content);

                this.logger.debug({ taskId: task.id, result: serializedResult }, `╰─task ${task.id} result after executeTask():`);

                if (!execConfig.batchDbUpdates) {
                  const subStepUpdate: Record<string, any> = {
                    status: 'completed',
                    result: serializedResult,
                    completedAt: new Date(),
                    durationMs: Date.now() - taskExecStartTime,
                    usage: execResult.usage,
                    generationId: execResult.generationId,
                    costUsd: execResult.costUsd?.toString(),
                    generationStats: execResult.generationStats,
                  };

                  await this.db.update(dagSubSteps)
                    .set(subStepUpdate)
                    .where(and(
                      eq(dagSubSteps.taskId, task.id),
                      eq(dagSubSteps.executionId, execId)
                    ));
                }

                this.emitEventIfEnabled(execConfig, {
                  type: ExecutionEventType.TaskCompleted,
                  executionId: execId,
                  ts: Date.now(),
                  data: {
                    taskId: task.id,
                    durationMs: Date.now() - taskExecStartTime,
                  },
                });
              } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                this.logger.error({ err: errorMessage, taskId: task.id }, `Task ${task.id} failed`);
                waveResult.error = errorMessage;

                await this.db.update(dagSubSteps)
                  .set({
                    status: 'failed',
                    error: errorMessage,
                    completedAt: new Date(),
                    durationMs: Date.now() - taskExecStartTime,
                  })
                  .where(and(
                    eq(dagSubSteps.taskId, task.id),
                    eq(dagSubSteps.executionId, execId)
                  ));

                this.emitEventIfEnabled(execConfig, {
                  type: ExecutionEventType.TaskFailed,
                  executionId: execId,
                  ts: Date.now(),
                  data: {
                    taskId: task.id,
                    durationMs: Date.now() - taskExecStartTime,
                  },
                  error: {
                    message: errorMessage,
                  },
                });

                throw error;
              }
            })
          );

          if (execConfig.batchDbUpdates) {
            const completedResults = batchResults.filter((result) => result.result && !result.error);
            if (completedResults.length > 0) {
              const batchUpdatePromises = completedResults.map((result) => {
                const serializedResult = typeof result.result!.content === 'string'
                  ? result.result!.content
                  : JSON.stringify(result.result!.content);

                const batchUpdate: Record<string, any> = {
                  status: 'completed',
                  result: serializedResult,
                  completedAt: new Date(),
                  durationMs: Date.now() - result.startTime,
                  usage: result.result!.usage,
                  generationId: result.result!.generationId,
                  costUsd: result.result!.costUsd?.toString(),
                  generationStats: result.result!.generationStats,
                };

                return this.db.update(dagSubSteps)
                  .set(batchUpdate)
                  .where(and(
                    eq(dagSubSteps.taskId, result.taskId),
                    eq(dagSubSteps.executionId, execId)
                  ));
              });

              await Promise.all(batchUpdatePromises);
              this.logger.debug({
                batchSize: completedResults.length,
                waveDurationMs: Date.now() - waveStartTime,
              }, 'Batch updated completed tasks');
            }
          }

          const batchFailure = batchExecutionResults.find(
            (result): result is PromiseRejectedResult => result.status === 'rejected'
          );
          if (batchFailure) {
            throw batchFailure.reason instanceof Error
              ? batchFailure.reason
              : new Error(String(batchFailure.reason));
          }
        }

        this.emitEventIfEnabled(execConfig, {
          type: ExecutionEventType.WaveCompleted,
          executionId: execId,
          ts: Date.now(),
          data: {
            wave: waveNumber,
            completedTasks: executedTasks.size,
            totalTasks: job.sub_tasks.length,
            durationMs: Date.now() - waveStartTime,
          },
        });
      }

      if (executedTasks.size < job.sub_tasks.length) {
        const remaining = job.sub_tasks.filter((task) => !executedTasks.has(task.id));
        throw new Error(`DAG execution deadlock. Remaining tasks: ${remaining.map((task) => task.id).join(', ')}`);
      }

      this.logger.info('All tasks completed, running synthesis');

      const synthesisStartTime = Date.now();
      this.emitEventIfEnabled(execConfig, {
        type: ExecutionEventType.SynthesisStarted,
        executionId: execId,
        ts: synthesisStartTime,
      });

      const synthesisResult = await this.synthesize(
        job.synthesis_plan,
        taskResults,
        execId,
        execConfig.abortSignal
      );

      this.emitEventIfEnabled(execConfig, {
        type: ExecutionEventType.SynthesisCompleted,
        executionId: execId,
        ts: Date.now(),
        data: {
          durationMs: Date.now() - synthesisStartTime,
        },
      });

      this.logger.info('╰─Synthesis completed, running validation');

      const validatedResult = await this.validate(synthesisResult.content);

      const allSubSteps = await this.db.query.dagSubSteps.findMany({
        where: eq(dagSubSteps.executionId, execId),
      });

      const statusData = this.deriveExecutionStatus(allSubSteps);
      const totalUsage = this.aggregateUsage(allSubSteps);
      const totalCostUsd = this.aggregateCost(allSubSteps);

      await this.db.update(dagExecutions)
        .set({
          status: statusData.status,
          completedTasks: statusData.completedTasks,
          failedTasks: statusData.failedTasks,
          waitingTasks: statusData.waitingTasks,
          finalResult: validatedResult,
          synthesisResult: synthesisResult.content,
          completedAt: new Date(),
          durationMs: Date.now() - startTime,
          totalUsage,
          totalCostUsd: totalCostUsd?.toString(),
        })
        .where(eq(dagExecutions.id, execId));

      if (statusData.status === 'completed' || statusData.status === 'partial') {
        this.emitEventIfEnabled(execConfig, {
          type: ExecutionEventType.Completed,
          executionId: execId,
          ts: Date.now(),
          data: {
            status: statusData.status,
            completedTasks: statusData.completedTasks,
            failedTasks: statusData.failedTasks,
            durationMs: Date.now() - startTime,
          },
        });
      } else if (statusData.status === 'failed') {
        this.emitEventIfEnabled(execConfig, {
          type: ExecutionEventType.Failed,
          executionId: execId,
          ts: Date.now(),
          error: {
            message: 'Execution failed',
          },
          data: {
            completedTasks: statusData.completedTasks,
            failedTasks: statusData.failedTasks,
          },
        });
      }

      this.logger.info({ executionId: execId, status: statusData.status }, 'DAG execution completed');

      return validatedResult;
    } catch (error) {
      await this.suspendExecution(execId, error, execConfig);
      throw error;
    }
  }

  private async suspendExecution(executionId: string, error: unknown, config: ExecutionConfig = {}): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : String(error);

    this.logger.error({ executionId, err: error }, 'Suspending execution due to error');

    await this.db.update(dagExecutions)
      .set({
        status: 'suspended',
        suspendedReason: errorMessage,
        suspendedAt: new Date(),
      })
      .where(eq(dagExecutions.id, executionId));

    this.emitEventIfEnabled(config, {
      type: ExecutionEventType.Suspended,
      executionId,
      ts: Date.now(),
      error: {
        message: errorMessage,
      },
    });
  }

  private deriveExecutionStatus(subSteps: any[]): {
    status: 'pending' | 'running' | 'waiting' | 'completed' | 'failed' | 'partial';
    completedTasks: number;
    failedTasks: number;
    waitingTasks: number;
  } {
    return deriveExecutionStatusShared(subSteps);
  }

  private async synthesize(
    plan: string,
    taskResults: Map<string, any>,
    executionId: string,
    abortSignal?: AbortSignal
  ): Promise<TaskExecutionResult> {
    const context = Array.from(taskResults.entries())
      .map(([taskId, result]) => {
        const resultStr = typeof result === 'string'
          ? result
          : JSON.stringify(result, null, 2);
        return `Task ${taskId} result:\n${resultStr}`;
      })
      .join('\n\n');

    const synthesisPrompt = `${plan}

Available task results:
${context}

Generate the final report in Markdown format as specified in the synthesis plan.`;

    const startTime = Date.now();

    const response = await this.llmProvider.chat({
      messages: [
        {
          role: 'system',
          content: 'You are a helpful assistant that synthesizes information into well-formatted Markdown reports.',
        },
        { role: 'user', content: synthesisPrompt },
      ],
      temperature: 0.5,
      abortSignal,
    });

    const synthesisSubStepId = generateSubStepId();

    await this.db.insert(dagSubSteps).values({
      id: synthesisSubStepId,
      executionId,
      taskId: '__SYNTHESIS__',
      description: 'Final synthesis of all task results',
      thought: 'Aggregating results into final output',
      actionType: 'inference',
      toolOrPromptName: '__synthesis__',
      toolOrPromptParams: { taskCount: taskResults.size },
      dependencies: Array.from(taskResults.keys()),
      status: 'completed',
      startedAt: new Date(startTime),
      completedAt: new Date(),
      durationMs: Date.now() - startTime,
      usage: response.usage,
      costUsd: (response as any).costUsd?.toString(),
      generationStats: (response as any).generationStats,
      generationId: response.generationId,
      result: response.content,
    });

    this.logger.debug({ synthesisSubStepId, usage: response.usage }, 'Synthesis sub-step created');

    return {
      content: response.content,
      usage: response.usage,
      costUsd: (response as any).costUsd,
      generationStats: (response as any).generationStats,
      generationId: response.generationId,
    };
  }

  private async validate(output: string): Promise<string> {
    this.logger.info('Validation step (pass-through)');
    return output;
  }

  private aggregateUsage(allSubSteps: any[]): { promptTokens: number; completionTokens: number; totalTokens: number } | null {
    return aggregateUsageShared(allSubSteps);
  }

  private aggregateCost(allSubSteps: any[]): number | null {
    return aggregateCostShared(allSubSteps);
  }
}
