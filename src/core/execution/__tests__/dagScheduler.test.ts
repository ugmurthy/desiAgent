/**
 * DAG Scheduler Unit Tests
 *
 * Tests for NodeCronDagScheduler: schedule registration, hydration,
 * concurrent-run guarding, and lifecycle methods.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import cron from 'node-cron';
import { NodeCronDagScheduler } from '../dagScheduler.js';
import { dags } from '../../../db/schema.js';

vi.mock('../../../util/logger.js', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('node-cron', () => {
  const mockTask = { stop: vi.fn() };
  return {
    default: {
      schedule: vi.fn(() => mockTask),
    },
  };
});

// ---------------------------------------------------------------------------
// In-memory DB helpers (mirrors dags.test.ts)
// ---------------------------------------------------------------------------

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
  if (value === undefined || value === null) return value as T;
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

  if (chunks.length === 1 && isSqlNode(chunks[0])) {
    return evaluateSqlCondition(chunks[0], row);
  }

  // Handle and() – the joiner chunks contain " and " text; sub-conditions are SQL nodes
  const hasAndJoiner = chunks.some(
    (chunk: any) => !isSqlNode(chunk) && chunkText(chunk).includes(' and '),
  );
  if (hasAndJoiner) {
    return chunks
      .filter(isSqlNode)
      .every((part: any) => evaluateSqlCondition(part, row));
  }

  const andWrapper = chunks.find(
    (chunk: any) =>
      isSqlNode(chunk) &&
      chunk.queryChunks.some((c: any) => chunkText(c).includes(' and ')),
  );
  if (andWrapper) {
    return andWrapper.queryChunks
      .filter(isSqlNode)
      .every((part: any) => evaluateSqlCondition(part, row));
  }

  const textChunks = chunks.map(chunkText).join('');
  const columnChunk = chunks.find((chunk: any) => typeof chunk?.name === 'string');
  if (!columnChunk) return true;

  const key = rowKeyForColumn(row, columnChunk.name);

  if (textChunks.includes(' is not null')) {
    return row[key] !== null && row[key] !== undefined;
  }

  const paramChunk = chunks.find(
    (chunk: any) =>
      chunk?.constructor?.name === 'Param' ||
      (typeof chunk?.value !== 'undefined' && !Array.isArray(chunk.value)),
  );
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
    private _fields: Record<string, any> | undefined;

    constructor(fields?: Record<string, any>) {
      this._fields = fields;
    }

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
      return this;
    }

    offset(value: number): this {
      return this;
    }

    private exec(): any[] {
      let out = this.rows.filter((row) => evaluateSqlCondition(this.condition, row));
      if (this._fields) {
        out = out.map((row) => {
          const projected: any = {};
          for (const [alias, col] of Object.entries(this._fields!)) {
            const colName = (col as any)?.name ?? alias;
            const key = rowKeyForColumn(row, colName);
            projected[alias] = row[key];
          }
          return projected;
        });
      }
      return clone(out);
    }

    then(resolve: (value: any[]) => any, reject?: (reason: unknown) => any): Promise<any> {
      return Promise.resolve(this.exec()).then(resolve, reject);
    }
  }

  const db: any = {
    __state: state,
    select: (fields?: Record<string, any>) => new SelectBuilder(fields),
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
              next[field] = value;
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
    lastRunAt: overrides.lastRunAt ?? null,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    planningTotalUsage: overrides.planningTotalUsage ?? null,
    planningTotalCostUsd: overrides.planningTotalCostUsd ?? null,
    planningAttempts: overrides.planningAttempts ?? null,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('NodeCronDagScheduler', () => {
  let db: any;
  let executeDAG: ReturnType<typeof vi.fn>;
  let scheduler: NodeCronDagScheduler;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createInMemoryDb();
    executeDAG = vi.fn().mockResolvedValue({ id: 'exec_1', status: 'running' });
    scheduler = new NodeCronDagScheduler({ db, executeDAG });
  });

  // -----------------------------------------------------------------------
  // constructor
  // -----------------------------------------------------------------------
  describe('constructor', () => {
    it('stores deps properly', () => {
      expect(scheduler).toBeInstanceOf(NodeCronDagScheduler);
    });
  });

  // -----------------------------------------------------------------------
  // registerDAGSchedule
  // -----------------------------------------------------------------------
  describe('registerDAGSchedule', () => {
    it('calls cron.schedule when scheduleActive=true and cronSchedule set', () => {
      scheduler.registerDAGSchedule({
        id: 'dag_1',
        cronSchedule: '*/5 * * * *',
        scheduleActive: true,
        timezone: 'UTC',
      });

      expect(cron.schedule).toHaveBeenCalledWith(
        '*/5 * * * *',
        expect.any(Function),
        { timezone: 'UTC' },
      );
    });

    it('unregisters when scheduleActive=false', () => {
      // First register so there's a task to remove
      scheduler.registerDAGSchedule({
        id: 'dag_1',
        cronSchedule: '*/5 * * * *',
        scheduleActive: true,
      });

      vi.mocked(cron.schedule).mockClear();

      scheduler.registerDAGSchedule({
        id: 'dag_1',
        cronSchedule: '*/5 * * * *',
        scheduleActive: false,
      });

      // Should NOT have called schedule again
      expect(cron.schedule).not.toHaveBeenCalled();
    });

    it('unregisters when cronSchedule is empty string', () => {
      scheduler.registerDAGSchedule({
        id: 'dag_1',
        cronSchedule: '*/5 * * * *',
        scheduleActive: true,
      });

      vi.mocked(cron.schedule).mockClear();

      scheduler.registerDAGSchedule({
        id: 'dag_1',
        cronSchedule: '',
        scheduleActive: true,
      });

      expect(cron.schedule).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // updateDAGSchedule
  // -----------------------------------------------------------------------
  describe('updateDAGSchedule', () => {
    it('registers task when active with valid cron', () => {
      scheduler.updateDAGSchedule('dag_u1', '0 * * * *', true, 'America/New_York');

      expect(cron.schedule).toHaveBeenCalledWith(
        '0 * * * *',
        expect.any(Function),
        { timezone: 'America/New_York' },
      );
    });

    it('unregisters when inactive', () => {
      // Register first
      scheduler.updateDAGSchedule('dag_u2', '0 * * * *', true);

      vi.mocked(cron.schedule).mockClear();

      scheduler.updateDAGSchedule('dag_u2', '0 * * * *', false);

      expect(cron.schedule).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // unregisterDAGSchedule
  // -----------------------------------------------------------------------
  describe('unregisterDAGSchedule', () => {
    it('stops and removes existing task', () => {
      const mockTask = { stop: vi.fn() };
      vi.mocked(cron.schedule).mockReturnValueOnce(mockTask as any);

      scheduler.registerDAGSchedule({
        id: 'dag_stop',
        cronSchedule: '*/10 * * * *',
        scheduleActive: true,
      });

      scheduler.unregisterDAGSchedule('dag_stop');

      expect(mockTask.stop).toHaveBeenCalled();
    });

    it('is a no-op for non-existent id', () => {
      expect(() => scheduler.unregisterDAGSchedule('dag_missing')).not.toThrow();
    });
  });

  // -----------------------------------------------------------------------
  // hydrateFromDatabase
  // -----------------------------------------------------------------------
  describe('hydrateFromDatabase', () => {
    it('registers tasks for all active scheduled dags from DB', async () => {
      db.__state.dags.push(
        makeDagRow({
          id: 'dag_h1',
          cronSchedule: '0 * * * *',
          scheduleActive: true,
          status: 'success',
        }),
        makeDagRow({
          id: 'dag_h2',
          cronSchedule: '30 2 * * *',
          scheduleActive: true,
          status: 'success',
          timezone: 'Asia/Kolkata',
        }),
      );

      await scheduler.hydrateFromDatabase();

      expect(cron.schedule).toHaveBeenCalledTimes(2);
    });

    it('skips dags with null cronSchedule or scheduleActive=false', async () => {
      db.__state.dags.push(
        makeDagRow({
          id: 'dag_skip1',
          cronSchedule: null,
          scheduleActive: true,
          status: 'success',
        }),
        makeDagRow({
          id: 'dag_skip2',
          cronSchedule: '0 * * * *',
          scheduleActive: false,
          status: 'success',
        }),
        makeDagRow({
          id: 'dag_skip3',
          cronSchedule: '0 * * * *',
          scheduleActive: true,
          status: 'pending',
        }),
      );

      await scheduler.hydrateFromDatabase();

      expect(cron.schedule).not.toHaveBeenCalled();
    });

    it('works with empty result set', async () => {
      await scheduler.hydrateFromDatabase();

      expect(cron.schedule).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // stopAll
  // -----------------------------------------------------------------------
  describe('stopAll', () => {
    it('stops all registered tasks', () => {
      const mockTask1 = { stop: vi.fn() };
      const mockTask2 = { stop: vi.fn() };
      vi.mocked(cron.schedule)
        .mockReturnValueOnce(mockTask1 as any)
        .mockReturnValueOnce(mockTask2 as any);

      scheduler.registerDAGSchedule({
        id: 'dag_s1',
        cronSchedule: '*/5 * * * *',
        scheduleActive: true,
      });
      scheduler.registerDAGSchedule({
        id: 'dag_s2',
        cronSchedule: '*/10 * * * *',
        scheduleActive: true,
      });

      scheduler.stopAll();

      expect(mockTask1.stop).toHaveBeenCalled();
      expect(mockTask2.stop).toHaveBeenCalled();
    });

    it('leaves tasks map empty', () => {
      scheduler.registerDAGSchedule({
        id: 'dag_e1',
        cronSchedule: '*/5 * * * *',
        scheduleActive: true,
      });

      scheduler.stopAll();

      // Calling stopAll again should be a no-op (nothing to stop)
      scheduler.stopAll();
      // No additional stop calls beyond the first round
    });
  });

  // -----------------------------------------------------------------------
  // triggerDAG (private, tested via captured cron callback)
  // -----------------------------------------------------------------------
  describe('triggerDAG (via cron callback)', () => {
    function captureCallback(): () => void {
      const calls = vi.mocked(cron.schedule).mock.calls;
      const lastCall = calls[calls.length - 1];
      return lastCall[1] as () => void;
    }

    it('executes DAG and updates DB with lastRunAt', async () => {
      db.__state.dags.push(makeDagRow({ id: 'dag_t1' }));

      scheduler.registerDAGSchedule({
        id: 'dag_t1',
        cronSchedule: '*/5 * * * *',
        scheduleActive: true,
      });

      const callback = captureCallback();
      callback();

      // Allow the async triggerDAG to settle (executeDAG + db.update)
      await vi.waitFor(() => {
        const dagRow = db.__state.dags.find((d: any) => d.id === 'dag_t1');
        expect(dagRow.lastRunAt).toBeInstanceOf(Date);
      });

      expect(executeDAG).toHaveBeenCalledWith('dag_t1');
      const dagRow = db.__state.dags.find((d: any) => d.id === 'dag_t1');
      expect(dagRow.updatedAt).toBeInstanceOf(Date);
    });

    it('skips if dag is already in-flight (concurrent guard)', async () => {
      // Make executeDAG block until we resolve it
      let resolveExec!: (value: any) => void;
      executeDAG.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveExec = resolve;
        }),
      );

      scheduler.registerDAGSchedule({
        id: 'dag_inflight',
        cronSchedule: '*/5 * * * *',
        scheduleActive: true,
      });

      const callback = captureCallback();

      // First invocation - starts execution
      callback();
      // Second invocation while first is still in-flight - should be skipped
      callback();

      resolveExec({ id: 'exec_1', status: 'running' });

      await vi.waitFor(() => {
        expect(executeDAG).toHaveBeenCalledTimes(1);
      });
    });

    it('handles executeDAG errors gracefully (does not throw)', async () => {
      executeDAG.mockRejectedValueOnce(new Error('boom'));

      scheduler.registerDAGSchedule({
        id: 'dag_err',
        cronSchedule: '*/5 * * * *',
        scheduleActive: true,
      });

      const callback = captureCallback();

      // Should not throw
      expect(() => callback()).not.toThrow();

      await vi.waitFor(() => {
        expect(executeDAG).toHaveBeenCalledWith('dag_err');
      });
    });

    it('cleans up inFlightDagRuns in finally block', async () => {
      let rejectExec!: (err: Error) => void;
      executeDAG.mockReturnValueOnce(
        new Promise((_resolve, reject) => {
          rejectExec = reject;
        }),
      );

      scheduler.registerDAGSchedule({
        id: 'dag_cleanup',
        cronSchedule: '*/5 * * * *',
        scheduleActive: true,
      });

      const callback = captureCallback();
      callback();

      // Reject and wait for the finally block to run
      rejectExec(new Error('fail'));

      await vi.waitFor(() => {
        expect(executeDAG).toHaveBeenCalledWith('dag_cleanup');
      });

      // Allow microtasks (catch/finally) to settle
      await new Promise((r) => setTimeout(r, 10));

      // Now a second invocation should work (not be skipped)
      executeDAG.mockResolvedValueOnce({ id: 'exec_2', status: 'running' });
      callback();

      await vi.waitFor(() => {
        expect(executeDAG).toHaveBeenCalledTimes(2);
      });
    });
  });
});
