/**
 * @file patrol-plumbing.test.ts
 * @description The controller's side of TASK-212: `startPatrol` refuses fail-
 *              closed and records a skipped run, runs a route as ONE plan whose
 *              leading `patrol` block stays running while the legs run, aborts the
 *              route after two failed legs, and — the interrupt rule — an operator
 *              command during a patrol aborts the run and then runs as a fresh plan.
 * @feature agentmode
 * @status test
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AgentModeController } from '../agent-mode-controller.js';
import { ControlOwnerLock } from '../control-owner.js';
import { PatrolRouteSource } from '../patrol.js';
import { RangeSensor } from '../range.js';
import { SceneMemoryStore } from '../scene-memory.js';
import { Workspace } from '../workspace.js';
import type { Planner, PlannedBlock } from '../planner.js';
import type { Place } from '../place-resolver.js';
import type { ServerMirror } from '../server-mirror.js';
import type { VisionClient, VisionObservation } from '../vision.js';
import type { RobotStateManager } from '../../robot/state.js';
import type { AgentModeEvent, PatrolRoute } from '../types.js';

// The voice service is what a controller built WITHOUT an injected `say` talks
// to (production: `new AgentModeController()`); the person line must reach it.
const voiceSay = vi.fn(async (_text: string, _language?: string) => true);
vi.mock('../voice-narrator.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../voice-narrator.js')>();
  return { ...mod, speakThroughVoiceService: (text: string, language?: string) => voiceSay(text, language) };
});

const VIEW: VisionObservation = {
  currentView: 'a hallway',
  entities: [{ label: 'wall', bearingDeg: 0, distanceEstM: 3, confidence: 0.9 }],
  personVisible: false,
  raw: '{}',
  degraded: false,
};

/** Every place contains the origin and is centred on it, so a `goto` arrives at once. */
function place(id: string, name: string, half: number): Place {
  return {
    id,
    name,
    placeType: 'cell',
    floor: 0,
    polygon: [[-half, -half], [half, -half], [half, half], [-half, half]],
    source: 'surveyed',
    keepout: false,
    landmarks: [],
  };
}
const PLACES = [place('HALLWAY', 'Hallway', 1.2), place('KITCHEN', 'Kitchen', 1.4), place('LIVING-ROOM', 'Living Room', 1.6)];

const ROUTE: PatrolRoute = {
  id: 'house-round',
  name: 'House round',
  robotId: 'robot-1',
  twinId: null,
  checkpoints: [
    { id: 'cp-hall', placeId: 'HALLWAY', name: 'Hallway', headingDeg: null, actions: [] },
    { id: 'cp-kitchen', placeId: 'KITCHEN', name: 'Kitchen', headingDeg: null, actions: ['dwell'], dwellMs: 2000 },
    { id: 'cp-living', placeId: 'LIVING-ROOM', name: 'Living room', headingDeg: null, actions: [] },
  ],
  cronExpression: null,
  enabled: true,
  timeWindows: [],
  homePlaceId: 'HALLWAY',
  createdAt: '2026-08-16T00:00:00.000Z',
  updatedAt: '2026-08-16T00:00:00.000Z',
};

interface RigOpts {
  patrolEnabled?: boolean;
  navPlanner?: 'grid' | 'staged';
  battery?: number;
  placeKnown?: boolean;
  plannerBlocks?: PlannedBlock[];
  /** Build the controller WITHOUT `say`, as production does. */
  noSay?: boolean;
  personVisible?: boolean;
}

