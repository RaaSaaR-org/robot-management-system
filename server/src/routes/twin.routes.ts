/**
 * @file twin.routes.ts
 * @description REST routes for the Digital Twin feature (TASK-170):
 *              - twinWorkerRoutes: sidecar build-worker endpoints (mounted at
 *                /api/twin/workers behind workerAuthMiddleware).
 *              - digitalTwinRoutes: twin CRUD + artifact streams + zones +
 *                export (mounted at /api/digital-twins behind authMiddleware).
 * @feature digitaltwin
 */

import { Router, raw, type Request, type Response } from 'express';
import { digitalTwinService } from '../services/DigitalTwinService.js';
import { scanSessionService } from '../services/ScanSessionService.js';
import { PointCloudParseError } from '../storage/pointcloud-parse.js';
import { twinZoneService } from '../services/TwinZoneService.js';
import { twinExportService } from '../services/TwinExportService.js';
import { sensorScanService } from '../services/SensorScanService.js';
import { digitalTwinRepository } from '../repositories/index.js';
import { modelStorage } from '../storage/model-storage.js';
import { twinToDTO } from '../services/twinDto.js';
import type {
  TwinWorkerProgressRequest,
  TwinWorkerHeartbeatRequest,
  TwinWorkerCompleteRequest,
  TwinWorkerFailedRequest,
  TwinZoneType,
  TwinZonePoint,
} from '../types/twin.types.js';

// ============================================================================
// SIDECAR WORKER ROUTES — /api/twin/workers (workerAuthMiddleware)
// ============================================================================

export const twinWorkerRoutes = Router();

/** POST /api/twin/workers/claim — claim the next pending build job (204 if none). */
twinWorkerRoutes.post('/claim', async (req: Request, res: Response) => {
  try {
    const { workerId } = req.body as { workerId?: string };
    if (!workerId) {
      return res.status(400).json({ error: 'workerId is required' });
    }
    const job = await digitalTwinService.claimNextPendingJob(workerId);
    if (!job) return res.status(204).send();
    res.json(job);
  } catch (error) {
    console.error('[TwinWorker] claim error:', error);
    res.status(500).json({ error: 'Failed to claim build job' });
  }
});

/** POST /api/twin/workers/progress — report build progress. */
twinWorkerRoutes.post('/progress', async (req: Request, res: Response) => {
  try {
    const body = req.body as TwinWorkerProgressRequest;
    if (!body.sessionId || !body.workerId) {
      return res.status(400).json({ error: 'sessionId and workerId are required' });
    }
    const result = await digitalTwinService.updateProgress({
      sessionId: body.sessionId,
      workerId: body.workerId,
      progress: typeof body.progress === 'number' ? body.progress : 0,
      stage: body.stage,
    });
    res.json(result);
  } catch (error) {
    console.error('[TwinWorker] progress error:', error);
    res.status(500).json({ error: 'Failed to update progress' });
  }
});

/** POST /api/twin/workers/heartbeat — worker liveness check. */
twinWorkerRoutes.post('/heartbeat', async (req: Request, res: Response) => {
  try {
    const body = req.body as TwinWorkerHeartbeatRequest;
    if (!body.sessionId || !body.workerId) {
      return res.status(400).json({ error: 'sessionId and workerId are required' });
    }
    const result = await digitalTwinService.recordHeartbeat({
      sessionId: body.sessionId,
      workerId: body.workerId,
    });
    res.json(result);
  } catch (error) {
    console.error('[TwinWorker] heartbeat error:', error);
    res.status(500).json({ error: 'Failed to process heartbeat' });
  }
});

