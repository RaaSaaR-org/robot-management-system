/**
 * @file geofence.test.ts
 * @description The pure half of the first ENFORCED boundary (TASK-200): pose +
 *   place graph → violating / clear / unknown.
 * @feature agentmode
 *
 * The three-state result is the thing under test, not an implementation detail.
 * Two of the task's safety clauses live entirely in the difference between
 * `unknown` and `clear`: a null or stale pose must not TRIGGER a stop, and it
 * must not RELEASE one either.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_KEEPOUT_CLEARANCE_M,
  DEFAULT_KEEPOUT_MARGIN_M,
  evaluateGeofence,
  keepoutDepthM,
  keepoutPlaces,
} from '../geofence.js';
import { parsePlaceGraph } from '../place-resolver.js';
import type { PlaceGraph } from '../place-resolver.js';

/**
 * A 4 m square keepout from (0,0) to (4,4), with a navigable room beside it.
 * Deliberately axis-aligned: this file is about the DECISION, and the ray cast
 * itself is already covered by place-resolver.test.ts (including the concave L).
 */
const GRAPH: PlaceGraph = parsePlaceGraph({
  version: 1,
  frame: { id: 'test-site', kind: 'site', units: 'm', yawConvention: 'deg,+x=0,CCW+', twinId: 'twin-1' },
  places: [
    {
      id: 'RACK-A',
      name: 'Rack A',
      placeType: 'rack_face',
      floor: 0,
      polygon: [[0, 0], [4, 0], [4, 4], [0, 4]],
      source: 'surveyed',
      keepout: true,
    },
    {
      id: 'AISLE-1',
      name: 'Aisle 1',
      placeType: 'aisle',
      floor: 0,
      polygon: [[10, 0], [14, 0], [14, 4], [10, 4]],
      source: 'surveyed',
      keepout: false,
    },
    {
      id: 'MEZZANINE-RACK',
      name: 'Mezzanine Rack',
      placeType: 'rack_face',
      floor: 1,
      polygon: [[0, 0], [4, 0], [4, 4], [0, 4]],
      source: 'surveyed',
      keepout: true,
    },
  ],
});

const trusted = (x: number, y: number, floor = 0) => ({ pose: { x, y, floor }, poseTrusted: true });

describe('keepoutPlaces', () => {
  it('picks out only the fenced places', () => {
    expect(keepoutPlaces(GRAPH).map((p) => p.id)).toEqual(['RACK-A', 'MEZZANINE-RACK']);
  });
});

describe('keepoutDepthM', () => {
  const rack = keepoutPlaces(GRAPH)[0]!;

  it('grows monotonically as the robot goes further in', () => {
    const onBoundary = keepoutDepthM(0, 2, rack, 0.5);
    const justInside = keepoutDepthM(0.2, 2, rack, 0.5);
    const wellInside = keepoutDepthM(1.5, 2, rack, 0.5);
    expect(onBoundary).toBeCloseTo(0.5, 6);
    expect(justInside!).toBeGreaterThan(onBoundary!);
    expect(wellInside!).toBeGreaterThan(justInside!);
  });

  it('is null outside the margin, and the margin is measured OUTSIDE the polygon', () => {
    // 0.3 m outside a 0.5 m margin is still a violation…
    expect(keepoutDepthM(-0.3, 2, rack, 0.5)).toBeCloseTo(0.2, 6);
    // …0.7 m outside is not.
    expect(keepoutDepthM(-0.7, 2, rack, 0.5)).toBeNull();
  });
});