function rig(opts: RigOpts = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'neodem-patrol-ctl-'));
  const ws = new Workspace({ root, robotId: 'robot-1' });
  ws.ensure();
  const events: AgentModeEvent[] = [];
  const said: string[] = [];
  const scene = new SceneMemoryStore('robot-1');
  // The controller builds its own PatrolRunner over `memory` (the workspace
  // below) — the production wiring, which is what this file tests.
  const controller = new AgentModeController({
    robotId: 'robot-1',
    enabled: true,
    lock: new ControlOwnerLock(),
    scene,
    mapKeeper: null,
    peerTracker: null,
    memory: ws,
    journal: null,
    identity: null,
    navPlanner: opts.navPlanner ?? 'grid',
    patrolEnabled: opts.patrolEnabled ?? true,
    // No server in this test: a route that is not inline is unknown.
    patrolRoutes: new PatrolRouteSource({
      serverUrl: 'http://127.0.0.1:9',
      cachePath: path.join(root, 'routes.json'),
      fetchImpl: (async () => {
        throw new Error('offline');
      }) as unknown as typeof fetch,
    }),
    getPose: () => ({ x: 0, y: 0, yawDeg: 0, source: 'sim', atMs: 1e12 }),
    planner: {
      plan: async () => ({ blocks: opts.plannerBlocks ?? [{ kind: 'wave', params: {} }], fallback: false, attempts: 1 }),
    } as unknown as Planner,
    mirror: { emit: () => {}, push: async () => {}, logBlock: async () => {}, uploadPatrolPhoto: () => {} } as unknown as ServerMirror,
    vision: { observe: async () => ({ ...VIEW, personVisible: opts.personVisible === true }) } as unknown as VisionClient,
    range: new RangeSensor({ enabled: false }),
    loco: {
      move: async () => ({ ok: true }),
      action: async () => ({ ok: true }),
      fsm: async () => ({ ok: true }),
      standHeight: async () => ({ ok: true }),
      odometry: async () => null,
    },
    ...(opts.noSay
      ? {}
      : {
          say: async (text: string) => {
            said.push(text);
            return true;
          },
        }),
    // A dwell of 2 s runs as 20 × 100 ms slices; 2 ms each keeps the run
    // interruptible for real without making the test slow.
    sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 2))),
    snapshot: async () => Buffer.from('nope').toString('base64'),
  });
  controller.subscribe((e) => events.push(e));
  controller.attach({
    isEStopTriggered: () => false,
    isTeleopActive: () => false,
    isVLAActive: () => false,
    getState: () => ({ batteryLevel: opts.battery ?? 90 }),
    getPlaceBelief: () =>
      opts.placeKnown === false
        ? { place: null, poseM: null, poseSource: null, driftSinceAnchorM: null, ageMs: null, insideKeepout: null }
        : {
            place: { id: 'HALLWAY', name: 'Hallway', placeType: 'cell', confidence: 'confirmed', source: 'surveyed' },
            poseM: { x: 0, y: 0 },
            poseSource: 'odometry',
            driftSinceAnchorM: 0,
            ageMs: 500,
            insideKeepout: false,
          },
    getPlaces: () => PLACES,
    getPlaceFrameRegistration: () => ({ registered: true, how: 'identity' }),
    triggerEmergencyStop: () => {},
    resetEmergencyStop: () => true,
  } as unknown as RobotStateManager);
  return { controller, events, said, root, ws };
}

