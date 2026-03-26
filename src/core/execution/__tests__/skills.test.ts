import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { SkillRegistry } from '../../skills/registry.js';
import { SkillsService } from '../skills.js';
import { NotFoundError, ValidationError } from '../../../errors/index.js';

const llmCalls: Array<Record<string, any>> = [];

vi.mock('../../tools/llmExecute.js', () => ({
  LlmExecuteTool: class {
    async execute(input: Record<string, any>): Promise<Record<string, any>> {
      llmCalls.push(input);
      return {
        content: `mock-response:${input.prompt}`,
        usage: { promptTokens: 12, completionTokens: 8, totalTokens: 20 },
        costUsd: 0.002,
      };
    }
  },
}));

vi.mock('../../../util/logger.js', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return {
    ...actual,
    homedir: () => '/tmp/desiagent-skills-service-fake-home-that-does-not-exist',
  };
});

let tempDir: string;

async function writeSkill(
  root: string,
  skillName: string,
  frontmatter: Record<string, string>,
  body = 'Default skill body',
): Promise<void> {
  const skillDir = join(root, '.agents', 'skills', skillName);
  await mkdir(skillDir, { recursive: true });

  const fm = Object.entries(frontmatter)
    .map(([key, value]) => `${key}: "${value}"`)
    .join('\n');

  await writeFile(
    join(skillDir, 'SKILL.md'),
    `---\n${fm}\n---\n\n${body}\n`,
  );
}

describe('SkillsService', () => {
  beforeEach(async () => {
    await mkdir(join(process.cwd(), 'tmp'), { recursive: true });
    tempDir = await mkdtemp(join(process.cwd(), 'tmp', 'skills-service-test-'));
    llmCalls.length = 0;
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('list() supports reload to pick up newly created skills', async () => {
    await writeSkill(tempDir, 'skill-one', {
      name: 'skill-one',
      description: 'First skill description for reload test',
      type: 'context',
    });

    const registry = new SkillRegistry(tempDir);
    await registry.discover();

    const service = new SkillsService({
      skillRegistry: registry,
      defaultProvider: 'openai',
      defaultModel: 'gpt-4o',
      artifactsDir: join(tempDir, 'artifacts'),
    });

    const firstList = await service.list();
    expect(firstList.map(s => s.name)).toContain('skill-one');

    await writeSkill(tempDir, 'skill-two', {
      name: 'skill-two',
      description: 'Second skill description for reload test',
      type: 'context',
    });

    const staleList = await service.list();
    expect(staleList.map(s => s.name)).not.toContain('skill-two');

    const refreshedList = await service.list({ reload: true });
    expect(refreshedList.map(s => s.name)).toContain('skill-two');
  });

  it('test() executes executable skills via handler.ts fallback', async () => {
    await writeSkill(tempDir, 'echo-skill', {
      name: 'echo-skill',
      description: 'Executable echo skill for direct test',
      type: 'executable',
    });

    await writeFile(
      join(tempDir, '.agents', 'skills', 'echo-skill', 'handler.ts'),
      'export default async function handler(params) { return `echo:${JSON.stringify(params)}`; }\n',
    );

    const registry = new SkillRegistry(tempDir);
    await registry.discover();

    const service = new SkillsService({
      skillRegistry: registry,
      defaultProvider: 'openai',
      defaultModel: 'gpt-4o',
      artifactsDir: join(tempDir, 'artifacts'),
    });

    const result = await service.test({
      name: 'echo-skill',
      params: { value: 42 },
    });

    expect(result.name).toBe('echo-skill');
    expect(result.type).toBe('executable');
    expect(result.output).toBe('echo:{"value":42}');
  });

  it('test() prefers handler.js when both JS and TS handlers exist', async () => {
    await writeSkill(tempDir, 'echo-js-skill', {
      name: 'echo-js-skill',
      description: 'Executable skill should prefer JavaScript handler in dist runtime',
      type: 'executable',
    });

    await writeFile(
      join(tempDir, '.agents', 'skills', 'echo-js-skill', 'handler.ts'),
      'export default async function handler(params) { return `ts:${JSON.stringify(params)}`; }\n',
    );

    await writeFile(
      join(tempDir, '.agents', 'skills', 'echo-js-skill', 'handler.js'),
      'export default async function handler(params) { return `js:${JSON.stringify(params)}`; }\n',
    );

    const registry = new SkillRegistry(tempDir);
    await registry.discover();

    const service = new SkillsService({
      skillRegistry: registry,
      defaultProvider: 'openai',
      defaultModel: 'gpt-4o',
      artifactsDir: join(tempDir, 'artifacts'),
    });

    const result = await service.test({
      name: 'echo-js-skill',
      params: { value: 7 },
    });

    expect(result.type).toBe('executable');
    expect(result.output).toBe('js:{"value":7}');
  });

  it('test() executes context skills with provider/model precedence', async () => {
    await writeSkill(tempDir, 'context-skill', {
      name: 'context-skill',
      description: 'Context skill that should call mocked LLM',
      type: 'context',
      provider: 'openrouter',
      model: 'openrouter/model-a',
    }, 'You are a context skill body.');

    const registry = new SkillRegistry(tempDir);
    await registry.discover();

    const service = new SkillsService({
      skillRegistry: registry,
      defaultProvider: 'openai',
      defaultModel: 'gpt-4o',
      artifactsDir: join(tempDir, 'artifacts'),
    });

    const result = await service.test({
      name: 'context-skill',
      prompt: 'Summarize this in one line',
      provider: 'ollama',
      model: 'llama3.2',
      temperature: 0.2,
      maxTokens: 50,
    });

    expect(result.type).toBe('context');
    expect(result.providerUsed).toBe('ollama');
    expect(result.modelUsed).toBe('llama3.2');
    expect(result.output).toBe('mock-response:Summarize this in one line');
    expect(llmCalls).toHaveLength(1);
    expect(llmCalls[0]?.provider).toBe('ollama');
    expect(llmCalls[0]?.model).toBe('llama3.2');
    expect(llmCalls[0]?.task).toContain('context skill body');
    expect(llmCalls[0]?.params).toEqual({ temperature: 0.2, max_tokens: 50 });
  });

  it('test() throws ValidationError when context skill prompt is missing', async () => {
    await writeSkill(tempDir, 'needs-prompt', {
      name: 'needs-prompt',
      description: 'Context skill requiring prompt for execution',
      type: 'context',
    });

    const registry = new SkillRegistry(tempDir);
    await registry.discover();

    const service = new SkillsService({
      skillRegistry: registry,
      defaultProvider: 'openai',
      defaultModel: 'gpt-4o',
      artifactsDir: join(tempDir, 'artifacts'),
    });

    await expect(service.test({ name: 'needs-prompt' })).rejects.toBeInstanceOf(ValidationError);
  });

  it('test() throws NotFoundError for unknown skills', async () => {
    const registry = new SkillRegistry(tempDir);
    await registry.discover();

    const service = new SkillsService({
      skillRegistry: registry,
      defaultProvider: 'openai',
      defaultModel: 'gpt-4o',
      artifactsDir: join(tempDir, 'artifacts'),
    });

    await expect(service.test({ name: 'does-not-exist' })).rejects.toBeInstanceOf(NotFoundError);
  });
});
