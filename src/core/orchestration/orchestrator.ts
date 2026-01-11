/**
 * Agent Orchestrator
 *
 * Orchestrates goal execution by managing the agent loop
 */

import type { DrizzleDB } from '../../db/client.js';
import type { LLMProvider } from '../providers/types.js';
import { AgentPlanner } from './planner.js';
import { ToolExecutor } from '../tools/executor.js';
import { RunsService } from '../execution/runs.js';
import { getLogger } from '../../util/logger.js';
import { ExecutionError } from '../../errors/index.js';
import { runs, agents } from '../../db/schema.js';
import { eq } from 'drizzle-orm';

/**
 * Orchestrator configuration
 */
export interface OrchestratorConfig {
  db: DrizzleDB;
  llmProvider: LLMProvider;
  toolExecutor: ToolExecutor;
  runService: RunsService;
  maxSteps?: number;
}

/**
 * Execution event
 */
export interface ExecutionEvent {
  type:
    | 'step_start'
    | 'step_complete'
    | 'tool_call'
    | 'tool_result'
    | 'execution_complete'
    | 'execution_failed';
  data: Record<string, any>;
}

/**
 * Agent Orchestrator
 */
export class AgentOrchestrator {
  private logger = getLogger();

  constructor(private config: OrchestratorConfig) {}

  /**
   * Execute a run
   */
  async executeRun(runId: string): Promise<void> {
    const { db, toolExecutor, runService, llmProvider } = this.config;

    this.logger.info(`Starting run execution: ${runId}`);

    try {
      // Get run and goal
      const run = await db.query.runs.findFirst({
        where: eq(runs.id, runId),
        with: { goal: true },
      });

      if (!run) {
        throw new ExecutionError(`Run not found: ${runId}`, runId);
      }

      const goal = run.goal;

      if (!goal) {
        throw new ExecutionError(`Goal not found for run: ${runId}`, runId);
      }

      // Get agent if specified
      let customPrompt: string | undefined;
      let customProvider: LLMProvider = llmProvider;

      if (goal.agentId) {
        const agent = await db.query.agents.findFirst({
          where: eq(agents.id, goal.agentId),
        });

        if (agent) {
          customPrompt = agent.promptTemplate;
          this.logger.info(
            `Using agent: ${agent.name}@${agent.version}`
          );
        }
      }

      // Create planner
      const planner = new AgentPlanner(customProvider, customPrompt);

      // Update run to running
      await runService._updateStatus(runId, 'running');

      const maxSteps = this.config.maxSteps || 20;
      const tools = toolExecutor.listTools();
      let workingMemory = run.workingMemory || {};
      let currentStep = 0;
      const stepHistory: any[] = [];

      // Main execution loop
      while (currentStep < maxSteps) {
        currentStep++;
        const stepsRemaining = maxSteps - currentStep;

        this.logger.info(
          `Executing step ${currentStep}/${maxSteps}`
        );

        try {
          // Plan next step
          const goalParams = (goal.params as any) || {};
          const plan = await planner.plan({
            objective: goal.objective,
            workingMemory,
            stepHistory,
            stepsRemaining,
            tools,
            temperature: goalParams.temperature,
            maxTokens: goalParams.maxTokens,
          });

          // Record thought
          void await runService._addStep(
            runId,
            currentStep,
            plan.thought
          );

          stepHistory.push({
            stepNo: currentStep,
            thought: plan.thought,
          });

          // Execute tool calls if any
          if (plan.toolCalls && plan.toolCalls.length > 0) {
            const results = [];

            for (const toolCall of plan.toolCalls) {
              this.logger.info(
                `Executing tool: ${toolCall.name}`
              );

              const toolResult = await toolExecutor.execute(
                toolCall.name,
                toolCall.arguments,
                toolCall.id
              );

              if (toolResult.status === 'success') {
                results.push(toolResult.output);
                this.logger.debug(
                  `Tool ${toolCall.name} completed successfully`
                );
              } else {
                this.logger.error(
                  `Tool ${toolCall.name} failed: ${toolResult.error?.message}`
                );
                results.push(`Error: ${toolResult.error?.message}`);
              }
            }

            // Update working memory with tool results
            workingMemory = {
              ...workingMemory,
              lastToolResults: results,
              lastToolCalls: plan.toolCalls,
            };

            // Record tool call in step history
            stepHistory[stepHistory.length - 1].toolName = plan.toolCalls[0].name;
            stepHistory[stepHistory.length - 1].toolInput = plan.toolCalls[0].arguments;
            stepHistory[stepHistory.length - 1].observation = results.join('; ');
          }

          // Check if we should finish
          if (plan.shouldFinish) {
            this.logger.info(
              `Agent signaled completion at step ${currentStep}`
            );
            break;
          }
        } catch (error) {
          const errorMsg =
            error instanceof Error ? error.message : String(error);
          this.logger.error(
            `Step ${currentStep} failed: ${errorMsg}`
          );

          // Record error and continue or fail
          await runService._updateStatus(
            runId,
            'failed',
            `Step ${currentStep} error: ${errorMsg}`
          );
          throw error;
        }
      }

      // Update run to completed
      await runService._updateStatus(runId, 'completed');
      await runService._updateWorkingMemory(runId, workingMemory);

      this.logger.info(
        `Run completed successfully after ${currentStep} steps`
      );
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Run execution failed: ${errorMsg}`);

      try {
        await runService._updateStatus(
          runId,
          'failed',
          errorMsg
        );
      } catch (updateError) {
        this.logger.error(
          `Failed to update run status: ${updateError instanceof Error ? updateError.message : String(updateError)}`
        );
      }

      throw error;
    }
  }
}
