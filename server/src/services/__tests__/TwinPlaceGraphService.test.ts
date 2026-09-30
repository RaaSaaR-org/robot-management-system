/**
 * @file TwinPlaceGraphService.test.ts
 * @description TwinZone rows → the robot's `places/_index.json` (TASK-200).
 * @feature digitaltwin
 *
 * The shape is a CONTRACT with `robot-agent/src/agent-mode/place-resolver.ts`:
 * the robot parses this payload with the same strict validator it uses for a
 * hand-authored file, and rejects the whole graph on one bad entry. So the
 * assertions here are about what the robot's parser demands — twinId, units,
 * yaw convention, unique ids, ≥3 vertices — not about what is convenient here.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../repositories/index.js', () => ({
  digitalTwinRepository: { findById: vi.fn() },
  twinZoneRepository: { listByTwin: vi.fn(), findById: vi.fn() },
}));

import {
  TwinPlaceGraphService,
  assignPlaceIds,
  slugifyPlaceId,
  PLACE_ID_MAX_LENGTH,
  ROBOT_SAFE_PLACE_ID,
} from '../TwinPlaceGraphService.js';
import { twinZoneRepository } from '../../repositories/index.js';
import type { DigitalTwinRecord, TwinZoneRecord } from '../../types/twin.types.js';

function makeTwin(overrides: Partial<DigitalTwinRecord> = {}): DigitalTwinRecord {
  return {
    id: 'twin-1', name: 'Hall 2', robotId: null, floor: null, status: 'ready',
    version: 1, worldOriginX: 0, worldOriginY: 0, worldOriginZ: 0, resolution: 0.05,
    minX: -10, minY: -10, minZ: 0, maxX: 10, maxY: 10, maxZ: 3, pointCount: 0,
    storageBackend: 'local', cloudKey: null, meshKey: null, occupancyPgmKey: null,
    occupancyYamlKey: null, roadmapKey: null, simSceneKey: null, simSceneBackend: null,
    errorMessage: null, tenantId: null,
    createdAt: '2026-08-02T00:00:00.000Z', updatedAt: '2026-08-02T00:00:00.000Z',
    ...overrides,
  };
}

function makeZone(overrides: Partial<TwinZoneRecord> = {}): TwinZoneRecord {
  return {
    id: 'zone-1', twinId: 'twin-1', name: 'Aisle 3', type: 'room',
    points: [{ x: 8, y: -4 }, { x: 10, y: -4 }, { x: 10, y: 2 }, { x: 8, y: 2 }],
    minZ: 0, maxZ: 2, color: null, metadata: { placeType: 'aisle' },
    createdAt: '2026-08-02T00:00:00.000Z', updatedAt: '2026-08-02T00:00:00.000Z',
    ...overrides,
  };
}

const service = new (TwinPlaceGraphService as unknown as { new (): TwinPlaceGraphService })();

describe('slugifyPlaceId', () => {
  it('turns an operator-typed name into a spoken place id', () => {
    expect(slugifyPlaceId('Aisle 3')).toBe('AISLE-3');
    expect(slugifyPlaceId('  charging bay a ')).toBe('CHARGING-BAY-A');
    expect(slugifyPlaceId('!!!')).toBe('PLACE');
  });

  it('caps at the place-id grammar the robot enforces, not at an unusable id', () => {
    // A 68-character zone name used to yield a 68-character id: accepted by the
    // resolver, printed by the planner, but `Workspace.placeNoteFile()` returns
    // null for it, so every `remember` there fails with "not a usable place id"
    // — invisible until an operator tries to leave a note.
    const long = 'Storage room on the second floor behind the packaging line north';
    const id = slugifyPlaceId(`${long} extension`);
    expect(id.length).toBeLessThanOrEqual(PLACE_ID_MAX_LENGTH);
    expect(id).toMatch(ROBOT_SAFE_PLACE_ID);
  });

  it('never leaves a dangling separator when it truncates', () => {
    // Cutting mid-word must not produce `...LINE-`, which is legal but reads as
    // a broken id and collides with the duplicate-disambiguation suffix.
    const id = slugifyPlaceId('a'.repeat(63) + ' tail');
    expect(id.endsWith('-')).toBe(false);
    expect(id).toMatch(ROBOT_SAFE_PLACE_ID);
  });
});

describe('TwinPlaceGraphService.buildPlaceGraph', () => {
  it('declares the frame the robot asserts against', () => {
    const graph = service.buildPlaceGraph(makeTwin(), []);
    expect(graph.version).toBe(1);
    expect(graph.frame).toEqual({
      id: 'twin-twin-1',
      kind: 'site',
      units: 'm',
      yawConvention: 'deg,+x=0,CCW+',
      // Load-bearing: twins are not mutually registered, so a graph without
      // this cannot be checked against the robot's configured twin at all.
      twinId: 'twin-1',
    });
  });

  it('turns a room into a navigable place', () => {
    const graph = service.buildPlaceGraph(makeTwin(), [makeZone()]);
    expect(graph.places).toEqual([
      {
        id: 'AISLE-3',
        name: 'Aisle 3',
        placeType: 'aisle',
        floor: 0,
        polygon: [[8, -4], [10, -4], [10, 2], [8, 2]],
        source: 'surveyed',
        keepout: false,
        landmarks: [],
      },
    ]);
  });

  it('turns a keepout into a place the robot must not stand in', () => {
    const graph = service.buildPlaceGraph(makeTwin(), [
      makeZone({ id: 'z2', name: 'Rack A', type: 'keepout', metadata: { placeType: 'rack_face' } }),
    ]);
    expect(graph.places[0]).toMatchObject({ id: 'RACK-A', keepout: true, placeType: 'rack_face' });
  });

  it('emits room, workcell, charging and keepout as places, and leaves speed OUT (TASK-326)', () => {
    // Since TASK-274 the twin is the only zone model, so every navigable zone
    // is a place. Speed zones annotate floor that belongs to another place.
    const graph = service.buildPlaceGraph(makeTwin(), [
      makeZone({ id: 'a', name: 'room-1', type: 'room', metadata: null }),
      makeZone({ id: 'b', name: 'cell-1', type: 'workcell', metadata: null }),
      makeZone({ id: 'c', name: 'dock-1', type: 'charging', metadata: null }),
      makeZone({ id: 'd', name: 'rack-1', type: 'keepout', metadata: null }),
      makeZone({ id: 'e', name: 'slow-1', type: 'speed', metadata: null }),
    ]);
    expect(graph.places.map((p) => [p.id, p.keepout, p.placeType])).toEqual([
      ['ROOM-1', false, 'unknown'],
      ['CELL-1', false, 'cell'],
      ['DOCK-1', false, 'charging'],
      ['RACK-1', true, 'unknown'],
    ]);
  });

  it('lets metadata.placeType override the type implied by the zone type', () => {
    const graph = service.buildPlaceGraph(makeTwin(), [
      makeZone({ type: 'charging', metadata: { placeType: 'dock' } }),
    ]);
    expect(graph.places[0].placeType).toBe('dock');
  });

  it('falls back to placeType "unknown" rather than guessing', () => {
    const graph = service.buildPlaceGraph(makeTwin(), [
      makeZone({ metadata: null }),
      makeZone({ id: 'z2', name: 'Bay', metadata: { placeType: 'not-a-place-type' } }),
    ]);
    expect(graph.places.map((p) => p.placeType)).toEqual(['unknown', 'unknown']);
  });

  it('honours an explicit placeId override', () => {
    const graph = service.buildPlaceGraph(makeTwin(), [
      makeZone({ name: 'Third aisle on the left', metadata: { placeId: 'AISLE-3' } }),
    ]);
    expect(graph.places[0]?.id).toBe('AISLE-3');
    expect(graph.places[0]?.name).toBe('Third aisle on the left');
  });

  it('disambiguates duplicate names — a duplicate id would be rejected wholesale', () => {
    const graph = service.buildPlaceGraph(makeTwin(), [
      makeZone({ id: 'z1' }),
      makeZone({ id: 'z2' }),
      makeZone({ id: 'z3' }),
    ]);
    expect(graph.places.map((p) => p.id)).toEqual(['AISLE-3', 'AISLE-3-2', 'AISLE-3-3']);
  });

  it('emits only ids the robot can write a place note for', () => {
    // Every id in a generated graph must satisfy the robot's SAFE_PLACE_ID —
    // including the disambiguated ones, whose suffix must not push a long name
    // past the length limit.
    const long = 'Storage room on the second floor behind the packaging line north';
    const graph = service.buildPlaceGraph(makeTwin(), [
      makeZone({ id: 'z1', name: long }),
      makeZone({ id: 'z2', name: long }),
      makeZone({ id: 'z3', name: `${long} annex` }),
    ]);

    expect(graph.places).toHaveLength(3);
    for (const place of graph.places) {
      expect(place.id).toMatch(ROBOT_SAFE_PLACE_ID);
    }
    expect(new Set(graph.places.map((p) => p.id)).size).toBe(3);
  });

  it('drops a half-drawn polygon instead of emitting a degenerate place', () => {
    // The robot's parser rejects a whole graph on one bad polygon, so one
    // leftover two-vertex draft in the UI would take the site's place awareness
    // offline entirely.
    const graph = service.buildPlaceGraph(makeTwin(), [
      makeZone({ id: 'z1', name: 'Draft', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }] }),
      makeZone({ id: 'z2' }),
    ]);
    expect(graph.places.map((p) => p.id)).toEqual(['AISLE-3']);
  });

  it('reads the floor from metadata as an integer in the TWIN frame', () => {
    const graph = service.buildPlaceGraph(makeTwin(), [
      makeZone({ metadata: { placeType: 'aisle', floor: 1 } }),
      // The fleet's storey is a STRING ('1'); a non-numeric value must not
      // silently move a place to a floor the robot will never be on.
      makeZone({ id: 'z2', name: 'Lobby', metadata: { floor: 'ground' } }),
    ]);
    expect(graph.places.map((p) => p.floor)).toEqual([1, 0]);
  });
});

describe('assignPlaceIds / resolveZonePlaces (TASK-330)', () => {
  const kitchen = makeZone({ id: 'z-k', name: 'Kitchen', metadata: null });
  const override = makeZone({ id: 'z-o', name: 'Store', metadata: { placeId: 'dock-1' } });
  const speed = makeZone({ id: 'z-s', name: 'Slow', type: 'speed', metadata: null });

  it('gives each place zone the id the place graph emits, and skips non-places', () => {
    const zones = [kitchen, override, speed];
    const ids = assignPlaceIds(zones);
    expect(Object.fromEntries(ids)).toEqual({ 'z-k': 'KITCHEN', 'z-o': 'DOCK-1' });
    const graph = service.buildPlaceGraph(makeTwin(), zones);
    expect(graph.places.map((p) => p.id)).toEqual(['KITCHEN', 'DOCK-1']);
  });

  it('resolves ids to twin + place, omitting unknown ids and nulling non-places', async () => {
    const byId = new Map([kitchen, speed].map((z) => [z.id, z]));
    vi.mocked(twinZoneRepository.findById).mockImplementation(async (id) => byId.get(id) ?? null);
    vi.mocked(twinZoneRepository.listByTwin).mockResolvedValue([kitchen, override, speed]);

    await expect(service.resolveZonePlaces(['z-k', 'missing', 'z-s', 'z-k'])).resolves.toEqual([
      { zoneId: 'z-k', name: 'Kitchen', twinId: 'twin-1', placeId: 'KITCHEN' },
      { zoneId: 'z-s', name: 'Slow', twinId: 'twin-1', placeId: null },
    ]);
    // siblings are loaded once per twin, not once per zone
    expect(twinZoneRepository.listByTwin).toHaveBeenCalledTimes(1);
  });
});
