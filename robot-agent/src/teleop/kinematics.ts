/**
 * @file kinematics.ts
 * @description Forward kinematics and geometric Jacobians for the serial chains
 *              in `g1-chains.generated.ts`. Pure, allocation-light, no MuJoCo.
 * @feature teleop
 * @status live
 *
 * QUATERNION ORDER IS (w, x, y, z) EVERYWHERE IN THIS FILE. That is MJCF's
 * order, because the chain table is read straight out of the MJCF. WebXR and
 * three.js both use (x, y, z, w); the socket boundary converts, exactly once,
 * in `wrist-teleop.ts`. A quaternion that has crossed the boundary in the wrong
 * order is very nearly the identity for small rotations, so it does not throw —
 * it just leaves the arm quietly, consistently wrong.
 */

import type { Chain } from './g1-chains.generated.js';

/** A point or a direction in metres, (x, y, z). */
export type Vec3 = readonly [number, number, number];
/** A rotation, (w, x, y, z). */
export type Quat = readonly [number, number, number, number];
/** A rotation matrix, row-major: `m[3*row + col]`. */
export type Mat3 = number[];

export const IDENTITY_MAT3: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** `q` as a rotation matrix. Normalises first — MJCF quats are unit to ~1e-9,
 *  but a quaternion off the wire is whatever the client sent. */
export function quatToMat3(q: Quat): Mat3 {
  const n = Math.hypot(q[0], q[1], q[2], q[3]);
  if (!(n > 0)) return IDENTITY_MAT3.slice();
  const w = q[0] / n, x = q[1] / n, y = q[2] / n, z = q[3] / n;
  const xx = x * x, yy = y * y, zz = z * z;
  const xy = x * y, xz = x * z, yz = y * z;
  const wx = w * x, wy = w * y, wz = w * z;
  return [
    1 - 2 * (yy + zz), 2 * (xy - wz), 2 * (xz + wy),
    2 * (xy + wz), 1 - 2 * (xx + zz), 2 * (yz - wx),
    2 * (xz - wy), 2 * (yz + wx), 1 - 2 * (xx + yy),
  ];
}

/** Rodrigues: rotation of `angle` radians about the unit vector `axis`. */
export function axisAngleToMat3(axis: Vec3, angle: number): Mat3 {
  const n = Math.hypot(axis[0], axis[1], axis[2]);
  if (!(n > 0)) return IDENTITY_MAT3.slice();
  const x = axis[0] / n, y = axis[1] / n, z = axis[2] / n;
  const c = Math.cos(angle), s = Math.sin(angle), t = 1 - c;
  return [
    t * x * x + c, t * x * y - s * z, t * x * z + s * y,
    t * x * y + s * z, t * y * y + c, t * y * z - s * x,
    t * x * z - s * y, t * y * z + s * x, t * z * z + c,
  ];
}

/** `a · b`, both row-major. */
export function matMul(a: Mat3, b: Mat3): Mat3 {
  const out: Mat3 = new Array(9);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out[3 * r + c] = a[3 * r] * b[c] + a[3 * r + 1] * b[3 + c] + a[3 * r + 2] * b[6 + c];
    }
  }
  return out;
}

/** `m · v`. */
export function matVec(m: Mat3, v: Vec3): [number, number, number] {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

/** `mᵀ · v` — for a rotation matrix, the inverse rotation. */
export function matTVec(m: Mat3, v: Vec3): [number, number, number] {
  return [
    m[0] * v[0] + m[3] * v[1] + m[6] * v[2],
    m[1] * v[0] + m[4] * v[1] + m[7] * v[2],
    m[2] * v[0] + m[5] * v[1] + m[8] * v[2],
  ];
}

export function cross(a: Vec3, b: Vec3): [number, number, number] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function sub(a: Vec3, b: Vec3): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function norm(v: Vec3): number {
  return Math.hypot(v[0], v[1], v[2]);
}

/**
 * The rotation that takes `from` to `to`, as an axis-angle 3-vector — i.e.
 * `log(to · fromᵀ)`, expressed in the root frame.
 *
 * Returned in the root frame, not the body frame, because the Jacobian's
 * angular rows are root-frame axes; mixing the two is the classic way to get an
 * IK loop that converges in position and spins forever in orientation.
 */
export function rotationError(from: Mat3, to: Mat3): [number, number, number] {
  // R = to · fromᵀ
  const R: Mat3 = new Array(9);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      R[3 * r + c] = to[3 * r] * from[3 * c] + to[3 * r + 1] * from[3 * c + 1]
        + to[3 * r + 2] * from[3 * c + 2];
    }
  }
  const trace = R[0] + R[4] + R[8];
  // Numerically, `trace` can leave [-1, 3] by ~1e-15 and put acos out of domain.
  const cosTheta = Math.min(1, Math.max(-1, (trace - 1) / 2));
  const theta = Math.acos(cosTheta);
  const sinTheta = Math.sin(theta);
  if (theta < 1e-8) {
    // First-order: the skew part IS the rotation vector.
    return [(R[7] - R[5]) / 2, (R[2] - R[6]) / 2, (R[3] - R[1]) / 2];
  }
  if (sinTheta < 1e-8) {
    // theta ~ pi: the skew part vanishes, so read the axis off R + I instead.
    // Any of the three columns works; take the largest for conditioning.
    const diag = [R[0] + 1, R[4] + 1, R[8] + 1];
    let k = 0;
    if (diag[1] > diag[k]) k = 1;
    if (diag[2] > diag[k]) k = 2;
    const col: [number, number, number] = [R[k], R[3 + k], R[6 + k]];
    col[k] += 1;
    const n = Math.hypot(col[0], col[1], col[2]);
    if (!(n > 0)) return [0, 0, 0];
    return [(col[0] / n) * theta, (col[1] / n) * theta, (col[2] / n) * theta];
  }
  const k = theta / (2 * sinTheta);
  return [(R[7] - R[5]) * k, (R[2] - R[6]) * k, (R[3] - R[1]) * k];
}

