/**
 * @file readinessDemoHandlers.ts
 * @description Robot readiness fixtures and MSW handlers (TASK-411): one
 *              `RobotReadiness` per reason the panel must explain, for the
 *              component tests, and a small stateful robot side for the demo
 *              build — Start walks the steps through `starting` to `ready`,
 *              Stop returns them to `stopped`. Registered by a one-line spread
 *              in `handlers.ts`.
 * @feature mocks
 */

import { http, HttpResponse } from 'msw';
import type {
  AgentReadiness,
  BringupStatus,
  BringupStep,
  BringupStepId,
  HandHealth,
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

function snapshot(parts: Partial<RobotReadiness> & { agentReadiness?: AgentReadiness | null } = {}): RobotReadiness {
  const { agentReadiness: ar, ...rest } = parts;
  const readiness = ar === undefined ? agentReadiness() : ar;
  return {
    robotId: 'demo-g1-001',
    at: AT,
    agent: { reachable: readiness !== null, error: readiness ? null : 'connect ECONNREFUSED 127.0.0.1:41245', readiness },
    bringup: bringup(),
    supervisor: { reachable: true, error: null },
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
} satisfies Record<string, RobotReadiness>;

export type ReadinessFixtureName = keyof typeof READINESS_FIXTURES;

/** A fixture for another robot id (deep enough for the panel). */
export function readinessFor(robotId: string, name: ReadinessFixtureName): RobotReadiness {
  const f = READINESS_FIXTURES[name];
  return { ...f, robotId, bringup: f.bringup ? { ...f.bringup, robotId } : null };
}

// ============================================================================
// DEMO ROBOT SIDE — stateful, per robot
// ============================================================================

interface DemoSide {
  phase: 'stopped' | 'starting' | 'ready';
  startedAt: number;
}

const sides = new Map<string, DemoSide>();
/** How long the demo's Start takes per step. */
const DEMO_STEP_MS = 700;

function demoSnapshot(robotId: string): RobotReadiness {
  const side = sides.get(robotId) ?? { phase: 'stopped', startedAt: 0 };
  if (side.phase === 'stopped') return readinessFor(robotId, 'bringup_stopped');
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

export const readinessDemoHandlers = [
  http.get('/api/robots/:id/readiness', ({ params }) => HttpResponse.json(demoSnapshot(String(params.id)))),
  http.get('/api/robots/:id/bringup', ({ params }) => HttpResponse.json(demoSnapshot(String(params.id)).bringup)),
  http.post('/api/robots/:id/bringup/start', async ({ params, request }) => {
    const body = (await request.json().catch(() => ({}))) as { mode?: string };
    if (body.mode !== 'read_only') {
      return HttpResponse.json({ code: 'demo_read_only', error: 'the demo starts read-only only' }, { status: 400 });
    }
    sides.set(String(params.id), { phase: 'starting', startedAt: Date.now() });
    return HttpResponse.json({ ok: true, accepted: true });
  }),
  http.post('/api/robots/:id/bringup/stop', ({ params }) => {
    sides.set(String(params.id), { phase: 'stopped', startedAt: 0 });
    return HttpResponse.json({ status: demoSnapshot(String(params.id)).bringup, baseMode: null });
  }),
  http.post('/api/robots/:id/bringup/sidecar-mode', () =>
    HttpResponse.json({ code: 'demo', error: 'The demo has no robot to switch to arm control.' }, { status: 409 }),
  ),
  http.get('/api/robots/:id/bringup/logs/:proc', ({ params }) =>
    HttpResponse.json({ proc: params.proc, lines: [`[demo] ${String(params.proc)} log`] }),
  ),
];
