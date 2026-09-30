/**
 * @file navigation-places.test.ts
 * @description TASK-329: named moves resolve against the robot's place graph
 *              (id, then name, then type, case-insensitive, to the centroid),
 *              and a target inside a keepout is refused by name.
 * @feature navigation
 * @status test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlaceGraph, type Place } from '../../agent-mode/place-resolver.js';
import type { FrameRegistration } from '../../agent-mode/place-frame.js';
import type { RobotLocation } from '../../robot/types.js';
import type { RobotStateManager } from '../../robot/state.js';
import { keepoutAt, placeTarget, resolvePlaceDestination } from '../place-destination.js';
import {
  chargingStationLocation,
  getChargingStationLocation,
  getHomeLocation,
  moveToLocation,
  setRobotStateManager,
} from '../navigation.js';

// The tools are Genkit tools; the test needs only the handler it was given.
vi.mock('../../agent/genkit.js', () => {
  const chain = (): unknown => ({ optional: () => chain(), describe: () => chain() });
  return {
    z: { object: () => ({}), number: chain, string: chain },
    ai: { defineTool: (_def: unknown, handler: unknown) => handler },
  };
});

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GRAPH = loadPlaceGraph(
  path.resolve(HERE, '../../../hardware/sim_evaluator/places/places.warehouse.json'),
);
const PLACES = GRAPH.places;

interface MoveResult {
  success: boolean;
  message?: string;
  keepout?: string;
  targetLocation?: RobotLocation;
}
const move = moveToLocation as unknown as (input: {
  x?: number;
  y?: number;
  place?: string;
}) => Promise<MoveResult>;

let moves: RobotLocation[];
function stub(opts: { places?: readonly Place[]; frame?: FrameRegistration | null }): void {
  moves = [];
  setRobotStateManager({
    getState: () => ({ location: { x: 0, y: 0, floor: '1' } }),
    getPlaces: () => opts.places ?? [],
    getPlaceFrameRegistration: () => (opts.frame === undefined ? { registered: true, how: 'identity' } : opts.frame),
    moveTo: async (loc: RobotLocation) => {
      moves.push(loc);
      return { success: true, message: 'moving' };
    },
  } as unknown as RobotStateManager);
}

describe('resolvePlaceDestination', () => {
  it('matches the id case-insensitively', () => {
    expect(resolvePlaceDestination('charging-a', PLACES)?.id).toBe('CHARGING-A');
    expect(resolvePlaceDestination('CHARGING-A', PLACES)?.id).toBe('CHARGING-A');
  });

  it('matches the name when no id does', () => {
    expect(resolvePlaceDestination('aisle 2', PLACES)?.id).toBe('AISLE-2');
    expect(resolvePlaceDestination('Charging Bay A', PLACES)?.id).toBe('CHARGING-A');
  });

  it('matches the place type, taking the nearest', () => {
    expect(resolvePlaceDestination('charging station', PLACES)?.id).toBe('CHARGING-A');
    // Two `aisle` places: from x=9 the nearest is AISLE-3, from x=3 AISLE-1.
    expect(resolvePlaceDestination('aisle', PLACES, { x: 9, y: 0 })?.id).toBe('AISLE-3');
    expect(resolvePlaceDestination('aisle', PLACES, { x: 3, y: 0 })?.id).toBe('AISLE-1');
  });

  it('answers null for a name that is no place', () => {
    expect(resolvePlaceDestination('Warehouse A', PLACES)).toBeNull();
    expect(resolvePlaceDestination('  ', PLACES)).toBeNull();
  });

  it('targets the polygon centroid', () => {
    const charging = PLACES.find((p) => p.id === 'CHARGING-A')!;
    const t = placeTarget(charging);
    expect(t.x).toBeCloseTo(0);
    expect(t.y).toBeCloseTo(-3.75);
  });

  it('finds the keepout a point lies in', () => {
    expect(keepoutAt(4.5, 0, PLACES)?.id).toBe('RACK-A');
    expect(keepoutAt(3, 0, PLACES)).toBeNull();
  });
});

describe('moveToLocation', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('drives to the centroid of a place named by id', async () => {
    stub({ places: PLACES });
    const result = await move({ place: 'charging-a' });
    expect(result.success).toBe(true);
    expect(moves).toHaveLength(1);
    expect(moves[0]!.x).toBeCloseTo(0);
    expect(moves[0]!.y).toBeCloseTo(-3.75);
    expect(moves[0]!.place).toBe('CHARGING-A');
  });

  it('refuses a named keepout, naming it', async () => {
    stub({ places: PLACES });
    const result = await move({ place: 'RACK-A' });
    expect(result).toMatchObject({ success: false, keepout: 'RACK-A' });
    expect(result.message).toBe('Cannot navigate to "RACK-A" — it is a keepout.');
    expect(moves).toHaveLength(0);
  });

  it('refuses coordinates inside a keepout, naming it', async () => {
    stub({ places: PLACES });
    const result = await move({ x: 4.5, y: -1 });
    expect(result).toMatchObject({ success: false, keepout: 'RACK-A' });
    expect(result.message).toContain('RACK-A');
    expect(moves).toHaveLength(0);
  });

  it('drives to clear coordinates', async () => {
    stub({ places: PLACES });
    expect((await move({ x: 3, y: 0 })).success).toBe(true);
    expect(moves[0]).toMatchObject({ x: 3, y: 0 });
  });

  it('lists the known places for an unknown name', async () => {
    stub({ places: PLACES });
    const result = await move({ place: 'Warehouse A' });
    expect(result.success).toBe(false);
    expect(result.message).toContain('Unknown place "Warehouse A"');
    expect(result.message).toContain('CHARGING-A');
    expect(moves).toHaveLength(0);
  });

  it('fails a named move explicitly when the graph is unregistered, and still moves by coordinates', async () => {
    stub({ places: PLACES, frame: { registered: false, reason: 'twin on real odometry' } });
    const named = await move({ place: 'CHARGING-A' });
    expect(named.success).toBe(false);
    expect(named.message).toContain('no registered place graph');
    // Coordinates proceed: without a registered graph there is no keepout to
    // judge, and the geofence remains the safety layer.
    expect((await move({ x: 4.5, y: -1 })).success).toBe(true);
    expect(moves).toHaveLength(1);
  });

  it('fails a named move explicitly when there is no graph at all', async () => {
    stub({ places: [], frame: null });
    const result = await move({ place: 'charging-a' });
    expect(result.success).toBe(false);
    expect(result.message).toContain('no registered place graph');
  });

  it('knows home without a graph', async () => {
    stub({ places: [], frame: null });
    expect((await move({ place: 'Home' })).success).toBe(true);
    expect(moves[0]).toMatchObject({ x: 0, y: 0 });
    expect(await getHomeLocation()).toMatchObject({ x: 0, y: 0 });
  });
});

describe('charging station', () => {
  it('is the nearest charging place of the registered graph', async () => {
    stub({ places: PLACES });
    expect(await getChargingStationLocation()).toMatchObject({ place: 'CHARGING-A' });
  });

  it('is unknown without a registered graph — never invented', async () => {
    stub({ places: [], frame: null });
    expect(chargingStationLocation()).toBeNull();
    await expect(getChargingStationLocation()).rejects.toThrow('no registered place graph');
  });
});
