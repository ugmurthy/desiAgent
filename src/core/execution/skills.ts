import { resolve } from 'path';
import { LlmExecuteTool } from '../tools/llmExecute.js';
import type { SkillMeta, SkillRegistry } from '../skills/registry.js';
import type {
  SkillTestInput,
  SkillTestResult,
  SkillTestableProvider,
  SkillListOptions,
} from '../../types/client.js';
import { NotFoundError, ValidationError } from '../../errors/index.js';
import { getLogger } from '../../util/logger.js';

export interface SkillsServiceDeps {
  skillRegistry: SkillRegistry;
  defaultProvider: SkillTestableProvider;
  defaultModel: string;
  artifactsDir: string;
  apiKey?: string;
  ollamaBaseUrl?: string;
  skipGenerationStats?: boolean;
}

type ExecutableSkillHandler = (params: Record<string, unknown>) => Promise<unknown>;

function isSkillProvider(value: string | undefined): value is SkillTestableProvider {
  return value === 'openai' || value === 'openrouter' || value === 'ollama';
}

export class SkillsService {
  private skillRegistry: SkillRegistry;
  private defaultProvider: SkillTestableProvider;
  private defaultModel: string;
  private artifactsDir: string;
  private apiKey?: string;
  private ollamaBaseUrl?: string;
  private skipGenerationStats?: boolean;
  private logger = getLogger();

  constructor(deps: SkillsServiceDeps) {
    this.skillRegistry = deps.skillRegistry;
    this.defaultProvider = deps.defaultProvider;
    this.defaultModel = deps.defaultModel;
    this.artifactsDir = deps.artifactsDir;
    this.apiKey = deps.apiKey;
    this.ollamaBaseUrl = deps.ollamaBaseUrl;
    this.skipGenerationStats = deps.skipGenerationStats;
  }

  async list(options?: SkillListOptions): Promise<SkillMeta[]> {
    if (options?.reload) {
      await this.skillRegistry.refresh();
    }

    return this.skillRegistry.getAll();
  }

  async test(input: SkillTestInput): Promise<SkillTestResult> {
    if (!input.name?.trim()) {
      throw new ValidationError('Skill name is required', 'name', input.name);
    }

    if (input.reload) {
      await this.skillRegistry.refresh();
    }

    const skill = this.skillRegistry.getByName(input.name);
    if (!skill) {
      throw new NotFoundError('Skill', input.name);
    }

    const startedAt = Date.now();

    if (skill.type === 'executable') {
      const output = await this.executeExecutableSkill(skill, input.params ?? {});

      return {
        name: skill.name,
        type: skill.type,
        source: skill.source,
        durationMs: Date.now() - startedAt,
        output,
      };
    }

    if (!input.prompt?.trim()) {
      throw new ValidationError(
        `Context skill "${skill.name}" requires a prompt`,
        'prompt',
        input.prompt,
      );
    }

    const output = await this.executeContextSkill(skill, input);

    return {
      name: skill.name,
      type: skill.type,
      source: skill.source,
      providerUsed: output.providerUsed,
      modelUsed: output.modelUsed,
      durationMs: Date.now() - startedAt,
      output: output.content,
      usage: output.usage,
      costUsd: output.costUsd,
    };
  }

  private async executeExecutableSkill(
    skill: SkillMeta,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    const handlerPath = resolve(skill.filePath, '..', 'handler.ts');
    try {
      const mod = await import(`file://${handlerPath}`);
      const handler = mod.default ?? mod.handler;

      if (typeof handler !== 'function') {
        throw new ValidationError(
          `Skill "${skill.name}" is not executable or missing handler`,
          'handler',
          handlerPath,
        );
      }

      return (handler as ExecutableSkillHandler)(params);
    } catch (error) {
      if (error instanceof ValidationError) {
        throw error;
      }

      throw new ValidationError(
        `Skill "${skill.name}" is not executable or missing handler`,
        'handler',
        handlerPath,
      );
    }
  }

  private async executeContextSkill(skill: SkillMeta, input: SkillTestInput): Promise<{
    providerUsed: SkillTestableProvider;
    modelUsed: string;
    content: string;
    usage?: {
      promptTokens?: number;
      completionTokens?: number;
      totalTokens?: number;
    };
    costUsd?: number;
  }> {
    const skillBody = await this.skillRegistry.loadContent(skill.name);
    if (!skillBody) {
      throw new NotFoundError('Skill', skill.name);
    }

    const providerFromSkill = isSkillProvider(skill.provider) ? skill.provider : undefined;
    const providerUsed = input.provider ?? providerFromSkill ?? this.defaultProvider;
    const modelUsed = input.model ?? skill.model ?? this.defaultModel;

    const llmExecuteTool = new LlmExecuteTool({
      apiKey: this.apiKey,
      baseUrl: this.ollamaBaseUrl,
      skipGenerationStats: this.skipGenerationStats,
    });

    const toolParams = (input.temperature !== undefined || input.maxTokens !== undefined)
      ? {
        temperature: input.temperature,
        max_tokens: input.maxTokens,
      }
      : undefined;

    const result = await llmExecuteTool.execute({
      provider: providerUsed,
      model: modelUsed,
      task: skillBody,
      prompt: input.prompt!,
      params: toolParams,
    }, {
      logger: this.logger,
      artifactsDir: this.artifactsDir,
      executionId: 'skill_test',
      subStepId: `skill_${skill.name}`,
    });

    return {
      providerUsed,
      modelUsed,
      content: result.content,
      usage: result.usage,
      costUsd: result.costUsd,
    };
  }
}
