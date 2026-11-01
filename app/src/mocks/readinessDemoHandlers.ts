/**
 * @file readinessDemoHandlers.ts
 * @description Robot readiness fixtures and MSW handlers (TASK-411): one
 *              `RobotReadiness` per reason the panel must explain, for the
 *              component tests, and a small stateful robot side for the demo
 *              build — Start walks the steps through `starting` to `ready`,
 *              Stop returns them to `stopped`. Registered by a one-line spread
 *              in `handlers.ts`. TASK-412: a Quest 3 on the robot PC's USB —
 *              Connect forwards the port, Open on headset records the path.
 *              TASK-427: the robot's measured base mode — limp once the demo
 *              robot side is up, so Set up's step 3 shows the bring-up track;
 *              the demo refuses a mode change as it refuses arm control.
 *              TASK-428: a demo-only override (`POST /api/__demo/robots/:id/
 *              readiness` with a fixture name, or null to clear it) pins the
 *              robot to one fixture — its base mode and E-stop included — so
 *              the e2e can show the Record console's Mode cell, recovery slot
 *              and blockers.
 *              TASK-430: a `sidecar_stale_code` fixture (up, but the sidecar
 *              started before its code changed). The demo Stop lets a pinned
 *              robot go and passes through `stopping`, as the supervisor does,
 *              and a Start while it stops is refused with 409 `busy`, so the
 *              Set up step's Restart is Stop, wait, Start here as well.
 *              TASK-431: the two stops the session page must tell apart — the
 *              E-stop latched (`estop_latched`, with the agent's stop warning)
 *              and a `protective_stop` status with no latch
 *              (`protective_stop_unlatched`). A pinned stop also sets the
 *              robot's status and its telemetry warning, and the demo's Reset
 *              E-stop moves it to `estop_reset_limp`: no latch, the robot limp.
 * @feature mocks
 */

import { http, HttpResponse } from 'msw';
import type { BaseModeStatus } from '@/features/robots/api/baseModeApi';
import type { RobotStatus } from '@/features/robots/types/robots.types';
import { DEMO_ROBOTS } from './demoData';
import type {
  AgentReadiness,
  BringupStatus,
  BringupStep,
  BringupStepId,
  HandHealth,
  QuestReport,
  RobotReadiness,
} from '@/features/robots/api/readinessApi';

const AT = '2026-10-17T10:00:00.000Z';
const STEP_IDS: BringupStepId[] = ['preflight', 'link', 'camera', 'bridge', 'sidecar', 'agent'];

function step(id: BringupStepId, state: BringupStep['state'], extra: Partial<BringupStep> = {}): BringupStep {
  return {
    id,
    state,
    owned: state !== 'idle' && state !== 'foreign',
    pid: state === 'ok' || state === 'running' ? 4000 + STEP_IDS.indexOf(id) : null,
    startedAt: state === 'idle' ? null : AT,
    detail: null,
    checks: {},
    code: null,
    foreign: null,
    actions: [],
    ...extra,
  };
}

function readySteps(): BringupStep[] {
  return [
    step('preflight', 'ok'),
    step('link', 'ok', { checks: { carrier: true, operstate: 'up', hostIp: true, ping: true }, detail: 'enp131s0 up with 192.168.123.222/24; the robot answers at 192.168.123.164' }),
    step('camera', 'ok', { checks: { tcp: true }, detail: 'PC2 camera answers at 192.168.123.164:5600' }),
    step('bridge', 'ok', { checks: { lowstate: true, dex3Left: true, dex3Right: true } }),
    step('sidecar', 'ok', { checks: { connected: true, write_mode: 'arm_sdk', armed: true } }),
    step('agent', 'ok', { checks: { health: 'ok' } }),
  ];
}

function bringup(overrides: Partial<BringupStatus> = {}): BringupStatus {
  return {
    robotId: 'demo-g1-001',
    profile: 'g1-edu-real',
    robot: 'real',
    sidecarMode: 'arm_sdk',
    overall: 'ready',
    steps: readySteps(),
    lastBase: { mode: 'balance', fsmId: 801 },
    agentPort: 41245,
    at: AT,
    ...overrides,
  };
}

function hand(): HandHealth {
  return { present: true, ageS: 0.02, error: [0, 0], motorFaults: [], powerV: 24.1 };
}

