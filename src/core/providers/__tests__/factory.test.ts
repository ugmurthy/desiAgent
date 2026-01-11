/**
 * Factory Provider Tests
 *
 * Tests for LLM provider factory creation and validation
 */

import { describe, it, expect, vi } from 'vitest';
import { createLLMProvider, validateLLMSetup } from '../factory.js';
import { OpenAIProvider } from '../openai.js';
import { OllamaProvider } from '../ollama.js';

describe('createLLMProvider', () => {
  it('creates OpenAI provider with valid config', () => {
    const provider = createLLMProvider({
      provider: 'openai',
      apiKey: 'test-key-123',
      model: 'gpt-4o',
    });

    expect(provider).toBeInstanceOf(OpenAIProvider);
    expect(provider.name).toBe('openai');
  });

  it('throws error when OpenAI provider missing apiKey', () => {
    expect(() => {
      createLLMProvider({
        provider: 'openai',
        model: 'gpt-4o',
      });
    }).toThrow('OPENAI_API_KEY is required');
  });

  it('creates Ollama provider with valid config', () => {
    const provider = createLLMProvider({
      provider: 'ollama',
      baseUrl: 'http://localhost:11434',
      model: 'mistral',
    });

    expect(provider).toBeInstanceOf(OllamaProvider);
    expect(provider.name).toBe('ollama');
  });

  it('uses default model for OpenAI when not specified', () => {
    const provider = createLLMProvider({
      provider: 'openai',
      apiKey: 'test-key',
    });

    expect(provider).toBeInstanceOf(OpenAIProvider);
  });

  it('uses default baseUrl for Ollama when not specified', () => {
    const provider = createLLMProvider({
      provider: 'ollama',
    });

    expect(provider).toBeInstanceOf(OllamaProvider);
  });

  it('throws error for unsupported provider', () => {
    expect(() => {
      createLLMProvider({
        provider: 'invalid' as any,
      });
    }).toThrow('Unsupported LLM provider');
  });
});

describe('validateLLMSetup', () => {
  it('validates OpenAI provider tool support', async () => {
    const provider = new OpenAIProvider('test-key', 'gpt-4o');
    await expect(
      validateLLMSetup(provider, 'gpt-4o')
    ).resolves.not.toThrow();
  });

  it('warns about unsupported model', async () => {
    const provider = new OllamaProvider();
    await expect(
      validateLLMSetup(provider, 'mistral')
    ).resolves.not.toThrow();
  });

  it('validates multiple OpenAI models', async () => {
    const provider = new OpenAIProvider('test-key');
    const models = ['gpt-4', 'gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo'];

    for (const model of models) {
      const result = await provider.validateToolCallSupport(model);
      expect(result.supported).toBe(true);
    }
  });

  it('rejects unsupported OpenAI model', async () => {
    const provider = new OpenAIProvider('test-key');
    const result = await provider.validateToolCallSupport('gpt-2');
    expect(result.supported).toBe(false);
  });
});
