/**
 * @file kinematics.test.ts
 * @description The FK and Jacobian primitives, checked against things that are
 *              true independently of how they are implemented.
 * @feature teleop
 */

import { describe, it, expect } from 'vitest';
import {
  axisAngleToMat3,
  cross,
  forwardKinematics,
  jacobian,
  matMul,
  matTVec,
  matVec,
  quatToMat3,
  rotationError,
  solveSymmetric,
  type Mat3,
} from '../kinematics.js';
import { G1_ARM_CHAINS } from '../g1-chains.generated.js';

const RIGHT_ANGLE = Math.PI / 2;

describe('quatToMat3', () => {
  it('reads (w, x, y, z), MJCF order', () => {
    // A quarter turn about +z. Read as (x, y, z, w) the same four numbers are
    // a quarter turn about +x — which is why every boundary in this feature
    // says which order it is in.
    const m = quatToMat3([Math.SQRT1_2, 0, 0, Math.SQRT1_2]);
    const v = matVec(m, [1, 0, 0]);
    expect(v[0]).toBeCloseTo(0, 12);
    expect(v[1]).toBeCloseTo(1, 12);
    expect(v[2]).toBeCloseTo(0, 12);
  });

  it('normalises whatever it is given', () => {
    const m = quatToMat3([2, 0, 0, 0]);
    expect(m).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  });

  it('answers a zero quaternion with the identity rather than NaN', () => {
    expect(quatToMat3([0, 0, 0, 0])).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  });
});

describe('axisAngleToMat3', () => {
  it('turns +x onto +y for a quarter turn about +z', () => {
    const v = matVec(axisAngleToMat3([0, 0, 1], RIGHT_ANGLE), [1, 0, 0]);
    expect(v[0]).toBeCloseTo(0, 12);
    expect(v[1]).toBeCloseTo(1, 12);
  });

  it('does not care whether the axis was unit length', () => {
    const a = axisAngleToMat3([0, 0, 3], 0.4);
    const b = axisAngleToMat3([0, 0, 1], 0.4);
    for (let i = 0; i < 9; i++) expect(a[i]!).toBeCloseTo(b[i]!, 12);
  });
});

describe('matTVec', () => {
  it('is the inverse rotation', () => {
    const m = quatToMat3([0.6, 0.4, -0.5, 0.3]);
    const v: [number, number, number] = [0.2, -1.1, 0.7];
    const back = matTVec(m, matVec(m, v));
    for (let i = 0; i < 3; i++) expect(back[i]!).toBeCloseTo(v[i]!, 12);
  });
});

describe('rotationError', () => {
  it('is zero for identical orientations', () => {
    const m = quatToMat3([0.5, 0.5, 0.5, 0.5]);
    const e = rotationError(m, m);
    expect(Math.hypot(e[0], e[1], e[2])).toBeCloseTo(0, 10);
  });

  it('recovers the axis and angle of a small rotation', () => {
    const from: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const to = axisAngleToMat3([0, 1, 0], 0.2);
    const e = rotationError(from, to);
    expect(e[0]).toBeCloseTo(0, 9);
    expect(e[1]).toBeCloseTo(0.2, 9);
    expect(e[2]).toBeCloseTo(0, 9);
  });

  it('survives a half turn, where the skew part vanishes', () => {
    // trace = -1, sin(theta) = 0: the general formula divides by zero here and
    // the arm would be handed NaN for the one orientation error it is most
    // likely to see after tracking is regained.
    const from: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const to = axisAngleToMat3([0, 0, 1], Math.PI);
    const e = rotationError(from, to);
    expect(e.every((v) => Number.isFinite(v))).toBe(true);
    expect(Math.hypot(e[0], e[1], e[2])).toBeCloseTo(Math.PI, 6);
    expect(Math.abs(e[2])).toBeCloseTo(Math.PI, 6);
  });

  it('is expressed in the root frame, not the body frame', () => {
    // `to · fromᵀ`, not `fromᵀ · to`. Getting it the other way round gives a
    // loop that converges in position and spins forever in orientation.
    const from = axisAngleToMat3([0, 0, 1], 1.1);
    const to = matMul(axisAngleToMat3([1, 0, 0], 0.3), from);
    const e = rotationError(from, to);
    expect(e[0]).toBeCloseTo(0.3, 9);
    expect(e[1]).toBeCloseTo(0, 9);
    expect(e[2]).toBeCloseTo(0, 9);
  });
});

describe('the Jacobian', () => {
  it('matches finite differences of the forward kinematics', () => {
    const chain = G1_ARM_CHAINS.left;
    const q = [0.31, -0.42, 0.55, 1.1, -0.3, 0.22, 0.17];
    const pose = forwardKinematics(chain, q);
    const J = jacobian(pose);
    const n = q.length;
    const h = 1e-6;
    for (let i = 0; i < n; i++) {
      const bumped = q.slice();
      bumped[i] = q[i]! + h;
      const after = forwardKinematics(chain, bumped);
      for (let axis = 0; axis < 3; axis++) {
        const numeric = (after.tip[axis]! - pose.tip[axis]!) / h;
        expect(J[axis * n + i]!).toBeCloseTo(numeric, 4);
      }
      // And the angular half, read off the rotation the bump produced.
      const rot = rotationError(pose.tipRot, after.tipRot);
      for (let axis = 0; axis < 3; axis++) {
        expect(J[(3 + axis) * n + i]!).toBeCloseTo(rot[axis]! / h, 4);
      }
    }
  });

  it('gives a joint no leverage over a point on its own axis', () => {
    // The last joint's axis passes through the wrist, so a tip sitting exactly
    // on that axis cannot be moved by it — the cross product is zero.
    const chain = G1_ARM_CHAINS.left;
    const pose = forwardKinematics(chain, new Array(7).fill(0));
    const last = pose.axes[6]!;
    const arm = cross(last, [0, 0, 0]);
    expect(Math.hypot(arm[0], arm[1], arm[2])).toBe(0);
  });
});

describe('solveSymmetric', () => {
  it('solves a system it should', () => {
    const A = [4, 1, 0, 1, 3, 1, 0, 1, 2];
    const b = [1, 2, 3];
    const x = solveSymmetric(A, b, 3)!;
    expect(x).not.toBeNull();
    for (let r = 0; r < 3; r++) {
      let acc = 0;
      for (let c = 0; c < 3; c++) acc += A[r * 3 + c]! * x[c]!;
      expect(acc).toBeCloseTo(b[r]!, 10);
    }
  });

  it('returns null for a singular system rather than NaN', () => {
    expect(solveSymmetric([1, 2, 2, 4], [1, 2], 2)).toBeNull();
  });
});
