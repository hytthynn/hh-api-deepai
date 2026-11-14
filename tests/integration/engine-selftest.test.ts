import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../..');
const python = process.env.HH_PYTHON ?? 'python';
const pythonAvailable = spawnSync(python, ['--version'], { encoding: 'utf8', timeout: 20_000 }).status === 0;

type Hello = {
  event: string;
  chrome: string;
  chrome_ok: boolean;
  chrome_source?: string;
};

/**
 * B-020: `hello()` used to look only at a hardcoded `C:/Program Files/...` path, so
 * `chrome_ok` was false on machines where OAuth actually ran Playwright's Chromium and the
 * provision preflight refused to buy anything. The selftest must report the browser that
 * `launch_persistent_context()` will really use.
 */
describe.skipIf(!pythonAvailable)('engine worker selftest', () => {
  it('reports a browser that exists on disk', (ctx) => {
    const result = spawnSync(python, [resolve(root, 'engine/worker.py'), '--selftest'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 60_000,
    });
    expect(result.stderr).not.toContain('Traceback');
    expect(result.status).toBe(0);

    const hello = JSON.parse(result.stdout.trim().split(/\r?\n/)[0]) as Hello;
    expect(hello.event).toBe('hello');
    // A bare machine without any browser cannot register accounts; nothing to assert there.
    if (hello.chrome_source === 'none') ctx.skip();
    expect(['chrome', 'playwright']).toContain(hello.chrome_source);
    expect(hello.chrome_ok).toBe(true);
    expect(existsSync(hello.chrome)).toBe(true);
  });
});