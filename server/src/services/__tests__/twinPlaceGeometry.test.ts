/**
 * @file twinPlaceGeometry.test.ts
 * @description findContainingPlace (TASK-326): smallest containing place wins,
 *              non-place zones are ignored, null when nothing contains the point.
 * @feature digitaltwin
 */

import { describe, it, expect } from 'vitest';
import {
  findContainingPlace,
  pointInPolygon,
  polygonArea,
  robotIsInTwinZone,
} from '../twinPlaceGeometry.js';

function rect(x0: number, y0: number, x1: number, y1: number) {
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}

const hall = { name: 'hall', type: 'room', points: rect(0, 0, 20, 20) };
const cell = { name: 'cell', type: 'workcell', points: rect(5, 5, 8, 8) };
const slow = { name: 'slow', type: 'speed', points: rect(6, 6, 7, 7) };

describe('twinPlaceGeometry', () => {
  it('computes polygon area and containment', () => {
    expect(polygonArea(rect(0, 0, 2, 3))).toBe(6);
    expect(pointInPolygon({ x: 1, y: 1 }, rect(0, 0, 2, 2))).toBe(true);
    expect(pointInPolygon({ x: 3, y: 1 }, rect(0, 0, 2, 2))).toBe(false);
  });

  it('returns the smallest containing place on overlap, regardless of order', () => {
    expect(findContainingPlace([hall, cell], { x: 6, y: 6 })).toBe(cell);
    expect(findContainingPlace([cell, hall], { x: 6, y: 6 })).toBe(cell);
  });

  it('ignores zones that are not places (speed)', () => {
    expect(findContainingPlace([hall, cell, slow], { x: 6.5, y: 6.5 })).toBe(cell);
  });

  it('returns the enclosing place outside the smaller one', () => {
    expect(findContainingPlace([hall, cell], { x: 15, y: 15 })).toBe(hall);
  });

  it('returns null when no place contains the point', () => {
    expect(findContainingPlace([hall, cell], { x: 30, y: 30 })).toBeNull();
    expect(findContainingPlace([], { x: 0, y: 0 })).toBeNull();
  });

  it('ignores degenerate polygons', () => {
    const line = { type: 'room', points: [{ x: 0, y: 0 }, { x: 50, y: 50 }] };
    expect(findContainingPlace([line], { x: 1, y: 1 })).toBeNull();
  });
});

describe('robotIsInTwinZone (TASK-330)', () => {
  const zone = { zoneId: 'tz-1', name: 'Kitchen', twinId: 't1', placeId: 'KITCHEN' };

  it('matches a robot bound to the zone twin that reports the zone place', () => {
    expect(robotIsInTwinZone({ twinId: 't1', location: { place: 'KITCHEN' } }, zone)).toBe(true);
  });

  it('does not match a robot on another twin, in another place, or unbound', () => {
    expect(robotIsInTwinZone({ twinId: 't2', location: { place: 'KITCHEN' } }, zone)).toBe(false);
    expect(robotIsInTwinZone({ twinId: 't1', location: { place: 'HALL' } }, zone)).toBe(false);
    expect(robotIsInTwinZone({ twinId: null, location: { place: 'KITCHEN' } }, zone)).toBe(false);
  });

  it('never matches a robot whose place is null or absent', () => {
    expect(robotIsInTwinZone({ twinId: 't1', location: { place: null } }, zone)).toBe(false);
    expect(robotIsInTwinZone({ twinId: 't1', location: {} }, zone)).toBe(false);
    expect(robotIsInTwinZone({ twinId: 't1' }, zone)).toBe(false);
  });

  it('never matches a zone that is not a place', () => {
    const notAPlace = { ...zone, placeId: null };
    expect(robotIsInTwinZone({ twinId: 't1', location: { place: null } }, notAPlace)).toBe(false);
  });
});
