/**
 * @file control-owner.test.ts
 * @description Exclusive control arbitration: teleop preempts everything, VLA
 *              and Agent Mode refuse to take a lock somebody else holds. Plus
 *              what the controller hangs off the lock — the scene it kept is
 *              wiped when somebody else takes control, and the periodic pose
 *              feed only counts as motion while they might be driving.
 * @feature agentmode
 * @status test
 */

import { describe, it, expect, vi } from 'vitest';
import { AgentModeController } from '../agent-mode-controller.js';
import { ControlOwnerLock, type OwnerChange } from '../control-owner.js';
import { RangeSensor } from '../range.js';
import { SceneMemoryStore } from '../scene-memory.js';
import type { Planner } from '../planner.js';
import type { ServerMirror } from '../server-mirror.js';
import type { VisionClient, VisionObservation } from '../vision.js';
import type { RobotStateManager } from '../../robot/state.js';

const EMPTY_VIEW: VisionObservation = {
  currentView: 'ein leerer Raum',
  entities: [],
  personVisible: false,
  raw: '{}',
  degraded: false,
};

/** What `RobotStateManager.getPlaceBelief()` answers — mutable, as the poll is. */
interface Belief {
  place: null;
  poseM: { x: number; y: number } | null;
  poseSource: 'odometry' | 'declared' | null;
  driftSinceAnchorM: number | null;
  ageMs: number | null;
  insideKeepout: null;
}

/**
 * The hardware client's cached base pose, as the controller reads it — mutable,
 * because the 2 s poll rewrites it under the controller's feet and that is the
 * whole subject of these tests. `null` is a routine answer (`/loco/odom` times
 * out on any hiccup), never the origin.
 */
interface PoseCache {
  value: { x: number; y: number; yawDeg: number; source: string; atMs: number } | null;
}

/**
 * A controller wired to `lock`, `scene` and a pose cache, and to nothing else
 * that moves — no disk, no sidecar, no camera. These tests are about what the
 * controller does when the LOCK changes hands, and about the pose feed it
 * drives from `syncPlace`.
 *
 * `belief` is OPTIONAL and most of these pass none, which is the point: a robot
 * with no place graph has no place belief at all (`getPlaceBelief()` answers
 * null outright), and the pose feed has to work on it — that fleet is the
 * majority, not an edge case (TASK-221 review).
 */
function rig(lock: ControlOwnerLock, belief?: Belief) {
  const scene = new SceneMemoryStore('robot-1');
  const pose: PoseCache = { value: null };
  const controller = new AgentModeController({
    robotId: 'robot-1',
    enabled: true,
    lock,
    scene,
    mapKeeper: null,
    peerTracker: null,
    memory: null,
    journal: null,
    identity: null,
    getPose: () => pose.value,
    planner: { plan: async () => ({ blocks: [], fallback: false, attempts: 1 }) } as unknown as Planner,
    mirror: { emit: () => {}, push: async () => {}, logBlock: async () => {} } as unknown as ServerMirror,
    vision: { observe: async () => EMPTY_VIEW } as unknown as VisionClient,
    range: new RangeSensor({ enabled: false }),
    sleep: async () => {},
    now: () => 1e12,
  });
  if (belief) {
    controller.attach({
      isEStopTriggered: () => false,
      isTeleopActive: () => false,
      isVLAActive: () => false,
      getState: () => ({ batteryLevel: 90 }),
      getPlaceBelief: () => belief,
      getPlaces: () => [],
      getPlaceFrameRegistration: () => ({ registered: true, how: 'identity' }),
    } as unknown as RobotStateManager);
  }
  /** Move the cached pose, as the 2 s poll does. */
  const at = (x: number, y: number): void => {
    pose.value = { x, y, yawDeg: 0, source: 'state', atMs: 1e12 };
  };
  return { controller, scene, pose, at };
}

/** One table, measured, straight ahead — the thing a stale `goto` walks off. */
function seeTable(scene: SceneMemoryStore): void {
  scene.merge(
    {
      currentView: 'a table',
      personVisible: false,
      raw: '{}',
      degraded: false,
      entities: [
        { label: 'table', bearingDeg: 0, distanceEstM: 0.55, distanceSource: 'lidar', confidence: 0.9 },
      ],
    },
    undefined,
    { forwardClearanceM: 0.55 }
  );
}

