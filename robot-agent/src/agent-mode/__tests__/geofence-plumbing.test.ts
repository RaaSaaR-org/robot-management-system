/**
 * @file geofence-plumbing.test.ts
 * @description TASK-201: the ONE wire that carries "the fence has stopped
 *              fencing" from the robot to the operator console.
 * @feature agentmode
 * @status test
 *
 * `state-geofence-enforcement.test.ts` pins the robot end (the state manager
 * derives the label and notifies on an enforcement-only change) and
 * `agentmodeStore.test.ts` pins the console end (the store folds the field in).
 * Between them sits this controller, and it does two things that nothing else
 * can do for it:
 *
 *  1. `getState()` must CARRY the field. A snapshot without it says nothing
 *     about the fence, which the console renders as nothing — the original
 *     silent-fence defect, restored end to end.
 *  2. `attach()`'s subscribe callback must PUBLISH on an enforcement change.
 *     The gate there used to filter on the place id alone, and the observed
 *     failure is a constant place id for a whole traverse while the drift
 *     budget is spent — so a place-only gate swallows every lapse and leaves it
 *     to the 15 s liveness re-push.
 *
 * Both are one line each, both were reverted by hand while the whole
 * robot-agent suite stayed green, and that is why this file exists.
 */

import { describe, it, expect, vi } from 'vitest';
import { AgentModeController } from '../agent-mode-controller.js';
import { ControlOwnerLock } from '../control-owner.js';
import { SceneMemoryStore } from '../scene-memory.js';
import type { Planner } from '../planner.js';
import type { ServerMirror } from '../server-mirror.js';
import type { VisionClient } from '../vision.js';
import type { AgentGeofenceState, AgentModeEvent, ScenePlace } from '../types.js';
import type { PlaceBelief, RobotStateManager } from '../../robot/state.js';

const AISLE_3: ScenePlace = {
  id: 'AISLE-3',
  name: 'Aisle 3',
  placeType: 'aisle',
  confidence: 'confident',
  source: 'surveyed',
};

const belief = (place: ScenePlace | null): PlaceBelief => ({
  place,
  poseM: { x: 9, y: 0 },
  poseSource: 'odometry',
  driftSinceAnchorM: 3.2,
  ageMs: 40,
  insideKeepout: false,
});

/**
 * A controller wired to a state-manager double whose place id and geofence
 * state can be moved INDEPENDENTLY — which is the whole point: the two facts
 * change on their own schedules, and the defect was a wire that could only see
 * one of them.
 */
function makeRig(initial: { placeId?: string | null; geofence?: AgentGeofenceState | null } = {}) {
  const box = {
    placeId: initial.placeId === undefined ? 'AISLE-3' : initial.placeId,
    geofence: initial.geofence === undefined ? { enforcement: 'enforcing', reason: null } as AgentGeofenceState | null : initial.geofence,
  };
  let listener: ((s: { location: { place: string | null } }) => void) | null = null;

  const controller = new AgentModeController({
    robotId: 'robot-1',
    enabled: false,
    scene: new SceneMemoryStore('robot-1'),
    lock: new ControlOwnerLock(),
    planner: { plan: async () => ({ blocks: [] }) } as unknown as Planner,
    vision: { observe: async () => null } as unknown as VisionClient,
    mirror: {
      logBlock: async () => {},
      pushState: async () => {},
      logPlan: async () => {},
      emit: () => {},
    } as unknown as ServerMirror,
  });
  controller.attach({
    getPlaceBelief: () => belief(box.placeId ? { ...AISLE_3, id: box.placeId, name: box.placeId } : null),
    getState: () => ({ location: { place: box.placeId } }),
    getGeofenceState: () => box.geofence,
    subscribe: (l: (s: { location: { place: string | null } }) => void) => {
      listener = l;
      return () => {};
    },
  } as unknown as RobotStateManager);

  const pushed: AgentModeEvent[] = [];
  controller.subscribe((event) => {
    if (event.type === 'agent:state:changed') pushed.push(event);
  });

  /** One pose sample reaching the state manager's listeners. */
  const sample = () => listener!({ location: { place: box.placeId } });

  return { controller, box, pushed, sample };
}