function agentReadiness(overrides: Partial<AgentReadiness> = {}): AgentReadiness {
  return {
    robotId: 'demo-g1-001',
    at: AT,
    simulated: false,
    sidecar: {
      reachable: true, connected: true, url: 'http://127.0.0.1:8767', lowstateAgeS: 0.01,
      writeMode: 'arm_sdk', readOnly: false, bootId: 'boot-1', sim: false, stale: false, lastHealthAt: AT,
    },
    base: { gate: 'fsm', mode: 'balance', fsmId: 801, ageS: 0.2, error: null, stale: false },
    arms: {
      armState: 'armed', armed: true, arming: false, armWeight: 1, deadman: 'ok', lastDisarmReason: null,
      trackErrRad: null, trackErrJoint: null, estopLatched: false, sidecarEstopLatched: false, claims: 1, lastError: null,
    },
    hands: { left: hand(), right: hand() },
    lease: { enforced: true, state: 'held', holder: { userId: 'u1', displayName: 'Operator' }, bound: 1 },
    camera: { source: 'pc2', cameras: ['head'], detail: null },
    telemetrySynthetic: false,
    reason: { code: 'following', severity: 'ok', text: 'Following — the arms track the controllers.' },
    ...overrides,
  };
}

/** A Quest 3 on the robot PC's USB, its port forwarded or not (TASK-412). */
export function demoQuest(forwarded: boolean, port = 1420): QuestReport {
  return {
    adb: '/home/operator/platform-tools/adb',
    devices: [{ serial: '2G0YC5ZG8X0123', state: 'device', model: 'Quest 3' }],
    reversed: forwarded ? [{ remote: `tcp:${port}`, local: `tcp:${port}` }] : [],
    hint: forwarded ? null : `Headset connected. Press Connect to forward port ${port}.`,
  };
}

function snapshot(parts: Partial<RobotReadiness> & { agentReadiness?: AgentReadiness | null } = {}): RobotReadiness {
  const { agentReadiness: ar, ...rest } = parts;
  const readiness = ar === undefined ? agentReadiness() : ar;
  return {
    robotId: 'demo-g1-001',
    at: AT,
    agent: { reachable: readiness !== null, error: readiness ? null : 'connect ECONNREFUSED 127.0.0.1:41245', readiness },
    bringup: bringup(),
    supervisor: { reachable: true, error: null },
    quest: demoQuest(false),
    reason: readiness
      ? { ...readiness.reason, source: 'agent' }
      : { code: 'agent_unreachable', severity: 'block', text: 'Robot agent is not answering.', source: 'server' },
    ...rest,
  };
}

const stoppedSteps = (): BringupStep[] => STEP_IDS.map((id) => step(id, 'idle'));

