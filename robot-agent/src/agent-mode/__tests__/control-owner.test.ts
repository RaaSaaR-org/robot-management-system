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
import type { AgentModeEvent } from '../types.js';

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
  const events: AgentModeEvent[] = [];
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
    mirror: {
      emit: (e: AgentModeEvent) => events.push(e),
      push: async () => {},
      logBlock: async () => {},
    } as unknown as ServerMirror,
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
  return { controller, scene, pose, at, events };
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
      { previous: 'idle', next: 'agent', preempted: false, handover: false },
      { previous: 'agent', next: 'teleop', preempted: true, handover: false },
      { previous: 'teleop', next: 'idle', preempted: false, handover: false },
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
      { previous: 'idle', next: 'teleop', preempted: false, handover: false },
      { previous: 'teleop', next: 'idle', preempted: false, handover: false },
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

  it('tells the operator about the wipe — the event carries null, not undefined', () => {
    // The wipe is only worth doing if it REACHES somebody. `clear()` nulls
    // `updatedAt`, so `snapshot()` answers null; emitting that as `undefined`
    // made the wipe unrepresentable, and every consumer skips an absent
    // `scene` (`agentmodeStore` did `if (!event.scene) break`, the server does
    // `if (event.scene !== undefined)`). The panel then kept rendering
    // "table … 0.55 m (lidar-measured)" for the rest of the session — a
    // measured claim about a pose the robot had been driven away from, which
    // is the exact defect TASK-221 exists to remove.
    const lock = new ControlOwnerLock();
    const { scene, events } = rig(lock);
    seeTable(scene);
    events.length = 0;

    lock.claim('teleop');

    const wipes = events.filter((e) => e.type === 'agent:scene:updated');
    expect(wipes).toHaveLength(1);
    expect(wipes[0]).toHaveProperty('scene');
    expect(wipes[0].scene).toBeNull();
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

describe('ControlOwnerLock.lend (TASK-226)', () => {
  it('hands the lock over and gives it back, without ever passing through idle', () => {
    const lock = new ControlOwnerLock();
    const changes: OwnerChange[] = [];
    lock.claim('agent');
    lock.subscribe((c) => changes.push(c));

    const lent = lock.lend('vla');

    expect(lent.ok).toBe(true);
    expect(lent.held()).toBe(true);
    expect(lock.get()).toBe('vla');

    lent.end();

    expect(lock.get()).toBe('agent');
    expect(lent.held()).toBe(false);
    // Both edges are flagged `handover`, which is what lets a subscriber tell
    // "somebody else is driving" from "the same owner's other subsystem".
    expect(changes).toEqual([
      { previous: 'agent', next: 'vla', preempted: false, handover: true },
      { previous: 'vla', next: 'agent', preempted: false, handover: true },
    ]);
  });

  it('restores the lender’s HOLDER COUNT, not just its name', () => {
    const lock = new ControlOwnerLock();
    // Two holders of the lender, which is what makes this assertion about the
    // refcount rather than about the name. The lender is `agent` because that
    // is the only owner a lend may park at all — a lend from `teleop` is
    // refused outright, see 'refuses to take the lock from a human' below.
    lock.claim('agent');
    lock.claim('agent');
    expect(lock.holderCount()).toBe(2);

    const lent = lock.lend('vla');
    expect(lock.holderCount()).toBe(1);
    lent.end();

    // Both holders are still holding. Restoring 1 would have let the first of
    // them to finish hand the lock away while the other was still driving.
    expect(lock.holderCount()).toBe(2);
    expect(lock.get()).toBe('agent');
  });

  it('is idempotent — a second end() is a no-op', () => {
    const lock = new ControlOwnerLock();
    lock.claim('agent');
    const lent = lock.lend('vla');
    lent.end();
    lent.end();
    expect(lock.get()).toBe('agent');
    expect(lock.holderCount()).toBe(1);
  });

  it('does NOT take the lock back from a teleop preemption', () => {
    const lock = new ControlOwnerLock();
    lock.claim('agent');
    const lent = lock.lend('vla');

    // A human takes over mid-rollout. `teleop` always wins.
    expect(lock.claim('teleop').preempted).toBe('vla');
    expect(lent.held()).toBe(false);

    // The rollout's `finally` still runs. It must not hand the lock back to a
    // plan the operator has just taken over.
    lent.end();
    expect(lock.get()).toBe('teleop');
  });

  it('does not resurrect the lender after an E-Stop reset()', () => {
    const lock = new ControlOwnerLock();
    lock.claim('agent');
    const lent = lock.lend('vla');
    lock.reset();

    // The reset alone has to leave the lock completely free — an E-Stop drops
    // every holder there is, including the one parked for the lender.
    expect(lock.get()).toBe('idle');
    expect(lock.holderCount()).toBe(0);

    // And the rollout's `finally`, which runs a /predict round trip later,
    // must not undo it. This is the ordering that stranded the lock on `agent`
    // for the rest of the process: see the E-Stop test in
    // `vla-skill-plumbing.test.ts`.
    lent.end();
    expect(lock.get()).toBe('idle');
    expect(lock.holderCount()).toBe(0);
    expect(lock.isLent()).toBe(false);

    // Nothing is stranded: the next claimant gets the lock, with one holder.
    expect(lock.claim('vla')).toEqual({ ok: true });
    expect(lock.holderCount()).toBe(1);
  });

  it('refuses a SECOND claim of the borrower while the lock is lent out', () => {
    // The lend turned an exclusive lock into a shared one in exactly the window
    // where sharing is most dangerous: while Agent Mode has lent the lock to a
    // rollout the owner reads `vla`, so an external `POST /vla/start` took
    // `claim`'s "same owner, one more holder" path and was admitted — two
    // SkillExecutors driving one 43-DOF humanoid. Before `lend` existed the
    // same call was refused with "Control is held by Agent Mode".
    const lock = new ControlOwnerLock();
    lock.claim('agent');
    const lent = lock.lend('vla');

    const claim = lock.claim('vla');

    expect(claim.ok).toBe(false);
    // The reason names both parties, because both are true: a policy is
    // driving, and Agent Mode is waiting to have its lock back.
    expect(claim.reason).toContain('VLA skill rollout');
    expect(claim.reason).toContain('Agent Mode');
    // Refused, so it left no holder behind to be released later.
    expect(lock.holderCount()).toBe(1);

    // Admitted again the moment the loan is over.
    lent.end();
    expect(lock.get()).toBe('agent');
    lock.release('agent');
    expect(lock.claim('vla')).toEqual({ ok: true });
  });

  it('refuses a second LEND of the borrower too', () => {
    // The same rule from the other side: a second `vla_skill` block cannot join
    // a rollout that is already borrowing the lock. `lend` routes the
    // same-owner case through `claim`, so it inherits the refusal.
    const lock = new ControlOwnerLock();
    lock.claim('agent');
    const first = lock.lend('vla');

    const second = lock.lend('vla');

    expect(second.ok).toBe(false);
    expect(second.held()).toBe(false);
    expect(lock.holderCount()).toBe(1);

    // And the refused lend's `end()` gives nothing back — there is nothing to
    // give — so the live loan survives it.
    second.end();
    expect(first.held()).toBe(true);
    expect(lock.get()).toBe('vla');
  });

  it('still lets a human take a lock that is out on loan', () => {
    // Teleop outranks a loan like it outranks everything else. Asserted next to
    // the refusal above so the exclusivity can never be read as "the borrower
    // is safe from the operator".
    const lock = new ControlOwnerLock();
    lock.claim('agent');
    lock.lend('vla');

    expect(lock.claim('teleop')).toEqual({ ok: true, preempted: 'vla' });
    expect(lock.get()).toBe('teleop');
    expect(lock.isLent()).toBe(false);
  });

  it('lets the human’s SECOND socket in after it preempted a loan', () => {
    // The exclusivity is a property of the loan, not a sticky flag on the lock.
    // A preemption ends the loan, so the operator's other windows — four of
    // them open `/ws/keyboard-teleop` — claim normally, which is the whole
    // reason the refcount exists.
    const lock = new ControlOwnerLock();
    lock.claim('agent');
    lock.lend('vla');
    lock.claim('teleop');

    expect(lock.claim('teleop')).toEqual({ ok: true });
    expect(lock.holderCount()).toBe(2);
  });

  it('refuses to take the lock from a human at the sticks', () => {
    // `lend` used to park and reassign unconditionally, so this returned ok and
    // took control from an operator mid-drive. Worse than a plain preemption:
    // both lend edges are flagged `handover` rather than `preempted`, so the
    // controller's teleop-takeover hook did not fire and nothing was aborted —
    // the plan just carried on driving under the operator's hands. Reachable
    // through a narrow race, teleop claiming between the abort check and the
    // lend.
    const lock = new ControlOwnerLock();
    const changes: OwnerChange[] = [];
    lock.claim('teleop');
    lock.subscribe((c) => changes.push(c));

    const lent = lock.lend('vla');

    expect(lent.ok).toBe(false);
    expect(lent.reason).toMatch(/human teleoperation/);
    expect(lent.held()).toBe(false);
    expect(lock.get()).toBe('teleop');
    expect(lock.holderCount()).toBe(1);
    // Nothing happened at all — no handover event for a subscriber to act on.
    expect(changes).toEqual([]);

    // And the refused lend's `end()` is inert, as `lendRefused` promises.
    lent.end();
    expect(lock.get()).toBe('teleop');
    expect(lock.holderCount()).toBe(1);
  });

  it('refuses to take the lock from a rollout somebody else started', () => {
    // The direction of a lend is the point: it is a delegation from an owner to
    // one of its own subsystems, and Agent Mode is not a subsystem of a VLA
    // rollout. `POST /vla/start` holds `vla` here, and parking it would leave a
    // live SkillExecutor streaming actions while a plan drove the base.
    const lock = new ControlOwnerLock();
    lock.claim('vla');

    const lent = lock.lend('agent');

    expect(lent.ok).toBe(false);
    expect(lent.reason).toMatch(/VLA skill rollout/);
    expect(lock.get()).toBe('vla');
  });

  it('from idle is a plain claim with a finally-safe release', () => {
    const lock = new ControlOwnerLock();
    const lent = lock.lend('vla');
    expect(lent.ok).toBe(true);
    expect(lock.get()).toBe('vla');
    lent.end();
    expect(lock.get()).toBe('idle');
  });

  it('to the CURRENT owner is one more holder, not an ownership change', () => {
    const lock = new ControlOwnerLock();
    const changes: OwnerChange[] = [];
    lock.claim('vla');
    lock.subscribe((c) => changes.push(c));

    const lent = lock.lend('vla');
    expect(lock.holderCount()).toBe(2);
    lent.end();

    expect(lock.get()).toBe('vla');
    expect(lock.holderCount()).toBe(1);
    expect(changes).toEqual([]);
  });
});
