export type RegisterCommand = {
  id: string;
  op: 'register';
  email: string;
  password: string;
  headless: boolean;
  proxy: string | null;
  timeout_ms: number;
};

export type WorkerHello = {
  event: 'hello';
  python: string;
  playwright: string;
  chrome: string;
  chrome_ok: boolean;
  error?: string;
};

export type WorkerStage = {
  event: 'stage';
  id: string;
  stage: string;
  detail?: string;
};

export type WorkerResult = {
  event: 'result';
  id: string;
  ok: boolean;
  stage: string;
  detail?: string;
  cookies?: Array<{ name: string; value: string; domain: string }>;
  machine?: string | null;
  theos_status?: number;
  theos?: unknown;
  lane_version?: number;
  ms?: number;
  url?: string;
};

export type WorkerMessage = WorkerHello | WorkerStage | WorkerResult;

export type RegisterOutcome = {
  ok: boolean;
  stage: string;
  detail?: string;
  cookies: Array<{ name: string; value: string; domain: string }>;
  machine: string | null;
  theosStatus: number | null;
  theos: unknown;
  laneVersion: number | null;
  ms: number;
};

export type EnginePort = {
  register(
    command: Omit<RegisterCommand, 'op'> & { onStage?: (stage: string) => void; signal?: AbortSignal },
  ): Promise<RegisterOutcome>;
  health(): Promise<WorkerHello | null>;
  shutdown(): Promise<void>;
};

export type EnginePoolOptions = {
  python: string;
  engineDir: string;
  workers: number;
  restartAfter: number;
  proxy: string | null;
  headless: boolean;
  timeoutMs: number;
  onLog?: (level: 'info' | 'warn' | 'error', message: string, meta?: Record<string, unknown>) => void;
};