/** One snapshot per reason the panel must explain (and the green one). */
export const READINESS_FIXTURES = {
  following: snapshot(),
  bringup_stopped: snapshot({
    bringup: bringup({ overall: 'stopped', sidecarMode: null, steps: stoppedSteps() }),
    agentReadiness: null,
    agent: { reachable: false, error: 'connect ECONNREFUSED 127.0.0.1:41245', readiness: null },
    reason: { code: 'bringup_stopped', severity: 'block', text: 'Robot side is stopped. Press Start.', source: 'server' },
  }),
  'bringup_failed:link': snapshot({
    bringup: bringup({
      overall: 'error',
      sidecarMode: null,
      steps: [
        step('preflight', 'ok'),
        step('link', 'failed', {
          code: 'no_host_ip',
          checks: { carrier: true, operstate: 'up', hostIp: false },
          detail: 'enp131s0 does not have 192.168.123.222/24 — bring the robot LAN up',
        }),
        step('camera', 'idle'),
        step('bridge', 'idle'),
        step('sidecar', 'idle'),
        step('agent', 'idle'),
      ],
    }),
    agentReadiness: null,
    agent: { reachable: false, error: 'connect ECONNREFUSED', readiness: null },
    reason: {
      code: 'bringup_failed:link',
      severity: 'block',
      text: 'enp131s0 does not have 192.168.123.222/24 — bring the robot LAN up',
      source: 'server',
    },
  }),
  'bringup_foreign:bridge': snapshot({
    bringup: bringup({
      overall: 'error',
      sidecarMode: null,
      steps: [
        step('preflight', 'ok'),
        step('link', 'ok', { checks: { carrier: true, hostIp: true, ping: true } }),
        step('camera', 'ok'),
        step('bridge', 'foreign', {
          code: 'foreign_process',
          detail: 'port 8790 is held by a process NeoDEM did not start',
          foreign: { pid: 31337, cmdline: ['python3', 'g1_state_bridge.py', '--iface', 'enp131s0'], since: '2026-10-17T09:00:00.000Z', port: 8790 },
          actions: ['adopt', 'leave'],
        }),
        step('sidecar', 'idle'),
        step('agent', 'idle'),
      ],
    }),
    agentReadiness: null,
    agent: { reachable: false, error: 'connect ECONNREFUSED', readiness: null },
    reason: {
      code: 'bringup_foreign:bridge',
      severity: 'block',
      text: 'An old bridge process is running (pid 31337). Adopt or leave it.',
      source: 'server',
    },
  }),
  agent_unreachable: snapshot({
    agentReadiness: null,
    reason: { code: 'agent_unreachable', severity: 'block', text: 'Robot agent is not answering.', source: 'server' },
  }),
  mode_not_balance: snapshot({
    agentReadiness: agentReadiness({
      base: { gate: 'fsm', mode: 'stand', fsmId: 4, ageS: 0.3, error: null, stale: false },
      arms: { ...agentReadiness().arms, armed: false, armWeight: 0, armState: 'idle' },
      reason: { code: 'mode_not_balance', severity: 'block', text: 'The robot is standing. Switch it to Balance.' },
    }),
  }),
  // TASK-428: the tallest recovery slot — the E-stop latched, the base dropped to Limp.
  estop_latched: snapshot({
    agentReadiness: agentReadiness({
      base: { gate: 'fsm', mode: 'limp', fsmId: 1, ageS: 0.3, error: null, stale: false },
      arms: { ...agentReadiness().arms, armed: false, armWeight: 0, armState: 'idle', estopLatched: true },
      reason: { code: 'estop_latched', severity: 'block', text: 'E-stop is latched. Reset it, then switch to Balance.' },
    }),
  }),
  // TASK-431: a protective_stop status that no latch holds (the sim restored one
  // from its state file). Readiness reports no latch; only the robot's status says stop.
  protective_stop_unlatched: snapshot({
    agentReadiness: agentReadiness({
      base: { gate: 'fsm', mode: 'limp', fsmId: 1, ageS: 0.3, error: null, stale: false },
      arms: { ...agentReadiness().arms, armed: false, armWeight: 0, armState: 'idle' },
      reason: { code: 'mode_not_balance', severity: 'block', text: 'The robot is limp. Switch to Balance.' },
    }),
  }),
  // TASK-431: after Reset E-stop — no latch, and the robot still limp from the stop.
  estop_reset_limp: snapshot({
    agentReadiness: agentReadiness({
      base: { gate: 'fsm', mode: 'limp', fsmId: 1, ageS: 0.3, error: null, stale: false },
      arms: { ...agentReadiness().arms, armed: false, armWeight: 0, armState: 'idle' },
      reason: { code: 'mode_not_balance', severity: 'block', text: 'The robot is limp. Switch to Balance.' },
    }),
  }),
  hand_fault: snapshot({
    agentReadiness: agentReadiness({
      hands: {
        left: hand(),
        right: { ...hand(), error: [512, 0], motorFaults: [{ motor: 1, joint: 'thumb_1', code: '0x200', bits: ['overcurrent'] }] },
      },
      reason: { code: 'hand_fault', severity: 'block', text: 'Right hand fault: thumb_1 0x200. Power-cycle the hand.' },
    }),
  }),
  lease_duplicate: snapshot({
    agentReadiness: agentReadiness({
      lease: { enforced: true, state: 'held', holder: { userId: 'u1', displayName: 'Operator' }, bound: 2 },
      reason: { code: 'lease_duplicate', severity: 'warn', text: '2 control sockets are bound. Close the other tab or headset.' },
    }),
  }),
  not_engaged: snapshot({
    agentReadiness: agentReadiness({
      arms: { ...agentReadiness().arms, armed: false, armWeight: 0, armState: 'idle', claims: 0 },
      reason: { code: 'not_engaged', severity: 'warn', text: 'Ready. Squeeze a grip to take that arm.' },
    }),
  }),
  /** Up, read-only, robot measured in balance — Switch to arm control is offered. */
  read_only_ready: snapshot({
    bringup: bringup({
      sidecarMode: 'read_only',
      steps: readySteps().map((s) => (s.id === 'sidecar' ? { ...s, checks: { connected: true, write_mode: 'read_only', armed: false } } : s)),
    }),
    agentReadiness: agentReadiness({
      sidecar: { ...agentReadiness().sidecar, writeMode: 'read_only', readOnly: true },
      arms: { ...agentReadiness().arms, armed: false, armWeight: 0, armState: 'idle' },
      reason: { code: 'read_only', severity: 'block', text: 'The sidecar is read-only. Switch the robot side to arm control.' },
    }),
  }),
  /**
   * TASK-430: up and read-only, but the sidecar started before its code
   * changed — the supervisor's stale-code mark on an owned step, and the
   * server's `agent_outdated` line. A restart of the robot side cures it.
   */
  sidecar_stale_code: snapshot({
    bringup: bringup({
      sidecarMode: 'read_only',
      steps: readySteps().map((s) => (s.id === 'sidecar'
        ? {
          ...s,
          state: 'warn' as const,
          code: 'stale_code',
          detail: 'runs code from before 2026-10-30 01:44 — restart the robot side (started 2026-10-29 19:05)',
          checks: {
            connected: true, write_mode: 'read_only', armed: false,
            staleCode: { startedAt: '2026-10-29T18:05:00.000Z', codeAt: '2026-10-30T00:44:00.000Z' },
          },
        }
        : s)),
    }),
    agentReadiness: agentReadiness({
      sidecar: { ...agentReadiness().sidecar, writeMode: 'read_only', readOnly: true },
      arms: { ...agentReadiness().arms, armed: false, armWeight: 0, armState: 'idle' },
      reason: { code: 'read_only', severity: 'block', text: 'The sidecar is read-only. Switch the robot side to arm control.' },
    }),
    reason: { code: 'agent_outdated', severity: 'block', text: 'The sidecar runs older code than NeoDEM. Restart the robot side.', source: 'server' },
  }),
} satisfies Record<string, RobotReadiness>;

