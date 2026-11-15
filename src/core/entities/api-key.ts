export type ApiKey = {
  id: number;
  name: string;
  prefix: string;
  last4: string;
  keyHash: string;
  /** AES-256-GCM ciphertext of the plaintext key (ADR-021); null for keys created before it. */
  keyEnc: string | null;
  /** Total token quota for the key lifetime; null = unlimited. */
  tokenLimit: number | null;
  createdAt: number;
  lastUsedAt: number | null;
};

export type ApiKeyPublic = Omit<ApiKey, 'keyHash' | 'keyEnc'> & { masked: string };

export function toPublicKey(key: ApiKey): ApiKeyPublic {
  return {
    id: key.id,
    name: key.name,
    prefix: key.prefix,
    last4: key.last4,
    tokenLimit: key.tokenLimit,
    createdAt: key.createdAt,
    lastUsedAt: key.lastUsedAt,
    masked: `${key.prefix}…${key.last4}`,
  };
}