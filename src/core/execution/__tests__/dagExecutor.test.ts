/**
 * DAG Executor Unit Tests
 *
 * Tests for DAGExecutor: pure utility methods, dependency resolution,
 * status derivation, usage/cost aggregation, and execute() edge cases.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DAGExecutor } from '../dagExecutor.js';
import type { DAGExecutorConfig, DecomposerJob, SubTask, GlobalContext } from '../dagExecutor.js';
import { ToolRegistry } from '../../tools/registry.js';

vi.mock('../../../util/logger.js', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockDb(): any {
  return {
    query: {
      agents: { findFirst: vi.fn(), findMany: vi.fn() },
      dagExecutions: { findFirst: vi.fn(), findMany: vi.fn() },
      dagSubSteps: { findMany: vi.fn() },
    },
    insert: vi.fn(() => ({ values: vi.fn() })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn() })) })),
    delete: vi.fn(() => ({ where: vi.fn() })),
  };
}

function createMockConfig(overrides: Partial<DAGExecutorConfig> = {}): DAGExecutorConfig {
  return {
    db: createMockDb(),
    llmProvider: {
      name: 'mock',
      chat: vi.fn(async () => ({ content: 'synth result', usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } })),
      callWithTools: vi.fn(),
      validateToolCallSupport: vi.fn(),
    } as any,
    toolRegistry: new ToolRegistry(),
    artifactsDir: '/tmp/test',
    ...overrides,
  };
}

function makeJob(overrides: Partial<DecomposerJob> = {}): DecomposerJob {
  return {
    original_request: overrides.original_request ?? 'test request',
    intent: overrides.intent ?? { primary: 'test', sub_intents: [] },
    entities: overrides.entities ?? [],
    sub_tasks: overrides.sub_tasks ?? [],
    synthesis_plan: overrides.synthesis_plan ?? 'Combine results',
    validation: overrides.validation ?? { coverage: 'full', gaps: [], iteration_triggers: [] },
    clarification_needed: overrides.clarification_needed ?? false,
    clarification_query: overrides.clarification_query,
    title: overrides.title,
  };
}

function makeSubTask(overrides: Partial<SubTask> = {}): SubTask {
  return {
    id: overrides.id ?? '1',
    description: overrides.description ?? 'Test task',
    thought: overrides.thought ?? 'thinking',
    action_type: overrides.action_type ?? 'tool',
    tool_or_prompt: overrides.tool_or_prompt ?? { name: 'bash', params: { command: 'echo hi' } },
    expected_output: overrides.expected_output ?? 'some output',
    dependencies: overrides.dependencies ?? [],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DAGExecutor', () => {
  let executor: DAGExecutor;
  let config: DAGExecutorConfig;

  beforeEach(() => {
    vi.clearAllMocks();
    config = createMockConfig();
    executor = new DAGExecutor(config);
  });

  // ── extractUrls ──────────────────────────────────────────────────────

  describe('extractUrls', () => {
    const extract = (text: string) => (executor as any).extractUrls(text);

    it('extracts URLs with http/https prefix', () => {
      expect(extract('Visit https://example.com for details')).toEqual(['https://example.com']);
    });

    it('extracts URLs without protocol and prepends https://', () => {
      const result = extract('Go to www.example.com/path');
      expect(result[0]).toBe('https://www.example.com/path');
    });

    it('extracts multiple URLs', () => {
      const result = extract('See https://a.com and http://b.org/page');
      expect(result).toHaveLength(2);
      expect(result).toContain('https://a.com');
      expect(result).toContain('http://b.org/page');
    });

    it('returns empty array when no URLs present', () => {
      expect(extract('no urls here')).toEqual([]);
    });

    it('preserves http:// prefix as-is', () => {
      const result = extract('http://insecure.example.com');
      expect(result[0]).toBe('http://insecure.example.com');
    });
  });

  // ── buildGlobalContext ───────────────────────────────────────────────

  describe('buildGlobalContext', () => {
    const build = (job: DecomposerJob) => (executor as any).buildGlobalContext(job);

    it('returns formatted string and totalTasks', () => {
      const job = makeJob({
        sub_tasks: [makeSubTask({ id: '1' }), makeSubTask({ id: '2' })],
        entities: [{ entity: 'User', type: 'noun', grounded_value: 'Alice' }],
      });
      const ctx: GlobalContext = build(job);

      expect(ctx.totalTasks).toBe(2);
      expect(ctx.formatted).toContain('test request');
      expect(ctx.formatted).toContain('User (noun): Alice');
    });

    it('handles empty entities', () => {
      const job = makeJob({ entities: [] });
      const ctx: GlobalContext = build(job);

      expect(ctx.formatted).toContain('None');
    });

    it('includes sub-intents', () => {
      const job = makeJob({ intent: { primary: 'main', sub_intents: ['sub1', 'sub2'] } });
      const ctx = build(job);

      expect(ctx.formatted).toContain('sub1; sub2');
    });
  });

  // ── buildInferencePrompt ─────────────────────────────────────────────

  describe('buildInferencePrompt', () => {
    const buildPrompt = (task: SubTask, ctx: GlobalContext, results: Map<string, any>) =>
      (executor as any).buildInferencePrompt(task, ctx, results);

    it('includes task description and expected output', () => {
      const task = makeSubTask({ id: '2', description: 'Summarize data', expected_output: 'A summary' });
      const ctx: GlobalContext = { formatted: '# Global Context\nTest', totalTasks: 3 };
      const prompt = buildPrompt(task, ctx, new Map());

      expect(prompt).toContain('Summarize data');
      expect(prompt).toContain('A summary');
      expect(prompt).toContain('[2/3]');
    });

    it('includes dependency results', () => {
      const task = makeSubTask({ id: '2', dependencies: ['1'] });
      const results = new Map([['1', 'result from task 1']]);
      const ctx: GlobalContext = { formatted: '', totalTasks: 2 };
      const prompt = buildPrompt(task, ctx, results);

      expect(prompt).toContain('[Task 1]: result from task 1');
    });

    it('filters out "none" dependencies', () => {
      const task = makeSubTask({ dependencies: ['none'] });
      const ctx: GlobalContext = { formatted: '', totalTasks: 1 };
      const prompt = buildPrompt(task, ctx, new Map());

      expect(prompt).toContain('None');
    });

    it('truncates long dependency results', () => {
      const longResult = 'x'.repeat(3000);
      const task = makeSubTask({ id: '2', dependencies: ['1'] });
      const results = new Map([['1', longResult]]);
      const ctx: GlobalContext = { formatted: '', totalTasks: 2 };
      const prompt = buildPrompt(task, ctx, results);

      expect(prompt).toContain('...');
      expect(prompt.length).toBeLessThan(longResult.length + 500);
    });

    it('uses params.prompt if available', () => {
      const task = makeSubTask({
        tool_or_prompt: { name: 'inference', params: { prompt: 'Custom instruction' } },
      });
      const ctx: GlobalContext = { formatted: '', totalTasks: 1 };
      const prompt = buildPrompt(task, ctx, new Map());

      expect(prompt).toContain('Custom instruction');
    });
  });

  // ── resolveStringReplacements ────────────────────────────────────────

  describe('resolveStringReplacements', () => {
    const resolve = (value: any, matches: RegExpMatchArray[], key: string, results: Map<string, any>) =>
      (executor as any).resolveStringReplacements(value, matches, key, results);

    it('returns non-string values unchanged', () => {
      expect(resolve(42, [], 'key', new Map())).toBe(42);
      expect(resolve(null, [], 'key', new Map())).toBeNull();
    });

    it('replaces dependency references in strings', () => {
      const PATTERN = /<Results? (?:from|of) Task (\d+)>/g;
      const value = 'Use <Result from Task 1> here';
      const matches = [...value.matchAll(PATTERN)];
      const results = new Map([['1', 'resolved_value']]);

      expect(resolve(value, matches, 'input', results)).toBe('Use resolved_value here');
    });

    it('replaces multiple references', () => {
      const PATTERN = /<Results? (?:from|of) Task (\d+)>/g;
      const value = '<Result from Task 1> and <Result of Task 2>';
      const matches = [...value.matchAll(PATTERN)];
      const results = new Map([['1', 'val1'], ['2', 'val2']]);

      expect(resolve(value, matches, 'x', results)).toBe('val1 and val2');
    });

    it('stringifies non-string dependency results', () => {
      const PATTERN = /<Results? (?:from|of) Task (\d+)>/g;
      const value = '<Result from Task 1>';
      const matches = [...value.matchAll(PATTERN)];
      const results = new Map([['1', { key: 'val' }]]);

      expect(resolve(value, matches, 'x', results)).toBe('{"key":"val"}');
    });
  });

  // ── resolveWriteFileContent ──────────────────────────────────────────

  describe('resolveWriteFileContent', () => {
    const resolve = (task: any, results: Map<string, any>) =>
      (executor as any).resolveWriteFileContent(task, results);

    it('joins string dependency results', () => {
      const task = { dependencies: ['1', '2'] };
      const results = new Map([['1', 'line1'], ['2', 'line2']]);

      expect(resolve(task, results)).toBe('line1\nline2');
    });

    it('extracts .content from object results', () => {
      const task = { dependencies: ['1'] };
      const results = new Map([['1', { content: 'from obj' }]]);

      expect(resolve(task, results)).toBe('from obj');
    });

    it('returns empty string when no dependencies match', () => {
      const task = { dependencies: ['999'] };
      expect(resolve(task, new Map())).toBe('');
    });
  });

  // ── resolveEmailContent ──────────────────────────────────────────────

  describe('resolveEmailContent', () => {
    const resolve = (task: any, results: Map<string, any>) =>
      (executor as any).resolveEmailContent(task, results);

    it('joins string dependency results', () => {
      const task = { dependencies: ['1', '2'] };
      const results = new Map([['1', 'Hello'], ['2', 'World']]);

      expect(resolve(task, results)).toBe('Hello\nWorld');
    });

    it('strips ```html wrapper from results', () => {
      const task = { dependencies: ['1'] };
      const results = new Map([['1', '```html\n<p>Hi</p>\n```']]);

      expect(resolve(task, results)).toBe('<p>Hi</p>');
    });

    it('extracts .content from object results', () => {
      const task = { dependencies: ['1'] };
      const results = new Map([['1', { content: 'email body' }]]);

      expect(resolve(task, results)).toBe('email body');
    });
  });

  // ── resolveFetchURLs ─────────────────────────────────────────────────

  describe('resolveFetchURLs', () => {
    const resolve = (task: any, key: string, results: Map<string, any>) =>
      (executor as any).resolveFetchURLs(task, key, results);

    it('extracts URLs from array of objects with url field', () => {
      const task = { dependencies: ['1'] };
      const results = new Map([['1', [{ url: 'https://a.com' }, { url: 'https://b.com' }]]]);

      expect(resolve(task, 'urls', results)).toEqual(['https://a.com', 'https://b.com']);
    });

    it('extracts URLs from string results', () => {
      const task = { dependencies: ['1'] };
      const results = new Map([['1', 'Visit https://example.com for info']]);

      const urls = resolve(task, 'urls', results);
      expect(urls).toContain('https://example.com');
    });

    it('returns empty array when no URLs found', () => {
      const task = { dependencies: ['1'] };
      const results = new Map([['1', 'no urls']]);

      expect(resolve(task, 'urls', results)).toEqual([]);
    });
  });

  // ── deriveExecutionStatus ────────────────────────────────────────────

  describe('deriveExecutionStatus', () => {
    const derive = (steps: any[]) => (executor as any).deriveExecutionStatus(steps);

    it('returns completed when all steps completed', () => {
      const result = derive([
        { status: 'completed' },
        { status: 'completed' },
      ]);
      expect(result.status).toBe('completed');
      expect(result.completedTasks).toBe(2);
      expect(result.failedTasks).toBe(0);
    });

    it('returns failed when all steps failed', () => {
      const result = derive([
        { status: 'failed' },
        { status: 'failed' },
      ]);
      expect(result.status).toBe('failed');
      expect(result.failedTasks).toBe(2);
    });

    it('returns partial when mix of completed and failed', () => {
      const result = derive([
        { status: 'completed' },
        { status: 'failed' },
      ]);
      expect(result.status).toBe('partial');
      expect(result.completedTasks).toBe(1);
      expect(result.failedTasks).toBe(1);
    });

    it('returns waiting when any step is waiting', () => {
      const result = derive([
        { status: 'completed' },
        { status: 'waiting' },
      ]);
      expect(result.status).toBe('waiting');
      expect(result.waitingTasks).toBe(1);
    });

    it('returns running when steps are in progress', () => {
      const result = derive([
        { status: 'running' },
        { status: 'completed' },
      ]);
      expect(result.status).toBe('running');
    });

    it('returns pending when no steps started', () => {
      const result = derive([
        { status: 'pending' },
        { status: 'pending' },
      ]);
      expect(result.status).toBe('pending');
    });

    it('ignores deleted steps in total count', () => {
      const result = derive([
        { status: 'completed' },
        { status: 'deleted' },
      ]);
      expect(result.status).toBe('completed');
      expect(result.completedTasks).toBe(1);
    });

    it('handles empty array', () => {
      const result = derive([]);
      expect(result.status).toBe('completed');
      expect(result.completedTasks).toBe(0);
    });
  });

  // ── aggregateUsage ───────────────────────────────────────────────────

  describe('aggregateUsage', () => {
    const aggregate = (steps: any[]) => (executor as any).aggregateUsage(steps);

    it('sums token usage across steps', () => {
      const result = aggregate([
        { usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } },
        { usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 } },
      ]);
      expect(result).toEqual({ promptTokens: 30, completionTokens: 15, totalTokens: 45 });
    });

    it('returns null when no steps have usage', () => {
      expect(aggregate([{}, { usage: null }])).toBeNull();
    });

    it('handles partial usage fields', () => {
      const result = aggregate([
        { usage: { promptTokens: 10 } },
      ]);
      expect(result).toEqual({ promptTokens: 10, completionTokens: 0, totalTokens: 0 });
    });
  });

  // ── aggregateCost ────────────────────────────────────────────────────

  describe('aggregateCost', () => {
    const aggregate = (steps: any[]) => (executor as any).aggregateCost(steps);

    it('sums costUsd across steps', () => {
      const result = aggregate([
        { costUsd: '0.01' },
        { costUsd: '0.02' },
      ]);
      expect(result).toBeCloseTo(0.03);
    });

    it('returns null when no steps have cost', () => {
      expect(aggregate([{}, {}])).toBeNull();
    });

    it('skips steps without costUsd', () => {
      const result = aggregate([
        { costUsd: '0.05' },
        {},
      ]);
      expect(result).toBeCloseTo(0.05);
    });
  });

  // ── validate ─────────────────────────────────────────────────────────

  describe('validate', () => {
    it('returns input unchanged (pass-through)', async () => {
      const result = await (executor as any).validate('some output');
      expect(result).toBe('some output');
    });
  });

  // ── prefetchAgents ────────────────────────────────────────────────────

  describe('prefetchAgents', () => {
    const prefetch = (job: DecomposerJob) => (executor as any).prefetchAgents(job);

    it('returns empty map when no inference tasks', async () => {
      const job = makeJob({
        sub_tasks: [makeSubTask({ action_type: 'tool', tool_or_prompt: { name: 'bash' } })],
      });
      const result = await prefetch(job);
      expect(result.size).toBe(0);
    });

    it('fetches agents for inference tasks', async () => {
      const mockAgent = { name: 'analyst', provider: 'openai', model: 'gpt-4o', promptTemplate: 'You are an analyst' };
      (config.db.query.agents.findFirst as any).mockResolvedValue(mockAgent);

      const job = makeJob({
        sub_tasks: [makeSubTask({ action_type: 'inference', tool_or_prompt: { name: 'analyst' } })],
      });
      const result = await prefetch(job);

      expect(result.size).toBe(1);
      expect(result.get('analyst')).toEqual(mockAgent);
    });

    it('skips agents not found in DB', async () => {
      (config.db.query.agents.findFirst as any).mockResolvedValue(null);

      const job = makeJob({
        sub_tasks: [makeSubTask({ action_type: 'inference', tool_or_prompt: { name: 'missing' } })],
      });
      const result = await prefetch(job);
      expect(result.size).toBe(0);
    });

    it('deduplicates agent names', async () => {
      const mockAgent = { name: 'analyst', provider: 'openai', model: 'gpt-4o', promptTemplate: '' };
      (config.db.query.agents.findFirst as any).mockResolvedValue(mockAgent);

      const job = makeJob({
        sub_tasks: [
          makeSubTask({ id: '1', action_type: 'inference', tool_or_prompt: { name: 'analyst' } }),
          makeSubTask({ id: '2', action_type: 'inference', tool_or_prompt: { name: 'analyst' } }),
        ],
      });
      const result = await prefetch(job);

      expect(config.db.query.agents.findFirst).toHaveBeenCalledTimes(1);
      expect(result.size).toBe(1);
    });
  });

  // ── execute edge cases ───────────────────────────────────────────────

  describe('execute', () => {
    it('throws when clarification_needed is true', async () => {
      const job = makeJob({
        clarification_needed: true,
        clarification_query: 'Which format?',
      });

      await expect(executor.execute(job, 'exec_1')).rejects.toThrow('Clarification needed: Which format?');
    });

    it('executes a simple single-tool-task job end-to-end', async () => {
      // Set up DB mocks for the full execute flow
      const updateSet = vi.fn(() => ({ where: vi.fn() }));
      const insertValues = vi.fn();
      config.db.update = vi.fn(() => ({ set: updateSet }));
      config.db.insert = vi.fn(() => ({ values: insertValues }));
      config.db.query.agents.findFirst = vi.fn().mockResolvedValue(null);
      config.db.query.dagSubSteps = { findMany: vi.fn().mockResolvedValue([{ status: 'completed' }]) };

      // Register a mock tool
      const mockTool = {
        name: 'mockTool',
        description: 'test',
        inputSchema: { parse: (v: any) => v },
        execute: vi.fn().mockResolvedValue('tool result'),
        restricted: false,
      };
      config.toolRegistry.register(mockTool as any);
      executor = new DAGExecutor(config);

      const job = makeJob({
        sub_tasks: [
          makeSubTask({
            id: '1',
            action_type: 'tool',
            tool_or_prompt: { name: 'mockTool', params: { input: 'test' } },
            dependencies: [],
          }),
        ],
      });

      const result = await executor.execute(job, 'exec_test', undefined, undefined, { skipEvents: true });
      expect(typeof result).toBe('string');
      expect(mockTool.execute).toHaveBeenCalled();
    });

    it('detects deadlock with unresolvable dependencies', async () => {
      const updateSet = vi.fn(() => ({ where: vi.fn() }));
      config.db.update = vi.fn(() => ({ set: updateSet }));
      config.db.query.agents.findFirst = vi.fn().mockResolvedValue(null);
      executor = new DAGExecutor(config);

      const job = makeJob({
        sub_tasks: [
          makeSubTask({ id: '1', dependencies: ['2'] }),
          makeSubTask({ id: '2', dependencies: ['1'] }),
        ],
      });

      await expect(
        executor.execute(job, 'exec_deadlock', undefined, undefined, { skipEvents: true })
      ).rejects.toThrow('deadlock');
    });

    it('throws for unknown tool', async () => {
      const updateSet = vi.fn(() => ({ where: vi.fn() }));
      config.db.update = vi.fn(() => ({ set: updateSet }));
      config.db.query.agents.findFirst = vi.fn().mockResolvedValue(null);
      executor = new DAGExecutor(config);

      const job = makeJob({
        sub_tasks: [
          makeSubTask({
            id: '1',
            action_type: 'tool',
            tool_or_prompt: { name: 'nonexistentTool', params: {} },
            dependencies: [],
          }),
        ],
      });

      await expect(
        executor.execute(job, 'exec_unknown', undefined, undefined, { skipEvents: true })
      ).rejects.toThrow('Tool not found: nonexistentTool');
    });
  });

  // ── suspendExecution ─────────────────────────────────────────────────

  describe('suspendExecution', () => {
    it('updates DB with suspended status and reason', async () => {
      const whereFn = vi.fn();
      const setFn = vi.fn(() => ({ where: whereFn }));
      config.db.update = vi.fn(() => ({ set: setFn }));
      executor = new DAGExecutor(config);

      await (executor as any).suspendExecution('exec_1', new Error('out of tokens'), { skipEvents: true });

      expect(config.db.update).toHaveBeenCalled();
      expect(setFn).toHaveBeenCalledWith(expect.objectContaining({
        status: 'suspended',
        suspendedReason: 'out of tokens',
      }));
    });

    it('handles non-Error objects', async () => {
      const whereFn = vi.fn();
      const setFn = vi.fn(() => ({ where: whereFn }));
      config.db.update = vi.fn(() => ({ set: setFn }));
      executor = new DAGExecutor(config);

      await (executor as any).suspendExecution('exec_1', 'string error', { skipEvents: true });

      expect(setFn).toHaveBeenCalledWith(expect.objectContaining({
        suspendedReason: 'string error',
      }));
    });
  });
});
