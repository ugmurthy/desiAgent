/**
 * LLM Provider Factory
 *
 * Creates LLM providers based on configuration
 */

import type { LLMProvider } from './types.js';
import { OpenAIProvider } from './openai.js';
import { OllamaProvider } from './ollama.js';
import { OpenRouterProvider } from './openrouter.js';
import { getLogger } from '../../util/logger.js';

/**
 * Create an LLM provider based on configuration
 */
export function createLLMProvider(
  config: {
    provider: 'openai' | 'openrouter' | 'ollama';
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    maxTokens?: number;
  }
): LLMProvider {
  const logger = getLogger();

  if (config.provider === 'openai') {
    const apiKey = config.apiKey;

    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is required for openai provider');
    }

    const model = config.model || 'gpt-4o';
    const maxTokens = config.maxTokens || 4096;

    logger.info(`Creating OpenAI provider (model: ${model})`);
    return new OpenAIProvider(apiKey, model, maxTokens);
  }

  if (config.provider === 'openrouter') {
    const apiKey = config.apiKey || process.env.OPENROUTER_API_KEY;

    if (!apiKey) {
      throw new Error('OPENROUTER_API_KEY is required for openrouter provider');
    }

    const model = config.model || 'anthropic/claude-3.5-sonnet';
    const maxTokens = config.maxTokens || 4096;

    logger.info(`Creating OpenRouter provider (model: ${model})`);
    return new OpenRouterProvider(apiKey, model, maxTokens);
  }

  if (config.provider === 'ollama') {
    const baseUrl = config.baseUrl || 'http://localhost:11434';
    const model = config.model || 'mistral';
    const maxTokens = config.maxTokens || 4096;

    logger.info(`Creating Ollama provider (url: ${baseUrl}, model: ${model})`);
    return new OllamaProvider(baseUrl, model, maxTokens);
  }

  throw new Error(`Unsupported LLM provider: ${config.provider}`);
}

/**
 * Validate LLM setup
 */
export async function validateLLMSetup(
  provider: LLMProvider,
  model: string
): Promise<void> {
  const logger = getLogger();

  logger.info(`Validating ${provider.name} provider for model: ${model}`);

  const result = await provider.validateToolCallSupport(model);

  if (!result.supported) {
    logger.warn(
      `Model ${model} may not support tool calling: ${result.message}`
    );
  } else {
    logger.info(`Model ${model} supports tool calling`);
  }
}
