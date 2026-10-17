/**
 * @file steps.ts
 * @description The robot supervisor: a fixed, gated start sequence
 * (preflight → link → camera → bridge → sidecar → agent), the stop sequence
 * (disarm → agent → sidecar → bridge), the confirmed sidecar mode switch, and
 * the status every route reports.
 *
 * Hard rules, enforced in signal() and covered by tests:
 *   - a process the supervisor did not start is never signalled (adopt or leave it);
 *   - a sidecar is never SIGKILLed — SIGTERM ramps its arms down; a sidecar that
 *     does not exit is reported as `sidecar_hung` with the runbook;
 *   - an arm_sdk sidecar is never restarted automatically (no sidecar is);
 *   - starting and stopping never command motion or change the robot's mode.
 * @feature supervisor
 */

import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { connect } from 'node:net';
import { join } from 'node:path';
import { LogTailer } from './logs.js';
import {
  belongsTo,
  findListeners,
  findProcesses,
  logFilePath,
  pidFilePath,
  processSince,
  readAdoptable,
  readCmdline,
  readStat,
  recAlive,
  removePidFile,
  spawnChild,
  writePidFile,
} from './procs.js';
import type { ChildRecord } from './procs.js';
import {
  agentSpec,
  bridgeSpec,
  loadProfile,
  locoGateOf,
  ProfileError,
  sidecarEnvFor,
  sidecarSpec,
  simSpec,
} from './profile.js';
import type { Profile, ProcName, SidecarMode } from './profile.js';
import { SidecarClient } from './sidecarClient.js';
import type { SidecarHealth } from './sidecarClient.js';

export type StepId = 'preflight' | 'link' | 'camera' | 'bridge' | 'sidecar' | 'agent';
export type StepState = 'idle' | 'running' | 'ok' | 'warn' | 'failed' | 'foreign';
export type Overall = 'stopped' | 'starting' | 'ready' | 'degraded' | 'stopping' | 'error';
export type CheckValue = boolean | number | string | null;

export const STEP_IDS: StepId[] = ['preflight', 'link', 'camera', 'bridge', 'sidecar', 'agent'];
export const PROC_NAMES: ProcName[] = ['sim', 'bridge', 'sidecar', 'agent'];

export interface ForeignProcess {
  pid: number | null;
  cmdline: string[] | null;
  since: string | null;
  port: number;
}

export interface StepStatus {
  id: StepId;
  state: StepState;
  owned: boolean;
  pid: number | null;
  startedAt: string | null;
  detail: string | null;
  checks: Record<string, CheckValue>;
  /** Machine-readable reason for a failed/foreign/warn step, e.g. foreign_process, sidecar_hung. */
  code: string | null;
  /** Set while the step is `foreign`: the process holding its port. */
  foreign: ForeignProcess | null;
  /** What the operator may do about a foreign process. */
  actions: Array<'adopt' | 'leave'>;
}

export interface Status {
  robotId: string;
  profile: string;
  robot: 'real' | 'sim';
  sidecarMode: SidecarMode | null;
  overall: Overall;
  steps: StepStatus[];
  lastBase: { mode: string | null; fsmId: number | null } | null;
  at: string;
}

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export type RunFn = (
  cmd: string,
  args: string[],
  opts: { env?: Record<string, string>; cwd?: string; timeoutMs: number },
) => Promise<RunResult>;

export const runCommand: RunFn = (cmd, args, opts) =>
  new Promise((resolveRun) => {
    execFile(
      cmd,
      args,
      { env: opts.env, cwd: opts.cwd, timeout: opts.timeoutMs, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const raw = err ? (err as { code?: unknown }).code : 0;
        const code = typeof raw === 'number' ? raw : null;
        resolveRun({ code, stdout: String(stdout), stderr: String(stderr || (err ? err.message : '')) });
      },
    );
  });

export function tcpProbe(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolveProbe) => {
    const sock = connect({ host, port });
    const done = (ok: boolean) => {
      sock.removeAllListeners();
      sock.destroy();
      resolveProbe(ok);
    };
    sock.setTimeout(timeoutMs, () => done(false));
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
  });
}

export interface SupervisorDeps {
  clock?: Clock;
  /** Every signal goes through this. Default: process.kill, looked up at call time. */
  kill?: (pid: number, sig: NodeJS.Signals) => void;
  procRoot?: string;
  sysClassNet?: string;
  fetchImpl?: typeof fetch;
  run?: RunFn;
  tcpProbe?: (host: string, port: number, timeoutMs: number) => Promise<boolean>;
  netAddrs?: (iface: string) => string[];
  conflictPatterns?: string[];
  parentEnv?: NodeJS.ProcessEnv;
  log?: (msg: string) => void;
  /** Poll interval of the background liveness monitor (ms). */
  monitorMs?: number;
}

export interface SupervisorOptions {
  profilePath: string;
  repoRoot: string;
  stateDir: string;
  home?: string;
  deps?: SupervisorDeps;
}

export class SupervisorError extends Error {
  constructor(
    readonly httpStatus: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'SupervisorError';
  }
}

/** The runbook text for a sidecar that did not exit on SIGTERM. */
export const SIDECAR_HUNG_RUNBOOK =
  'The sidecar did not exit within 15 s of SIGTERM. The supervisor never SIGKILLs a sidecar ' +
  '(SIGTERM is what ramps the arms down). The arms return to Unitree after the dead-man disarm; ' +
  'the robot stays in whatever mode it is in. At the robot: make sure the gantry can take its ' +
  'weight; if the robot must go limp and NeoDEM cannot do it, use the power button with the gantry ' +
  'carrying the robot. Then find the process (see /status pid) and investigate before stopping it by hand.';

const DEFAULT_CONFLICTS = ['xr_teleoperate', 'teleop_hand_and_arm'];
const BACKOFF_MS = [1000, 2000, 4000];
const MAX_RESTARTS: Partial<Record<ProcName, number>> = { bridge: 3, agent: 1 };

function emptyStep(id: StepId): StepStatus {
  return { id, state: 'idle', owned: false, pid: null, startedAt: null, detail: null, checks: {}, code: null, foreign: null, actions: [] };
}

function exitText(rec: ChildRecord): string {
  if (rec.exitCode !== null) return `exit code ${rec.exitCode}`;
  if (rec.exitSignal) return `signal ${rec.exitSignal}`;
  return 'exited';
}

export class Supervisor {
  profile: Profile;
  readonly profilePath: string;
  private readonly repoRoot: string;
  private readonly stateDir: string;
  private readonly home?: string;
  private readonly clock: Clock;
  private readonly killFn: (pid: number, sig: NodeJS.Signals) => void;
  private readonly procRoot: string;
  private readonly sysClassNet: string;
  private readonly fetchImpl: typeof fetch;
  private readonly run: RunFn;
  private readonly tcp: (host: string, port: number, timeoutMs: number) => Promise<boolean>;
  private readonly netAddrs: (iface: string) => string[];
  private readonly conflicts: string[];
  private readonly parentEnv: NodeJS.ProcessEnv;
  private readonly log: (msg: string) => void;

