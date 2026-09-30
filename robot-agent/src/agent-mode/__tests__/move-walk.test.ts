/**
 * @file move-walk.test.ts
 * @description TASK-336: the controller's side of `move` on a sidecar-backed
 *              robot. `walkTo` drives the same navigator + LocoClient path a
 *              `goto {place}` does, settles `done` only when the walk has
 *              ended, and refuses before any motion when the frame is not
 *              registered, there is no graph, the target is a keepout or an
 *              E-Stop is latched.
 * @feature agentmode
 * @status test
 */

import { describe, it, expect } from 'vitest';
import { AgentModeController } from '../agent-mode-controller.js';
import { ControlOwnerLock } from '../control-owner.js';
import { RangeSensor } from '../range.js';
import { SceneMemoryStore } from '../scene-memory.js';
import type { Planner } from '../planner.js';
import type { Place } from '../place-resolver.js';
import type { FrameRegistration } from '../place-frame.js';
import type { ServerMirror } from '../server-mirror.js';
import type { VisionClient, VisionObservation } from '../vision.js';
import type { RobotStateManager } from '../../robot/state.js';

const EMPTY_VIEW: VisionObservation = {
  currentView: 'an empty floor',
  entities: [],
  personVisible: false,
  raw: '{}',
  degraded: false,
};

function square(id: string, cx: number, cy: number, half: number, keepout = false): Place {
  return {
    id,
    name: id,
    placeType: keepout ? 'unknown' : 'charging',
    floor: 0,
    polygon: [
      [cx - half, cy - half],
      [cx + half, cy - half],
      [cx + half, cy + half],
      [cx - half, cy + half],
    ],
    source: 'surveyed',
    keepout,
    landmarks: [],
  };
}

/** The robot stands at the origin, inside HERE. */
const HERE = square('HERE', 0, 0, 2);
const FAR = square('CHARGING-A', 0, -8, 1);
const RACK = square('RACK-A', 5, 0, 1, true);

interface RigOptions {
  registration?: FrameRegistration | null;
  estop?: boolean;
  /** Held open until released — lets a test act while a stage is walking. */
  gate?: Promise<void>;
}

function rig(opts: RigOptions = {}) {
  const moves: number[] = [];
  const actions: string[] = [];
  const planned: string[] = [];
  const registration = opts.registration === undefined ? { registered: true, how: 'identity' } : opts.registration;
  const controller = new AgentModeController({
    robotId: 'robot-1',
    // `move` is an operator's order, not autonomy: it must walk with the mode off.
    enabled: false,
    lock: new ControlOwnerLock(),
    scene: new SceneMemoryStore('robot-1'),
    mapKeeper: null,
    peerTracker: null,
    navPlanner: 'grid',
    maxNavStages: 3,
    getPose: () => ({ x: 0, y: 0, yawDeg: 0, source: 'sim', atMs: 1e12 }),
    planner: {
      plan: async (input: { command: string }) => {
        planned.push(input.command);
        return { blocks: [], fallback: false, attempts: 1 };
      },
    } as unknown as Planner,
    mirror: { emit: () => {}, push: async () => {}, logBlock: async () => {} } as unknown as ServerMirror,
    vision: { observe: async () => EMPTY_VIEW } as unknown as VisionClient,
    range: new RangeSensor({ enabled: false }),
    loco: {
      move: async (vx) => {
        moves.push(vx);
        if (opts.gate) await opts.gate;
        return { ok: true };
      },
      action: async (name) => {
        actions.push(name);
        return { ok: true };
      },
      fsm: async () => ({ ok: true }),
      standHeight: async () => ({ ok: true }),
      odometry: async () => null,
    },
    sleep: async () => {},
    now: () => 1e12,
  });
  controller.attach({
    isEStopTriggered: () => opts.estop === true,
    isTeleopActive: () => false,
    isVLAActive: () => false,
    getState: () => ({ batteryLevel: 90 }),
    getPlaceBelief: () => null,
    getPlaces: () => [HERE, FAR, RACK],
    getPlaceFrameRegistration: () => registration,
  } as unknown as RobotStateManager);
  return { controller, moves, actions, planned };
}

