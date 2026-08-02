/**
 * @file place-plumbing.test.ts
 * @description The seam between the state manager's place belief and the three
 *              surfaces that render it (planner prompt, `scene.md`, the wire
 *              snapshot), plus the fault-injection and honest-null behaviour of
 *              the cached base pose.
 * @feature agentmode
 * @status test
 */

import { describe, it, expect } from 'vitest';
import { AgentModeController } from '../agent-mode-controller.js';
import { ControlOwnerLock } from '../control-owner.js';
import { SceneMemoryStore } from '../scene-memory.js';
import type { Planner } from '../planner.js';
import type { ServerMirror } from '../server-mirror.js';
import type { VisionClient } from '../vision.js';
import type { ScenePlace } from '../types.js';
import { parsePlaceGraph, type Place } from '../place-resolver.js';
import type { PlaceBelief, RobotStateManager } from '../../robot/state.js';

const AISLE_3: ScenePlace = {
  id: 'AISLE-3',
  name: 'Aisle 3',
  placeType: 'aisle',
  confidence: 'confident',
  source: 'surveyed',
};

/**
 * A controller wired to a state-manager double that answers exactly one
 * question. `belief` is a getter so a test can change what the robot believes
 * between two renders — which is the whole point: the controller PULLS.
 */
function makeController(belief: () => PlaceBelief | null) {
  const scene = new SceneMemoryStore('robot-1');
  const controller = new AgentModeController({
    robotId: 'robot-1',
    enabled: false,
    scene,
    lock: new ControlOwnerLock(),
    planner: { plan: async () => ({ blocks: [] }) } as unknown as Planner,
    vision: { observe: async () => null } as unknown as VisionClient,
    mirror: {
      logBlock: async () => {},
      pushState: async () => {},
      logPlan: async () => {},
    } as unknown as ServerMirror,
  });
  controller.attach({
    getPlaceBelief: () => belief(),
  } as unknown as RobotStateManager);
  return { controller, scene };
}

describe('place → the three render surfaces', () => {
  it('a known place reaches scene.md, the snapshot and the planner summary', () => {
    const { controller, scene } = makeController(() => ({
      place: AISLE_3,
      poseM: { x: 9, y: 0 },
      poseSource: 'odometry',
      driftSinceAnchorM: 3.2,
      ageMs: 40,
      insideKeepout: false,
    }));

    expect(controller.sceneMarkdown()).toContain('You are in AISLE-3');
    // The snapshot is null until something has been LOOKED at; the place still
    // has to be in the store by then.
    expect(scene.getPlace()).toEqual(AISLE_3);
    expect(scene.getPoseM()).toEqual({ x: 9, y: 0 });
  });

  it('is PULLED at render time, so a place change needs no subscription', () => {
    let belief: PlaceBelief = {
      place: AISLE_3,
      poseM: { x: 9, y: 0 },
      poseSource: 'odometry',
      driftSinceAnchorM: 3.2,
      ageMs: 40,
      insideKeepout: false,
    };
    const { controller } = makeController(() => belief);

    expect(controller.sceneMarkdown()).toContain('You are in AISLE-3');

    belief = {
      place: { ...AISLE_3, id: 'DOCK-1', name: 'Dock 1', placeType: 'dock' },
      poseM: { x: -7, y: 0 },
      poseSource: 'odometry',
      driftSinceAnchorM: 19.5,
      ageMs: 10,
      insideKeepout: false,
    };

    const md = controller.sceneMarkdown();
    expect(md).toContain('You are in DOCK-1');
    expect(md).not.toContain('AISLE-3');
  });

  it('a lost pose renders "Place unknown", never the last place', () => {
    let belief: PlaceBelief = {
      place: AISLE_3,
      poseM: { x: 9, y: 0 },
      poseSource: 'odometry',
      driftSinceAnchorM: 3.2,
      ageMs: 40,
      insideKeepout: false,
    };
    const { controller } = makeController(() => belief);
    expect(controller.sceneMarkdown()).toContain('AISLE-3');

    // This is what PLACE_FAULT_NULL_POSE produces mid-walk, and what a 2 s
    // odometry timeout produces on its own several times an hour.
    belief = { place: null, poseM: null, poseSource: null, driftSinceAnchorM: null, ageMs: null, insideKeepout: null };

    const md = controller.sceneMarkdown();
    expect(md).toContain('Place unknown — no pose.');
    expect(md).not.toContain('AISLE-3');
  });

  it('an agent with no place graph at all renders unknown, not blank', () => {
    const { controller } = makeController(() => null);
    expect(controller.sceneMarkdown()).toContain('Place unknown');
  });

  it('survives a state manager that predates place awareness', () => {
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
      } as unknown as ServerMirror,
    });
    // No `getPlaceBelief` on the double at all — the optional-call idiom every
    // other state-manager touch in this controller uses.
    controller.attach({} as unknown as RobotStateManager);

    expect(() => controller.sceneMarkdown()).not.toThrow();
    expect(controller.sceneMarkdown()).toContain('Place unknown');
    expect(controller.getState().scene).toBeNull();
  });
});