  private readonly recs: Partial<Record<ProcName, ChildRecord>> = {};
  private readonly steps: Record<StepId, StepStatus>;
  private readonly tailers: Partial<Record<ProcName, LogTailer>> = {};
  private readonly leaveDecisions = new Set<StepId>();
  private readonly stopping = new Set<ProcName>();
  private readonly restarts: Partial<Record<ProcName, number>> = {};
  private busy: null | 'starting' | 'stopping' | 'switching' = null;
  private op: Promise<void> | null = null;
  private opToken: symbol | null = null;
  private abortRequested = false;
  private lastError: string | null = null;
  private lastBase: Status['lastBase'] = null;
  private monitor: NodeJS.Timeout | null = null;
  private readonly monitorMs: number;
  /** The liveness check in flight, including an automatic restart it is running. */
  private liveness: Promise<void> | null = null;
  /**
   * Bumped by every start and stop. An automatic restart remembers the value it
   * began with and gives up once it changes, so a restart scheduled before a
   * Stop never spawns anything after it.
   */
  private epoch = 0;

  constructor(opts: SupervisorOptions) {
    const d = opts.deps ?? {};
    this.profilePath = opts.profilePath;
    this.repoRoot = opts.repoRoot;
    this.stateDir = opts.stateDir;
    this.home = opts.home;
    this.clock = d.clock ?? realClock;
    this.killFn = d.kill ?? ((pid, sig) => { process.kill(pid, sig); });
    this.procRoot = d.procRoot ?? '/proc';
    this.sysClassNet = d.sysClassNet ?? '/sys/class/net';
    this.fetchImpl = d.fetchImpl ?? fetch;
    this.run = d.run ?? runCommand;
    this.tcp = d.tcpProbe ?? tcpProbe;
    this.netAddrs = d.netAddrs ?? ((iface) => (networkInterfaces()[iface] ?? []).map((a) => a.address));
    this.conflicts = d.conflictPatterns ?? DEFAULT_CONFLICTS;
    this.parentEnv = d.parentEnv ?? process.env;
    this.log = d.log ?? ((m) => console.log(`[supervisor] ${m}`));
    this.monitorMs = d.monitorMs ?? 1000;
    this.profile = loadProfile(this.profilePath, { repoRoot: this.repoRoot, home: this.home });
    this.steps = Object.fromEntries(STEP_IDS.map((id) => [id, emptyStep(id)])) as Record<StepId, StepStatus>;
  }

  // ------------------------------------------------------------- lifecycle

  /** Re-adopt children from their PID files, check them once, start the liveness monitor. */
  async init(): Promise<void> {
    for (const proc of PROC_NAMES) {
      const rec = readAdoptable(this.pidPath(proc), this.procRoot);
      if (!rec) continue;
      this.recs[proc] = rec;
      const step = this.steps[this.stepOf(proc)];
      Object.assign(step, {
        state: 'running', owned: rec.owned, pid: rec.pid, startedAt: rec.startedAt,
        detail: `re-adopted pid ${rec.pid} from its PID file — checking it`, code: null,
      });
      this.log(`re-adopted ${proc} pid ${rec.pid} (${rec.owned ? 'owned' : 'adopted, never signalled'})`);
    }
    await this.verifyAdopted();
    this.monitor = setInterval(() => {
      if (this.liveness) return;
      this.liveness = this.checkLiveness().finally(() => {
        this.liveness = null;
      });
    }, this.monitorMs);
    this.monitor.unref();
  }

  /** Stop timers and log tailers. Children are left exactly as they are. */
  detach(): void {
    if (this.monitor) clearInterval(this.monitor);
    this.monitor = null;
    for (const t of Object.values(this.tailers)) t?.stop();
  }

  /** Resolves when the current start/stop/switch has finished. */
  async waitIdle(): Promise<void> {
    while (this.op) await this.op;
  }

  // ---------------------------------------------------------------- status

  status(): Status {
    const steps = STEP_IDS.map((id) => {
      const s = { ...this.steps[id], checks: { ...this.steps[id].checks } };
      const proc = this.procOf(id);
      const rec = proc ? this.recs[proc] : undefined;
      if (rec && s.state !== 'foreign') {
        s.owned = rec.owned;
        s.pid = rec.pid;
        s.startedAt = rec.startedAt;
      }
      return s;
    });
    const sc = this.recs.sidecar;
    return {
      robotId: this.profile.robotId,
      profile: this.profilePath,
      robot: this.profile.robot,
      sidecarMode: sc && recAlive(sc, this.procRoot) ? sc.mode : null,
      overall: this.overall(),
      steps,
      lastBase: this.lastBase,
      at: new Date().toISOString(),
    };
  }

  private overall(): Overall {
    if (this.busy === 'stopping') return 'stopping';
    if (this.busy) return 'starting';
    if (this.lastError) return 'error';
    const needed = this.neededProcs();
    const alive = needed.filter((p) => {
      const r = this.recs[p];
      return r !== undefined && recAlive(r, this.procRoot);
    });
    if (alive.length === 0) return 'stopped';
    const okStates: StepState[] = ['ok', 'warn'];
    const allReady = alive.length === needed.length
      && needed.every((p) => okStates.includes(this.steps[this.stepOf(p)].state))
      && okStates.includes(this.steps.preflight.state);
    return allReady ? 'ready' : 'degraded';
  }

  private neededProcs(): ProcName[] {
    return this.profile.robot === 'sim' ? ['sim', 'bridge', 'sidecar', 'agent'] : ['bridge', 'sidecar', 'agent'];
  }

  // ------------------------------------------------------------ operations

  start(mode: SidecarMode = 'read_only'): void {
    if (mode !== 'read_only' && mode !== 'arm_sdk') {
      throw new SupervisorError(400, 'bad_mode', `mode must be read_only or arm_sdk, got ${JSON.stringify(mode)}`);
    }
    if (this.busy) throw new SupervisorError(409, 'busy', `the supervisor is ${this.busy} — wait for it to finish`);
    this.beginOp('starting', () => this.runStart(mode));
  }

  /** Stop everything this supervisor started. Aborts a start in progress first. */
  stop(): void {
    if (this.busy === 'stopping') return;
    if (this.busy === 'switching') {
      throw new SupervisorError(409, 'busy', 'a sidecar mode switch is in progress — wait for it to finish');
    }
    const running = this.op;
    if (running) this.abortRequested = true;
    this.beginOp('stopping', async () => {
      if (running) await running.catch(() => undefined);
      this.abortRequested = false;
      // The aborted start recorded "aborted by stop"; that is not an error of
      // this stop. runStop sets lastError again if it cannot stop something.
      this.lastError = null;
      await this.runStop();
    }, true);
  }

