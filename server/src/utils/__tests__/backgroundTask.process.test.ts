/**
 * @file backgroundTask.process.test.ts
 * @description A real Node process and a database timeout in a timer tick:
 *   with nothing catching it the process dies, through `runInBackground` it
 *   lives and the timer keeps ticking, and the process-level handlers do what
 *   the policy says (TASK-433).
 * @feature core
 *
 * The unit tests stub `process.exit` and rely on Vitest to notice an unhandled
 * rejection. This one starts `node` the way production does — no
 * `--unhandled-rejections` flag — and reads the exit code.
 */

import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, '../../..');
const backgroundTaskUrl = pathToFileURL(path.resolve(here, '../backgroundTask.ts')).href;
const processHandlersUrl = pathToFileURL(path.resolve(here, '../processHandlers.ts')).href;

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runNode(script: string, env: Record<string, string> = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
      cwd: serverRoot,
      // No inherited NODE_OPTIONS: the lab PC's `--unhandled-rejections=warn`
      // workaround would make every case pass.
      env: { PATH: process.env.PATH ?? '', NODE_ENV: 'development', LOG_LEVEL: 'silent', ...env, NODE_OPTIONS: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

/** Three interval ticks, each one a database call that times out. */
function failingInterval(startTick: string): string {
  return `
    const timeout = () => Promise.reject(Object.assign(new Error('Socket timeout'), { code: 'P1008' }));
    let ticks = 0;
    const timer = setInterval(() => {
      ticks += 1;
      ${startTick}
      if (ticks === 3) {
        clearInterval(timer);
        setTimeout(() => console.log('SURVIVED ' + ticks + ' ticks'), 20);
      }
    }, 20);
  `;
}

describe('a database timeout in a timer tick, in a real process', () => {
  it('ends the process when nothing catches it (the 2026-10-29 crash)', async () => {
    const result = await runNode(failingInterval('void (async () => { await timeout(); })();'));

    expect(result.code).not.toBe(0);
    expect(result.stdout).not.toContain('SURVIVED');
    expect(result.stderr).toContain('Socket timeout');
  });

  it('is logged and survived through runInBackground, and the timer keeps ticking', async () => {
    const result = await runNode(
      `import { runInBackground } from ${JSON.stringify(backgroundTaskUrl)};` +
        failingInterval(`runInBackground('[Fixture] tick ' + ticks + ' failed:', timeout);`)
    );

    expect(result.stdout).toContain('SURVIVED 3 ticks');
    expect(result.code).toBe(0);
    expect(result.stderr).toContain('[Fixture] tick 1 failed:');
    expect(result.stderr).toContain('[Fixture] tick 3 failed:');
  });

  const unguarded =
    `import { registerProcessHandlers } from ${JSON.stringify(processHandlersUrl)};` +
    'registerProcessHandlers();' +
    failingInterval('void (async () => { await timeout(); })();');

  it('outside production the process handler logs a missed rejection and the process lives', async () => {
    const result = await runNode(unguarded, { NODE_ENV: 'development' });

    expect(result.stdout).toContain('SURVIVED 3 ticks');
    expect(result.code).toBe(0);
    expect(result.stderr).toContain('Unhandled promise rejection');
    expect(result.stderr).toContain('Socket timeout');
  });

  it('in production the process handler logs a missed rejection and exits with code 1', async () => {
    const result = await runNode(unguarded, { NODE_ENV: 'production' });

    expect(result.code).toBe(1);
    expect(result.stdout).not.toContain('SURVIVED');
    expect(result.stderr).toContain('Unhandled promise rejection');
    expect(result.stderr).toContain('Socket timeout');
  });

  it('UNHANDLED_REJECTION_EXIT=false keeps a production process alive', async () => {
    const result = await runNode(unguarded, { NODE_ENV: 'production', UNHANDLED_REJECTION_EXIT: 'false' });

    expect(result.stdout).toContain('SURVIVED 3 ticks');
    expect(result.code).toBe(0);
    expect(result.stderr).toContain('Unhandled promise rejection');
  });
});
