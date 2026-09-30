/**
 * @file FrameRegistrationService.test.ts
 * @description The SE(2) maths and request parsing behind a robot's frame
 *              registration (TASK-341): the anchor puts the odometry pose
 *              exactly on the twin pose, inversion round-trips, yaw wraps.
 * @feature robots
 */

import { describe, it, expect } from 'vitest';
import {
  applyTransform,
  composeAnchorTransform,
  invertTransform,
  parseRegistrationRequest,
  polygonCentroid,
  wrapDeg,
  type Pose2D,
} from '../FrameRegistrationService.js';

function expectPose(actual: Pose2D, expected: Pose2D): void {
  expect(actual.x).toBeCloseTo(expected.x, 9);
  expect(actual.y).toBeCloseTo(expected.y, 9);
  expect(wrapDeg(actual.headingDeg - expected.headingDeg)).toBeCloseTo(0, 9);
}

describe('wrapDeg', () => {
  it.each([
    [0, 0],
    [180, 180],
    [-180, 180],
    [190, -170],
    [-190, 170],
    [540, 180],
    [720, 0],
    [-359, 1],
  ])('%d° → %d°', (input, expected) => {
    expect(wrapDeg(input)).toBeCloseTo(expected, 9);
  });
});

describe('composeAnchorTransform', () => {
  it('maps odom (1, 0, 0°) onto a place at (3, 2) facing 90°', () => {
    const t = composeAnchorTransform({ x: 1, y: 0, headingDeg: 0 }, { x: 3, y: 2, headingDeg: 90 });
    expect(t.yawDeg).toBeCloseTo(90, 9);
    expectPose(applyTransform(t, { x: 1, y: 0, headingDeg: 0 }), { x: 3, y: 2, headingDeg: 90 });
    // One metre further along odom +x is one metre along twin +y after a 90° turn.
    expectPose(applyTransform(t, { x: 2, y: 0, headingDeg: 0 }), { x: 3, y: 3, headingDeg: 90 });
  });

  it('is the identity when odometry already is the twin frame', () => {
    const t = composeAnchorTransform({ x: 4, y: -1, headingDeg: 30 }, { x: 4, y: -1, headingDeg: 30 });
    expect(t.x).toBeCloseTo(0, 9);
    expect(t.y).toBeCloseTo(0, 9);
    expect(t.yawDeg).toBeCloseTo(0, 9);
  });

  it('wraps the yaw across ±180°', () => {
    const t = composeAnchorTransform({ x: 0, y: 0, headingDeg: -170 }, { x: 0, y: 0, headingDeg: 170 });
    expect(t.yawDeg).toBeCloseTo(-20, 9);
  });
});

describe('invertTransform', () => {
  it('round-trips a pose through a transform and its inverse', () => {
    const t = { x: 3.2, y: -1.5, yawDeg: 137 };
    const inv = invertTransform(t);
    for (const p of [
      { x: 0, y: 0, headingDeg: 0 },
      { x: 1.5, y: -7, headingDeg: 179 },
      { x: -4, y: 2.25, headingDeg: -90 },
    ]) {
      expectPose(applyTransform(inv, applyTransform(t, p)), p);
      expectPose(applyTransform(t, applyTransform(inv, p)), p);
    }
  });
});

describe('polygonCentroid', () => {
  it('is the area centroid of a rectangle, whichever way it winds', () => {
    const ccw: [number, number][] = [[2, 1], [4, 1], [4, 3], [2, 3]];
    expect(polygonCentroid(ccw)).toEqual({ x: 3, y: 2 });
    expect(polygonCentroid([...ccw].reverse())).toEqual({ x: 3, y: 2 });
  });

  it('is not the vertex mean for an L-shape', () => {
    const l: [number, number][] = [[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]];
    const c = polygonCentroid(l);
    expect(c.x).toBeCloseTo(5 / 6, 9);
    expect(c.y).toBeCloseTo(5 / 6, 9);
  });
});

describe('parseRegistrationRequest', () => {
  it('accepts a place anchor and a manual transform', () => {
    expect(parseRegistrationRequest({ method: 'place-anchor', placeId: ' AISLE-1 ', headingDeg: 450 })).toEqual({
      method: 'place-anchor',
      placeId: 'AISLE-1',
      headingDeg: 90,
    });
    expect(parseRegistrationRequest({ method: 'manual', x: 1, y: 2, yawDeg: -270 })).toEqual({
      method: 'manual',
      x: 1,
      y: 2,
      yawDeg: 90,
    });
  });

  it.each([
    [null],
    [{}],
    [{ method: 'guess' }],
    [{ method: 'manual', x: 1, y: 2 }],
    [{ method: 'manual', x: '1', y: 2, yawDeg: 0 }],
    [{ method: 'manual', x: Number.NaN, y: 2, yawDeg: 0 }],
    [{ method: 'place-anchor', placeId: '', headingDeg: 0 }],
    [{ method: 'place-anchor', placeId: 'A' }],
  ])('refuses %j with a message', (body) => {
    expect(typeof parseRegistrationRequest(body)).toBe('string');
  });
});