export type ReadinessFixtureName = keyof typeof READINESS_FIXTURES;

/**
 * TASK-431: what a pinned stop fixture's robot reports besides its readiness —
 * the server's status for it, and the agent's warnings in its telemetry (the
 * stop warning `SafetyMonitor` writes with a latch).
 */
export const FIXTURE_ROBOT: Partial<Record<ReadinessFixtureName, { status: RobotStatus; warnings: string[] }>> = {
  estop_latched: {
    status: 'protective_stop',
    warnings: ['Emergency stop activated: Platform E-Stop: Emergency stop triggered for G1-EDU-4 (real)'],
  },
  protective_stop_unlatched: { status: 'protective_stop', warnings: [] },
};

/** Where the demo's Reset E-stop takes a pinned stop. */
const RESETS_TO: Partial<Record<ReadinessFixtureName, ReadinessFixtureName>> = {
  estop_latched: 'estop_reset_limp',
  protective_stop_unlatched: 'estop_reset_limp',
};

/** A fixture for another robot id (deep enough for the panel). */
export function readinessFor(robotId: string, name: ReadinessFixtureName): RobotReadiness {
  const f = READINESS_FIXTURES[name];
  return { ...f, robotId, bringup: f.bringup ? { ...f.bringup, robotId } : null };
}

// ============================================================================
// DEMO ROBOT SIDE — stateful, per robot
// ============================================================================

interface DemoSide {
  phase: 'stopped' | 'starting' | 'ready' | 'stopping';
  startedAt: number;
}

const sides = new Map<string, DemoSide>();
/** Demo-only (TASK-428): a robot pinned to one fixture. */
const overrides = new Map<string, ReadinessFixtureName>();
/** The demo headset per robot: forwarded port (null = not yet) and the last opened path. */
const quests = new Map<string, { port: number | null; opened: string | null }>();
const OPEN_PATH = /^\/data-collection\/(live\?robot=[A-Za-z0-9_-]+|[0-9a-f-]{36})$/;

function demoQuestFor(robotId: string): QuestReport {
  const q = quests.get(robotId);
  return q?.port ? demoQuest(true, q.port) : demoQuest(false);
}

function withQuest(robotId: string, snap: RobotReadiness): RobotReadiness {
  return { ...snap, quest: demoQuestFor(robotId) };
}
/** How long the demo's Start takes per step. */
const DEMO_STEP_MS = 700;
/** How long the demo's Stop takes: the supervisor answers at once and stops in the background. */
const DEMO_STOP_MS = 2 * DEMO_STEP_MS;

