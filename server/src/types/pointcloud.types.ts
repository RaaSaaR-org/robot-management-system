/**
 * @file pointcloud.types.ts
 * @description Shared types for point-cloud perception (live frames + recorded scans)
 * @feature robots
 */

export type PointCloudSensorType = 'lidar' | 'depth_camera';

/** Provenance of a point cloud: synthetic, live hardware, or a real recording. */
export type PointCloudSource = 'sim' | 'hardware' | 'replay';

/**
 * A live point-cloud frame proxied from a robot agent. Mirrors the robot-agent
 * `PointCloudFrame` shape: points are flat arrays (positions length
 * `pointCount * 3`, meters, base frame; intensities length `pointCount`, 0..1).
 */
export interface PointCloudFrame {
  robotId: string;
  sensor: string;
  sensorType: PointCloudSensorType;
  frame: 'sensor' | 'base_link';
  pointCount: number;
  positions: number[];
  intensities: number[];
  hasIntensity: boolean;
  sequence: number;
  origin?: [number, number, number];
  /**
   * Robot world pose at capture time (twin world frame). Present on
   * full-resolution posed snapshots used by digital-twin sweeps. `yaw` is in
   * radians; roll/pitch are optional (assumed 0 for ground robots).
   */
  pose?: { x: number; y: number; z: number; yaw: number; roll?: number; pitch?: number };
  /** Provenance: synthetic, live hardware, or a real recording. */
  source?: PointCloudSource;
  /** Human-readable source label, e.g. "KITTI 000000.bin". */
  sourceLabel?: string;
  timestamp: string;
}

/** Summary of a recorded scan, returned to the frontend gallery. */
export interface SensorScanSummary {
  id: string;
  robotId: string;
  sensorName: string;
  sensorType: PointCloudSensorType;
  format: string;
  pointCount: number;
  fileSize: number;
  hasIntensity: boolean;
  /** Axis-aligned bounding box in meters: [minX,minY,minZ, maxX,maxY,maxZ] */
  bounds: [number, number, number, number, number, number];
  /** Relative URL the client fetches to download the point bytes (PCD). */
  downloadUrl: string;
  /** Provenance of the captured cloud. */
  source?: PointCloudSource;
  /** Human-readable source label for the capture. */
  sourceLabel?: string;
  capturedAt: string;
}

export type SensorScanEventType = 'scan:created' | 'scan:deleted';

export interface SensorScanEvent {
  type: SensorScanEventType;
  scanId: string;
  robotId: string;
  scan?: SensorScanSummary;
  timestamp: string;
}

export type SensorScanEventCallback = (event: SensorScanEvent) => void;