// ============================================================================
// TASK-200 — the operator re-anchor reaches the state manager
// ============================================================================

const GRAPH_PLACES: Place[] = parsePlaceGraph({
  version: 1,
  frame: { id: 'f', kind: 'site', units: 'm', yawConvention: 'deg,+x=0,CCW+' },
  places: [
    { id: 'AISLE-3', name: 'Aisle 3', placeType: 'aisle', floor: 0, source: 'surveyed', polygon: [[8, -4], [10, -4], [10, 2]] },
    { id: 'RACK-A', name: 'Rack A', placeType: 'rack_face', floor: 0, source: 'surveyed', keepout: true, polygon: [[4, -4], [5, -4], [5, 2]] },
  ],
}).places;

/** A controller wired to a state manager that can be re-anchored. */
function makeReanchorController(opts: { places?: Place[] } = {}) {
  const places = opts.places ?? GRAPH_PLACES;
  const declared: string[] = [];
  const scene = new SceneMemoryStore('robot-1');
  let belief: PlaceBelief = {
    place: { ...AISLE_3, id: 'AISLE-1', name: 'Aisle 1' },
    poseM: { x: 3, y: 0 },
    poseSource: 'odometry',
    driftSinceAnchorM: 22,
    ageMs: 40,
    insideKeepout: false,
  };

  const controller = new AgentModeController({
    robotId: 'robot-1',
    enabled: true,
    scene,
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
    getPlaceBelief: () => belief,
    getPlaces: () => places,
    declarePlace: (placeId: string) => {
      declared.push(placeId);
      const place = places.find((p) => p.id === placeId);
      if (!place) return null;
      belief = {
        ...belief,
        place: { id: place.id, name: place.name, placeType: place.placeType, confidence: 'confident', source: 'declared' },
        driftSinceAnchorM: 0,
      };
      return belief.place;
    },
  } as unknown as RobotStateManager);

  return { controller, declared, scene };
}

describe('operator re-anchor (TASK-200)', () => {
  it('"you are in aisle 3" re-anchors instead of planning', async () => {
    const { controller, declared } = makeReanchorController();

    const result = await controller.submitCommand({ text: 'You are in aisle 3' });

    expect(result.outcome).toBe('reanchored');
    expect(result.planId).toBeUndefined();
    expect(declared).toEqual(['AISLE-3']);
    expect(result.message).toContain('Aisle 3');
  });

  it('lands on the render surfaces with source "declared"', async () => {
    const { controller, scene } = makeReanchorController();
    await controller.submitCommand({ text: 'you are in aisle 3' });

    expect(scene.getPlace()).toMatchObject({ id: 'AISLE-3', source: 'declared' });
    expect(controller.sceneMarkdown()).toContain('You are in AISLE-3');
  });

  it('does NOT intercept an instruction that merely names the place', async () => {
    const { controller, declared } = makeReanchorController();

    // Goes to the planner like any other command — the planner double returns
    // no blocks, so this finishes as an ordinary (empty) plan.
    const result = await controller.submitCommand({ text: 'go to aisle 3' });

    expect(result.outcome).not.toBe('reanchored');
    expect(declared).toEqual([]);
    await controller.whenIdle();
  });

  it('does nothing when the robot has no place graph', async () => {
    // No graph means no vocabulary: the utterance falls through to the planner
    // as an ordinary command rather than re-anchoring onto a guess.
    const { controller, declared } = makeReanchorController({ places: [] });

    const result = await controller.submitCommand({ text: 'you are in aisle 3' });

    expect(result.outcome).not.toBe('reanchored');
    expect(declared).toEqual([]);
    await controller.whenIdle();
  });
});
