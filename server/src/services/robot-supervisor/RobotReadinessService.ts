/**
 * @file RobotReadinessService.ts
 * @description One readiness snapshot per robot, merged from the robot
 *              supervisor (processes: link, bridge, sidecar, agent — TASK-403)
 *              and the robot agent (sidecar, mode, arms, hands, lease, camera
 *              and the "why not following" line — TASK-405), and emitted as
 *              `robot:readiness` to every browser of the robot's tenant.
 *
 *              D1: the agent owns robot-level reasons. The server adds only what
 *              the agent cannot know — the processes and whether the agent
 *              answers at all — in a fixed order ahead of the agent's line.
 *              D2: only watched robots are polled (a readiness request or a
 *              bringup action in the last 30 s, or an active teleop session),
 *              at 1 Hz, with an emission on change and at least every 5 s.
 *              The Quest on the robot PC's USB (TASK-412) rides along as
 *              `quest`, read every 2 s while watched; it is display-only and
 *              never changes `reason`.
 * @feature robots
 */

import { EventEmitter } from 'node:events';
import type { QuestStatus, SupervisorStatus, SupervisorStepStatus } from './SupervisorClient.js';

// ============================================================================
// TYPES
// ============================================================================

/** The agent's own line (robot-agent `readiness/why-not-following.ts`). */
export interface AgentReadinessReason {
  code: string;
  severity: 'block' | 'warn' | 'ok';
  text: string;
}

/**
 * `GET /api/v1/robots/:id/readiness` of the agent (TASK-405). Only the fields
 * the server reads are typed; the rest passes through untouched.
 */
export interface AgentReadiness {
  robotId: string;
  at: string;
  simulated: boolean;
  sidecar: { reachable: boolean; connected: boolean; [k: string]: unknown };
  base: { mode: string; fsmId: number | null; [k: string]: unknown } | null;
  reason: AgentReadinessReason;
  [k: string]: unknown;
}

export type ReadinessSeverity = 'block' | 'warn' | 'ok';

export interface RobotReadinessReason {
  code: string;
  severity: ReadinessSeverity;
  text: string;
  source: 'server' | 'agent';
}

export interface RobotReadiness {
  robotId: string;
  at: string;
  agent: { reachable: boolean; error: string | null; readiness: AgentReadiness | null };
  /** The supervisor's status; null when the robot has none or it did not answer. */
  bringup: SupervisorStatus | null;
  /** Null when the robot has no supervisor configured. */
  supervisor: { reachable: boolean; error: string | null } | null;
  /**
   * The Meta Quest on the robot PC's USB, from the supervisor's `GET /quest`;
   * null without a supervisor or when it did not answer. Display-only.
   */
  quest: QuestStatus | null;
  reason: RobotReadinessReason;
}

/** How one supervisor `/status` read went. */
export type SupervisorRead =
  | { kind: 'ok'; status: SupervisorStatus }
  | { kind: 'error'; error: string };

/** How one agent `/readiness` read went. */
export type AgentRead =
  | { kind: 'ok'; readiness: AgentReadiness }
  | { kind: 'bad_status'; status: number }
  | { kind: 'unreachable'; error: string };

export interface RobotReadinessDeps {
  /** Robots that have a supervisor (from `ROBOT_SUPERVISORS`). */
  supervisedRobots: () => readonly string[];
  readSupervisor: (robotId: string) => Promise<SupervisorRead>;
  /** The agent URL from the robot record; null when the robot is not registered. */
  registeredAgentUrl: (robotId: string) => Promise<string | null>;
  /** The agent URL the supervisor's profile names, from its last status. */
  supervisorAgentUrl: (robotId: string, status: SupervisorStatus | null) => string | null;
  readAgent: (baseUrl: string, robotId: string) => Promise<AgentRead>;
  /** The supervisor's `GET /quest`; null when it did not answer. Absent: no Quest reports. */
  readQuest?: (robotId: string) => Promise<QuestStatus | null>;
  /** How often the Quest is read while watched (default 2 s). */
  questPollMs?: number;
  /**
   * How long a poll waits for a Quest read it started before it goes on with
   * the last report (default 250 ms). The read itself may take up to 5 s
   * (adb on a cold daemon); it finishes in the background and the next poll
   * carries it, so a slow headset never holds back the readiness line.
   */
  questWaitMs?: number;
  /** Register a robot from its agent URL, in the tenant of whoever asked. */
  register: (agentUrl: string, tenantId: string | null) => Promise<void>;
  now?: () => number;
  pollMs?: number;
  watchMs?: number;
  heartbeatMs?: number;
}

