import { describe, it, expect, vi, afterAll } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import { existsSync, unlinkSync, mkdirSync, rmSync } from 'fs';
import { generateAllSQL, seedAgents, initDB } from '../initDB.js';
import { Database } from '../../db/sqlite.js';
import { agentsSeedData } from '../agentsSeedData.js';

vi.mock('../../util/logger.js', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const tempFiles: string[] = [];
const tempDirs: string[] = [];

function uniqueDbPath(): string {
  const p = join(tmpdir(), `initdb-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  tempFiles.push(p);
  return p;
}

function uniqueTempDir(): string {
  const d = join(tmpdir(), `initdb-test-dir-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(d, { recursive: true });
  tempDirs.push(d);
  return d;
}

afterAll(() => {
  for (const f of tempFiles) {
    for (const suffix of ['', '-wal', '-shm']) {
      try { unlinkSync(f + suffix); } catch { /* ignore */ }
    }
  }
  for (const d of tempDirs) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

describe('generateAllSQL', () => {
  it('returns an object with sql string and tableNames array', () => {
    const result = generateAllSQL();
    expect(result).toHaveProperty('sql');
    expect(result).toHaveProperty('tableNames');
    expect(typeof result.sql).toBe('string');
    expect(Array.isArray(result.tableNames)).toBe(true);
  });

  it('tableNames includes agents, dags, dag_executions, sub_steps', () => {
    const { tableNames } = generateAllSQL();
    expect(tableNames).toContain('agents');
    expect(tableNames).toContain('dags');
    expect(tableNames).toContain('dag_executions');
    expect(tableNames).toContain('sub_steps');
  });

  it('SQL contains CREATE TABLE statements', () => {
    const { sql } = generateAllSQL();
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS agents');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS dags');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS dag_executions');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS sub_steps');
  });

  it('SQL contains CREATE VIEW for executions', () => {
    const { sql } = generateAllSQL();
    expect(sql).toContain('CREATE VIEW IF NOT EXISTS executions');
  });
});

describe('initDB', () => {
  it('returns success: false for empty dbPath', async () => {
    const result = await initDB('');
    expect(result.success).toBe(false);
    expect(result.message).toContain('Database path is required');
  });

  it('returns success: false for whitespace-only dbPath', async () => {
    const result = await initDB('   ');
    expect(result.success).toBe(false);
    expect(result.message).toContain('Database path is required');
  });

  it('returns success: false when parent directory does not exist', async () => {
    const result = await initDB('/nonexistent/directory/test.db');
    expect(result.success).toBe(false);
    expect(result.message).toContain('Parent directory does not exist');
  });

  it('returns success: false when DB already exists and force=false', async () => {
    const dbPath = uniqueDbPath();
    // Create an empty file to simulate existing DB
    const db = new Database(dbPath);
    db.close();

    const result = await initDB(dbPath);
    expect(result.success).toBe(false);
    expect(result.message).toContain('Database file already exists');
    expect(result.message).toContain('Use force option to overwrite');
  });

  it('successfully creates DB with force=true when existing DB', async () => {
    const dbPath = uniqueDbPath();
    // Create an initial DB
    const db = new Database(dbPath);
    db.close();

    const result = await initDB(dbPath, { force: true });
    expect(result.success).toBe(true);
    expect(result.tables).toBeDefined();
    expect(result.views).toContain('executions');
    expect(result.agentsSeeded).toBeGreaterThan(0);
  });

  it('successfully creates a new DB', async () => {
    const dir = uniqueTempDir();
    const dbPath = join(dir, 'new-test.db');
    tempFiles.push(dbPath);

    const result = await initDB(dbPath);
    expect(result.success).toBe(true);
    expect(result.message).toContain('Database created successfully');
    expect(result.tables).toEqual(expect.arrayContaining(['agents', 'dags', 'dag_executions', 'sub_steps']));
    expect(result.views).toContain('executions');
    expect(result.agentsSeeded).toBe(agentsSeedData.length);
    expect(existsSync(dbPath)).toBe(true);
  });

  it('creates artifacts directory as sibling of the DB file', async () => {
    const dir = uniqueTempDir();
    const dbPath = join(dir, 'artifacts-test.db');
    tempFiles.push(dbPath);

    const result = await initDB(dbPath);
    expect(result.success).toBe(true);
    expect(result.artifactsDir).toBeDefined();
    expect(existsSync(result.artifactsDir!)).toBe(true);
  });
});

describe('seedAgents', () => {
  it('returns the count of seeded agents', () => {
    const dbPath = uniqueDbPath();
    const db = new Database(dbPath);

    const { sql } = generateAllSQL();
    db.exec(sql);

    const count = seedAgents(db);
    expect(count).toBe(agentsSeedData.length);

    db.close();
  });

  it('inserts all agent rows into the agents table', () => {
    const dbPath = uniqueDbPath();
    const db = new Database(dbPath);

    const { sql } = generateAllSQL();
    db.exec(sql);
    seedAgents(db);

    const rows = db.prepare('SELECT COUNT(*) as cnt FROM agents').get() as { cnt: number };
    expect(rows.cnt).toBe(agentsSeedData.length);

    db.close();
  });
});
