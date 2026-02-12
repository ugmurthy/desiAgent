/**
 * DAGs Service
 *
 * Manages DAG (Directed Acyclic Graph) creation, execution, and scheduling.
 * DAGs represent decomposed workflows for complex objectives.
 */

import { eq, desc, isNotNull, sql, gte, lte, and } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import cronstrue from 'cronstrue';
import type { DrizzleDB } from '../../db/client.js';
import { dags, dagExecutions, dagSubSteps } from '../../db/schema.js';
import type { DAG, DAGFilter } from '../../types/index.js';
import { NotFoundError, ValidationError } from '../../errors/index.js';
import { getLogger } from '../../util/logger.js';
import { validateCronExpression } from '../../util/cron-validator.js';
import {
  extractCodeBlock,
  renumberSubTasks,
  truncate,
  truncateForLog,
} from '../../util/dag-utils.js';
import { DecomposerJobSchema, type DecomposerJob } from '../../types/dag.js';
import type { LLMProvider } from '../providers/types.js';
import type { ToolRegistry } from '../tools/registry.js';
import { createLLMProvider } from '../providers/factory.js';
import type { AgentsService } from './agents.js';
import { DAGExecutor, type ExecutionConfig } from './dagExecutor.js';

export function generateDAGId(): string {
  return `dag_${nanoid(21)}`;
}

export function generateDAGExecutionId(): string {
  return `exec_${nanoid(21)}`;
}

export function generateSubStepId(): string {
  return `substep_${nanoid(21)}`;
}

export interface DagScheduler {
  registerDAGSchedule(dag: {
    id: string;
    cronSchedule: string;
    scheduleActive: boolean;
    timezone?: string;
  }): void;
  updateDAGSchedule(id: string, cronSchedule: string, scheduleActive: boolean): void;
  unregisterDAGSchedule(id: string): void;
}

export interface DAGsServiceDeps {
  db: DrizzleDB;
  llmProvider: LLMProvider;
  toolRegistry: ToolRegistry;
  agentsService: AgentsService;
  scheduler?: DagScheduler;
  artifactsDir?: string;
}

export interface CreateDAGFromGoalOptions {
  goalText: string;
  agentName: string;
  provider?: 'openai' | 'openrouter' | 'ollama';
  model?: string;
  temperature?: number;
  maxTokens?: number;
  seed?: number;
  cronSchedule?: string;
  scheduleActive?: boolean;
  timezone?: string;
  abortSignal?: AbortSignal;
}

interface PlanningAttempt {
  attempt: number;
  reason: 'initial' | 'retry_gaps' | 'retry_parse_error' | 'retry_validation' | 'title_master';
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
  costUsd?: number | null;
  errorMessage?: string;
  generationStats?: Record<string, any>;
}

interface PlanningUsageTotal {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ClarificationRequiredResult {
  status: 'clarification_required';
  dagId: string;
  clarificationQuery: string;
}

export interface DAGCreatedResult {
  status: 'success';
  dagId: string;
}

export interface ValidationErrorResult {
  status: 'validation_error';
  dagId: string;
}

export type DAGPlanningResult = ClarificationRequiredResult | DAGCreatedResult | ValidationErrorResult;

export interface DAGExecutionStartedResult {
  status: string
  dagId: string;
  executionId: string;
}

export type CreateAndExecuteResult = ClarificationRequiredResult | ValidationErrorResult | DAGExecutionStartedResult;

export interface ExecuteOptions {
  provider?: 'openai' | 'openrouter' | 'ollama';
  model?: string;
  /**
   * Execution configuration for performance tuning
   */
  executionConfig?: ExecutionConfig;
}

export interface RunExperimentsInput {
  goalText: string;
  agentName: string;
  provider: 'openai' | 'openrouter' | 'ollama';
  models: string[];
  temperatures: number[];
  seed?: number;
}

interface ScheduledDAGInfo {
  id: string;
  dagTitle: string | null;
  cronSchedule: string | null;
  scheduleDescription: string;
  scheduleActive: boolean | null;
}

export class DAGsService {
  private db: DrizzleDB;
  private llmProvider: LLMProvider;
  private toolRegistry: ToolRegistry;
  private agentsService: AgentsService;
  private scheduler?: DagScheduler;
  private artifactsDir: string;
  private logger = getLogger();

  constructor(deps: DAGsServiceDeps) {
    this.db = deps.db;
    this.llmProvider = deps.llmProvider;
    this.toolRegistry = deps.toolRegistry;
    this.agentsService = deps.agentsService;
    this.scheduler = deps.scheduler;
    this.artifactsDir = deps.artifactsDir || process.env.ARTIFACTS_DIR || './artifacts';
  }

