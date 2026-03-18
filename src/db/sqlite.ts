import { createRequire } from 'module';

const require = createRequire(import.meta.url);

type StatementLike = {
  run: (...params: any[]) => any;
  get: (...params: any[]) => any;
  all: (...params: any[]) => any[];
  values?: (...params: any[]) => any[];
};

class PreparedStatementWrapper {
  private stmt: StatementLike;

  constructor(stmt: StatementLike) {
    this.stmt = stmt;
  }

  run(...params: any[]): any {
    return this.stmt.run(...params);
  }

  get(...params: any[]): any {
    return this.stmt.get(...params);
  }

  all(...params: any[]): any[] {
    return this.stmt.all(...params);
  }

  values(...params: any[]): any[] {
    if (this.stmt.values) {
      return this.stmt.values(...params);
    }
    const rows = this.stmt.all(...params);
    return rows.map((row: Record<string, any>) => Object.values(row));
  }
}

class NodeCompatDatabase {
  private db: any;

  constructor(path: string) {
    const { DatabaseSync } = require('node:sqlite');
    this.db = new DatabaseSync(path);
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  prepare(sql: string): PreparedStatementWrapper {
    return new PreparedStatementWrapper(this.db.prepare(sql));
  }

  query(sql: string): {
    all: (...params: any[]) => any[];
    get: (...params: any[]) => any;
    run: (...params: any[]) => any;
    values: (...params: any[]) => any[];
  } {
    const prepared = this.prepare(sql);
    return {
      all: (...params: any[]) => prepared.all(...params),
      get: (...params: any[]) => prepared.get(...params),
      run: (...params: any[]) => prepared.run(...params),
      values: (...params: any[]) => prepared.values(...params),
    };
  }

  transaction(fn: () => unknown): {
    deferred: () => unknown;
    immediate: () => unknown;
    exclusive: () => unknown;
  } {
    const runWithMode = (mode: 'DEFERRED' | 'IMMEDIATE' | 'EXCLUSIVE') => {
      this.db.exec(`BEGIN ${mode}`);
      try {
        const result = fn();
        this.db.exec('COMMIT');
        return result;
      } catch (error) {
        this.db.exec('ROLLBACK');
        throw error;
      }
    };

    return {
      deferred: () => runWithMode('DEFERRED'),
      immediate: () => runWithMode('IMMEDIATE'),
      exclusive: () => runWithMode('EXCLUSIVE'),
    };
  }
}

let DatabaseCtor: any;

try {
  DatabaseCtor = require('bun:sqlite').Database;
} catch {
  DatabaseCtor = NodeCompatDatabase;
}

export const Database = DatabaseCtor;