  private beginOp(kind: 'starting' | 'stopping' | 'switching', fn: () => Promise<void>, force = false): void {
    if (this.busy && !force) throw new SupervisorError(409, 'busy', `the supervisor is ${this.busy}`);
    this.busy = kind;
    this.lastError = null;
    // A start or stop owns every child from here on: cancel any automatic
    // restart and wait until it has let go, so the two never spawn or stop
    // the same process. A mode switch only touches the sidecar, which is
    // never restarted automatically.
    const owns = kind !== 'switching';
    if (owns) this.epoch++;
    const token = Symbol(kind);
    this.opToken = token;
    this.op = (async () => {
      try {
        if (owns) await this.settleLiveness();
        await fn();
      } catch (e) {
        this.lastError = (e as Error).message;
        this.log(`${kind} failed: ${(e as Error).message}`);
      } finally {
        if (this.opToken === token) {
          this.op = null;
          this.opToken = null;
          this.busy = null;
        }
      }
    })();
  }

  async switchSidecarMode(mode: SidecarMode, confirm: boolean): Promise<void> {
    if (mode !== 'read_only' && mode !== 'arm_sdk') {
      throw new SupervisorError(400, 'bad_mode', `mode must be read_only or arm_sdk, got ${JSON.stringify(mode)}`);
    }
    if (confirm !== true) {
      throw new SupervisorError(400, 'confirm_required', 'a sidecar mode switch needs {"confirm": true}');
    }
    if (this.busy) throw new SupervisorError(409, 'busy', `the supervisor is ${this.busy}`);
    const rec = this.recs.sidecar;
    if (!rec || !recAlive(rec, this.procRoot)) {
      throw new SupervisorError(409, 'no_sidecar', 'no sidecar is running — start the robot side first');
    }
    if (!rec.owned) {
      throw new SupervisorError(409, 'not_owned', `the sidecar (pid ${rec.pid}) was not started by the supervisor, so it cannot restart it`);
    }
    const h = await this.sidecar().health();
    if (!h) throw new SupervisorError(409, 'sidecar_unreachable', 'the sidecar does not answer /health');
    if (h.armed === true || (typeof h.arm_weight === 'number' && h.arm_weight !== 0)) {
      throw new SupervisorError(409, 'armed', 'the arms are armed — release the grip (disarm) before switching the sidecar mode');
    }
    if (rec.mode === mode) return;
    if (mode === 'arm_sdk') {
      const c = this.conflictDetail();
      if (c) throw new SupervisorError(409, 'conflict_xr_teleoperate', c);
    }
    this.beginOp('switching', async () => {
      const stopped = await this.stopProc('sidecar', { disarm: true });
      if (!stopped) {
        this.lastError = `sidecar: ${this.steps.sidecar.detail}`;
        return;
      }
      if (!(await this.stepSidecar(mode))) {
        this.lastError = `sidecar: ${this.steps.sidecar.detail}`;
        return;
      }
      // No mode comparison across the switch: a read_only sidecar without mode
      // control reads the robot's mode as "unknown", the arm_sdk one measures it.
      const unsafe = await this.assertSafe(undefined, true);
      if (unsafe) await this.safetyAbort('sidecar', unsafe);
    });
  }

  adopt(id: StepId): StepStatus {
    const step = this.steps[id];
    const proc = this.procOf(id);
    if (!proc || step.state !== 'foreign' || !step.foreign) {
      throw new SupervisorError(409, 'not_foreign', `step ${id} has no foreign process to adopt`);
    }
    const pid = step.foreign.pid;
    if (pid === null || pid <= 0) {
      throw new SupervisorError(409, 'unknown_pid', `the process holding :${step.foreign.port} cannot be identified (another user's?) — it cannot be adopted`);
    }
    const st = readStat(pid, this.procRoot);
    const cmdline = readCmdline(pid, this.procRoot);
    if (!st || !cmdline) throw new SupervisorError(409, 'gone', `pid ${pid} is gone — start again`);
    const rec: ChildRecord = {
      proc, pid, startTime: st.startTime, cmdline, argv: [], owned: false, mode: null,
      startedAt: step.foreign.since ?? new Date().toISOString(), logPath: '',
      exited: false, exitCode: null, exitSignal: null,
    };
    this.recs[proc] = rec;
    writePidFile(this.pidPath(proc), rec);
    this.leaveDecisions.delete(id);
    Object.assign(step, {
      state: 'idle', owned: false, pid, foreign: null, actions: [], code: 'adopted',
      detail: `adopted pid ${pid} (${cmdline.join(' ').slice(0, 160)}) — the supervisor uses it but never signals it; start again to check it`,
    });
    return { ...step };
  }

  leave(id: StepId): StepStatus {
    const step = this.steps[id];
    if (step.state !== 'foreign' || !step.foreign) {
      throw new SupervisorError(409, 'not_foreign', `step ${id} has no foreign process to leave`);
    }
    this.leaveDecisions.add(id);
    step.actions = [];
    step.detail = `left alone at your request: pid ${step.foreign.pid ?? '?'} keeps :${step.foreign.port}. ` +
      'The supervisor will not touch it, and cannot run this step until that process is gone.';
    return { ...step };
  }

  /** Last resort: forward to the sidecar's own /estop, whoever started it. Never blocked by a running operation. */
  async estop(): Promise<{ status: number; body: Record<string, unknown> }> {
    try {
      return await this.sidecar().estop();
    } catch (e) {
      return { status: 503, body: { ok: false, error: `no sidecar answers on :${this.profile.ports.sidecar} (${(e as Error).message})` } };
    }
  }

  async lanUp(): Promise<RunResult & { ok: boolean }> {
    if (this.profile.robot !== 'real' || !this.profile.nmProfile) {
      throw new SupervisorError(409, 'no_lan_profile', 'this profile has no NetworkManager profile (nmProfile) to bring up');
    }
    const r = await this.run('nmcli', ['con', 'up', this.profile.nmProfile], { timeoutMs: 30_000 });
    return { ...r, ok: r.code === 0 };
  }

  logTail(proc: ProcName, n: number): string[] {
    return this.tailer(proc).tail(n);
  }

  subscribeLogs(proc: ProcName, fn: (line: string) => void): () => void {
    return this.tailer(proc).subscribe(fn);
  }

  // ---------------------------------------------------------- start sequence

