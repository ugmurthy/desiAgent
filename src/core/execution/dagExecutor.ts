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
import {
  hasActiveStopRequestForExecution,
  markStopRequestHandledForExecution,
} from '../../db/stopRequestHelpers.js';


export interface SubTask {
  id: string;
  description: string;
  thought: string;
  action_type: 'tool' | 'inference';
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
  artifactsDir?: string;
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
}

function generateSubStepId(): string {
  return `substep_${nanoid(21)}`;
}

export class DAGExecutor {
  private db: DrizzleDB;
  private llmProvider: LLMProvider;
  private toolRegistry: ToolRegistry;
  private artifactsDir: string;
  private logger = getLogger();

  constructor(config: DAGExecutorConfig) {
    this.db = config.db;
    this.llmProvider = config.llmProvider;
    this.toolRegistry = config.toolRegistry;
    this.artifactsDir = config.artifactsDir || process.env.ARTIFACTS_DIR || './artifacts';

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
    const entitiesStr = job.entities.length > 0
      ? job.entities.map(e => `• ${e.entity} (${e.type}): ${e.grounded_value}`).join('\n')
      : 'None';

    const formatted = `# Global Context
**Request:** ${job.original_request}
**Primary Intent:** ${job.intent.primary}
**Sub-intents:** ${job.intent.sub_intents.join('; ') || 'None'}
**Entities:**
${entitiesStr}
**Synthesis Goal:** ${job.synthesis_plan}`;

    return { formatted, totalTasks: job.sub_tasks.length };
  }

  private buildInferencePrompt(
    task: SubTask,
    globalContext: GlobalContext,
    taskResults: Map<string, any>
  ): string {
    const MAX_DEP_LENGTH = 2000;

    const depsStr = task.dependencies
      .filter(id => id !== 'none' && taskResults.has(id))
      .map(id => {
        const result = taskResults.get(id);
        const str = typeof result === 'string' ? result : JSON.stringify(result);
        return `[Task ${id}]: ${str.length > MAX_DEP_LENGTH ? str.slice(0, MAX_DEP_LENGTH) + '...' : str}`;
      })
      .join('\n\n') || 'None';

    return `You are an expert assistant executing a sub-task within a larger workflow.

${globalContext.formatted}

# Current Task [${task.id}/${globalContext.totalTasks}]
**Description:** ${task.description}
**Reasoning:** ${task.thought}
**Expected Output:** ${task.expected_output}

# Dependencies
${depsStr}

# Instruction
${task.tool_or_prompt.params?.prompt || task.description}

Respond with ONLY the expected output format. Build upon dependencies for coherence and align with the global context.`;
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

    if (tool === 'fetchURLs') {
      resolvedParams[key] = this.resolveFetchURLs(task, key, taskResults);
      
    } else if (tool === 'writeFile' && key === 'content') {
      resolvedParams[key] = this.resolveWriteFileContent(task, taskResults);
    } else if (tool === 'sendEmail' && key === 'attachments') {
      if (Array.isArray(resolvedParams[key]) && resolvedParams[key].length > 0) {
        resolvedParams[key][0]['content'] = this.resolveEmailContent(task, taskResults);
      }
    } else {
      resolvedParams[key] = this.resolveStringReplacements(value, matches, key, taskResults);
    }
  }

  private resolveEmailContent(
    task: Record<string, any>,
    taskResults: Map<string, any>
  ): string {
    const contentArray: string[] = [];
    
    for (const deps of task.dependencies) {
      const depResult = taskResults.get(deps);
      
      if (typeof depResult === 'string') {
        contentArray.push(depResult);
      } else if (typeof depResult === 'object' && depResult?.content) {
        contentArray.push(depResult.content);
      }
    }

    return contentArray.join('\n');
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
        agentNames.add(task.tool_or_prompt.name);
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

      const canExecute = (task: SubTask): boolean => {
        if (task.dependencies.length === 0 || task.dependencies.includes('none')) {
          return true;
        }
        return task.dependencies.every(dep => executedTasks.has(dep));
      };

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
        };
        const displaySym = symbols[task.tool_or_prompt.name] || '⚙️';
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

          const agentName = task.tool_or_prompt.name;
          
          // Use pre-fetched agent from cache instead of DB query
          const agent = agentCache.get(agentName);
          if (!agent) {
            throw new Error(`No agent found with name: ${agentName} (not in pre-fetch cache)`);
          }

