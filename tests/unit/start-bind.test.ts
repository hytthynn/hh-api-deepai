import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const SCRIPT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../scripts/start.mjs');

// The repo `.env.local` pins HH_PORT/HH_HOST; run from an empty cwd so fallbacks are visible.
const cwd = mkdtempSync(join(tmpdir(), 'hh-bind-'));
afterAll(() => rmSync(cwd, { recursive: true, force: true }));

const STRIPPED = ['HH_PORT', 'HH_HOST', 'HH_MODE', 'HH_PUBLIC_ORIGIN', 'HH_ALLOW_REMOTE', 'PORT'];

function printBind(overrides: Record<string, string> = {}): { host: string; port: number } {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of STRIPPED) delete env[key];
  const out = execFileSync(process.execPath, [SCRIPT, '--print-bind'], {
    cwd,
    env: { ...env, ...overrides },
    encoding: 'utf8',
  });
  return JSON.parse(out.trim()) as { host: string; port: number };
}

describe('scripts/start.mjs bind resolution (ADR-025)', () => {
  it('defaults to loopback 3210 in full mode', () => {
    expect(printBind()).toEqual({ host: '127.0.0.1', port: 3210 });
  });

  it('honours explicit HH_PORT and HH_HOST', () => {
    expect(printBind({ HH_PORT: '4000', HH_HOST: '0.0.0.0' })).toEqual({ host: '0.0.0.0', port: 4000 });
  });

  it('uses platform PORT and opens the host for the platform proxy', () => {
    expect(printBind({ PORT: '8080' })).toEqual({ host: '0.0.0.0', port: 8080 });
  });

  it('keeps an explicit HH_HOST even with platform PORT', () => {
    expect(printBind({ PORT: '8080', HH_HOST: '127.0.0.1' })).toEqual({ host: '127.0.0.1', port: 8080 });
  });

  it('opens the host in gateway mode without PORT', () => {
    expect(printBind({ HH_MODE: 'gateway' })).toEqual({ host: '0.0.0.0', port: 3210 });
  });

  it('opens the host with HH_ALLOW_REMOTE=1', () => {
    expect(printBind({ HH_ALLOW_REMOTE: '1' })).toEqual({ host: '0.0.0.0', port: 3210 });
  });

  it('does not open the host for HH_PUBLIC_ORIGIN alone', () => {
    expect(printBind({ HH_PUBLIC_ORIGIN: 'https://hh.example.test' })).toEqual({ host: '127.0.0.1', port: 3210 });
  });

  it('ignores a non-numeric PORT', () => {
    expect(printBind({ PORT: 'abc' })).toEqual({ host: '127.0.0.1', port: 3210 });
  });
});