  private async runStart(mode: SidecarMode): Promise<void> {
    // An explicit start is a fresh budget for the automatic restarts.
    for (const p of PROC_NAMES) delete this.restarts[p];
    for (const id of STEP_IDS) {
      const proc = this.procOf(id);
      const rec = proc ? this.recs[proc] : undefined;
      const s = this.steps[id];
      if (s.state === 'foreign') continue;
      if (!rec || !recAlive(rec, this.procRoot)) Object.assign(this.steps[id], emptyStep(id));
    }
    if (!(await this.stepPreflight(mode))) return this.fail('preflight');
    const sequence: Array<[StepId, () => Promise<boolean>]> = [
      ['link', () => this.stepLink()],
      ['camera', () => this.stepCamera()],
      ['bridge', () => this.stepBridge()],
      ['sidecar', () => this.stepSidecar(mode)],
      ['agent', () => this.stepAgent()],
    ];
    for (const [id, run] of sequence) {
      if (this.abortRequested) return this.fail(id, 'aborted by stop');
      const before = await this.baseModeNow();
      if (!(await run())) return this.fail(id);
      const unsafe = await this.assertSafe(before, id === 'sidecar');
      if (unsafe) return this.safetyAbort(id, unsafe);
    }
  }

  private fail(id: StepId, detail?: string): void {
    const s = this.steps[id];
    if (detail) {
      s.state = 'failed';
      s.detail = detail;
    }
    this.lastError = `${id}: ${s.detail ?? 'failed'}`;
  }

  private async safetyAbort(id: StepId, why: string): Promise<void> {
    const s = this.steps[id];
    const proc = this.procOf(id);
    const owned = proc ? this.recs[proc]?.owned !== false : true;
    const stopped = proc ? await this.stopProc(proc, { disarm: proc === 'sidecar', keepStep: true }) : true;
    if (s.code !== 'sidecar_hung') {
      s.state = 'failed';
      s.code = 'safety_abort';
      let what = '.';
      if (proc && !owned) what = ` and the ${proc} was left running (not started by the supervisor).`;
      else if (proc) what = stopped ? ` and the ${proc} was stopped.` : ` but the ${proc} is still running.`;
      s.detail = `safety check failed after this step: ${why}. The sequence stopped${what}`;
    }
    this.lastError = `${id}: ${s.detail}`;
  }

  private async stepPreflight(mode: SidecarMode): Promise<boolean> {
    const s = this.steps.preflight;
    Object.assign(s, { state: 'running', detail: 'checking profile, ports and conflicting processes', checks: {}, code: null });
    try {
      this.profile = loadProfile(this.profilePath, { repoRoot: this.repoRoot, home: this.home });
      s.checks.profile = true;
    } catch (e) {
      s.checks.profile = false;
      return this.failStep(s, 'profile_invalid', e instanceof ProfileError ? e.message : String(e));
    }
    const sc = this.recs.sidecar;
    if (sc && recAlive(sc, this.procRoot) && sc.owned && sc.mode && sc.mode !== mode) {
      return this.failStep(s, 'mode_mismatch',
        `the sidecar is running in ${sc.mode}; start does not switch modes — use the confirmed sidecar mode switch`);
    }
    let foreign: string[] = [];
    for (const [id, proc, port] of this.portList()) {
      const verdict = this.portVerdict(id, proc, port);
      s.checks[`port_${port}`] = verdict;
      if (verdict === 'foreign') foreign.push(`:${port} (${id})`);
    }
    if (mode === 'arm_sdk') {
      const c = this.conflictDetail();
      s.checks.xr_teleoperate = c !== null;
      if (c) return this.failStep(s, 'conflict_xr_teleoperate', c);
    }
    if (foreign.length) {
      foreign = [...new Set(foreign)];
      return this.failStep(s, 'foreign_process',
        `a process the supervisor did not start holds ${foreign.join(', ')}. It is never killed: adopt it ` +
        '(use it as is) or leave it and stop it by hand, then start again.');
    }
    s.state = 'ok';
    s.detail = `profile ${this.profile.robotId} (${this.profile.robot}), ports free or ours, mode ${mode}`;
    return true;
  }

  private portList(): Array<[StepId, ProcName, number]> {
    const p = this.profile.ports;
    const list: Array<[StepId, ProcName, number]> = [];
    if (this.profile.robot === 'sim' && p.simHttp !== null) list.push(['link', 'sim', p.simHttp]);
    list.push(['bridge', 'bridge', p.bridge], ['sidecar', 'sidecar', p.sidecar], ['agent', 'agent', p.agent]);
    return list;
  }

  /** free | ours | foreign — and marks the step foreign when it is. Never signals anything. */
  private portVerdict(id: StepId, proc: ProcName, port: number): 'free' | 'ours' | 'foreign' {
    const holders = findListeners(port, this.procRoot);
    const step = this.steps[id];
    if (holders.length === 0) {
      if (step.state === 'foreign') Object.assign(step, emptyStep(id));
      this.leaveDecisions.delete(id);
      return 'free';
    }
    const rec = this.recs[proc];
    if (rec && recAlive(rec, this.procRoot) && holders.every((h) => h > 0 && belongsTo(h, rec.pid, this.procRoot))) {
      return 'ours';
    }
    const pid = holders.find((h) => h > 0) ?? null;
    const left = this.leaveDecisions.has(id);
    Object.assign(step, {
      state: 'foreign',
      owned: false,
      pid,
      startedAt: null,
      code: 'foreign_process',
      foreign: {
        pid,
        cmdline: pid ? readCmdline(pid, this.procRoot) : null,
        since: pid ? processSince(pid, this.procRoot) : null,
        port,
      },
      actions: left ? [] : ['adopt', 'leave'],
      detail: left
        ? `left alone at your request: pid ${pid ?? '?'} keeps :${port}; this step cannot run until it is gone`
        : `pid ${pid ?? '?'} holds :${port} and was not started by the supervisor — adopt it or leave it (it is never killed)`,
    });
    return 'foreign';
  }

  private conflictDetail(): string | null {
    const found = findProcesses(this.conflicts, this.procRoot, [process.pid]);
    if (found.length === 0) return null;
    const f = found[0];
    return `xr_teleoperate is running (pid ${f.pid}: ${f.cmdline.join(' ').slice(0, 120)}). It drives the arms ` +
      'itself; running it together with the arm_sdk sidecar is forbidden. Quit it first.';
  }

  private failStep(s: StepStatus, code: string, detail: string): false {
    s.state = 'failed';
    s.code = code;
    s.detail = detail;
    return false;
  }