export const READINESS_POLL_MS = 1_000;
export const READINESS_WATCH_MS = 30_000;
export const READINESS_HEARTBEAT_MS = 5_000;
/** The Quest is read every 2 s while a robot is watched (TASK-412). */
export const READINESS_QUEST_POLL_MS = 2_000;
/** A poll waits this long for a Quest read before it uses the last report. */
export const READINESS_QUEST_WAIT_MS = 250;
/** A cached agent reading older than this is not passed on (base-mode `sidecarReachable`). */
export const READINESS_CACHE_FRESH_MS = 10_000;
/** One VR HUD line, as the agent's own reasons (REASON_MAX_CHARS). */
export const REASON_MAX_CHARS = 72;
/** Retry a failed registration no faster than this. */
const REGISTER_RETRY_MS = 5_000;

// ============================================================================
// THE MERGE
// ============================================================================

function clip(text: string): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length <= REASON_MAX_CHARS ? one : `${one.slice(0, REASON_MAX_CHARS - 1)}…`;
}

function firstStep(status: SupervisorStatus, state: SupervisorStepStatus['state']): SupervisorStepStatus | null {
  return status.steps.find((s) => s.state === state) ?? null;
}

/** The process a step runs, for the "an old … process" line. */
const STEP_PROCESS: Record<string, string> = {
  link: 'simulator',
  bridge: 'bridge',
  sidecar: 'sidecar',
  agent: 'agent',
};

/**
 * The one line, server reasons first (in this order), else the agent's:
 *
 * 1. `bringup_stopped` — the robot side is stopped.
 * 2. `bringup_failed:<step>` — that step's detail.
 * 3. `bringup_foreign:<step>` — an old process holds the step's port.
 * 4. `bringup_busy` — a start, stop or mode switch is still running.
 * 5. `supervisor_unreachable` — neither the supervisor nor the agent answers.
 * 6. `agent_unreachable` — the agent does not answer.
 * 7. `agent_no_readiness` — the agent answers, but not with a readiness report.
 */
export function mergeReason(
  bringup: SupervisorStatus | null,
  supervisor: RobotReadiness['supervisor'],
  agent: RobotReadiness['agent'],
): RobotReadinessReason {
  const server = (code: string, severity: ReadinessSeverity, text: string): RobotReadinessReason => ({
    code,
    severity,
    text: clip(text),
    source: 'server',
  });
  if (bringup) {
    if (bringup.overall === 'stopped') {
      return server('bringup_stopped', 'block', 'Robot side is stopped. Press Start.');
    }
    const failed = firstStep(bringup, 'failed');
    if (failed) {
      return server(`bringup_failed:${failed.id}`, 'block', failed.detail ?? `The ${failed.id} step failed.`);
    }
    const foreign = firstStep(bringup, 'foreign');
    if (foreign) {
      const pid = foreign.foreign?.pid ?? foreign.pid;
      const proc = STEP_PROCESS[foreign.id] ?? foreign.id;
      return server(
        `bringup_foreign:${foreign.id}`,
        'block',
        `An old ${proc} process is running (pid ${pid ?? '?'}). Adopt or leave it.`,
      );
    }
    if (bringup.overall === 'starting' || bringup.overall === 'stopping') {
      const running = firstStep(bringup, 'running');
      const what = bringup.overall === 'starting' ? 'starting' : 'stopping';
      return server(
        'bringup_busy',
        'warn',
        running ? `Robot side is ${what}: ${running.id}…` : `Robot side is ${what}…`,
      );
    }
  }
  if (!agent.reachable) {
    if (supervisor && !supervisor.reachable) {
      return server('supervisor_unreachable', 'block', 'Robot supervisor and agent are not answering.');
    }
    return server('agent_unreachable', 'block', 'Robot agent is not answering.');
  }
  if (!agent.readiness) {
    return server('agent_no_readiness', 'warn', `Robot agent sent no readiness report (${agent.error ?? 'no body'}).`);
  }
  const r = agent.readiness.reason;
  return { code: r.code, severity: r.severity, text: r.text, source: 'agent' };
}