describe('ControlOwnerLock', () => {
  it('starts idle', () => {
    expect(new ControlOwnerLock().get()).toBe('idle');
  });

  it('grants the lock from idle', () => {
    const lock = new ControlOwnerLock();
    expect(lock.claim('agent')).toEqual({ ok: true });
    expect(lock.get()).toBe('agent');
  });

  it('is idempotent for the current owner', () => {
    const lock = new ControlOwnerLock();
    lock.claim('agent');
    expect(lock.claim('agent')).toEqual({ ok: true });
    expect(lock.get()).toBe('agent');
  });

  it('refuses VLA while Agent Mode owns control', () => {
    const lock = new ControlOwnerLock();
    lock.claim('agent');

    const claim = lock.claim('vla');

    expect(claim.ok).toBe(false);
    expect(claim.reason).toMatch(/Agent Mode/);
    expect(lock.get()).toBe('agent');
  });

  it('refuses Agent Mode while a VLA rollout owns control', () => {
    const lock = new ControlOwnerLock();
    lock.claim('vla');

    const claim = lock.claim('agent');

    expect(claim.ok).toBe(false);
    expect(claim.reason).toMatch(/VLA skill rollout/);
    expect(lock.get()).toBe('vla');
  });

  it('lets human teleop preempt Agent Mode', () => {
    const lock = new ControlOwnerLock();
    lock.claim('agent');

    const claim = lock.claim('teleop');

    expect(claim.ok).toBe(true);
    expect(claim.preempted).toBe('agent');
    expect(lock.get()).toBe('teleop');
  });

  it('lets human teleop preempt a VLA rollout too', () => {
    const lock = new ControlOwnerLock();
    lock.claim('vla');

    expect(lock.claim('teleop')).toEqual({ ok: true, preempted: 'vla' });
  });

  it('reports no preemption when teleop takes an idle lock', () => {
    const lock = new ControlOwnerLock();
    expect(lock.claim('teleop')).toEqual({ ok: true });
  });

  it('notifies subscribers with the preemption flag', () => {
    const lock = new ControlOwnerLock();
    const changes: OwnerChange[] = [];
    lock.subscribe((c) => changes.push(c));

    lock.claim('agent');
    lock.claim('teleop');
    lock.release('teleop');

    expect(changes).toEqual([
      { previous: 'idle', next: 'agent', preempted: false },
      { previous: 'agent', next: 'teleop', preempted: true },
      { previous: 'teleop', next: 'idle', preempted: false },
    ]);
  });

  it('does NOT free the lock when only one of two holders releases', () => {
    const lock = new ControlOwnerLock();
    // Two teleop sockets — an ordinary state, not a race: four frontend views
    // open /ws/keyboard-teleop and each one claims.
    lock.claim('teleop');
    lock.claim('teleop');
    expect(lock.holderCount()).toBe(2);

    lock.release('teleop');

    // A human is still at the controls on the other socket.
    expect(lock.get()).toBe('teleop');
    expect(lock.holderCount()).toBe(1);

    lock.release('teleop');

    expect(lock.get()).toBe('idle');
    expect(lock.holderCount()).toBe(0);
  });

  it('emits no owner-change events for nested claims and releases', () => {
    const lock = new ControlOwnerLock();
    const changes: OwnerChange[] = [];
    lock.subscribe((c) => changes.push(c));

    lock.claim('teleop');
    lock.claim('teleop');
    lock.release('teleop');
    lock.release('teleop');

    expect(changes).toEqual([
      { previous: 'idle', next: 'teleop', preempted: false },
      { previous: 'teleop', next: 'idle', preempted: false },
    ]);
  });

  it('a preempting teleop claim replaces the previous owner’s holders', () => {
    const lock = new ControlOwnerLock();
    lock.claim('agent');

    lock.claim('teleop');
    expect(lock.holderCount()).toBe(1);

    // The displaced owner's late release must not touch the human's lock.
    lock.release('agent');
    expect(lock.get()).toBe('teleop');

    lock.release('teleop');
    expect(lock.get()).toBe('idle');
  });

  it('reset() drops every holder', () => {
    const lock = new ControlOwnerLock();
    lock.claim('teleop');
    lock.claim('teleop');

    lock.reset();

    expect(lock.get()).toBe('idle');
    expect(lock.holderCount()).toBe(0);
  });

  it('never counts holders below zero on an over-release', () => {
    const lock = new ControlOwnerLock();
    lock.claim('agent');
    lock.release('agent');
    lock.release('agent'); // owner is already idle — no-op

    expect(lock.get()).toBe('idle');
    expect(lock.holderCount()).toBe(0);
    expect(lock.claim('agent')).toEqual({ ok: true });
    expect(lock.get()).toBe('agent');
  });

  it('ignores a release from a non-owner', () => {
    const lock = new ControlOwnerLock();
    lock.claim('agent');

    lock.release('vla');

    expect(lock.get()).toBe('agent');
  });

  it('keeps working when a listener throws', () => {
    const lock = new ControlOwnerLock();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    lock.subscribe(() => {
      throw new Error('boom');
    });

    expect(() => lock.claim('agent')).not.toThrow();
    expect(lock.get()).toBe('agent');
    spy.mockRestore();
  });
});

