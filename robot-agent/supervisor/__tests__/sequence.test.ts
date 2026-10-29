/**
 * @file sequence.test.ts
 * @description The start sequence against stub children: the happy path,
 * sidecar exit codes, the armed:true safety abort, the xr_teleoperate conflict,
 * and a foreign process on a port (never signalled; adopt or leave).
 * @feature supervisor
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import type { ChildProcess } from 'node:child_process';
import {
  alive,
  cleanupHarness,
  makeHarness,
  spawnForeign,
  startAndWait,
  step,
  waitFor,
} from './helpers.js';
import type { Harness } from './helpers.js';

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

function signalsTo(pid: number): string[] {
  return killSpy.mock.calls.filter(([p]) => p === pid || p === -pid).map(([, sig]) => String(sig));
}

describe('start sequence', () => {
  it('walks preflight → link → camera → bridge → sidecar → agent and reports each step', async () => {
    h = await makeHarness();
    const seen = new Set<string>();
    h.sup.start('read_only');
    // the status while it runs: some step is `running`, overall `starting`
    const mid = h.sup.status();
    expect(mid.overall).toBe('starting');
    while (h.sup.status().overall === 'starting') {
      for (const s of h.sup.status().steps) if (s.state === 'running') seen.add(s.id);
      await new Promise((r) => setTimeout(r, 5));
    }
    const st = h.sup.status();
    expect(st.overall).toBe('ready');
    expect(st.robot).toBe('sim');
    expect(st.sidecarMode).toBe('read_only');
    expect(step(st, 'preflight').state).toBe('ok');
    expect(step(st, 'link')).toMatchObject({ state: 'ok', owned: true });
    expect(step(st, 'camera')).toMatchObject({ state: 'idle', detail: 'no PC2 camera in this profile' });
    expect(step(st, 'bridge')).toMatchObject({ state: 'ok', owned: true, checks: { lowstate: true, dex3Left: true, dex3Right: false, bind: true } });
    expect(step(st, 'sidecar')).toMatchObject({ state: 'ok', owned: true, checks: { connected: true, write_mode: 'read_only', gate: 'off', armed: false } });
    expect(step(st, 'agent')).toMatchObject({ state: 'ok', owned: true, checks: { health: 'healthy' } });
    for (const id of ['link', 'bridge', 'sidecar', 'agent']) {
      const s = step(st, id);
      expect(s.pid).toBeGreaterThan(0);
      expect(alive(s.pid as number)).toBe(true);
      expect(s.startedAt).toMatch(/^\d{4}-/);
    }
    expect(seen.has('bridge') || seen.has('sidecar') || seen.has('agent')).toBe(true);
    const calls = h.readCalls();
    expect(calls).toContain('sim:start:domain=42:iface=lo');
    expect(calls).toContain('sidecar:start:read_only');
    // the bridge got --bind because its --help offers it
    expect(calls.find((c) => c.startsWith('bridge:args:'))).toContain('"--bind", "127.0.0.1"');
    // starting sent no signal to anything
    expect(killSpy).not.toHaveBeenCalled();
  });

  it('starting twice re-checks running children instead of spawning new ones', async () => {
    h = await makeHarness();
    const first = await startAndWait(h);
    const second = await startAndWait(h);
    expect(second.overall).toBe('ready');
    for (const id of ['link', 'bridge', 'sidecar', 'agent']) expect(step(second, id).pid).toBe(step(first, id).pid);
  });

  it('does not pass --bind to a bridge whose --help lacks it', async () => {
    h = await makeHarness({ bridgeEnv: { STUB_NO_BIND: '1' } });
    const st = await startAndWait(h);
    expect(step(st, 'bridge').checks.bind).toBe(false);
    expect(h.readCalls().find((c) => c.startsWith('bridge:args:'))).not.toContain('--bind');
  });

  it('a sidecar exiting 3 stops the sequence with the DDS message, earlier steps keep running', async () => {
    h = await makeHarness({ sidecarEnv: { STUB_EXIT: '3' } });
    const st = await startAndWait(h);
    expect(st.overall).toBe('error');
    const sc = step(st, 'sidecar');
    expect(sc.state).toBe('failed');
    expect(sc.code).toBe('dds_iface');
    expect(sc.detail).toContain('DDS could not open lo (no carrier?)');
    expect(sc.detail).toContain('does not match an available interface');
    expect(step(st, 'agent').state).toBe('idle');
    expect(step(st, 'agent').pid).toBeNull();
    expect(step(st, 'bridge').state).toBe('ok');
    expect(alive(step(st, 'bridge').pid as number)).toBe(true);
  });

  it('a sidecar exiting 2 reports that it refused its configuration', async () => {
    h = await makeHarness({ sidecarEnv: { STUB_EXIT: '2' } });
    const st = await startAndWait(h);
    const sc = step(st, 'sidecar');
    expect(sc.code).toBe('sidecar_config_refused');
    expect(sc.detail).toContain('the sidecar refused its configuration');
    expect(sc.detail).toContain('REFUSING TO START');
  });

  it('a sidecar reporting armed:true after start aborts the sequence and is stopped', async () => {
    h = await makeHarness({ sidecarEnv: { STUB_ARMED: '1' } });
    const st = await startAndWait(h);
    expect(st.overall).toBe('error');
    const sc = step(st, 'sidecar');
    expect(sc.state).toBe('failed');
    expect(sc.code).toBe('safety_abort');
    expect(sc.detail).toContain('armed:true');
    expect(step(st, 'agent').state).toBe('idle');
    const calls = h.readCalls();
    expect(calls.indexOf('sidecar:disarm')).toBeGreaterThanOrEqual(0);
    expect(calls.indexOf('sidecar:SIGTERM')).toBeGreaterThan(calls.indexOf('sidecar:disarm'));
    expect(st.sidecarMode).toBeNull();
    // only SIGTERM, never SIGKILL
    const pids = killSpy.mock.calls.map(([p]) => Math.abs(p as number));
    for (const pid of pids) for (const sig of signalsTo(pid)) expect(sig).not.toBe('SIGKILL');
  });

  it('a sidecar reporting a different DDS domain is refused and stopped', async () => {
    h = await makeHarness({ sidecarEnv: { STUB_REPORT_DOMAIN: '0' } });
    const st = await startAndWait(h, 'arm_sdk');
    expect(step(st, 'sidecar').code).toBe('domain_mismatch');
    expect(h.readCalls()).toContain('sidecar:SIGTERM');
  });

  it('refuses an arm_sdk start while a process named xr_teleoperate runs', async () => {
    h = await makeHarness();
    const xr = spawnForeign('xr_teleoperate_stub.py', []);
    foreign.push(xr);
    await waitFor(() => xr.pid !== undefined && alive(xr.pid), (v) => v, 5000, 'xr stub');
    const st = await startAndWait(h, 'arm_sdk');
    const pre = step(st, 'preflight');
    expect(pre.state).toBe('failed');
    expect(pre.code).toBe('conflict_xr_teleoperate');
    expect(pre.detail).toContain(`pid ${xr.pid}`);
    // nothing was started, and xr_teleoperate was not touched
    for (const id of ['link', 'bridge', 'sidecar', 'agent']) expect(step(st, id).pid).toBeNull();
    expect(signalsTo(xr.pid as number)).toEqual([]);
    expect(alive(xr.pid as number)).toBe(true);
    // read_only is not affected by xr_teleoperate
    const ro = await startAndWait(h, 'read_only');
    expect(ro.overall).toBe('ready');
  });

  it('a foreign process on a port is reported with pid and cmdline and never signalled', async () => {
    h = await makeHarness();
    const stray = spawnForeign('stub_agent.py', [String(h.ports.agent)], { STUB_CALLS: h.calls });
    foreign.push(stray);
    const pid = stray.pid as number;
    await waitFor(() => fetch(`http://127.0.0.1:${h!.ports.agent}/api/v1/health`).then((r) => r.ok, () => false), (v) => v, 10_000, 'stray agent');

    const st = await startAndWait(h);
    expect(step(st, 'preflight')).toMatchObject({ state: 'failed', code: 'foreign_process' });
    const ag = step(st, 'agent');
    expect(ag.state).toBe('foreign');
    expect(ag.owned).toBe(false);
    expect(ag.pid).toBe(pid);
    expect(ag.foreign?.pid).toBe(pid);
    expect(ag.foreign?.cmdline?.join(' ')).toContain('stub_agent.py');
    expect(ag.foreign?.since).toMatch(/^\d{4}-/);
    expect(ag.foreign?.port).toBe(h.ports.agent);
    expect(ag.actions).toEqual(['adopt', 'leave']);
    for (const id of ['link', 'bridge', 'sidecar']) expect(step(st, id).pid).toBeNull();

    // a stop does not touch it either
    h.sup.stop();
    await h.sup.waitIdle();
    expect(signalsTo(pid)).toEqual([]);
    expect(alive(pid)).toBe(true);

    // leave: it stays foreign and the start still refuses
    h.sup.leave('agent');
    const left = await startAndWait(h);
    expect(step(left, 'agent').state).toBe('foreign');
    expect(step(left, 'agent').actions).toEqual([]);
    expect(step(left, 'agent').detail).toContain('left alone');

    // adopt: the sequence uses it as the agent, still never signals it
    await h.sup.adopt('agent');
    const adopted = await startAndWait(h);
    expect(adopted.overall).toBe('ready');
    expect(step(adopted, 'agent')).toMatchObject({ state: 'ok', owned: false, pid });
    h.sup.stop();
    await h.sup.waitIdle();
    const after = h.sup.status();
    expect(after.overall).toBe('stopped');
    expect(step(after, 'agent').detail).toContain('left running');
    expect(signalsTo(pid)).toEqual([]);
    expect(alive(pid)).toBe(true);
    expect(h.readCalls().filter((c) => c.startsWith('agent:SIG'))).toEqual([]);
  });

  it('refuses a start in the other mode while a sidecar runs — no silent mode switch', async () => {
    h = await makeHarness();
    await startAndWait(h, 'read_only');
    const st = await startAndWait(h, 'arm_sdk');
    expect(step(st, 'preflight')).toMatchObject({ state: 'failed', code: 'mode_mismatch' });
    expect(st.sidecarMode).toBe('read_only');
  });

  it('a profile that became invalid fails preflight with the loader message', async () => {
    h = await makeHarness();
    const { writeFileSync, readFileSync } = await import('node:fs');
    writeFileSync(h.profilePath, readFileSync(h.profilePath, 'utf8').replace('ddsDomain: 42', 'ddsDomain: 0'));
    const st = await startAndWait(h);
    expect(step(st, 'preflight')).toMatchObject({ state: 'failed', code: 'profile_invalid' });
    expect(step(st, 'preflight').detail).toContain('REAL robot');
  });

  it('real profile: the link gate reads carrier, host IP and ping; the camera is only a warning', async () => {
    const { mkdirSync, writeFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    let carrier = '0';
    let pingCode = 1;
    const pings: string[][] = [];
    const nmcli: string[][] = [];
    const sys = join((await import('node:os')).tmpdir(), `neodem-sys-${process.pid}-${Date.now()}`);
    const { runCommand } = await import('../src/steps.js');
    h = await makeHarness({
      bridgeEnv: { STUB_SILENT: '1' },
      profile: (doc) => {
        Object.assign(doc, {
          robot: 'real', iface: 'enp9s9', ddsDomain: 7, robotIp: '192.0.2.10', hostIp: '192.0.2.1/24',
          pc2Camera: '192.0.2.10:5600', nmProfile: 'test-lan',
        });
        delete doc.sim;
        delete (doc.ports as Record<string, unknown>).simHttp;
        (doc.timeouts as Record<string, number>).bridgeS = 1;
        ((doc.sidecar as { modes: { arm_sdk: Record<string, string> } }).modes.arm_sdk).G1_DDS_DOMAIN = '7';
      },
      deps: {
        sysClassNet: sys,
        netAddrs: () => ['192.0.2.1'],
        tcpProbe: async () => false,
        run: async (cmd, args, o) => {
          if (cmd === 'ping') {
            pings.push(args);
            return { code: pingCode, stdout: '', stderr: '' };
          }
          if (cmd === 'nmcli') {
            nmcli.push(args);
            return { code: 0, stdout: 'Connection successfully activated', stderr: '' };
          }
          return runCommand(cmd, args, o);
        },
      },
    });
    mkdirSync(join(sys, 'enp9s9'), { recursive: true });
    const write = () => {
      writeFileSync(join(sys, 'enp9s9', 'carrier'), carrier);
      writeFileSync(join(sys, 'enp9s9', 'operstate'), carrier === '1' ? 'up' : 'down');
    };
    write();
    h.clock.virtual = true; // the carrier wait (timeouts.carrierS, default 15 s) passes in virtual time
    let st = await startAndWait(h);
    h.clock.virtual = false;
    expect(step(st, 'link')).toMatchObject({ state: 'failed', code: 'no_carrier', checks: { carrierWaitS: 15 } });
    expect(step(st, 'link').detail).toMatch(/^Robot cable unplugged or robot off \(enp9s9 no carrier\)\./);
    expect(step(st, 'link').detail).toContain('Waited 15 s for the link to come back.');
    expect(step(st, 'bridge').pid).toBeNull();
    expect(pings).toEqual([]);
    expect(nmcli).toEqual([]); // never brought up automatically

    carrier = '1';
    write();
    st = await startAndWait(h);
    expect(step(st, 'link')).toMatchObject({ state: 'failed', code: 'no_ping' });
    expect(pings).toEqual([['-c1', '-W1', '192.0.2.10']]);

    pingCode = 0;
    st = await startAndWait(h);
    expect(step(st, 'link')).toMatchObject({ state: 'ok', checks: { carrier: true, hostIp: true, ping: true } });
    expect(step(st, 'camera')).toMatchObject({ state: 'warn', code: 'camera_unreachable' });
    // the camera warning did not stop the sequence: the bridge ran (and failed on its own gate)
    expect(step(st, 'bridge')).toMatchObject({ state: 'failed', code: 'no_lowstate' });
    expect(nmcli).toEqual([]);

    const lan = await h.sup.lanUp();
    expect(lan.ok).toBe(true);
    expect(nmcli).toEqual([['con', 'up', 'test-lan']]);
  });
  it('real profile: a short carrier loss is waited out, and the step says it waited (TASK-423)', async () => {
    const { mkdirSync, writeFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const sys = join((await import('node:os')).tmpdir(), `neodem-sys-flap-${process.pid}-${Date.now()}`);
    const iface = join(sys, 'enp9s9');
    const setCarrier = (up: boolean) => {
      writeFileSync(join(iface, 'carrier'), up ? '1' : '0');
      writeFileSync(join(iface, 'operstate'), up ? 'up' : 'down');
    };
    // The link drops for 8 s; NetworkManager puts the host IP back 2 s after the carrier.
    let sleptS = 0;
    let ipBack = false;
    const details: string[] = [];
    const clock = {
      offset: 0,
      now() { return Date.now() + this.offset; },
      async sleep(ms: number) {
        await new Promise((r) => setTimeout(r, 5));
        this.offset += ms;
        sleptS += ms / 1000;
        const link = h?.sup.status().steps.find((x) => x.id === 'link');
        if (link?.detail) details.push(link.detail);
        if (sleptS >= 8) setCarrier(true);
        if (sleptS >= 10) ipBack = true;
      },
    };
    const pings: string[][] = [];
    h = await makeHarness({
      bridgeEnv: { STUB_SILENT: '1' },
      profile: (doc) => {
        Object.assign(doc, { robot: 'real', iface: 'enp9s9', ddsDomain: 7, robotIp: '192.0.2.10', hostIp: '192.0.2.1/24' });
        delete doc.sim;
        delete (doc.ports as Record<string, unknown>).simHttp;
        (doc.timeouts as Record<string, number>).bridgeS = 1;
        ((doc.sidecar as { modes: { arm_sdk: Record<string, string> } }).modes.arm_sdk).G1_DDS_DOMAIN = '7';
      },
      deps: {
        clock,
        sysClassNet: sys,
        netAddrs: () => (ipBack ? ['192.0.2.1'] : []),
        tcpProbe: async () => false,
        run: async (cmd, args) => {
          if (cmd === 'ping') pings.push(args);
          return { code: 0, stdout: '', stderr: '' };
        },
      },
    });
    mkdirSync(iface, { recursive: true });
    setCarrier(false);
    const st = await startAndWait(h);
    const link = step(st, 'link');
    expect(link).toMatchObject({ state: 'ok', checks: { carrier: true, hostIp: true, ping: true, carrierWaitS: 10 } });
    expect(link.detail).toContain('the link was down at start; waited 10 s for it to come back');
    expect(details.some((d) => d.startsWith('waiting for carrier on enp9s9 — link down'))).toBe(true);
    expect(details.some((d) => d.startsWith('carrier on enp9s9 is back; waiting for 192.0.2.1'))).toBe(true);
    expect(pings).toEqual([['-c1', '-W1', '192.0.2.10']]);
    // the sequence went on past the link
    expect(step(st, 'bridge').state).not.toBe('idle');
  });

  it('real profile: a link that stays down is never masked — no_carrier after carrierS (TASK-423)', async () => {
    const { mkdirSync, writeFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const sys = join((await import('node:os')).tmpdir(), `neodem-sys-down-${process.pid}-${Date.now()}`);
    h = await makeHarness({
      profile: (doc) => {
        Object.assign(doc, { robot: 'real', iface: 'enp9s9', ddsDomain: 7, robotIp: '192.0.2.10', hostIp: '192.0.2.1/24' });
        delete doc.sim;
        delete (doc.ports as Record<string, unknown>).simHttp;
        (doc.timeouts as Record<string, number>).carrierS = 4;
        ((doc.sidecar as { modes: { arm_sdk: Record<string, string> } }).modes.arm_sdk).G1_DDS_DOMAIN = '7';
      },
      deps: { sysClassNet: sys, netAddrs: () => ['192.0.2.1'], tcpProbe: async () => false },
    });
    mkdirSync(join(sys, 'enp9s9'), { recursive: true });
    writeFileSync(join(sys, 'enp9s9', 'carrier'), '0');
    writeFileSync(join(sys, 'enp9s9', 'operstate'), 'down');
    h.clock.virtual = true;
    const st = await startAndWait(h);
    expect(step(st, 'link')).toMatchObject({ state: 'failed', code: 'no_carrier', checks: { carrier: false, carrierWaitS: 4 } });
    expect(step(st, 'link').detail).toContain('Waited 4 s for the link to come back.');
    expect(step(st, 'bridge').pid).toBeNull();
  });
});