/** Deep equality that ignores every `at` key — the timestamps change on every poll. */
export function sameIgnoringAt(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    return a.length === bb.length && a.every((v, i) => sameIgnoringAt(v, bb[i]));
  }
  const ka = Object.keys(a).filter((k) => k !== 'at');
  const kb = Object.keys(b).filter((k) => k !== 'at');
  if (ka.length !== kb.length) return false;
  const ob = b as Record<string, unknown>;
  return ka.every((k) => Object.prototype.hasOwnProperty.call(ob, k) && sameIgnoringAt((a as Record<string, unknown>)[k], ob[k]));
}

// ============================================================================
// SERVICE
// ============================================================================

interface Watch {
  /** Watched until this time, from a readiness request or a bringup action. */
  until: number;
  /** Open teleop session ids on this robot. */
  sessions: Set<string>;
  inFlight: Promise<RobotReadiness> | null;
  last: RobotReadiness | null;
  lastEmitted: RobotReadiness | null;
  lastEmitAt: number;
  /**
   * The tick found the heartbeat due: the poll it starts emits even when
   * nothing changed. Decided on the tick's own clock, so an emission made off
   * the tick's phase (a GET-driven poll) cannot push the next heartbeat a
   * whole extra tick out.
   */
  heartbeatDue: boolean;
  /** A start asked for the robot to be registered once its agent is up. */
  register: { tenantId: string | null; lastTry: number } | null;
  /** The last Quest report and when its read started (0 = never). */
  quest: QuestStatus | null;
  questAt: number;
  /** The Quest read still running; its answer is dropped once this is replaced. */
  questRead: Promise<void> | null;
}

export class RobotReadinessService {
  private readonly emitter = new EventEmitter();
  private readonly watches = new Map<string, Watch>();
  /** Last snapshot per robot, kept after the watch ends (base-mode reads it). */
  private readonly cache = new Map<string, RobotReadiness>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly now: () => number;
  private readonly pollMs: number;
  private readonly watchMs: number;
  private readonly heartbeatMs: number;
  private readonly questPollMs: number;
  private readonly questWaitMs: number;

  constructor(private readonly deps: RobotReadinessDeps) {
    this.now = deps.now ?? Date.now;
    this.pollMs = deps.pollMs ?? READINESS_POLL_MS;
    this.watchMs = deps.watchMs ?? READINESS_WATCH_MS;
    this.heartbeatMs = deps.heartbeatMs ?? READINESS_HEARTBEAT_MS;
    this.questPollMs = deps.questPollMs ?? READINESS_QUEST_POLL_MS;
    this.questWaitMs = deps.questWaitMs ?? READINESS_QUEST_WAIT_MS;
    this.emitter.setMaxListeners(50);
  }

  /** `robot:readiness` listener; returns the unsubscribe. */
  onReadiness(listener: (snapshot: RobotReadiness) => void): () => void {
    this.emitter.on('robot:readiness', listener);
    return () => this.emitter.off('robot:readiness', listener);
  }

  hasSupervisor(robotId: string): boolean {
    return this.deps.supervisedRobots().includes(robotId);
  }

  /** Open or extend the 30 s watch window. */
  touch(robotId: string): void {
    const w = this.watch(robotId);
    w.until = Math.max(w.until, this.now() + this.watchMs);
    this.ensureTimer();
  }

