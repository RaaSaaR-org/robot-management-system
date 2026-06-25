/**
 * @file SensorScanRepository.ts
 * @description Data access layer for SensorScan (recorded point clouds)
 */

import { prisma } from '../database/index.js';
import type { SensorScan as PrismaSensorScan } from '@prisma/client';
import type { PointCloudSensorType } from '../types/pointcloud.types.js';

// ============================================================================
// TYPES
// ============================================================================

/** Robot world pose at capture time (twin world frame; quaternion identity = no rotation). */
export interface ScanPose {
  x: number;
  y: number;
  z: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
}

export interface SensorScanRecord {
  id: string;
  robotId: string;
  sensorName: string;
  sensorType: PointCloudSensorType;
  format: string;
  pointCount: number;
  fileSize: number;
  hasIntensity: boolean;
  storageBackend: 'rustfs' | 'local';
  storageBucket: string;
  storageKey: string;
  bounds: [number, number, number, number, number, number];
  metadata?: Record<string, unknown>;
  /** Digital-twin scan-session linkage (TASK-170). Null for ad-hoc captures. */
  sessionId: string | null;
  frameIndex: number | null;
  pose: ScanPose;
  capturedAt: string;
}

export interface CreateSensorScanInput {
  robotId: string;
  sensorName: string;
  sensorType: PointCloudSensorType;
  format?: string;
  pointCount: number;
  fileSize: number;
  hasIntensity: boolean;
  storageBackend: 'rustfs' | 'local';
  storageBucket: string;
  storageKey: string;
  bounds: [number, number, number, number, number, number];
  metadata?: Record<string, unknown>;
  /** Digital-twin scan-session linkage (TASK-170). */
  sessionId?: string | null;
  frameIndex?: number | null;
  pose?: ScanPose;
}

// ============================================================================
// HELPERS
// ============================================================================

function safeParseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function dbToDomain(row: PrismaSensorScan): SensorScanRecord {
  return {
    id: row.id,
    robotId: row.robotId,
    sensorName: row.sensorName,
    sensorType: row.sensorType as PointCloudSensorType,
    format: row.format,
    pointCount: row.pointCount,
    fileSize: row.fileSize,
    hasIntensity: row.hasIntensity,
    storageBackend: row.storageBackend as 'rustfs' | 'local',
    storageBucket: row.storageBucket,
    storageKey: row.storageKey,
    bounds: [row.minX, row.minY, row.minZ, row.maxX, row.maxY, row.maxZ],
    metadata: safeParseJson<Record<string, unknown> | undefined>(row.metadata, undefined),
    sessionId: row.sessionId,
    frameIndex: row.frameIndex,
    pose: {
      x: row.poseX,
      y: row.poseY,
      z: row.poseZ,
      qx: row.poseQx,
      qy: row.poseQy,
      qz: row.poseQz,
      qw: row.poseQw,
    },
    capturedAt: row.capturedAt.toISOString(),
  };
}

// ============================================================================
// REPOSITORY
// ============================================================================

export class SensorScanRepository {
  async create(input: CreateSensorScanInput): Promise<SensorScanRecord> {
    const [minX, minY, minZ, maxX, maxY, maxZ] = input.bounds;
    const pose = input.pose;
    const row = await prisma.sensorScan.create({
      data: {
        robotId: input.robotId,
        sensorName: input.sensorName,
        sensorType: input.sensorType,
        format: input.format ?? 'pcd',
        pointCount: input.pointCount,
        fileSize: input.fileSize,
        hasIntensity: input.hasIntensity,
        storageBackend: input.storageBackend,
        storageBucket: input.storageBucket,
        storageKey: input.storageKey,
        minX, minY, minZ, maxX, maxY, maxZ,
        sessionId: input.sessionId ?? null,
        frameIndex: input.frameIndex ?? null,
        ...(pose
          ? {
              poseX: pose.x,
              poseY: pose.y,
              poseZ: pose.z,
              poseQx: pose.qx,
              poseQy: pose.qy,
              poseQz: pose.qz,
              poseQw: pose.qw,
            }
          : {}),
        metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      },
    });
    return dbToDomain(row);
  }

  /**
   * List all scans captured during one digital-twin sweep, ordered by their
   * monotonic frame index (the order the sidecar merges them in).
   */
  async listBySession(sessionId: string): Promise<SensorScanRecord[]> {
    const rows = await prisma.sensorScan.findMany({
      where: { sessionId },
      orderBy: { frameIndex: 'asc' },
    });
    return rows.map(dbToDomain);
  }

  async findById(id: string): Promise<SensorScanRecord | null> {
    const row = await prisma.sensorScan.findUnique({ where: { id } });
    return row ? dbToDomain(row) : null;
  }

  async listByRobot(robotId: string, limit = 50): Promise<SensorScanRecord[]> {
    const rows = await prisma.sensorScan.findMany({
      where: { robotId },
      orderBy: { capturedAt: 'desc' },
      take: limit,
    });
    return rows.map(dbToDomain);
  }

  async listAll(limit = 100): Promise<SensorScanRecord[]> {
    const rows = await prisma.sensorScan.findMany({
      orderBy: { capturedAt: 'desc' },
      take: limit,
    });
    return rows.map(dbToDomain);
  }

  async delete(id: string): Promise<boolean> {
    try {
      await prisma.sensorScan.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  }
}

export const sensorScanRepository = new SensorScanRepository();