  async createFromGoal(options: CreateDAGFromGoalOptions): Promise<DAGPlanningResult> {
    const {
      goalText,
      agentName,
      provider,
      model,
      temperature = 0.7,
      maxTokens = 10000,
      seed,
      cronSchedule,
      scheduleActive: inputScheduleActive,
      timezone = 'UTC',
    } = options;

    const scheduleActive = inputScheduleActive ?? !!cronSchedule;
    const showGoalText = truncateForLog(goalText);

    this.logger.info({ agentName, goalText: showGoalText }, 'Create DAG from goal');

    if (cronSchedule) {
      const validation = validateCronExpression(cronSchedule);
      if (!validation.valid) {
        throw new ValidationError(`Invalid cron expression: ${validation.error}`, 'cronSchedule', cronSchedule);
      }
      this.logger.debug({ cronSchedule, nextRuns: validation.nextRuns }, '╰─Valid cron schedule provided');
    }

    const agent = await this.agentsService.resolve(agentName);
    if (!agent) {
      throw new NotFoundError('Agent', agentName);
    } else {
      this.logger.debug({ agentName, provider,model }, '╰─Agent resolved');
      this.logger.debug({ agent }, '╰─Agent details');  
    }

    // Determine model/provider with precedence: options → agent → defaults
    const activeProvider = provider || agent.provider;
    const activeModel = model || agent.model;

    let activeLLMProvider: LLMProvider;
    if (activeProvider && activeModel) {
      this.logger.info({ requestedProvider: activeProvider, requestedModel: activeModel }, 'Creating custom LLM provider');
      activeLLMProvider = createLLMProvider({ provider: activeProvider as 'openai' | 'openrouter' | 'ollama', model: activeModel });

      const validationResult = await activeLLMProvider.validateToolCallSupport(activeModel);
      if (!validationResult.supported) {
        this.logger.warn({ model: activeModel, reason: validationResult.message }, 'Model does not support tool calling');
      }
    } else {
      activeLLMProvider = this.llmProvider;
      this.logger.debug('Using default LLM provider');
    }

    const toolDefinitions = this.toolRegistry.getAllDefinitions();
    const systemPrompt = agent.systemPrompt
      .replace(/\{\{tools\}\}/g, JSON.stringify(toolDefinitions))
      .replace(/\{\{currentDate\}\}/g, new Date().toLocaleString());
    if (systemPrompt.length < 100) {
      this.logger.warn('System prompt is empty after replacement');
      throw new ValidationError('System prompt seems short! ', 'systemPrompt', systemPrompt);
    }

    let currentGoalText = goalText.replace(/\{\{currentDate\}\}/g, new Date().toLocaleString());
    
    let attempt = 0;
    const maxAttempts = 3;

    const planningAttempts: PlanningAttempt[] = [];
    const planningUsageTotal: PlanningUsageTotal = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    let planningCostTotal = 0;
    let retryReason: 'initial' | 'retry_gaps' | 'retry_parse_error' | 'retry_validation' = 'initial';

    while (attempt < maxAttempts) {
      attempt++;
      this.logger.info(`attempt number ${attempt}`)
      //this.logger.info({ attempt, agentName, goalText: showGoalText }, 'Creating DAG with LLM inference');
      //this.logger.info({ temperature,maxTokens, systemPromptPreview: systemPrompt.slice(0,80) }, 'System prompt preview');
      const response = await activeLLMProvider.chat({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: currentGoalText },
        ],
        temperature,
        maxTokens,
        abortSignal: options.abortSignal,
      });

      const attemptUsage = response.usage;
      const attemptCost = (response as any).costUsd;
      const attemptGenStats = (response as any).generationStats;

      if (attemptUsage) {
        planningUsageTotal.promptTokens += attemptUsage.promptTokens ?? 0;
        planningUsageTotal.completionTokens += attemptUsage.completionTokens ?? 0;
        planningUsageTotal.totalTokens += attemptUsage.totalTokens ?? 0;
      }
      if (attemptCost != null) {
        planningCostTotal += attemptCost;
      }

      const MAX_RESPONSE_SIZE = 100_000;
      if (response.content.length > MAX_RESPONSE_SIZE) {
        this.logger.error({ responseSize: response.content.length }, 'LLM response exceeds size limit');
        throw new ValidationError(`Response too large: ${response.content.length} bytes (max: ${MAX_RESPONSE_SIZE})`, 'response', response.content.length);
      }

