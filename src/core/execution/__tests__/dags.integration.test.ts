import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { DAGsService } from '../dags.js';
import { dagExecutions, dagSubSteps } from '../../../db/schema.js';
import { ToolRegistry } from '../../tools/registry.js';

const dagExecutorExecuteMock = vi.hoisted(() => vi.fn(async () => undefined));
const llmExecuteMock = vi.hoisted(() =>
  vi.fn(async () => ({
    content: 'redo-inference-result',
    usage: { promptTokens: 3, completionTokens: 5, totalTokens: 8 },
    costUsd: 0.001,
    generationStats: { id: 'gen-redo-1' },
    generationId: 'gen-redo-1',
  }))
);

vi.mock('../dagExecutor.js', () => ({
  DAGExecutor: class {
    async execute(...args: any[]): Promise<void> {
      await dagExecutorExecuteMock(...args);
    }
  },
}));

vi.mock('../../tools/llmExecute.js', () => ({
  LlmExecuteTool: class {
    async execute(input: any, ctx: any): Promise<any> {
      return llmExecuteMock(input, ctx);
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

type TableName = 'agents' | 'dags' | 'dag_executions' | 'sub_steps' | 'policy_artifacts';

type InMemoryState = {
  agents: any[];
  dags: any[];
  dag_executions: any[];
  sub_steps: any[];
  policy_artifacts: any[];
};

const TABLE_NAME = Symbol.for('drizzle:Name');

function tableNameOf(table: any): TableName {
  return table?.[TABLE_NAME] as TableName;
}

function clone<T>(value: T): T {
  if (value === undefined || value === null) {
    return value as T;
  }
  return JSON.parse(JSON.stringify(value));
}

function rowKeyForColumn(row: Record<string, any>, columnName: string): string {
  if (columnName in row) return columnName;
  const camel = columnName.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
  if (camel in row) return camel;
  return columnName;
}

function chunkText(chunk: any): string {
  if (chunk?.value && Array.isArray(chunk.value)) return chunk.value.join('');
  return '';
}

function isSqlNode(node: any): node is { queryChunks: any[] } {
  return !!node && Array.isArray(node.queryChunks);
}

function evaluateSqlCondition(sqlNode: any, row: Record<string, any>): boolean {
  if (!isSqlNode(sqlNode)) return true;

  const chunks = sqlNode.queryChunks;

  if (
    chunks.length === 3 &&
    chunkText(chunks[0]).trim() === '(' &&
    isSqlNode(chunks[1]) &&
    chunkText(chunks[2]).trim() === ')'
  ) {
    return evaluateSqlCondition(chunks[1], row);
  }

  const andWrapper = chunks.find((chunk: any) => isSqlNode(chunk) && chunk.queryChunks.some((c: any) => chunkText(c).includes(' and ')));
  if (andWrapper) {
    return andWrapper.queryChunks.filter(isSqlNode).every((part: any) => evaluateSqlCondition(part, row));
  }

  const textChunks = chunks.map(chunkText).join('');
  const columnChunk = chunks.find((chunk: any) => typeof chunk?.name === 'string');
  if (!columnChunk) return true;

  const key = rowKeyForColumn(row, columnChunk.name);

  if (textChunks.includes(' is not null')) {
    return row[key] !== null && row[key] !== undefined;
  }

  const paramChunk = chunks.find((chunk: any) => chunk?.constructor?.name === 'Param' || (typeof chunk?.value !== 'undefined' && !Array.isArray(chunk.value)));
  const rhs = paramChunk?.value;

  if (textChunks.includes(' = ')) return row[key] === rhs;
  if (textChunks.includes(' >= ')) return row[key] >= rhs;
  if (textChunks.includes(' <= ')) return row[key] <= rhs;

  return true;
}

function createInMemoryDb(): any {
  const state: InMemoryState = {
    agents: [],
    dags: [],
    dag_executions: [],
    sub_steps: [],
    policy_artifacts: [],
  };

  class SelectBuilder {
    private rows: any[] = [];
    private condition: any;
    private limitValue?: number;
    private offsetValue?: number;

    from(table: any): this {
      this.rows = state[tableNameOf(table)] || [];
      return this;
    }

    where(condition: any): this {
      this.condition = condition;
      return this;
    }

    orderBy(..._args: any[]): this {
      return this;
    }

    limit(value: number): this {
      this.limitValue = value;
      return this;
    }

    offset(value: number): this {
      this.offsetValue = value;
      return this;
    }

    private exec(): any[] {
      let out = this.rows.filter((row) => evaluateSqlCondition(this.condition, row));
      if (typeof this.offsetValue === 'number') out = out.slice(this.offsetValue);
      if (typeof this.limitValue === 'number') out = out.slice(0, this.limitValue);
      return clone(out);
    }

    then(resolve: (value: any[]) => any, reject?: (reason: unknown) => any): Promise<any> {
      return Promise.resolve(this.exec()).then(resolve, reject);
    }
  }

  const db: any = {
    __state: state,
    query: {
      agents: {
        findFirst: async (opts: any) => clone(state.agents.find((row) => evaluateSqlCondition(opts?.where, row))),
        findMany: async (opts: any) => clone(state.agents.filter((row) => evaluateSqlCondition(opts?.where, row))),
      },
      dags: {
        findFirst: async (opts: any) => clone(state.dags.find((row) => evaluateSqlCondition(opts?.where, row))),
        findMany: async (opts: any) => clone(state.dags.filter((row) => evaluateSqlCondition(opts?.where, row))),
      },
      dagExecutions: {
        findFirst: async (opts: any) => {
          const row = state.dag_executions.find((item) => evaluateSqlCondition(opts?.where, item));
          if (!row) return undefined;
          if (opts?.with?.subSteps) {
            return clone({
              ...row,
              subSteps: state.sub_steps.filter((step) => step.executionId === row.id),
            });
          }
          return clone(row);
        },
        findMany: async (opts: any) => clone(state.dag_executions.filter((row) => evaluateSqlCondition(opts?.where, row))),
      },
      dagSubSteps: {
        findMany: async (opts: any) => {
          const rows = state.sub_steps.filter((row) => evaluateSqlCondition(opts?.where, row));
          return clone(rows.sort((a, b) => String(a.taskId).localeCompare(String(b.taskId))));
        },
      },
    },
    select: () => new SelectBuilder(),
    insert: (table: any) => ({
      values: async (values: any | any[]) => {
        const key = tableNameOf(table);
        const records = Array.isArray(values) ? values : [values];
        state[key].push(...clone(records));
      },
    }),
    update: (table: any) => ({
      set: (patch: Record<string, any>) => ({
        where: async (condition: any) => {
          const key = tableNameOf(table);
          state[key] = state[key].map((row) => {
            if (!evaluateSqlCondition(condition, row)) return row;

            const next = { ...row };
            for (const [field, value] of Object.entries(patch)) {
              const isSqlIncrement = isSqlNode(value) && value.queryChunks.some((chunk: any) => chunkText(chunk).includes('+ 1'));
              if (isSqlIncrement) {
                next[field] = (next[field] ?? 0) + 1;
              } else {
                next[field] = value;
              }
            }
            return next;
          });
        },
      }),
    }),
    delete: (table: any) => ({
      where: async (condition: any) => {
        const key = tableNameOf(table);
        state[key] = state[key].filter((row) => !evaluateSqlCondition(condition, row));
      },
    }),
  };

  return db;
}

function longDecomposerPrompt(): string {
  return [
    'You are a precise Decomposition Agent that returns valid JSON only.',
    'Break goals into sub-tasks, include tool/inference details, and keep output deterministic for tests.',
    'Always include intent, entities, sub_tasks, synthesis_plan, and validation fields.',
  ].join(' ');
}

describe('DAGsService Integration', () => {
  let db: any;
  let agentsService: { resolve: (name: string) => Promise<any> };
  let scheduler: { registerDAGSchedule: ReturnType<typeof vi.fn>; updateDAGSchedule: ReturnType<typeof vi.fn>; unregisterDAGSchedule: ReturnType<typeof vi.fn> };
  let llmProvider: any;
  let service: DAGsService;

  beforeEach(async () => {
    dagExecutorExecuteMock.mockClear();
    llmExecuteMock.mockClear();

    db = createInMemoryDb();

    const inferenceAgent = {
      id: 'agent_inference',
      name: 'inference',
      version: '1.0.0',
      systemPrompt: longDecomposerPrompt(),
      provider: undefined,
      model: undefined,
      isActive: true,
      constraints: undefined,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    agentsService = {
      resolve: async (name: string) => {
        if (name === 'inference') return inferenceAgent;
        if (name === 'TitleMaster') return null;
        return null;
      },
    };

    scheduler = {
      registerDAGSchedule: vi.fn(),
      updateDAGSchedule: vi.fn(),
      unregisterDAGSchedule: vi.fn(),
    };

    llmProvider = {
      name: 'default-mock-provider',
      validateToolCallSupport: async () => ({ supported: true }),
      chat: async (params: Record<string, any>) => {
        const userContent = params.messages?.[1]?.content;
        const userText = typeof userContent === 'string' ? userContent : JSON.stringify(userContent ?? '');

        if (userText.includes('NEEDS_CLARIFICATION') && !userText.includes('User clarification:')) {
          const payload = {
            original_request: userText,
            intent: { primary: 'clarify', sub_intents: [] },
            entities: [],
            sub_tasks: [],
            synthesis_plan: 'await clarification',
            validation: { coverage: 'medium', gaps: [], iteration_triggers: [] },
            clarification_needed: true,
            clarification_query: 'Please clarify what output format you need.',
          };
          return {
            content: `\`\`\`json\n${JSON.stringify(payload)}\n\`\`\``,
          };
        }

        const payload = {
          original_request: userText,
          intent: { primary: 'integration-test', sub_intents: [] },
          entities: [],
          sub_tasks: [
            {
              id: '1',
              description: 'Perform deterministic inference step',
              thought: 'Test planning path',
              action_type: 'inference',
              tool_or_prompt: { name: 'inference', params: { prompt: 'Return deterministic output' } },
              expected_output: 'deterministic output',
              dependencies: [],
            },
          ],
          synthesis_plan: 'Summarize deterministic output',
          validation: { coverage: 'high', gaps: [], iteration_triggers: [] },
          clarification_needed: false,
          clarification_query: '',
        };

        return {
          content: `\`\`\`json\n${JSON.stringify(payload)}\n\`\`\``,
        };
      },
      callWithTools: async () => ({ thought: 'mock', finishReason: 'stop' as const }),
    };

    service = new DAGsService({
      db,
      llmProvider,
      toolRegistry: new ToolRegistry(),
      agentsService,
      scheduler,
      artifactsDir: '/tmp',
      staleExecutionMinutes: 0,
      apiKey: 'fake-key',
      skipGenerationStats: true,
    });
  });

  it('creates DAGs, executes them, and persists execution sub-steps', async () => {
    const created = await service.createFromGoal({
      goalText: 'Build an integration DAG with schedule',
      agentName: 'inference',
      cronSchedule: '*/10 * * * *',
      scheduleActive: true,
    });

    if (created.status !== 'success') {
      const failedDag = await service.get(created.dagId);
      throw new Error(`planning failed: ${JSON.stringify(created)} / stored=${JSON.stringify(failedDag)}`);
    }

    expect(created.status).toBe('success');

    const dag = await service.get(created.dagId);
    expect(dag.status).toBe('success');
    expect((dag.metadata as any).cronSchedule).toBe('*/10 * * * *');
    expect(scheduler.registerDAGSchedule).toHaveBeenCalledWith(
      expect.objectContaining({ id: created.dagId, cronSchedule: '*/10 * * * *' })
    );

    const scheduled = await service.listScheduled();
    expect(scheduled.some((item) => item.id === created.dagId)).toBe(true);

    const execution = await service.execute(created.dagId, { policyEnforcement: 'soft' });
    expect(execution.id).toMatch(/^exec_/);
    expect(execution.status).toBe('pending');
    expect(dagExecutorExecuteMock).toHaveBeenCalledWith(
      expect.any(Object),
      execution.id,
      created.dagId,
      expect.any(String),
      expect.objectContaining({
        maxParallelism: 5,
        maxRetriesPerTask: 2,
        retryBackoffMs: 1000,
      }),
    );
    expect(db.__state.policy_artifacts).toHaveLength(1);
    expect(db.__state.policy_artifacts[0]).toEqual(expect.objectContaining({
      dagId: created.dagId,
      executionId: execution.id,
      outcome: 'deny',
      mode: 'lenient',
    }));

    const subSteps = await service.getSubSteps(execution.id);
    expect(subSteps.length).toBe(1);
    expect(subSteps[0].taskId).toBe('001');
    expect(subSteps[0].toolOrPromptName).toBe('inference');

    const policyArtifacts = await service.listPolicyArtifacts({ executionId: execution.id });
    expect(policyArtifacts).toHaveLength(1);
    expect(policyArtifacts[0].rulePackId).toBe('core');
    expect(policyArtifacts[0].rulePackVersion).toBe('2026.03');

    const summary = await service.summarizePolicyArtifacts({ executionId: execution.id });
    expect(summary.total).toBe(1);
    expect(summary.byOutcome.deny).toBe(1);

    const persisted = await service.getPolicyArtifact(policyArtifacts[0].id);
    expect(persisted?.id).toBe(policyArtifacts[0].id);
  });

  it('enforces strict side-effect approval and supports explicit approval override', async () => {
    const strictService = new DAGsService({
      db,
      llmProvider,
      toolRegistry: new ToolRegistry(),
      agentsService,
      scheduler,
      artifactsDir: '/tmp',
      staleExecutionMinutes: 0,
      apiKey: 'fake-key',
      skipGenerationStats: true,
      policyMode: 'strict',
    });

    const dagId = 'dag_policy_strict_side_effect';
    db.__state.dags.push({
      id: dagId,
      status: 'success',
      result: {
        original_request: 'write a file',
        intent: { primary: 'policy-strict', sub_intents: [] },
        entities: [],
        sub_tasks: [
          {
            id: '001',
            description: 'write file',
            thought: 'side effect for strict test',
            action_type: 'tool',
            tool_or_prompt: {
              name: 'writeFile',
              params: { path: 'strict.txt', content: 'strict mode' },
            },
            expected_output: 'written',
            dependencies: ['none'],
          },
        ],
        synthesis_plan: 'n/a',
        validation: { coverage: 'high', gaps: [], iteration_triggers: [] },
        clarification_needed: false,
        clarification_query: '',
      },
      usage: null,
      generationStats: null,
      attempts: 1,
      params: { goalText: 'strict side effect path' },
      agentName: 'inference',
      dagTitle: 'Policy strict side effect',
      cronSchedule: null,
      scheduleActive: false,
      timezone: 'UTC',
      createdAt: new Date(),
      updatedAt: new Date(),
      planningTotalUsage: null,
      planningTotalCostUsd: null,
      planningAttempts: null,
    });

    await expect(strictService.execute(dagId)).rejects.toThrow('Execution requires policy clarification');

    const blockedArtifacts = await strictService.listPolicyArtifacts({ dagId });
    expect(blockedArtifacts).toHaveLength(1);
    expect(blockedArtifacts[0]).toEqual(expect.objectContaining({
      outcome: 'needs_clarification',
      mode: 'strict',
    }));

    await strictService.execute(dagId, { sideEffectApproval: true });

    const approvedArtifacts = await strictService.listPolicyArtifacts({ dagId });
    expect(approvedArtifacts).toHaveLength(2);
    expect(approvedArtifacts.some((artifact: any) => artifact.outcome === 'allow')).toBe(true);
  });

  it('handles clarification and resumes into the original DAG record', async () => {
    const clarification = await service.createFromGoal({
      goalText: 'NEEDS_CLARIFICATION: produce a report',
      agentName: 'inference',
    });

    expect(clarification.status).toBe('clarification_required');
    if (clarification.status !== 'clarification_required') return;

    const pendingDag = await service.get(clarification.dagId);
    expect(pendingDag.status).toBe('pending');

    const resumed = await service.resumeFromClarification(clarification.dagId, 'Return a concise markdown report.');
    expect(resumed.status).toBe('success');
    expect(resumed.dagId).toBe(clarification.dagId);

    const mergedDag = await service.get(clarification.dagId);
    expect(mergedDag.status).toBe('success');
    expect((mergedDag.metadata as any)?.goalText).toContain('User clarification: Return a concise markdown report.');
  });

  it('updates schedules with validation and enforces safeDelete constraints', async () => {
    const planned = await service.createFromGoal({
      goalText: 'Lifecycle tests for DAG update and delete',
      agentName: 'inference',
    });
    expect(planned.status).toBe('success');
    if (planned.status !== 'success') return;

    await expect(
      service.update(planned.dagId, { cronSchedule: 'bad-cron' })
    ).rejects.toThrow('Invalid cron expression');

    const scheduled = await service.update(planned.dagId, {
      cronSchedule: '0 * * * *',
      scheduleActive: true,
      timezone: 'UTC',
    });
    expect((scheduled.metadata as any).cronSchedule).toBe('0 * * * *');
    expect(scheduler.updateDAGSchedule).toHaveBeenCalledWith(planned.dagId, '0 * * * *', true, 'UTC');

    await service.deactivateSchedule(planned.dagId);
    expect(scheduler.unregisterDAGSchedule).toHaveBeenCalledWith(planned.dagId);

    const reactivated = await service.activateSchedule(planned.dagId);
    expect((reactivated.metadata as any).scheduleActive).toBe(true);
    expect(scheduler.updateDAGSchedule).toHaveBeenCalledWith(planned.dagId, '0 * * * *', true, 'UTC');

    const execution = await service.execute(planned.dagId, { policyEnforcement: 'soft' });
    await expect(service.safeDelete(planned.dagId)).rejects.toThrow('Cannot delete DAG');

    await db.delete(dagSubSteps).where(eq(dagSubSteps.executionId, execution.id));
    await db.delete(dagExecutions).where(eq(dagExecutions.id, execution.id));
    await service.safeDelete(planned.dagId);
    await expect(service.get(planned.dagId)).rejects.toThrow('not found');
  });

  it('resumes failed executions and supports redoInference on completed inference steps', async () => {
    const planned = await service.createFromGoal({
      goalText: 'Resume and redo inference',
      agentName: 'inference',
    });
    expect(planned.status).toBe('success');
    if (planned.status !== 'success') return;

    const execution = await service.execute(planned.dagId, { policyEnforcement: 'soft' });

    await db.update(dagExecutions).set({ status: 'failed', updatedAt: new Date() }).where(eq(dagExecutions.id, execution.id));
    const resumed = await service.resume(execution.id, { policyEnforcement: 'soft' });
    expect(resumed.status).toBe('running');
    expect(resumed.retryCount).toBe(1);
    expect(dagExecutorExecuteMock).toHaveBeenNthCalledWith(
      2,
      expect.any(Object),
      execution.id,
      planned.dagId,
      expect.any(String),
      expect.objectContaining({
        maxParallelism: 5,
        maxRetriesPerTask: 2,
        timeoutMsPerTask: 30000,
      }),
    );
    expect(db.__state.policy_artifacts).toHaveLength(2);
    expect(db.__state.policy_artifacts.every((artifact: any) => artifact.executionId === execution.id)).toBe(true);
    expect(db.__state.policy_artifacts.every((artifact: any) => artifact.outcome === 'deny')).toBe(true);

    const [subStep] = await service.getSubSteps(execution.id);
    await db
      .update(dagSubSteps)
      .set({
        status: 'completed',
        toolOrPromptName: 'inference',
        result: 'old result',
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(dagSubSteps.id, subStep.id));

    await db
      .update(dagExecutions)
      .set({ status: 'completed', completedTasks: 1, failedTasks: 0, waitingTasks: 0, updatedAt: new Date() })
      .where(eq(dagExecutions.id, execution.id));

    const redo = await service.redoInference(execution.id, {
      provider: 'openrouter',
      model: 'mock-model',
    });

    expect(redo.rerunCount).toBe(1);
    expect(llmExecuteMock).toHaveBeenCalled();

    const latestSubSteps = await db.query.dagSubSteps.findMany({ where: eq(dagSubSteps.executionId, execution.id) });
    expect(latestSubSteps.some((step: any) => step.status === 'deleted')).toBe(true);
    expect(latestSubSteps.some((step: any) => step.status === 'completed' && step.result === 'redo-inference-result')).toBe(true);
  });

  it('uses soft policy directives as defaults while preserving explicit execution config overrides', async () => {
    const dagId = 'dag_policy_soft_defaults';
    db.__state.dags.push({
      id: dagId,
      status: 'success',
      result: {
        original_request: 'fetch page and summarize',
        intent: { primary: 'policy-test', sub_intents: [] },
        entities: [],
        sub_tasks: [
          {
            id: '001',
            description: 'fetch page',
            thought: 'network task to trigger network timeout directive',
            action_type: 'tool',
            tool_or_prompt: {
              name: 'fetchPage',
              params: { url: 'https://example.com' },
            },
            expected_output: 'page content',
            dependencies: [],
          },
        ],
        synthesis_plan: 'n/a',
        validation: { coverage: 'high', gaps: [], iteration_triggers: [] },
        clarification_needed: false,
        clarification_query: '',
      },
      usage: null,
      generationStats: null,
      attempts: 1,
      params: { goalText: 'policy soft defaults path' },
      agentName: 'inference',
      dagTitle: 'Policy soft defaults case',
      cronSchedule: null,
      scheduleActive: false,
      timezone: 'UTC',
      createdAt: new Date(),
      updatedAt: new Date(),
      planningTotalUsage: null,
      planningTotalCostUsd: null,
      planningAttempts: null,
    });

    await service.execute(dagId, { policyEnforcement: 'soft' });

    expect(dagExecutorExecuteMock).toHaveBeenNthCalledWith(
      1,
      expect.any(Object),
      expect.any(String),
      dagId,
      expect.any(String),
      expect.objectContaining({
        maxParallelism: 5,
        maxRetriesPerTask: 2,
        retryBackoffMs: 1000,
        timeoutMsPerTask: 45000,
      }),
    );

    await service.execute(dagId, {
      policyEnforcement: 'soft',
      executionConfig: {
        maxParallelism: 3,
        maxRetriesPerTask: 0,
        retryBackoffMs: 500,
        timeoutMsPerTask: 42000,
      },
    });

    expect(dagExecutorExecuteMock).toHaveBeenNthCalledWith(
      2,
      expect.any(Object),
      expect.any(String),
      dagId,
      expect.any(String),
      expect.objectContaining({
        maxParallelism: 3,
        maxRetriesPerTask: 0,
        retryBackoffMs: 500,
        timeoutMsPerTask: 42000,
      }),
    );
  });

  it('persists deny policy artifacts when execution is blocked', async () => {
    const dagId = 'dag_policy_deny';
    db.__state.dags.push({
      id: dagId,
      status: 'success',
      result: {
        original_request: 'run unknown tool',
        intent: { primary: 'policy-test', sub_intents: [] },
        entities: [],
        sub_tasks: [
          {
            id: '001',
            description: 'unsafe tool',
            thought: 'this should be denied',
            action_type: 'tool',
            tool_or_prompt: { name: 'toolDoesNotExist', params: {} },
            expected_output: 'none',
            dependencies: [],
          },
        ],
        synthesis_plan: 'n/a',
        validation: { coverage: 'high', gaps: [], iteration_triggers: [] },
        clarification_needed: false,
        clarification_query: '',
      },
      usage: null,
      generationStats: null,
      attempts: 1,
      params: { goalText: 'policy deny path' },
      agentName: 'inference',
      dagTitle: 'Policy deny case',
      cronSchedule: null,
      scheduleActive: false,
      timezone: 'UTC',
      createdAt: new Date(),
      updatedAt: new Date(),
      planningTotalUsage: null,
      planningTotalCostUsd: null,
      planningAttempts: null,
    });

    await expect(service.execute(dagId)).rejects.toThrow('Execution denied by policy');

    expect(db.__state.policy_artifacts).toHaveLength(1);
    expect(db.__state.policy_artifacts[0]).toEqual(expect.objectContaining({
      dagId,
      outcome: 'deny',
      mode: 'lenient',
    }));
    expect(db.__state.policy_artifacts[0].executionId).toMatch(/^exec_/);
    expect(db.__state.policy_artifacts[0].violations.some((violation: any) => violation.code === 'TOOL_NOT_FOUND')).toBe(true);
  });
});
