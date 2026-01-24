#!/usr/bin/env bun
/**
 * Create an empty database with all tables from the schema
 * Dynamically generates SQL from src/db/schema.ts
 * 
 * Usage:
 *   bun scripts/create-db.ts <dbfilename> [--force]
 * 
 * Options:
 *   --force  Delete existing database file before creating
 */

import { Database } from 'bun:sqlite';
import { existsSync, unlinkSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import type { SQLiteTable, SQLiteColumn } from 'drizzle-orm/sqlite-core';
import * as schema from '../src/db/schema.js';

const TABLE_NAME_SYMBOL = Symbol.for('drizzle:Name');

interface ColumnConfig {
  name: string;
  getSQLType: () => string;
  notNull: boolean;
  hasDefault: boolean;
  default: unknown;
  primary: boolean;
}

interface IndexConfig {
  config: {
    name: string;
    columns: SQLiteColumn[];
    unique: boolean;
    where?: {
      queryChunks: Array<{ value?: string[]; name?: string }>;
    };
  };
}

function generateColumnSQL(col: ColumnConfig): string {
  let sql = `${col.name} ${col.getSQLType()}`;
  
  if (col.primary) {
    sql += ' PRIMARY KEY';
  }
  
  if (col.notNull && !col.primary) {
    sql += ' NOT NULL';
  }
  
  if (col.hasDefault && col.default !== undefined) {
    const defaultVal = col.default;
    if (typeof defaultVal === 'object' && defaultVal !== null && 'queryChunks' in defaultVal) {
      const chunks = (defaultVal as any).queryChunks;
      const sqlParts = chunks.map((c: any) => c.value?.[0] ?? '').join('');
      sql += ` DEFAULT ${sqlParts}`;
    } else if (typeof defaultVal === 'string') {
      sql += ` DEFAULT '${defaultVal}'`;
    } else if (typeof defaultVal === 'number' || typeof defaultVal === 'boolean') {
      sql += ` DEFAULT ${defaultVal === true ? 1 : defaultVal === false ? 0 : defaultVal}`;
    }
  }
  
  return sql;
}

function generateForeignKeySQL(fk: any, tableName: string): string | null {
  try {
    const localCols = fk.columns.map((c: SQLiteColumn) => c.name).join(', ');
    const foreignTable = fk.foreignColumns[0]?.table?.[TABLE_NAME_SYMBOL];
    if (!foreignTable) return null;
    const foreignCols = fk.foreignColumns.map((c: SQLiteColumn) => c.name).join(', ');
    let fkSql = `FOREIGN KEY (${localCols}) REFERENCES ${foreignTable}(${foreignCols})`;
    if (fk.onDelete) fkSql += ` ON DELETE ${fk.onDelete.toUpperCase()}`;
    if (fk.onUpdate) fkSql += ` ON UPDATE ${fk.onUpdate.toUpperCase()}`;
    return fkSql;
  } catch {
    return null;
  }
}

function generateIndexSQL(idx: IndexConfig, tableName: string): string {
  const cfg = idx.config;
  const idxCols = cfg.columns.map((c) => c.name).join(', ');
  let idxSql = `CREATE ${cfg.unique ? 'UNIQUE ' : ''}INDEX IF NOT EXISTS ${cfg.name} ON ${tableName}(${idxCols})`;
  
  if (cfg.where) {
    const chunks = cfg.where.queryChunks;
    const whereParts: string[] = [];
    for (const chunk of chunks) {
      if (chunk.value) {
        whereParts.push(chunk.value.join(''));
      } else if (chunk.name) {
        whereParts.push(chunk.name);
      }
    }
    const whereClause = whereParts.join('');
    if (whereClause.trim()) {
      idxSql += ` WHERE ${whereClause}`;
    }
  }
  
  return idxSql + ';';
}

function generateTableSQL(table: SQLiteTable): { createTable: string; indexes: string[] } {
  const config = getTableConfig(table);
  const columns: string[] = [];
  const foreignKeys: string[] = [];
  const indexes: string[] = [];

  for (const col of config.columns) {
    columns.push(generateColumnSQL(col as unknown as ColumnConfig));
  }

  for (const fk of config.foreignKeys) {
    const fkSql = generateForeignKeySQL(fk, config.name);
    if (fkSql) foreignKeys.push(fkSql);
  }

  const createTable = `CREATE TABLE IF NOT EXISTS ${config.name} (\n  ${[...columns, ...foreignKeys].join(',\n  ')}\n);`;

  for (const idx of config.indexes) {
    indexes.push(generateIndexSQL(idx as unknown as IndexConfig, config.name));
  }

  return { createTable, indexes };
}

function generateViewSQL(): string {
  return `
CREATE VIEW IF NOT EXISTS executions AS
SELECT
  d.dag_title,
  e.id,
  e.dag_id,
  e.original_request,
  e.primary_intent,
  e.status,
  e.started_at,
  e.completed_at,
  e.duration_ms,
  e.total_tasks,
  e.completed_tasks,
  e.failed_tasks,
  e.waiting_tasks,
  e.final_result,
  e.synthesis_result,
  e.suspended_reason,
  e.suspended_at,
  e.retry_count,
  e.last_retry_at,
  e.total_usage,
  e.total_cost_usd,
  e.created_at,
  e.updated_at
FROM dag_executions e
LEFT JOIN dags d ON e.dag_id = d.id;`;
}

function generateAllSQL(): string {
  const tables: SQLiteTable[] = [
    schema.agents,
    schema.dags,
    schema.dagExecutions,
    schema.dagSubSteps,
  ];

  const statements: string[] = [];

  for (const table of tables) {
    const { createTable, indexes } = generateTableSQL(table);
    statements.push(createTable);
    statements.push(...indexes);
  }

  statements.push(generateViewSQL());

  return statements.join('\n\n');
}

function printUsage() {
  console.log(`
Usage: bun scripts/create-db.ts <dbfilename> [--force]

Arguments:
  dbfilename  Path to the SQLite database file to create

Options:
  --force     Delete existing database file before creating

Examples:
  bun scripts/create-db.ts ./data/mydb.sqlite
  bun scripts/create-db.ts ./data/mydb.sqlite --force
`);
}

function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printUsage();
    process.exit(args.length === 0 ? 1 : 0);
  }

  const forceIndex = args.indexOf('--force');
  const force = forceIndex !== -1;
  const dbFilename = args.find(arg => arg !== '--force');

  if (!dbFilename) {
    console.error('Error: Database filename is required');
    printUsage();
    process.exit(1);
  }

  if (existsSync(dbFilename)) {
    if (force) {
      console.log(`Deleting existing database: ${dbFilename}`);
      unlinkSync(dbFilename);
      if (existsSync(`${dbFilename}-wal`)) unlinkSync(`${dbFilename}-wal`);
      if (existsSync(`${dbFilename}-shm`)) unlinkSync(`${dbFilename}-shm`);
    } else {
      console.error(`Error: Database file already exists: ${dbFilename}`);
      console.error('Use --force to delete and recreate');
      process.exit(1);
    }
  }

  const dbDir = dirname(dbFilename);
  if (dbDir && dbDir !== '.' && !existsSync(dbDir)) {
    console.log(`Creating directory: ${dbDir}`);
    mkdirSync(dbDir, { recursive: true });
  }

  console.log(`Creating database: ${dbFilename}`);
  
  const sqlite = new Database(dbFilename);
  
  sqlite.exec('PRAGMA journal_mode = WAL;');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  
  const sql = generateAllSQL();
  sqlite.exec(sql);
  
  sqlite.close();

  console.log('Database created successfully with tables:');
  console.log('  - agents');
  console.log('  - dags');
  console.log('  - dag_executions');
  console.log('  - sub_steps');
  console.log('  - executions (view)');
}

main();
