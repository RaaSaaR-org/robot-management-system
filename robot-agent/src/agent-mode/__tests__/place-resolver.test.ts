/**
 * @file place-resolver.test.ts
 * @description Pose → place against BOTH shipped fixtures: point-in-polygon
 *              (including the concave cross aisle), the floor predicate, the
 *              honest-null rule, hysteresis at an aisle mouth, and the drift
 *              budget.
 *
 *              ⚠ What this file does NOT measure: the pose pipeline. The sim's
 *              `measured_pose()` returns `qpos` directly, so sim odometry has
 *              ZERO drift — feeding ground-truth poses into a point-in-polygon
 *              function and reporting accuracy measures the polygon, not the
 *              system. These are unit tests of the resolver and nothing else;
 *              the seam that decides whether the pose is right (teleop moving
 *              the robot with Agent Mode idle) can only be proven on the real
 *              stack.
 * @feature agentmode
 * @status test
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PLACE_DRIFT_BUDGET_M,
  DEFAULT_PLACE_HYSTERESIS_MARGIN_M,
  PlaceTracker,
  distanceToBoundaryM,
  loadPlaceGraph,
  parsePlaceGraph,
  pointInPolygon,
  toScenePlace,
  type Place,
  type PlaceGraph,
} from '../place-resolver.js';

const PLACES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../hardware/sim_evaluator/places',
);

const warehouse = loadPlaceGraph(path.join(PLACES_DIR, 'places.warehouse.json'));
const house = loadPlaceGraph(path.join(PLACES_DIR, 'places.house.json'));

/** Resolve a single pose with no history — the raw geometry, hysteresis aside. */
function resolveOnce(graph: PlaceGraph, x: number, y: number, floor?: number): string | null {
  const tracker = new PlaceTracker({ graph });
  const pose = floor === undefined ? { x, y } : { x, y, floor };
  // Two samples because a place change always needs two consecutive confirms;
  // the same pose twice is the cheapest way to ask "what is here".
  tracker.update(pose);
  return tracker.update(pose)?.place.id ?? null;
}

describe('place graph fixtures', () => {
  it('loads both shipped graphs', () => {
    expect(warehouse.places.map((p) => p.id)).toContain('AISLE-3');
    expect(house.places).toHaveLength(5);
  });

  it('asserts the declared frame instead of assuming it', () => {
    const raw = JSON.parse(readFileSync(path.join(PLACES_DIR, 'places.warehouse.json'), 'utf-8'));
    expect(() => parsePlaceGraph({ ...raw, frame: { ...raw.frame, units: 'cm' } })).toThrow(/units/);
    expect(() =>
      parsePlaceGraph({ ...raw, frame: { ...raw.frame, yawConvention: 'rad,+x=0,CCW+' } }),
    ).toThrow(/yawConvention/);
  });

  it('refuses a graph version it cannot read', () => {
    expect(() => parsePlaceGraph({ ...warehouse, version: 2 })).toThrow(/version/);
  });

  it('refuses a placeType outside the closed set', () => {
    const raw = JSON.parse(readFileSync(path.join(PLACES_DIR, 'places.house.json'), 'utf-8'));
    raw.places[0].placeType = 'kitchen';
    expect(() => parsePlaceGraph(raw)).toThrow(/placeType/);
  });
});

describe('pointInPolygon', () => {
  const crossAisle = warehouse.places.find((p) => p.id === 'CROSS-AISLE') as Place;

  it('handles the concave L of the cross aisle', () => {
    // West leg and north band are both in; the notch between them is not.
    expect(pointInPolygon(-4, 0, crossAisle.polygon)).toBe(true);
    expect(pointInPolygon(6, 3.5, crossAisle.polygon)).toBe(true);
    // (3, 0) sits in AISLE-1, inside the L's bounding box but outside the L.
    expect(pointInPolygon(3, 0, crossAisle.polygon)).toBe(false);
  });

  it('measures how far inside the boundary a point is', () => {
    const staging = warehouse.places.find((p) => p.id === 'STAGING') as Place;
    expect(distanceToBoundaryM(0, 0, staging.polygon)).toBeCloseTo(2, 6);
    expect(distanceToBoundaryM(1.9, 0, staging.polygon)).toBeCloseTo(0.1, 6);
  });
});

