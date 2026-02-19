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
 * LLM Provider cache for reusing provider instances
 * Key format: "provider:model:maxTokens"
 */
const providerCache = new Map<string, LLMProvider>();

/**
 * Clear the provider cache
 */
export function clearProviderCache(): void {
  providerCache.clear();
}

/**
 * Create an LLM provider based on configuration (with caching)
 */
export function createLLMProvider(
  config: {
    provider: 'openai' | 'openrouter' | 'ollama';
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    maxTokens?: number;
    skipGenerationStats?: boolean;
  }
): LLMProvider {
  const logger = getLogger();
  
  const model = config.model || getDefaultModel(config.provider);
  const maxTokens = config.maxTokens || 4096;
  const skipStats = config.skipGenerationStats ? 'skip' : 'stats';
  const cacheKey = `${config.provider}:${model}:${maxTokens}:${skipStats}`;

  // Check cache first
  const cached = providerCache.get(cacheKey);
  if (cached) {
    logger.debug(`Provider cache hit: ${cacheKey}`);
    return cached;
  }

  let provider: LLMProvider;

  if (config.provider === 'openai') {
    const apiKey = config.apiKey;

    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is required for openai provider');
    }

    logger.info(`Creating OpenAI provider (model: ${model})`);
    provider = new OpenAIProvider(apiKey, model, maxTokens);
  } else if (config.provider === 'openrouter') {
    const apiKey = config.apiKey;

    if (!apiKey) {
      throw new Error('OPENROUTER_API_KEY is required for openrouter provider');
    }

    logger.info(`Creating OpenRouter provider (model: ${model}, skipGenerationStats: ${!!config.skipGenerationStats})`);
    provider = new OpenRouterProvider(apiKey, model, maxTokens, config.skipGenerationStats ?? false);
  } else if (config.provider === 'ollama') {
    const baseUrl = config.baseUrl || 'http://localhost:11434';

    logger.info(`Creating Ollama provider (url: ${baseUrl}, model: ${model})`);
    provider = new OllamaProvider(baseUrl, model, maxTokens);
  } else {
    throw new Error(`Unsupported LLM provider: ${config.provider}`);
  }

  // Cache the provider
  providerCache.set(cacheKey, provider);
  return provider;
}

function getDefaultModel(provider: string): string {
  switch (provider) {
    case 'openai': return 'gpt-4o';
    case 'openrouter': return 'anthropic/claude-3.5-sonnet';
    case 'ollama': return 'mistral';
    default: return 'gpt-4o';
  }
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
