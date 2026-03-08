/**
 * StatsWorker - Background Bun Worker thread
 *
 * Receives stats jobs from the main thread, fetches generation stats
 * from OpenRouter, and updates the appropriate DB tables.
 *
 * Runs on a separate thread with its own DB connection.
 * Supports graceful shutdown: drains all pending jobs before exiting.
 */

declare var self: Worker;

import { drizzle } from 'drizzle-orm/bun-sqlite';
import { Database } from 'bun:sqlite';
import { eq, and } from 'drizzle-orm';
import * as schema from '../../db/schema.js';
import { dags, dagExecutions, dagSubSteps } from '../../db/schema.js';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import type { StatsJob, WorkerOutMessage } from './statsQueue.js';

const BASE_URL = 'https://openrouter.ai/api/v1';
const MAX_FETCH_ATTEMPTS = 5;
const INITIAL_DELAY_MS = 2000;

let db: BunSQLiteDatabase<typeof schema> | null = null;
let apiKey: string = '';

/** Number of jobs currently being processed */
let pendingCount = 0;
/** Whether a shutdown has been requested */
let shutdownRequested = false;

/**
 * Check if we can exit after shutdown was requested.
 * Sends 'drained' back to the main thread and exits.
 */
function checkDrain(): void {
  if (shutdownRequested && pendingCount === 0) {
    postMessage({ type: 'drained' } as WorkerOutMessage);
    process.exit(0);
  }
}

/**
 * Fetch generation stats from OpenRouter with exponential backoff.
 */
async function fetchGenerationStats(
  generationId: string,
): Promise<{ data?: Record<string, any>; costUsd?: number; error?: string }> {
  let nextDelayMs = INITIAL_DELAY_MS;

  for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt++) {
    try {
      await new Promise(resolve => setTimeout(resolve, nextDelayMs));

      const res = await fetch(`${BASE_URL}/generation?id=${generationId}`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
      });

      if (!res.ok) {
        if (res.status === 429) {
          const retryAfter = res.headers.get('retry-after');
          nextDelayMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : nextDelayMs * 3;
          continue;
        }
        if (attempt === MAX_FETCH_ATTEMPTS) {
          return { error: `HTTP ${res.status} after ${attempt} attempts` };
        }
        nextDelayMs = nextDelayMs * 2;
        continue;
      }

      const details = (await res.json()) as { data?: Record<string, any> };
      const detailsData = details.data;

      const stats: Record<string, any> = {};
      const allowedKeys = ['latency', 'model', 'generation_time', 'finish_reason', 'native_finish_reason', 'total_cost', 'id'];
      for (const key of allowedKeys) {
        if (detailsData?.[key] !== undefined) {
          stats[key] = detailsData[key];
        }
      }

      const totalCost = detailsData?.total_cost;
      const costUsd = totalCost !== undefined && totalCost !== null
        ? (typeof totalCost === 'number' ? totalCost : parseFloat(totalCost))
        : undefined;

      return { data: stats, costUsd };
    } catch (error) {
      if (attempt === MAX_FETCH_ATTEMPTS) {
        return { error: String(error) };
      }
      nextDelayMs = nextDelayMs * 2;
    }
  }

  return { error: 'Max attempts reached' };
}

/**
 * Update sub_steps table with generation stats and cost.
 * Uses taskId + executionId as composite key (matching the pattern in DAGExecutor).
 */
async function updateSubStep(job: StatsJob): Promise<void> {
  const stats = await fetchGenerationStats(job.generationId);
  if (stats.error || !stats.data) return;

  if (!job.taskId || !job.executionId) return;

  await db!.update(dagSubSteps)
    .set({
      generationStats: stats.data,
      costUsd: stats.costUsd?.toString(),
      updatedAt: new Date(),
    })
    .where(and(
      eq(dagSubSteps.taskId, job.taskId),
      eq(dagSubSteps.executionId, job.executionId),
    ));
}

/**
 * Update dag_executions table by re-aggregating costs from all sub_steps.
 */
