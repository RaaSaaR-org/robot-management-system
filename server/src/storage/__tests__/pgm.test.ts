/**
 * @file pgm.test.ts
 * @description Unit tests for the PGM reader/writer, the world→pixel transform,
 *              and the polygon scan-fill (TASK-170 Phase 4).
 * @feature digitaltwin
 */

import { describe, it, expect } from 'vitest';
import {
  worldToPixel,
  createGrid,
  fillPolygon,
  encodePgm,
  decodePgm,
  type GridTransform,
  type PixelXY,
} from '../pgm.js';

describe('worldToPixel', () => {
  // A 10x10 grid at origin (0,0), 0.5 m/px → covers [0,5)×[0,5) meters.
  const t: GridTransform = { originX: 0, originY: 0, resolution: 0.5, height: 10 };

  it('maps the origin to the bottom-left pixel (row flipped to bottom)', () => {
    expect(worldToPixel(0, 0, t)).toEqual({ px: 0, py: 9 });
  });

  it('maps increasing Y upward (decreasing row index)', () => {
    // 1.0 m up = 2 px up = row 9 - 2 = 7.
    expect(worldToPixel(0, 1, t)).toEqual({ px: 0, py: 7 });
  });

  it('maps increasing X to higher columns', () => {
    // 2.0 m right = 4 px = col 4.
    expect(worldToPixel(2, 0, t)).toEqual({ px: 4, py: 9 });
  });

  it('honours a non-zero origin', () => {
    const t2: GridTransform = { originX: 10, originY: -5, resolution: 1, height: 8 };
    // (10, -5) → bottom-left.
    expect(worldToPixel(10, -5, t2)).toEqual({ px: 0, py: 7 });
    // (13, -2) → 3 px right, 3 px up → row 7-3=4.
    expect(worldToPixel(13, -2, t2)).toEqual({ px: 3, py: 4 });
  });
});

describe('fillPolygon', () => {
  it('fills a known axis-aligned square exactly', () => {
    const grid = createGrid(6, 6, 0, 255);
    // Square covering pixel columns 1..4 and rows 1..4 (corners in pixel space).
    const square: PixelXY[] = [
      { px: 1, py: 1 },
      { px: 5, py: 1 },
      { px: 5, py: 5 },
      { px: 1, py: 5 },
    ];
    fillPolygon(grid, square, 254);

    // Interior pixel filled.
    expect(grid.data[2 * 6 + 2]).toBe(254);
    expect(grid.data[3 * 6 + 3]).toBe(254);
    // Far corner outside the polygon stays 0.
    expect(grid.data[0 * 6 + 0]).toBe(0);
    expect(grid.data[5 * 6 + 5]).toBe(0);

    // Count filled pixels: even-odd fill of a 4-wide span over 4 rows = 16.
    const filled = grid.data.reduce((acc, v) => acc + (v === 254 ? 1 : 0), 0);
    expect(filled).toBe(16);
  });

  it('ignores degenerate polygons with < 3 vertices', () => {
    const grid = createGrid(4, 4, 0, 255);
    fillPolygon(grid, [{ px: 1, py: 1 }, { px: 2, py: 2 }], 254);
    expect(grid.data.every((v) => v === 0)).toBe(true);
  });

  it('clips a polygon that extends past the grid bounds', () => {
    const grid = createGrid(4, 4, 0, 255);
    const big: PixelXY[] = [
      { px: -10, py: -10 },
      { px: 100, py: -10 },
      { px: 100, py: 100 },
      { px: -10, py: 100 },
    ];
    fillPolygon(grid, big, 254);
    // Entire grid covered, no out-of-bounds writes (no throw).
    expect(grid.data.every((v) => v === 254)).toBe(true);
  });
});

describe('encodePgm / decodePgm', () => {
  it('writes a valid P5 header and round-trips the raster', () => {
    const grid = createGrid(3, 2, 0, 255);
    grid.data[0] = 10;
    grid.data[5] = 200;
    const buf = encodePgm(grid);

    const header = buf.toString('ascii', 0, 20);
    expect(header.startsWith('P5\n3 2\n255\n')).toBe(true);

    const decoded = decodePgm(buf);
    expect(decoded.width).toBe(3);
    expect(decoded.height).toBe(2);
    expect(decoded.maxVal).toBe(255);
    expect(decoded.data[0]).toBe(10);
    expect(decoded.data[5]).toBe(200);
  });

  it('rejects non-P5 input', () => {
    expect(() => decodePgm(Buffer.from('P2\n1 1\n255\n0\n', 'ascii'))).toThrow();
  });
});
