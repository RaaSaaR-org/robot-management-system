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

  describe('with the pose frame declared (TASK-328)', () => {
    const twinGraph = () => graph({ id: 'twin-demo', kind: 'site', twinId: 'twin-demo' });

    it('registers a twin graph on a SIM robot — its world origin is the twin origin', () => {
      expect(assessFrameRegistration(twinGraph(), { poseFrame: 'twin' })).toEqual({
        registered: true,
        how: 'sim-twin-origin',
      });
    });

    it('keeps real hardware + twin UNREGISTERED with exactly the old reason', () => {
      const declared = assessFrameRegistration(twinGraph(), { poseFrame: 'odom' });
      const legacy = assessFrameRegistration(twinGraph());
      expect(declared.registered).toBe(false);
      expect(declared).toEqual(legacy);
    });

    it('leaves a sim-kind graph unchanged for either pose frame', () => {
      const sim = graph({ id: 'warehouse-sim', kind: 'sim' });
      expect(assessFrameRegistration(sim, { poseFrame: 'twin' })).toEqual({ registered: true, how: 'identity' });
      expect(assessFrameRegistration(sim, { poseFrame: 'odom' })).toEqual({ registered: true, how: 'identity' });
    });

    it('does not register a twin-less site graph just because the robot is a sim', () => {
      expect(assessFrameRegistration(graph({ id: 'depot', kind: 'site' }), { poseFrame: 'twin' }).registered).toBe(false);
    });
  });

  describe('with a frame registration (TASK-342)', () => {
    const twinGraph = () => graph({ id: 'twin-demo', kind: 'site', twinId: 'twin-demo' });
    const registration = {
      twinId: 'twin-demo',
      odomFrameId: 'boot-1',
      x: 3,
      y: 2,
      yawDeg: 90,
      method: 'place-anchor',
      createdAt: null,
    };

    it('registers a twin graph on odometry while the registration is current', () => {
      expect(
        assessFrameRegistration(twinGraph(), { poseFrame: 'odom', registration, odomFrameId: 'boot-1' }),
      ).toEqual({ registered: true, how: 'registration', registration });
    });

    it('refuses it once odometry has restarted (a new boot id)', () => {
      const status = assessFrameRegistration(twinGraph(), {
        poseFrame: 'odom',
        registration,
        odomFrameId: 'boot-2',
      });
      expect(status.registered).toBe(false);
      expect(status.registered === false && status.reason).toContain('odometry restarted');
    });

    it('refuses it while the odometry session is not known yet', () => {
      const status = assessFrameRegistration(twinGraph(), { poseFrame: 'odom', registration, odomFrameId: null });
      expect(status.registered).toBe(false);
    });

    it('refuses a registration measured against another twin', () => {
      const status = assessFrameRegistration(twinGraph(), {
        poseFrame: 'odom',
        registration: { ...registration, twinId: 'twin-other' },
        odomFrameId: 'boot-1',
      });
      expect(status.registered).toBe(false);
      expect(status.registered === false && status.reason).toContain('twin-other');
    });

    it('says there is none when there is none', () => {
      const status = assessFrameRegistration(twinGraph(), { poseFrame: 'odom', registration: null, odomFrameId: 'boot-1' });
      expect(status.registered === false && status.reason).toContain('no frame registration');
    });

    it('never applies a registration to a twin-less graph', () => {
      const status = assessFrameRegistration(graph({ id: 'depot', kind: 'site' }), {
        poseFrame: 'odom',
        registration,
        odomFrameId: 'boot-1',
      });
      expect(status.registered).toBe(false);
    });
  });
});
