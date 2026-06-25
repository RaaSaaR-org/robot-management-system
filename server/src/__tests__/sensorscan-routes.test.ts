/**
 * @file sensorscan-routes.test.ts
 * @description Integration tests for recorded point-cloud scan routes
 * @feature robots
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { Readable } from 'stream';

const { mockSensorScanService } = vi.hoisted(() => ({
  mockSensorScanService: {
    listScans: vi.fn(),
    getScan: vi.fn(),
    openScanStream: vi.fn(),
    deleteScan: vi.fn(),
  },
}));

vi.mock('../services/SensorScanService.js', () => ({
  sensorScanService: mockSensorScanService,
}));

import { sensorScanRoutes } from '../routes/sensorscan.routes.js';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sensor-scans', sensorScanRoutes);
  return app;
}

const SAMPLE_SUMMARY = {
  id: 'scan-001',
  robotId: 'robot-001',
  sensorName: 'mid360_lidar',
  sensorType: 'lidar',
  format: 'pcd',
  pointCount: 7000,
  fileSize: 112000,
  hasIntensity: true,
  bounds: [-4, -4, 0, 4, 4, 2.5],
  downloadUrl: '/api/sensor-scans/scan-001/download',
  capturedAt: '2026-06-23T00:00:00.000Z',
};

describe('sensor-scan routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET /api/sensor-scans lists scans for a robot', async () => {
    mockSensorScanService.listScans.mockResolvedValue([SAMPLE_SUMMARY]);
    const res = await request(createApp()).get('/api/sensor-scans?robotId=robot-001');

    expect(res.status).toBe(200);
    expect(res.body.scans).toHaveLength(1);
    expect(res.body.scans[0].id).toBe('scan-001');
    expect(mockSensorScanService.listScans).toHaveBeenCalledWith('robot-001');
  });

  it('GET /api/sensor-scans/:id/download streams the PCD bytes', async () => {
    mockSensorScanService.getScan.mockResolvedValue({ id: 'scan-001', storageBackend: 'local' });
    mockSensorScanService.openScanStream.mockResolvedValue(Readable.from([Buffer.from('PCDDATA')]));

    const res = await request(createApp()).get('/api/sensor-scans/scan-001/download');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/octet-stream');
    expect(res.body.toString()).toContain('PCDDATA');
  });

  it('GET /api/sensor-scans/:id/download 404s when the scan is missing', async () => {
    mockSensorScanService.getScan.mockResolvedValue(null);
    const res = await request(createApp()).get('/api/sensor-scans/nope/download');
    expect(res.status).toBe(404);
  });

  it('DELETE /api/sensor-scans/:id returns 204 on success', async () => {
    mockSensorScanService.deleteScan.mockResolvedValue(true);
    const res = await request(createApp()).delete('/api/sensor-scans/scan-001');
    expect(res.status).toBe(204);
    expect(mockSensorScanService.deleteScan).toHaveBeenCalledWith('scan-001');
  });

  it('DELETE /api/sensor-scans/:id returns 404 when missing', async () => {
    mockSensorScanService.deleteScan.mockResolvedValue(false);
    const res = await request(createApp()).delete('/api/sensor-scans/nope');
    expect(res.status).toBe(404);
  });
});
