import 'server-only';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { env } from '@/src/lib/config';
import * as schema from './schema';

export type Db = BetterSQLite3Database<typeof schema>;

type Bundle = { sqlite: Database.Database; db: Db };

const globalForDb = globalThis as unknown as { __hhDb?: Bundle };

function open(): Bundle {
  if (env.dbPath !== ':memory:') mkdirSync(dirname(env.dbPath), { recursive: true });
  const sqlite = new Database(env.dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('synchronous = NORMAL');
  const db = drizzle(sqlite, { schema });
  return { sqlite, db };
}

function bundle(): Bundle {
  globalForDb.__hhDb ??= open();
  return globalForDb.__hhDb;
}

export function db(): Db {
  return bundle().db;
}

export function sqlite(): Database.Database {
  return bundle().sqlite;
}

export function isDbOpen(): boolean {
  return globalForDb.__hhDb !== undefined;
}

export function closeDb(): void {
  if (globalForDb.__hhDb) {
    try {
      globalForDb.__hhDb.sqlite.close();
    } finally {
      globalForDb.__hhDb = undefined;
    }
  }
}

export { schema };