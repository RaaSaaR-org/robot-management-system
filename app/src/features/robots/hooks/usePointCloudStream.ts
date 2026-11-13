/**
 * @file usePointCloudStream.ts
 * @description Streams point-cloud frames for the perception viewer.
 *
 * Polls the API server's snapshot proxy (JSON) in every build. The production
 * build used to open a binary WebSocket to a hardcoded host no deployment
 * serves (TASK-485); the server offers no point-cloud socket, so there is none
 * to derive. The `enabled` flag keeps the hook idle unless the Perception view
 * is open and the robot has a connected agent.
 * @feature robots
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { sensorScansApi } from '../api/sensorScansApi';
import type { PointCloudFrame } from '../types/robots.types';

export interface UsePointCloudStreamOptions {
  /** Whether the stream is active (e.g. the Perception tab is open). */
  enabled?: boolean;
  /** Poll interval in ms (default 1200). */
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
  const { enabled: enabledOption = true, updateInterval = 1200, sensor } = options;
  const enabled = enabledOption && robotId !== '';

  const [frame, setFrame] = useState<PointCloudFrame | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  const mountedRef = useRef(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const handleFrame = useCallback((next: PointCloudFrame) => {
    if (!mountedRef.current) return;
    setFrame(next);
    setLastUpdate(new Date());
    setIsConnected(true);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    if (!enabled) {
      setIsConnected(false);
      return () => { mountedRef.current = false; };
    }

    let cancelled = false;
    // One line per failure streak, not one per tick.
    let failed = false;
    const poll = async () => {
      try {
        const next = await sensorScansApi.getPointCloud(robotId, sensor);
        if (!cancelled) {
          failed = false;
          handleFrame(next);
        }
      } catch (error) {
        if (!cancelled) {
          setIsConnected(false);
          if (!failed) console.error('Failed to fetch point cloud (further failures muted until recovery):', error);
          failed = true;
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
  }, [enabled, robotId, sensor, updateInterval, handleFrame]);

  return useMemo(
    () => ({ frame, isConnected, lastUpdate }),
    [frame, isConnected, lastUpdate],
  );
}
