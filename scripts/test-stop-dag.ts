#!/usr/bin/env bun
/**
 * Test: requestStopForDag — insert & query stop requests for DAGs
 *
 * Usage: bun run scripts/test-stop-dag.ts
 *
 * Creates a temp database, seeds a DAG row, inserts a stop request via
 * the helper, then verifies lookup, idempotency, and mark-as-handled.
 */

import { initDB } from '../src/services/initDB.js';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { existsSync, unlinkSync } from 'fs';
import * as schema from '../src/db/schema.js';
import {
  insertStopRequestForDag,
  hasActiveStopRequestForDag,
  markStopRequestHandledForDag,
} from '../src/db/stopRequestHelpers.js';
import type { DrizzleDB } from '../src/db/client.js';

const TMP_DB = '/tmp/test_stop_dag.sqlite';

function cleanup() {
  for (const f of [TMP_DB, `${TMP_DB}-wal`, `${TMP_DB}-shm`]) {
    if (existsSync(f)) unlinkSync(f);
  }
}

async function main() {
  cleanup();

  console.log('── Test: requestStopForDag() ──\n');

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

  // 2. Seed a DAG row (minimal data so FK constraints are satisfied)
  const dagId = 'dag_test_stop_001';
  await db.insert(schema.dags).values({
    id: dagId,
    status: 'planning',
    attempts: 0,
  });
  console.log(`✓ Seeded DAG: ${dagId}`);

  // 3. Before any stop request, hasActive should be false
  const beforeStop = await hasActiveStopRequestForDag(db, dagId);
  if (beforeStop) {
    console.error('✗ hasActiveStopRequestForDag should be false before insert');
    process.exit(1);
  }
  console.log('✓ No active stop request before insert');

  // 4. Insert a stop request
  await insertStopRequestForDag(db, dagId);
  console.log('✓ insertStopRequestForDag succeeded');

  // 5. Verify the row landed
  const afterStop = await hasActiveStopRequestForDag(db, dagId);
  if (!afterStop) {
    console.error('✗ hasActiveStopRequestForDag should be true after insert');
    process.exit(1);
  }
  console.log('✓ Active stop request detected');

  // 6. Idempotency — inserting a second stop request should not throw
  await insertStopRequestForDag(db, dagId);
  console.log('✓ Second insertStopRequestForDag succeeded (idempotent)');

  // 7. Verify raw rows — should be 2 rows
  const rows = await db
    .select()
    .from(schema.dagStopRequests);
  if (rows.length !== 2) {
    console.error(`✗ Expected 2 stop request rows, got ${rows.length}`);
    process.exit(1);
  }
  console.log(`✓ ${rows.length} stop request rows in table`);

  // 8. Mark as handled
  await markStopRequestHandledForDag(db, dagId);
  const afterHandled = await hasActiveStopRequestForDag(db, dagId);
  if (afterHandled) {
    console.error('✗ hasActiveStopRequestForDag should be false after marking handled');
    process.exit(1);
  }
  console.log('✓ Stop requests marked as handled');

  // 9. Verify handled rows have handledAt set
  const handledRows = await db
    .select()
    .from(schema.dagStopRequests);
  const allHandled = handledRows.every((r) => r.status === 'handled' && r.handledAt !== null);
  if (!allHandled) {
    console.error('✗ Not all rows are status=handled with handledAt set');
    process.exit(1);
  }
  console.log('✓ All rows have status=handled and handledAt timestamp');

  // 10. A different dagId should not be affected
  const otherDag = await hasActiveStopRequestForDag(db, 'dag_other_999');
  if (otherDag) {
    console.error('✗ Unrelated dagId should not have a stop request');
    process.exit(1);
  }
  console.log('✓ Unrelated dagId unaffected');

  sqlite.close();
  cleanup();
  console.log('\n✅ All requestStopForDag checks passed');
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  cleanup();
  process.exit(1);
});
