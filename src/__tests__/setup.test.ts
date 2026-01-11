/**
 * Setup and Index Tests
 *
 * Tests for main library initialization and exports
 */

import { describe, it, expect, vi } from 'vitest';
import type { DesiAgentConfig } from '../types/config.js';

describe('Library Setup', () => {
  describe('Types and Configuration', () => {
    it('exports DesiAgentConfig type', () => {
      const config: DesiAgentConfig = {
        llmProvider: 'openai',
        openaiApiKey: 'test-key',
        modelName: 'gpt-4o',
      };

      expect(config.llmProvider).toBe('openai');
      expect(config.openaiApiKey).toBe('test-key');
      expect(config.modelName).toBe('gpt-4o');
    });

    it('accepts complete OpenAI config', () => {
      const config: DesiAgentConfig = {
        llmProvider: 'openai',
        openaiApiKey: 'key',
        modelName: 'gpt-4o',
        databasePath: '/tmp/test.db',
        logLevel: 'debug',
      };

      expect(config).toBeDefined();
    });

    it('accepts Ollama config', () => {
      const config: DesiAgentConfig = {
        llmProvider: 'ollama',
        modelName: 'mistral',
        ollamaBaseUrl: 'http://localhost:11434',
      };

      expect(config).toBeDefined();
    });
  });

  describe('Error Types', () => {
    it('exports custom error classes', async () => {
      const errors = await import('../errors/index.js');

      expect(errors.DesiAgentError).toBeDefined();
      expect(errors.ConfigurationError).toBeDefined();
      expect(errors.InitializationError).toBeDefined();
      expect(errors.ExecutionError).toBeDefined();
      expect(errors.ValidationError).toBeDefined();
      expect(errors.NotFoundError).toBeDefined();
      expect(errors.DatabaseError).toBeDefined();
      expect(errors.LLMProviderError).toBeDefined();
      expect(errors.ToolError).toBeDefined();
      expect(errors.TimeoutError).toBeDefined();
    });
  });

  describe('Type Exports', () => {
    it('exports execution status types', async () => {
      const types = await import('../types/index.js');

      expect(types.ExecutionStatus).toBeDefined();
    });

    it('exports goal, run, and step types', async () => {
      const types = await import('../types/index.js');

      // These should be exported type definitions
      expect(types).toBeDefined();
    });

    it('exports tool types', async () => {
      const types = await import('../types/index.js');

      expect(types).toBeDefined();
    });
  });
});
