export type Endpoint = 'chat' | 'responses' | 'messages' | 'count_tokens' | 'models';

export type RequestRecord = {
  ts: number;
  requestId: string;
  apiKeyId: number | null;
  endpoint: Endpoint;
  model: string | null;
  stream: boolean;
  accountId: number | null;
  attempts: number;
  httpStatus: number | null;
  latencyMs: number | null;
  firstByteMs: number | null;
  inputTokens: number;
  outputTokens: number;
  theosBefore: number | null;
  theosAfter: number | null;
  errorCode: string | null;
  client: string | null;
  detail: string | null;
};