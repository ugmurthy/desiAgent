/**
 * Agent Planner
 *
 * Uses LLM to plan the next step in goal execution
 */

import type { ToolDefinition } from '../../types/index.js';
import type { LLMProvider } from '../providers/types.js';
import { getLogger } from '../../util/logger.js';

/**
 * Context for planning
 */
export interface PlannerContext {
  objective: string;
  workingMemory: Record<string, any>;
  stepHistory: Array<{
    stepNo: number;
    thought: string;
    toolName?: string;
    toolInput?: Record<string, any>;
    observation?: string;
  }>;
  stepsRemaining: number;
  tools: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
}

/**
 * Tool call from planner
 */
export interface PlannerToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
}

/**
 * Result from planner
 */
export interface PlannerResult {
  thought: string;
  toolCalls?: PlannerToolCall[];
  shouldFinish: boolean;
}

/**
 * Agent Planner
 */
export class AgentPlanner {
  private logger = getLogger();

  constructor(
    private llmProvider: LLMProvider,
    private customPrompt?: string
  ) {}

  /**
   * Plan the next step
   */
  async plan(context: PlannerContext): Promise<PlannerResult> {
    const systemPrompt = this.buildSystemPrompt(context);
    const userPrompt = this.buildUserPrompt(context);

    this.logger.debug(`Planning step, stepsRemaining: ${context.stepsRemaining}`);

    try {
      const response = await this.llmProvider.callWithTools({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        tools: context.tools,
        temperature: context.temperature ?? 0.7,
        maxTokens: context.maxTokens ?? 4096,
      });

      const shouldFinish =
        (response.finishReason === 'stop' &&
          (!response.toolCalls || response.toolCalls.length === 0)) ||
        context.stepsRemaining <= 1;

      this.logger.debug(
        `Plan result: ${response.toolCalls?.length || 0} tool calls, shouldFinish: ${shouldFinish}`
      );

      return {
        thought: response.thought,
        toolCalls: response.toolCalls as PlannerToolCall[] | undefined,
        shouldFinish,
      };
    } catch (error) {
      this.logger.error(
        `Planning failed: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }

  /**
   * Build system prompt
   */
  private buildSystemPrompt(context: PlannerContext): string {
    if (this.customPrompt) {
      return this.customPrompt;
    }

    const toolsList = context.tools
      .map((t) => `- ${t.function.name}: ${t.function.description}`)
      .join('\n');

    const memoryStr = JSON.stringify(context.workingMemory, null, 2);

    return `You are an autonomous agent helping to accomplish the following objective:

Objective: ${context.objective}

You have access to the following tools:
${toolsList}

Current working memory:
${memoryStr}

Your task is to think about what to do next and use the available tools to accomplish the objective.
When responding, be concise and focus on the next action to take.
If you have achieved the objective, respond with "DONE: [summary of what was accomplished]" and no tool calls.`;
  }

  /**
   * Build user prompt
   */
  private buildUserPrompt(context: PlannerContext): string {
    let prompt = `Steps completed: ${context.stepHistory.length}
Steps remaining: ${context.stepsRemaining}

${context.stepHistory.length > 0 ? 'Execution history:\n' : ''}`;

    for (const step of context.stepHistory) {
      prompt += `\nStep ${step.stepNo}: ${step.thought}`;
      if (step.toolName) {
        prompt += `\n  Tool: ${step.toolName}`;
        if (step.toolInput) {
          prompt += `\n  Input: ${JSON.stringify(step.toolInput)}`;
        }
        if (step.observation) {
          prompt += `\n  Result: ${step.observation}`;
        }
      }
    }

    prompt += '\n\nWhat is the next action?';

    return prompt;
  }
}
