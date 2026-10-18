/**
 * @file codeAge.test.ts
 * @description Stale robot-side code (TASK-419): the start-time vs. commit-time
 * verdict against a fake /proc and a fake git, an owned agent older than its
 * code (`checks.staleCode`, warn), a stale foreign agent that cannot be adopted
 * (409 stale_code) and a current one that can — and never a signal to a pid the
 * supervisor did not start.
 * @feature supervisor
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import type { ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodeAge, processRobotId } from '../src/codeAge.js';
import { SupervisorError } from '../src/steps.js';
import type { RunFn } from '../src/steps.js';
import { alive, cleanupHarness, makeHarness, REPO_ROOT, spawnForeign, startAndWait, step, waitFor } from './helpers.js';
import type { Harness } from './helpers.js';

const BOOT_S = 1_760_000_000; // btime in the fake /proc

/** A fake /proc with one process that started `startS` seconds after boot (CLK_TCK 100). */
function fakeProc(pid: number, startS: number, cwd: string | null): string {
  const root = mkdtempSync(join(tmpdir(), 'neodem-fakeproc-'));
  writeFileSync(join(root, 'stat'), `cpu 0 0 0 0\nbtime ${BOOT_S}\n`);
  mkdirSync(join(root, String(pid)));
  const fields = ['S', '1', String(pid), String(pid), ...Array(15).fill('0'), String(startS * 100), '0'];
  writeFileSync(join(root, String(pid), 'stat'), `${pid} (node) ${fields.join(' ')}\n`);
  writeFileSync(join(root, String(pid), 'cmdline'), 'node\0src/index.ts\0--robot-id\0g1-x\0');
  if (cwd) symlinkSync(cwd, join(root, String(pid), 'cwd'));
  return root;
}

/** A git that answers `log -1 --format=%ct` per checkout and `rev-parse --show-toplevel` from a map. */
function fakeGit(commits: Record<string, number>, tops: Record<string, string> = {}): RunFn & { calls: string[][] } {
  const calls: string[][] = [];
  const fn = (async (_cmd: string, args: string[]) => {
    calls.push(args);
    const root = args[1];
    if (args.includes('log')) {
      const ct = commits[root];
      return ct === undefined ? { code: 128, stdout: '', stderr: 'not a repo' } : { code: 0, stdout: `${ct}\n`, stderr: '' };
    }
    if (args.includes('rev-parse')) {
      const top = tops[root];
      return top ? { code: 0, stdout: `${top}\n`, stderr: '' } : { code: 128, stdout: '', stderr: 'not a repo' };
    }
    return { code: 0, stdout: '', stderr: '' };
  }) as unknown as RunFn & { calls: string[][] };
  fn.calls = calls;
  return fn;
}

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('CodeAge (fake /proc, fake git)', () => {
  const REPO = '/repo';
  const CODE = ['robot-agent/src-does-not-exist'];

  it('a process started before the newest commit of its code is stale', async () => {
    const proc = fakeProc(4242, 100, null);
    dirs.push(proc);
    const age = new CodeAge({ repoRoot: REPO, run: fakeGit({ [REPO]: BOOT_S + 200 }), procRoot: proc });
    const stale = await age.check(4242, CODE);
    expect(stale).toEqual({
      startedAt: new Date((BOOT_S + 100) * 1000).toISOString(),
      codeAt: new Date((BOOT_S + 200) * 1000).toISOString(),
    });
  });

  it('a process started after its code is current', async () => {
    const proc = fakeProc(4242, 300, null);
    dirs.push(proc);
    const age = new CodeAge({ repoRoot: REPO, run: fakeGit({ [REPO]: BOOT_S + 200 }), procRoot: proc });
    expect(await age.check(4242, CODE)).toBeNull();
  });

  it('a process from another checkout with an older commit is stale however recently it started', async () => {
    const old = mkdtempSync(join(tmpdir(), 'neodem-oldtree-'));
    const proc = fakeProc(4242, 900, old);
    dirs.push(proc, old);
    const git = fakeGit({ [REPO]: BOOT_S + 200, [old]: BOOT_S + 50 }, { [old]: old });
    const age = new CodeAge({ repoRoot: REPO, run: git, procRoot: proc });
    const stale = await age.check(4242, CODE);
    expect(stale?.codeAt).toBe(new Date((BOOT_S + 200) * 1000).toISOString());
  });

  it('caches git answers for 30 s', async () => {
    const proc = fakeProc(4242, 300, null);
    dirs.push(proc);
    let now = 1_000_000;
    const git = fakeGit({ [REPO]: BOOT_S + 200 });
    const age = new CodeAge({ repoRoot: REPO, run: git, procRoot: proc, now: () => now });
    await age.check(4242, CODE);
    const first = git.calls.length;
    await age.check(4242, CODE);
    expect(git.calls.length).toBe(first);
    now += 31_000;
    await age.check(4242, CODE);
    expect(git.calls.length).toBeGreaterThan(first);
  });

  it('reads the robot id from the command line when the environment has none', () => {
    const proc = fakeProc(4242, 300, null);
    dirs.push(proc);
    expect(processRobotId(4242, ['node', 'src/index.ts', '--robot-id', 'g1-x'], proc)).toBe('g1-x');
  });
});

