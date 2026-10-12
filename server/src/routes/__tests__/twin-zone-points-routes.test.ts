/**
 * @file twin-zone-points-routes.test.ts
 * @description Twin zone writes refuse points that are not a polygon of at
 *   least 3 finite {x, y} vertices, so no keep-out exists in the UI but not in
 *   the Nav2 mask (TASK-386).
 * @feature digitaltwin
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const { mockZones } = vi.hoisted(() => ({
  mockZones: { twinExists: vi.fn(), createZone: vi.fn(), updateZone: vi.fn() },
}));

vi.mock('../../services/TwinZoneService.js', () => ({ twinZoneService: mockZones }));
vi.mock('../../services/DigitalTwinService.js', () => ({ digitalTwinService: {} }));
vi.mock('../../services/ScanSessionService.js', () => ({ scanSessionService: {} }));
vi.mock('../../services/TwinExportService.js', () => ({ twinExportService: {} }));
vi.mock('../../services/TwinPlaceGraphService.js', () => ({ twinPlaceGraphService: {} }));
vi.mock('../../services/RobotManager.js', () => ({ robotManager: {} }));
vi.mock('../../services/SensorScanService.js', () => ({ sensorScanService: {} }));
vi.mock('../../repositories/index.js', () => ({ digitalTwinRepository: {} }));
vi.mock('../../storage/model-storage.js', () => ({ modelStorage: {} }));

import { digitalTwinRoutes } from '../twin.routes.js';
import { isZonePolygon } from '../../types/twin.types.js';

function app() {
  const a = express();
  a.use(express.json());
  a.use('/digital-twins', digitalTwinRoutes);
  return a;
}

const square = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
];

const badPoints: Array<[string, unknown]> = [
  ['strings', ['a', 'b', 'c']],
  ['two vertices', square.slice(0, 2)],
  ['a non-numeric x', [{ x: 'NaN', y: null }, ...square]],
  ['a NaN-like string y', [{ x: 0, y: '1' }, ...square]],
  ['an object', { x: 0, y: 0 }],
];

beforeEach(() => {
  vi.clearAllMocks();
  mockZones.twinExists.mockResolvedValue(true);
  mockZones.createZone.mockResolvedValue({ id: 'z1' });
  mockZones.updateZone.mockResolvedValue({ id: 'z1' });
});

describe('isZonePolygon', () => {
  it('accepts 3 finite vertices and refuses Infinity', () => {
    expect(isZonePolygon(square)).toBe(true);
    expect(isZonePolygon([...square, { x: Infinity, y: 0 }])).toBe(false);
  });
});

describe('POST /digital-twins/:id/zones', () => {
  it.each(badPoints)('refuses points with %s', async (_label, points) => {
    const res = await request(app())
      .post('/digital-twins/t1/zones')
      .send({ name: 'z', type: 'keepout', points });
    expect(res.status).toBe(400);
    expect(mockZones.createZone).not.toHaveBeenCalled();
  });

  it('creates a zone with a valid polygon', async () => {
    const res = await request(app())
      .post('/digital-twins/t1/zones')
      .send({ name: 'z', type: 'keepout', points: square });
    expect(res.status).toBe(201);
  });
});

describe('PUT /digital-twins/:id/zones/:zoneId', () => {
  it.each(badPoints)('refuses points with %s', async (_label, points) => {
    const res = await request(app()).put('/digital-twins/t1/zones/z1').send({ points });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('at least 3');
    expect(mockZones.updateZone).not.toHaveBeenCalled();
  });

  it('updates without points, leaving them unchanged', async () => {
    const res = await request(app()).put('/digital-twins/t1/zones/z1').send({ name: 'renamed' });
    expect(res.status).toBe(200);
    expect(mockZones.updateZone).toHaveBeenCalledWith(
      't1',
      'z1',
      expect.objectContaining({ points: undefined })
    );
  });
});
