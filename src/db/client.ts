import { drizzle } from 'drizzle-orm/bun-sqlite';
import { Database } from 'bun:sqlite';
import * as schema from './schema.js';
import { getLogger } from '../util/logger.js';
import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { DatabaseError, InitializationError } from '../errors/index.js';

export type DrizzleDB = BunSQLiteDatabase<typeof schema>;

let dbInstance: DrizzleDB | null = null;

/**
 * SQL statements to create all tables based on the schema
 */
const CREATE_TABLES_SQL = `
-- Agents table
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  prompt_template TEXT NOT NULL,
  provider TEXT,
  model TEXT,
  active INTEGER NOT NULL DEFAULT 0,
  metadata TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Unique index for agent name+version
CREATE UNIQUE INDEX IF NOT EXISTS idx_name_version ON agents(name, version);

-- Partial unique index for active agent per name
CREATE UNIQUE INDEX IF NOT EXISTS idx_active_agent ON agents(name) WHERE active = 1;

-- DAGs table
CREATE TABLE IF NOT EXISTS dags (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  result TEXT,
  usage TEXT,
  generation_stats TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  params TEXT,
  agent_name TEXT,
  dag_title TEXT,
  cron_schedule TEXT,
  schedule_active INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- DAG Executions table
CREATE TABLE IF NOT EXISTS dag_executions (
  id TEXT PRIMARY KEY,
  dag_id TEXT NOT NULL REFERENCES dags(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  execution_results TEXT,
  failure_reason TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- DAG Sub-Steps table
CREATE TABLE IF NOT EXISTS dag_sub_steps (
  id TEXT PRIMARY KEY,
  execution_id TEXT NOT NULL REFERENCES dag_executions(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL,
  "index" INTEGER NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('action', 'result', 'decision')),
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- DAG Stop Requests table
CREATE TABLE IF NOT EXISTS dag_stop_requests (
  id TEXT PRIMARY KEY,
  dag_id TEXT,
  execution_id TEXT,
  status TEXT NOT NULL DEFAULT 'requested' CHECK(status IN ('requested', 'handled')),
  requested_at INTEGER NOT NULL,
  handled_at INTEGER
);
`;

/**
 * Initialize database tables if they don't exist
 */
function initializeTables(sqlite: any, logger: any): void {
  try {
    sqlite.exec(CREATE_TABLES_SQL);
    logger.info('Database tables initialized');
  } catch (error) {
    throw new DatabaseError(
      `Failed to initialize database tables: ${error instanceof Error ? error.message : String(error)}`,
      'initializeTables',
      error instanceof Error ? error : undefined
    );
  }
}

/**
 * Create and initialize database connection
 */
function createDatabase(dbPath: string): DrizzleDB {
  const logger = getLogger();

  try {
    // Ensure data directory exists
    const dbDir = dirname(dbPath);
    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true });
      logger.info(`Created database directory: ${dbDir}`);
    }

    // Check if database file exists (to determine if we need to create tables)
    const isNewDatabase = !existsSync(dbPath);

    // Open SQLite database using bun:sqlite
    const sqlite = new Database(dbPath);

    // Enable foreign keys and WAL mode
    sqlite.exec('PRAGMA journal_mode = WAL;');
    sqlite.exec('PRAGMA foreign_keys = ON;');

    // Initialize tables if this is a new database
    if (isNewDatabase) {
      logger.info('New database detected, creating tables...');
      initializeTables(sqlite, logger);
    } else {
      // For existing databases, ensure tables exist (handles partial initialization)
      initializeTables(sqlite, logger);
    }

    const db = drizzle(sqlite, { schema });

    logger.info(`Database initialized: ${dbPath}`);

    return db;
  } catch (error) {
    const logger = getLogger();
    logger.error('Failed to initialize database');
    throw new InitializationError(
      `Failed to initialize database: ${error instanceof Error ? error.message : String(error)}`,
      'DatabaseClient',
      error instanceof Error ? error : undefined
    );
  }
}

/**
 * Get or create the global database instance
 */
export function getDatabase(dbPath: string): DrizzleDB {
  if (!dbInstance) {
    dbInstance = createDatabase(dbPath);
  }
  return dbInstance;
}

/**
 * Close database connection
 */
export function closeDatabase(): void {
  if (dbInstance) {
    try {
      const logger = getLogger();
      logger.info('Closing database connection');
      // bun:sqlite closes automatically when garbage collected
      // but we can mark it as null
      dbInstance = null;
    } catch (error) {
      const logger = getLogger();
      logger.error('Error closing database');
    }
  }
}

/**
 * Run database migrations
 * Note: For Phase 2, this is a placeholder.
 * In production, migrations should be managed via drizzle-kit
 */
export async function runMigrations(db: DrizzleDB): Promise<void> {
  try {
    void db; // Suppress unused variable warning
    const logger = getLogger();
    logger.info('Migrations check complete (no migrations yet)');
    // TODO: Implement migration system in Phase 4
  } catch (error) {
    throw new DatabaseError(
      `Migration failed: ${error instanceof Error ? error.message : String(error)}`,
      'runMigrations',
      error instanceof Error ? error : undefined
    );
  }
}

/**
 * Execute a query with error handling
 */
export async function withDatabase<T>(
  db: DrizzleDB,
  operation: (db: DrizzleDB) => Promise<T>
): Promise<T> {
  try {
    return await operation(db);
  } catch (error) {
    const logger = getLogger();
    logger.error('Database operation failed');
    throw new DatabaseError(
      `Database operation failed: ${error instanceof Error ? error.message : String(error)}`,
      'query',
      error instanceof Error ? error : undefined
    );
  }
}
