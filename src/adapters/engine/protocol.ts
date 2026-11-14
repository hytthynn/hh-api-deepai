import 'server-only';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import type { RegisterCommand, WorkerHello, WorkerMessage, WorkerResult, WorkerStage } from '@/src/core/ports/engine';

export type WorkerOptions = {
  python: string;
  engineDir: string;
  proxy: string | null;
  headless: boolean;
  onLog?: (level: 'info' | 'warn' | 'error', message: string, meta?: Record<string, unknown>) => void;
};

type Pending = {
  resolve: (result: WorkerResult) => void;
  reject: (error: Error) => void;
  onStage?: (stage: string) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class EngineWorker {
  private readonly options: WorkerOptions;
  private process: ChildProcessWithoutNullStreams | null = null;
  private pending = new Map<string, Pending>();
  private hello: WorkerHello | null = null;
  private helloWaiters: Array<(hello: WorkerHello) => void> = [];
  private closed = false;

  jobsDone = 0;

  constructor(options: WorkerOptions) {
    this.options = options;
  }

  get running(): boolean {
    return this.process !== null && !this.closed;
  }

  async start(timeoutMs = 30_000): Promise<WorkerHello> {
    if (this.hello) return this.hello;
    if (this.process) {
      return new Promise<WorkerHello>((resolvePromise, reject) => {
        const timer = setTimeout(() => reject(new Error('engine hello timeout')), timeoutMs);
        this.helloWaiters.push((value) => {
          clearTimeout(timer);
          resolvePromise(value);
        });
      });
    }
    const script = resolve(this.options.engineDir, 'worker.py');
    const child = spawn(this.options.python, [script], {
      cwd: this.options.engineDir,
      env: {
        ...process.env,
        HH_ENGINE_NO_BANK: '1',
        PYTHONIOENCODING: 'utf-8',
        PYTHONUNBUFFERED: '1',
      },
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.process = child;
    this.closed = false;

    const lines = createInterface({ input: child.stdout });
    lines.on('line', (line) => this.handleLine(line));

    const errors = createInterface({ input: child.stderr });
    errors.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      this.options.onLog?.('warn', trimmed.slice(0, 400));
    });

    child.on('exit', (code, signal) => {
      const reason = `engine worker exited (code=${code ?? 'null'}, signal=${signal ?? 'null'})`;
      this.process = null;
      for (const [, entry] of this.pending) {
        clearTimeout(entry.timer);
        entry.reject(new Error(reason));
      }
      this.pending.clear();
      this.closed = true;
      this.options.onLog?.('warn', reason);
    });

    child.on('error', (error) => {
      this.options.onLog?.('error', `engine spawn failed: ${error.message}`);
      this.closed = true;
    });

    return new Promise<WorkerHello>((resolvePromise, reject) => {
      const timer = setTimeout(() => reject(new Error('engine hello timeout')), timeoutMs);
      this.helloWaiters.push((value) => {
        clearTimeout(timer);
        resolvePromise(value);
      });
    });
  }

  private handleLine(raw: string): void {
    const line = raw.trim();
    if (!line) return;
    let message: WorkerMessage;
    try {
      message = JSON.parse(line) as WorkerMessage;
    } catch {
      this.options.onLog?.('warn', `engine non-json stdout: ${line.slice(0, 200)}`);
      return;
    }
    if ('event' in message && message.event === 'hello') {
      this.hello = message;
      const waiters = this.helloWaiters.splice(0, this.helloWaiters.length);
      for (const waiter of waiters) waiter(message);
      return;
    }
    if ('id' in message && typeof message.id === 'string') {
      const entry = this.pending.get(message.id);
      if (!entry) return;
      if (message.event === 'stage') {
        entry.onStage?.((message as WorkerStage).stage);
        return;
      }
      clearTimeout(entry.timer);
      this.pending.delete(message.id);
      this.jobsDone += 1;
      entry.resolve(message as WorkerResult);
    }
  }

  send(command: RegisterCommand, timeoutMs: number, onStage?: (stage: string) => void): Promise<WorkerResult> {
    const child = this.process;
    if (!child || !child.stdin.writable) return Promise.reject(new Error('engine worker is not running'));
    return new Promise<WorkerResult>((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(command.id);
        reject(new Error(`engine timeout after ${timeoutMs} ms`));
      }, timeoutMs + 10_000);
      this.pending.set(command.id, { resolve: resolvePromise, reject, onStage, timer });
      child.stdin.write(`${JSON.stringify(command)}\n`, (error) => {
        if (error) {
          clearTimeout(timer);
          this.pending.delete(command.id);
          reject(error);
        }
      });
    });
  }

  async stop(graceMs = 5_000): Promise<void> {
    const child = this.process;
    this.closed = true;
    if (!child) return;
    try {
      child.stdin.write(`${JSON.stringify({ op: 'shutdown' })}\n`);
    } catch {
      // stdin already closed
    }
    await new Promise<void>((resolvePromise) => {
      const timer = setTimeout(() => {
        this.killTree(child);
        resolvePromise();
      }, graceMs);
      child.once('exit', () => {
        clearTimeout(timer);
        resolvePromise();
      });
    });
    this.process = null;
    this.hello = null;
  }

  private killTree(child: ChildProcessWithoutNullStreams): void {
    if (process.platform === 'win32' && child.pid) {
      spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      return;
    }
    try {
      child.kill('SIGKILL');
    } catch {
      // already dead
    }
  }

  kill(): void {
    if (this.process) this.killTree(this.process);
    this.process = null;
    this.hello = null;
    this.closed = true;
  }
}