describe('the scene the agent kept, when control changes hands (TASK-221)', () => {
  it('wipes it when a human takes the lock BETWEEN two plans', () => {
    // The failure the fix is for, and the reason this hook is not keyed on
    // `previous === 'agent'`: `runPlan`'s finally releases the lock, so by the
    // time the operator claims teleop the lock has long since gone back to
    // `idle`. Nothing here is ever a transition out of `'agent'`.
    const lock = new ControlOwnerLock();
    const { scene } = rig(lock);
    lock.claim('agent'); // a plan ran…
    lock.release('agent'); // …and finished, as every plan does
    seeTable(scene);
    expect(scene.get('table')?.distanceEstM).toBe(0.55);

    lock.claim('teleop');

    expect(scene.get('table')).toBeUndefined();
    expect(scene.snapshot()).toBeNull();
    expect(scene.getForwardClearanceM()).toBeNull();
  });

  it('wipes it when teleop preempts a running plan', () => {
    const lock = new ControlOwnerLock();
    const { scene } = rig(lock);
    lock.claim('agent');
    seeTable(scene);

    lock.claim('teleop');

    expect(scene.get('table')).toBeUndefined();
  });

  it('wipes it for a VLA rollout too — the agent did not drive that either', () => {
    const lock = new ControlOwnerLock();
    const { scene } = rig(lock);
    seeTable(scene);

    lock.claim('vla');

    expect(scene.get('table')).toBeUndefined();
  });

  it('leaves it alone across Agent Mode taking and releasing its own lock', () => {
    // A plan starting must not cost the robot what it looked at before it.
    const lock = new ControlOwnerLock();
    const { scene } = rig(lock);
    seeTable(scene);

    lock.claim('agent');
    lock.release('agent');

    expect(scene.get('table')?.distanceEstM).toBe(0.55);
    expect(scene.getForwardClearanceM()).toBe(0.55);
  });
});

describe('the periodic pose feed into scene memory (TASK-221)', () => {
  const belief = (): Belief => ({
    place: null,
    poseM: { x: 0, y: 0 },
    poseSource: 'odometry',
    driftSinceAnchorM: null,
    ageMs: 0,
    insideKeepout: null,
  });

  it('counts a drive nobody commanded on a robot with NO place graph', () => {
    // The TASK-221 review's second finding, and the reason this rig attaches no
    // state manager at all. Four metres of teleop between two commands: no
    // block ran, so nothing called `noteTranslationM`, and the 2 s pose poll is
    // the only witness. Keying that poll on `getPlaceBelief()` made it inert
    // here — an unmapped robot HAS no belief — which is the steady state of
    // every robot nobody has surveyed, not a window.
    const lock = new ControlOwnerLock();
    const { controller, scene, at } = rig(lock);
    // A fix BEFORE the look, which is the production order: `observeAndMerge`
    // refreshes the yaw — and with it the position — on its way into the merge.
    at(0, 0);
    controller.getScene();
    seeTable(scene);
    controller.getScene();
    expect(scene.hasMovedSinceObservation()).toBe(false);

    at(-4, 0);
    controller.getScene();

    expect(scene.hasMovedSinceObservation()).toBe(true);
    expect(scene.get('table')?.distanceEstM).toBeNull();
  });

  it('counts it on a mapped robot too — the belief is not what it reads', () => {
    const lock = new ControlOwnerLock();
    const { controller, scene, at } = rig(lock, belief());
    at(0, 0);
    controller.getScene();
    seeTable(scene);

    at(-4, 0);
    controller.getScene();

    expect(scene.hasMovedSinceObservation()).toBe(true);
    expect(scene.get('table')?.distanceEstM).toBeNull();
  });

  it('does NOT feed the 2 s cache in while Agent Mode is the one driving', () => {
    // Mid-navigation the cached pose can be a whole walk stage behind the fresh
    // fix `refreshYaw` just took, and the commanded metres already say
    // everything this feed could. Letting it in would cost an extra look per
    // goto whenever the UI happened to poll.
    const lock = new ControlOwnerLock();
    const { controller, scene, at } = rig(lock);
    at(0, 0);
    controller.getScene();
    seeTable(scene);
    lock.claim('agent');

    at(-4, 0);
    controller.getScene();

    expect(scene.hasMovedSinceObservation()).toBe(false);
    expect(scene.get('table')?.distanceEstM).toBe(0.55);
  });

  it('says nothing when there is no pose — a null is not the origin', () => {
    // `/loco/odom` times out on any hiccup and the cache goes null. That is the
    // absence of a measurement, and reading it as (0, 0) would teleport the
    // robot to the frame origin and expire everything it holds.
    const lock = new ControlOwnerLock();
    const { controller, scene, pose, at } = rig(lock);
    at(3, 4);
    controller.getScene();
    seeTable(scene);

    pose.value = null;
    controller.getScene();

    expect(scene.hasMovedSinceObservation()).toBe(false);
    expect(scene.get('table')?.distanceEstM).toBe(0.55);
  });

  it('ignores a DECLARED pose — an operator correcting the belief is not the robot moving', () => {
    // Reading the hardware pose rather than the belief is what makes this hold
    // without a guard: a re-anchor moves `poseM` to a place the operator
    // asserted, and the odometry the robot actually measures does not move.
    const state = belief();
    const lock = new ControlOwnerLock();
    const { controller, scene, at } = rig(lock, state);
    at(0, 0);
    controller.getScene();
    seeTable(scene);

    state.poseSource = 'declared';
    state.poseM = { x: -4, y: 0 };
    controller.getScene();

    expect(scene.hasMovedSinceObservation()).toBe(false);
    expect(scene.get('table')?.distanceEstM).toBe(0.55);
  });
});
