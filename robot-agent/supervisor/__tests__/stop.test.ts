/**
 * @file stop.test.ts
 * @description Stop order (disarm → agent → sidecar → bridge), a sidecar that
 * ignores SIGTERM (sidecar_hung, never SIGKILL), re-adoption after a supervisor
 * restart, and the restart policy (bridge yes, sidecar never).
 * @feature supervisor
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Supervisor } from '../src/steps.js';
import { cmdlineMatches } from '../src/procs.js';
import { alive, cleanupHarness, makeHarness, REPO_ROOT, startAndWait, step, waitFor } from './helpers.js';
import type { Harness } from './helpers.js';

const realKill = process.kill.bind(process);
let h: Harness | undefined;
let extra: Supervisor | undefined;
let killSpy: MockInstance<typeof process.kill>;

beforeEach(() => {
  killSpy = vi.spyOn(process, 'kill');
});

afterEach(() => {
  killSpy.mockRestore();
  extra?.detach();
  extra = undefined;
  cleanupHarness(h, realKill);
  h = undefined;
});

function signalsTo(pid: number): string[] {
  return killSpy.mock.calls.filter(([p]) => p === pid || p === -pid).map(([, sig]) => String(sig));
}

describe('stop sequence', () => {
  it('stops in the order disarm → agent → sidecar → bridge → sim; the sidecar gets SIGTERM only', async () => {
    h = await makeHarness();
    const st = await startAndWait(h);
    expect(st.overall).toBe('ready');
    const pids = Object.fromEntries(['link', 'bridge', 'sidecar', 'agent'].map((id) => [id, step(st, id).pid as number]));

    h.sup.stop();
    expect(h.sup.status().overall).toBe('stopping');
    await h.sup.waitIdle();
    const done = h.sup.status();
    expect(done.overall).toBe('stopped');
    for (const pid of Object.values(pids)) expect(alive(pid)).toBe(false);

    const calls = h.readCalls().filter((c) => /^(sidecar:disarm|agent:SIG|sidecar:SIG|bridge:SIG|sim:SIG)/.test(c));
    expect(calls).toEqual(['sidecar:disarm', 'agent:SIGTERM', 'sidecar:SIGTERM', 'bridge:SIGINT', 'sim:SIGINT']);
    expect(signalsTo(pids.sidecar)).toEqual(['SIGTERM']);
    // the sidecar is signalled as a process, never as a group
    expect(killSpy.mock.calls.filter(([p]) => p === -pids.sidecar)).toEqual([]);
    expect(signalsTo(pids.agent)).toEqual(['SIGTERM']);
    expect(signalsTo(pids.bridge)).toEqual(['SIGINT']);
    for (const proc of ['sim', 'bridge', 'sidecar', 'agent']) {
      expect(existsSync(join(h.stateDir, 'stub-g1', `${proc}.pid`))).toBe(false);
    }
    // stopping changed no robot mode: the stub saw no route but /health and /disarm
    expect(h.readCalls().some((c) => c.includes('FORBIDDEN'))).toBe(false);
  });

  it('a sidecar that ignores SIGTERM yields sidecar_hung after 15 s, with no SIGKILL', async () => {
    h = await makeHarness({ sidecarEnv: { STUB_IGNORE_SIGTERM: '1' } });
    const st = await startAndWait(h);
    expect(st.overall).toBe('ready');
    const sidecarPid = step(st, 'sidecar').pid as number;
    const bridgePid = step(st, 'bridge').pid as number;

    h.clock.virtual = true; // the 15 s wait passes in virtual time
    const t0 = h.clock.now();
    h.sup.stop();
    await h.sup.waitIdle();
    const after = h.sup.status();
    expect(h.clock.now() - t0).toBeGreaterThanOrEqual(15_000);
    expect(after.overall).toBe('error');
    const sc = step(after, 'sidecar');
    expect(sc.state).toBe('failed');
    expect(sc.code).toBe('sidecar_hung');
    expect(sc.detail).toContain('never SIGKILLs a sidecar');
    expect(sc.detail).toContain('gantry');
    expect(sc.detail).toContain('power button');
    expect(signalsTo(sidecarPid)).toEqual(['SIGTERM']);
    expect(killSpy.mock.calls.some(([, sig]) => sig === 'SIGKILL')).toBe(false);
    expect(alive(sidecarPid)).toBe(true);
    // the bridge stays up so the operator still sees the robot's state
    expect(alive(bridgePid)).toBe(true);
    expect(signalsTo(bridgePid)).toEqual([]);
  });

  it('a restarted supervisor re-adopts its running children from the PID files', async () => {
    h = await makeHarness();
    const st = await startAndWait(h);
    expect(st.overall).toBe('ready');
    const before = Object.fromEntries(['link', 'bridge', 'sidecar', 'agent'].map((id) => [id, step(st, id).pid]));
    h.sup.detach(); // the old supervisor goes away; its children do not
    // A `#!/usr/bin/env node` child (tsx) re-execs after its PID file is written:
    // the recorded command line is the env stage, the live one is not.
    const agentPid = join(h.stateDir, 'stub-g1', 'agent.pid');
    const pf = JSON.parse(readFileSync(agentPid, 'utf8'));
    writeFileSync(agentPid, JSON.stringify({ ...pf, cmdline: ['/usr/bin/env', 'python3', ...pf.argv] }));

    extra = new Supervisor({
      profilePath: h.profilePath, repoRoot: REPO_ROOT, stateDir: h.stateDir,
      deps: { clock: h.clock, log: () => undefined, monitorMs: 100 },
    });
    await extra.init();
    const re = extra.status();
    expect(re.overall).toBe('ready');
    expect(re.sidecarMode).toBe('read_only');
    for (const id of ['link', 'bridge', 'sidecar', 'agent']) {
      expect(step(re, id)).toMatchObject({ owned: true, pid: before[id] });
      expect(['ok', 'warn']).toContain(step(re, id).state);
    }
    // and it can stop them
    extra.stop();
    await extra.waitIdle();
    expect(extra.status().overall).toBe('stopped');
    for (const pid of Object.values(before)) expect(alive(pid as number)).toBe(false);
  });

  it('a stale PID file (process gone or PID reused) is dropped, not adopted', async () => {
    h = await makeHarness();
    const { mkdirSync, writeFileSync } = await import('node:fs');
    mkdirSync(join(h.stateDir, 'stub-g1'), { recursive: true });
    // our own PID with a different start time and command line: must not be adopted
    writeFileSync(join(h.stateDir, 'stub-g1', 'sidecar.pid'), JSON.stringify({
      proc: 'sidecar', pid: process.pid, startTime: 1, cmdline: ['python3', 'g1_sidecar.py'], owned: true,
      mode: 'read_only', startedAt: new Date().toISOString(), logPath: '',
    }));
    await h.sup.init();
    expect(step(h.sup.status(), 'sidecar').pid).toBeNull();
    expect(existsSync(join(h.stateDir, 'stub-g1', 'sidecar.pid'))).toBe(false);
    h.sup.stop();
    await h.sup.waitIdle();
    expect(signalsTo(process.pid)).toEqual([]);
  });

  it('restarts a crashed bridge, but never a crashed sidecar', async () => {
    h = await makeHarness();
    await h.sup.init(); // starts the liveness monitor
    const st = await startAndWait(h);
    const bridgePid = step(st, 'bridge').pid as number;
    realKill(bridgePid, 'SIGKILL');
    const restarted = await waitFor(() => h!.sup.status(), (s) => step(s, 'bridge').state === 'ok' && step(s, 'bridge').pid !== bridgePid, 20_000, 'bridge restart');
    expect(step(restarted, 'bridge').owned).toBe(true);

    const sidecarPid = step(restarted, 'sidecar').pid as number;
    realKill(sidecarPid, 'SIGKILL');
    const failed = await waitFor(() => h!.sup.status(), (s) => step(s, 'sidecar').state === 'failed', 10_000, 'sidecar failed');
    expect(step(failed, 'sidecar').detail).toContain('never restarted automatically');
    await new Promise((r) => setTimeout(r, 1500));
    const later = h.sup.status();
    expect(step(later, 'sidecar').pid).toBeNull();
    expect(later.sidecarMode).toBeNull();
    expect(later.overall).toBe('degraded');
    expect(h.readCalls().filter((c) => c.startsWith('sidecar:start')).length).toBe(1);
  });

  it('matches a re-exec\'d command line by command and arguments, not by any PID', () => {
    const data = { cmdline: ['/usr/bin/env', 'node', '/r/node_modules/.bin/tsx', 'src/index.ts'], argv: ['/r/node_modules/.bin/tsx', 'src/index.ts'] };
    expect(cmdlineMatches(['node', '/r/node_modules/.bin/tsx', 'src/index.ts'], data)).toBe(true);
    expect(cmdlineMatches(data.cmdline, data)).toBe(true);
    expect(cmdlineMatches(['node', '/other/tsx', 'src/index.ts'], data)).toBe(false);
    expect(cmdlineMatches(['node', '/r/node_modules/.bin/tsx', 'other.ts'], data)).toBe(false);
    expect(cmdlineMatches(['python3', 'x.py'], { cmdline: ['python3', 'y.py'], argv: [] })).toBe(false);
  });
});
