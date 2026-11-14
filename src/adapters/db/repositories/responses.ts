import 'server-only';
import { eq, lt } from 'drizzle-orm';
import { db } from '../client';
import { responses } from '../schema';

export type StoredResponse = {
  id: string;
  apiKeyId: number | null;
  createdAt: number;
  expiresAt: number;
  request: string;
  response: string;
};

export function putResponse(record: StoredResponse): void {
  db()
    .insert(responses)
    .values(record)
    .onConflictDoUpdate({
      target: responses.id,
      set: { request: record.request, response: record.response, expiresAt: record.expiresAt },
    })
    .run();
}

export function getResponse(id: string): StoredResponse | null {
  const row = db().select().from(responses).where(eq(responses.id, id)).get();
  if (!row) return null;
  if (row.expiresAt <= Date.now()) return null;
  return row;
}

export function deleteResponse(id: string): boolean {
  return db().delete(responses).where(eq(responses.id, id)).run().changes > 0;
}

export function purgeResponses(): number {
  return db().delete(responses).where(lt(responses.expiresAt, Date.now())).run().changes;
}