describe('patrol plumbing — startPatrol', () => {
  const rigs: Array<ReturnType<typeof rig>> = [];
  afterEach(() => {
    for (const r of rigs.splice(0)) {
      r.controller.dispose();
      fs.rmSync(r.root, { recursive: true, force: true });
    }
  });

  it('refuses when disabled — not an error, and a skipped run is announced for the server', async () => {
    const h = rig({ patrolEnabled: false });
    rigs.push(h);
    const res = await h.controller.startPatrol({ routeId: ROUTE.id, mode: 'patrol', origin: 'scheduled', route: ROUTE });
    expect(res).toMatchObject({ accepted: false, reason: 'disabled' });
    const finished = h.events.filter((e) => e.type === 'agent:patrol:finished');
    expect(finished).toHaveLength(1);
    expect(finished[0]!.patrol).toMatchObject({ status: 'skipped', routeId: 'house-round', origin: 'scheduled' });
    expect(finished[0]!.patrol!.reason).toMatch(/^disabled:/);
    expect(h.controller.patrolStatus()).toMatchObject({ enabled: false, active: null });
    expect(h.controller.patrolStatus().lastRun?.status).toBe('skipped');
    expect(h.controller.getState().plan).toBeNull();
  });

  it('refuses a scheduled start on low battery / unknown place, and an unknown route id (no inline route, no server)', async () => {
    const low = rig({ battery: 10 });
    rigs.push(low);
    expect(await low.controller.startPatrol({ routeId: ROUTE.id, origin: 'scheduled', route: ROUTE })).toMatchObject({ accepted: false, reason: 'battery' });
    const lost = rig({ placeKnown: false });
    rigs.push(lost);
    expect(await lost.controller.startPatrol({ routeId: ROUTE.id, origin: 'scheduled', route: ROUTE })).toMatchObject({ accepted: false, reason: 'place_unknown' });
    // The operator may still start it — a human is there.
    expect((await low.controller.startPatrol({ routeId: ROUTE.id, origin: 'operator', route: ROUTE })).accepted).toBe(true);
    await low.controller.whenIdle();
    const unknown = await lost.controller.startPatrol({ routeId: 'no-such-route', origin: 'operator' });
    expect(unknown).toMatchObject({ accepted: false, reason: 'route_unknown' });
    expect(lost.controller.patrolRuns(5).map((r) => r.status)).toEqual(['skipped', 'skipped']);
  });

  it('runs a route as ONE plan: leading patrol block stays running while the legs run and carries the summary; a start notice is spoken', async () => {
    const h = rig();
    rigs.push(h);
    const res = await h.controller.startPatrol({ routeId: ROUTE.id, mode: 'baseline', origin: 'operator', route: ROUTE });
    expect(res.accepted).toBe(true);
    // While running: the plan is the patrol, and its first block is `patrol`, running.
    const running = h.controller.getState().plan!;
    expect(running.command).toBe('patrol: House round');
    expect(running.blocks[0]!.kind).toBe('patrol');
    expect(running.blocks[0]!.status).toBe('running');
    expect(h.controller.patrolStatus().active?.runId).toBe(res.runId);
    await h.controller.whenIdle();
    const plan = h.controller.getState().plan!;
    expect(plan.status).toBe('done');
    expect(plan.blocks[0]!.status).toBe('done');
    expect(plan.blocks[0]!.result).toMatch(/Baseline done: 3\/3 checkpoint\(s\), 0 finding\(s\)/);
    expect(plan.blocks.map((b) => b.kind)).toEqual(['patrol', 'speak', 'goto', 'goto', 'wait', 'goto', 'goto']);
    expect(plan.blocks.every((b) => b.status === 'done')).toBe(true);
    expect(h.said).toEqual(['Starting the baseline walk; I take reference photos.']);
    const types = h.events.map((e) => e.type);
    expect(types[0]).toBe('agent:plan:started');
    // Three checkpoints, six leg events: start and settle each (TASK-222).
    expect(types.filter((t) => t === 'agent:patrol:leg')).toHaveLength(6);
    expect(types.indexOf('agent:patrol:started')).toBeLessThan(types.indexOf('agent:patrol:leg'));
    expect(types.indexOf('agent:patrol:finished')).toBeLessThan(types.indexOf('agent:plan:finished'));
    const last = h.controller.patrolStatus().lastRun!;
    expect(last.status).toBe('done');
    expect(last.planId).toBe(plan.id);
    expect(last.legs.map((l) => l.status)).toEqual(['done', 'done', 'done']);
    // The run is on disk under the workspace, and the detail route can read it back.
    expect(fs.existsSync(path.join(h.root, 'patrol', 'house-round', 'runs', last.runId, 'run.json'))).toBe(true);
    expect(h.controller.patrolRun(last.runId)?.findings).toEqual([]);
    expect(h.controller.placesForApi().map((p) => p.id)).toEqual(['HALLWAY', 'KITCHEN', 'LIVING-ROOM']);
  });

  it('two consecutive failed legs (no map planner → every goto fails) abort the run and the plan reports it', async () => {
    const h = rig({ navPlanner: 'staged' });
    rigs.push(h);
    const res = await h.controller.startPatrol({ routeId: ROUTE.id, mode: 'patrol', origin: 'operator', route: ROUTE });
    expect(res.accepted).toBe(true);
    await h.controller.whenIdle();
    const run = h.controller.patrolStatus().lastRun!;
    expect(run.status).toBe('aborted');
    expect(run.reason).toBe('two consecutive legs failed');
    expect(run.legs.map((l) => l.status)).toEqual(['failed', 'failed', 'skipped']);
    const plan = h.controller.getState().plan!;
    expect(plan.status).toBe('aborted');
    expect(plan.blocks[0]!.error ?? plan.blocks[0]!.result).toMatch(/two consecutive legs failed/);
    // The living-room leg's goto was skipped with the reason; home was attempted (and failed the same way).
    const gotos = plan.blocks.filter((b) => b.kind === 'goto');
    expect(gotos.map((b) => b.status)).toEqual(['failed', 'failed', 'skipped', 'failed']);
    expect(gotos[2]!.error).toBe('two consecutive legs failed');
  });

  it('an operator command during a patrol aborts the run and then runs as a fresh plan', async () => {
    const h = rig();
    rigs.push(h);
    const res = await h.controller.startPatrol({ routeId: ROUTE.id, mode: 'patrol', origin: 'scheduled', route: ROUTE });
    expect(res.accepted).toBe(true);
    // Wait until the dwell (the wait block) is in flight, then interrupt.
    for (let i = 0; i < 200 && h.controller.getState().plan?.blocks.find((b) => b.kind === 'wait')?.status !== 'running'; i++) {
      await new Promise((r) => setTimeout(r, 2));
    }
    const patrolPlanId = h.controller.getState().plan!.id;
    const cmd = await h.controller.submitCommand({ text: 'wave' });
    expect(cmd).toMatchObject({ accepted: true, outcome: 'folded', planId: patrolPlanId });
    expect(cmd.message).toMatch(/stopping the patrol/);
    await h.controller.whenIdle();
    const run = h.controller.patrolStatus().lastRun!;
    expect(run.status).toBe('aborted');
    expect(run.reason).toMatch(/operator command/);
    expect(run.legs[1]!.status).toBe('failed');
    expect(run.legs[2]!.status).toBe('skipped');
    // …and the wave ran afterwards, as its own plan.
    const plan = h.controller.getState().plan!;
    expect(plan.id).not.toBe(patrolPlanId);
    expect(plan.command).toBe('wave');
    expect(plan.status).toBe('done');
    expect(h.controller.patrolStatus().active).toBeNull();
    // Nothing is left over: a second patrol can start.
    const again = await h.controller.startPatrol({ routeId: ROUTE.id, mode: 'patrol', origin: 'operator', route: ROUTE });
    expect(again.accepted).toBe(true);
    await h.controller.whenIdle();
  });

  it('a second start while a run is active is refused as running; abortPatrol ends it', async () => {
    const h = rig();
    rigs.push(h);
    const res = await h.controller.startPatrol({ routeId: ROUTE.id, mode: 'patrol', origin: 'operator', route: ROUTE });
    expect(res.accepted).toBe(true);
    const second = await h.controller.startPatrol({ routeId: ROUTE.id, mode: 'patrol', origin: 'operator', route: ROUTE });
    expect(second).toMatchObject({ accepted: false, reason: 'running' });
    expect(h.controller.abortPatrol('test')).toEqual({ ok: true, runId: res.runId });
    await h.controller.whenIdle();
    expect(h.controller.patrolStatus().lastRun?.status).toBe('aborted');
    expect(h.controller.abortPatrol('nothing')).toEqual({ ok: false });
  });

  it('without an injected `say` (production wiring) the person line still goes through the voice service', async () => {
    voiceSay.mockClear();
    const h = rig({ noSay: true, personVisible: true });
    rigs.push(h);
    const res = await h.controller.startPatrol({ routeId: ROUTE.id, mode: 'patrol', origin: 'operator', route: ROUTE });
    expect(res.accepted).toBe(true);
    // Four looks with a person in view while the run is active: the en-route
    // N-of-M confirmer settles on `person` and the runner speaks ONE line —
    // through the voice service, since nobody injected `say`.
    const ctl = h.controller as unknown as { onPatrolLook: (o: VisionObservation) => Promise<void> };
    for (let i = 0; i < 4; i++) await ctl.onPatrolLook({ ...VIEW, entities: [{ label: 'person', bearingDeg: 0, distanceEstM: 2, confidence: 0.9 }], personVisible: true });
    await h.controller.whenIdle();
    const texts = voiceSay.mock.calls.map((c) => c[0]);
    expect(texts).toContain('I am on patrol, please step aside.');
    expect(texts.filter((t) => t === 'I am on patrol, please step aside.')).toHaveLength(1);
    expect(h.events.some((e) => e.type === 'agent:finding:detected' && e.finding?.type === 'person')).toBe(true);
  });

  it('E-Stop during a patrol aborts the run like any plan and leaves the plan aborted', async () => {
    const h = rig();
    rigs.push(h);
    await h.controller.startPatrol({ routeId: ROUTE.id, mode: 'patrol', origin: 'operator', route: ROUTE });
    for (let i = 0; i < 200 && h.controller.getState().plan?.blocks.find((b) => b.kind === 'wait')?.status !== 'running'; i++) {
      await new Promise((r) => setTimeout(r, 2));
    }
    await h.controller.estop('test stop');
    await h.controller.whenIdle();
    expect(h.controller.getState().plan!.status).toBe('aborted');
    expect(h.controller.patrolStatus().lastRun?.status).toBe('aborted');
    expect(h.controller.patrolStatus().lastRun?.reason).toMatch(/test stop/);
    expect(h.events.filter((e) => e.type === 'agent:plan:finished')).toHaveLength(1);
  });
});
