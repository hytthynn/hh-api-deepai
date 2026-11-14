export type ApiKey = {
  id: number;
  name: string;
  prefix: string;
  last4: string;
  keyHash: string;
  rpmLimit: number;
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
};

export type ApiKeyPublic = Omit<ApiKey, 'keyHash'> & { masked: string };

export function toPublicKey(key: ApiKey): ApiKeyPublic {
  return {
    id: key.id,
    name: key.name,
    prefix: key.prefix,
    last4: key.last4,
    rpmLimit: key.rpmLimit,
    createdAt: key.createdAt,
    lastUsedAt: key.lastUsedAt,
    revokedAt: key.revokedAt,
    masked: `${key.prefix}…${key.last4}`,
  };
}