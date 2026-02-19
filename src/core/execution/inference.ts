/**
 * Custom Inference Service
 *
 * Execute LLM inference using a named agent's prompt template.
 * Resolves the active agent by name and uses its configuration.
 */

import { z } from 'zod';
import type { DrizzleDB } from '../../db/client.js';
import type { UsageInfo } from '../providers/types.js';
import { AgentsService } from './agents.js';
import { LlmExecuteTool } from '../tools/llmExecute.js';
import { NotFoundError } from '../../errors/index.js';
import { getLogger } from '../../util/logger.js';

const attachmentSchema = z.object({
  filename: z.string(),
  content: z.string(),
  mimeType: z.string().optional(),
});

const paramsSchema = z.object({
  max_tokens: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
  reasoning_effort: z.enum(['low', 'medium', 'high']).optional(),
});

const overridesSchema = z.object({
  provider: z.enum(['openai', 'openrouter', 'ollama']).optional(),
  model: z.string().optional(),
});

export const CustomInferenceInputSchema = z.object({
  agentName: z.string().describe('Name of the agent to use (resolves to active version)'),
  prompt: z.string().describe('User prompt to send'),
  attachments: z.array(attachmentSchema).optional().describe('Optional file attachments'),
  params: paramsSchema.optional().describe('Optional LLM parameters'),
  overrides: overridesSchema.optional().describe('Optional provider/model overrides'),
});

export type CustomInferenceInput = z.infer<typeof CustomInferenceInputSchema>;

export interface CustomInferenceOutput {
  agentName: string;
  agentVersion: string;
  response: string;
  usage?: UsageInfo;
  costUsd?: number;
  finishReason?: string;
  generationStats?: Record<string, unknown>;
  inputFiles?: Array<{ filename: string; mimeType?: string }>;
  params: {
    provider: string;
    model: string;
    max_tokens?: number;
    temperature?: number;
    reasoning_effort?: 'low' | 'medium' | 'high';
  };
}

export interface InferenceContext {
  db: DrizzleDB;
  runId?: string;
  artifactsDir?: string;
  apiKey?: string;
  ollamaBaseUrl?: string;
  skipGenerationStats?: boolean;
  defaults?: {
    maxTokens?: number;
    temperature?: number;
    reasoningEffort?: 'low' | 'medium' | 'high';
    provider?: 'openai' | 'openrouter' | 'ollama';
    model?: string;
  };
}

/**
 * Execute custom inference using a named agent
 *
 * Resolves the active agent by name and uses its prompt template as system prompt.
 * Supports file attachments and optional parameter overrides.
 *
 * @example
 * ```typescript
 * const result = await customInference({
 *   agentName: 'summarizer',
 *   prompt: 'Summarize the attached document',
 *   attachments: [{ filename: 'doc.txt', content: 'base64...' }],
 * }, { db });
 * ```
 */
export async function customInference(
  input: CustomInferenceInput,
  ctx: InferenceContext
): Promise<CustomInferenceOutput> {
  const logger = getLogger();
  const validatedInput = CustomInferenceInputSchema.parse(input);

  const agentsService = new AgentsService(ctx.db);
  const agent = await agentsService.resolve(validatedInput.agentName);

  if (!agent) {
    throw new NotFoundError('Agent', validatedInput.agentName);
  }

  const provider = validatedInput.overrides?.provider || agent.provider || ctx.defaults?.provider || 'openai';
  const model = validatedInput.overrides?.model || agent.model || ctx.defaults?.model || 'gpt-4o';
  const maxTokens = validatedInput.params?.max_tokens ?? ctx.defaults?.maxTokens;
  const temperature = validatedInput.params?.temperature ?? ctx.defaults?.temperature ?? 0.7;
  const reasoningEffort = validatedInput.params?.reasoning_effort ?? ctx.defaults?.reasoningEffort;

  logger.info({
    agentName: agent.name,
    agentVersion: agent.version,
    provider,
    model,
    hasAttachments: !!validatedInput.attachments?.length,
    fileCount: validatedInput.attachments?.length ?? 0,
  }, 'Executing custom inference');

  const llmExecuteTool = new LlmExecuteTool({ apiKey: ctx.apiKey, baseUrl: ctx.ollamaBaseUrl, skipGenerationStats: ctx.skipGenerationStats });

  const result = await llmExecuteTool.execute(
    {
      provider: provider as 'openai' | 'openrouter' | 'ollama',
      model,
      task: agent.systemPrompt,
      prompt: validatedInput.prompt,
      attachments: validatedInput.attachments,
      params: {
        max_tokens: maxTokens,
        temperature,
        reasoning_effort: reasoningEffort,
      },
    },
    {
      logger,
      runId: ctx.runId || `inference-${Date.now()}`,
      subStepId: `step-${Date.now()}`,
      artifactsDir: ctx.artifactsDir || '.',
    }
  );

  logger.info({ agentName: agent.name }, 'Custom inference completed');

  return {
    agentName: agent.name,
    agentVersion: agent.version,
    response: result.content,
    usage: result.usage ? {
      promptTokens: result.usage.promptTokens ?? 0,
      completionTokens: result.usage.completionTokens ?? 0,
      totalTokens: result.usage.totalTokens ?? 0,
    } : undefined,
    costUsd: result.costUsd,
    finishReason: result.finishReason,
    generationStats: result.generationStats,
    inputFiles: validatedInput.attachments?.map((f) => ({
      filename: f.filename,
      mimeType: f.mimeType,
    })),
    params: {
      provider,
      model,
      max_tokens: maxTokens,
      temperature,
      reasoning_effort: reasoningEffort,
    },
  };
}