  /** A teleop session on this robot opened (recording/paused) or closed. */
  setSession(robotId: string, sessionId: string, active: boolean): void {
    if (active) {
      this.watch(robotId).sessions.add(sessionId);
      this.ensureTimer();
      return;
    }
    for (const w of this.watches.values()) w.sessions.delete(sessionId);
  }

  /**
   * Register the robot once the supervisor reports its agent step ok and the
   * robot has no record yet. Called by a bringup start.
   */
  expectRegistration(robotId: string, tenantId: string | null): void {
    this.touch(robotId);
    this.watch(robotId).register = { tenantId, lastTry: 0 };
  }

  isWatched(robotId: string): boolean {
    const w = this.watches.get(robotId);
    return !!w && (w.until > this.now() || w.sessions.size > 0);
  }

  /** The newest snapshot, polling now when there is none younger than one poll period. */
  async getReadiness(robotId: string): Promise<RobotReadiness> {
    this.touch(robotId);
    const w = this.watch(robotId);
    if (w.last && this.now() - Date.parse(w.last.at) < this.pollMs) return w.last;
    return this.poll(robotId);
  }

  /** The agent part of the last snapshot, while it is fresh; else null. */
  cachedAgentReadiness(robotId: string): RobotReadiness['agent'] | null {
    const snap = this.cache.get(robotId);
    if (!snap || this.now() - Date.parse(snap.at) > READINESS_CACHE_FRESH_MS) return null;
    return snap.agent;
  }

  /** The last snapshot of any age (or null). */
  cached(robotId: string): RobotReadiness | null {
    return this.cache.get(robotId) ?? null;
  }

  /** Poll one robot now (deduplicated with a poll already running). */
  poll(robotId: string): Promise<RobotReadiness> {
    const w = this.watch(robotId);
    if (w.inFlight) return w.inFlight;
    const run = this.readOnce(robotId, w).finally(() => {
      w.inFlight = null;
    });
    w.inFlight = run;
    return run;
  }