describe('pose → place probes (warehouse)', () => {
  const probes: Array<[number, number, string | null]> = [
    [0, 0, 'STAGING'],
    [3, 0, 'AISLE-1'],
    [6, 0, 'AISLE-2'],
    [9, 0, 'AISLE-3'],
    [-7, 0, 'DOCK-1'],
    [-9.5, 0, 'DOCK-1-EDGE'],
    [0, -4, 'CHARGING-A'],
    [0, 3.5, 'CROSS-AISLE'],
    [-4, 0, 'CROSS-AISLE'],
    // Deliberately uncovered floor — the map does not claim the whole hall.
    [0, -5.9, null],
    [6, -5, null],
  ];

  for (const [x, y, expected] of probes) {
    it(`(${x}, ${y}) → ${expected ?? 'UNKNOWN'}`, () => {
      expect(resolveOnce(warehouse, x, y)).toBe(expected);
    });
  }

  it('resolves every house room', () => {
    expect(resolveOnce(house, 0, 0)).toBe('HALLWAY');
    expect(resolveOnce(house, -3, 3)).toBe('KITCHEN');
    expect(resolveOnce(house, 3, 3)).toBe('LIVING-ROOM');
    expect(resolveOnce(house, -3, -3)).toBe('BEDROOM');
    expect(resolveOnce(house, 3, -3)).toBe('WORKSHOP');
  });
});

describe('the floor predicate', () => {
  /** Two places with the SAME footprint on two storeys — the collision case. */
  const stacked: PlaceGraph = {
    ...warehouse,
    places: [
      { ...(warehouse.places[0] as Place), id: 'GROUND', floor: 0 },
      { ...(warehouse.places[0] as Place), id: 'MEZZANINE', floor: 1 },
    ],
  };

  it('separates identical footprints on different floors', () => {
    expect(resolveOnce(stacked, 0, 0, 0)).toBe('GROUND');
    expect(resolveOnce(stacked, 0, 0, 1)).toBe('MEZZANINE');
  });

  it('defaults a floorless pose to floor 0, never to "any floor"', () => {
    expect(resolveOnce(stacked, 0, 0)).toBe('GROUND');
    expect(resolveOnce(stacked, 0, 0, 2)).toBeNull();
  });
});

describe('the honest-null rule', () => {
  it('returns null for a null pose', () => {
    const tracker = new PlaceTracker({ graph: warehouse });
    expect(tracker.update(null)).toBeNull();
  });

  it('never resurrects the last place when the pose goes away', () => {
    const tracker = new PlaceTracker({ graph: warehouse });
    tracker.update({ x: 0, y: 0 });
    expect(tracker.update({ x: 0, y: 0 })?.place.id).toBe('STAGING');

    expect(tracker.update(null)).toBeNull();
    expect(tracker.current()).toBeNull();
    // …and it stays null: a second null is not "well, it was in STAGING".
    expect(tracker.update(null)).toBeNull();
  });

  it('never resurrects the last place when the robot walks off the map', () => {
    const tracker = new PlaceTracker({ graph: warehouse });
    tracker.update({ x: 0, y: 0 });
    tracker.update({ x: 0, y: 0 });
    expect(tracker.current()?.place.id).toBe('STAGING');

    // One sample onto uncovered floor is enough: hysteresis arbitrates between
    // two places, it is not a licence to keep asserting one the robot has left.
    expect(tracker.update({ x: 0, y: -5.9 })).toBeNull();
  });

  it('treats a non-finite pose as no pose', () => {
    const tracker = new PlaceTracker({ graph: warehouse });
    tracker.update({ x: 0, y: 0 });
    tracker.update({ x: 0, y: 0 });
    expect(tracker.update({ x: Number.NaN, y: 0 })).toBeNull();
  });
});