/** POST /api/twin/workers/complete — persist artifacts, mark twin ready. */
twinWorkerRoutes.post('/complete', async (req: Request, res: Response) => {
  try {
    const body = req.body as TwinWorkerCompleteRequest;
    if (!body.sessionId || !body.workerId) {
      return res.status(400).json({ error: 'sessionId and workerId are required' });
    }
    if (!Array.isArray(body.bounds) || body.bounds.length !== 6) {
      return res.status(400).json({ error: 'bounds must be 6 floats' });
    }
    const result = await digitalTwinService.completeJob({
      sessionId: body.sessionId,
      workerId: body.workerId,
      pointCount: typeof body.pointCount === 'number' ? body.pointCount : 0,
      bounds: body.bounds,
      artifacts: body.artifacts ?? {},
      storageBackend: body.storageBackend === 'rustfs' ? 'rustfs' : 'local',
    });
    if (!result.ok) return res.status(404).json({ error: 'Session not found' });
    res.json(result);
  } catch (error) {
    console.error('[TwinWorker] complete error:', error);
    res.status(500).json({ error: 'Failed to complete build job' });
  }
});

/** POST /api/twin/workers/failed — mark session + twin failed. */
twinWorkerRoutes.post('/failed', async (req: Request, res: Response) => {
  try {
    const body = req.body as TwinWorkerFailedRequest;
    if (!body.sessionId || !body.workerId) {
      return res.status(400).json({ error: 'sessionId and workerId are required' });
    }
    const result = await digitalTwinService.failJob({
      sessionId: body.sessionId,
      workerId: body.workerId,
      error: typeof body.error === 'string' ? body.error : 'unknown error',
    });
    if (!result.ok) return res.status(404).json({ error: 'Session not found' });
    res.json(result);
  } catch (error) {
    console.error('[TwinWorker] failed error:', error);
    res.status(500).json({ error: 'Failed to record build failure' });
  }
});

/**
 * GET /api/twin/workers/inputs/:scanId/download — stream a SensorScan's PCD
 * bytes to the sidecar. On rustfs the bytes are streamed through the server
 * (uniform auth + works for both backends, mirroring sensor-scan download).
 */
twinWorkerRoutes.get('/inputs/:scanId/download', async (req: Request, res: Response) => {
  try {
    const record = await sensorScanService.getScan(req.params.scanId);
    if (!record) return res.status(404).json({ error: 'Scan not found' });
    const stream = await sensorScanService.openScanStream(record);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${record.id}.pcd"`);
    stream.on('error', () => {
      if (!res.headersSent) res.status(502).json({ error: 'Failed to read scan bytes' });
      else res.end();
    });
    stream.pipe(res);
  } catch (error) {
    console.error('[TwinWorker] input download error:', error);
    if (!res.headersSent) res.status(500).json({ error: 'Failed to download scan input' });
  }
});

const ALLOWED_ARTIFACT_NAMES = new Set([
  'cloud.pcd',
  'mesh.glb',
  'occupancy.pgm',
  'occupancy.yaml',
  'roadmap.json',
  // Real→sim MJCF scene (TASK-171) — produced when the sidecar runs with
  // ENABLE_SIM_SCENE=true; without this entry the local-backend handoff 400s.
  'scene.mjcf.xml',
]);

/**
 * PUT /api/twin/workers/artifacts/:twinId/:name — upload a built artifact's
 * bytes (local backend handoff). Returns the storage key.
 */
twinWorkerRoutes.put('/artifacts/:twinId/:name', async (req: Request, res: Response) => {
  try {
    const { twinId, name } = req.params;
    if (!ALLOWED_ARTIFACT_NAMES.has(name)) {
      return res.status(400).json({ error: `Unsupported artifact name: ${name}` });
    }
    const twin = await digitalTwinRepository.findById(twinId);
    if (!twin) return res.status(404).json({ error: 'Twin not found' });

    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', async () => {
      try {
        const data = Buffer.concat(chunks);
        const key = await modelStorage.uploadTwinArtifact(twinId, name, data);
        res.json({ key });
      } catch (err) {
        console.error('[TwinWorker] artifact upload error:', err);
        if (!res.headersSent) res.status(500).json({ error: 'Failed to store artifact' });
      }
    });
    req.on('error', () => {
      if (!res.headersSent) res.status(400).json({ error: 'Upload stream error' });
    });
  } catch (error) {
    console.error('[TwinWorker] artifact error:', error);
    if (!res.headersSent) res.status(500).json({ error: 'Failed to store artifact' });
  }
});

