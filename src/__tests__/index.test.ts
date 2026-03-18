/**
 * Tests for src/index.ts
 *
 * Covers: detectImageMime, validateConfig, DesiAgentClientImpl,
 * setupDesiAgent error paths, and re-exports.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock heavy dependencies before any imports that trigger them
vi.mock('../util/logger.js', () => ({
  initializeLogger: vi.fn(),
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../db/client.js', () => ({
  getDatabase: vi.fn(() => ({})),
  closeDatabase: vi.fn(),
}));

vi.mock('../services/initDB.js', () => ({
  seedAgents: vi.fn(() => 0),
  initDB: vi.fn(() => ({ seeded: 0 })),
}));

vi.mock('../core/tools/index.js', () => ({
  createToolRegistry: vi.fn(() => ({
    getAllDefinitions: () => [],
  })),
  ToolExecutor: vi.fn(),
}));

vi.mock('../core/providers/factory.js', () => ({
  createLLMProvider: vi.fn(() => ({
    name: 'mock',
    chat: vi.fn(),
    callWithTools: vi.fn(),
    validateToolCallSupport: vi.fn(),
  })),
  validateLLMSetup: vi.fn(async () => {}),
}));

vi.mock('../core/skills/registry.js', () => ({
  SkillRegistry: vi.fn(() => ({
    discover: vi.fn(async () => {}),
    getAll: vi.fn(() => []),
  })),
}));

vi.mock('../core/execution/agents.js', () => ({
  AgentsService: vi.fn(() => ({})),
}));

vi.mock('../core/execution/dags.js', () => ({
  DAGsService: vi.fn(() => ({})),
}));

vi.mock('../core/execution/executions.js', () => ({
  ExecutionsService: vi.fn(() => ({})),
}));

vi.mock('../core/execution/tools.js', () => ({
  ToolsService: vi.fn(() => ({})),
}));

vi.mock('../core/execution/skills.js', () => ({
  SkillsService: vi.fn(() => ({})),
}));

vi.mock('../core/execution/artifacts.js', () => ({
  ArtifactsService: vi.fn(() => ({})),
}));

vi.mock('../core/execution/costs.js', () => ({
  CostsService: vi.fn(() => ({})),
}));

vi.mock('../core/workers/statsQueue.js', () => ({
  StatsQueue: vi.fn(() => ({
    start: vi.fn(),
    terminate: vi.fn(async () => {}),
  })),
}));

vi.mock('../core/execution/dagScheduler.js', () => ({
  NodeCronDagScheduler: vi.fn(() => ({
    hydrateFromDatabase: vi.fn(async () => {}),
    stopAll: vi.fn(),
  })),
}));

import { setupDesiAgent } from '../index.js';
import { ConfigurationError, InitializationError } from '../errors/index.js';

describe('src/index.ts', () => {
  describe('detectImageMime (via executeTask)', () => {
    it('detects JPEG from buffer magic bytes', async () => {
      const client = await setupDesiAgent({
        llmProvider: 'ollama',
        modelName: 'test',
        databasePath: ':memory:',
        autoStartScheduler: false,
      });

      const { createLLMProvider } = await import('../core/providers/factory.js');
      const mockChat = vi.fn(async () => ({
        content: 'response',
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        costUsd: 0,
      }));
      (createLLMProvider as any).mockReturnValue({
        name: 'mock',
        chat: mockChat,
      });

      const agent = {
        name: 'test-agent',
        version: '1.0.0',
        systemPrompt: 'You are a test agent',
      } as any;

      // JPEG magic: 0xFF 0xD8
      const jpegBuf = Buffer.from([0xFF, 0xD8, 0x00, 0x00]);
      const result = await client.executeTask(agent, 'describe image', [jpegBuf]);

      expect(result.agentName).toBe('test-agent');
      expect(result.response).toBe('response');

      // Verify the image was attached with correct mime
      const chatCall = mockChat.mock.calls[0][0];
      const userMsg = chatCall.messages[1];
      expect(Array.isArray(userMsg.content)).toBe(true);
      const imagePart = userMsg.content.find((p: any) => p.type === 'image_url');
      expect(imagePart.image_url.url).toContain('data:image/jpeg;base64,');

      await client.shutdown();
    });

    it('detects PNG from buffer magic bytes', async () => {
      const client = await setupDesiAgent({
        llmProvider: 'ollama',
        modelName: 'test',
        databasePath: ':memory:',
        autoStartScheduler: false,
      });

      const { createLLMProvider } = await import('../core/providers/factory.js');
      const mockChat = vi.fn(async () => ({
        content: 'png response',
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        costUsd: 0,
      }));
      (createLLMProvider as any).mockReturnValue({
        name: 'mock',
        chat: mockChat,
      });

      const agent = {
        name: 'test-agent',
        version: '1.0.0',
        systemPrompt: 'prompt',
      } as any;

      // PNG magic: 0x89 0x50 0x4E 0x47
      const pngBuf = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x00]);
      await client.executeTask(agent, 'describe', [pngBuf]);

      const chatCall = mockChat.mock.calls[0][0];
      const imagePart = chatCall.messages[1].content.find((p: any) => p.type === 'image_url');
      expect(imagePart.image_url.url).toContain('data:image/png;base64,');

      await client.shutdown();
    });

    it('detects GIF from buffer magic bytes', async () => {
      const client = await setupDesiAgent({
        llmProvider: 'ollama',
        modelName: 'test',
        databasePath: ':memory:',
        autoStartScheduler: false,
      });

      const { createLLMProvider } = await import('../core/providers/factory.js');
      const mockChat = vi.fn(async () => ({
        content: 'gif response',
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        costUsd: 0,
      }));
      (createLLMProvider as any).mockReturnValue({
        name: 'mock',
        chat: mockChat,
      });

      const agent = {
        name: 'test-agent',
        version: '1.0.0',
        systemPrompt: 'prompt',
      } as any;

      // GIF magic: 0x47 0x49 0x46
      const gifBuf = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39]);
      await client.executeTask(agent, 'describe', [gifBuf]);

      const chatCall = mockChat.mock.calls[0][0];
      const imagePart = chatCall.messages[1].content.find((p: any) => p.type === 'image_url');
      expect(imagePart.image_url.url).toContain('data:image/gif;base64,');

      await client.shutdown();
    });

    it('detects WebP from buffer magic bytes', async () => {
      const client = await setupDesiAgent({
        llmProvider: 'ollama',
        modelName: 'test',
        databasePath: ':memory:',
        autoStartScheduler: false,
      });

      const { createLLMProvider } = await import('../core/providers/factory.js');
      const mockChat = vi.fn(async () => ({
        content: 'webp response',
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        costUsd: 0,
      }));
      (createLLMProvider as any).mockReturnValue({
        name: 'mock',
        chat: mockChat,
      });

      const agent = {
        name: 'test-agent',
        version: '1.0.0',
        systemPrompt: 'prompt',
      } as any;

      // WebP magic: RIFF....WEBP
      const webpBuf = Buffer.alloc(12);
      webpBuf[0] = 0x52; webpBuf[1] = 0x49; webpBuf[2] = 0x46; webpBuf[3] = 0x46;
      webpBuf[8] = 0x57; webpBuf[9] = 0x45; webpBuf[10] = 0x42; webpBuf[11] = 0x50;
      await client.executeTask(agent, 'describe', [webpBuf]);

      const chatCall = mockChat.mock.calls[0][0];
      const imagePart = chatCall.messages[1].content.find((p: any) => p.type === 'image_url');
      expect(imagePart.image_url.url).toContain('data:image/webp;base64,');

      await client.shutdown();
    });

    it('falls back to image/jpeg for unknown format', async () => {
      const client = await setupDesiAgent({
        llmProvider: 'ollama',
        modelName: 'test',
        databasePath: ':memory:',
        autoStartScheduler: false,
      });

      const { createLLMProvider } = await import('../core/providers/factory.js');
      const mockChat = vi.fn(async () => ({
        content: 'unknown response',
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        costUsd: 0,
      }));
      (createLLMProvider as any).mockReturnValue({
        name: 'mock',
        chat: mockChat,
      });

      const agent = {
        name: 'test-agent',
        version: '1.0.0',
        systemPrompt: 'prompt',
      } as any;

      // Random bytes - no known magic
      const unknownBuf = Buffer.from([0x00, 0x01, 0x02, 0x03]);
      await client.executeTask(agent, 'describe', [unknownBuf]);

      const chatCall = mockChat.mock.calls[0][0];
      const imagePart = chatCall.messages[1].content.find((p: any) => p.type === 'image_url');
      expect(imagePart.image_url.url).toContain('data:image/jpeg;base64,');

      await client.shutdown();
    });
  });

  describe('executeTask', () => {
    it('sends plain text when no files provided', async () => {
      const client = await setupDesiAgent({
        llmProvider: 'ollama',
        modelName: 'test',
        databasePath: ':memory:',
        autoStartScheduler: false,
      });

      const { createLLMProvider } = await import('../core/providers/factory.js');
      const mockChat = vi.fn(async () => ({
        content: 'text response',
        usage: { promptTokens: 5, completionTokens: 10, totalTokens: 15 },
        costUsd: 0.001,
      }));
      (createLLMProvider as any).mockReturnValue({
        name: 'mock',
        chat: mockChat,
      });

      const agent = {
        name: 'text-agent',
        version: '2.0.0',
        systemPrompt: 'You are helpful',
        constraints: { temperature: 0.5, maxTokens: 100 },
      } as any;

      const result = await client.executeTask(agent, 'hello world');

      expect(result.agentName).toBe('text-agent');
      expect(result.agentVersion).toBe('2.0.0');
      expect(result.response).toBe('text response');
      expect(result.usage).toEqual({ promptTokens: 5, completionTokens: 10, totalTokens: 15 });
      expect(result.costUsd).toBe(0.001);
      expect(result.finishReason).toBe('stop');

      // Verify plain string content (no array)
      const chatCall = mockChat.mock.calls[0][0];
      expect(chatCall.messages[1].content).toBe('hello world');
      expect(chatCall.temperature).toBe(0.5);
      expect(chatCall.maxTokens).toBe(100);

      await client.shutdown();
    });

    it('uses agent provider/model overrides', async () => {
      const client = await setupDesiAgent({
        llmProvider: 'ollama',
        modelName: 'default-model',
        databasePath: ':memory:',
        autoStartScheduler: false,
      });

      const { createLLMProvider } = await import('../core/providers/factory.js');
      const mockChat = vi.fn(async () => ({
        content: 'ok',
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        costUsd: 0,
      }));
      (createLLMProvider as any).mockReturnValue({
        name: 'mock',
        chat: mockChat,
      });

      const agent = {
        name: 'custom-agent',
        version: '1.0.0',
        systemPrompt: 'prompt',
        provider: 'openai',
        model: 'gpt-4o',
      } as any;

      const result = await client.executeTask(agent, 'task');
      expect(result.provider).toBe('openai');
      expect(result.model).toBe('gpt-4o');

      await client.shutdown();
    });

    it('uses default temperature when no constraints', async () => {
      const client = await setupDesiAgent({
        llmProvider: 'ollama',
        modelName: 'test',
        databasePath: ':memory:',
        autoStartScheduler: false,
      });

      const { createLLMProvider } = await import('../core/providers/factory.js');
      const mockChat = vi.fn(async () => ({
        content: 'ok',
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        costUsd: 0,
      }));
      (createLLMProvider as any).mockReturnValue({
        name: 'mock',
        chat: mockChat,
      });

      const agent = {
        name: 'no-constraints',
        version: '1.0.0',
        systemPrompt: 'prompt',
      } as any;

      await client.executeTask(agent, 'task');

      const chatCall = mockChat.mock.calls[0][0];
      expect(chatCall.temperature).toBe(0.7);
      expect(chatCall.maxTokens).toBeUndefined();

      await client.shutdown();
    });
  });

  describe('validateConfig (via setupDesiAgent)', () => {
    it('throws ConfigurationError for invalid config', async () => {
      await expect(
        setupDesiAgent({
          llmProvider: 'invalid-provider' as any,
          modelName: 'test',
        })
      ).rejects.toThrow(ConfigurationError);
    });

    it('throws ConfigurationError for missing modelName', async () => {
      await expect(
        setupDesiAgent({
          llmProvider: 'openai',
        } as any)
      ).rejects.toThrow();
    });
  });

  describe('setupDesiAgent', () => {
    it('initializes successfully with minimal ollama config', async () => {
      const client = await setupDesiAgent({
        llmProvider: 'ollama',
        modelName: 'mistral',
        databasePath: ':memory:',
        autoStartScheduler: false,
      });

      expect(client).toBeDefined();
      expect(client.version).toBeDefined();
      expect(client.agents).toBeDefined();
      expect(client.dags).toBeDefined();
      expect(client.executions).toBeDefined();
      expect(client.tools).toBeDefined();
      expect(client.skills).toBeDefined();
      expect(client.artifacts).toBeDefined();
      expect(client.costs).toBeDefined();

      await client.shutdown();
    });

    it('wraps unexpected errors in InitializationError', async () => {
      const { validateLLMSetup } = await import('../core/providers/factory.js');
      (validateLLMSetup as any).mockRejectedValueOnce(new Error('LLM connection failed'));

      await expect(
        setupDesiAgent({
          llmProvider: 'ollama',
          modelName: 'test',
          databasePath: ':memory:',
          autoStartScheduler: false,
        })
      ).rejects.toThrow(InitializationError);
    });

    it('re-throws ConfigurationError without wrapping', async () => {
      try {
        await setupDesiAgent({
          llmProvider: 'bad' as any,
          modelName: 'test',
        });
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigurationError);
        expect(error).not.toBeInstanceOf(InitializationError);
      }
    });
  });

  describe('shutdown', () => {
    it('calls closeDatabase on shutdown', async () => {
      const { closeDatabase } = await import('../db/client.js');
      const client = await setupDesiAgent({
        llmProvider: 'ollama',
        modelName: 'test',
        databasePath: ':memory:',
        autoStartScheduler: false,
      });

      await client.shutdown();
      expect(closeDatabase).toHaveBeenCalled();
    });
  });

  describe('re-exports', () => {
    it('re-exports error classes', async () => {
      const index = await import('../index.js');
      expect(index.ConfigurationError).toBeDefined();
      expect(index.InitializationError).toBeDefined();
      expect(index.ExecutionError).toBeDefined();
      expect(index.ValidationError).toBeDefined();
      expect(index.NotFoundError).toBeDefined();
      expect(index.DatabaseError).toBeDefined();
      expect(index.LLMProviderError).toBeDefined();
      expect(index.ToolError).toBeDefined();
      expect(index.TimeoutError).toBeDefined();
      expect(index.DesiAgentError).toBeDefined();
    });

    it('re-exports DesiAgentConfigSchema and resolveConfig', async () => {
      const index = await import('../index.js');
      expect(index.DesiAgentConfigSchema).toBeDefined();
      expect(index.resolveConfig).toBeDefined();
    });

    it('re-exports ExecutionStatus', async () => {
      const index = await import('../index.js');
      expect(index.ExecutionStatus).toBeDefined();
    });

    it('re-exports utility functions', async () => {
      const index = await import('../index.js');
      expect(index.extractCodeBlock).toBeDefined();
      expect(index.extractJsonCodeBlock).toBeDefined();
      expect(index.renumberSubTasks).toBeDefined();
      expect(index.truncate).toBeDefined();
      expect(index.truncateForLog).toBeDefined();
      expect(index.parseDate).toBeDefined();
      expect(index.formatDateByGroup).toBeDefined();
      expect(index.validateCronExpression).toBeDefined();
    });

    it('re-exports service classes', async () => {
      const index = await import('../index.js');
      expect(index.DAGsService).toBeDefined();
      expect(index.ExecutionsService).toBeDefined();
      expect(index.CostsService).toBeDefined();
      expect(index.AgentsService).toBeDefined();
      expect(index.ToolsService).toBeDefined();
      expect(index.SkillsService).toBeDefined();
      expect(index.ArtifactsService).toBeDefined();
    });

    it('re-exports DAG schemas', async () => {
      const index = await import('../index.js');
      expect(index.DecomposerJobSchema).toBeDefined();
      expect(index.SubTaskSchema).toBeDefined();
    });

    it('re-exports SkillRegistry and detector', async () => {
      const index = await import('../index.js');
      expect(index.SkillRegistry).toBeDefined();
      expect(index.MinimalSkillDetector).toBeDefined();
    });

    it('re-exports customInference', async () => {
      const index = await import('../index.js');
      expect(index.customInference).toBeDefined();
      expect(index.CustomInferenceInputSchema).toBeDefined();
    });

    it('re-exports sendEmailTool', async () => {
      const index = await import('../index.js');
      expect(index.sendEmailTool).toBeDefined();
      expect(index.SendEmailInputSchema).toBeDefined();
    });

    it('re-exports StatsQueue', async () => {
      const index = await import('../index.js');
      expect(index.StatsQueue).toBeDefined();
    });

    it('re-exports NodeCronDagScheduler', async () => {
      const index = await import('../index.js');
      expect(index.NodeCronDagScheduler).toBeDefined();
    });

    it('re-exports initDB and seedAgents', async () => {
      const index = await import('../index.js');
      expect(index.initDB).toBeDefined();
      expect(index.seedAgents).toBeDefined();
    });
  });
});
