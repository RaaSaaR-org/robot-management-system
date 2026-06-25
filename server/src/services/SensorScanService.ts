/**
 * @file SensorScanService.ts
 * @description Orchestrates point-cloud perception: proxies live frames from the
 *              robot agent, captures full-resolution scans into storage (RustFS
 *              with a local-filesystem fallback), and serves recorded scans.
 * @feature robots
 */

import { EventEmitter } from 'events';
import { promises as fs, createReadStream } from 'fs';
import path from 'path';
import type { Readable } from 'stream';
import { robotManager } from './RobotManager.js';
import { HttpClient, HTTP_TIMEOUTS } from './HttpClient.js';
import { modelStorage, BUCKETS } from '../storage/model-storage.js';
import { encodePcdBinary, computeBounds } from '../storage/pcd.js';
import {
  sensorScanRepository,
  type SensorScanRecord,
  type ScanPose,
} from '../repositories/SensorScanRepository.js';
import type {
  PointCloudFrame,
  SensorScanSummary,
  SensorScanEvent,
  SensorScanEventCallback,
} from '../types/pointcloud.types.js';

// Local fallback directory (used when RustFS is unavailable).
const LOCAL_SCANS_DIR = path.resolve(process.cwd(), 'data', 'scans');

/**
 * Convert a ground-robot pose `{x,y,z,yaw}` (yaw in radians) into the world
 * pose + quaternion stamped onto a scan frame. Only yaw is encoded (roll/pitch
 * assumed 0): qz = sin(yaw/2), qw = cos(yaw/2), qx = qy = 0. Pure + exported
 * so the round-trip is unit-testable.
 */
export function poseToQuaternion(
  pose: { x: number; y: number; z: number; yaw: number },
): ScanPose {
  const half = pose.yaw / 2;
  return {
    x: pose.x,
    y: pose.y,
    z: pose.z,
    qx: 0,
    qy: 0,
    qz: Math.sin(half),
    qw: Math.cos(half),
  };
}

/** Options for persisting a single posed frame into a scan-session sweep. */
export interface PersistFrameOptions {
  robotId: string;
  frame: PointCloudFrame;
  sensor?: string;
  sessionId?: string;
  frameIndex?: number;
  /** Robot world pose `{x,y,z,yaw}` (radians) at capture time. */
  pose?: { x: number; y: number; z: number; yaw: number };
}

export class SensorScanService extends EventEmitter {
  private static instance: SensorScanService;

  private constructor() {
    super();
  }

  static getInstance(): SensorScanService {
    if (!SensorScanService.instance) {
      SensorScanService.instance = new SensorScanService();
    }
    return SensorScanService.instance;
  }

  // ==========================================================================
  // LIVE
  // ==========================================================================

  /**
   * Proxy a live point-cloud frame from the robot agent.
   * @param full Request a full-resolution frame (used by capture)
   */
  async getLiveSnapshot(robotId: string, sensor?: string, full = false): Promise<PointCloudFrame> {
    const registered = await robotManager.getRegisteredRobot(robotId);
    if (!registered) {
      throw new Error(`Robot ${robotId} not found`);
    }
    const httpClient = new HttpClient(registered.baseUrl, HTTP_TIMEOUTS.MEDIUM);
    const query = new URLSearchParams();
    if (sensor) query.set('sensor', sensor);
    if (full) query.set('full', 'true');
    const qs = query.toString();
    const frame = await httpClient.get<PointCloudFrame>(
      `/api/v1/robots/${robotId}/pointcloud${qs ? `?${qs}` : ''}`,
    );
    return frame;
  }

  // ==========================================================================
  // CAPTURE
  // ==========================================================================

  /**
   * Capture a full-resolution scan, persist it as binary PCD, and record it.
   * Ad-hoc Perception capture — no scan-session linkage.
   */
  async captureScan(robotId: string, sensor?: string): Promise<SensorScanSummary> {
    const frame = await this.getLiveSnapshot(robotId, sensor, true);
    const record = await this.persistFrame({ robotId, frame, sensor });
    return this.toSummary(record);
  }

