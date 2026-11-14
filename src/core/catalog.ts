export type ModelSeed = {
  id: string;
  displayName: string;
  free: boolean;
  premier: boolean;
  contextWindow: number | null;
  maxTokens: number | null;
  modalities: string;
};

export const FREE_MODELS = [
  'glm-5.3-flash',
  'deepseek-v4.1-flash',
  'mimo-2.6-flash',
  'qwen-3.8-flash',
  'minimax-m3.1-flash',
  'muse-ember',
  'solar-mini-4',
  'gpt-6-luna',
  'mimo-2.6-pro',
  'glyph-cluster',
  'deepai-cyber',
] as const;

export const PAID_MODELS = [
  'claude-opus-5-5',
  'claude-sonnet-5-5',
  'claude-fable-5-2',
  'gpt-6.1-sol',
  'gpt-6.1-terra',
  'gpt-6-astra',
  'gemini-4-argon',
  'gemini-4-hydrogen',
  'gemini-4-carbon',
  'glm-5.3',
  'kimi-k3',
  'kimi-k3.1-pro',
  'minimax-m3',
  'muse-spark-1.3',
  'muse-wonder',
  'qwen-3.8-max-prime',
] as const;

export function displayNameFor(id: string): string {
  return id
    .split('-')
    .map((part) => (part.length === 0 ? part : part[0]!.toUpperCase() + part.slice(1)))
    .join(' ');
}

function seed(id: string, free: boolean, modalities = 'text,image'): ModelSeed {
  return {
    id,
    displayName: displayNameFor(id),
    free,
    premier: !free,
    contextWindow: null,
    maxTokens: null,
    modalities,
  };
}

export const BASE_MODELS: ModelSeed[] = [
  ...FREE_MODELS.map((id) => seed(id, true, id === 'solar-mini-4' ? 'text' : 'text,image')),
  ...PAID_MODELS.map((id) => seed(id, false, id.startsWith('kimi') ? 'text' : 'text,image')),
];

export const DEFAULT_SETTINGS: Record<string, string> = {
  'bm.product_id': '578',
  'bm.verify_tls': '1',
  'engine.workers': '2',
  'engine.headless': '0',
  'engine.proxy': '',
  'engine.restart_after': '10',
  'balance.sync_interval_min': '5',
  'gateway.default_model': 'glm-5.3-flash',
  'gateway.expose_disabled': '0',
  'responses.ttl_days': '7',
};

export const SECRET_SETTINGS = new Set(['bm.api_key', 'admin.password_hash']);