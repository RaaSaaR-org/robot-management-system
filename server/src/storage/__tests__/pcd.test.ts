/**
 * @file pcd.test.ts
 * @description Unit tests for the binary PCD encoder + bounds helper
 * @feature storage
 */

import { describe, it, expect } from 'vitest';
import { encodePcdBinary, computeBounds } from '../pcd.js';

describe('computeBounds', () => {
  it('computes the axis-aligned bounding box', () => {
    const positions = [0, 0, 0, 1, -2, 3, -4, 5, -6];
    expect(computeBounds(positions)).toEqual([-4, -2, -6, 1, 5, 3]);
  });

  it('returns zeros for an empty cloud', () => {
    expect(computeBounds([])).toEqual([0, 0, 0, 0, 0, 0]);
  });
});

describe('encodePcdBinary', () => {
  it('writes a valid binary PCD header and body', () => {
    const cloud = {
      pointCount: 2,
      positions: [1, 2, 3, 4, 5, 6],
      intensities: [0.25, 0.75],
      hasIntensity: true,
    };
    const buf = encodePcdBinary(cloud);
    const text = buf.toString('ascii', 0, buf.indexOf('DATA binary\n') + 'DATA binary\n'.length);

    expect(text).toContain('VERSION 0.7');
    expect(text).toContain('FIELDS x y z intensity');
    expect(text).toContain('POINTS 2');
    expect(text).toContain('DATA binary');

    // Body: 2 points * 16 bytes (4 float32).
    const headerLen = buf.indexOf('DATA binary\n') + 'DATA binary\n'.length;
    expect(buf.length - headerLen).toBe(2 * 16);

    // First point round-trips.
    const x = buf.readFloatLE(headerLen);
    const y = buf.readFloatLE(headerLen + 4);
    const z = buf.readFloatLE(headerLen + 8);
    const intensity = buf.readFloatLE(headerLen + 12);
    expect(x).toBeCloseTo(1);
    expect(y).toBeCloseTo(2);
    expect(z).toBeCloseTo(3);
    expect(intensity).toBeCloseTo(0.25);
  });

  it('writes zero intensity when hasIntensity is false', () => {
    const buf = encodePcdBinary({ pointCount: 1, positions: [1, 1, 1], intensities: [], hasIntensity: false });
    const headerLen = buf.indexOf('DATA binary\n') + 'DATA binary\n'.length;
    expect(buf.readFloatLE(headerLen + 12)).toBe(0);
  });
});
