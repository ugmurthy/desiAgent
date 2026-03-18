/**
 * StatsQueue Unit Tests
 *
 * Tests for StatsQueue: worker lifecycle, job enqueueing,
 * message handling, and graceful shutdown.
 *
 * The actual Bun Worker is mocked so tests run under vitest/Node.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StatsJob, WorkerOutMessage } from '../statsQueue.js';

vi.mock('../../../util/logger.js', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// --------------- Mock Worker ---------------

class MockWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  private listeners: Map<string, Function[]> = new Map();
  messages: any[] = [];
  terminated = false;

  postMessage(msg: any) {
    this.messages.push(msg);
  }
  addEventListener(type: string, fn: Function) {
    const fns = this.listeners.get(type) || [];
    fns.push(fn);
    this.listeners.set(type, fns);
  }
  removeEventListener() {}
  terminate() {
    this.terminated = true;
  }
  ref() {}
  unref() {}

  /** Helper to simulate worker sending a message back */
  simulateMessage(data: any) {
    const event = { data } as MessageEvent;
    if (this.onmessage) this.onmessage(event);
    const fns = this.listeners.get('message') || [];
    for (const fn of fns) fn(event);
  }
}

let mockWorkerInstance: MockWorker | null = null;

vi.stubGlobal(
  'Worker',
  class extends MockWorker {
    constructor(..._args: any[]) {
      super();
      mockWorkerInstance = this;
    }
  },
);

// Must import after Worker stub is in place
const { StatsQueue } = await import('../statsQueue.js');

// --------------- Tests ---------------

describe('StatsQueue', () => {
  let queue: InstanceType<typeof StatsQueue>;

  beforeEach(() => {
    vi.useFakeTimers();
    mockWorkerInstance = null;
    queue = new StatsQueue('/tmp/test.db', 'sk-test-key');
  });

  afterEach(async () => {
    // If a worker is alive with pending jobs, terminate() will block waiting
    // for 'drained' (with a 30s fallback setTimeout). We simulate 'drained'
    // so the promise resolves quickly under fake timers.
    if (mockWorkerInstance && !mockWorkerInstance.terminated) {
      const terminatePromise = queue.terminate();
      // Give the promise micro-task time to set up its listener
      await vi.advanceTimersByTimeAsync(0);
      // Simulate the worker draining to unblock terminate
      mockWorkerInstance.simulateMessage({ type: 'drained' });
      await terminatePromise;
    }
    vi.useRealTimers();
  });

  // ---- constructor ----

  it('creates instance without starting worker', () => {
    expect(queue).toBeDefined();
    expect(mockWorkerInstance).toBeNull();
  });

  // ---- start() ----

  it('start() creates a Worker and sends init message', () => {
    queue.start();

    expect(mockWorkerInstance).not.toBeNull();
    // First message should be init, second is the immediate reconcile tick
    const initMsg = mockWorkerInstance!.messages[0];
    expect(initMsg).toMatchObject({
      type: 'init',
      dbPath: '/tmp/test.db',
      apiKey: 'sk-test-key',
    });
  });

  it('start() is idempotent — second call is a no-op', () => {
    queue.start();
    const firstWorker = mockWorkerInstance;
    queue.start();
    // Same worker, no second init message beyond what start() already sent
    expect(mockWorkerInstance).toBe(firstWorker);
  });

  // ---- enqueue() ----

  it('enqueue() before start() drops the job with a warning', () => {
    const job: StatsJob = { table: 'sub_steps', id: 'j1', generationId: 'gen1' };
    queue.enqueue(job);

    // Worker was never created so no messages were posted
    expect(mockWorkerInstance).toBeNull();
  });

  it('enqueue() after start() posts a job message to the worker', () => {
    queue.start();
    const job: StatsJob = { table: 'sub_steps', id: 'j1', generationId: 'gen1' };
    queue.enqueue(job);

    const jobMessages = mockWorkerInstance!.messages.filter((m) => m.type === 'job');
    // At least the explicit enqueue (reconcile tick also enqueues a job)
    const match = jobMessages.find((m) => m.job.id === 'j1');
    expect(match).toMatchObject({ type: 'job', job });
  });

  // ---- onmessage ----

  it("onmessage 'done' decrements pendingCount", async () => {
    queue.start();

    // start() enqueues a reconcile tick — drain it first
    mockWorkerInstance!.simulateMessage({ type: 'done', table: 'reconcile', id: 'r' } satisfies WorkerOutMessage);

    const job: StatsJob = { table: 'sub_steps', id: 'j1', generationId: 'gen1' };
    queue.enqueue(job);

    // Simulate worker completing the job
    mockWorkerInstance!.simulateMessage({ type: 'done', table: 'sub_steps', id: 'j1' } satisfies WorkerOutMessage);

    // All pending jobs are done — terminate should take the fast path (no 'shutdown')
    await queue.terminate();
    expect(mockWorkerInstance!.terminated).toBe(true);
    const shutdownMsgs = mockWorkerInstance!.messages.filter((m) => m.type === 'shutdown');
    expect(shutdownMsgs).toHaveLength(0);
  });

  it("onmessage 'error' decrements pendingCount and logs warning", async () => {
    queue.start();
    const job: StatsJob = { table: 'sub_steps', id: 'j2', generationId: 'gen2' };
    queue.enqueue(job);

    // Simulate worker error response
    mockWorkerInstance!.simulateMessage({
      type: 'error',
      table: 'sub_steps',
      id: 'j2',
      error: 'fetch failed',
    } satisfies WorkerOutMessage);

    // Drain reconcile tick too
    mockWorkerInstance!.simulateMessage({
      type: 'done',
      table: 'reconcile',
      id: 'reconcile_0',
    } satisfies WorkerOutMessage);

    // terminate fast-path should work now
    await queue.terminate();
    expect(mockWorkerInstance!.terminated).toBe(true);
  });

  // ---- terminate() ----

  it('terminate() when no worker resolves immediately', async () => {
    // Never called start()
    await expect(queue.terminate()).resolves.toBeUndefined();
  });

  it('terminate() with no pending jobs terminates worker immediately', async () => {
    queue.start();

    // Drain the reconcile tick that start() enqueues
    mockWorkerInstance!.simulateMessage({ type: 'done', table: 'reconcile', id: 'r' } satisfies WorkerOutMessage);

    await queue.terminate();
    expect(mockWorkerInstance!.terminated).toBe(true);
    // Should NOT have sent a 'shutdown' message (fast path)
    const shutdownMsgs = mockWorkerInstance!.messages.filter((m) => m.type === 'shutdown');
    expect(shutdownMsgs).toHaveLength(0);
  });

  it("terminate() with pending jobs sends 'shutdown' and waits for 'drained'", async () => {
    queue.start();
    const job: StatsJob = { table: 'dags', id: 'd1', generationId: 'gen3' };
    queue.enqueue(job);

    // Start termination (will block waiting for drain)
    const terminatePromise = queue.terminate();

    // Worker should have received a 'shutdown' message
    const shutdownMsgs = mockWorkerInstance!.messages.filter((m) => m.type === 'shutdown');
    expect(shutdownMsgs).toHaveLength(1);

    // Simulate the worker signalling it has drained
    mockWorkerInstance!.simulateMessage({ type: 'drained' } satisfies WorkerOutMessage);

    await terminatePromise;
    expect(mockWorkerInstance!.terminated).toBe(true);
  });
});
