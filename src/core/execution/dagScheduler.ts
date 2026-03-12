/**
 * DAG Scheduler
 *
 * Concrete in-process scheduler that uses node-cron to trigger DAG executions.
 */

import cron from 'node-cron';
import { and, eq, isNotNull } from 'drizzle-orm';
import type { DrizzleDB } from '../../db/client.js';
import { dags } from '../../db/schema.js';
import { getLogger } from '../../util/logger.js';
import type { DagScheduler } from './dags.js';

interface NodeCronDagSchedulerDeps {
  db: DrizzleDB;
  executeDAG: (dagId: string) => Promise<{ id: string; status: string }>;
}

export class NodeCronDagScheduler implements DagScheduler {
  private db: DrizzleDB;
  private executeDAG: (dagId: string) => Promise<{ id: string; status: string }>;
  private tasks = new Map<string, ReturnType<typeof cron.schedule>>();
  private inFlightDagRuns = new Set<string>();
  private logger = getLogger();

  constructor(deps: NodeCronDagSchedulerDeps) {
    this.db = deps.db;
    this.executeDAG = deps.executeDAG;
  }

  registerDAGSchedule(dag: {
    id: string;
    cronSchedule: string;
    scheduleActive: boolean;
    timezone?: string;
  }): void {
    if (!dag.scheduleActive || !dag.cronSchedule) {
      this.unregisterDAGSchedule(dag.id);
      return;
    }

    this.registerTask(dag.id, dag.cronSchedule, dag.timezone);
  }

  updateDAGSchedule(id: string, cronSchedule: string, scheduleActive: boolean, timezone?: string): void {
    if (!scheduleActive || !cronSchedule) {
      this.unregisterDAGSchedule(id);
      return;
    }

    this.registerTask(id, cronSchedule, timezone);
  }

  unregisterDAGSchedule(id: string): void {
    const existingTask = this.tasks.get(id);
    if (!existingTask) {
      return;
    }

    existingTask.stop();
    this.tasks.delete(id);
    this.logger.debug({ dagId: id }, 'DAG schedule task removed');
  }

  async hydrateFromDatabase(): Promise<void> {
    const scheduledDags = await this.db
      .select({
        id: dags.id,
        cronSchedule: dags.cronSchedule,
        scheduleActive: dags.scheduleActive,
        timezone: dags.timezone,
      })
      .from(dags)
      .where(and(
        isNotNull(dags.cronSchedule),
        eq(dags.scheduleActive, true),
        eq(dags.status, 'success')
      ));

    for (const dag of scheduledDags) {
      if (!dag.cronSchedule || !dag.scheduleActive) {
        continue;
      }

      this.registerTask(dag.id, dag.cronSchedule, dag.timezone || 'UTC');
    }

    this.logger.info({ count: scheduledDags.length }, 'Hydrated DAG schedules from database');
  }

  stopAll(): void {
    const dagIds = Array.from(this.tasks.keys());
    for (const dagId of dagIds) {
      this.unregisterDAGSchedule(dagId);
    }
    this.logger.info('Stopped all DAG schedules');
  }

  private registerTask(dagId: string, cronSchedule: string, timezone: string = 'UTC'): void {
    this.unregisterDAGSchedule(dagId);

    const task = cron.schedule(
      cronSchedule,
      () => {
        void this.triggerDAG(dagId);
      },
      { timezone }
    );

    this.tasks.set(dagId, task);
    this.logger.info({ dagId, cronSchedule, timezone }, 'DAG schedule task registered');
  }

  private async triggerDAG(dagId: string): Promise<void> {
    if (this.inFlightDagRuns.has(dagId)) {
      this.logger.warn({ dagId }, 'Skipping scheduled DAG run because a prior run is still active');
      return;
    }

    this.inFlightDagRuns.add(dagId);
    try {
      const execution = await this.executeDAG(dagId);
      await this.db
        .update(dags)
        .set({
          lastRunAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(dags.id, dagId));

      this.logger.info({ dagId, executionId: execution.id }, 'Scheduled DAG run started');
    } catch (error) {
      this.logger.error({ err: error, dagId }, 'Scheduled DAG run failed to start');
    } finally {
      this.inFlightDagRuns.delete(dagId);
    }
  }
}
