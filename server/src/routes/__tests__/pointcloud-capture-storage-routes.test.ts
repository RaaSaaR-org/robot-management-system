/**
 * @file pointcloud-capture-storage-routes.test.ts
 * @description POST /api/robots/:id/pointcloud/capture says why storage refused
 *   a scan: 503 STORAGE_UNAVAILABLE with the RustFS state and errorKind while
 *   RustFS is configured but down, instead of a bare 500 (TASK-381)
 * @feature robots
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { StorageUnavailableError } from '../../storage/availability.js';
import { HttpClientError } from '../../services/HttpClient.js';

const scans = vi.hoisted(() => ({ captureScan: vi.fn() }));

vi.mock('../../services/SensorScanService.js', () => ({
  sensorScanService: { captureScan: scans.captureScan },
}));

vi.mock('../../services/RobotManager.js', () => ({ robotManager: {} }));

import { robotRoutes } from '../robot.routes.js';

function createApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/api/robots', robotRoutes);
  return app;
}

describe('POST /api/robots/:id/pointcloud/capture', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    app = createApp();
  });

  it('answers 503 naming the RustFS state and errorKind while storage is down', async () => {
    scans.captureScan.mockRejectedValue(
      new StorageUnavailableError({ state: 'unavailable', errorKind: 'connectivity' }),
    );

    const response = await request(app).post('/api/robots/robot-001/pointcloud/capture').send({});

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({
      code: 'STORAGE_UNAVAILABLE',
      state: 'unavailable',
      errorKind: 'connectivity',
    });
    expect(response.body.error).toContain('(connectivity)');
  });

  it('still answers 201 with the stored scan', async () => {
    scans.captureScan.mockResolvedValue({ id: 'scan-1' });

    const response = await request(app).post('/api/robots/robot-001/pointcloud/capture').send({ sensor: 'mid360' });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ id: 'scan-1' });
    expect(scans.captureScan).toHaveBeenCalledWith('robot-001', 'mid360');
  });

  it('keeps 404 for an unknown robot and 502 for an unreachable agent', async () => {
    scans.captureScan.mockRejectedValueOnce(new Error('Robot ghost not found'));
    const missing = await request(app).post('/api/robots/ghost/pointcloud/capture').send({});
    expect(missing.status).toBe(404);

    scans.captureScan.mockRejectedValueOnce(new HttpClientError('Connection refused: http://robot:41243'));
    const unreachable = await request(app).post('/api/robots/robot-001/pointcloud/capture').send({});
    expect(unreachable.status).toBe(502);
  });

  it('keeps the bare 500 for an unmapped failure, without echoing it', async () => {
    scans.captureScan.mockRejectedValue(new Error('disk exploded at /secret/path'));

    const response = await request(app).post('/api/robots/robot-001/pointcloud/capture').send({});

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Failed to capture scan' });
  });
});
