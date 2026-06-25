/**
 * @file pointcloud-binary.test.ts
 * @description Round-trip tests for the binary point-cloud wire format
 * @feature robot
 * @status test
 */

import { describe, it, expect } from 'vitest';
import { encodePointCloudFrame, decodePointCloudFrame, POINTCLOUD_HEADER_BYTES } from '../pointcloud-binary.js';
import type { PointCloudFrame } from '../types.js';

function makeFrame(positions: number[], intensities: number[], hasIntensity = true): PointCloudFrame {
  return {
    robotId: 'r1',
    sensor: 'mid360_lidar',
    sensorType: 'lidar',
    frame: 'base_link',
    pointCount: positions.length / 3,
    positions,
    intensities,
    hasIntensity,
    sequence: 99,
    timestamp: new Date(0).toISOString(),
  };
}

describe('point-cloud binary codec', () => {
  it('round-trips positions within quantization tolerance', () => {
    const positions = [0, 0, 0, 1.5, -2.0, 3.25, -4.0, 4.0, 0.5];
    const intensities = [0.1, 0.5, 0.9];
    const buf = encodePointCloudFrame(makeFrame(positions, intensities));
    const decoded = decodePointCloudFrame(buf);

    expect(decoded.pointCount).toBe(3);
    expect(decoded.sequence).toBe(99);
    expect(decoded.hasIntensity).toBe(true);

    // Quantization error bounded by span/65535 — well under 1mm for this span.
    for (let i = 0; i < positions.length; i++) {
      expect(decoded.positions[i]).toBeCloseTo(positions[i], 2);
    }
    for (let i = 0; i < intensities.length; i++) {
      expect(decoded.intensities[i]).toBeCloseTo(intensities[i], 2);
    }
  });

  it('omits intensity bytes when hasIntensity is false', () => {
    const positions = [0, 0, 0, 1, 1, 1];
    const buf = encodePointCloudFrame(makeFrame(positions, [], false));
    // header + 3 uint16 * 2 points (no intensity bytes)
    expect(buf.length).toBe(POINTCLOUD_HEADER_BYTES + 2 * 6);
    const decoded = decodePointCloudFrame(buf);
    expect(decoded.hasIntensity).toBe(false);
  });

  it('handles an empty cloud', () => {
    const buf = encodePointCloudFrame(makeFrame([], []));
    const decoded = decodePointCloudFrame(buf);
    expect(decoded.pointCount).toBe(0);
    expect(decoded.positions.length).toBe(0);
  });

  it('rejects a buffer with a bad magic number', () => {
    const bad = Buffer.alloc(POINTCLOUD_HEADER_BYTES);
    expect(() => decodePointCloudFrame(bad)).toThrow(/magic/i);
  });
});