describe('hysteresis at the STAGING | AISLE-1 boundary (x = +2.0)', () => {
  function walkedTo(xs: number[]): string | null {
    const tracker = new PlaceTracker({ graph: warehouse });
    tracker.update({ x: 0, y: 0 });
    tracker.update({ x: 0, y: 0 });
    let last: string | null = tracker.current()?.place.id ?? null;
    for (const x of xs) last = tracker.update({ x, y: 0 })?.place.id ?? null;
    return last;
  }

  it('holds STAGING inside the margin band, however long the excursion', () => {
    // 2.29 is inside AISLE-1 but only 0.29 m in — below the 0.30 m margin.
    expect(DEFAULT_PLACE_HYSTERESIS_MARGIN_M).toBe(0.3);
    expect(walkedTo([2.05, 2.2, 2.29, 2.29, 2.29])).toBe('STAGING');
  });

  it('rejects a single-sample excursion past the margin', () => {
    expect(walkedTo([2.5])).toBe('STAGING');
  });

  it('commits on the second consecutive qualifying sample', () => {
    expect(walkedTo([2.5, 2.6])).toBe('AISLE-1');
  });

  it('does not carry a stale confirmation across a step back', () => {
    // One qualifying sample, back inside the band, then one more: the counter
    // must have been reset, so this is still STAGING.
    expect(walkedTo([2.5, 2.1, 2.5])).toBe('STAGING');
  });
});

describe('aisle-mouth flap test', () => {
  it('a walk along the AISLE-1 mouth (y = +2.0) produces ZERO transitions', () => {
    const tracker = new PlaceTracker({ graph: warehouse });
    // Start committed in AISLE-1, well inside.
    tracker.update({ x: 3, y: 0 });
    tracker.update({ x: 3, y: 0 });
    expect(tracker.current()?.place.id).toBe('AISLE-1');

    const ids: Array<string | null> = [];
    // Straddle the shared edge with CROSS-AISLE, ±0.2 m, sixteen times — the
    // path a robot loitering in a doorway actually takes.
    for (let i = 0; i < 16; i++) {
      const y = 2 + (i % 2 === 0 ? 0.2 : -0.2);
      ids.push(tracker.update({ x: 3, y })?.place.id ?? null);
    }
    expect(new Set(ids)).toEqual(new Set(['AISLE-1']));
  });

  it('a deliberate walk out into the cross aisle DOES commit', () => {
    const tracker = new PlaceTracker({ graph: warehouse });
    tracker.update({ x: 3, y: 0 });
    tracker.update({ x: 3, y: 0 });
    tracker.update({ x: 3, y: 2.6 });
    expect(tracker.update({ x: 3, y: 3.0 })?.place.id).toBe('CROSS-AISLE');
  });
});

describe('the drift budget', () => {
  it('flips confidence to stale past the budget, and back on a re-anchor', () => {
    const tracker = new PlaceTracker({ graph: warehouse, driftBudgetM: 4 });
    expect(DEFAULT_PLACE_DRIFT_BUDGET_M).toBe(15);

    tracker.update({ x: -1.5, y: 0 });
    expect(tracker.update({ x: -1.5, y: 0 })?.confidence).toBe('confident');

    // Pace back and forth inside STAGING until more than 4 m have accumulated.
    tracker.update({ x: 1.5, y: 0 }); // +3 m
    const drifted = tracker.update({ x: -0.5, y: 0 }); // +2 m → 5 m total
    expect(drifted?.driftSinceAnchorM).toBeCloseTo(5, 6);
    expect(drifted?.confidence).toBe('stale');
    // The place itself is unchanged — drift downgrades belief, it does not move
    // the robot.
    expect(drifted?.place.id).toBe('STAGING');

    tracker.anchor();
    expect(tracker.current()?.confidence).toBe('confident');
    expect(tracker.update({ x: -0.5, y: 0 })?.confidence).toBe('confident');
  });

  it('does not un-walk the drift when the pose is lost', () => {
    const tracker = new PlaceTracker({ graph: warehouse, driftBudgetM: 1 });
    tracker.update({ x: -1.5, y: 0 });
    tracker.update({ x: 1.5, y: 0 });
    expect(tracker.getDriftM()).toBeCloseTo(3, 6);
    tracker.update(null);
    expect(tracker.getDriftM()).toBeCloseTo(3, 6);
  });
});

