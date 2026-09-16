// test/helpers/mockD1.ts: Fast, in-memory SQLite wrapper implementing Cloudflare D1 interface using Node.js built-in node:sqlite
import { DatabaseSync } from 'node:sqlite';
import * as fs from 'node:fs';
import * as path from 'node:path';

class MockPreparedStatement {
  private stmt: any;
  private params: any[] = [];

  constructor(
    private db: DatabaseSync,
    private sql: string
  ) {
    this.stmt = db.prepare(sql);
  }

  bind(...params: any[]) {
    this.params = params.map((p) => {
      if (p === undefined) return null;
      if (typeof p === 'boolean') return p ? 1 : 0;
      return p;
    });
    return this;
  }

  async run() {
    this.stmt.run(...this.params);
    return {
      success: true,
      meta: { changes: 1 },
    };
  }

  async all<T = unknown>() {
    const rows = this.stmt.all(...this.params) as T[];
    return {
      results: rows,
      success: true,
      meta: { changes: 0 },
    };
  }

  async first<T = unknown>(colName?: string): Promise<T | null> {
    const row = this.stmt.get(...this.params);
    if (!row) return null;
    if (colName) return (row as any)[colName] ?? null;
    return row as T;
  }
}

export function createMockD1(schemaSql?: string): D1Database {
  const sqlite = new DatabaseSync(':memory:');

  // SQLite PRAGMA
  sqlite.exec('PRAGMA foreign_keys = ON;');

  if (schemaSql) {
    sqlite.exec(schemaSql);
  }

  const d1Mock = {
    prepare(query: string) {
      return new MockPreparedStatement(sqlite, query);
    },
    async exec(query: string) {
      sqlite.exec(query);
      return { count: 1, duration: 0 };
    },
    async batch(statements: any[]) {
      const results = [];
      for (const stmt of statements) {
        results.push(await stmt.run());
      }
      return results;
    },
    async dump() {
      return new ArrayBuffer(0);
    },
  } as unknown as D1Database;

  return d1Mock;
}

export function loadSchemaSql(): string {
  const schemaPath = path.resolve(__dirname, '../../schema.sql');
  return fs.readFileSync(schemaPath, 'utf-8');
}