          const llmExecuteTool = new LlmExecuteTool();

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
          };
        }

        throw new Error(`Unknown action type: ${task.action_type}`);
      };

      // Helper: handle graceful stop — set execution to pending, leave completed/failed steps, mark stop handled
      const handleStopDuringExecution = async (): Promise<string> => {
        this.logger.info({ executionId: execId }, 'Stop signal detected during DAG execution — pausing gracefully');

        // Set execution status to pending
        await this.db.update(dagExecutions)
          .set({ status: 'pending', updatedAt: new Date() })
          .where(eq(dagExecutions.id, execId));

        // Reset any 'running' sub-steps back to 'pending' (completed/failed are untouched)
        const allSubSteps = await this.db.query.dagSubSteps.findMany({
          where: eq(dagSubSteps.executionId, execId),
        });
        for (const step of allSubSteps) {
          if (step.status === 'running') {
            await this.db.update(dagSubSteps)
              .set({ status: 'pending', startedAt: null, updatedAt: new Date() })
              .where(eq(dagSubSteps.id, step.id));
          }
        }

        await markStopRequestHandledForExecution(this.db, execId);
        return 'stopped';
      };

      // Execute tasks in dependency order with wave-based batching
      let waveNumber = 0;

      while (executedTasks.size < job.sub_tasks.length) {
        // Check for stop signal before starting this wave
        if (await hasActiveStopRequestForExecution(this.db, execId)) {
          await handleStopDuringExecution();
          return 'stopped';
        }

        waveNumber++;
        const readyTasks = job.sub_tasks.filter(
          task => !executedTasks.has(task.id) && canExecute(task)
        );

        if (readyTasks.length === 0) {
          const remaining = job.sub_tasks.filter(task => !executedTasks.has(task.id));
          throw new Error(
            `DAG execution deadlock. Remaining tasks: ${remaining.map(t => t.id).join(', ')}`
          );
        }

        // Collect wave results for batch DB update
        const waveResults: TaskWaveResult[] = [];
        const waveStartTime = Date.now();

        this.emitEventIfEnabled(execConfig, {
          type: ExecutionEventType.WaveStarted,
          executionId: execId,
          ts: Date.now(),
          data: {
            wave: waveNumber,
            taskIds: readyTasks.map(t => t.id),
            parallel: readyTasks.length,
          },
        });

        // Batch update all tasks in wave to 'running' status if batching enabled
        if (execConfig.batchDbUpdates && readyTasks.length > 0) {
          const updatePromises = readyTasks.map(task =>
            this.db.update(dagSubSteps)
              .set({ status: 'running', startedAt: new Date() })
              .where(and(
                eq(dagSubSteps.taskId, task.id),
                eq(dagSubSteps.executionId, execId)
              ))
          );
          await Promise.all(updatePromises);
          this.logger.debug({ waveSize: readyTasks.length }, 'Batch updated wave tasks to running');
        }

        await Promise.all(
          readyTasks.map(async (task) => {
            const taskExecStartTime = Date.now();
            const waveResult: TaskWaveResult = { taskId: task.id, startTime: taskExecStartTime };
            waveResults.push(waveResult);

            try {
              const execResult = await executeTask(task);
              taskResults.set(task.id, execResult.content);
              executedTasks.add(task.id);
              waveResult.result = execResult;

              const serializedResult = typeof execResult.content === 'string'
                ? execResult.content
                : JSON.stringify(execResult.content);

              this.logger.debug({ taskId: task.id, result: serializedResult }, `╰─task ${task.id} result after executeTask():`);

              // Skip individual DB update if batching - will batch at wave end
              if (!execConfig.batchDbUpdates) {
                await this.db.update(dagSubSteps)
                  .set({
                    status: 'completed',
                    result: serializedResult,
                    completedAt: new Date(),
                    durationMs: Date.now() - taskExecStartTime,
                    usage: execResult.usage,
                    costUsd: execResult.costUsd?.toString(),
                    generationStats: execResult.generationStats,
                  })
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
              // Handle abort errors gracefully — don't throw, let stop-handling logic take over
              if (error instanceof Error && (error.name === 'AbortError' || execConfig.abortSignal?.aborted)) {
                this.logger.info({ taskId: task.id, executionId: execId }, 'Task aborted due to stop signal');
                waveResult.error = 'aborted';
                // Reset task back to pending (will be handled by handleStopDuringExecution)
                await this.db.update(dagSubSteps)
                  .set({ status: 'pending', startedAt: null })
                  .where(and(
                    eq(dagSubSteps.taskId, task.id),
                    eq(dagSubSteps.executionId, execId)
                  ));
                return; // Don't throw — let the wave complete and stop-check will handle
              }

              const errorMessage = error instanceof Error ? error.message : String(error);
              this.logger.error({ err: errorMessage, taskId: task.id }, `Task ${task.id} failed`);
              waveResult.error = errorMessage;

              // Immediate update for failures (important for debugging)
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

        // Batch update completed tasks at wave end
        if (execConfig.batchDbUpdates) {
          const completedResults = waveResults.filter(r => r.result && !r.error);
          if (completedResults.length > 0) {
            const batchUpdatePromises = completedResults.map(wr => {
              const serializedResult = typeof wr.result!.content === 'string'
                ? wr.result!.content
                : JSON.stringify(wr.result!.content);

              return this.db.update(dagSubSteps)
                .set({
                  status: 'completed',
                  result: serializedResult,
                  completedAt: new Date(),
                  durationMs: Date.now() - wr.startTime,
                  usage: wr.result!.usage,
                  costUsd: wr.result!.costUsd?.toString(),
                  generationStats: wr.result!.generationStats,
                })
                .where(and(
                  eq(dagSubSteps.taskId, wr.taskId),
                  eq(dagSubSteps.executionId, execId)
                ));
            });

            await Promise.all(batchUpdatePromises);
            this.logger.debug({
              waveSize: completedResults.length,
              waveDurationMs: Date.now() - waveStartTime,
            }, 'Batch updated wave completed tasks');
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

        // Check for stop signal after this wave completes
        if (await hasActiveStopRequestForExecution(this.db, execId)) {
          await handleStopDuringExecution();
          return 'stopped';
        }
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
      // Handle abort errors gracefully — stop instead of suspend
      if (error instanceof Error && (error.name === 'AbortError' || execConfig.abortSignal?.aborted)) {
        this.logger.info({ executionId: execId }, 'Execution aborted due to stop signal — pausing gracefully');
        await this.db.update(dagExecutions)
          .set({ status: 'pending', updatedAt: new Date() })
          .where(eq(dagExecutions.id, execId));
        await markStopRequestHandledForExecution(this.db, execId);
        return 'stopped';
      }
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
    const completed = subSteps.filter(s => s.status === 'completed').length;
    const failed = subSteps.filter(s => s.status === 'failed').length;
    const running = subSteps.filter(s => s.status === 'running').length;
    const waiting = subSteps.filter(s => s.status === 'waiting').length;
    const total = subSteps.length;

    let status: 'pending' | 'running' | 'waiting' | 'completed' | 'failed' | 'partial';

    if (waiting > 0) {
      status = 'waiting';
    } else if (failed > 0 && completed + failed === total) {
      status = failed === total ? 'failed' : 'partial';
    } else if (completed === total) {
      status = 'completed';
    } else if (running > 0 || completed > 0) {
      status = 'running';
    } else {
      status = 'pending';
    }

    return { status, completedTasks: completed, failedTasks: failed, waitingTasks: waiting };
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
      result: response.content,
    });

    this.logger.debug({ synthesisSubStepId, usage: response.usage }, 'Synthesis sub-step created');

    return {
      content: response.content,
      usage: response.usage,
      costUsd: (response as any).costUsd,
      generationStats: (response as any).generationStats,
    };
  }

  private async validate(output: string): Promise<string> {
    this.logger.info('Validation step (pass-through)');
    return output;
  }

  private aggregateUsage(allSubSteps: any[]): { promptTokens: number; completionTokens: number; totalTokens: number } | null {
    let hasUsage = false;
    let promptTokens = 0;
    let completionTokens = 0;
    let totalTokens = 0;

    for (const step of allSubSteps) {
      if (step.usage) {
        hasUsage = true;
        promptTokens += step.usage.promptTokens ?? 0;
        completionTokens += step.usage.completionTokens ?? 0;
        totalTokens += step.usage.totalTokens ?? 0;
      }
    }

    return hasUsage ? { promptTokens, completionTokens, totalTokens } : null;
  }

  private aggregateCost(allSubSteps: any[]): number | null {
    let totalCost = 0;
    let hasCost = false;

    for (const step of allSubSteps) {
      if (step.costUsd) {
        hasCost = true;
        totalCost += parseFloat(step.costUsd);
      }
    }

    return hasCost ? totalCost : null;
  }
}