      let result;
      try {
        result = extractCodeBlock(response.content);
      } catch (parseError) {
        const errorMessage = parseError instanceof Error ? parseError.message : String(parseError);

        planningAttempts.push({
          attempt,
          reason: retryReason,
          usage: attemptUsage,
          costUsd: attemptCost,
          errorMessage,
          generationStats: attemptGenStats,
        });

        this.logger.error({ err: parseError, attempt, responsePreview: response.content.slice(0, 80) }, 'Failed to parse LLM response as JSON');

        if (attempt >= maxAttempts) {
          const dagId = generateDAGId();
          const now = new Date();
          this.logger.info({ dagId }, 'DagID Generated for parse error');

          const insertData = {
            id: dagId,
            status: 'validation_error' as const,
            result: { rawResponse: response.content } as any,
            usage: attemptUsage as any,
            generationStats: attemptGenStats,
            attempts: attempt,
            agentName,
            dagTitle: null,
            cronSchedule: cronSchedule || null,
            scheduleActive,
            timezone,
            params: {
              goalText,
              agentName,
              provider,
              model,
              temperature,
              max_tokens: maxTokens,
              seed,
            },
            planningTotalUsage: planningUsageTotal,
            planningTotalCostUsd: planningCostTotal.toString(),
            planningAttempts,
            createdAt: now,
            updatedAt: now,
          };

          try {
            await this.db.insert(dags).values(insertData);
          } catch (dbError) {
            const dbErrorMessage = dbError instanceof Error ? dbError.message : String(dbError);
            this.logger.error({ err: dbError, dagId }, 'Failed to insert validation_error DAG');
            throw new Error(`Database insert failed for validation_error DAG ${dagId}: ${dbErrorMessage}`);
          }

          this.logger.info({ dagId, agentName, error: errorMessage }, 'Validation error DAG saved (parse error)');
          return { status: 'validation_error', dagId };
        }
        retryReason = 'retry_parse_error';
        continue;
      }

      const usage = response.usage ?? null;
      const generationStats = (response as any).generationStats ?? null;
      const validatedResult = DecomposerJobSchema.safeParse(result);

      if (!validatedResult.success) {
        planningAttempts.push({
          attempt,
          reason: retryReason,
          usage: attemptUsage,
          costUsd: attemptCost,
          errorMessage: JSON.stringify(validatedResult.error.issues),
          generationStats: attemptGenStats,
        });

        this.logger.error({ errors: validatedResult.error.issues, attempt }, 'DAG validation failed');

        if (attempt >= maxAttempts) {
          const dagId = generateDAGId();
          const now = new Date();
          this.logger.info({ dagId }, 'DagID Generated for schema validation error');

          const insertData = {
            id: dagId,
            status: 'validation_error' as const,
            result: { rawResponse: response.content, validationErrors: validatedResult.error.issues } as any,
            usage: attemptUsage as any,
            generationStats: attemptGenStats,
            attempts: attempt,
            agentName,
            dagTitle: null,
            cronSchedule: cronSchedule || null,
            scheduleActive,
            timezone,
            params: {
              goalText,
              agentName,
              provider,
              model,
              temperature,
              max_tokens: maxTokens,
              seed,
            },
            planningTotalUsage: planningUsageTotal,
            planningTotalCostUsd: planningCostTotal.toString(),
            planningAttempts,
            createdAt: now,
            updatedAt: now,
          };

          try {
            await this.db.insert(dags).values(insertData);
          } catch (dbError) {
            const dbErrorMessage = dbError instanceof Error ? dbError.message : String(dbError);
            this.logger.error({ err: dbError, dagId }, 'Failed to insert validation_error DAG');
            throw new Error(`Database insert failed for validation_error DAG ${dagId}: ${dbErrorMessage}`);
          }

          this.logger.info({ dagId, agentName, errors: validatedResult.error.issues }, 'Validation error DAG saved (schema error)');
          return { status: 'validation_error', dagId };
        }
        retryReason = 'retry_validation';
        continue;
      }

      planningAttempts.push({
        attempt,
        reason: retryReason,
        usage: attemptUsage,
        costUsd: attemptCost,
        generationStats: attemptGenStats,
      });

      let dag = validatedResult.data;

      if (dag.clarification_needed) {
        this.logger.info({ clarificationQuery: dag.clarification_query }, 'Clarification required');
        
        const dagId = generateDAGId();
        const now = new Date();
        this.logger.info({ dagId }, 'DagID Generated for clarification');

        const titleMasterPromise = this.generateTitleAsync(
          activeLLMProvider,
          goalText,
          options.abortSignal
        );

        const baseInsertData = {
          id: dagId,
          status: 'pending' as const,
          result: dag as any,
          usage: usage as any,
          generationStats: generationStats,
          attempts: attempt,
          agentName,
          dagTitle: null as string | null,
          cronSchedule: cronSchedule || null,
          scheduleActive,
          timezone,
          params: {
            goalText,
            agentName,
            provider,
            model,
            temperature,
            max_tokens: maxTokens,
            seed,
          },
          planningTotalUsage: planningUsageTotal,
          planningTotalCostUsd: planningCostTotal.toString(),
          planningAttempts,
          createdAt: now,
          updatedAt: now,
        };

        const titleResult = await titleMasterPromise;
        if (titleResult) {
          this.logger.info('TitleMaster generated Result for clarification');
          baseInsertData.dagTitle = titleResult.title;

          planningAttempts.push({
            attempt,
            reason: 'title_master',
            usage: titleResult.usage,
            costUsd: titleResult.costUsd,
            generationStats: titleResult.generationStats,
          });

          if (titleResult.usage) {
            planningUsageTotal.promptTokens += titleResult.usage.promptTokens ?? 0;
            planningUsageTotal.completionTokens += titleResult.usage.completionTokens ?? 0;
            planningUsageTotal.totalTokens += titleResult.usage.totalTokens ?? 0;
          }
          if (titleResult.costUsd != null) {
            planningCostTotal += titleResult.costUsd;
          }

          baseInsertData.planningTotalUsage = planningUsageTotal;
          baseInsertData.planningTotalCostUsd = planningCostTotal.toString();
        }

        try {
          await this.db.insert(dags).values(baseInsertData);
        } catch (dbError) {
          const errorMessage = dbError instanceof Error ? dbError.message : String(dbError);
          this.logger.error({ err: dbError, dagId }, 'Failed to insert clarification DAG into database');
          throw new Error(`Database insert failed for clarification DAG ${dagId}: ${errorMessage}`);
        }

        this.logger.info({ dagId, agentName, clarificationQuery: dag.clarification_query }, 'Clarification DAG saved to database');

        return {
          status: 'clarification_required',
          dagId,
          clarificationQuery: dag.clarification_query || '',
        };
      }

