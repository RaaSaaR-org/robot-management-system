/**
 * @file pointcloud-formats.test.ts
 * @description Unit tests for real point-cloud parsers (PCD ascii/binary/
 *              binary_compressed + LZF, KITTI .bin) against REAL recorded data.
 * @feature robots
 * @status test
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import {
  lzfDecompress,
  parsePcd,
  parseKittiBin,
  parsePointCloudFile,
} from '../pointcloud-formats.js';

const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const load = (name: string): Uint8Array => {
  const b = readFileSync(join(FIX, name));
  return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
};

function allFinite(arr: Float32Array): boolean {
  for (let i = 0; i < arr.length; i++) if (!Number.isFinite(arr[i])) return false;
  return true;
}

describe('lzfDecompress', () => {
  it('decodes a literal-only run', () => {
    // ctrl=2 → literal run of 3 bytes [10,20,30]
    const input = new Uint8Array([2, 10, 20, 30]);
    expect(Array.from(lzfDecompress(input, 3))).toEqual([10, 20, 30]);
  });

  it('decodes a back-reference (overlapping copy)', () => {
    // literal 'A' (ctrl=0,'A'), then backref len=3,off=0 → copies 'A' three more times → "AAAA"
    // backref ctrl: top3=len-2=1 (so len=3), low5 + next byte encode (off-1)=0.
    const input = new Uint8Array([0, 0x41, (1 << 5) | 0, 0]);
    expect(new TextDecoder().decode(lzfDecompress(input, 4))).toBe('AAAA');
  });
});

describe('parsePcd — real SICK LMS400 laser scan', () => {
  it('parses the binary PCD fixture (7k real points + intensity)', () => {
    const cloud = parsePcd(load('real-lms400-7k.pcd'));
    expect(cloud.count).toBe(7000);
    expect(cloud.positions.length).toBe(7000 * 3);
    expect(cloud.intensities.length).toBe(7000);
    expect(cloud.hasIntensity).toBe(true);
    expect(allFinite(cloud.positions)).toBe(true);
    // Real SICK intensity is raw 0..~246 before normalization.
    const maxI = Math.max(...Array.from(cloud.intensities));
    expect(maxI).toBeGreaterThan(1);
  });

  it('parses the binary_compressed (LZF) PCD fixture and matches the binary one', () => {
    const compressed = parsePcd(load('real-lms400-1k.compressed.pcd'));
    const binary = parsePcd(load('real-lms400-7k.pcd'));
    expect(compressed.count).toBe(1000);
    expect(allFinite(compressed.positions)).toBe(true);
    // The compressed fixture is the first 1000 points of the binary one (same source).
    for (let i = 0; i < 1000 * 3; i++) {
      expect(compressed.positions[i]).toBeCloseTo(binary.positions[i], 4);
    }
  });
});

describe('parsePcd — real Unitree LiDAR frame (vendor match for the G1)', () => {
  it('parses the ascii PCD with extra ring/time fields, extracting x,y,z,intensity', () => {
    const cloud = parsePcd(load('real-unitree-lidar.pcd'));
    expect(cloud.count).toBe(4320);
    expect(cloud.positions.length).toBe(4320 * 3);
    expect(cloud.hasIntensity).toBe(true);
    expect(allFinite(cloud.positions)).toBe(true);
    // The trailing `ring`/`time` columns must NOT leak into intensity.
    const maxI = Math.max(...Array.from(cloud.intensities));
    expect(maxI).toBeGreaterThan(1); // raw 0..255
    expect(maxI).toBeLessThanOrEqual(255);
    // First point matches the file: -1.9345782 -0.09683609 0.050835956 156
    expect(cloud.positions[0]).toBeCloseTo(-1.9345782, 4);
    expect(cloud.positions[1]).toBeCloseTo(-0.09683609, 4);
    expect(cloud.positions[2]).toBeCloseTo(0.050835956, 4);
    expect(cloud.intensities[0]).toBeCloseTo(156, 1);
  });
});

describe('parseKittiBin — real Velodyne HDL-64E scan', () => {
  it('parses the KITTI .bin fixture (12k real points, x,y,z,intensity)', () => {
    const cloud = parseKittiBin(load('real-kitti-12k.bin'));
    expect(cloud.count).toBe(12000);
    expect(cloud.positions.length).toBe(12000 * 3);
    expect(cloud.hasIntensity).toBe(true);
    expect(allFinite(cloud.positions)).toBe(true);
    // KITTI intensity is already normalized 0..1.
    for (const v of cloud.intensities) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    // Outdoor scan spans tens of meters in x.
    let maxAbsX = 0;
    for (let i = 0; i < cloud.count; i++) maxAbsX = Math.max(maxAbsX, Math.abs(cloud.positions[i * 3]));
    expect(maxAbsX).toBeGreaterThan(20);
  });
});

describe('parsePointCloudFile — dispatch', () => {
  it('routes .pcd to the PCD parser', () => {
    expect(parsePointCloudFile('scan.pcd', load('real-lms400-7k.pcd')).count).toBe(7000);
  });
  it('routes .bin to the KITTI parser', () => {
    expect(parsePointCloudFile('000000.bin', load('real-kitti-12k.bin')).count).toBe(12000);
  });
  it('throws on an unknown extension with non-PCD content', () => {
    expect(() => parsePointCloudFile('x.xyz', new Uint8Array([1, 2, 3, 4]))).toThrow();
  });
});
