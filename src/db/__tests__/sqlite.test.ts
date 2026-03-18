import { describe, expect, it } from 'vitest';
import { Database } from '../sqlite.js';

describe('Database', () => {
  it('can create an in-memory database', () => {
    const db = new Database(':memory:');
    expect(db).toBeDefined();
  });

  it('exec() runs SQL', () => {
    const db = new Database(':memory:');
    expect(() => {
      db.exec('CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)');
    }).not.toThrow();
  });

  it('prepare() returns a statement with run/get/all methods', () => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)');
    const stmt = db.prepare('INSERT INTO test (name) VALUES (?)');
    expect(stmt).toBeDefined();
    expect(typeof stmt.run).toBe('function');
    expect(typeof stmt.get).toBe('function');
    expect(typeof stmt.all).toBe('function');
  });

  it('query() returns an object with all/get/run/values methods', () => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)');
    const q = db.query('SELECT * FROM test');
    expect(typeof q.all).toBe('function');
    expect(typeof q.get).toBe('function');
    expect(typeof q.run).toBe('function');
    expect(typeof q.values).toBe('function');
  });

  it('transaction() returns an object with deferred/immediate/exclusive methods', () => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)');
    const tx = db.transaction(() => {});
    expect(typeof tx.deferred).toBe('function');
    expect(typeof tx.immediate).toBe('function');
    expect(typeof tx.exclusive).toBe('function');
  });

  it('transaction commits on success', () => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)');

    const tx = db.transaction(() => {
      db.prepare('INSERT INTO test (name) VALUES (?)').run('alice');
    });
    tx.deferred();

    const rows = db.query('SELECT name FROM test').all();
    expect(rows).toEqual([{ name: 'alice' }]);
  });

  it('transaction rolls back on error', () => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)');

    const tx = db.transaction(() => {
      db.prepare('INSERT INTO test (name) VALUES (?)').run('bob');
      throw new Error('rollback test');
    });

    expect(() => tx.immediate()).toThrow('rollback test');

    const rows = db.query('SELECT name FROM test').all();
    expect(rows).toEqual([]);
  });
});