      if (dag.validation.coverage === 'high') {
        dag = renumberSubTasks(dag);
        dag.original_request = goalText;
        const dagId = generateDAGId();
        const now = new Date();
        this.logger.info({dagId},"DagID Generated")
        // Run TitleMaster generation in parallel with preparing insert data
        const titleMasterPromise = this.generateTitleAsync(
          activeLLMProvider,
          goalText,
          options.abortSignal
        );
        
        // Prepare base insert data (doesn't need title yet)
        const baseInsertData = {
          id: dagId,
          status: 'success' as const,
          result: dag as any,
          usage: usage as any,
          generationStats: generationStats,
          attempts: attempt,
          agentName,
          dagTitle: null as string | null,
          cronSchedule: cronSchedule || null,
          scheduleActive,
          timezone,
          params: {
            goalText,
            agentName,
            provider,
            model,
            temperature,
            max_tokens: maxTokens,
            seed,
          },
          planningTotalUsage: planningUsageTotal,
          planningTotalCostUsd: planningCostTotal.toString(),
          planningAttempts,
          createdAt: now,
          updatedAt: now,
        };

        // Wait for title generation (runs in parallel with data prep above)
        const titleResult = await titleMasterPromise;
       
        if (titleResult) {
          this.logger.info('TitleMaster generated Result');
          baseInsertData.dagTitle = titleResult.title;
          
          planningAttempts.push({
            attempt,
            reason: 'title_master',
            usage: titleResult.usage,
            costUsd: titleResult.costUsd,
            generationStats: titleResult.generationStats,
          });

          if (titleResult.usage) {
            planningUsageTotal.promptTokens += titleResult.usage.promptTokens ?? 0;
            planningUsageTotal.completionTokens += titleResult.usage.completionTokens ?? 0;
            planningUsageTotal.totalTokens += titleResult.usage.totalTokens ?? 0;
          }
          if (titleResult.costUsd != null) {
            planningCostTotal += titleResult.costUsd;
          }
          
          // Update the totals in insert data
          baseInsertData.planningTotalUsage = planningUsageTotal;
          baseInsertData.planningTotalCostUsd = planningCostTotal.toString();
        }
        this.logger.info('Base insert data prepared');
        try {
          await this.db.insert(dags).values(baseInsertData);
        } catch (dbError) {
          const errorMessage = dbError instanceof Error ? dbError.message : String(dbError);
          this.logger.error({ err: dbError, dagId, goalText: showGoalText }, 'Failed to insert DAG into database');
          throw new Error(`Database insert failed for DAG ${dagId}: ${errorMessage}`);
        }

        this.logger.info({
          dagId,
          agentName,
          goalText: showGoalText,
          cronSchedule,
          scheduleActive,
          planningCost: planningCostTotal,
        }, 'DAG saved to database');

        if (this.scheduler && cronSchedule && scheduleActive) {
          this.scheduler.registerDAGSchedule({
            id: dagId,
            cronSchedule,
            scheduleActive,
            timezone,
          });
          this.logger.info({ dagId, cronSchedule, timezone }, 'DAG schedule registered');
        }

        return { status: 'success', dagId };
      }

      if (dag.validation.gaps && dag.validation.gaps.length > 0) {
        const gapsText = dag.validation.gaps.map((gap, idx) => `${idx + 1}. ${gap}`).join('\n');
        currentGoalText = `${goalText}\n\nEnsure following gaps are covered:\n${gapsText}`;

        this.logger.info({ gaps: dag.validation.gaps, attempt }, 'Retrying with gaps addressed');
        retryReason = 'retry_gaps';
        continue;
      }

      dag = renumberSubTasks(dag);
      dag.original_request = goalText;
      const dagId = generateDAGId();
      const now = new Date();
      this.logger.info({ dagId }, 'DagID Generated for low-coverage DAG');

      const titleMasterPromise = this.generateTitleAsync(
        activeLLMProvider,
        goalText,
        options.abortSignal
      );

