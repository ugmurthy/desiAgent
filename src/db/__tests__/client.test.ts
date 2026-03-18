import { describe, expect, it, vi, beforeEach } from 'vitest';
import { DatabaseError } from '../../errors/index.js';

vi.mock('../../util/logger.js', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../../services/initDB.js', () => ({
  generateAllSQL: () => ({ sql: '' }),
}));

const mockExec = vi.fn();
const mockQuery = vi.fn(() => ({ all: () => [] }));
const mockPrepare = vi.fn(() => ({ run: vi.fn() }));

vi.mock('../sqlite.js', () => ({
  Database: class MockDatabase {
    exec = mockExec;
    query = mockQuery;
    prepare = mockPrepare;
  },
}));

vi.mock('drizzle-orm/bun-sqlite', () => ({
  drizzle: (sqlite: any, opts: any) => ({ __isMockDrizzle: true, sqlite, opts }),
}));

import { getDatabase, closeDatabase, runMigrations, withDatabase } from '../client.js';
import type { DrizzleDB } from '../client.js';

describe('client', () => {
  beforeEach(() => {
    closeDatabase();
    mockExec.mockClear();
    mockQuery.mockClear();
    mockPrepare.mockClear();
  });

  describe('getDatabase', () => {
    it('returns a db instance with in-memory DB', () => {
      const db = getDatabase(':memory:', true);
      expect(db).toBeDefined();
    });

    it('returns the same instance on second call (singleton)', () => {
      const db1 = getDatabase(':memory:', true);
      const db2 = getDatabase(':memory:', true);
      expect(db1).toBe(db2);
    });

    it('returns a new instance after closeDatabase()', () => {
      const db1 = getDatabase(':memory:', true);
      closeDatabase();
      const db2 = getDatabase(':memory:', true);
      expect(db1).not.toBe(db2);
    });
  });

  describe('withDatabase', () => {
    it('executes the operation and returns its result', async () => {
      const db = getDatabase(':memory:', true);
      const result = await withDatabase(db, async () => 42);
      expect(result).toBe(42);
    });

    it('wraps errors in DatabaseError', async () => {
      const db = getDatabase(':memory:', true);
      await expect(
        withDatabase(db, async () => {
          throw new Error('boom');
        })
      ).rejects.toThrow(DatabaseError);
    });
  });

  describe('runMigrations', () => {
    it('does not throw', async () => {
      const db = getDatabase(':memory:', true);
      await expect(runMigrations(db)).resolves.toBeUndefined();
    });
  });
});