  private async stepLink(): Promise<boolean> {
    const s = this.steps.link;
    Object.assign(s, { state: 'running', checks: {}, code: null, detail: null });
    if (this.profile.robot === 'sim') return this.stepSim(s);
    const iface = this.profile.iface;
    const read = (f: string): string | null => {
      try {
        return readFileSync(join(this.sysClassNet, iface, f), 'utf8').trim();
      } catch {
        return null;
      }
    };
    const operstate = read('operstate');
    if (operstate === null) {
      s.checks.iface = false;
      return this.failStep(s, 'no_iface', `network interface ${iface} does not exist on this machine`);
    }
    const carrier = read('carrier') === '1';
    s.checks.carrier = carrier;
    s.checks.operstate = operstate;
    if (!carrier || operstate !== 'up') {
      return this.failStep(s, 'no_carrier', `robot cable unplugged or robot off (${iface}: no carrier, operstate ${operstate})`);
    }
    const want = (this.profile.hostIp ?? '').split('/')[0];
    const hasIp = this.netAddrs(iface).includes(want);
    s.checks.hostIp = hasIp;
    if (!hasIp) {
      return this.failStep(s, 'no_host_ip',
        `${iface} does not have ${this.profile.hostIp}` +
        (this.profile.nmProfile ? ` — bring the robot LAN up (POST /lan/up runs nmcli con up ${this.profile.nmProfile})` : ''));
    }
    const ip = this.profile.robotIp as string;
    const ping = await this.run('ping', ['-c1', '-W1', ip], { timeoutMs: 5000 });
    s.checks.ping = ping.code === 0;
    if (ping.code !== 0) {
      return this.failStep(s, 'no_ping', `the robot does not answer a ping at ${ip} — is it powered on?`);
    }
    s.state = 'ok';
    s.detail = `${iface} up with ${this.profile.hostIp}; the robot answers at ${ip}`;
    return true;
  }

  /** Sim profiles: the "link" is the simulated robot itself. */
  private async stepSim(s: StepStatus): Promise<boolean> {
    let rec = this.recs.sim;
    if (!rec || !recAlive(rec, this.procRoot)) {
      rec = await this.spawn('sim', simSpec(this.profile, this.parentEnv));
    }
    s.detail = `simulator pid ${rec.pid} on DDS domain ${this.profile.ddsDomain} / ${this.profile.iface}`;
    const port = this.profile.ports.simHttp;
    const deadline = this.clock.now() + this.profile.timeouts.simS * 1000;
    while (true) {
      if (!recAlive(rec, this.procRoot)) {
        return this.failStep(s, 'sim_exited', `the simulator exited (${exitText(rec)}): ${this.tailText('sim')}`);
      }
      if (port === null) {
        s.checks.sim = true;
        break;
      }
      const ok = await this.httpOk(`http://127.0.0.1:${port}/health`);
      s.checks.simHealth = ok;
      if (ok) break;
      if (this.abortRequested) return this.failStep(s, 'aborted', 'aborted by stop');
      if (this.clock.now() >= deadline) {
        return this.failStep(s, 'sim_timeout', `the simulator did not answer /health on :${port} within ${this.profile.timeouts.simS} s`);
      }
      await this.clock.sleep(500);
    }
    s.state = 'ok';
    return true;
  }

  private async stepCamera(): Promise<boolean> {
    const s = this.steps.camera;
    Object.assign(s, { checks: {}, code: null });
    const cam = this.profile.pc2Camera;
    if (!cam) {
      Object.assign(s, { state: 'idle', detail: 'no PC2 camera in this profile' });
      return true;
    }
    s.state = 'running';
    const ok = await this.tcp(cam.host, cam.port, 1000);
    s.checks.tcp = ok;
    if (ok) {
      Object.assign(s, { state: 'ok', detail: `PC2 camera answers at ${cam.host}:${cam.port}` });
    } else {
      Object.assign(s, {
        state: 'warn', code: 'camera_unreachable',
        detail: `PC2 camera at ${cam.host}:${cam.port} does not answer — the head camera will be missing ` +
          '(g1-head-cam.service on PC2). The robot side starts without it.',
      });
    }
    return true; // a warning, never a stop
  }

  private async bridgeSupportsBind(): Promise<boolean> {
    const env = bridgeSpec(this.profile, false, this.parentEnv).env;
    const r = await this.run(this.profile.python, [this.profile.bridge.script, '--help'], { env, timeoutMs: 30_000 });
    return r.code === 0 && /--bind\b/.test(r.stdout);
  }

  private async probeBridge(): Promise<{ lowstate: boolean; dex3Left: boolean; dex3Right: boolean; error: string | null }> {
    const env = bridgeSpec(this.profile, false, this.parentEnv).env;
    const r = await this.run(this.profile.python,
      [this.profile.bridge.probe, '--endpoint', `tcp://127.0.0.1:${this.profile.ports.bridge}`, '--timeout', '3'],
      { env, timeoutMs: 10_000 });
    const last = r.stdout.trim().split('\n').pop() ?? '';
    try {
      const j = JSON.parse(last) as { lowstate?: boolean; dex3?: { left?: boolean; right?: boolean }; error?: string };
      return { lowstate: j.lowstate === true, dex3Left: j.dex3?.left === true, dex3Right: j.dex3?.right === true, error: j.error ?? null };
    } catch {
      return { lowstate: false, dex3Left: false, dex3Right: false, error: (r.stderr || r.stdout).trim().slice(-300) || `probe exit ${r.code}` };
    }
  }

  private async stepBridge(): Promise<boolean> {
    const s = this.steps.bridge;
    Object.assign(s, { state: 'running', checks: {}, code: null, detail: null, foreign: null, actions: [] });
    let rec = this.recs.bridge;
    if (!rec || !recAlive(rec, this.procRoot)) {
      const bind = await this.bridgeSupportsBind();
      s.checks.bind = bind;
      rec = await this.spawn('bridge', bridgeSpec(this.profile, bind, this.parentEnv));
    }
    s.detail = `waiting for rt/lowstate on :${this.profile.ports.bridge}`;
    const ok = await this.bridgeReady(s, rec, this.profile.timeouts.bridgeS);
    return ok;
  }

  private async bridgeReady(s: StepStatus, rec: ChildRecord, timeoutS: number, cancelled: () => boolean = () => false): Promise<boolean> {
    const deadline = this.clock.now() + timeoutS * 1000;
    let lastErr: string | null = null;
    while (true) {
      if (!recAlive(rec, this.procRoot)) {
        return this.failStep(s, 'bridge_exited', `the bridge exited (${exitText(rec)}) before publishing rt/lowstate: ${this.tailText('bridge')}`);
      }
      const p = await this.probeBridge();
      s.checks.lowstate = p.lowstate;
      s.checks.dex3Left = p.dex3Left;
      s.checks.dex3Right = p.dex3Right;
      if (p.lowstate) {
        s.state = 'ok';
        const hands = [p.dex3Left ? 'left' : null, p.dex3Right ? 'right' : null].filter(Boolean);
        s.detail = `rt/lowstate on :${this.profile.ports.bridge}; Dex3 hands seen: ${hands.length ? hands.join(' + ') : 'none'}`;
        return true;
      }
      lastErr = p.error;
      if (this.abortRequested || cancelled()) return this.failStep(s, 'aborted', 'aborted by stop');
      if (this.clock.now() >= deadline) {
        return this.failStep(s, 'no_lowstate',
          `no rt/lowstate on :${this.profile.ports.bridge} within ${timeoutS} s — robot off, wrong interface or DDS domain ` +
          `${this.profile.ddsDomain}?${lastErr ? ` (probe: ${lastErr})` : ''}`);
      }
      await this.clock.sleep(250);
    }
  }