// ============================================================================
// DIGITAL TWIN CRUD + ARTIFACTS + ZONES + EXPORT — /api/digital-twins
// ============================================================================

export const digitalTwinRoutes = Router();

/** GET /api/digital-twins — list all twins. */
digitalTwinRoutes.get('/', async (_req: Request, res: Response) => {
  try {
    const twins = await digitalTwinRepository.list();
    res.json(twins.map(twinToDTO));
  } catch (error) {
    console.error('[DigitalTwin] list error:', error);
    res.status(500).json({ error: 'Failed to list digital twins' });
  }
});

/** POST /api/digital-twins — create a twin. */
digitalTwinRoutes.post('/', async (req: Request, res: Response) => {
  try {
    const name = typeof req.body?.name === 'string' ? req.body.name : undefined;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const twin = await digitalTwinRepository.create({
      name,
      robotId: typeof req.body?.robotId === 'string' ? req.body.robotId : null,
      floor: typeof req.body?.floor === 'string' ? req.body.floor : null,
    });
    res.status(201).json(twinToDTO(twin));
  } catch (error) {
    console.error('[DigitalTwin] create error:', error);
    res.status(500).json({ error: 'Failed to create digital twin' });
  }
});

/** GET /api/digital-twins/:id — fetch one twin. */
digitalTwinRoutes.get('/:id', async (req: Request, res: Response) => {
  try {
    const twin = await digitalTwinRepository.findById(req.params.id);
    if (!twin) return res.status(404).json({ error: 'Digital twin not found' });
    res.json(twinToDTO(twin));
  } catch (error) {
    console.error('[DigitalTwin] get error:', error);
    res.status(500).json({ error: 'Failed to get digital twin' });
  }
});

/** DELETE /api/digital-twins/:id — delete a twin (cascades zones + sessions). */
digitalTwinRoutes.delete('/:id', async (req: Request, res: Response) => {
  try {
    const ok = await digitalTwinRepository.delete(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Digital twin not found' });
    res.status(204).send();
  } catch (error) {
    console.error('[DigitalTwin] delete error:', error);
    res.status(500).json({ error: 'Failed to delete digital twin' });
  }
});

/**
 * POST /api/digital-twins/:id/import?filename=…&robotId=…&normalize=…
 * Import a recorded point-cloud file (PLY or PCD, raw request body) as a
 * one-frame scan session queued for the twin-builder sidecar. Responds 201
 * with the created ScanSession DTO; the twin flips to 'processing' and the
 * normal session:progress / twin:ready events drive the UI from there.
 */
digitalTwinRoutes.post(
  '/:id/import',
  raw({ type: () => true, limit: '256mb' }),
  async (req: Request, res: Response) => {
    try {
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        return res.status(400).json({ error: 'Request body must be the raw point-cloud file bytes' });
      }
      const filename =
        typeof req.query.filename === 'string' && req.query.filename ? req.query.filename : 'cloud.ply';
      const robotId = typeof req.query.robotId === 'string' && req.query.robotId ? req.query.robotId : undefined;
      const session = await scanSessionService.importScan({
        twinId: req.params.id,
        buffer: req.body,
        filename,
        robotId,
        normalizeFloor: req.query.normalize !== 'false',
      });
      res.status(201).json(session);
    } catch (error) {
      if (error instanceof PointCloudParseError) {
        return res.status(400).json({ error: error.message });
      }
      if (error instanceof Error && error.message.includes('not found')) {
        return res.status(404).json({ error: error.message });
      }
      console.error('[DigitalTwin] import error:', error);
      res.status(500).json({ error: 'Failed to import point cloud' });
    }
  },
);

// ----------------------------------------------------------------------------
// Built-artifact streaming
// ----------------------------------------------------------------------------

