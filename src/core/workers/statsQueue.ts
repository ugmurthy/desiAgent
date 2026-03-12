/**
 * StatsQueue - Main-thread interface for enqueueing generation stats updates
 *
 * Spawns a Bun Worker thread that fetches OpenRouter generation stats
 * and updates the DB in the background, keeping the hot path fast.
 */

import { getLogger } from '../../util/logger.js';

/**
 * A stats update job to be processed by the worker.
 */
export interface StatsJob {
  /** Which table to update */
  table: 'sub_steps' | 'dag_executions' | 'dags' | 'reconcile';
  /** Row ID in that table (dagId for 'dags', executionId for 'dag_executions') */
  id: string;
  /** OpenRouter generation ID for fetching stats */
  generationId?: string;
  /**
   * For 'sub_steps': the taskId used with executionId to locate the row.
   */
  taskId?: string;
  /**
   * For 'sub_steps': the executionId the sub-step belongs to.
   */
  executionId?: string;
  /**
   * For 'dags' table: which planning attempt index to annotate with costUsd/generationStats.
   * The worker reads the current planningAttempts JSON, patches the entry, and recalculates totals.
   */
  attemptIndex?: number;
}

/**
 * Message sent from main thread → worker
 */
export interface WorkerInMessage {
  type: 'init' | 'job' | 'shutdown';
  dbPath?: string;
  apiKey?: string;
  reconcileIntervalMs?: number;
  reconcileBatchSize?: number;
  job?: StatsJob;
}

/**
 * Message sent from worker → main thread
 */
export interface WorkerOutMessage {
  type: 'done' | 'error' | 'drained';
  table?: string;
  id?: string;
  error?: string;
}

/** Max time (ms) to wait for the worker to drain before force-terminating */
const DRAIN_TIMEOUT_MS = 30_000;
const DEFAULT_RECONCILE_INTERVAL_MS = 30_000;
const DEFAULT_RECONCILE_BATCH_SIZE = 50;

export interface StatsQueueOptions {
  reconcileIntervalMs?: number;
  reconcileBatchSize?: number;
}

export class StatsQueue {
  private worker: Worker | null = null;
  private logger = getLogger();
  private dbPath: string;
  private apiKey: string;
  private pendingCount = 0;
  private reconcileInFlight = false;
  private reconcileTimer: ReturnType<typeof setInterval> | null = null;
  private reconcileIntervalMs: number;
  private reconcileBatchSize: number;

  constructor(dbPath: string, apiKey: string, options?: StatsQueueOptions) {
    this.dbPath = dbPath;
    this.apiKey = apiKey;
    this.reconcileIntervalMs = options?.reconcileIntervalMs ?? DEFAULT_RECONCILE_INTERVAL_MS;
    this.reconcileBatchSize = options?.reconcileBatchSize ?? DEFAULT_RECONCILE_BATCH_SIZE;
  }

  /**
   * Start the background worker. Safe to call multiple times (idempotent).
   */
  start(): void {
    if (this.worker) return;

    const workerUrl = new URL('./statsWorker.js', import.meta.url).href;
    this.worker = new Worker(workerUrl);

    // Send init config
    this.worker.postMessage({
      type: 'init',
      dbPath: this.dbPath,
      apiKey: this.apiKey,
      reconcileIntervalMs: this.reconcileIntervalMs,
      reconcileBatchSize: this.reconcileBatchSize,
    });

    this.worker.onmessage = (event: MessageEvent<WorkerOutMessage>) => {
      const msg = event.data;
      if (msg.type === 'done') {
        this.pendingCount = Math.max(0, this.pendingCount - 1);
        if (msg.table === 'reconcile') {
          this.reconcileInFlight = false;
        }
        this.logger.debug({ table: msg.table, id: msg.id }, 'StatsWorker: update complete');
      } else if (msg.type === 'error') {
        this.pendingCount = Math.max(0, this.pendingCount - 1);
        if (msg.table === 'reconcile') {
          this.reconcileInFlight = false;
        }
        this.logger.warn({ table: msg.table, id: msg.id, error: msg.error }, 'StatsWorker: update failed');
      }
      // 'drained' is handled by the terminate() promise listener
    };

    this.worker.onerror = (event) => {
      this.logger.error({ error: event.message }, 'StatsWorker: worker error');
    };

    // Don't let the worker keep the process alive during normal operation
    this.worker.unref();

    this.reconcileTimer = setInterval(() => {
      this.enqueueReconcileTick();
    }, this.reconcileIntervalMs);
    this.reconcileTimer.unref?.();

    this.enqueueReconcileTick();

    this.logger.info({
      reconcileIntervalMs: this.reconcileIntervalMs,
      reconcileBatchSize: this.reconcileBatchSize,
    }, 'StatsQueue: background worker started');
  }

  private enqueueReconcileTick(): void {
    if (!this.worker || this.reconcileInFlight) {
      return;
    }

    this.reconcileInFlight = true;
    this.enqueue({
      table: 'reconcile',
      id: `reconcile_${Date.now()}`,
    });
  }

  /**
   * Enqueue a stats update job for background processing.
   * If the worker isn't started, silently drops the job with a warning.
   */
  enqueue(job: StatsJob): void {
    if (!this.worker) {
      this.logger.warn({ job }, 'StatsQueue: worker not started, dropping job');
      return;
    }

    this.pendingCount++;
    const msg: WorkerInMessage = { type: 'job', job };
    this.worker.postMessage(msg);
    this.logger.debug({ table: job.table, id: job.id, generationId: job.generationId }, 'StatsQueue: job enqueued');
  }

  /**
   * Gracefully terminate the worker after all pending jobs are processed.
   * Waits up to DRAIN_TIMEOUT_MS for the worker to drain, then force-terminates.
   */
  async terminate(): Promise<void> {
    if (!this.worker) return;

    if (this.reconcileTimer) {
      clearInterval(this.reconcileTimer);
      this.reconcileTimer = null;
    }

    // Fast path: no pending work
    if (this.pendingCount <= 0) {
      this.worker.terminate();
      this.worker = null;
      this.logger.info('StatsQueue: worker terminated (no pending jobs)');
      return;
    }

    this.logger.info({ pendingCount: this.pendingCount }, 'StatsQueue: draining pending jobs before shutdown');

    // Need to ref the worker so the process stays alive while draining
    this.worker.ref();

    const worker = this.worker;

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        this.logger.warn({ pendingCount: this.pendingCount }, 'StatsQueue: drain timeout reached, force-terminating');
        worker.terminate();
        resolve();
      }, DRAIN_TIMEOUT_MS);

      const onMessage = (event: MessageEvent<WorkerOutMessage>) => {
        if (event.data.type === 'drained') {
          clearTimeout(timeout);
          worker.terminate();
          this.logger.info('StatsQueue: worker drained and terminated');
          resolve();
        }
      };

      worker.addEventListener('message', onMessage);
      worker.postMessage({ type: 'shutdown' } as WorkerInMessage);
    });

    this.worker = null;
    this.pendingCount = 0;
    this.reconcileInFlight = false;
  }
}
