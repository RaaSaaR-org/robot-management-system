/**
 * @file pointcloud-parse.test.ts
 * @description Unit tests for the twin scan-import parsers (PLY ascii/binary,
 *              PCD ascii/binary) and the floor normalization.
 * @feature digitaltwin
 */

import { describe, it, expect } from 'vitest';
import {
  parsePointCloudFile,
  normalizeFloorToZero,
  PointCloudParseError,
} from '../pointcloud-parse.js';

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

const POINTS: Array<[number, number, number, number]> = [
  [0, 0, 0, 0.1],
  [1, 2, 3, 0.5],
  [-1.5, 0.25, 2.75, 1.0],
];

function asciiPly(withIntensity = true): Buffer {
  const props = withIntensity
    ? 'property float x\nproperty float y\nproperty float z\nproperty float intensity\n'
    : 'property float x\nproperty float y\nproperty float z\n';
  const rows = POINTS.map(([x, y, z, i]) =>
    withIntensity ? `${x} ${y} ${z} ${i}` : `${x} ${y} ${z}`,
  ).join('\n');
  return Buffer.from(
    `ply\nformat ascii 1.0\ncomment real capture\nelement vertex ${POINTS.length}\n${props}end_header\n${rows}\n`,
    'ascii',
  );
}

function binaryPly(): Buffer {
  const header = Buffer.from(
    `ply\nformat binary_little_endian 1.0\nelement vertex ${POINTS.length}\n` +
      'property float x\nproperty float y\nproperty float z\nproperty float intensity\n' +
      'end_header\n',
    'ascii',
  );
  const body = Buffer.alloc(POINTS.length * 16);
  POINTS.forEach(([x, y, z, i], k) => {
    body.writeFloatLE(x, k * 16);
    body.writeFloatLE(y, k * 16 + 4);
    body.writeFloatLE(z, k * 16 + 8);
    body.writeFloatLE(i, k * 16 + 12);
  });
  return Buffer.concat([header, body]);
}

function asciiPcd(): Buffer {
  const rows = POINTS.map(([x, y, z, i]) => `${x} ${y} ${z} ${i}`).join('\n');
  return Buffer.from(
    `# .PCD v0.7\nVERSION 0.7\nFIELDS x y z intensity\nSIZE 4 4 4 4\nTYPE F F F F\n` +
      `COUNT 1 1 1 1\nWIDTH ${POINTS.length}\nHEIGHT 1\nVIEWPOINT 0 0 0 1 0 0 0\n` +
      `POINTS ${POINTS.length}\nDATA ascii\n${rows}\n`,
    'ascii',
  );
}

function binaryPcd(): Buffer {
  const header = Buffer.from(
    `# .PCD v0.7\nVERSION 0.7\nFIELDS x y z intensity\nSIZE 4 4 4 4\nTYPE F F F F\n` +
      `COUNT 1 1 1 1\nWIDTH ${POINTS.length}\nHEIGHT 1\nVIEWPOINT 0 0 0 1 0 0 0\n` +
      `POINTS ${POINTS.length}\nDATA binary\n`,
    'ascii',
  );
  const body = Buffer.alloc(POINTS.length * 16);
  POINTS.forEach(([x, y, z, i], k) => {
    body.writeFloatLE(x, k * 16);
    body.writeFloatLE(y, k * 16 + 4);
    body.writeFloatLE(z, k * 16 + 8);
    body.writeFloatLE(i, k * 16 + 12);
  });
  return Buffer.concat([header, body]);
}

