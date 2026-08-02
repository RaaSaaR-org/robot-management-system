/**
 * @file place-frame.test.ts
 * @description The frame question the resolver never asked: are the graph's
 *              polygons and the robot's pose numbers about the SAME origin?
 * @feature agentmode
 * @status test
 */

import { describe, expect, it } from 'vitest';

import { assessFrameRegistration } from '../place-frame.js';
import { parsePlaceGraph, type PlaceGraph } from '../place-resolver.js';

function graph(frame: Record<string, unknown>): PlaceGraph {
  return parsePlaceGraph({
    version: 1,
    frame: { units: 'm', yawConvention: 'deg,+x=0,CCW+', ...frame },
    places: [
      {
        id: 'RACK-A',
        name: 'Rack A',
        placeType: 'rack_face',
        floor: 0,
        polygon: [
          [4, -4],
          [5, -4],
          [5, 2],
          [4, 2],
        ],
        source: 'surveyed',
        keepout: true,
      },
    ],
  });
}

describe('assessFrameRegistration', () => {
  it('accepts a sim graph — the MJCF origin IS the odometry origin', () => {
    expect(assessFrameRegistration(graph({ id: 'warehouse-sim', kind: 'sim' }))).toEqual({
      registered: true,
      how: 'identity',
    });
  });

  it('REFUSES a twin graph: its origin is the pose at scan start', () => {
    // `ScanSession.originX/Y` is wherever the robot happened to stand when
    // somebody pressed scan. `rt/odommodestate` starts wherever the base was
    // when the sidecar last came up. Nothing registers the two, so a pose
    // compared against these polygons is confidently in the wrong room.
    const status = assessFrameRegistration(
      graph({ id: 'site-1', kind: 'site', twinId: 'twin-42' }),
    );
    expect(status.registered).toBe(false);
    expect(status.registered === false && status.reason).toContain('twin-42');
    expect(status.registered === false && status.reason).toContain('scan start');
  });

  it('REFUSES a hand-authored site graph too — it is surveyed against a building', () => {
    const status = assessFrameRegistration(graph({ id: 'depot', kind: 'site' }));
    expect(status.registered).toBe(false);
    expect(status.registered === false && status.reason).toContain('depot');
  });

  it('refuses anything it does not recognise rather than assuming identity', () => {
    // Fail CLOSED: a frame kind this build has never heard of is not evidence
    // that the two origins coincide.
    expect(assessFrameRegistration(graph({ id: 'x', kind: 'lidar-slam' })).registered).toBe(false);
  });
});