describe('evaluateGeofence', () => {
  it('a KNOWN pose inside a keepout is a violation', () => {
    const status = evaluateGeofence(trusted(2, 2), GRAPH);
    expect(status.kind).toBe('violating');
    if (status.kind !== 'violating') throw new Error('unreachable');
    expect(status.violation.placeId).toBe('RACK-A');
    expect(status.violation.placeName).toBe('Rack A');
    expect(status.violation.poseM).toEqual({ x: 2, y: 2 });
  });

  it('the MARGIN fences the approach, not just the polygon', () => {
    // Outside the rack, but within the 0.5 m margin: the stop has to fire while
    // the robot is still out, or it is a witness statement rather than a fence.
    const near = evaluateGeofence({ pose: { x: -0.25, y: 2 }, poseTrusted: true }, GRAPH);
    expect(near.kind).toBe('violating');

    const clear = evaluateGeofence({ pose: { x: -2, y: 2 }, poseTrusted: true }, GRAPH);
    expect(clear.kind).toBe('clear');
  });

  it('a NULL pose is UNKNOWN — it neither triggers nor releases', () => {
    const status = evaluateGeofence({ pose: null, poseTrusted: true }, GRAPH);
    expect(status.kind).toBe('unknown');
  });

  it('a STALE pose is UNKNOWN even when it points straight at a rack', () => {
    // Same coordinates as the violating case above. A pose past its drift budget
    // may be tens of metres wrong; it is not evidence of anything.
    const status = evaluateGeofence({ pose: { x: 2, y: 2 }, poseTrusted: false }, GRAPH);
    expect(status.kind).toBe('unknown');
    if (status.kind !== 'unknown') throw new Error('unreachable');
    expect(status.reason).toMatch(/drift/);
  });

  it('a NaN pose is UNKNOWN rather than an accidental (0,0) inside the rack', () => {
    expect(evaluateGeofence({ pose: { x: Number.NaN, y: 2 }, poseTrusted: true }, GRAPH).kind).toBe(
      'unknown',
    );
  });

  it('holds a latch in the release hysteresis band instead of reporting clear', () => {
    // Just outside the margin (0.5) but inside margin + clearance (0.75): not a
    // violation any more, but not far enough away to release one either.
    const band = DEFAULT_KEEPOUT_MARGIN_M + DEFAULT_KEEPOUT_CLEARANCE_M / 2;
    const status = evaluateGeofence({ pose: { x: -band, y: 2 }, poseTrusted: true }, GRAPH);
    expect(status.kind).toBe('unknown');

    const beyond = DEFAULT_KEEPOUT_MARGIN_M + DEFAULT_KEEPOUT_CLEARANCE_M + 0.05;
    expect(evaluateGeofence({ pose: { x: -beyond, y: 2 }, poseTrusted: true }, GRAPH).kind).toBe(
      'clear',
    );
  });

  it('applies the floor predicate exactly as the resolver does', () => {
    // The mezzanine rack has the same footprint one floor up.
    expect(evaluateGeofence(trusted(2, 2, 1), GRAPH).kind).toBe('violating');
    // …and a robot on floor 2 is fenced by neither.
    expect(evaluateGeofence(trusted(2, 2, 2), GRAPH).kind).toBe('clear');
  });

  it('reports CLEAR — not unknown — for a site with no keepouts at all', () => {
    const unfenced = parsePlaceGraph({
      version: 1,
      frame: { id: 'f', kind: 'site', units: 'm', yawConvention: 'deg,+x=0,CCW+' },
      places: [
        {
          id: 'ROOM',
          name: 'Room',
          placeType: 'office',
          floor: 0,
          polygon: [[0, 0], [4, 0], [4, 4], [0, 4]],
          source: 'surveyed',
        },
      ],
    });
    expect(evaluateGeofence(trusted(2, 2), unfenced).kind).toBe('clear');
  });

  it('names the DEEPEST keepout when two overlap', () => {
    const overlapping = parsePlaceGraph({
      version: 1,
      frame: { id: 'f', kind: 'site', units: 'm', yawConvention: 'deg,+x=0,CCW+' },
      places: [
        {
          id: 'EDGE',
          name: 'Edge',
          placeType: 'dock',
          floor: 0,
          polygon: [[0, 0], [10, 0], [10, 1], [0, 1]],
          source: 'surveyed',
          keepout: true,
        },
        {
          id: 'PIT',
          name: 'Pit',
          placeType: 'dock',
          floor: 0,
          polygon: [[0, 0], [10, 0], [10, 6], [0, 6]],
          source: 'surveyed',
          keepout: true,
        },
      ],
    });
    const status = evaluateGeofence(trusted(5, 3), overlapping);
    expect(status.kind).toBe('violating');
    if (status.kind !== 'violating') throw new Error('unreachable');
    expect(status.violation.placeId).toBe('PIT');
  });
});
