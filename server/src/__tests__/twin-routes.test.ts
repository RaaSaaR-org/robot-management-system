/**
 * @file twin-routes.test.ts
 * @description Integration tests for DELETE /api/digital-twins/:id (TASK-301).
 *              There was no digital-twin route test at all before this file —
 *              the delete route shipped behind two UI buttons untested. The
 *              point of these cases is that a cascade failure is reported as a
 *              failure, instead of the old unconditional 204 over data that is
 *              still in the bucket.
 * @feature digitaltwin
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const { mockDigitalTwinService, mockTwinRepository } = vi.hoisted(() => ({
  mockDigitalTwinService: {
    deleteTwin: vi.fn(),
  },
  mockTwinRepository: {
    findById: vi.fn(),
    list: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('../services/DigitalTwinService.js', () => ({
  digitalTwinService: mockDigitalTwinService,
}));
vi.mock('../repositories/index.js', () => ({
  digitalTwinRepository: mockTwinRepository,
}));

// The rest of the twin router's service graph is irrelevant here; stub it so
// the module loads without a database or object store.
vi.mock('../services/ScanSessionService.js', () => ({ scanSessionService: {} }));
vi.mock('../services/TwinZoneService.js', () => ({ twinZoneService: {} }));
vi.mock('../services/TwinExportService.js', () => ({ twinExportService: {} }));
vi.mock('../services/TwinPlaceGraphService.js', () => ({ twinPlaceGraphService: {} }));
vi.mock('../services/SensorScanService.js', () => ({ sensorScanService: {} }));
vi.mock('../storage/model-storage.js', () => ({ modelStorage: {} }));

import { digitalTwinRoutes } from '../routes/twin.routes.js';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/digital-twins', digitalTwinRoutes);
  return app;
}

describe('digital-twin routes — DELETE /api/digital-twins/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs the erasure cascade and returns 204', async () => {
    mockDigitalTwinService.deleteTwin.mockResolvedValue(true);

    const res = await request(createApp()).delete('/api/digital-twins/twin-1');

    expect(res.status).toBe(204);
    expect(mockDigitalTwinService.deleteTwin).toHaveBeenCalledWith('twin-1');
    // The bare repository delete must NOT be the route's path any more: it
    // removes the row and leaves the scans, blobs and sim scene behind.
    expect(mockTwinRepository.delete).not.toHaveBeenCalled();
  });

  it('returns 404 for a twin that does not exist', async () => {
    mockDigitalTwinService.deleteTwin.mockResolvedValue(false);

    const res = await request(createApp()).delete('/api/digital-twins/nope');

    expect(res.status).toBe(404);
  });

  it('reports a half-finished cascade as a failure, not a success', async () => {
    mockDigitalTwinService.deleteTwin.mockRejectedValue(new Error('bucket unreachable'));

    const res = await request(createApp()).delete('/api/digital-twins/twin-1');

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/Failed to delete/i);
  });
});