/** Stream a stored twin artifact key with the given content type, or 404. */
async function streamArtifact(
  res: Response,
  key: string | null | undefined,
  contentType: string,
  filename: string,
): Promise<void> {
  if (!key) {
    res.status(404).json({ error: 'Artifact not available' });
    return;
  }
  const stream = await modelStorage.getTwinArtifactStream(key);
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  stream.on('error', () => {
    if (!res.headersSent) res.status(502).json({ error: 'Failed to read artifact bytes' });
    else res.end();
  });
  stream.pipe(res);
}

digitalTwinRoutes.get('/:id/cloud', async (req: Request, res: Response) => {
  try {
    const twin = await digitalTwinRepository.findById(req.params.id);
    if (!twin) return res.status(404).json({ error: 'Digital twin not found' });
    await streamArtifact(res, twin.cloudKey, 'application/octet-stream', `${twin.id}-cloud.pcd`);
  } catch (error) {
    console.error('[DigitalTwin] cloud error:', error);
    if (!res.headersSent) res.status(500).json({ error: 'Failed to stream cloud' });
  }
});

digitalTwinRoutes.get('/:id/mesh', async (req: Request, res: Response) => {
  try {
    const twin = await digitalTwinRepository.findById(req.params.id);
    if (!twin) return res.status(404).json({ error: 'Digital twin not found' });
    await streamArtifact(res, twin.meshKey, 'model/gltf-binary', `${twin.id}-mesh.glb`);
  } catch (error) {
    console.error('[DigitalTwin] mesh error:', error);
    if (!res.headersSent) res.status(500).json({ error: 'Failed to stream mesh' });
  }
});

digitalTwinRoutes.get('/:id/occupancy.pgm', async (req: Request, res: Response) => {
  try {
    const twin = await digitalTwinRepository.findById(req.params.id);
    if (!twin) return res.status(404).json({ error: 'Digital twin not found' });
    await streamArtifact(res, twin.occupancyPgmKey, 'image/x-portable-graymap', `${twin.id}-occupancy.pgm`);
  } catch (error) {
    console.error('[DigitalTwin] occupancy.pgm error:', error);
    if (!res.headersSent) res.status(500).json({ error: 'Failed to stream occupancy grid' });
  }
});

digitalTwinRoutes.get('/:id/occupancy.yaml', async (req: Request, res: Response) => {
  try {
    const twin = await digitalTwinRepository.findById(req.params.id);
    if (!twin) return res.status(404).json({ error: 'Digital twin not found' });
    await streamArtifact(res, twin.occupancyYamlKey, 'text/yaml', `${twin.id}-occupancy.yaml`);
  } catch (error) {
    console.error('[DigitalTwin] occupancy.yaml error:', error);
    if (!res.headersSent) res.status(500).json({ error: 'Failed to stream occupancy metadata' });
  }
});

// ----------------------------------------------------------------------------
// Zones — /api/digital-twins/:id/zones
// ----------------------------------------------------------------------------

digitalTwinRoutes.get('/:id/zones', async (req: Request, res: Response) => {
  try {
    if (!(await twinZoneService.twinExists(req.params.id))) {
      return res.status(404).json({ error: 'Digital twin not found' });
    }
    const zones = await twinZoneService.listZones(req.params.id);
    res.json(zones);
  } catch (error) {
    console.error('[TwinZone] list error:', error);
    res.status(500).json({ error: 'Failed to list zones' });
  }
});