describe('toScenePlace', () => {
  it('narrows to the wire shape, keeping provenance and confidence', () => {
    const tracker = new PlaceTracker({ graph: warehouse });
    tracker.update({ x: 9, y: 0 });
    const observation = tracker.update({ x: 9, y: 0 });
    expect(observation).not.toBeNull();
    expect(toScenePlace(observation!)).toEqual({
      id: 'AISLE-3',
      name: 'Aisle 3',
      placeType: 'aisle',
      confidence: 'confident',
      source: 'surveyed',
    });
  });
});

// ============================================================================
// TASK-200 — twin-bound frames and the operator re-anchor
// ============================================================================

describe('frame.twinId (TASK-200)', () => {
  it('is carried through when a scanned site declares one', () => {
    const graph = parsePlaceGraph({
      version: 1,
      frame: { id: 'twin-abc', kind: 'site', units: 'm', yawConvention: 'deg,+x=0,CCW+', twinId: 'abc' },
      places: [],
    });
    expect(graph.frame.twinId).toBe('abc');
  });

  it('is NOT invented for a hand-authored sim graph', () => {
    // Defaulting it to something would make the twin check in PlaceGraphSource
    // pass by accident, which is the one thing it exists to prevent.
    expect(warehouse.frame.twinId).toBeUndefined();
    expect(house.frame.twinId).toBeUndefined();
  });

  it('still rejects a graph whose declared units are not metres', () => {
    expect(() =>
      parsePlaceGraph({
        version: 1,
        frame: { id: 'f', kind: 'site', units: 'cm', yawConvention: 'deg,+x=0,CCW+', twinId: 'abc' },
        places: [],
      }),
    ).toThrow(/frame\.units/);
  });
});