function demoSnapshot(robotId: string): RobotReadiness {
  const pinned = overrides.get(robotId);
  if (pinned) return readinessFor(robotId, pinned);
  const side = sides.get(robotId) ?? { phase: 'stopped', startedAt: 0 };
  if (side.phase === 'stopping' && Date.now() - side.startedAt >= DEMO_STOP_MS) side.phase = 'stopped';
  if (side.phase === 'stopped') return readinessFor(robotId, 'bringup_stopped');
  if (side.phase === 'stopping') {
    const base = readinessFor(robotId, 'bringup_stopped');
    const steps = STEP_IDS.map((id) =>
      id === 'bridge' || id === 'sidecar' || id === 'agent' ? step(id, 'running', { detail: `stopping ${id}…` }) : step(id, 'idle'),
    );
    return {
      ...base,
      bringup: { ...base.bringup!, overall: 'stopping', steps },
      reason: { code: 'bringup_busy', severity: 'warn', text: 'Robot side is stopping…', source: 'server' },
    };
  }
  if (side.phase === 'starting') {
    const done = Math.floor((Date.now() - side.startedAt) / DEMO_STEP_MS);
    if (done >= STEP_IDS.length) {
      side.phase = 'ready';
    } else {
      const running = STEP_IDS[done];
      const steps = STEP_IDS.map((id, i) =>
        i < done ? readySteps()[i] : i === done ? step(id, 'running', { detail: `starting ${id}…` }) : step(id, 'idle'),
      );
      const base = readinessFor(robotId, 'bringup_stopped');
      return {
        ...base,
        bringup: { ...base.bringup!, overall: 'starting', sidecarMode: 'read_only', steps },
        reason: { code: 'bringup_busy', severity: 'warn', text: `Robot side is starting: ${running}…`, source: 'server' },
      };
    }
  }
  return readinessFor(robotId, 'read_only_ready');
}

/** The demo robot's measured mode: unreachable while the robot side is stopped, then limp. */
function demoBaseMode(robotId: string): BaseModeStatus {
  const pinned = overrides.get(robotId);
  if (pinned) {
    // The pinned fixture's own measured mode, and its E-stop.
    const ar = readinessFor(robotId, pinned).agent.readiness;
    const base = ar?.base ?? null;
    return {
      capability: base?.gate === 'fsm' || base?.gate === 'full'
        ? { gate: base.gate, moveEnabled: false, idsVerified: false, ids: { limp: 1, stand: 4, balance: 501, balanceReported: [501] } }
        : { gate: 'unknown', moveEnabled: null, idsVerified: false, ids: null },
      base: base ? { fsmId: base.fsmId, mode: base.mode, ageS: base.ageS, error: base.error } : null,
      inFlight: null,
      estopLatched: ar?.arms?.estopLatched ?? false,
      sidecarEstopLatched: ar?.arms?.sidecarEstopLatched ?? false,
      armed: ar?.arms?.armed ?? false,
      sidecarReachable: !!ar?.sidecar?.reachable,
    } as BaseModeStatus;
  }
  const up = demoSnapshot(robotId).bringup?.overall === 'ready';
  return {
    capability: up
      ? { gate: 'fsm', moveEnabled: false, idsVerified: false, ids: { limp: 1, stand: 4, balance: 501, balanceReported: [501] } }
      : { gate: 'unknown', moveEnabled: null, idsVerified: false, ids: null },
    base: up ? { fsmId: 1, mode: 'limp', ageS: 0.3, error: null } : null,
    inFlight: null,
    estopLatched: false,
    sidecarEstopLatched: false,
    armed: false,
    sidecarReachable: up,
  };
}

/** The pinned fixture's robot facts (TASK-431), or null. */
function pinnedRobot(robotId: string) {
  const pinned = overrides.get(robotId);
  return pinned ? FIXTURE_ROBOT[pinned] ?? null : null;
}