// ============================================================================
// 1. The snapshot carries the field
// ============================================================================

describe('the state snapshot carries the geofence (TASK-201)', () => {
  it('reports what the state manager says the fence is doing', () => {
    const { controller, box } = makeRig();
    expect(controller.getState().geofence).toEqual({ enforcement: 'enforcing', reason: null });

    box.geofence = { enforcement: 'not-enforcing', reason: 'the pose has drifted past its budget' };

    // PULLED at render time, like `place` — no subscription, no cached copy to
    // go stale between the lapse and the next push.
    expect(controller.getState().geofence).toEqual({
      enforcement: 'not-enforcing',
      reason: 'the pose has drifted past its budget',
    });
  });

  it('says nothing — never `enforcing` — for a state manager that cannot answer', () => {
    const controller = new AgentModeController({
      robotId: 'robot-1',
      enabled: false,
      lock: new ControlOwnerLock(),
      planner: { plan: async () => ({ blocks: [] }) } as unknown as Planner,
      vision: { observe: async () => null } as unknown as VisionClient,
      mirror: {
        logBlock: async () => {},
        pushState: async () => {},
        logPlan: async () => {},
        emit: () => {},
      } as unknown as ServerMirror,
    });
    // No `getGeofenceState` on the double at all — a build that predates the
    // field. `null` is "we were not told", which the console renders as
    // nothing; a fabricated `enforcing` would be the defect on the wire.
    controller.attach({} as unknown as RobotStateManager);

    expect(controller.getState().geofence).toBeNull();
    expect(controller.getState().geofence?.enforcement).not.toBe('enforcing');
  });
});

// ============================================================================
// 2. The publish fires on an enforcement-only change
// ============================================================================

describe('the state push sees a lapse with the place id standing still', () => {
  it('publishes when only the enforcement changed', () => {
    const { box, pushed, sample } = makeRig();

    // Ordinary errands inside one place: nothing to say.
    sample();
    sample();
    expect(pushed).toHaveLength(0);

    // The drift budget runs out mid-aisle. The place id does NOT move — that
    // is the observed failure, and a place-only gate returns here.
    box.geofence = { enforcement: 'not-enforcing', reason: 'the pose has drifted past its budget' };
    sample();

    expect(pushed).toHaveLength(1);
    expect(pushed[0].state?.place?.id).toBe('AISLE-3');
    expect(pushed[0].state?.geofence?.enforcement).toBe('not-enforcing');

    // Still not enforcing, sample after sample: said once, not four times a
    // second.
    sample();
    sample();
    expect(pushed).toHaveLength(1);

    // And the recovery is published too — an operator watching the console has
    // to see the fence come back, not just go away.
    box.geofence = { enforcement: 'enforcing', reason: null };
    sample();
    expect(pushed).toHaveLength(2);
    expect(pushed[1].state?.geofence?.enforcement).toBe('enforcing');
  });

  it('still publishes on a place change with the enforcement standing still', () => {
    const { box, pushed, sample } = makeRig();
    sample();
    expect(pushed).toHaveLength(0);

    box.placeId = 'DOCK-1';
    sample();

    expect(pushed).toHaveLength(1);
    expect(pushed[0].state?.place?.id).toBe('DOCK-1');
  });

  it('publishes ONCE when the place and the fence move on the same sample', () => {
    const { box, pushed, sample } = makeRig();
    sample();

    box.placeId = 'DOCK-1';
    box.geofence = { enforcement: 'not-enforcing', reason: 'no pose sample' };
    sample();

    expect(pushed).toHaveLength(1);
  });

  it('survives a state manager that cannot report enforcement at all', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { box, pushed, sample } = makeRig({ geofence: null });

    // `getGeofenceState` answering null every time is one unchanging value: a
    // place change is still published, and nothing invents a transition.
    sample();
    expect(pushed).toHaveLength(0);
    box.placeId = 'DOCK-1';
    sample();
    expect(pushed).toHaveLength(1);
    expect(pushed[0].state?.geofence).toBeNull();

    warn.mockRestore();
  });
});