/** Where every joint of a chain sits, and where its tip ends up. */
export interface ChainPose {
  /** Joint anchor positions in the root frame, one per link. */
  anchors: [number, number, number][];
  /** Joint axes in the root frame, unit length, one per link. */
  axes: [number, number, number][];
  /** The tip point in the root frame. */
  tip: [number, number, number];
  /** The tip body's orientation in the root frame. */
  tipRot: Mat3;
}

/**
 * Forward kinematics for one chain at joint vector `q` (radians, one per link).
 *
 * `T_child = T_parent · Trans(pos) · Rot(quat) · Rot(axis, q)`, which is the
 * composition MuJoCo performs — verified against `mj_forward` to 1e-6 by
 * `robot-agent/hardware/sim_g1_dds/test_teleop_chains.py`.
 */
export function forwardKinematics(chain: Chain, q: readonly number[]): ChainPose {
  let R: Mat3 = IDENTITY_MAT3.slice();
  let p: [number, number, number] = [0, 0, 0];
  const anchors: [number, number, number][] = [];
  const axes: [number, number, number][] = [];

  for (let i = 0; i < chain.links.length; i++) {
    const link = chain.links[i]!;
    // Rigid offset, then the body's fixed rotation.
    const offset = matVec(R, link.pos);
    p = [p[0] + offset[0], p[1] + offset[1], p[2] + offset[2]];
    R = matMul(R, quatToMat3(link.quat));
    // The joint anchor is the body origin (the exporter refuses a `pos=` on a
    // joint), and its axis is fixed in the body frame — so both are known
    // BEFORE the joint rotation is applied, and rotating about an axis does not
    // move that axis.
    anchors.push([p[0], p[1], p[2]]);
    axes.push(matVec(R, link.axis));
    R = matMul(R, axisAngleToMat3(link.axis, q[i] ?? 0));
  }

  const tipOffset = matVec(R, chain.tip);
  return {
    anchors,
    axes,
    tip: [p[0] + tipOffset[0], p[1] + tipOffset[1], p[2] + tipOffset[2]],
    tipRot: R,
  };
}

/**
 * The 6×n geometric Jacobian of the tip, in the root frame, row-major:
 * rows 0..2 are ∂tip/∂q, rows 3..5 are angular velocity per q̇.
 */
export function jacobian(pose: ChainPose): number[] {
  const n = pose.axes.length;
  const J = new Array<number>(6 * n).fill(0);
  for (let i = 0; i < n; i++) {
    const a = pose.axes[i]!;
    const r = sub(pose.tip, pose.anchors[i]!);
    const v = cross(a, r);
    J[i] = v[0];
    J[n + i] = v[1];
    J[2 * n + i] = v[2];
    J[3 * n + i] = a[0];
    J[4 * n + i] = a[1];
    J[5 * n + i] = a[2];
  }
  return J;
}

/**
 * Solve `A x = b` for a small dense symmetric `A`, by Gaussian elimination with
 * partial pivoting. Returns null when `A` is singular.
 *
 * Used by the over-constrained least-squares form (more task rows than joints),
 * where the normal equations `(JᵀJ + λ²I) dq = Jᵀ e` are n×n. The under-
 * constrained arm solver uses the other form and its own 3×3 inverse.
 */
export function solveSymmetric(A: readonly number[], b: readonly number[], n: number): number[] | null {
  const m = A.slice();
  const x = b.slice();
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(m[row * n + col]!) > Math.abs(m[pivot * n + col]!)) pivot = row;
    }
    if (Math.abs(m[pivot * n + col]!) < 1e-12) return null;
    if (pivot !== col) {
      for (let k = 0; k < n; k++) {
        const t = m[col * n + k]!;
        m[col * n + k] = m[pivot * n + k]!;
        m[pivot * n + k] = t;
      }
      const t = x[col]!;
      x[col] = x[pivot]!;
      x[pivot] = t;
    }
    for (let row = col + 1; row < n; row++) {
      const f = m[row * n + col]! / m[col * n + col]!;
      if (f === 0) continue;
      for (let k = col; k < n; k++) m[row * n + k]! -= f * m[col * n + k]!;
      x[row]! -= f * x[col]!;
    }
  }
  for (let row = n - 1; row >= 0; row--) {
    let acc = x[row]!;
    for (let k = row + 1; k < n; k++) acc -= m[row * n + k]! * x[k]!;
    x[row] = acc / m[row * n + row]!;
  }
  for (const v of x) if (!Number.isFinite(v)) return null;
  return x;
}