describe('PlaceTracker.declare — the operator re-anchor (TASK-200)', () => {
  it('declares the place with source "declared" and resets the drift budget', () => {
    const tracker = new PlaceTracker({ graph: warehouse, driftBudgetM: 1 });
    tracker.update({ x: 0, y: 0 });
    tracker.update({ x: 0, y: 0 });
    // Walk far enough to spend the budget.
    tracker.update({ x: 9, y: 0 });
    tracker.update({ x: 9, y: 0 });
    expect(tracker.current()?.confidence).toBe('stale');

    const declared = tracker.declare('AISLE-3');

    expect(declared?.place.id).toBe('AISLE-3');
    expect(declared?.place.source).toBe('declared');
    expect(declared?.confidence).toBe('confident');
    expect(declared?.driftSinceAnchorM).toBe(0);
    expect(tracker.getDriftM()).toBe(0);
    expect(toScenePlace(declared!).source).toBe('declared');
  });

  it('is case-insensitive on the place id', () => {
    const tracker = new PlaceTracker({ graph: warehouse });
    expect(tracker.declare('aisle-3')?.place.id).toBe('AISLE-3');
  });

  it('changes NOTHING when the graph has no such place', () => {
    const tracker = new PlaceTracker({ graph: warehouse });
    tracker.update({ x: 0, y: 0 });
    tracker.update({ x: 0, y: 0 });
    expect(tracker.current()?.place.id).toBe('STAGING');

    expect(tracker.declare('CANTEEN')).toBeNull();
    expect(tracker.current()?.place.id).toBe('STAGING');
    expect(tracker.declaredPlaceId()).toBeNull();
  });

  it('survives a pose that has drifted OFF the map', () => {
    // The situation that makes a re-anchor necessary in the first place: the
    // odometry estimate is somewhere outside every polygon, and a human next to
    // the robot can see it is standing in aisle 3.
    const tracker = new PlaceTracker({ graph: warehouse });
    tracker.declare('AISLE-3');

    const held = tracker.update({ x: 40, y: 40 });

    expect(held?.place.id).toBe('AISLE-3');
    expect(held?.place.source).toBe('declared');
    // Margin 0: honestly not inside any polygon, so a geofence cannot read this
    // as clearance from a keepout boundary.
    expect(held?.marginM).toBe(0);
  });

  it('keeps "declared" while geometry AGREES', () => {
    const tracker = new PlaceTracker({ graph: warehouse });
    tracker.declare('AISLE-3');
    const agreeing = tracker.update({ x: 9, y: 0 });
    expect(agreeing?.place.id).toBe('AISLE-3');
    expect(agreeing?.place.source).toBe('declared');
  });

  it('stands down once geometry CONFIRMS somewhere else', () => {
    const tracker = new PlaceTracker({ graph: warehouse });
    tracker.declare('AISLE-3');

    // One sample well inside STAGING is not enough — hysteresis still applies.
    expect(tracker.update({ x: 0, y: 0 })?.place.id).toBe('AISLE-3');
    const confirmed = tracker.update({ x: 0, y: 0 });

    expect(confirmed?.place.id).toBe('STAGING');
    expect(confirmed?.place.source).toBe('surveyed');
    expect(tracker.declaredPlaceId()).toBeNull();
  });

  it('does NOT survive a null pose — the honest-null rule stays absolute', () => {
    const tracker = new PlaceTracker({ graph: warehouse });
    tracker.declare('AISLE-3');
    expect(tracker.update(null)).toBeNull();
    expect(tracker.declaredPlaceId()).toBeNull();
    // …and the declaration does not come back when a pose does.
    expect(tracker.update({ x: 40, y: 40 })).toBeNull();
  });
});

// ============================================================================
// AN UNREGISTERED FRAME — GEOMETRY IS OUT, THE DRIFT BUDGET IS NOT
// ============================================================================

describe('updateUnregisteredFrame', () => {
  it('accumulates drift on a declared place until it goes stale', () => {
    // TASK-200 review residual: the caller used to read `current()` here, so
    // `driftSinceAnchorM` never moved and the declared place read `confident`
    // at `drift: 0` after 200 m. Odometry translation is frame-independent —
    // only the ORIGIN is unknown — so the budget still applies.
    const tracker = new PlaceTracker({ graph: warehouse });
    tracker.updateUnregisteredFrame({ x: 3, y: 0 });
    expect(tracker.declare('AISLE-1')?.confidence).toBe('confident');

    let last = tracker.current();
    for (let i = 1; i <= 100; i++) last = tracker.updateUnregisteredFrame({ x: 3 + i * 2, y: 0 });

    expect(last?.place.id).toBe('AISLE-1');
    expect(last?.confidence).toBe('stale');
    expect(tracker.getDriftM()).toBeCloseTo(200, 5);
    // Still no clearance claim: geometry answered nothing.
    expect(last?.marginM).toBe(0);
  });

  it('names NOTHING without a declaration, however inside a polygon the pose is', () => {
    const tracker = new PlaceTracker({ graph: warehouse });
    expect(tracker.updateUnregisteredFrame({ x: 9, y: 0 })).toBeNull();
    expect(tracker.updateUnregisteredFrame({ x: 9, y: 2 })).toBeNull();
    // …and the metres were counted anyway: accumulation is a property of the
    // pose stream, not of whether a place happens to be named right now.
    expect(tracker.getDriftM()).toBeCloseTo(2, 5);
  });

  it('obeys the honest-null rule exactly as `update` does', () => {
    const tracker = new PlaceTracker({ graph: warehouse });
    tracker.declare('AISLE-3');
    expect(tracker.updateUnregisteredFrame(null)).toBeNull();
    expect(tracker.declaredPlaceId()).toBeNull();
  });
});
