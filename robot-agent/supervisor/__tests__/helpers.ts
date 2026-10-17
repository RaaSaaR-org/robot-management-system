/**
 * @file helpers.ts
 * @description Test harness for the supervisor: a sim-style profile whose
 * children are the python stubs in fixtures/, free loopback ports, a call log
 * the stubs append to, a switchable virtual clock, and a cleanup that kills
 * every stub this file started.
 * @feature supervisor
 */

import { execFileSync, spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringify } from 'yaml';
import { Supervisor } from '../src/steps.js';
import type { Clock, Status, SupervisorDeps } from '../src/steps.js';

export const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures');
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function resolvePython(): string {
  const want = process.env.SUPERVISOR_TEST_PYTHON || 'python3';
  const abs = want.includes('/') ? want : execFileSync('which', [want], { encoding: 'utf8' }).trim();
  try {
    execFileSync(abs, ['-c', 'import zmq'], { stdio: 'ignore' });
  } catch {
    throw new Error(
      `${abs} has no pyzmq — the supervisor tests drive the real bridge_probe.py. ` +
        'Install it (pip install pyzmq) or point SUPERVISOR_TEST_PYTHON at an interpreter that has it.',
    );
  }
  return abs;
}

export const PYTHON = resolvePython();

export async function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.once('error', rej);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => res(port));
    });
  });
}

/** A virtual clock that can be switched on mid-test: sleep() then advances time instead of waiting. */
export class TestClock implements Clock {
  virtual = false;
  private offset = 0;

  now(): number {
    return Date.now() + this.offset;
  }

  async sleep(ms: number): Promise<void> {
    if (!this.virtual) {
      await new Promise((r) => setTimeout(r, ms));
      return;
    }
    await new Promise((r) => setTimeout(r, Math.min(ms, 10)));
    this.offset += ms;
  }
}

export interface Harness {
  dir: string;
  stateDir: string;
  profilePath: string;
  calls: string;
  ports: { simHttp: number; bridge: number; sidecar: number; agent: number };
  clock: TestClock;
  sup: Supervisor;
  readCalls(): string[];
}

export interface HarnessOptions {
  sidecarEnv?: Record<string, string>;
  bridgeEnv?: Record<string, string>;
  profile?: (doc: Record<string, unknown>) => void;
  deps?: SupervisorDeps;
}

export function writeProfile(path: string, doc: Record<string, unknown>): void {
  writeFileSync(path, stringify(doc));
}

export async function makeHarness(opts: HarnessOptions = {}): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), 'neodem-supervisor-'));
  const stateDir = join(dir, 'state');
  const calls = join(dir, 'calls.log');
  writeFileSync(calls, '');
  const ports = { simHttp: await freePort(), bridge: await freePort(), sidecar: await freePort(), agent: await freePort() };
  const stubEnv = { STUB_CALLS: calls };
  const doc: Record<string, unknown> = {
    robotId: 'stub-g1',
    robot: 'sim',
    iface: 'lo',
    ddsDomain: 42,
    python: PYTHON,
    ports,
    sim: { script: join(FIXTURES, 'stub_sim.py'), args: [], env: stubEnv },
    bridge: { script: join(FIXTURES, 'stub_bridge.py'), args: [], env: { ...stubEnv, ...(opts.bridgeEnv ?? {}) } },
    sidecar: {
      script: join(FIXTURES, 'stub_sidecar.py'),
      env: { ...stubEnv, ...(opts.sidecarEnv ?? {}) },
      modes: {
        read_only: { G1_LOCO_ENABLED: '0' },
        arm_sdk: { G1_WRITE_MODE: 'arm_sdk', G1_LOCO_ENABLED: 'fsm', G1_DDS_DOMAIN: '42' },
      },
    },
    agent: { cwd: FIXTURES, command: [PYTHON, join(FIXTURES, 'stub_agent.py')], path: [], env: stubEnv },
    timeouts: { simS: 10, bridgeS: 10, sidecarS: 10, agentS: 10 },
  };
  opts.profile?.(doc);
  const profilePath = join(dir, 'profile.yaml');
  writeProfile(profilePath, doc);
  const clock = new TestClock();
  const sup = new Supervisor({
    profilePath,
    repoRoot: REPO_ROOT,
    stateDir,
    deps: { clock, log: () => undefined, monitorMs: 100, ...(opts.deps ?? {}) },
  });
  return {
    dir, stateDir, profilePath, calls, ports, clock, sup,
    readCalls: () => readFileSync(calls, 'utf8').split('\n').filter(Boolean).map((l) => l.slice(l.indexOf(' ') + 1)),
  };
}

export async function waitFor<T>(fn: () => T | Promise<T>, pred: (v: T) => boolean, timeoutMs = 20_000, label = 'condition'): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T = await fn();
  while (!pred(last)) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}: ${JSON.stringify(last).slice(0, 2000)}`);
    await new Promise((r) => setTimeout(r, 50));
    last = await fn();
  }
  return last;
}

export function step(status: Status, id: string) {
  const s = status.steps.find((x) => x.id === id);
  if (!s) throw new Error(`no step ${id}`);
  return s;
}

export async function startAndWait(h: Harness, mode: 'read_only' | 'arm_sdk' = 'read_only'): Promise<Status> {
  h.sup.start(mode);
  await h.sup.waitIdle();
  return h.sup.status();
}

/** A process the supervisor did not start, e.g. a stray agent on the agent port. */
export function spawnForeign(script: string, args: string[], env: Record<string, string> = {}): ChildProcess {
  return spawn(PYTHON, [join(FIXTURES, script), ...args], {
    env: { PATH: '/usr/bin:/bin', ...env },
    stdio: 'ignore',
  });
}

export function alive(pid: number): boolean {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const state = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0];
    return state !== 'Z' && state !== 'X';
  } catch {
    return false;
  }
}

/** SIGKILL every stub process from fixtures/ that is still running (test cleanup only). */
export function killAllStubs(realKill: (pid: number, sig: NodeJS.Signals) => void): void {
  for (const name of readdirSync('/proc')) {
    if (!/^\d+$/.test(name)) continue;
    let cmd = '';
    try {
      cmd = readFileSync(`/proc/${name}/cmdline`, 'utf8');
    } catch {
      continue;
    }
    if (cmd.includes(FIXTURES)) {
      try {
        realKill(Number(name), 'SIGKILL');
      } catch {
        /* gone */
      }
    }
  }
}

export function cleanupHarness(h: Harness | undefined, realKill: (pid: number, sig: NodeJS.Signals) => void): void {
  if (!h) return;
  h.sup.detach();
  killAllStubs(realKill);
  if (existsSync(h.dir)) rmSync(h.dir, { recursive: true, force: true });
}