  async stepSidecar(mode: SidecarMode): Promise<boolean> {
    const s = this.steps.sidecar;
    Object.assign(s, { state: 'running', checks: {}, code: null, detail: null, foreign: null, actions: [] });
    let rec = this.recs.sidecar;
    if (!rec || !recAlive(rec, this.procRoot)) {
      rec = await this.spawn('sidecar', sidecarSpec(this.profile, mode, this.parentEnv));
    }
    const env = sidecarEnvFor(this.profile, mode, this.parentEnv);
    const gate = locoGateOf(env);
    const domain = this.profile.ddsDomain;
    s.detail = `waiting for /health on :${this.profile.ports.sidecar} (${mode}, loco gate ${gate})`;
    const deadline = this.clock.now() + this.profile.timeouts.sidecarS * 1000;
    let why = 'no answer on /health';
    while (true) {
      if (!recAlive(rec, this.procRoot)) return this.sidecarExited(s, rec);
      const h = await this.sidecar().health();
      if (h) {
        this.noteBase(h);
        const age = h.base?.age_s;
        Object.assign(s.checks, {
          connected: h.connected === true,
          write_mode: h.write_mode ?? null,
          dds_domain: h.dds_domain ?? null,
          gate: h.loco?.gate ?? null,
          base_age_s: typeof age === 'number' ? age : null,
          armed: h.armed ?? null,
          arm_weight: typeof h.arm_weight === 'number' ? h.arm_weight : null,
        });
        if (h.write_mode !== undefined && h.write_mode !== mode) {
          return this.failStep(s, 'mode_mismatch', `the sidecar on :${this.profile.ports.sidecar} runs ${h.write_mode}, expected ${mode}`);
        }
        if (typeof h.dds_domain === 'number' && h.dds_domain !== domain) {
          await this.stopProc('sidecar', { disarm: true, keepStep: true });
          return this.failStep(s, 'domain_mismatch', `the sidecar reports DDS domain ${h.dds_domain}, the profile says ${domain} — stopped it`);
        }
        if (rec.mode === null && rec.owned === false) rec.mode = h.write_mode === 'arm_sdk' ? 'arm_sdk' : 'read_only';
        const ready = h.connected === true
          && (h.loco?.gate ?? 'off') === gate
          && (gate !== 'fsm' || (typeof age === 'number' && age < 1.5));
        if (ready) {
          s.state = 'ok';
          s.detail = `${mode}, connected, loco gate ${gate}` + (gate === 'fsm' ? `, robot mode ${h.base?.mode ?? 'unknown'}` : '');
          return true;
        }
        why = h.connected !== true
          ? 'connected:false — no rt/lowstate from the bridge yet'
          : (h.loco?.gate ?? 'off') !== gate
            ? `loco gate ${h.loco?.gate ?? 'off'}, expected ${gate}`
            : `no fresh robot mode (base.age_s ${age ?? 'null'})`;
      }
      if (this.abortRequested) return this.failStep(s, 'aborted', 'aborted by stop');
      if (this.clock.now() >= deadline) {
        return this.failStep(s, 'sidecar_not_ready', `the sidecar was not ready within ${this.profile.timeouts.sidecarS} s: ${why}`);
      }
      await this.clock.sleep(500);
    }
  }

  private sidecarExited(s: StepStatus, rec: ChildRecord): false {
    const tail = this.tailText('sidecar');
    if (rec.exitCode === 2) {
      return this.failStep(s, 'sidecar_config_refused', `the sidecar refused its configuration (exit 2): ${tail}`);
    }
    if (rec.exitCode === 3) {
      return this.failStep(s, 'dds_iface',
        `DDS could not open ${this.profile.iface} (no carrier?) — the sidecar exited 3: ${tail}`);
    }
    return this.failStep(s, 'sidecar_exited', `the sidecar exited (${exitText(rec)}): ${tail}`);
  }

  private async stepAgent(): Promise<boolean> {
    const s = this.steps.agent;
    Object.assign(s, { state: 'running', checks: {}, code: null, detail: null, foreign: null, actions: [] });
    let rec = this.recs.agent;
    if (!rec || !recAlive(rec, this.procRoot)) {
      rec = await this.spawn('agent', agentSpec(this.profile, this.parentEnv));
    }
    return this.agentReady(s, rec, this.profile.timeouts.agentS);
  }

  private async agentReady(s: StepStatus, rec: ChildRecord, timeoutS: number, cancelled: () => boolean = () => false): Promise<boolean> {
    const url = `http://127.0.0.1:${this.profile.ports.agent}/api/v1/health`;
    s.detail = `waiting for ${url}`;
    const deadline = this.clock.now() + timeoutS * 1000;
    while (true) {
      if (!recAlive(rec, this.procRoot)) {
        return this.failStep(s, 'agent_exited', `the agent exited (${exitText(rec)}): ${this.tailText('agent')}`);
      }
      const body = await this.getJson(url);
      s.checks.health = typeof body?.status === 'string' ? body.status : null;
      if (body?.status === 'healthy') {
        s.state = 'ok';
        s.detail = `healthy on :${this.profile.ports.agent}`;
        return true;
      }
      if (this.abortRequested || cancelled()) return this.failStep(s, 'aborted', 'aborted by stop');
      if (this.clock.now() >= deadline) {
        return this.failStep(s, 'agent_not_ready', `the agent was not healthy within ${timeoutS} s on ${url}`);
      }
      await this.clock.sleep(500);
    }
  }

  // ---------------------------------------------------------------- safety

  private async baseModeNow(): Promise<string | undefined> {
    const rec = this.recs.sidecar;
    if (!rec || !recAlive(rec, this.procRoot)) return undefined;
    const h = await this.sidecar().health();
    if (!h) return undefined;
    this.noteBase(h);
    return h.base?.mode ?? 'unknown';
  }

  /** null when safe, else why not. Reads the sidecar; skipped while there is none. */
  private async assertSafe(before: string | undefined, sidecarRequired: boolean): Promise<string | null> {
    const rec = this.recs.sidecar;
    if (!rec || !recAlive(rec, this.procRoot)) return sidecarRequired ? 'the sidecar is gone' : null;
    const h = await this.sidecar().health();
    if (!h) return 'the sidecar did not answer /health';
    this.noteBase(h);
    if (h.armed === true) return 'the sidecar reports armed:true (nothing in a start may arm the arms)';
    if (typeof h.arm_weight === 'number' && h.arm_weight !== 0) return `the sidecar reports arm_weight ${h.arm_weight}, expected 0`;
    const now = h.base?.mode ?? 'unknown';
    if (before !== undefined && now !== before) {
      return `the robot's mode changed from ${before} to ${now} during the step`;
    }
    return null;
  }

  private noteBase(h: SidecarHealth): void {
    if (h.base) this.lastBase = { mode: h.base.mode ?? null, fsmId: h.base.fsm_id ?? null };
  }

