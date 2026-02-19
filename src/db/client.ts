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
