import { z } from 'zod';

/**
 * SPEC §17.5 (ADR-025): account transfer between a local `full` instance and a
 * deployed `gateway` instance. Ciphertext (`v1.…`) is carried as-is, so both sides
 * must share the same HH_SECRET; plaintext passwords never leave the process.
 */
export const TRANSFER_FORMAT = 'hh-api-transfer';

export const transferAccountSchema = z.object({
  email: z.string().trim().min(3).max(320),
  passwordEnc: z.string().min(1).max(20_000),
  cookiesEnc: z.string().max(200_000).nullable().optional(),
  machine: z.string().max(200).nullable().optional(),
  balance: z.number().finite().optional(),
  granted: z.number().finite().optional(),
  refreshAt: z.string().max(40).nullable().optional(),
  laneVersion: z.number().int().nullable().optional(),
});

export const transferSchema = z.object({
  format: z.literal(TRANSFER_FORMAT),
  version: z.literal(1),
  exportedAt: z.string().max(40),
  accounts: z.array(transferAccountSchema).max(10_000),
});

export type Transfer = z.infer<typeof transferSchema>;
export type TransferAccount = z.infer<typeof transferAccountSchema>;