/* CLI entry (`npm run db:migrate`) and bootstrap helper. Not marked server-only so tsx can run it. */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { logger } from '@/src/lib/logger';
import { closeDb, db } from './client';
import { seedDatabase } from './seed';

export function runMigrations(folder = resolve(process.cwd(), 'drizzle')): void {
  migrate(db(), { migrationsFolder: folder });
  seedDatabase();
  db().run('PRAGMA optimize');
}

const entry = process.argv[1];
const isMain = entry !== undefined && pathToFileURL(entry).href === import.meta.url;

if (isMain) {
  try {
    runMigrations();
    logger.info('system', 'database migrated', { meta: { path: process.env.HH_DB_PATH ?? './data/hh.db' } });
    process.stdout.write('migrations applied\n');
  } catch (error) {
    process.stderr.write(`migration failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  } finally {
    closeDb();
  }
}