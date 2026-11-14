import 'server-only';
import type { EnginePoolOptions, EnginePort, RegisterCommand, RegisterOutcome, WorkerHello, WorkerResult } from '@/src/core/ports/engine';
import { normalizeCookies } from '../upstream/cookies';
import { EngineWorker } from './protocol';

type Waiter = (worker: EngineWorker) => void;

export class EnginePool implements EnginePort {
  private readonly options: EnginePoolOptions;
  private workers: EngineWorker[] = [];
  private idle: EngineWorker[] = [];
  private waiters: Waiter[] = [];
  private lastHello: WorkerHello | null = null;
  private shuttingDown = false;

  constructor(options: EnginePoolOptions) {
    this.options = options;
  }

  get workerCount(): number {
    return this.workers.length;
  }

  get lastHandshake(): WorkerHello | null {
    return this.lastHello;
  }

  private makeWorker(): EngineWorker {
    return new EngineWorker({
      python: this.options.python,
      engineDir: this.options.engineDir,
      proxy: this.options.proxy,
      headless: this.options.headless,
      onLog: (level, message, meta) => this.options.onLog?.(level, message, meta),
    });
  }

  private async acquire(): Promise<EngineWorker> {
    for (;;) {
      const idle = this.idle.pop();
      if (idle) {
        if (idle.running && idle.jobsDone < this.options.restartAfter) return idle;
        await idle.stop(1_000);
        this.workers = this.workers.filter((worker) => worker !== idle);
        continue;
      }
      if (this.workers.length < Math.max(1, this.options.workers)) {
        const worker = this.makeWorker();
        this.workers.push(worker);
        try {
          this.lastHello = await worker.start();
          return worker;
        } catch (error) {
          this.workers = this.workers.filter((entry) => entry !== worker);
          worker.kill();
          throw error;
        }
      }
      const next = await new Promise<EngineWorker>((resolvePromise) => this.waiters.push(resolvePromise));
      if (next.running) return next;
    }
  }

  private release(worker: EngineWorker): void {
    if (this.shuttingDown) {
      void worker.stop(1_000);
      return;
    }
    let available: EngineWorker | null = null;
    if (!worker.running) {
      this.workers = this.workers.filter((entry) => entry !== worker);
    } else if (worker.jobsDone >= this.options.restartAfter) {
      this.workers = this.workers.filter((entry) => entry !== worker);
      void worker.stop(2_000);
    } else {
      this.idle.push(worker);
      available = worker;
    }
    const waiter = this.waiters.shift();
    // A dead worker is handed back on purpose: `acquire` re-checks `running` and
    // spawns a replacement instead of leaving the waiter parked forever.
    if (waiter) waiter(available ?? worker);
  }

  async register(
    command: Omit<RegisterCommand, 'op'> & { onStage?: (stage: string) => void; signal?: AbortSignal },
  ): Promise<RegisterOutcome> {
    const worker = await this.acquire();
    try {
      const payload: RegisterCommand = {
        id: command.id,
        op: 'register',
        email: command.email,
        password: command.password,
        headless: command.headless,
        proxy: command.proxy,
        timeout_ms: command.timeout_ms,
      };
      const result: WorkerResult = await worker.send(
        payload,
        command.timeout_ms,
        command.onStage,
        command.signal,
      );
      return {
        ok: result.ok === true,
        stage: result.stage ?? 'unknown',
        detail: result.detail,
        cookies: normalizeCookies(result.cookies ?? []),
        machine: result.machine ?? null,
        theosStatus: result.theos_status ?? null,
        theos: result.theos ?? null,
        laneVersion: typeof result.lane_version === 'number' ? result.lane_version : null,
        ms: result.ms ?? 0,
      };
    } finally {
      this.release(worker);
    }
  }

  async health(): Promise<WorkerHello | null> {
    if (this.lastHello) return this.lastHello;
    try {
      const worker = await this.acquire();
      const hello = worker.running ? this.lastHello : null;
      this.release(worker);
      return hello;
    } catch {
      return null;
    }
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    const workers = this.workers.splice(0, this.workers.length);
    this.idle = [];
    await Promise.allSettled(workers.map((worker) => worker.stop(3_000)));
  }
}