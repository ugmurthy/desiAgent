#!/usr/bin/env bun
/**
 * init_2_getDatabase.ts — getDatabase() now takes (path, isMemoryDb).
 *
 * If you call getDatabase() directly (outside setupDesiAgent), update the call.
 *
 * Usage: bun run examples/init_2_getDatabase.ts
 */

import { getDatabase, closeDatabase } from '../src/db/client.js';

// File-based DB (isMemoryDb defaults to false)
const db1 = getDatabase('/tmp/test-desiagent.db');
console.log('File-based DB created:', !!db1);
closeDatabase();

// In-memory DB — must pass isMemoryDb = true
const db2 = getDatabase(':memory:', true);
console.log('In-memory DB created:', !!db2);
closeDatabase();