export const readinessDemoHandlers = [
  // TASK-431: a pinned stop sets the robot's status and its telemetry warning.
  // Without one, these fall through to the general demo handlers.
  http.get('/api/robots/:id', ({ params }) => {
    const id = String(params.id);
    const extra = pinnedRobot(id);
    const robot = DEMO_ROBOTS.find((r) => r.id === id);
    if (!extra || !robot) return undefined;
    return HttpResponse.json({ ...robot, status: extra.status });
  }),
  http.get('/api/robots/:id/telemetry', ({ params }) => {
    const id = String(params.id);
    const extra = pinnedRobot(id);
    if (!extra) return undefined;
    return HttpResponse.json({
      robotId: id, batteryLevel: 50, cpuUsage: 30, memoryUsage: 45, temperature: 35, sensors: {},
      warnings: extra.warnings, timestamp: new Date().toISOString(),
    });
  }),
  // TASK-431: the session page's Reset E-stop. A pinned stop clears to the robot
  // limp with no latch; the robot itself was never moved.
  http.post('/api/safety/robots/:id/estop/reset', ({ params }) => {
    const id = String(params.id);
    const pinned = overrides.get(id);
    const next = pinned ? RESETS_TO[pinned] : undefined;
    if (next) overrides.set(id, next);
    return HttpResponse.json({
      message: 'E-stop reset successfully',
      robotId: id,
      status: 'armed',
      stopCategory: 2,
      requiresManualReset: true,
      robotStatus: 'online',
    });
  }),
  // Demo-only (TASK-428): pin a robot to one fixture, or { fixture: null } to let it go.
  http.post('/api/__demo/robots/:id/readiness', async ({ params, request }) => {
    const body = (await request.json().catch(() => ({}))) as { fixture?: string | null };
    const id = String(params.id);
    if (body.fixture && body.fixture in READINESS_FIXTURES) overrides.set(id, body.fixture as ReadinessFixtureName);
    else overrides.delete(id);
    return HttpResponse.json(withQuest(id, demoSnapshot(id)));
  }),
  http.get('/api/robots/:id/base-mode', ({ params }) => HttpResponse.json(demoBaseMode(String(params.id)))),
  http.post('/api/robots/:id/base-mode', () =>
    HttpResponse.json({ ok: false, code: 'demo', error: 'The demo has no robot to change modes on.' }, { status: 409 }),
  ),
  http.get('/api/robots/:id/readiness', ({ params }) =>
    HttpResponse.json(withQuest(String(params.id), demoSnapshot(String(params.id)))),
  ),
  http.get('/api/robots/:id/quest', ({ params }) => HttpResponse.json(demoQuestFor(String(params.id)))),
  http.post('/api/robots/:id/quest/connect', async ({ params, request }) => {
    const body = (await request.json().catch(() => ({}))) as { port?: number };
    const id = String(params.id);
    quests.set(id, { port: typeof body.port === 'number' ? body.port : 1420, opened: quests.get(id)?.opened ?? null });
    return HttpResponse.json({ ok: true, status: 200, code: null, error: null, serial: '2G0YC5ZG8X0123', quest: demoQuestFor(id) });
  }),
  http.post('/api/robots/:id/quest/open', async ({ params, request }) => {
    const body = (await request.json().catch(() => ({}))) as { path?: unknown };
    if (typeof body.path !== 'string' || !OPEN_PATH.test(body.path)) {
      return HttpResponse.json({ code: 'bad_path', error: 'path is not allowlisted' }, { status: 400 });
    }
    const id = String(params.id);
    quests.set(id, { port: quests.get(id)?.port ?? null, opened: body.path });
    return HttpResponse.json({ ok: true, status: 200, code: null, error: null, serial: '2G0YC5ZG8X0123', quest: demoQuestFor(id) });
  }),
  http.get('/api/robots/:id/bringup', ({ params }) => HttpResponse.json(demoSnapshot(String(params.id)).bringup)),
  http.post('/api/robots/:id/bringup/start', async ({ params, request }) => {
    const body = (await request.json().catch(() => ({}))) as { mode?: string };
    if (body.mode !== 'read_only') {
      return HttpResponse.json({ code: 'demo_read_only', error: 'the demo starts read-only only' }, { status: 400 });
    }
    const id = String(params.id);
    // As the supervisor: no Start while a Stop is still running.
    if (demoSnapshot(id).bringup?.overall === 'stopping') {
      return HttpResponse.json({ code: 'busy', error: 'the supervisor is stopping — wait for it to finish' }, { status: 409 });
    }
    sides.set(id, { phase: 'starting', startedAt: Date.now() });
    return HttpResponse.json({ ok: true, accepted: true });
  }),
  http.post('/api/robots/:id/bringup/stop', ({ params }) => {
    const id = String(params.id);
    // A Stop lets a pinned robot go (TASK-430): the demo's own robot side takes over, stopping.
    overrides.delete(id);
    sides.set(id, { phase: 'stopping', startedAt: Date.now() });
    return HttpResponse.json({ status: demoSnapshot(id).bringup, baseMode: null });
  }),
  http.post('/api/robots/:id/bringup/sidecar-mode', () =>
    HttpResponse.json({ code: 'demo', error: 'The demo has no robot to switch to arm control.' }, { status: 409 }),
  ),
  http.get('/api/robots/:id/bringup/logs/:proc', ({ params }) =>
    HttpResponse.json({ proc: params.proc, lines: [`[demo] ${String(params.proc)} log`] }),
  ),
];
