/**
 * @file frame-registration.test.ts
 * @description The odom → twin registration (TASK-342): the transform, the
 *              graph carried into odometry, and the platform source.
 * @feature agentmode
 * @status test
 */

import { describe, expect, it, vi } from 'vitest';

import {
  FrameRegistrationSource,
  graphInOdomFrame,
  odomToTwin,
  parseOdomRegistration,
  twinPointToOdom,
  wrapDeg,
  type OdomRegistration,
} from '../frame-registration.js';
import { findContainingPlace, parsePlaceGraph } from '../place-resolver.js';

/** Odometry started at twin (3, 2) facing 90° — the TASK-325 acceptance setup. */
const REG: OdomRegistration = {
  twinId: 'twin-demo',
  odomFrameId: 'boot-1',
  x: 3,
  y: 2,
  yawDeg: 90,
  method: 'place-anchor',
  createdAt: null,
};

describe('odomToTwin / twinPointToOdom', () => {
  it('puts the odometry origin at the anchor and odom +x along twin +y', () => {
    const origin = odomToTwin(REG, { x: 0, y: 0, yawDeg: 0 });
    expect(origin.x).toBeCloseTo(3, 9);
    expect(origin.y).toBeCloseTo(2, 9);
    expect(origin.yawDeg).toBeCloseTo(90, 9);
    const ahead = odomToTwin(REG, { x: 1, y: 0, yawDeg: 0 });
    expect(ahead.x).toBeCloseTo(3, 9);
    expect(ahead.y).toBeCloseTo(3, 9);
  });

  it('round-trips points through the inverse', () => {
    const reg = { ...REG, x: -1.25, y: 7.5, yawDeg: -137 };
    for (const [x, y] of [
      [0, 0],
      [4.5, -2],
      [-10, 3.3],
    ]) {
      const t = odomToTwin(reg, { x, y, yawDeg: 0 });
      const [ox, oy] = twinPointToOdom(reg, t.x, t.y);
      expect(ox).toBeCloseTo(x, 9);
      expect(oy).toBeCloseTo(y, 9);
    }
  });

  it('wraps the heading', () => {
    expect(odomToTwin({ ...REG, yawDeg: 170 }, { x: 0, y: 0, yawDeg: 20 }).yawDeg).toBeCloseTo(-170, 9);
    expect(wrapDeg(-180)).toBe(180);
    expect(wrapDeg(540)).toBe(180);
  });
});

describe('graphInOdomFrame', () => {
  const twinGraph = parsePlaceGraph({
    version: 1,
    frame: { id: 'twin-demo', kind: 'site', twinId: 'twin-demo', units: 'm', yawConvention: 'deg,+x=0,CCW+' },
    places: [
      {
        id: 'DOCK',
        name: 'Dock',
        placeType: 'dock',
        floor: 0,
        // 2 × 2 m around twin (3, 2): where odometry started.
        polygon: [
          [2, 1],
          [4, 1],
          [4, 3],
          [2, 3],
        ],
        source: 'surveyed',
        keepout: false,
        landmarks: [{ label: 'marker', x: 3, y: 3, source: 'surveyed' }],
      },
    ],
  });

  it('answers containment in odometry exactly as the twin would', () => {
    const odomGraph = graphInOdomFrame(twinGraph, REG);
    // Odom (0, 0) is twin (3, 2): inside the dock. Odom (1.5, 0) is twin (3, 3.5): outside.
    expect(findContainingPlace(odomGraph.places, { x: 0, y: 0 })?.id).toBe('DOCK');
    expect(findContainingPlace(odomGraph.places, { x: 1.5, y: 0 })).toBeNull();
    // Unchanged raw graph would have put odom (0, 0) outside the dock.
    expect(findContainingPlace(twinGraph.places, { x: 0, y: 0 })).toBeNull();
  });

  it('carries landmarks and keeps the frame block', () => {
    const odomGraph = graphInOdomFrame(twinGraph, REG);
    const [l] = odomGraph.places[0].landmarks;
    expect(l.x).toBeCloseTo(1, 9);
    expect(l.y).toBeCloseTo(0, 9);
    expect(odomGraph.frame).toEqual(twinGraph.frame);
    // The source graph is not mutated.
    expect(twinGraph.places[0].polygon[0]).toEqual([2, 1]);
  });
});

describe('parseOdomRegistration', () => {
  it('reads the platform payload', () => {
    expect(
      parseOdomRegistration({ ...REG, createdAt: '2026-09-30T00:00:00.000Z', current: true, staleReason: null }),
    ).toEqual({ ...REG, createdAt: '2026-09-30T00:00:00.000Z' });
  });

  it.each([[null], [{}], [{ ...REG, x: 'nope' }], [{ ...REG, odomFrameId: '' }], [{ ...REG, yawDeg: Infinity }]])(
    'rejects %j',
    (raw) => {
      expect(parseOdomRegistration(raw)).toBeNull();
    },
  );
});

describe('FrameRegistrationSource', () => {
  function source(response: () => Promise<Response>) {
    const fetchImpl = vi.fn(response) as unknown as typeof fetch;
    return {
      fetchImpl,
      src: new FrameRegistrationSource({ serverUrl: 'http://server/', robotId: 'robot 1', fetchImpl }),
    };
  }

  it('asks the robot route and returns a found registration', async () => {
    const { src, fetchImpl } = source(async () => Response.json(REG));
    expect(src.url).toBe('http://server/api/robots/robot%201/frame-registration');
    expect(await src.refresh()).toEqual({ kind: 'found', registration: REG });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("treats only the server's own 404 as none", async () => {
    expect(await source(async () => Response.json({ error: 'no frame registration' }, { status: 404 })).src.refresh()).toEqual({
      kind: 'none',
    });
    expect((await source(async () => new Response('Not Found', { status: 404 })).src.refresh()).kind).toBe('error');
  });

  it('reports errors instead of throwing', async () => {
    expect((await source(async () => Promise.reject(new Error('ECONNREFUSED'))).src.refresh()).kind).toBe('error');
    expect((await source(async () => new Response('', { status: 500 })).src.refresh()).kind).toBe('error');
    expect((await source(async () => Response.json({ nope: 1 })).src.refresh()).kind).toBe('error');
  });
});