  // ----------------------------------------------------------- stop sequence

  private async runStop(): Promise<void> {
    // 1. disarm, and wait for the weight to reach 0 (5 s at most)
    const sc = this.recs.sidecar;
    if (sc && recAlive(sc, this.procRoot)) await this.disarmAndWait();
    // 2. agent, 3. sidecar, 4. bridge, then the simulator
    if (!(await this.stopProc('agent'))) return;
    if (!(await this.stopProc('sidecar', { disarm: false }))) {
      this.lastError = `sidecar: ${this.steps.sidecar.detail}`;
      return; // leave the bridge up: its state feed is what the operator looks at now
    }
    if (!(await this.stopProc('bridge'))) {
      this.lastError = `bridge: ${this.steps.bridge.detail}`;
      return;
    }
    if (this.profile.robot === 'sim') await this.stopProc('sim');
    for (const id of ['preflight', 'camera'] as StepId[]) {
      if (this.steps[id].state !== 'foreign') Object.assign(this.steps[id], emptyStep(id));
    }
    if (this.profile.robot !== 'sim' && this.steps.link.state !== 'foreign') Object.assign(this.steps.link, emptyStep('link'));
  }

  private async disarmAndWait(): Promise<boolean> {
    const client = this.sidecar();
    try {
      await client.disarm();
    } catch {
      /* reported below through the weight check */
    }
    const deadline = this.clock.now() + 5000;
    while (true) {
      const h = await client.health();
      if (h) this.noteBase(h);
      if (h && (h.arm_weight ?? 0) === 0 && h.armed !== true) return true;
      if (this.clock.now() >= deadline) {
        this.log('disarm: arm_weight did not reach 0 within 5 s — continuing; SIGTERM ramps it down as well');
        return false;
      }
      await this.clock.sleep(100);
    }
  }

  private async waitExit(rec: ChildRecord, ms: number): Promise<boolean> {
    const deadline = this.clock.now() + ms;
    while (recAlive(rec, this.procRoot)) {
      if (this.clock.now() >= deadline) return false;
      await this.clock.sleep(100);
    }
    return true;
  }

  /**
   * Stop one child the supervisor owns. Returns false only when it is still
   * running afterwards (sidecar_hung, a bridge that ignores SIGINT and SIGTERM).
   */
  private async stopProc(proc: ProcName, opts: { disarm?: boolean; keepStep?: boolean } = {}): Promise<boolean> {
    const rec = this.recs[proc];
    const step = this.steps[this.stepOf(proc)];
    if (!rec) return true;
    if (!rec.owned) {
      // Adopted, never ours to stop: forget it and say so.
      delete this.recs[proc];
      removePidFile(this.pidPath(proc));
      if (!opts.keepStep) {
        Object.assign(step, emptyStep(step.id), {
          detail: `left running: pid ${rec.pid} was not started by the supervisor, so stop never signals it`,
          code: 'left_running',
        });
      }
      return true;
    }
    if (recAlive(rec, this.procRoot)) {
      this.stopping.add(proc);
      try {
        if (!opts.keepStep) {
          step.state = 'running';
          step.detail = `stopping pid ${rec.pid}`;
        }
        let gone = false;
        if (proc === 'agent') {
          this.signal(rec, 'SIGTERM', true);
          gone = await this.waitExit(rec, 10_000);
          if (!gone) {
            this.signal(rec, 'SIGKILL', true); // the agent has no motor path
            gone = await this.waitExit(rec, 3000);
          }
        } else if (proc === 'sidecar') {
          if (opts.disarm) await this.disarmAndWait();
          this.signal(rec, 'SIGTERM', false);
          gone = await this.waitExit(rec, 15_000);
          if (!gone) {
            Object.assign(step, { state: 'failed', code: 'sidecar_hung', detail: SIDECAR_HUNG_RUNBOOK });
            this.log(`sidecar pid ${rec.pid} did not exit within 15 s of SIGTERM — sidecar_hung, NOT killed`);
            return false;
          }
        } else if (proc === 'bridge') {
          this.signal(rec, 'SIGINT', true); // the bridge stops cleanly on KeyboardInterrupt
          gone = await this.waitExit(rec, 5000);
          if (!gone) {
            this.signal(rec, 'SIGTERM', true);
            gone = await this.waitExit(rec, 5000);
          }
          if (!gone) {
            Object.assign(step, { state: 'failed', code: 'bridge_hung', detail: `the bridge (pid ${rec.pid}) ignored SIGINT and SIGTERM` });
            return false;
          }
        } else {
          this.signal(rec, 'SIGINT', true);
          gone = await this.waitExit(rec, 5000);
          if (!gone) {
            this.signal(rec, 'SIGTERM', true);
            gone = await this.waitExit(rec, 5000);
          }
          if (!gone) {
            this.signal(rec, 'SIGKILL', true); // the simulator is not a sidecar and moves nothing real
            gone = await this.waitExit(rec, 3000);
          }
          if (!gone) return false;
        }
      } finally {
        this.stopping.delete(proc);
      }
    }
    delete this.recs[proc];
    removePidFile(this.pidPath(proc));
    if (!opts.keepStep) Object.assign(step, emptyStep(step.id), { detail: `stopped (${exitText(rec)})` });
    return true;
  }

  /**
   * The ONLY place a signal is sent. Refuses a process the supervisor did not
   * start, refuses SIGKILL for a sidecar, and re-checks the PID's identity so a
   * recycled PID is never hit.
   */
  private signal(rec: ChildRecord, sig: NodeJS.Signals, group: boolean): boolean {
    if (!rec.owned) {
      this.log(`refusing to signal ${rec.proc} pid ${rec.pid}: not started by the supervisor`);
      return false;
    }
    if (rec.proc === 'sidecar' && sig === 'SIGKILL') {
      this.log(`refusing to SIGKILL sidecar pid ${rec.pid}: a sidecar is only ever sent SIGTERM`);
      return false;
    }
    if (!recAlive(rec, this.procRoot)) return false;
    try {
      this.log(`${sig} -> ${rec.proc} pid ${rec.pid}${group ? ' (process group)' : ''}`);
      this.killFn(group ? -rec.pid : rec.pid, sig);
      return true;
    } catch (e) {
      this.log(`signal ${sig} to ${rec.proc} pid ${rec.pid} failed: ${(e as Error).message}`);
      return false;
    }
  }

  // ---------------------------------------------------------- liveness

  private async checkLiveness(): Promise<void> {
    for (const proc of PROC_NAMES) {
      const rec = this.recs[proc];
      if (!rec || this.stopping.has(proc) || recAlive(rec, this.procRoot)) continue;
      const step = this.steps[this.stepOf(proc)];
      if (step.state !== 'ok' && step.state !== 'warn') continue; // a step in progress handles its own child
      await this.onUnexpectedExit(proc, rec, step);
    }
  }

