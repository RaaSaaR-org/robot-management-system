/**
 * @file sensorScansApi.ts
 * @description API calls for point-cloud perception (live snapshot, scan capture/list/download)
 * @feature robots
 * @dependencies @/api/client
 */

import { apiClient } from '@/api/client';
import type { PointCloudFrame, SensorScanSummary } from '../types/robots.types';

// Note: apiClient already has /api prefix in baseURL
const ENDPOINTS = {
  snapshot: (robotId: string) => `/robots/${robotId}/pointcloud/snapshot`,
  capture: (robotId: string) => `/robots/${robotId}/pointcloud/capture`,
  lidarSwitch: (robotId: string) => `/robots/${robotId}/pointcloud/lidar/switch`,
  list: '/sensor-scans',
  download: (id: string) => `/sensor-scans/${id}/download`,
  delete: (id: string) => `/sensor-scans/${id}`,
} as const;

export const sensorScansApi = {
  /**
   * Fetch a live point-cloud frame for a robot (proxied from the agent).
   */
  async getPointCloud(robotId: string, sensor?: string): Promise<PointCloudFrame> {
    const response = await apiClient.get<PointCloudFrame>(ENDPOINTS.snapshot(robotId), {
      params: sensor ? { sensor } : undefined,
    });
    return response.data;
  },

  /**
   * Capture a full-resolution scan into storage.
   */
  async captureScan(robotId: string, sensor?: string): Promise<SensorScanSummary> {
    const response = await apiClient.post<SensorScanSummary>(ENDPOINTS.capture(robotId), { sensor });
    return response.data;
  },

  /**
   * Toggle the robot's physical LiDAR (hardware only — a sensor enable that
   * commands no motion). Resolves with {ok:false, error} rather than throwing
   * when the switch can't be performed.
   */
  async setLidarSwitch(
    robotId: string,
    on: boolean,
  ): Promise<{ ok: boolean; lidar?: string; error?: string }> {
    const response = await apiClient.post<{ ok: boolean; lidar?: string; error?: string }>(
      ENDPOINTS.lidarSwitch(robotId),
      { on },
    );
    return response.data;
  },

  /**
   * List recorded scans, optionally filtered by robot.
   */
  async listScans(robotId?: string): Promise<SensorScanSummary[]> {
    const response = await apiClient.get<{ scans: SensorScanSummary[] }>(ENDPOINTS.list, {
      params: robotId ? { robotId } : undefined,
    });
    return response.data.scans;
  },

  /**
   * Download the raw PCD bytes for a recorded scan.
   */
  async downloadScan(id: string): Promise<ArrayBuffer> {
    const response = await apiClient.get<ArrayBuffer>(ENDPOINTS.download(id), {
      responseType: 'arraybuffer',
    });
    return response.data;
  },

  /**
   * Delete a recorded scan.
   */
  async deleteScan(id: string): Promise<void> {
    await apiClient.delete(ENDPOINTS.delete(id));
  },
};
