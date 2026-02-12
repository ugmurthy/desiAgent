/**
 * OpenAI LLM Provider
 *
 * Implements LLMProvider interface for OpenAI API
 */

import OpenAI from 'openai';
import type {
  LLMProvider,
  ChatParams,
  ChatResponse,
  LLMCallParams,
  LLMResponse,
} from './types.js';
import { getLogger } from '../../util/logger.js';
import { LLMProviderError } from '../../errors/index.js';

/**
 * OpenAI Provider
 */
export class OpenAIProvider implements LLMProvider {
  name = 'openai';
  private client: OpenAI;
  private model: string;
  private defaultMaxTokens: number;
  private logger = getLogger();

  constructor(
    apiKey: string,
    model: string = 'gpt-4o',
    defaultMaxTokens: number = 4096
  ) {
    if (!apiKey) {
      throw new Error('OpenAI API key is required');
    }

    this.client = new OpenAI({ apiKey });
    this.model = model;
    this.defaultMaxTokens = defaultMaxTokens;
  }

  /**
   * Validate if model supports tool calling
   */
  async validateToolCallSupport(
    model: string
  ): Promise<{ supported: boolean; message?: string }> {
    // Models that support function calling/tools
    const toolSupportedModels = [
      'gpt-4',
      'gpt-4o',
      'gpt-4-turbo',
      'gpt-3.5-turbo',
    ];

    const normalizedModel = model.toLowerCase();
    const supported = toolSupportedModels.some((m) =>
      normalizedModel.includes(m)
    );

    if (!supported) {
      return {
        supported: false,
        message: `Model ${model} may not support tool calling. Recommended models: ${toolSupportedModels.join(', ')}`,
      };
    }

    return { supported: true };
  }

  /**
   * Simple chat call (no tools)
   */
  async chat(params: ChatParams): Promise<ChatResponse> {
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: params.messages as any,
        temperature: params.temperature ?? 0.7,
        max_tokens: params.maxTokens ?? this.defaultMaxTokens,
      }, { signal: params.abortSignal });

      const content = response.choices[0]?.message.content || '';

      const usage = response.usage
        ? {
            promptTokens: response.usage.prompt_tokens,
            completionTokens: response.usage.completion_tokens,
            totalTokens: response.usage.total_tokens,
          }
        : undefined;

      this.logger.debug(
        `OpenAI chat response (${response.model}): ${content.length} chars`
      );

      return { content, usage };
    } catch (error) {
      throw new LLMProviderError(
        `OpenAI chat call failed: ${error instanceof Error ? error.message : String(error)}`,
        'openai',
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Call with tool support
   */
  async callWithTools(params: LLMCallParams): Promise<LLMResponse> {
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: params.messages as any,
        tools: params.tools as any,
        temperature: params.temperature ?? 0.7,
        max_tokens: params.maxTokens ?? this.defaultMaxTokens,
      }, { signal: params.abortSignal });

      const choice = response.choices[0];
      const message = choice.message;

      // Extract tool calls
      const toolCalls = message.tool_calls?.map((tc: any) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments || '{}'),
      }));

      const finishReason =
        choice.finish_reason === 'tool_calls' ? 'tool_calls' : 'stop';

      const usage = response.usage
        ? {
            promptTokens: response.usage.prompt_tokens,
            completionTokens: response.usage.completion_tokens,
            totalTokens: response.usage.total_tokens,
          }
        : undefined;

      this.logger.debug(
        `OpenAI callWithTools response: ${toolCalls?.length || 0} tool calls`
      );

      return {
        thought: message.content || '',
        toolCalls,
        finishReason,
        usage,
      };
    } catch (error) {
      throw new LLMProviderError(
        `OpenAI API call failed: ${error instanceof Error ? error.message : String(error)}`,
        'openai',
        error instanceof Error ? error : undefined
      );
    }
  }
}
