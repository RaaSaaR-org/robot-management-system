/**
 * @file TwinExportService.test.ts
 * @description Tests for the Nav2 keep-out mask + VDA5050 roadmap export
 *              (TASK-170 Phase 4). Exercises the pure builders (no storage I/O
 *              when the twin has no occupancy key — dimensions come from bounds).
 * @feature digitaltwin
 */

import { describe, it, expect, vi } from 'vitest';

// The pure builders read only the twin + zones passed in; storage is only
// touched when an occupancyPgmKey is present. Mock it to a no-op anyway.
vi.mock('../../repositories/index.js', () => ({
  digitalTwinRepository: { findById: vi.fn() },
  twinZoneRepository: { listByTwin: vi.fn() },
}));
vi.mock('../../storage/model-storage.js', () => ({
  modelStorage: { getTwinArtifactStream: vi.fn(), uploadTwinArtifact: vi.fn() },
}));

import { TwinExportService, polygonCentroid } from '../TwinExportService.js';
import { decodePgm } from '../../storage/pgm.js';
import type { DigitalTwinRecord, TwinZoneRecord } from '../../types/twin.types.js';

function makeTwin(overrides: Partial<DigitalTwinRecord> = {}): DigitalTwinRecord {
  return {
    id: 'twin-1', name: 'Lab Floor', robotId: null, floor: null, status: 'ready',
    version: 1, worldOriginX: 0, worldOriginY: 0, worldOriginZ: 0, resolution: 0.5,
    minX: 0, minY: 0, minZ: 0, maxX: 5, maxY: 5, maxZ: 2, pointCount: 0,
    storageBackend: 'local', cloudKey: null, meshKey: null, occupancyPgmKey: null,
    occupancyYamlKey: null, roadmapKey: null, simSceneKey: null, simSceneBackend: null,
    errorMessage: null, tenantId: null,
    createdAt: '2026-06-23T00:00:00.000Z', updatedAt: '2026-06-23T00:00:00.000Z',
    ...overrides,
  };
}

function makeZone(overrides: Partial<TwinZoneRecord> = {}): TwinZoneRecord {
  return {
    id: 'zone-1', twinId: 'twin-1', name: 'No-go', type: 'keepout',
    points: [{ x: 1, y: 1 }, { x: 3, y: 1 }, { x: 3, y: 3 }, { x: 1, y: 3 }],
    minZ: 0, maxZ: 2, color: null, metadata: null,
    createdAt: '2026-06-23T00:00:00.000Z', updatedAt: '2026-06-23T00:00:00.000Z',
    ...overrides,
  };
}

describe('TwinExportService.buildKeepoutMask', () => {
  const service = new (TwinExportService as unknown as { new (): TwinExportService })();

  it('produces a valid binary PGM sized from the twin bounds', async () => {
    const twin = makeTwin(); // 5x5 m @ 0.5 m/px → 10x10 px
    const { pgm, grid } = await service.buildKeepoutMask(twin, [makeZone()]);

    expect(grid.width).toBe(10);
    expect(grid.height).toBe(10);

    const decoded = decodePgm(pgm);
    expect(decoded.width).toBe(10);
    expect(decoded.height).toBe(10);

    // Keep-out square rasterized → some lethal pixels.
    const lethal = decoded.data.reduce((acc, v) => acc + (v === 254 ? 1 : 0), 0);
    expect(lethal).toBeGreaterThan(0);
  });

  it('also rasterizes speed zones into the mask, ignores workcell/charging', async () => {
    const twin = makeTwin();
    const speed = makeZone({ id: 'z2', type: 'speed' });
    const workcell = makeZone({ id: 'z3', type: 'workcell' });

    const withSpeed = await service.buildKeepoutMask(twin, [speed]);
    const withWorkcell = await service.buildKeepoutMask(twin, [workcell]);

    const speedLethal = withSpeed.grid.data.reduce((a, v) => a + (v === 254 ? 1 : 0), 0);
    const workcellLethal = withWorkcell.grid.data.reduce((a, v) => a + (v === 254 ? 1 : 0), 0);

    expect(speedLethal).toBeGreaterThan(0);
    expect(workcellLethal).toBe(0);
  });

  it('emits a costmap-filter YAML referencing the PGM with matching origin/resolution', async () => {
    // ROS map origin = the grid's bottom-left corner (bounds.min), so the mask
    // aligns with the occupancy grid — NOT the world frame origin.
    const twin = makeTwin({ minX: 2, minY: -3, maxX: 7, maxY: 2, resolution: 0.1 });
    const { yaml } = await service.buildKeepoutMask(twin, []);
    expect(yaml).toContain('image: nav2-keepout.pgm');
    expect(yaml).toContain('resolution: 0.1');
    expect(yaml).toContain('origin: [2, -3, 0.0]');
  });
});

describe('TwinExportService.buildRoadmap', () => {
  const service = new (TwinExportService as unknown as { new (): TwinExportService })();

  it('always yields at least the center node', () => {
    const roadmap = service.buildRoadmap(makeTwin(), []);
    expect(roadmap.version).toBe('2.0.0');
    expect(roadmap.nodes.length).toBeGreaterThanOrEqual(1);
    expect(roadmap.nodes[0].nodeId).toContain('center');
  });

  it('adds a node + edge per non-keepout zone and skips keepout zones', () => {
    const charging = makeZone({ id: 'c1', type: 'charging' });
    const keepout = makeZone({ id: 'k1', type: 'keepout' });
    const roadmap = service.buildRoadmap(makeTwin(), [charging, keepout]);

    // center + one charging node.
    expect(roadmap.nodes).toHaveLength(2);
    expect(roadmap.edges).toHaveLength(1);
    expect(roadmap.nodes[1].zoneType).toBe('charging');
    expect(roadmap.edges[0].startNodeId).toBe(roadmap.nodes[0].nodeId);
  });
});

describe('polygonCentroid', () => {
  it('computes the centroid of a unit square', () => {
    const c = polygonCentroid([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }]);
    expect(c).not.toBeNull();
    expect(c!.x).toBeCloseTo(1);
    expect(c!.y).toBeCloseTo(1);
  });

  it('returns null for an empty polygon', () => {
    expect(polygonCentroid([])).toBeNull();
  });
});
