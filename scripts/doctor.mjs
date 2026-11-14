#!/usr/bin/env node
/**
 * `npm run doctor` — проверка окружения перед запуском (SPEC §24).
 *
 * Жёсткие требования: Node >= 20.9, HH_SECRET (16+ символов), запись в data/, свободный порт 3210.
 * Python / playwright / Chrome — предупреждения: без них шлюз работает, регистрация недоступна.
 */
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.HH_PORT ?? 3210);
const MIN_NODE = [20, 9, 0];

const results = [];
let hardFailure = false;

function record(name, value, status, note = '') {
  results.push({ name, value, status, note });
  if (status === 'fail') hardFailure = true;
}

function readEnvFile() {
  const out = {};
  for (const file of ['.env.local', '.env']) {
    const path = join(ROOT, file);
    if (!existsSync(path)) continue;
    const text = readFileSync(path, 'utf8').replace(/^\uFEFF/, '');
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!(key in out)) out[key] = value;
    }
  }
  return out;
}

function run(command, args, timeout = 15_000) {
  const line = [command, ...args].join(' ');
  const result = spawnSync(line, {
    cwd: ROOT,
    timeout,
    encoding: 'utf8',
    shell: true,
    windowsHide: true,
  });
  if (result.error) return { ok: false, out: result.error.message };
  const out = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  return { ok: result.status === 0, out: out.split(/\r?\n/)[0] ?? '' };
}

function firstLine(text) {
  const line = String(text ?? '').trim().split(/\r?\n/)[0];
  return line.length > 64 ? `${line.slice(0, 61)}…` : line;
}

/* ---------------- node ---------------- */

{
  const current = process.versions.node;
  const parts = current.split('.').map(Number);
  let ok = true;
  for (let i = 0; i < MIN_NODE.length; i += 1) {
    if ((parts[i] ?? 0) > MIN_NODE[i]) break;
    if ((parts[i] ?? 0) < MIN_NODE[i]) {
      ok = false;
      break;
    }
  }
  record('node', `v${current}`, ok ? 'ok' : 'fail', ok ? '' : 'требуется >= 20.9');
}

const envFile = readEnvFile();
const envValue = (key) => process.env[key] ?? envFile[key] ?? '';

/* ---------------- python ---------------- */

const pythonCandidates = [envValue('HH_PYTHON'), 'python', 'python3', 'py'].filter(Boolean);
let pythonName = null;
let pythonVersion = null;
for (const candidate of new Set(pythonCandidates)) {
  const probe = run(candidate, [candidate === 'py' ? '-3 --version' : '--version']);
  if (probe.ok) {
    pythonName = candidate;
    pythonVersion = firstLine(probe.out);
    break;
  }
}
if (pythonName) record('python', pythonVersion, 'ok', pythonName === 'python' ? '' : `(${pythonName})`);
else record('python', 'не найден', 'warn', 'регистрация будет недоступна');

/* ---------------- playwright ---------------- */

let playwrightVersion = null;
if (pythonName) {
  const probe = run(pythonName, [pythonName === 'py' ? '-3 -m playwright --version' : '-m playwright --version']);
  if (probe.ok) playwrightVersion = firstLine(probe.out).replace(/^Version\s+/i, '');
}
if (playwrightVersion) record('playwright', playwrightVersion, 'ok', '');
else record('playwright', 'не найден', 'warn', 'pip install playwright');

/* ---------------- chrome ---------------- */

/** Same source of truth as `/api/engine`: `engine/worker.py --selftest` reports the browser OAuth launches. */
function chromeFromWorker() {
  if (!pythonName) return null;
  const probe = run(pythonName, ['engine/worker.py --selftest'], 60_000);
  if (!probe.ok) return null;
  const match = probe.out.match(/\{"event":"hello".*\}/);
  if (!match) return null;
  try {
    const hello = JSON.parse(match[0]);
    return hello.chrome_ok ? { path: String(hello.chrome), source: String(hello.chrome_source ?? 'chrome') } : null;
  } catch {
    return null;
  }
}

const workerChrome = chromeFromWorker();
const chromePath = workerChrome?.path ?? null;
if (chromePath) {
  record('chrome', chromePath, 'ok', workerChrome?.source === 'playwright' ? '(Chromium из Playwright)' : '');
} else {
  record('chrome', 'не найден', 'warn', 'кнопка «Добавить аккаунты» будет заблокирована до playwright install chromium');
}

/* ---------------- data/ writable ---------------- */

{
  const dir = join(ROOT, 'data');
  const probe = join(dir, `.doctor-${process.pid}.tmp`);
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(probe, 'ok', 'utf8');
    rmSync(probe, { force: true });
    record('data/ writable', 'data/', 'ok', '');
  } catch (error) {
    record('data/ writable', 'data/', 'fail', error instanceof Error ? error.message : String(error));
  }
}

/* ---------------- port ---------------- */

function portFree(port) {
  return new Promise((resolvePort) => {
    const server = createServer();
    server.unref();
    server.once('error', (error) => {
      resolvePort({ free: false, reason: error.code === 'EADDRINUSE' ? 'занят' : error.message });
    });
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolvePort({ free: true, reason: '' }));
    });
  });
}

/* ---------------- secret ---------------- */

{
  const secret = envValue('HH_SECRET');
  const fingerprint = secret.length > 0 ? `${secret.length} символов` : 'не задан';
  record(
    'HH_SECRET set',
    fingerprint,
    secret.length >= 16 ? 'ok' : 'fail',
    secret.length >= 16 ? '' : 'добавьте HH_SECRET в .env.local',
  );
  const password = envValue('HH_ADMIN_PASSWORD');
  if (password.length === 0) record('HH_ADMIN_PASSWORD', 'не задан', 'warn', 'вход в панель будет недоступен');
  else record('HH_ADMIN_PASSWORD', `${password.length} символов`, 'ok', '');
}

/* ---------------- вывод ---------------- */

const portResult = await portFree(PORT);
record(`port ${PORT}`, portResult.free ? 'free' : portResult.reason, portResult.free ? 'ok' : 'fail', portResult.free ? '' : 'остановите dev-сервер');

const nameWidth = Math.max(...results.map((row) => row.name.length)) + 2;
const valueWidth = Math.max(...results.map((row) => row.value.length)) + 2;

for (const row of results) {
  const mark = row.status === 'ok' ? 'ok' : row.status === 'warn' ? 'warn' : 'FAIL';
  console.log(
    `${row.name.padEnd(nameWidth)}${row.value.padEnd(valueWidth)}${mark}${row.note ? `  ${row.note}` : ''}`,
  );
}

const warnings = results.filter((row) => row.status === 'warn');
console.log('');
if (hardFailure) {
  console.log('Итог: есть блокирующие проблемы — исправьте FAIL-пункты и повторите.');
  process.exitCode = 1;
} else if (warnings.length > 0) {
  console.log('Итог: шлюз запустится, регистрация недоступна (см. warn).');
} else {
  console.log('Итог: окружение готово.');
}