async function updateDagExecution(job: StatsJob): Promise<void> {
  // Wait a moment for any sub_step stats workers to finish first
  await new Promise(resolve => setTimeout(resolve, 1000));

  const allSubSteps = await db!.query.dagSubSteps.findMany({
    where: eq(dagSubSteps.executionId, job.id),
  });

  let promptTokens = 0;
  let completionTokens = 0;
  let totalTokens = 0;
  let totalCost = 0;
  let hasUsage = false;
  let hasCost = false;

  for (const step of allSubSteps) {
    if (step.usage) {
      hasUsage = true;
      const u = step.usage as { promptTokens?: number; completionTokens?: number; totalTokens?: number };
      promptTokens += u.promptTokens ?? 0;
      completionTokens += u.completionTokens ?? 0;
      totalTokens += u.totalTokens ?? 0;
    }
    if (step.costUsd) {
      hasCost = true;
      totalCost += parseFloat(step.costUsd);
    }
  }

  await db!.update(dagExecutions)
    .set({
      totalUsage: hasUsage ? { promptTokens, completionTokens, totalTokens } : null,
      totalCostUsd: hasCost ? totalCost.toString() : null,
      updatedAt: new Date(),
    })
    .where(eq(dagExecutions.id, job.id));
}

/**
 * Update dags table: fetch generation stats for a planning attempt
 * and recalculate planning totals.
 */
async function updateDag(job: StatsJob): Promise<void> {
  const stats = await fetchGenerationStats(job.generationId);
  if (stats.error || !stats.data) return;

  const [dagRow] = await db!.select().from(dags).where(eq(dags.id, job.id)).limit(1);
  if (!dagRow) return;

  const updateData: Record<string, any> = {
    generationStats: stats.data,
    updatedAt: new Date(),
  };

  // Patch the specific planning attempt if index is provided
  if (job.attemptIndex !== undefined && dagRow.planningAttempts) {
    const attempts = [...dagRow.planningAttempts];
    if (attempts[job.attemptIndex]) {
      attempts[job.attemptIndex].costUsd = stats.costUsd;
      attempts[job.attemptIndex].generationStats = stats.data;
      updateData.planningAttempts = attempts;

      // Recalculate total planning cost
      let totalCost = 0;
      for (const a of attempts) {
        if (a.costUsd != null) {
          totalCost += typeof a.costUsd === 'number' ? a.costUsd : parseFloat(String(a.costUsd));
        }
      }
      updateData.planningTotalCostUsd = totalCost.toString();
    }
  }

  await db!.update(dags).set(updateData).where(eq(dags.id, job.id));
}

/**
 * Process a single job.
 */
async function processJob(job: StatsJob): Promise<void> {
  switch (job.table) {
    case 'sub_steps':
      await updateSubStep(job);
      break;
    case 'dag_executions':
      await updateDagExecution(job);
      break;
    case 'dags':
      await updateDag(job);
      break;
  }
}

/**
 * Message handler
 */
self.onmessage = async (event: MessageEvent) => {
  const msg = event.data;

  if (msg.type === 'init') {
    // Initialize DB connection on the worker thread
    const sqlite = new Database(msg.dbPath);
    sqlite.exec('PRAGMA journal_mode = WAL;');
    sqlite.exec('PRAGMA foreign_keys = ON;');
    db = drizzle(sqlite, { schema });
    apiKey = msg.apiKey;
    return;
  }

  if (msg.type === 'shutdown') {
    shutdownRequested = true;
    // If nothing is in-flight, drain immediately
    checkDrain();
    return;
  }

  if (msg.type === 'job') {
    // Reject new jobs after shutdown
    if (shutdownRequested) return;

    const job = msg.job as StatsJob;
    pendingCount++;
    try {
      await processJob(job);
      const reply: WorkerOutMessage = { type: 'done', table: job.table, id: job.id };
      postMessage(reply);
    } catch (error) {
      const reply: WorkerOutMessage = {
        type: 'error',
        table: job.table,
        id: job.id,
        error: error instanceof Error ? error.message : String(error),
      };
      postMessage(reply);
    } finally {
      pendingCount--;
      checkDrain();
    }
  }
};
