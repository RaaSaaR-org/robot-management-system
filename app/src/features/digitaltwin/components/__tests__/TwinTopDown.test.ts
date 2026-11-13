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
  labelBoxesCollide,
  layoutZoneLabels,
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

describe('layoutZoneLabels (TASK-495)', () => {
  const rect = (id: string, name: string, x0: number, y0: number, x1: number, y1: number) =>
    ({
      id,
      name,
      type: 'place',
      points: [
        { x: x0, y: y0 },
        { x: x1, y: y0 },
        { x: x1, y: y1 },
        { x: x0, y: y1 },
      ],
    }) as unknown as TwinZoneDTO;
  const same = (p: { x: number; y: number }) => p;
  const AISLE = rect('a', 'AISLE-1', 0, 0, 30, 200);
  const HALL = rect('h', 'HALL', 100, 0, 400, 200);

  it('writes a name across its zone, on the centroid', () => {
    const [label] = layoutZoneLabels([HALL], same, 12, true);
    expect(label).toMatchObject({ zoneId: 'h', at: { x: 250, y: 100 }, rotated: false });
    expect(label!.box.x + label!.box.w / 2).toBeCloseTo(250);
    expect(label!.box.h).toBe(12);
  });

  it('turns a name that is wider than its tall zone to run along it', () => {
    const [label] = layoutZoneLabels([AISLE], same, 12, true);
    expect(label!.rotated).toBe(true);
    // Its footprint is then one line wide and the name long.
    expect(label!.box.w).toBe(12);
    expect(label!.box.h).toBeGreaterThan(30);
    expect(label!.box.y + label!.box.h / 2).toBeCloseTo(100);
  });

  it('leaves every name across where the caller does not ask for a fit — the zone editor', () => {
    expect(layoutZoneLabels([AISLE], same).map((l) => l.rotated)).toEqual([false]);
  });

  it('keeps a wide name across a zone that is no taller than wide, and skips a zone without points', () => {
    const squat = rect('s', 'A-VERY-LONG-ZONE-NAME', 0, 0, 40, 30);
    const empty = { ...HALL, id: 'e', points: [] } as TwinZoneDTO;
    expect(layoutZoneLabels([squat, empty], same, 12, true)).toMatchObject([{ zoneId: 's', rotated: false }]);
  });
});

describe('labelBoxesCollide (TASK-495)', () => {
  const a = { x: 0, y: 0, w: 10, h: 10 };
  it('is true for boxes that overlap and false for boxes that only touch', () => {
    expect(labelBoxesCollide(a, { x: 5, y: 5, w: 10, h: 10 })).toBe(true);
    expect(labelBoxesCollide(a, { x: 10, y: 0, w: 10, h: 10 })).toBe(false);
    expect(labelBoxesCollide(a, { x: 0, y: 30, w: 10, h: 10 })).toBe(false);
  });
  it('counts a gap as a collision when asked to keep one', () => {
    expect(labelBoxesCollide(a, { x: 12, y: 0, w: 10, h: 10 }, 3)).toBe(true);
  });
});