digitalTwinRoutes.post('/:id/zones', async (req: Request, res: Response) => {
  try {
    if (!(await twinZoneService.twinExists(req.params.id))) {
      return res.status(404).json({ error: 'Digital twin not found' });
    }
    const { name, type, points, minZ, maxZ, color, metadata } = req.body ?? {};
    if (typeof name !== 'string' || typeof type !== 'string' || !Array.isArray(points)) {
      return res.status(400).json({ error: 'name, type, and points[] are required' });
    }
    const zone = await twinZoneService.createZone({
      twinId: req.params.id,
      name,
      type: type as TwinZoneType,
      points: points as TwinZonePoint[],
      minZ: typeof minZ === 'number' ? minZ : undefined,
      maxZ: typeof maxZ === 'number' ? maxZ : undefined,
      color: typeof color === 'string' ? color : undefined,
      metadata: metadata && typeof metadata === 'object' ? metadata : undefined,
    });
    res.status(201).json(zone);
  } catch (error) {
    console.error('[TwinZone] create error:', error);
    res.status(500).json({ error: 'Failed to create zone' });
  }
});

digitalTwinRoutes.put('/:id/zones/:zoneId', async (req: Request, res: Response) => {
  try {
    const { name, type, points, minZ, maxZ, color, metadata } = req.body ?? {};
    const zone = await twinZoneService.updateZone(req.params.id, req.params.zoneId, {
      name: typeof name === 'string' ? name : undefined,
      type: typeof type === 'string' ? (type as TwinZoneType) : undefined,
      points: Array.isArray(points) ? (points as TwinZonePoint[]) : undefined,
      minZ: typeof minZ === 'number' ? minZ : undefined,
      maxZ: typeof maxZ === 'number' ? maxZ : undefined,
      color: typeof color === 'string' ? color : undefined,
      metadata: metadata && typeof metadata === 'object' ? metadata : undefined,
    });
    if (!zone) return res.status(404).json({ error: 'Zone not found' });
    res.json(zone);
  } catch (error) {
    console.error('[TwinZone] update error:', error);
    res.status(500).json({ error: 'Failed to update zone' });
  }
});

digitalTwinRoutes.delete('/:id/zones/:zoneId', async (req: Request, res: Response) => {
  try {
    const ok = await twinZoneService.deleteZone(req.params.id, req.params.zoneId);
    if (!ok) return res.status(404).json({ error: 'Zone not found' });
    res.status(204).send();
  } catch (error) {
    console.error('[TwinZone] delete error:', error);
    res.status(500).json({ error: 'Failed to delete zone' });
  }
});

// ----------------------------------------------------------------------------
// Export — /api/digital-twins/:id/export
// ----------------------------------------------------------------------------

digitalTwinRoutes.get('/:id/export/nav2-keepout.pgm', async (req: Request, res: Response) => {
  try {
    const pgm = await twinExportService.exportKeepoutPgm(req.params.id);
    if (!pgm) return res.status(404).json({ error: 'Digital twin not found' });
    res.setHeader('Content-Type', 'image/x-portable-graymap');
    res.setHeader('Content-Disposition', `inline; filename="nav2-keepout.pgm"`);
    res.send(pgm);
  } catch (error) {
    console.error('[TwinExport] keepout.pgm error:', error);
    res.status(500).json({ error: 'Failed to export keep-out mask' });
  }
});

digitalTwinRoutes.get('/:id/export/nav2-keepout.yaml', async (req: Request, res: Response) => {
  try {
    const yaml = await twinExportService.exportKeepoutYaml(req.params.id);
    if (yaml === null) return res.status(404).json({ error: 'Digital twin not found' });
    res.setHeader('Content-Type', 'text/yaml');
    res.setHeader('Content-Disposition', `inline; filename="nav2-keepout.yaml"`);
    res.send(yaml);
  } catch (error) {
    console.error('[TwinExport] keepout.yaml error:', error);
    res.status(500).json({ error: 'Failed to export costmap filter' });
  }
});

digitalTwinRoutes.get('/:id/export/vda5050.json', async (req: Request, res: Response) => {
  try {
    const roadmap = await twinExportService.exportRoadmap(req.params.id);
    if (!roadmap) return res.status(404).json({ error: 'Digital twin not found' });
    res.json(roadmap);
  } catch (error) {
    console.error('[TwinExport] vda5050 error:', error);
    res.status(500).json({ error: 'Failed to export roadmap' });
  }
});
