#!/usr/bin/env bun
/**
 * Test: requestStopForExecution — insert & query stop requests for executions
 *
 * Usage: bun run scripts/test-stop-execution.ts
 *
 * Creates a temp database, seeds a DAG + execution + sub-step, inserts a
 * stop request for the execution, and verifies lookup, handling, and that
 * unrelated executions are not affected.
 */

import { initDB } from '../src/services/initDB.js';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { existsSync, unlinkSync } from 'fs';
import * as schema from '../src/db/schema.js';
import {
  insertStopRequestForExecution,
  hasActiveStopRequestForExecution,
  markStopRequestHandledForExecution,
} from '../src/db/stopRequestHelpers.js';
import type { DrizzleDB } from '../src/db/client.js';

const TMP_DB = '/tmp/test_stop_execution.sqlite';

function cleanup() {
  for (const f of [TMP_DB, `${TMP_DB}-wal`, `${TMP_DB}-shm`]) {
    if (existsSync(f)) unlinkSync(f);
  }
}

async function main() {
  cleanup();

  console.log('── Test: requestStopForExecution() ──\n');

  // 1. Initialise DB
  const initResult = await initDB(TMP_DB, { force: true });
  if (!initResult.success) {
    console.error('✗ initDB failed:', initResult.message);
    process.exit(1);
  }

  const sqlite = new Database(TMP_DB);
  sqlite.exec('PRAGMA journal_mode = WAL;');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  const db: DrizzleDB = drizzle(sqlite, { schema });

  // 2. Seed a DAG
  const dagId = 'dag_exec_test_001';
  await db.insert(schema.dags).values({
    id: dagId,
    status: 'completed',
    attempts: 1,
  });
  console.log(`✓ Seeded DAG: ${dagId}`);

  // 3. Seed an execution
  const execId = 'exec_test_001';
  await db.insert(schema.dagExecutions).values({
    id: execId,
    dagId,
    originalRequest: 'test goal',
    primaryIntent: 'testing stop signal',
    status: 'running',
    totalTasks: 3,
    completedTasks: 1,
    failedTasks: 0,
    waitingTasks: 2,
  });
  console.log(`✓ Seeded execution: ${execId}`);

  // 4. Seed a sub-step tied to the execution
  const subStepId = 'substep_test_001';
  await db.insert(schema.dagSubSteps).values({
    id: subStepId,
    executionId: execId,
    taskId: 'task_1',
    description: 'Fetch weather data',
    thought: 'Need current temperature',
    actionType: 'tool',
    toolOrPromptName: 'weather_api',
    toolOrPromptParams: {},
    dependencies: JSON.stringify([]) as any,
    status: 'running',
  });
  console.log(`✓ Seeded sub-step: ${subStepId}`);

  // 5. Before stop, no active request
  const before = await hasActiveStopRequestForExecution(db, execId);
  if (before) {
    console.error('✗ Should have no active stop request before insert');
    process.exit(1);
  }
  console.log('✓ No active stop request before insert');

  // 6. Insert a stop request for the execution
  await insertStopRequestForExecution(db, execId);
  console.log('✓ insertStopRequestForExecution succeeded');

  // 7. Verify active stop request detected
  const afterInsert = await hasActiveStopRequestForExecution(db, execId);
  if (!afterInsert) {
    console.error('✗ Should detect active stop request after insert');
    process.exit(1);
  }
  console.log('✓ Active stop request detected for execution');

  // 8. Verify the stop request row has correct executionId and null dagId
  const rows = await db.select().from(schema.dagStopRequests);
  const row = rows[0];
  if (row.executionId !== execId) {
    console.error(`✗ Expected executionId=${execId}, got ${row.executionId}`);
    process.exit(1);
  }
  if (row.dagId !== null) {
    console.error(`✗ Expected dagId=null for execution stop, got ${row.dagId}`);
    process.exit(1);
  }
  if (row.status !== 'requested') {
    console.error(`✗ Expected status=requested, got ${row.status}`);
    process.exit(1);
  }
  console.log('✓ Stop request row has correct executionId, null dagId, status=requested');

  // 9. Mark as handled
  await markStopRequestHandledForExecution(db, execId);
  const afterHandled = await hasActiveStopRequestForExecution(db, execId);
  if (afterHandled) {
    console.error('✗ Should not detect active stop request after handling');
    process.exit(1);
  }
  console.log('✓ Stop request marked as handled');

  // 10. Verify handled row
  const handledRows = await db.select().from(schema.dagStopRequests);
  const handled = handledRows[0];
  if (handled.status !== 'handled' || handled.handledAt === null) {
    console.error('✗ Handled row should have status=handled and handledAt set');
    process.exit(1);
  }
  console.log('✓ Handled row has status=handled and handledAt timestamp');

  // 11. Unrelated executionId should not be affected
  const unrelated = await hasActiveStopRequestForExecution(db, 'exec_other_999');
  if (unrelated) {
    console.error('✗ Unrelated executionId should not have a stop request');
    process.exit(1);
  }
  console.log('✓ Unrelated executionId unaffected');

  // 12. Verify the sub-step is still in the DB (stop doesn't cascade-delete)
  const subSteps = await db.select().from(schema.dagSubSteps);
  if (subSteps.length !== 1 || subSteps[0].id !== subStepId) {
    console.error('✗ Sub-step should still exist after stop request');
    process.exit(1);
  }
  console.log('✓ Sub-step still present (stop request does not cascade-delete)');

  sqlite.close();
  cleanup();
  console.log('\n✅ All requestStopForExecution checks passed');
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  cleanup();
  process.exit(1);
});
