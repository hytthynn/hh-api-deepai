import 'server-only';
import { eq } from 'drizzle-orm';
import { decrypt, encrypt } from '@/src/lib/crypto';
import { logger } from '@/src/lib/logger';
import { db } from '../client';
import { settings } from '../schema';

export type SettingRow = { key: string; value: string; encrypted: number; updatedAt: number };

export function allSettings(): SettingRow[] {
  return db().select().from(settings).all();
}

export function getSetting(key: string): string | null {
  const row = db().select().from(settings).where(eq(settings.key, key)).get();
  if (!row) return null;
  if (row.encrypted === 1) {
    try {
      return decrypt(row.value);
    } catch {
      logger.error('system', `cannot decrypt setting ${key}: HH_SECRET changed?`);
      return null;
    }
  }
  return row.value;
}

export function getInt(key: string, fallback: number): number {
  const raw = getSetting(key);
  if (raw === null) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.trunc(value) : fallback;
}

export function getBool(key: string, fallback: boolean): boolean {
  const raw = getSetting(key);
  if (raw === null) return fallback;
  return raw === '1' || raw.toLowerCase() === 'true';
}

export function setSetting(key: string, value: string, encrypted = false): void {
  const now = Date.now();
  const stored = encrypted ? encrypt(value) : value;
  db()
    .insert(settings)
    .values({ key, value: stored, encrypted: encrypted ? 1 : 0, updatedAt: now })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: stored, encrypted: encrypted ? 1 : 0, updatedAt: now },
    })
    .run();
}

export function deleteSetting(key: string): void {
  db().delete(settings).where(eq(settings.key, key)).run();
}

export function settingExists(key: string): boolean {
  return db().select({ key: settings.key }).from(settings).where(eq(settings.key, key)).get() !== undefined;
}