  /** Wait until no liveness check (and no automatic restart) is running. */
  private async settleLiveness(): Promise<void> {
    while (this.liveness) await this.liveness.catch(() => undefined);
  }

  private async onUnexpectedExit(proc: ProcName, rec: ChildRecord, step: StepStatus): Promise<void> {
    delete this.recs[proc];
    removePidFile(this.pidPath(proc));
    const why = `${proc} (pid ${rec.pid}) exited unexpectedly (${exitText(rec)})`;
    this.log(why);
    const used = this.restarts[proc] ?? 0;
    const max = rec.owned ? (MAX_RESTARTS[proc] ?? 0) : 0;
    if (used >= max || this.busy) {
      const policy = proc === 'sidecar'
        ? 'A sidecar is never restarted automatically — start again once you know why.'
        : max === 0 ? 'Not restarted automatically.' : `Restart limit (${max}) reached.`;
      Object.assign(step, { state: 'failed', code: `${proc}_exited`, pid: null, detail: `${why}. ${policy} ${this.tailText(proc)}` });
      return;
    }
    this.restarts[proc] = used + 1;
    const wait = BACKOFF_MS[Math.min(used, BACKOFF_MS.length - 1)];
    Object.assign(step, { state: 'running', code: 'restarting', detail: `${why}; restart ${used + 1}/${max} in ${wait / 1000} s` });
    // A start or stop since this restart was scheduled cancels it. Before the
    // spawn any operation does (the original rule); after it only a start or
    // stop does, and that operation then owns the fresh child (it waits for
    // this restart to let go before it touches anything).
    const epoch = this.epoch;
    const stale = () => this.epoch !== epoch;
    const giveUp = (): void => {
      if (step.code === 'restarting' && !this.recs[proc]) {
        Object.assign(step, emptyStep(step.id), { detail: `${why}; the automatic restart was cancelled by a start or stop` });
      }
      this.log(`${proc}: automatic restart cancelled`);
    };
    const until = this.clock.now() + wait;
    while (this.clock.now() < until) {
      if (stale() || this.busy) return giveUp();
      await this.clock.sleep(Math.min(100, until - this.clock.now()));
    }
    if (stale() || this.busy) return giveUp();
    try {
      if (proc === 'bridge') {
        const bind = await this.bridgeSupportsBind();
        if (stale() || this.busy) return giveUp();
        const fresh = await this.spawn('bridge', bridgeSpec(this.profile, bind, this.parentEnv));
        await this.bridgeReady(step, fresh, this.profile.timeouts.bridgeS, stale);
      } else if (proc === 'agent') {
        const fresh = await this.spawn('agent', agentSpec(this.profile, this.parentEnv));
        await this.agentReady(step, fresh, this.profile.timeouts.agentS, stale);
      }
    } catch (e) {
      Object.assign(step, { state: 'failed', code: `${proc}_restart_failed`, detail: (e as Error).message });
    }
  }

  /** One check of every re-adopted child, so /status says ok/failed instead of "checking". */
  private async verifyAdopted(): Promise<void> {
    const b = this.recs.bridge;
    if (b) await this.bridgeReady(this.steps.bridge, b, 3);
    const sc = this.recs.sidecar;
    if (sc) {
      const s = this.steps.sidecar;
      const h = await this.sidecar().health();
      if (h) {
        this.noteBase(h);
        if (sc.mode === null) sc.mode = h.write_mode === 'arm_sdk' ? 'arm_sdk' : 'read_only';
        Object.assign(s, {
          state: h.connected === true ? 'ok' : 'failed',
          code: h.connected === true ? null : 'sidecar_not_ready',
          detail: `${h.write_mode ?? sc.mode}, ${h.connected === true ? 'connected' : 'connected:false'} (re-adopted)`,
          checks: { connected: h.connected === true, write_mode: h.write_mode ?? null, armed: h.armed ?? null },
        });
      } else {
        Object.assign(s, { state: 'failed', code: 'sidecar_unreachable', detail: 're-adopted, but /health does not answer' });
      }
    }
    const a = this.recs.agent;
    if (a) await this.agentReady(this.steps.agent, a, 2);
    const sim = this.recs.sim;
    if (sim) Object.assign(this.steps.link, { state: 'ok', detail: `simulator pid ${sim.pid} (re-adopted)` });
    const any = PROC_NAMES.some((p) => this.recs[p]);
    if (any) Object.assign(this.steps.preflight, { state: 'ok', detail: 're-adopted after a supervisor restart' });
  }

  // ---------------------------------------------------------------- helpers

  private async spawn(proc: ProcName, spec: ReturnType<typeof agentSpec>): Promise<ChildRecord> {
    const rec = await spawnChild(spec, logFilePath(this.stateDir, this.profile.robotId, proc), this.procRoot);
    this.recs[proc] = rec;
    writePidFile(this.pidPath(proc), rec);
    const step = this.steps[this.stepOf(proc)];
    Object.assign(step, { owned: true, pid: rec.pid, startedAt: rec.startedAt });
    this.tailer(proc).poll();
    this.log(`started ${proc} pid ${rec.pid}${spec.mode ? ` (${spec.mode})` : ''}`);
    return rec;
  }

  private tailer(proc: ProcName): LogTailer {
    let t = this.tailers[proc];
    if (!t) {
      t = new LogTailer(logFilePath(this.stateDir, this.profile.robotId, proc));
      t.start();
      this.tailers[proc] = t;
    }
    return t;
  }

  private tailText(proc: ProcName, n = 6): string {
    const lines = this.tailer(proc).tail(60).filter((l) => l.trim() && !l.startsWith('=== '));
    const refusing = lines.filter((l) => /REFUSING|Error|error|does not match/.test(l));
    const pick = (refusing.length ? refusing : lines).slice(-n);
    return pick.length ? pick.join(' | ') : '(no output in its log)';
  }

  private sidecar(): SidecarClient {
    return new SidecarClient(`http://127.0.0.1:${this.profile.ports.sidecar}`, this.fetchImpl);
  }

  private async getJson(url: string): Promise<Record<string, unknown> | null> {
    try {
      const res = await this.fetchImpl(url, { signal: AbortSignal.timeout(2000) });
      if (!res.ok) return null;
      return (await res.json()) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  private async httpOk(url: string): Promise<boolean> {
    try {
      const res = await this.fetchImpl(url, { signal: AbortSignal.timeout(2000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  private pidPath(proc: ProcName): string {
    return pidFilePath(this.stateDir, this.profile.robotId, proc);
  }

  private stepOf(proc: ProcName): StepId {
    return proc === 'sim' ? 'link' : proc;
  }

  private procOf(id: StepId): ProcName | null {
    if (id === 'bridge' || id === 'sidecar' || id === 'agent') return id;
    if (id === 'link' && this.profile.robot === 'sim') return 'sim';
    return null;
  }
}