      const baseInsertData = {
        id: dagId,
        status: 'success' as const,
        result: dag as any,
        usage: usage as any,
        generationStats: generationStats,
        attempts: attempt,
        agentName,
        dagTitle: null as string | null,
        cronSchedule: cronSchedule || null,
        scheduleActive,
        timezone,
        params: {
          goalText,
          agentName,
          provider,
          model,
          temperature,
          max_tokens: maxTokens,
          seed,
        },
        planningTotalUsage: planningUsageTotal,
        planningTotalCostUsd: planningCostTotal.toString(),
        planningAttempts,
        createdAt: now,
        updatedAt: now,
      };

      const titleResult = await titleMasterPromise;
      if (titleResult) {
        this.logger.info('TitleMaster generated Result for low-coverage DAG');
        baseInsertData.dagTitle = titleResult.title;

        planningAttempts.push({
          attempt,
          reason: 'title_master',
          usage: titleResult.usage,
          costUsd: titleResult.costUsd,
          generationStats: titleResult.generationStats,
        });

        if (titleResult.usage) {
          planningUsageTotal.promptTokens += titleResult.usage.promptTokens ?? 0;
          planningUsageTotal.completionTokens += titleResult.usage.completionTokens ?? 0;
          planningUsageTotal.totalTokens += titleResult.usage.totalTokens ?? 0;
        }
        if (titleResult.costUsd != null) {
          planningCostTotal += titleResult.costUsd;
        }

        baseInsertData.planningTotalUsage = planningUsageTotal;
        baseInsertData.planningTotalCostUsd = planningCostTotal.toString();
      }

      try {
        await this.db.insert(dags).values(baseInsertData);
      } catch (dbError) {
        const errorMessage = dbError instanceof Error ? dbError.message : String(dbError);
        this.logger.error({ err: dbError, dagId }, 'Failed to insert low-coverage DAG');
        throw new Error(`Database insert failed for low-coverage DAG ${dagId}: ${errorMessage}`);
      }

      this.logger.info({ dagId, agentName }, 'Low-coverage DAG saved to database');
      return { status: 'success', dagId };
    }