  /** Stop polling everything (shutdown, tests). */
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.watches.clear();
  }

  // --------------------------------------------------------------------------

  private watch(robotId: string): Watch {
    let w = this.watches.get(robotId);
    if (!w) {
      w = { until: 0, sessions: new Set(), inFlight: null, last: null, lastEmitted: null, lastEmitAt: 0, heartbeatDue: false, register: null, quest: null, questAt: 0, questRead: null };
      this.watches.set(robotId, w);
    }
    return w;
  }

  private ensureTimer(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), this.pollMs);
    this.timer.unref?.();
  }

  private tick(): void {
    const now = this.now();
    for (const [robotId, w] of this.watches) {
      if (w.until <= now && w.sessions.size === 0) {
        this.watches.delete(robotId);
        continue;
      }
      // Due when waiting for the next tick would overshoot the heartbeat:
      // polls only run on this tick, so the last emission (whenever it
      // happened) must be at most one heartbeat behind the tick that follows.
      if (w.lastEmitted && now - w.lastEmitAt > this.heartbeatMs - this.pollMs) w.heartbeatDue = true;
      void this.poll(robotId).catch((error: unknown) => {
        console.error(`[robot-readiness] poll of ${robotId} failed:`, error instanceof Error ? error.message : error);
      });
    }
    if (this.watches.size === 0 && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async readOnce(robotId: string, w: Watch): Promise<RobotReadiness> {
    const supervised = this.hasSupervisor(robotId);
    const supRead: SupervisorRead | null = supervised
      ? await this.deps.readSupervisor(robotId).catch((e: unknown) => ({ kind: 'error' as const, error: String(e) }))
      : null;
    const bringup = supRead?.kind === 'ok' ? supRead.status : null;
    const supervisor = supRead
      ? { reachable: supRead.kind === 'ok', error: supRead.kind === 'error' ? supRead.error : null }
      : null;

    const registered = await this.deps.registeredAgentUrl(robotId).catch(() => null);
    const agentUrl = registered ?? this.deps.supervisorAgentUrl(robotId, bringup);
    let agent: RobotReadiness['agent'];
    if (!agentUrl) {
      agent = { reachable: false, error: 'robot is not registered and no supervisor names its agent', readiness: null };
    } else {
      const read = await this.deps
        .readAgent(agentUrl, robotId)
        .catch((e: unknown): AgentRead => ({ kind: 'unreachable', error: String(e) }));
      agent =
        read.kind === 'ok'
          ? { reachable: true, error: null, readiness: read.readiness }
          : read.kind === 'bad_status'
            ? { reachable: true, error: `HTTP ${read.status}`, readiness: null }
            : { reachable: false, error: read.error, readiness: null };
    }

    const quest = await this.readQuest(robotId, w, supRead?.kind === 'ok');

    const snapshot: RobotReadiness = {
      robotId,
      at: new Date(this.now()).toISOString(),
      agent,
      bringup,
      supervisor,
      quest,
      reason: mergeReason(bringup, supervisor, agent),
    };
    w.last = snapshot;
    this.cache.set(robotId, snapshot);
    this.maybeEmit(w, snapshot);
    await this.maybeRegister(robotId, w, bringup, registered !== null);
    return snapshot;
  }

  /**
   * The Quest report, read at most every `questPollMs` (the poll itself runs at
   * 1 Hz). Only asked of a supervisor that just answered; a failed read is null.
   * Off the critical path: the poll waits at most `questWaitMs` for a read it
   * started and otherwise goes on with the last report, while the read lands
   * in `w.quest` for the next poll.
   */
  private async readQuest(robotId: string, w: Watch, supervisorUp: boolean): Promise<QuestStatus | null> {
    const readQuest = this.deps.readQuest;
    if (!readQuest || !supervisorUp) {
      w.quest = null;
      w.questAt = 0;
      w.questRead = null;
      return null;
    }
    const now = this.now();
    if (!w.questRead && (w.questAt === 0 || now - w.questAt >= this.questPollMs)) {
      w.questAt = now;
      const read: Promise<void> = readQuest(robotId)
        .catch(() => null)
        .then((quest) => {
          // A read replaced meanwhile (supervisor down, Connect / Open) is stale.
          if (w.questRead !== read) return;
          w.quest = quest;
          w.questRead = null;
        });
      w.questRead = read;
    }
    const pending = w.questRead;
    if (pending) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([pending, new Promise<void>((resolve) => (timer = setTimeout(resolve, this.questWaitMs)))]);
      clearTimeout(timer);
    }
    return w.quest;
  }

  /** Forget the cached Quest report so the next poll reads it again (after Connect / Open). */
  invalidateQuest(robotId: string): void {
    const w = this.watches.get(robotId);
    if (!w) return;
    w.questAt = 0;
    // A read that started before the Connect / Open would bring back the old state.
    w.questRead = null;
  }

  private maybeEmit(w: Watch, snapshot: RobotReadiness): void {
    const now = this.now();
    const changed = !w.lastEmitted || !sameIgnoringAt(w.lastEmitted, snapshot);
    if (!changed && !w.heartbeatDue && now - w.lastEmitAt < this.heartbeatMs) return;
    w.lastEmitted = snapshot;
    w.lastEmitAt = now;
    w.heartbeatDue = false;
    this.emitter.emit('robot:readiness', snapshot);
  }

  private async maybeRegister(
    robotId: string,
    w: Watch,
    bringup: SupervisorStatus | null,
    registered: boolean,
  ): Promise<void> {
    const want = w.register;
    if (!want) return;
    if (registered) {
      w.register = null;
      return;
    }
    const agentStep = bringup?.steps.find((s) => s.id === 'agent');
    if (agentStep?.state !== 'ok') return;
    const url = this.deps.supervisorAgentUrl(robotId, bringup);
    if (!url || this.now() - want.lastTry < REGISTER_RETRY_MS) return;
    want.lastTry = this.now();
    try {
      await this.deps.register(url, want.tenantId);
      w.register = null;
      console.log(`[robot-readiness] registered ${robotId} from ${url}`);
    } catch (error) {
      console.error(
        `[robot-readiness] registering ${robotId} from ${url} failed:`,
        error instanceof Error ? error.message : error,
      );
    }
  }
}
