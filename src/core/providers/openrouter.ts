/**
 * OpenRouter LLM Provider
 *
 * Implements LLMProvider interface for OpenRouter API (fetch-based)
 * Adapted from asyncAgent's openrouter-fetch.ts
 */

import type {
  LLMProvider,
  ChatParams,
  ChatResponse,
  LLMCallParams,
  LLMResponse,
  UsageInfo,
} from './types.js';
import { getLogger } from '../../util/logger.js';
import { LLMProviderError } from '../../errors/index.js';

const BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_TIMEOUT_MS = 60000;

type OpenAIToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

type OpenAIChoice = {
  index: number;
  message: {
    role: string;
    content: string | null;
    tool_calls?: OpenAIToolCall[];
  };
  finish_reason: string | null;
};

type OpenAIChatCompletionResponse = {
  id: string;
  choices: OpenAIChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

type OpenAIErrorResponse = {
  error?: {
    message?: string;
    type?: string;
    code?: string | number;
    param?: string;
  };
};

function buildHeaders(apiKey: string): Record<string, string> {
  return {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'HTTP-Referer': 'https://github.com/desiagent',
    'X-Title': 'DesiAgent',
  };
}

async function handleApiError(res: Response): Promise<never> {
  try {
    const body = await res.json() as OpenAIErrorResponse;
    const msg = body?.error?.message ?? `HTTP ${res.status}`;
    const err = new Error(msg);
    (err as any).status = res.status;
    (err as any).code = body?.error?.code;
    (err as any).type = body?.error?.type;
    throw err;
  } catch (parseError) {
    const text = await res.text().catch(() => '');
    const err = new Error(`HTTP ${res.status}: ${text || res.statusText}`);
    (err as any).status = res.status;
    throw err;
  }
}

function mapFinishReason(reason?: string | null): LLMResponse['finishReason'] {
  switch (reason) {
    case 'stop':
      return 'stop';
    case 'tool_calls':
      return 'tool_calls';
    case 'length':
      return 'length';
    case 'content_filter':
      return 'content_filter';
    default:
      return 'stop';
  }
}

function jsonParseSafe(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

function extractUsage(data: OpenAIChatCompletionResponse): UsageInfo | undefined {
  if (!data.usage) return undefined;
  
  return {
    promptTokens: data.usage.prompt_tokens,
    completionTokens: data.usage.completion_tokens,
    totalTokens: data.usage.total_tokens,
  };
}

function extractCostFromGenerationStats(generationStats: any): number | undefined {
  const totalCost = generationStats?.data?.total_cost;
  if (totalCost !== undefined && totalCost !== null) {
    return typeof totalCost === 'number' ? totalCost : parseFloat(totalCost);
  }
  return undefined;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

/**
 * OpenRouter Provider using native fetch
 */
export class OpenRouterProvider implements LLMProvider {
  name = 'openrouter';
  private apiKey: string;
  private model: string;
  private defaultMaxTokens: number;
  private logger = getLogger();

  constructor(
    apiKey: string,
    model: string,
    defaultMaxTokens: number = 4096
  ) {
    if (!apiKey) {
      throw new Error('OpenRouter API key is required');
    }

    this.apiKey = apiKey;
    this.model = model;
    this.defaultMaxTokens = defaultMaxTokens;
  }

  /**
   * Fetch generation stats from OpenRouter to get cost information
   */
  private async extractGenerationId(
    data: OpenAIChatCompletionResponse, 
    maxAttempts = 5, 
    initialDelayMs = 500
  ): Promise<{ data?: Record<string, any>; error?: string }> {
    const generationId = data.id;
    this.logger.debug({ url: `${BASE_URL}/generation?id=${generationId}` }, 'Generation url');
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const delayMs = initialDelayMs * Math.pow(1.5, attempt - 1);
        await new Promise(resolve => setTimeout(resolve, delayMs));
        
        const res = await fetch(
          `${BASE_URL}/generation?id=${generationId}`,
          { headers: buildHeaders(this.apiKey) }
        );
        
        if (!res.ok) {
          if (attempt === maxAttempts) {
            this.logger.warn({ status: res.status, generationId, attempts: attempt }, 'Failed to fetch generation details after max attempts');
            return { error: 'Failed to fetch details' };
          }
          this.logger.debug({ status: res.status, generationId, attempt }, 'Generation not ready, retrying...');
          continue;
        }
        
        const details = await res.json() as { data?: Record<string, any> };
        const detailsData = details.data;
        this.logger.debug({ generationId, attempt }, 'Successfully fetched generation details');
        
        const stats: Record<string, any> = {};
        const allowedKeys = ['latency', 'model', 'generation_time', 'finish_reason', 'native_finish_reason', 'total_cost', 'id'];
        
        for (const key of allowedKeys) {
          if (detailsData?.[key] !== undefined) {
            stats[key] = detailsData[key];
          }
        }
        
        return { data: stats };
      } catch (error) {
        if (attempt === maxAttempts) {
          this.logger.warn({ err: error, generationId, attempts: attempt }, 'Error fetching generation details after max attempts');
          return { error: String(error) };
        }
        this.logger.debug({ err: error, generationId, attempt }, 'Error fetching generation, retrying...');
      }
    }
    
    return { error: 'Max attempts reached' };
  }

  /**
   * Validate if model supports tool calling via OpenRouter's API
   */
  async validateToolCallSupport(
    model: string
  ): Promise<{ supported: boolean; message?: string }> {
    this.logger.debug({ model }, 'Validating model tool support');
    
    try {
      const res = await fetch(`${BASE_URL}/parameters/${model}`, {
        headers: buildHeaders(this.apiKey),
      });
      
      if (!res.ok) {
        if (res.status === 404) {
          return { 
            supported: false, 
            message: `Model ${model} not found on OpenRouter` 
          };
        }
        this.logger.warn({ status: res.status }, 'Unable to verify model capabilities');
        return { supported: true };
      }
      
      const data = await res.json() as { supported_parameters?: string[] };
      const toolsSupported = data.supported_parameters?.includes('tools') ?? false;
      
      this.logger.debug({ toolsSupported }, 'Model validation result');
      
      if (!toolsSupported) {
        return { 
          supported: false, 
          message: `Model ${model} does not support tool calling` 
        };
      }
      
      return { supported: true };
    } catch (error) {
      this.logger.warn({ err: error }, 'OpenRouter validation check failed, assuming tool support');
      return { supported: true };
    }
  }

  /**
   * Simple chat call (no tools)
   */
  async chat(params: ChatParams): Promise<ChatResponse> {
    try {
      const requestBody = {
        model: this.model,
        messages: params.messages,
        temperature: params.temperature ?? 0.7,
        max_tokens: params.maxTokens ?? this.defaultMaxTokens,
      };
      
      const res = await fetchWithTimeout(
        `${BASE_URL}/chat/completions`,
        {
          method: 'POST',
          headers: buildHeaders(this.apiKey),
          body: JSON.stringify(requestBody),
        }
      );

      if (!res.ok) {
        await handleApiError(res);
      }

      const data = await res.json() as OpenAIChatCompletionResponse;
      const usage = extractUsage(data);
      const content = data.choices[0]?.message?.content || '';

      const generation_stats = await this.extractGenerationId(data);
      const costUsd = extractCostFromGenerationStats(generation_stats);

      if (usage) {
        this.logger.debug({ usage, generation_stats, costUsd }, 'OpenRouter chat response metadata');
      }
      
      return { 
        content, 
        usage, 
        costUsd,
        generationStats: generation_stats?.data,
      };
    } catch (error) {
      throw new LLMProviderError(
        `OpenRouter chat call failed: ${error instanceof Error ? error.message : String(error)}`,
        'openrouter',
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Call with tool support
   */
  async callWithTools(params: LLMCallParams): Promise<LLMResponse> {
    try {
      const requestBody = {
        model: this.model,
        messages: params.messages,
        tools: params.tools,
        temperature: params.temperature ?? 0.7,
        max_tokens: params.maxTokens ?? this.defaultMaxTokens,
      };

      this.logger.debug({ model: this.model }, 'OpenRouter callWithTools request');

      const res = await fetchWithTimeout(
        `${BASE_URL}/chat/completions`,
        {
          method: 'POST',
          headers: buildHeaders(this.apiKey),
          body: JSON.stringify(requestBody),
        }
      );

      if (!res.ok) {
        await handleApiError(res);
      }

      const data = await res.json() as OpenAIChatCompletionResponse;
      const usage = extractUsage(data);
      
      const generation_stats = await this.extractGenerationId(data);
      const costUsd = extractCostFromGenerationStats(generation_stats);

      if (usage) {
        this.logger.debug({ usage, generation_stats, costUsd }, 'OpenRouter callWithTools response metadata');
      }

      const choice = data.choices[0];
      if (!choice) {
        throw new Error('No choices in response');
      }

      const message = choice.message;
      const thought = message.content || '';

      const toolCalls = message.tool_calls?.map(tc => ({
        id: tc.id,
        name: tc.function.name,
        arguments: jsonParseSafe(tc.function.arguments),
      }));

      return {
        thought,
        toolCalls,
        finishReason: mapFinishReason(choice.finish_reason),
        usage,
        costUsd,
        generationStats: generation_stats?.data,
      };
    } catch (error) {
      throw new LLMProviderError(
        `OpenRouter API call failed: ${error instanceof Error ? error.message : String(error)}`,
        'openrouter',
        error instanceof Error ? error : undefined
      );
    }
  }
}