// ---------------------------------------------------------------- the supervisor

const realKill = process.kill.bind(process);
let h: Harness | undefined;
let killSpy: MockInstance<typeof process.kill>;
const foreign: ChildProcess[] = [];

beforeEach(() => {
  killSpy = vi.spyOn(process, 'kill');
});

afterEach(() => {
  killSpy.mockRestore();
  for (const f of foreign.splice(0)) {
    if (f.pid && alive(f.pid)) realKill(f.pid, 'SIGKILL');
  }
  cleanupHarness(h, realKill);
  h = undefined;
});

function signalsTo(pid: number): unknown[][] {
  return killSpy.mock.calls.filter(([p]) => Math.abs(Number(p)) === pid);
}

/** A git whose newest commit for any path in the repo is `ct` (epoch seconds). */
function gitAt(ct: () => number): RunFn {
  return async (_cmd, args) => {
    if (args.includes('log')) return { code: 0, stdout: `${ct()}\n`, stderr: '' };
    if (args.includes('rev-parse')) return { code: 0, stdout: `${REPO_ROOT}\n`, stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  };
}

async function strayAgent(harness: Harness): Promise<number> {
  const stray = spawnForeign('stub_agent.py', [String(harness.ports.agent)], { STUB_CALLS: harness.calls });
  foreign.push(stray);
  await waitFor(() => fetch(`http://127.0.0.1:${harness.ports.agent}/api/v1/health`).then((r) => r.ok, () => false), (v) => v, 10_000, 'stray agent');
  return stray.pid as number;
}

describe('the supervisor and stale code', () => {
  it('an owned agent older than its code gets checks.staleCode (warn), and it clears once current', async () => {
    let ct = 1_000; // 1970: everything is newer
    h = await makeHarness({ deps: { git: gitAt(() => ct) } });
    const st = await startAndWait(h);
    expect(st.overall).toBe('ready');
    expect(step(st, 'agent').checks.staleCode).toBeUndefined();

    ct = Math.floor(Date.now() / 1000) + 3600; // a commit after the agent started
    await new Promise((r) => setTimeout(r, 10));
    // past the 30 s git cache
    h.clock.virtual = true;
    await h.clock.sleep(31_000);
    await h.sup.refreshCodeAge();
    const agent = step(h.sup.status(), 'agent');
    expect(agent.state).toBe('warn');
    expect(agent.code).toBe('stale_code');
    expect(agent.checks.staleCode).toMatchObject({ startedAt: expect.stringMatching(/^\d{4}-/), codeAt: new Date(ct * 1000).toISOString() });
    expect(agent.detail).toMatch(/^runs code from before \d{4}-\d\d-\d\d \d\d:\d\d — restart the robot side/);

    ct = 1_000;
    await h.clock.sleep(31_000);
    await h.sup.refreshCodeAge();
    const back = step(h.sup.status(), 'agent');
    expect(back.state).toBe('ok');
    expect(back.code).toBeNull();
    expect(back.checks.staleCode).toBeUndefined();
  });

  it('a stale foreign agent is shown with its age and cwd, cannot be adopted (409 stale_code) and is never signalled', async () => {
    h = await makeHarness({ deps: { git: gitAt(() => Math.floor(Date.now() / 1000) + 3600) } });
    const pid = await strayAgent(h);
    const st = await startAndWait(h);
    expect(step(st, 'preflight')).toMatchObject({ state: 'failed', code: 'foreign_process' });
    expect(step(st, 'preflight').detail).toMatch(/^Old processes hold :\d+ agent — see the rows\./);
    const ag = step(st, 'agent');
    expect(ag.state).toBe('foreign');
    expect(ag.code).toBe('stale_code');
    expect(ag.actions).toEqual(['leave']);
    expect(ag.foreign?.staleCode?.startedAt).toBe(ag.foreign?.since);
    expect(ag.foreign?.cwd).toBe(process.cwd());

    let err: unknown;
    try {
      await h.sup.adopt('agent');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SupervisorError);
    expect((err as SupervisorError).httpStatus).toBe(409);
    expect((err as SupervisorError).code).toBe('stale_code');

    h.sup.stop();
    await h.sup.waitIdle();
    expect(signalsTo(pid)).toEqual([]);
    expect(alive(pid)).toBe(true);
  });

  it('a current foreign agent can still be adopted, and is never signalled', async () => {
    h = await makeHarness({ deps: { git: gitAt(() => 1_000) } });
    const pid = await strayAgent(h);
    const st = await startAndWait(h);
    const ag = step(st, 'agent');
    expect(ag.state).toBe('foreign');
    expect(ag.code).toBe('foreign_process');
    expect(ag.foreign?.staleCode).toBeNull();
    expect(ag.actions).toEqual(['adopt', 'leave']);

    await h.sup.adopt('agent');
    const adopted = await startAndWait(h);
    expect(adopted.overall).toBe('ready');
    expect(step(adopted, 'agent')).toMatchObject({ state: 'ok', owned: false, pid });
    h.sup.stop();
    await h.sup.waitIdle();
    expect(signalsTo(pid)).toEqual([]);
    expect(alive(pid)).toBe(true);
  });
});
