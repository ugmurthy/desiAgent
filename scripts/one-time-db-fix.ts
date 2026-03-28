#!/usr/bin/env bun

import { Database } from 'bun:sqlite';

const dbPath = process.argv[2];

if (!dbPath) {
  console.error('Usage: bun run scripts/one-time-db-fix.ts /absolute/path/to/agent.db');
  process.exit(1);
}

const db = new Database(dbPath);

const tableExists = (table: string): boolean => {
  const rows = db
    .query(`SELECT name FROM sqlite_master WHERE type='table' AND name='${table}';`)
    .all() as Array<{ name?: string }>;

  return rows.some((row) => row.name === table);
};

const hasColumn = (table: string, column: string): boolean => {
  const rows = db.query(`PRAGMA table_info(${table});`).all() as Array<{ name?: string }>;
  return rows.some((row) => row.name === column);
};

if (tableExists('sub_steps') && !hasColumn('sub_steps', 'generation_id')) {
  db.exec('ALTER TABLE sub_steps ADD COLUMN generation_id TEXT;');
  console.log('Added one-time column: sub_steps.generation_id');
}

if (tableExists('policy_artifacts') && !hasColumn('policy_artifacts', 'rule_pack_id')) {
  db.exec("ALTER TABLE policy_artifacts ADD COLUMN rule_pack_id TEXT NOT NULL DEFAULT 'core';");
  console.log('Added one-time column: policy_artifacts.rule_pack_id');
}

if (tableExists('policy_artifacts') && !hasColumn('policy_artifacts', 'rule_pack_version')) {
  db.exec("ALTER TABLE policy_artifacts ADD COLUMN rule_pack_version TEXT NOT NULL DEFAULT '2026.03';");
  console.log('Added one-time column: policy_artifacts.rule_pack_version');
}

if (tableExists('sub_steps')) {
  db.exec('CREATE INDEX IF NOT EXISTS idx_sub_steps_generation_id ON sub_steps(generation_id);');
}

if (tableExists('policy_artifacts')) {
  db.exec('CREATE INDEX IF NOT EXISTS idx_policy_artifacts_rule_pack ON policy_artifacts(rule_pack_id, rule_pack_version);');
}

db.close();

console.log('One-time DB compatibility fix complete for', dbPath);