    throw new ValidationError(`Failed to create DAG after ${maxAttempts} attempts`, 'attempts', maxAttempts);
  }

  async createAndExecuteFromGoal(options: CreateDAGFromGoalOptions): Promise<CreateAndExecuteResult> {
    const planningResult = await this.createFromGoal(options);

    if (planningResult.status !== 'success') {
      return planningResult;  
    }
    
    const executionResult = await this.execute(planningResult.dagId);
    return {
      status: executionResult.status,
      dagId: planningResult.dagId,
      executionId: executionResult.id,
    };
    // if (planningResult.status === 'clarification_required') {
    //   throw new ValidationError(
    //     `Clarification required: ${planningResult.clarificationQuery}`,
    //     'clarification',
    //     planningResult.clarificationQuery
    //   );
    // }

    // if (planningResult.status === 'validation_error') {
    //   throw new ValidationError(
    //     `Validation failed for DAG ${planningResult.dagId}`,
    //     'validation',
    //     planningResult.dagId
    //   );
    // }

    
  }

  async resumeFromClarification(dagId: string, userResponse: string): Promise<DAGPlanningResult> {
    const [existingDag] = await this.db.select().from(dags).where(eq(dags.id, dagId)).limit(1);

    if (!existingDag) {
      throw new NotFoundError('DAG', dagId);
    }

    if (existingDag.status !== 'pending') {
      throw new ValidationError(
        `Cannot resume DAG with status '${existingDag.status}'. Only 'pending' DAGs can be resumed.`,
        'status',
        existingDag.status
      );
    }

    const params = existingDag.params as Record<string, any>;
    const originalGoalText = params?.goalText || '';
    const augmentedGoalText = `${originalGoalText}\n\nUser clarification: ${userResponse}`;

    this.logger.info({ dagId, originalGoalText: truncateForLog(originalGoalText) }, 'Resuming clarification DAG');

    const planningResult = await this.createFromGoal({
      goalText: augmentedGoalText,
      agentName: params?.agentName || existingDag.agentName || 'Decomposer',
      provider: params?.provider,
      model: params?.model,
      temperature: params?.temperature ?? 0.7,
      maxTokens: params?.max_tokens ?? 10000,
      seed: params?.seed,
      cronSchedule: existingDag.cronSchedule || undefined,
      scheduleActive: existingDag.scheduleActive ?? false,
      timezone: existingDag.timezone || 'UTC',
    });

    if (planningResult.status === 'success') {
      const newDagRecord = await this.db.select().from(dags).where(eq(dags.id, planningResult.dagId)).limit(1);
      
      if (newDagRecord.length > 0) {
        const now = new Date();
        await this.db.update(dags).set({
          status: 'success',

          result: newDagRecord[0].result,
          usage: newDagRecord[0].usage,
          generationStats: newDagRecord[0].generationStats,
          attempts: (existingDag.attempts || 0) + (newDagRecord[0].attempts || 1),
          dagTitle: newDagRecord[0].dagTitle || existingDag.dagTitle,
          params: {
            ...(newDagRecord[0].params as Record<string, any> || {}),
            ...(existingDag.params as Record<string, any> || {}),
            goalText: augmentedGoalText,
          },
          planningTotalUsage: newDagRecord[0].planningTotalUsage,
          planningTotalCostUsd: newDagRecord[0].planningTotalCostUsd,
          planningAttempts: [
            ...(existingDag.planningAttempts as any[] || []),
            ...(newDagRecord[0].planningAttempts as any[] || []),
          ],
          updatedAt: now,
        }).where(eq(dags.id, dagId));

        await this.db.delete(dags).where(eq(dags.id, planningResult.dagId));

        this.logger.info({ dagId, newDagId: planningResult.dagId }, 'Merged resumed DAG into original');
        return { status: 'success', dagId };
      }
    }

    return planningResult;
  }

  async execute(dagId: string, _options?: ExecuteOptions): Promise<{ id: string; status: string }> {
    const [dagRecord] = await this.db.select().from(dags).where(eq(dags.id, dagId)).limit(1);

    if (!dagRecord) {
      throw new NotFoundError('DAG', dagId);
    }

    this.logger.info({ dagId }, 'Retrieved DAG for execution');

    let resultStr = JSON.stringify(dagRecord.result)
      .replace(/\{\{currentDate\}\}/g, new Date().toLocaleString())
      .replace(/\{\{Today\}\}/gi, new Date().toLocaleString());

    const job = DecomposerJobSchema.parse(JSON.parse(resultStr)) as DecomposerJob;

    if (job.clarification_needed) {
      throw new ValidationError(
        `Clarification required: ${job.clarification_query}`,
        'clarification',
        job.clarification_query
      );
    }

    const executionId = generateDAGExecutionId();
    const originalGoalText = (dagRecord.params as any)?.goalText || job.original_request;
    const now = new Date();

    await this.db.insert(dagExecutions).values({
      id: executionId,
      dagId: dagId,
      originalRequest: originalGoalText,
      primaryIntent: job.intent.primary,
      status: 'pending',
      totalTasks: job.sub_tasks.length,
      completedTasks: 0,
      failedTasks: 0,
      waitingTasks: 0,
      retryCount: 0,
      createdAt: now,
      updatedAt: now,
    });

    await this.db.insert(dagSubSteps).values(
      job.sub_tasks.map((task) => ({
        id: generateSubStepId(),
        executionId: executionId,
        taskId: task.id,
        description: task.description,
        thought: task.thought,
        actionType: task.action_type as 'tool' | 'inference',
        toolOrPromptName: task.tool_or_prompt.name,
        toolOrPromptParams: task.tool_or_prompt.params || {},
        dependencies: task.dependencies,
        status: 'pending' as const,
        createdAt: now,
        updatedAt: now,
      }))
    );

    this.logger.info({
      executionId,
      dagId,
      primaryIntent: job.intent.primary,
      totalTasks: job.sub_tasks.length,
    }, 'DAG execution records created');

    // Execute the DAG asynchronously (fire and forget)
    const dagExecutor = new DAGExecutor({
      db: this.db,
      llmProvider: this.llmProvider,
      toolRegistry: this.toolRegistry,
      artifactsDir: this.artifactsDir,
    });

    // Start execution in background - don't await
    dagExecutor.execute(job, executionId, dagId, originalGoalText, _options?.executionConfig).catch((error) => {
      this.logger.error({ err: error, executionId }, 'DAG execution failed');
    });

    return { id: executionId, status: 'pending' };
  }

  async resume(executionId: string, executionConfig?: ExecutionConfig): Promise<{ id: string; status: string; retryCount: number }> {
    const [execution] = await this.db.select().from(dagExecutions).where(eq(dagExecutions.id, executionId)).limit(1);

    if (!execution) {
      throw new NotFoundError('DAG Execution', executionId);
    }

    if (!['suspended', 'failed'].includes(execution.status)) {
      throw new ValidationError(
        `Cannot resume execution with status '${execution.status}'. Only 'suspended' or 'failed' executions can be resumed.`,
        'status',
        execution.status
      );
    }

    if (!execution.dagId) {
      throw new ValidationError('Execution has no associated DAG. Cannot resume.', 'dagId', null);
    }

    const [dagRecord] = await this.db.select().from(dags).where(eq(dags.id, execution.dagId)).limit(1);

    if (!dagRecord) {
      throw new NotFoundError('DAG', execution.dagId);
    }

    const newRetryCount = (execution.retryCount || 0) + 1;
    const now = new Date();

    await this.db
      .update(dagExecutions)
      .set({
        lastRetryAt: now,
        retryCount: sql`${dagExecutions.retryCount} + 1`,
        status: 'running',
        updatedAt: now,
      })
      .where(eq(dagExecutions.id, executionId));

    this.logger.info({
      executionId,
      dagId: execution.dagId,
      retryCount: newRetryCount,
      previousStatus: execution.status,
    }, 'Resuming DAG execution');

    // Parse job and execute
    const job = DecomposerJobSchema.parse(dagRecord.result) as DecomposerJob;
    const originalGoalText = (dagRecord.params as any)?.goalText || job.original_request;

    const dagExecutor = new DAGExecutor({
      db: this.db,
      llmProvider: this.llmProvider,
      toolRegistry: this.toolRegistry,
      artifactsDir: this.artifactsDir,
    });

    // Start execution in background - don't await
    dagExecutor.execute(job, executionId, execution.dagId, originalGoalText, executionConfig).catch((error) => {
      this.logger.error({ err: error, executionId }, 'DAG resume execution failed');
    });

    return { id: executionId, status: 'running', retryCount: newRetryCount };
  }

  async get(id: string): Promise<DAG> {
    const [dag] = await this.db.select().from(dags).where(eq(dags.id, id)).limit(1);

    if (!dag) {
      throw new NotFoundError('DAG', id);
    }

    return this.mapDAG(dag);
  }

  async list(filter?: DAGFilter): Promise<DAG[]> {
    const conditions = [];

    if (filter?.status) {
      conditions.push(eq(dags.status, filter.status as any));
    }
    if (filter?.createdAfter) {
      conditions.push(gte(dags.createdAt, filter.createdAfter));
    }
    if (filter?.createdBefore) {
      conditions.push(lte(dags.createdAt, filter.createdBefore));
    }

    let query = this.db.select().from(dags).orderBy(desc(dags.createdAt));

    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as any;
    }

    const allDAGs = await query.limit(filter?.limit || 100).offset(filter?.offset || 0);

    return allDAGs.map((d) => this.mapDAG(d));
  }

  async listScheduled(): Promise<ScheduledDAGInfo[]> {
    const scheduledDags = await this.db
      .select()
      .from(dags)
      .where(isNotNull(dags.cronSchedule))
      .orderBy(desc(dags.updatedAt));

    return scheduledDags.map((dag) => {
      let scheduleDescription = 'Invalid schedule';
      if (dag.cronSchedule) {
        try {
          scheduleDescription = cronstrue.toString(dag.cronSchedule);
        } catch (e) {
          this.logger.warn({ dagId: dag.id, schedule: dag.cronSchedule, err: e }, 'Failed to parse cron schedule');
        }
      }

      return {
        id: dag.id,
        dagTitle: dag.dagTitle,
        cronSchedule: dag.cronSchedule,
        scheduleDescription,
        scheduleActive: dag.scheduleActive,
      };
    });
  }

  async update(id: string, updates: Partial<{
    status: string;
    result: any;
    params: Record<string, any>;
    cronSchedule: string | null;
    scheduleActive: boolean;
    timezone: string;
    dagTitle: string;
  }>): Promise<DAG> {
    const [existing] = await this.db.select().from(dags).where(eq(dags.id, id)).limit(1);

    if (!existing) {
      throw new NotFoundError('DAG', id);
    }

    if (updates.cronSchedule) {
      const validation = validateCronExpression(updates.cronSchedule);
      if (!validation.valid) {
        throw new ValidationError(`Invalid cron expression: ${validation.error}`, 'cronSchedule', updates.cronSchedule);
      }
    }

    const updateData: Record<string, any> = {
      updatedAt: new Date(),
    };

    if (updates.status !== undefined) updateData.status = updates.status;
    if (updates.result !== undefined) updateData.result = updates.result;
    if (updates.params !== undefined) updateData.params = updates.params;
    if (updates.cronSchedule !== undefined) updateData.cronSchedule = updates.cronSchedule;
    if (updates.scheduleActive !== undefined) updateData.scheduleActive = updates.scheduleActive;
    if (updates.timezone !== undefined) updateData.timezone = updates.timezone;
    if (updates.dagTitle !== undefined) updateData.dagTitle = updates.dagTitle;

    await this.db.update(dags).set(updateData).where(eq(dags.id, id));

    const [updated] = await this.db.select().from(dags).where(eq(dags.id, id)).limit(1);

    if (!updated) {
      throw new Error('Failed to update DAG');
    }

    if (this.scheduler && (updates.cronSchedule !== undefined || updates.scheduleActive !== undefined)) {
      const finalSchedule = updates.cronSchedule ?? updated.cronSchedule;
      const finalActive = updates.scheduleActive ?? updated.scheduleActive;

      if (finalSchedule && finalActive) {
        this.scheduler.updateDAGSchedule(id, finalSchedule, finalActive);
        this.logger.info({ dagId: id, cronSchedule: finalSchedule, scheduleActive: finalActive }, 'DAG schedule updated');
      } else {
        this.scheduler.unregisterDAGSchedule(id);
        this.logger.info({ dagId: id }, 'DAG schedule unregistered');
      }
    }

    this.logger.info({ dagId: id, updates: Object.keys(updates) }, 'DAG updated successfully');

    return this.mapDAG(updated);
  }

  async safeDelete(id: string): Promise<void> {
    const [existing] = await this.db.select().from(dags).where(eq(dags.id, id)).limit(1);

    if (!existing) {
      throw new NotFoundError('DAG', id);
    }

    const relatedExecutions = await this.db
      .select()
      .from(dagExecutions)
      .where(eq(dagExecutions.dagId, id));

    if (relatedExecutions.length > 0) {
      throw new ValidationError(
        `Cannot delete DAG: ${relatedExecutions.length} execution(s) exist for this DAG`,
        'executions',
        relatedExecutions.length
      );
    }

    await this.db.delete(dags).where(eq(dags.id, id));

    if (this.scheduler) {
      this.scheduler.unregisterDAGSchedule(id);
    }

    this.logger.info({ dagId: id }, 'DAG deleted successfully');
  }

  async runExperiments(input: RunExperimentsInput): Promise<{
    status: string;
    totalExperiments: number;
    successCount: number;
    failureCount: number;
    results: Array<{
      model: string;
      temperature: number;
      dagId: string | null;
      success: boolean;
      error?: string;
    }>;
  }> {
    const { goalText, agentName, provider, models, temperatures, seed } = input;

    this.logger.info({
      goalText: truncateForLog(goalText),
      modelsCount: models.length,
      temperaturesCount: temperatures.length,
      totalExperiments: models.length * temperatures.length,
    }, 'Starting DAG experiments');

    const experimentResults: Array<{
      model: string;
      temperature: number;
      dagId: string | null;
      success: boolean;
      error?: string;
    }> = [];

    for (const model of models) {
      for (const temperature of temperatures) {
        let dagId: string | null = null;
        let success = false;
        let error: string | undefined;

        try {
          const result = await this.createFromGoal({
            goalText,
            agentName,
            provider,
            model,
            temperature,
            seed,
          });

          if (result.status === 'success') {
            dagId = result.dagId;
            success = true;
          } else if (result.status === 'validation_error') {
            dagId = result.dagId;
            success = false;
            error = 'Validation error';
          } else {
            dagId = result.dagId;
            error = 'Clarification required';
          }

          this.logger.info({ dagId, model, temperature }, 'DAG experiment completed');
        } catch (experimentError) {
          error = experimentError instanceof Error ? experimentError.message : String(experimentError);
          this.logger.error({ err: experimentError, model, temperature }, 'DAG experiment failed');
        }

        experimentResults.push({ model, temperature, dagId, success, error });
      }
    }

    const successCount = experimentResults.filter((r) => r.success).length;
    const failureCount = experimentResults.filter((r) => !r.success).length;

    return {
      status: 'completed',
      totalExperiments: experimentResults.length,
      successCount,
      failureCount,
      results: experimentResults,
    };
  }

  async getSubSteps(executionId: string): Promise<any[]> {
    const [execution] = await this.db.select().from(dagExecutions).where(eq(dagExecutions.id, executionId)).limit(1);

    if (!execution) {
      throw new NotFoundError('DAG Execution', executionId);
    }

    const subSteps = await this.db
      .select()
      .from(dagSubSteps)
      .where(eq(dagSubSteps.executionId, executionId))
      .orderBy(dagSubSteps.taskId);

    return subSteps;
  }

  /**
   * Generate DAG title asynchronously using TitleMaster agent
   * Returns null if TitleMaster is not available or fails
   */
  private async generateTitleAsync(
    llmProvider: LLMProvider,
    goalText: string,
    abortSignal?: AbortSignal
  ): Promise<{
    title: string;
    usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
    costUsd?: number;
    generationStats?: Record<string, any>;
  } | null> {
    try {
      const titleMasterAgent = await this.agentsService.resolve('TitleMaster');
      if (!titleMasterAgent) {
        this.logger.warn('TitleMaster agent not found or inactive');
        return null;
      }

      const titleResponse = await llmProvider.chat({
        messages: [
          { role: 'system', content: titleMasterAgent.systemPrompt },
          { role: 'user', content: truncate(goalText) },
        ],
        temperature: 0.7,
        maxTokens: 100,
        abortSignal,
      });

      const title = titleResponse.content.trim();
      this.logger.info({ dagTitle: title }, 'Generated DAG title from TitleMaster');

      return {
        title,
        usage: titleResponse.usage,
        costUsd: (titleResponse as any).costUsd,
        generationStats: (titleResponse as any).generationStats,
      };
    } catch (titleError) {
      this.logger.error({ err: titleError }, 'Error calling TitleMaster');
      return null;
    }
  }

  private mapDAG(record: any): DAG {
    return {
      id: record.id,
      dagTitle: record.dagTitle || '',
      status: record.status,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      metadata: {
        ...record.params,
        result: record.result,
        usage: record.usage,
        generationStats: record.generationStats,
        attempts: record.attempts,
        agentName: record.agentName,
        cronSchedule: record.cronSchedule,
        scheduleActive: record.scheduleActive,
        timezone: record.timezone,
        planningTotalUsage: record.planningTotalUsage,
        planningTotalCostUsd: record.planningTotalCostUsd,
        planningAttempts: record.planningAttempts,
      },
    };
  }
}
