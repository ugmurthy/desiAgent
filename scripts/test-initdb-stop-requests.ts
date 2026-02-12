#!/usr/bin/env bun
/**
 * Test: initDB creates the dag_stop_requests table
 *
 * Usage: bun run scripts/test-initdb-stop-requests.ts
 *
 * Creates a temporary database via initDB(), verifies the dag_stop_requests
 * table exists with the expected columns, then cleans up.
 */

import { initDB } from '../src/services/initDB.js';
import { Database } from 'bun:sqlite';
import { existsSync, unlinkSync } from 'fs';

const TMP_DB = '/tmp/test_initdb_stop_requests.sqlite';

// Clean up any leftover file
function cleanup() {
  for (const f of [TMP_DB, `${TMP_DB}-wal`, `${TMP_DB}-shm`]) {
    if (existsSync(f)) unlinkSync(f);
  }
}

async function main() {
  cleanup();

  console.log('── Test: initDB initialises dag_stop_requests ──\n');

  // 1. Run initDB
  const result = await initDB(TMP_DB, { force: true });
  if (!result.success) {
    console.error('✗ initDB failed:', result.message);
    process.exit(1);
  }
  console.log('✓ initDB succeeded');
  console.log('  Tables:', result.tables?.join(', '));

  // 2. Check that dag_stop_requests is in the returned table list
  if (result.tables?.includes('dag_stop_requests')) {
    console.log('✓ dag_stop_requests listed in initDB result');
  } else {
    console.error('✗ dag_stop_requests NOT in initDB result.tables');
    cleanup();
    process.exit(1);
  }

  // 3. Open the database directly and verify the table schema
  const sqlite = new Database(TMP_DB, { readonly: true });

  const tableInfo = sqlite
    .prepare("PRAGMA table_info('dag_stop_requests')")
    .all() as Array<{ name: string; type: string; notnull: number; pk: number }>;

  if (tableInfo.length === 0) {
    console.error('✗ dag_stop_requests table does not exist in the database');
    sqlite.close();
    cleanup();
    process.exit(1);
  }

  console.log('✓ dag_stop_requests table exists in SQLite');

  const expectedColumns = ['id', 'dag_id', 'execution_id', 'status', 'requested_at', 'handled_at'];
  const actualColumns = tableInfo.map((c) => c.name);

  const missing = expectedColumns.filter((col) => !actualColumns.includes(col));
  if (missing.length > 0) {
    console.error('✗ Missing columns:', missing.join(', '));
    sqlite.close();
    cleanup();
    process.exit(1);
  }

  console.log('✓ All expected columns present:', actualColumns.join(', '));

  // 4. Verify column constraints
  const idCol = tableInfo.find((c) => c.name === 'id')!;
  const statusCol = tableInfo.find((c) => c.name === 'status')!;
  const requestedAtCol = tableInfo.find((c) => c.name === 'requested_at')!;

  if (idCol.pk !== 1) {
    console.error('✗ id column is not the primary key');
    sqlite.close();
    cleanup();
    process.exit(1);
  }
  console.log('✓ id is PRIMARY KEY');

  if (statusCol.notnull !== 1) {
    console.error('✗ status column should be NOT NULL');
    sqlite.close();
    cleanup();
    process.exit(1);
  }
  console.log('✓ status is NOT NULL');

  if (requestedAtCol.notnull !== 1) {
    console.error('✗ requested_at column should be NOT NULL');
    sqlite.close();
    cleanup();
    process.exit(1);
  }
  console.log('✓ requested_at is NOT NULL');

  sqlite.close();
  cleanup();
  console.log('\n✅ All initDB stop-requests checks passed');
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  cleanup();
  process.exit(1);
});
