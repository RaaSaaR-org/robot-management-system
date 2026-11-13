/**
 * @file TwinTopDown.test.ts
 * @description Where the top-down map takes its bounds from. A site that was
 *              never scanned has no bounds of its own, and the 12 m default
 *              square cut the seeded warehouse's zones off on a narrow map —
 *              a read-only map now fits them instead (TASK-493).
 * @feature digitaltwin
 */

import { describe, it, expect } from 'vitest';
import {
  TOP_DOWN_PADDING,
  TOP_DOWN_VIEW_H,
  TOP_DOWN_VIEW_W,
  deriveWorldBounds,
  makeTopDownTransform,
} from '../TwinTopDown';
import type { DigitalTwinDTO, TwinZoneDTO } from '../../types/twin.types';

const twin = (bounds: Partial<DigitalTwinDTO['bounds']> = {}) =>
  ({
    id: 'tw-1',
    name: 'Demo Warehouse',
    worldOrigin: { x: 0, y: 0, z: 0 },
    bounds: { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0, ...bounds },
  }) as DigitalTwinDTO;

const zone = (points: Array<[number, number]>) =>
  ({ id: 'z', name: 'z', type: 'room', points: points.map(([x, y]) => ({ x, y })) }) as unknown as TwinZoneDTO;

// The seeded warehouse, end to end: DOCK-1-EDGE on the left, AISLE-3 on the right.
const WAREHOUSE = [zone([[-9.95, -3], [-9, -3], [-9, 3], [-9.95, 3]]), zone([[8, -5.5], [10, -5.5], [10, 5.5], [8, 5.5]])];

describe('deriveWorldBounds', () => {
  it('fits an unscanned site to its zones', () => {
    expect(deriveWorldBounds(twin(), null, WAREHOUSE)).toEqual({ minX: -9.95, minY: -5.5, maxX: 10, maxY: 5.5 });
  });

  it('keeps the 12 m square when no zones are passed — the zone editor never passes them', () => {
    expect(deriveWorldBounds(twin())).toEqual({ minX: -6, minY: -6, maxX: 6, maxY: 6 });
    expect(deriveWorldBounds(twin(), null, [])).toEqual({ minX: -6, minY: -6, maxX: 6, maxY: 6 });
  });

  it('believes the scan over the zones', () => {
    expect(deriveWorldBounds(twin({ maxX: 4, maxY: 3 }), null, WAREHOUSE)).toEqual({ minX: 0, minY: 0, maxX: 4, maxY: 3 });
  });
});

describe('makeTopDownTransform', () => {
  const bounds = deriveWorldBounds(twin(), null, WAREHOUSE);
  // What is visible of viewBox x, for an element of this aspect showing the letterboxed 4:3 viewBox.
  const visibleX = (aspect: number) => {
    const w = Math.max(TOP_DOWN_VIEW_W, TOP_DOWN_VIEW_H * aspect);
    return { left: (TOP_DOWN_VIEW_W - w) / 2, right: (TOP_DOWN_VIEW_W + w) / 2 };
  };

  it('fits the viewBox when the element is not known to be wider', () => {
    const t = makeTopDownTransform(bounds);
    expect(t.worldToScreen({ x: bounds.minX, y: 0 }).x).toBeCloseTo(TOP_DOWN_PADDING);
    expect(t.worldToScreen({ x: bounds.maxX, y: 0 }).x).toBeCloseTo(TOP_DOWN_VIEW_W - TOP_DOWN_PADDING);
  });

  it.each([677 / 448, 836 / 448, 1316 / 448, 610 / 256])(
    'draws a wide site as large as an element of aspect %f shows, with both ends inside it',
    (aspect) => {
      const t = makeTopDownTransform(bounds, aspect);
      const { left, right } = visibleX(aspect);
      expect(t.scale).toBeGreaterThan(makeTopDownTransform(bounds).scale);
      expect(t.worldToScreen({ x: bounds.minX, y: 0 }).x).toBeGreaterThanOrEqual(left + TOP_DOWN_PADDING - 0.001);
      expect(t.worldToScreen({ x: bounds.maxX, y: 0 }).x).toBeLessThanOrEqual(right - TOP_DOWN_PADDING + 0.001);
      // Top and bottom stay inside the viewBox, which is as tall as the element.
      expect(t.worldToScreen({ x: 0, y: bounds.maxY }).y).toBeGreaterThanOrEqual(TOP_DOWN_PADDING - 0.001);
      expect(t.worldToScreen({ x: 0, y: bounds.minY }).y).toBeLessThanOrEqual(TOP_DOWN_VIEW_H - TOP_DOWN_PADDING + 0.001);
      // Still centred on the viewBox, and still invertible.
      const mid = t.worldToScreen({ x: (bounds.minX + bounds.maxX) / 2, y: 0 });
      expect(mid.x).toBeCloseTo(TOP_DOWN_VIEW_W / 2);
      expect(t.screenToWorld(mid.x, mid.y).x).toBeCloseTo((bounds.minX + bounds.maxX) / 2);
    },
  );

  it('ignores an element narrower than the viewBox: that one is letterboxed top and bottom', () => {
    expect(makeTopDownTransform(bounds, 0.6).scale).toBe(makeTopDownTransform(bounds).scale);
  });
});
