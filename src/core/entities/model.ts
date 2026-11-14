export type Model = {
  id: string;
  displayName: string;
  free: boolean;
  premier: boolean;
  contextWindow: number | null;
  maxTokens: number | null;
  modalities: string[];
  enabled: boolean;
  syncedAt: number;
};

export type UpstreamModel = {
  id: string;
  premier: boolean;
  contextWindow: number | null;
  maxTokens: number | null;
  input: string[];
};