function expectParsed(buf: Buffer, name: string, format: 'ply' | 'pcd', intensity = true) {
  const cloud = parsePointCloudFile(buf, name);
  expect(cloud.format).toBe(format);
  expect(cloud.pointCount).toBe(POINTS.length);
  expect(cloud.hasIntensity).toBe(intensity);
  POINTS.forEach(([x, y, z, i], k) => {
    expect(cloud.positions[k * 3]).toBeCloseTo(x, 5);
    expect(cloud.positions[k * 3 + 1]).toBeCloseTo(y, 5);
    expect(cloud.positions[k * 3 + 2]).toBeCloseTo(z, 5);
    if (intensity) expect(cloud.intensities[k]).toBeCloseTo(i, 5);
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('parsePointCloudFile', () => {
  it('parses ASCII PLY with intensity', () => {
    expectParsed(asciiPly(), 'g1_cloud.ply', 'ply');
  });

  it('parses ASCII PLY without intensity (zeros)', () => {
    const cloud = parsePointCloudFile(asciiPly(false), 'plain.ply');
    expect(cloud.hasIntensity).toBe(false);
    expect(cloud.intensities.every((v) => v === 0)).toBe(true);
  });

  it('parses binary_little_endian PLY', () => {
    expectParsed(binaryPly(), 'cloud.ply', 'ply');
  });

  it('parses ASCII PCD', () => {
    expectParsed(asciiPcd(), 'scan.pcd', 'pcd');
  });

  it('parses binary PCD', () => {
    expectParsed(binaryPcd(), 'scan.pcd', 'pcd');
  });

  it('sniffs the format when the extension is unknown', () => {
    expectParsed(asciiPly(), 'upload.bin', 'ply');
  });

  it('rejects unsupported formats', () => {
    expect(() => parsePointCloudFile(Buffer.from('hello world'), 'notes.txt')).toThrow(
      PointCloudParseError,
    );
  });

  it('rejects truncated binary bodies', () => {
    const full = binaryPly();
    expect(() => parsePointCloudFile(full.subarray(0, full.length - 8), 'cut.ply')).toThrow(
      /truncated/,
    );
  });

  it('rejects PLY with no vertices', () => {
    const buf = Buffer.from(
      'ply\nformat ascii 1.0\nelement vertex 0\nproperty float x\nproperty float y\nproperty float z\nend_header\n',
      'ascii',
    );
    expect(() => parsePointCloudFile(buf, 'empty.ply')).toThrow(PointCloudParseError);
  });

  it('rejects ASCII PLY with an element declared before vertex', () => {
    // A pre-vertex element shifts the ascii body: the reader would consume the
    // camera row as a vertex. The binary path already rejected this; ascii now
    // does too (issue #186).
    const buf = Buffer.from(
      'ply\nformat ascii 1.0\n' +
        'element camera 1\nproperty float view_px\n' +
        'element vertex 2\nproperty float x\nproperty float y\nproperty float z\n' +
        'end_header\n0.0\n1.0 2.0 3.0\n4.0 5.0 6.0\n',
      'ascii',
    );
    expect(() => parsePointCloudFile(buf, 'cam.ply')).toThrow(/before vertex/);
  });
});

describe('normalizeFloorToZero', () => {
  it('shifts a sensor-frame cloud so the floor sits at z=0', () => {
    // Floor slab at z=-1.2 plus some structure above it.
    const positions: number[] = [];
    for (let k = 0; k < 200; k++) positions.push(k * 0.01, 0, -1.2);
    positions.push(0, 0, 0.5, 0, 0, 1.0);
    const cloud = {
      pointCount: positions.length / 3,
      positions,
      intensities: new Array(positions.length / 3).fill(0),
      hasIntensity: false,
    };
    const offset = normalizeFloorToZero(cloud);
    expect(offset).toBeCloseTo(-1.2, 3);
    // Former floor points now at ~0, structure lifted accordingly.
    expect(cloud.positions[2]).toBeCloseTo(0, 3);
    expect(cloud.positions[positions.length - 1]).toBeCloseTo(2.2, 3);
  });

  it('is a no-op for a cloud already floored at zero', () => {
    const positions = [0, 0, 0, 1, 1, 1.5];
    const cloud = { pointCount: 2, positions: [...positions], intensities: [0, 0], hasIntensity: false };
    expect(normalizeFloorToZero(cloud)).toBe(0);
    expect(cloud.positions).toEqual(positions);
  });
});
