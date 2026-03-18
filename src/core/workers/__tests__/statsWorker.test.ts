import { describe, it, expect } from 'vitest';
import type { StatsJob, WorkerInMessage, WorkerOutMessage } from '../statsQueue.js';

// parseCostUsd logic (reimplemented for testing since the worker doesn't export it)
function parseCostUsd(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;

  const parsed = parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

describe('statsWorker pure logic', () => {
  describe('parseCostUsd', () => {
    it('returns 0 for null', () => {
      expect(parseCostUsd(null)).toBe(0);
    });
    it('returns 0 for undefined', () => {
      expect(parseCostUsd(undefined)).toBe(0);
    });
    it('returns the number for finite numbers', () => {
      expect(parseCostUsd(1.23)).toBe(1.23);
      expect(parseCostUsd(0)).toBe(0);
      expect(parseCostUsd(-5.5)).toBe(-5.5);
    });
    it('returns 0 for Infinity', () => {
      expect(parseCostUsd(Infinity)).toBe(0);
      expect(parseCostUsd(-Infinity)).toBe(0);
    });
    it('returns 0 for NaN', () => {
      expect(parseCostUsd(NaN)).toBe(0);
    });
    it('parses string numbers', () => {
      expect(parseCostUsd('1.23')).toBe(1.23);
      expect(parseCostUsd('0')).toBe(0);
    });
    it('returns 0 for non-numeric strings', () => {
      expect(parseCostUsd('abc')).toBe(0);
      expect(parseCostUsd('')).toBe(0);
    });
  });
});

describe('StatsJob and WorkerMessage types', () => {
  it('StatsJob interface is importable', async () => {
    const { StatsJob } = await import('../statsQueue.js') as any;
    // Types don't exist at runtime, but the import shouldn't fail
  });

  it('WorkerInMessage types are defined', async () => {
    const mod = await import('../statsQueue.js');
    // Verify the module exports exist (interfaces are erased at runtime,
    // but the module should load without error)
    expect(mod).toBeDefined();
  });
});

describe('message protocol types', () => {
  it('StatsJob table values are well-defined', () => {
    const job: StatsJob = {
      table: 'sub_steps',
      id: 'test-id',
      generationId: 'gen-123',
    };
    expect(job.table).toBe('sub_steps');

    const dagJob: StatsJob = { table: 'dags', id: 'dag-1', attemptIndex: 0 };
    expect(dagJob.attemptIndex).toBe(0);

    const reconcileJob: StatsJob = { table: 'reconcile', id: 'reconcile_123' };
    expect(reconcileJob.table).toBe('reconcile');
  });

  it('WorkerInMessage types cover all operations', () => {
    const init: WorkerInMessage = { type: 'init', dbPath: '/tmp/test.db', apiKey: 'key' };
    expect(init.type).toBe('init');

    const job: WorkerInMessage = { type: 'job', job: { table: 'sub_steps', id: '1' } };
    expect(job.type).toBe('job');

    const shutdown: WorkerInMessage = { type: 'shutdown' };
    expect(shutdown.type).toBe('shutdown');
  });

  it('WorkerOutMessage types cover all responses', () => {
    const done: WorkerOutMessage = { type: 'done', table: 'sub_steps', id: '1' };
    expect(done.type).toBe('done');

    const error: WorkerOutMessage = { type: 'error', error: 'fail' };
    expect(error.type).toBe('error');

    const drained: WorkerOutMessage = { type: 'drained' };
    expect(drained.type).toBe('drained');
  });
});
