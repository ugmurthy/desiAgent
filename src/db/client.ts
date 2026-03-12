import { drizzle } from 'drizzle-orm/bun-sqlite';
import { Database } from 'bun:sqlite';
import * as schema from './schema.js';
import { getLogger } from '../util/logger.js';
import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { DatabaseError, InitializationError } from '../errors/index.js';
import { generateAllSQL } from '../services/initDB.js';

export type DrizzleDB = BunSQLiteDatabase<typeof schema>;

let dbInstance: DrizzleDB | null = null;

/**
 * Initialize database tables if they don't exist
 * Uses generateAllSQL() from initDB to stay in sync with the Drizzle schema
 */
function initializeTables(sqlite: any, logger: any): void {
  try {
    const { sql } = generateAllSQL();
    sqlite.exec(sql);
    logger.info('Database tables initialized');
  } catch (error) {
    throw new DatabaseError(
      `Failed to initialize database tables: ${error instanceof Error ? error.message : String(error)}`,
      'initializeTables',
      error instanceof Error ? error : undefined
    );
  }
}

function hasColumn(sqlite: any, tableName: string, columnName: string): boolean {
  const rows = sqlite.query(`PRAGMA table_info(${tableName});`).all() as Array<{ name?: string }>;
  return rows.some((row) => row.name === columnName);
}

function backfillPlanningAttemptGenerationIds(sqlite: any, logger: any): void {
  const rows = sqlite
    .query("SELECT id, planning_attempts AS planningAttempts FROM dags WHERE planning_attempts IS NOT NULL;")
    .all() as Array<{ id: string; planningAttempts: string | null }>;

  if (rows.length === 0) {
    return;
  }

  const updateStmt = sqlite.prepare(
    'UPDATE dags SET planning_attempts = ?, updated_at = (unixepoch()) WHERE id = ?;'
  );

  let updatedRows = 0;

  for (const row of rows) {
    if (!row.planningAttempts) {
      continue;
    }

    try {
      const attempts = JSON.parse(row.planningAttempts) as Array<Record<string, any>>;
      if (!Array.isArray(attempts)) {
        continue;
      }

      let changed = false;
      for (const attempt of attempts) {
        if (attempt?.generationId) {
          continue;
        }

        const attemptGenerationId = attempt?.generationStats?.id;
        if (typeof attemptGenerationId === 'string' && attemptGenerationId.length > 0) {
          attempt.generationId = attemptGenerationId;
          changed = true;
        }
      }

      if (changed) {
        updateStmt.run(JSON.stringify(attempts), row.id);
        updatedRows += 1;
      }
    } catch {
      // Ignore malformed rows and continue migrating best-effort.
    }
  }

  if (updatedRows > 0) {
    logger.info({ updatedRows }, 'Backfilled planning attempt generation IDs');
  }
}

function runRuntimeMigrations(sqlite: any, logger: any): void {
  if (!hasColumn(sqlite, 'sub_steps', 'generation_id')) {
    sqlite.exec('ALTER TABLE sub_steps ADD COLUMN generation_id TEXT;');
    logger.info('Applied migration: added sub_steps.generation_id');
  }

  sqlite.exec('CREATE INDEX IF NOT EXISTS idx_sub_steps_generation_id ON sub_steps(generation_id);');
  sqlite.exec(
    'CREATE INDEX IF NOT EXISTS idx_sub_steps_pending_stats ON sub_steps(execution_id, generation_id) WHERE generation_id IS NOT NULL AND (cost_usd IS NULL OR generation_stats IS NULL);'
  );

  sqlite.exec(
    "UPDATE sub_steps SET generation_id = json_extract(generation_stats, '$.id') WHERE generation_id IS NULL AND generation_stats IS NOT NULL AND json_extract(generation_stats, '$.id') IS NOT NULL;"
  );

  backfillPlanningAttemptGenerationIds(sqlite, logger);
}

/**
 * Create and initialize database connection
 */
function createDatabase(dbPath: string, isMemoryDb: boolean): DrizzleDB {
  const logger = getLogger();

  try {
    // Only create directory for file-based databases
    if (!isMemoryDb) {
      const dbDir = dirname(dbPath);
      if (!existsSync(dbDir)) {
        mkdirSync(dbDir, { recursive: true });
        logger.info(`Created database directory: ${dbDir}`);
      }
    }

    // Open SQLite database
    const sqlite = new Database(dbPath);

    // WAL mode only for file-based databases
    if (!isMemoryDb) {
      sqlite.exec('PRAGMA journal_mode = WAL;');
    }
    sqlite.exec('PRAGMA foreign_keys = ON;');

    // Always initialize tables
    initializeTables(sqlite, logger);
    runRuntimeMigrations(sqlite, logger);

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
export function getDatabase(dbPath: string, isMemoryDb: boolean = false): DrizzleDB {
  if (!dbInstance) {
    dbInstance = createDatabase(dbPath, isMemoryDb);
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
