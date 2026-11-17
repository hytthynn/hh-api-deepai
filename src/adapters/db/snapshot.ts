import 'server-only';
import Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { env } from '@/src/lib/config';
import { closeDb, sqlite } from './client';

/** SPEC §17.6 (ADR-026): file-level operations for full-database export/import. */

const SQLITE_MAGIC = 'SQLite format 3\u0000';
const REQUIRED_TABLES = ['accounts', 'api_keys', 'settings', 'models', 'jobs', 'requests', 'logs'];

export type SnapshotInspection = {
  /** Ciphertext samples used by the server layer to verify HH_SECRET compatibility. */
  passwordSample: string | null;
  settingSample: string | null;
};

/** Consistent hot snapshot (WAL included) via the SQLite online backup API. */
export async function exportSnapshot(): Promise<Buffer> {
  const dir = mkdtempSync(join(tmpdir(), 'hh-snapshot-'));
  const file = join(dir, 'snapshot.db');
  try {
    await sqlite().backup(file);
    return readFileSync(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Writes the upload next to the target DB so the final rename stays on one volume. */
export function stageSnapshot(bytes: Buffer): string {
  if (env.dbPath === ':memory:') throw new Error('импорт БД требует файловую базу (HH_DB_PATH)');
  if (bytes.subarray(0, 16).toString('latin1') !== SQLITE_MAGIC) throw new Error('файл не является базой SQLite');
  const staged = join(dirname(env.dbPath), `hh-import-${randomBytes(6).toString('hex')}.db`);
  writeFileSync(staged, bytes);
  return staged;
}

export function inspectSnapshot(staged: string): SnapshotInspection {
  const probe = new Database(staged, { readonly: true });
  try {
    const check = probe.pragma('quick_check', { simple: true });
    if (check !== 'ok') throw new Error(`база повреждена (quick_check: ${String(check)})`);
    const rows = probe.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>;
    const names = new Set(rows.map((row) => row.name));
    for (const table of REQUIRED_TABLES) {
      if (!names.has(table)) throw new Error(`в файле нет таблицы ${table} — это не БД hh-api`);
    }
    const account = probe
      .prepare('SELECT password_enc FROM accounts WHERE password_enc IS NOT NULL LIMIT 1')
      .get() as { password_enc: string } | undefined;
    const setting = probe.prepare('SELECT value FROM settings WHERE encrypted = 1 LIMIT 1').get() as
      | { value: string }
      | undefined;
    return { passwordSample: account?.password_enc ?? null, settingSample: setting?.value ?? null };
  } finally {
    probe.close();
  }
}

/**
 * Swaps the live database file. The caller must have closed every handle first
 * (closeDb here); the previous file is kept as `<db>.prev` for a manual rollback.
 */
export function installSnapshot(staged: string): void {
  closeDb();
  const target = env.dbPath;
  rmSync(`${target}-wal`, { force: true });
  rmSync(`${target}-shm`, { force: true });
  rmSync(`${target}.prev`, { force: true });
  // B-029: the readonly inspection opens the WAL-mode snapshot and leaves sidecars behind.
  rmSync(`${staged}-wal`, { force: true });
  rmSync(`${staged}-shm`, { force: true });
  if (existsSync(target)) renameSync(target, `${target}.prev`);
  renameSync(staged, target);
}

export function discardSnapshot(staged: string): void {
  rmSync(staged, { force: true });
  rmSync(`${staged}-wal`, { force: true });
  rmSync(`${staged}-shm`, { force: true });
}