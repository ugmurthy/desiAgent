/**
 * DAGs Service Unit Tests
 *
 * Tests for DAG CRUD operations, ID generation, and lifecycle methods
 * that can be validated without an LLM provider.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { DAGsService, generateDAGId, generateDAGExecutionId } from '../dags.js';
import { dags, dagExecutions, dagSubSteps } from '../../../db/schema.js';
import { ToolRegistry } from '../../tools/registry.js';
import { NotFoundError, ValidationError } from '../../../errors/index.js';

vi.mock('../dagExecutor.js', () => ({
  DAGExecutor: class {
    async execute(..._args: any[]): Promise<void> {}
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

type TableName = 'agents' | 'dags' | 'dag_executions' | 'sub_steps';

type InMemoryState = {
  agents: any[];
  dags: any[];
  dag_executions: any[];
  sub_steps: any[];
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

  // and() with a single condition wraps it in chunks: [SQL]
  if (chunks.length === 1 && isSqlNode(chunks[0])) {
    return evaluateSqlCondition(chunks[0], row);
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

function makeDagRow(overrides: Partial<Record<string, any>> = {}): Record<string, any> {
  const now = new Date();
  return {
    id: overrides.id ?? 'dag_test1',
    status: overrides.status ?? 'success',
    result: overrides.result ?? null,
    usage: overrides.usage ?? null,
    generationStats: overrides.generationStats ?? null,
    attempts: overrides.attempts ?? 1,
    params: overrides.params ?? null,
    agentName: overrides.agentName ?? 'inference',
    dagTitle: overrides.dagTitle ?? null,
    cronSchedule: overrides.cronSchedule ?? null,
    scheduleActive: overrides.scheduleActive ?? false,
    timezone: overrides.timezone ?? 'UTC',
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    planningTotalUsage: overrides.planningTotalUsage ?? null,
    planningTotalCostUsd: overrides.planningTotalCostUsd ?? null,
    planningAttempts: overrides.planningAttempts ?? null,
  };
}

function makeExecutionRow(overrides: Partial<Record<string, any>> = {}): Record<string, any> {
  const now = new Date();
  return {
    id: overrides.id ?? 'exec_test1',
    dagId: overrides.dagId ?? 'dag_test1',
    originalRequest: overrides.originalRequest ?? 'test goal',
    primaryIntent: overrides.primaryIntent ?? 'test',
    status: overrides.status ?? 'pending',
    totalTasks: overrides.totalTasks ?? 1,
    completedTasks: overrides.completedTasks ?? 0,
    failedTasks: overrides.failedTasks ?? 0,
    waitingTasks: overrides.waitingTasks ?? 0,
    retryCount: overrides.retryCount ?? 0,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  };
}

describe('DAGsService', () => {
  let db: any;
  let service: DAGsService;

  beforeEach(() => {
    db = createInMemoryDb();

    service = new DAGsService({
      db,
      llmProvider: {
        name: 'mock',
        validateToolCallSupport: async () => ({ supported: true }),
        chat: async () => ({ content: '' }),
        callWithTools: async () => ({ thought: 'mock', finishReason: 'stop' as const }),
      } as any,
      toolRegistry: new ToolRegistry(),
      agentsService: {
        resolve: async () => null,
      } as any,
      artifactsDir: '/tmp',
      skipGenerationStats: true,
    });
  });

  describe('generateDAGId', () => {
    it('generates ID with dag_ prefix', () => {
      const id = generateDAGId();
      expect(id).toMatch(/^dag_.+$/);
    });

    it('generates unique IDs', () => {
      const ids = new Set(Array.from({ length: 10 }, () => generateDAGId()));
      expect(ids.size).toBe(10);
    });
  });

  describe('generateDAGExecutionId', () => {
    it('generates ID with exec_ prefix', () => {
      const id = generateDAGExecutionId();
      expect(id).toMatch(/^exec_.+$/);
    });

    it('generates unique IDs', () => {
      const ids = new Set(Array.from({ length: 10 }, () => generateDAGExecutionId()));
      expect(ids.size).toBe(10);
    });
  });

  describe('get', () => {
    it('retrieves DAG by ID', async () => {
      db.__state.dags.push(makeDagRow({ id: 'dag_abc', dagTitle: 'My DAG' }));

      const dag = await service.get('dag_abc');

      expect(dag.id).toBe('dag_abc');
      expect(dag.status).toBe('success');
    });

    it('throws NotFoundError for non-existent DAG', async () => {
      await expect(service.get('dag_nonexistent')).rejects.toThrow(NotFoundError);
      await expect(service.get('dag_nonexistent')).rejects.toThrow('not found');
    });
  });

  describe('list', () => {
    it('lists all DAGs', async () => {
      db.__state.dags.push(makeDagRow({ id: 'dag_1' }));
      db.__state.dags.push(makeDagRow({ id: 'dag_2' }));

      const result = await service.list();

      expect(result).toHaveLength(2);
    });

    it('filters by status', async () => {
      db.__state.dags.push(makeDagRow({ id: 'dag_s', status: 'success' }));
      db.__state.dags.push(makeDagRow({ id: 'dag_p', status: 'pending' }));
      db.__state.dags.push(makeDagRow({ id: 'dag_s2', status: 'success' }));

      const success = await service.list({ status: 'success' });
      const pending = await service.list({ status: 'pending' });

      expect(success).toHaveLength(2);
      expect(pending).toHaveLength(1);
    });

    it('respects limit and offset', async () => {
      db.__state.dags.push(makeDagRow({ id: 'dag_a' }));
      db.__state.dags.push(makeDagRow({ id: 'dag_b' }));
      db.__state.dags.push(makeDagRow({ id: 'dag_c' }));

      const first = await service.list({ limit: 2 });
      expect(first).toHaveLength(2);

      const second = await service.list({ limit: 2, offset: 2 });
      expect(second).toHaveLength(1);
    });

    it('returns empty array when no DAGs exist', async () => {
      const result = await service.list();
      expect(result).toEqual([]);
    });
  });

  describe('update', () => {
    it('updates DAG status', async () => {
      db.__state.dags.push(makeDagRow({ id: 'dag_u1' }));

      const updated = await service.update('dag_u1', { status: 'pending' });

      expect(updated.status).toBe('pending');
    });

    it('updates dagTitle', async () => {
      db.__state.dags.push(makeDagRow({ id: 'dag_u2' }));

      const updated = await service.update('dag_u2', { dagTitle: 'New Title' });

      expect(updated.dagTitle).toBe('New Title');
    });

    it('throws NotFoundError for non-existent DAG', async () => {
      await expect(
        service.update('dag_nonexistent', { status: 'pending' })
      ).rejects.toThrow(NotFoundError);
    });

    it('rejects invalid cron expression', async () => {
      db.__state.dags.push(makeDagRow({ id: 'dag_cron' }));

      await expect(
        service.update('dag_cron', { cronSchedule: 'bad-cron' })
      ).rejects.toThrow('Invalid cron expression');
    });

    it('accepts valid cron expression', async () => {
      db.__state.dags.push(makeDagRow({ id: 'dag_cron2' }));

      const updated = await service.update('dag_cron2', {
        cronSchedule: '0 * * * *',
        scheduleActive: true,
      });

      expect((updated.metadata as any).cronSchedule).toBe('0 * * * *');
      expect((updated.metadata as any).scheduleActive).toBe(true);
    });

    it('rejects activating a schedule when no cron schedule exists', async () => {
      db.__state.dags.push(makeDagRow({ id: 'dag_no_schedule', cronSchedule: null, scheduleActive: false }));

      await expect(
        service.update('dag_no_schedule', { scheduleActive: true })
      ).rejects.toThrow('Cannot activate schedule for DAG without a cron schedule');
    });
  });

  describe('schedule activation helpers', () => {
    it('activates an existing scheduled DAG', async () => {
      db.__state.dags.push(makeDagRow({ id: 'dag_sched_on', cronSchedule: '0 * * * *', scheduleActive: false }));

      const updated = await service.activateSchedule('dag_sched_on');

      expect((updated.metadata as any).scheduleActive).toBe(true);
    });

    it('deactivates an existing scheduled DAG', async () => {
      db.__state.dags.push(makeDagRow({ id: 'dag_sched_off', cronSchedule: '0 * * * *', scheduleActive: true }));

      const updated = await service.deactivateSchedule('dag_sched_off');

      expect((updated.metadata as any).scheduleActive).toBe(false);
    });

    it('rejects activating a DAG that is not scheduled', async () => {
      db.__state.dags.push(makeDagRow({ id: 'dag_unscheduled', cronSchedule: null, scheduleActive: false }));

      await expect(
        service.activateSchedule('dag_unscheduled')
      ).rejects.toThrow('Cannot activate schedule for DAG without a cron schedule');
    });
  });

  describe('safeDelete', () => {
    it('deletes a DAG with no executions', async () => {
      db.__state.dags.push(makeDagRow({ id: 'dag_del' }));

      await service.safeDelete('dag_del');

      await expect(service.get('dag_del')).rejects.toThrow(NotFoundError);
    });

    it('throws NotFoundError for non-existent DAG', async () => {
      await expect(service.safeDelete('dag_nonexistent')).rejects.toThrow(NotFoundError);
    });

    it('throws ValidationError when executions exist', async () => {
      db.__state.dags.push(makeDagRow({ id: 'dag_busy' }));
      db.__state.dag_executions.push(makeExecutionRow({ id: 'exec_1', dagId: 'dag_busy' }));

      await expect(service.safeDelete('dag_busy')).rejects.toThrow('Cannot delete DAG');
      await expect(service.safeDelete('dag_busy')).rejects.toThrow(ValidationError);
    });
  });

  describe('getSubSteps', () => {
    it('returns empty array for execution without sub-steps', async () => {
      db.__state.dag_executions.push(makeExecutionRow({ id: 'exec_empty' }));

      const subSteps = await service.getSubSteps('exec_empty');

      expect(subSteps).toEqual([]);
    });

    it('throws NotFoundError for non-existent execution', async () => {
      await expect(
        service.getSubSteps('exec_nonexistent')
      ).rejects.toThrow(NotFoundError);
    });
  });
});
