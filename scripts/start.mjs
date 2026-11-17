#!/usr/bin/env node
/**
 * Production entry (ADR-025): resolves host/port from env instead of hardcoding
 * 127.0.0.1:3210, so the same `npm start` works locally and on Railway.
 *
 *   port = HH_PORT ?? PORT ?? 3210
 *   host = HH_HOST ?? (gateway mode | platform PORT | HH_ALLOW_REMOTE ? 0.0.0.0 : 127.0.0.1)
 *
 * `--print-bind` prints the resolved bind as JSON and exits (used by tests/doctor).
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function loadEnvFiles() {
  for (const name of ['.env.local', '.env']) {
    try {
      const text = readFileSync(resolve(process.cwd(), name), 'utf8');
      for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const eq = line.indexOf('=');
        if (eq === -1) continue;
        const key = line.slice(0, eq).trim();
        let value = line.slice(eq + 1).trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        if (process.env[key] === undefined) process.env[key] = value;
      }
    } catch {
      // absent file is fine
    }
  }
}

function portNumber(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : undefined;
}

export function resolveBind(env) {
  const platformPort = portNumber(env.PORT);
  const port = portNumber(env.HH_PORT) ?? platformPort ?? 3210;
  const remote =
    env.HH_MODE === 'gateway' ||
    env.HH_ALLOW_REMOTE === '1' ||
    env.HH_ALLOW_REMOTE === 'true' ||
    platformPort !== undefined;
  const host = env.HH_HOST || (remote ? '0.0.0.0' : '127.0.0.1');
  return { host, port };
}

const isMain =
  process.argv[1] !== undefined && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  loadEnvFiles();
  const { host, port } = resolveBind(process.env);
  if (process.argv.includes('--print-bind')) {
    process.stdout.write(`${JSON.stringify({ host, port })}\n`);
    process.exit(0);
  }
  const nextBin = resolve(ROOT, 'node_modules/next/dist/bin/next');
  const child = spawn(process.execPath, [nextBin, 'start', '-H', host, '-p', String(port)], {
    stdio: 'inherit',
    env: process.env,
  });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => child.kill(signal));
  }
  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 0);
  });
}