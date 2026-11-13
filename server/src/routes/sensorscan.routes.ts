/**
 * @file sensorscan.routes.ts
 * @description REST routes for recorded point-cloud scans (list / download / delete)
 */

import { Router, type Request, type Response } from 'express';
import { sensorScanService } from '../services/SensorScanService.js';
import { sendStream } from '../utils/streamResponse.js';

export const sensorScanRoutes = Router();

/**
 * GET /api/sensor-scans?robotId=... — list recorded scans (newest first).
 */
sensorScanRoutes.get('/', async (req: Request, res: Response) => {
  try {
    const robotId = typeof req.query.robotId === 'string' ? req.query.robotId : undefined;
    const scans = await sensorScanService.listScans(robotId);
    res.json({ scans });
  } catch (error) {
    console.error('[SensorScan] list error:', error);
    res.status(500).json({ error: 'Failed to list scans' });
  }
});

/**
 * GET /api/sensor-scans/:id/download — stream the recorded PCD bytes.
 * Streamed through the server (rather than a presigned URL) so it honors auth
 * and works identically for the RustFS and local-filesystem backends.
 */
sensorScanRoutes.get('/:id/download', async (req: Request, res: Response) => {
  try {
    const record = await sensorScanService.getScan(req.params.id);
    if (!record) {
      return res.status(404).json({ error: 'Scan not found' });
    }
    // Through sendStream, so a client that drops the download gives the store
    // stream — and its socket — back (TASK-491).
    await sendStream(res, () => sensorScanService.openScanStream(record), {
      head: () => {
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${record.id}.pcd"`);
      },
      headerNames: ['Content-Type', 'Content-Disposition'],
      failure: { status: 502, body: { error: 'Failed to read scan bytes' } },
    });
  } catch (error) {
    console.error('[SensorScan] download error:', error);
    if (!res.headersSent) res.status(500).json({ error: 'Failed to download scan' });
  }
});

/**
 * DELETE /api/sensor-scans/:id — delete a recorded scan + its bytes.
 */
sensorScanRoutes.delete('/:id', async (req: Request, res: Response) => {
  try {
    const ok = await sensorScanService.deleteScan(req.params.id);
    if (!ok) {
      return res.status(404).json({ error: 'Scan not found' });
    }
    res.status(204).send();
  } catch (error) {
    console.error('[SensorScan] delete error:', error);
    res.status(500).json({ error: 'Failed to delete scan' });
  }
});
