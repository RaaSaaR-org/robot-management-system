/**
 * @file usePointCloudStream.ts
 * @description Streams point-cloud frames for the perception viewer.
 *
 * Mirrors useTelemetryStream's dual path: in dev/demo it polls the server
 * snapshot proxy (JSON); in production it connects a binary WebSocket to the
 * agent's point-cloud endpoint. The `enabled` flag keeps it idle unless the
 * Perception tab is active.
 * @feature robots
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useWebSocket, type UseWebSocketOptions } from '@/shared/hooks/useWebSocket';
import { sensorScansApi } from '../api/sensorScansApi';
import { decodePointCloudFrame } from '../utils/pointcloud';
import type { PointCloudFrame } from '../types/robots.types';

export interface UsePointCloudStreamOptions {
  /** Whether the stream is active (e.g. the Perception tab is open). */
  enabled?: boolean;
  /** Poll interval in ms for dev/demo mode (default 1200). */
  updateInterval?: number;
  /** Optional specific depth sensor name. */
  sensor?: string;
}

export interface UsePointCloudStreamReturn {
  frame: PointCloudFrame | null;
  isConnected: boolean;
  lastUpdate: Date | null;
}

export function usePointCloudStream(
  robotId: string,
  options: UsePointCloudStreamOptions = {},
): UsePointCloudStreamReturn {
  const { enabled = true, updateInterval = 1200, sensor } = options;

  const [frame, setFrame] = useState<PointCloudFrame | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  const mountedRef = useRef(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isDev = import.meta.env.DEV || import.meta.env.VITE_DEMO_MODE === 'true';
  const wsUrl = `wss://api.neodem.io/pointcloud/${robotId}`;

  const handleFrame = useCallback((next: PointCloudFrame) => {
    if (!mountedRef.current) return;
    setFrame(next);
    setLastUpdate(new Date());
    setIsConnected(true);
  }, []);

  // --- Production: binary WebSocket ---
  const wsOptions: UseWebSocketOptions<unknown> = useMemo(
    () => ({
      autoConnect: !isDev && enabled,
      reconnect: true,
      binaryType: 'arraybuffer',
      onBinaryMessage: (buffer: ArrayBuffer) => {
        try {
          const decoded = decodePointCloudFrame(buffer);
          handleFrame({
            robotId,
            sensor: sensor ?? 'mid360_lidar',
            sensorType: 'lidar',
            frame: 'base_link',
            pointCount: decoded.pointCount,
            positions: decoded.positions,
            intensities: decoded.intensities,
            hasIntensity: decoded.hasIntensity,
            sequence: decoded.sequence,
            timestamp: new Date().toISOString(),
          });
        } catch (error) {
          console.warn('Failed to decode point-cloud frame:', error);
        }
      },
      onConnect: () => setIsConnected(true),
      onDisconnect: () => setIsConnected(false),
    }),
    [isDev, enabled, robotId, sensor, handleFrame],
  );

  useWebSocket(wsUrl, wsOptions);

  // --- Dev/demo: poll the server snapshot proxy ---
  useEffect(() => {
    mountedRef.current = true;
    if (!isDev || !enabled) {
      return () => { mountedRef.current = false; };
    }

    let cancelled = false;
    const poll = async () => {
      try {
        const next = await sensorScansApi.getPointCloud(robotId, sensor);
        if (!cancelled) handleFrame(next);
      } catch (error) {
        if (!cancelled) {
          setIsConnected(false);
          console.error('Failed to fetch point cloud:', error);
        }
      }
    };

    void poll();
    intervalRef.current = setInterval(poll, updateInterval);

    return () => {
      cancelled = true;
      mountedRef.current = false;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isDev, enabled, robotId, sensor, updateInterval, handleFrame]);

  return useMemo(
    () => ({ frame, isConnected, lastUpdate }),
    [frame, isConnected, lastUpdate],
  );
}