describe('AgentModeController.walkTo — the move walk (TASK-336)', () => {
  it('arrives in a place the robot already stands in, and only then reports ok', async () => {
    const h = rig();
    const start = await h.controller.walkTo({ x: 0, y: 0, place: 'HERE' });
    expect(start.ok).toBe(true);
    if (!start.ok) return;

    const outcome = await start.done;
    expect(outcome.ok).toBe(true);
    expect(outcome.message).toMatch(/Arrived in HERE/);
    const plan = h.controller.getState().plan!;
    expect(plan.command).toBe('move: HERE');
    expect(plan.status).toBe('done');
    expect(plan.blocks).toHaveLength(1);
    expect(plan.blocks[0]!.kind).toBe('goto');
    // Built from a template: the LLM planner is never asked.
    expect(h.planned).toHaveLength(0);
    expect(h.controller.isRunning()).toBe(false);
  });

  it('walks toward a far place over LocoClient and reports the real ending, not a success', async () => {
    const h = rig();
    const start = await h.controller.walkTo({ x: 0, y: -8, place: 'CHARGING-A' });
    expect(start.ok).toBe(true);
    if (!start.ok) return;

    const outcome = await start.done;
    // The stubbed pose never changes, so the robot never gets there — and
    // must say so rather than claim it arrived.
    expect(h.moves.length).toBeGreaterThan(0);
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toMatch(/^move to CHARGING-A failed: /);
  });

  it('walks to bare coordinates as a small square around the point', async () => {
    const h = rig();
    const start = await h.controller.walkTo({ x: 0.2, y: -0.1 });
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    const outcome = await start.done;
    expect(outcome.ok).toBe(true);
    expect(h.controller.getState().plan!.command).toBe('move: (0.20, -0.10)');
  });

  it('refuses on a frame that is not registered to the twin — before any motion', async () => {
    const h = rig({ registration: { registered: false, reason: 'twin frame vs odometry' } });
    const start = await h.controller.walkTo({ x: 0, y: -8, place: 'CHARGING-A' });
    expect(start).toEqual({
      ok: false,
      message: "move refused: the robot's frame is not registered to its twin — twin frame vs odometry",
    });
    expect(h.moves).toHaveLength(0);
    expect(h.controller.getState().plan).toBeNull();
  });

  it('refuses without a place graph — twin coordinates mean nothing then', async () => {
    const h = rig({ registration: null });
    const start = await h.controller.walkTo({ x: 1, y: 1 });
    expect(start.ok).toBe(false);
    if (start.ok) return;
    expect(start.message).toMatch(/has no place graph/);
    expect(h.moves).toHaveLength(0);
  });

  it('refuses a keepout and an unknown place by id', async () => {
    const h = rig();
    const keepout = await h.controller.walkTo({ x: 5, y: 0, place: 'RACK-A' });
    expect(keepout).toEqual({ ok: false, message: 'move refused: "RACK-A" is a keepout.' });
    const unknown = await h.controller.walkTo({ x: 5, y: 0, place: 'NOPE' });
    expect(unknown.ok).toBe(false);
    expect(h.moves).toHaveLength(0);
  });

  it('refuses while an E-Stop is latched', async () => {
    const h = rig({ estop: true });
    const start = await h.controller.walkTo({ x: 0, y: 0, place: 'HERE' });
    expect(start.ok).toBe(false);
    if (start.ok) return;
    expect(start.message).toMatch(/E-Stop is latched/);
  });

  it('stopMoveWalk aborts the running walk and stops the base; a second move meanwhile is refused', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const h = rig({ gate });
    const start = await h.controller.walkTo({ x: 0, y: -8, place: 'CHARGING-A' });
    expect(start.ok).toBe(true);
    if (!start.ok) return;

    // Wait until the first stage is actually walking.
    for (let i = 0; i < 50 && h.moves.length === 0; i++) await new Promise((r) => setTimeout(r, 0));
    expect(h.moves.length).toBeGreaterThan(0);

    const second = await h.controller.walkTo({ x: 0, y: 0, place: 'HERE' });
    expect(second.ok).toBe(false);

    expect(h.controller.stopMoveWalk('Stop command received')).toBe(true);
    release();
    const outcome = await start.done;
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toMatch(/aborted/);
    expect(h.actions).toContain('stop');
    expect(h.controller.stopMoveWalk('again')).toBe(false);
  });
});