  /**
   * Persist a single posed point-cloud frame as binary PCD + a DB record, and
   * emit `scan:created`. This is the shared store-block: it chooses the backend
   * (RustFS when available, else local file), writes the bytes, stamps the
   * world pose (yaw → quaternion), and links the frame to a scan-session sweep
   * when `sessionId`/`frameIndex` are provided. Returns the created record.
   */
  async persistFrame(opts: PersistFrameOptions): Promise<SensorScanRecord> {
    const { robotId, frame, sessionId, frameIndex } = opts;
    const pcd = encodePcdBinary(frame);
    const bounds = computeBounds(frame.positions);

    // Store: RustFS when available, else local filesystem.
    let storageBackend: 'rustfs' | 'local';
    let storageBucket: string;
    let storageKey: string;

    if (modelStorage.isAvailable()) {
      storageBackend = 'rustfs';
      storageBucket = BUCKETS.SENSOR_SCANS;
      // scanId is derived from the DB row, so upload after create would need the
      // id; instead key by a timestamped name and reconcile via the row.
      const scanId = `${robotId}-${frame.sequence}-${Date.now()}`;
      storageKey = await modelStorage.uploadSensorScan(robotId, scanId, pcd);
    } else {
      storageBackend = 'local';
      storageBucket = 'local';
      const fileName = `${robotId}-${frame.sequence}-${Date.now()}.pcd`;
      const dir = path.join(LOCAL_SCANS_DIR, robotId);
      await fs.mkdir(dir, { recursive: true });
      const filePath = path.join(dir, fileName);
      await fs.writeFile(filePath, pcd);
      storageKey = filePath;
    }

    // Resolve the world pose to stamp: explicit option > frame.pose > identity.
    const rawPose = opts.pose ?? frame.pose;
    const pose: ScanPose | undefined = rawPose
      ? poseToQuaternion({ x: rawPose.x, y: rawPose.y, z: rawPose.z, yaw: rawPose.yaw })
      : undefined;

    const record = await sensorScanRepository.create({
      robotId,
      sensorName: frame.sensor,
      sensorType: frame.sensorType,
      format: 'pcd',
      pointCount: frame.pointCount,
      fileSize: pcd.length,
      hasIntensity: frame.hasIntensity,
      storageBackend,
      storageBucket,
      storageKey,
      bounds,
      sessionId: sessionId ?? null,
      frameIndex: frameIndex ?? null,
      pose,
      metadata: {
        frame: frame.frame,
        origin: frame.origin,
        sequence: frame.sequence,
        source: frame.source,
        sourceLabel: frame.sourceLabel,
      },
    });

    const summary = this.toSummary(record);
    this.emitEvent({
      type: 'scan:created',
      scanId: record.id,
      robotId,
      scan: summary,
      timestamp: new Date().toISOString(),
    });
    return record;
  }

  /** List all scans captured during one digital-twin sweep, ordered by frame. */
  async listScansBySession(sessionId: string): Promise<SensorScanRecord[]> {
    return sensorScanRepository.listBySession(sessionId);
  }

  // ==========================================================================
  // QUERY / RETRIEVAL
  // ==========================================================================

  async listScans(robotId?: string, limit = 50): Promise<SensorScanSummary[]> {
    const records = robotId
      ? await sensorScanRepository.listByRobot(robotId, limit)
      : await sensorScanRepository.listAll(limit);
    return records.map((r) => this.toSummary(r));
  }

  async getScan(id: string): Promise<SensorScanRecord | null> {
    return sensorScanRepository.findById(id);
  }

  /**
   * Open the stored PCD bytes for streaming to the client.
   */
  async openScanStream(record: SensorScanRecord): Promise<Readable> {
    if (record.storageBackend === 'local') {
      return createReadStream(record.storageKey);
    }
    return modelStorage.getSensorScanStream(record.storageKey);
  }

  async deleteScan(id: string): Promise<boolean> {
    const record = await sensorScanRepository.findById(id);
    if (!record) return false;

    try {
      if (record.storageBackend === 'local') {
        await fs.unlink(record.storageKey).catch(() => {});
      } else {
        await modelStorage.deleteSensorScan(record.storageKey).catch(() => {});
      }
    } finally {
      await sensorScanRepository.delete(id);
    }

    this.emitEvent({
      type: 'scan:deleted',
      scanId: id,
      robotId: record.robotId,
      timestamp: new Date().toISOString(),
    });
    return true;
  }

  // ==========================================================================
  // EVENTS
  // ==========================================================================

  onSensorScanEvent(handler: SensorScanEventCallback): () => void {
    this.on('sensor-scan:event', handler);
    return () => this.off('sensor-scan:event', handler);
  }

  private emitEvent(event: SensorScanEvent): void {
    this.emit('sensor-scan:event', event);
  }

  // ==========================================================================
  // HELPERS
  // ==========================================================================

  /** Public adapter: map a stored scan record to its frontend summary. */
  toScanSummary(record: SensorScanRecord): SensorScanSummary {
    return this.toSummary(record);
  }

  private toSummary(record: SensorScanRecord): SensorScanSummary {
    const meta = record.metadata ?? {};
    const source = meta.source as SensorScanSummary['source'] | undefined;
    const sourceLabel = typeof meta.sourceLabel === 'string' ? meta.sourceLabel : undefined;
    return {
      id: record.id,
      robotId: record.robotId,
      sensorName: record.sensorName,
      sensorType: record.sensorType,
      format: record.format,
      pointCount: record.pointCount,
      fileSize: record.fileSize,
      hasIntensity: record.hasIntensity,
      bounds: record.bounds,
      downloadUrl: `/api/sensor-scans/${record.id}/download`,
      source,
      sourceLabel,
      capturedAt: record.capturedAt,
    };
  }
}

export const sensorScanService = SensorScanService.getInstance();
