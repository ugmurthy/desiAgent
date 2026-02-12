/**
 * initDB Service
 * Programmatically creates a SQLite database with all tables from the schema
 */

import { Database } from 'bun:sqlite';
import { existsSync, unlinkSync, readFileSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import type { SQLiteTable, SQLiteColumn } from 'drizzle-orm/sqlite-core';
import * as schema from '../db/schema.js';

interface AgentSeedData {
  id: string;
  name: string;
  version: string;
  prompt_template: string;
  provider: string | null;
  model: string | null;
  active: boolean;
  metadata: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface InitDBOptions {
  force?: boolean;
}

export interface InitDBResult {
  success: boolean;
  message: string;
  tables?: string[];
  views?: string[];
  agentsSeeded?: number;
  artifactsDir?: string;
}

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
      const chunks = (defaultVal as { queryChunks: Array<{ value?: string[] }> }).queryChunks;
      const sqlParts = chunks.map((c) => c.value?.[0] ?? '').join('');
      sql += ` DEFAULT ${sqlParts}`;
    } else if (typeof defaultVal === 'string') {
      sql += ` DEFAULT '${defaultVal}'`;
    } else if (typeof defaultVal === 'number' || typeof defaultVal === 'boolean') {
      sql += ` DEFAULT ${defaultVal === true ? 1 : defaultVal === false ? 0 : defaultVal}`;
    }
  }
  
  return sql;
}

function generateForeignKeySQL(fk: {
  columns: SQLiteColumn[];
  foreignColumns: Array<{ table?: Record<symbol, string>; name: string }>;
  onDelete?: string;
  onUpdate?: string;
}): string | null {
  try {
    const localCols = fk.columns.map((c: SQLiteColumn) => c.name).join(', ');
    const foreignTable = fk.foreignColumns[0]?.table?.[TABLE_NAME_SYMBOL];
    if (!foreignTable) return null;
    const foreignCols = fk.foreignColumns.map((c) => c.name).join(', ');
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

function generateTableSQL(table: SQLiteTable): { createTable: string; indexes: string[]; tableName: string } {
  const config = getTableConfig(table);
  const columns: string[] = [];
  const foreignKeys: string[] = [];
  const indexes: string[] = [];

  for (const col of config.columns) {
    columns.push(generateColumnSQL(col as unknown as ColumnConfig));
  }

  for (const fk of config.foreignKeys) {
    const fkSql = generateForeignKeySQL(fk as unknown as Parameters<typeof generateForeignKeySQL>[0]);
    if (fkSql) foreignKeys.push(fkSql);
  }

  const createTable = `CREATE TABLE IF NOT EXISTS ${config.name} (\n  ${[...columns, ...foreignKeys].join(',\n  ')}\n);`;

  for (const idx of config.indexes) {
    indexes.push(generateIndexSQL(idx as unknown as IndexConfig, config.name));
  }

  return { createTable, indexes, tableName: config.name };
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

function generateAllSQL(): { sql: string; tableNames: string[] } {
  const tables: SQLiteTable[] = [
    schema.agents,
    schema.dags,
    schema.dagExecutions,
    schema.dagSubSteps,
    schema.dagStopRequests,
  ];

  const statements: string[] = [];
  const tableNames: string[] = [];

  for (const table of tables) {
    const { createTable, indexes, tableName } = generateTableSQL(table);
    statements.push(createTable);
    statements.push(...indexes);
    tableNames.push(tableName);
  }

  statements.push(generateViewSQL());

  return { sql: statements.join('\n\n'), tableNames };
}

function seedAgents(sqlite: Database, seedPath?: string): number {
  const defaultSeedPath = resolve(dirname(import.meta.dir), '../seed/agents.json');
  const agentsFile = seedPath ?? defaultSeedPath;
  
  if (!existsSync(agentsFile)) {
    return 0;
  }

  const agentsData: AgentSeedData[] = JSON.parse(readFileSync(agentsFile, 'utf-8'));
  
  const insertStmt = sqlite.prepare(`
    INSERT INTO agents (id, name, version, prompt_template, provider, model, active, metadata, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let count = 0;
  for (const agent of agentsData) {
    insertStmt.run(
      agent.id,
      agent.name,
      agent.version,
      agent.prompt_template,
      agent.provider,
      agent.model,
      agent.active ? 1 : 0,
      JSON.stringify(agent.metadata),
      Math.floor(new Date(agent.created_at).getTime() / 1000),
      Math.floor(new Date(agent.updated_at).getTime() / 1000)
    );
    count++;
  }

  return count;
}

export async function initDB(dbPath: string, options?: InitDBOptions): Promise<InitDBResult> {
  const force = options?.force ?? false;

  if (!dbPath || dbPath.trim() === '') {
    return { success: false, message: 'Database path is required' };
  }

  const dbDir = dirname(dbPath);
  if (dbDir && dbDir !== '.' && !existsSync(dbDir)) {
    return { success: false, message: `Parent directory does not exist: ${dbDir}` };
  }

  if (existsSync(dbPath)) {
    if (force) {
      try {
        unlinkSync(dbPath);
        if (existsSync(`${dbPath}-wal`)) unlinkSync(`${dbPath}-wal`);
        if (existsSync(`${dbPath}-shm`)) unlinkSync(`${dbPath}-shm`);
      } catch (err) {
        return { success: false, message: `Failed to delete existing database: ${err instanceof Error ? err.message : String(err)}` };
      }
    } else {
      return { success: false, message: `Database file already exists: ${dbPath}. Use force option to overwrite.` };
    }
  }

  try {
    const sqlite = new Database(dbPath);
    
    sqlite.exec('PRAGMA journal_mode = WAL;');
    sqlite.exec('PRAGMA foreign_keys = ON;');
    
    const { sql, tableNames } = generateAllSQL();
    sqlite.exec(sql);
    
    const agentsSeeded = seedAgents(sqlite);
    
    sqlite.close();

    // Create artifacts directory as sibling of database file
    const artifactsDir = resolve(dirname(dbPath), 'artifacts');
    if (!existsSync(artifactsDir)) {
      mkdirSync(artifactsDir, { recursive: true });
    }

    return {
      success: true,
      message: 'Database created successfully',
      tables: tableNames,
      views: ['executions'],
      agentsSeeded,
      artifactsDir
    };
  } catch (err) {
    return { success: false, message: `Failed to create database: ${err instanceof Error ? err.message : String(err)}` };
  }
}
