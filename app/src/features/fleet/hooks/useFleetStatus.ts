/**
 * @file useFleetStatus.ts
 * @description Hook for aggregating fleet-wide statistics
 * @feature fleet
 * @dependencies @/features/robots/hooks, @/features/alerts/hooks, @/features/fleet/types
 * @stateAccess useRobotsStore (read), useAlertsStore (read)
 */

import { useMemo, useEffect } from 'react';
import { useRobots } from '@/features/robots/hooks';
import { useAlerts } from '@/features/alerts/hooks';
import type { RobotStatus } from '@/features/robots/types';
import type { AlertSeverity } from '@/features/alerts/types';
import type { FleetStatus, RobotMapMarker } from '../types/fleet.types';

// ============================================================================
// TYPES
// ============================================================================

export interface UseFleetStatusReturn {
  /** Aggregated fleet status */
  status: FleetStatus;
  /** Robot markers for map display */
  robotMarkers: RobotMapMarker[];
  /** Available floors from robot data */
  floors: string[];
  /** Whether data is loading */
  isLoading: boolean;
  /** Error message if any */
  error: string | null;
  /** Refresh fleet data */
  refresh: () => Promise<void>;
}

// ============================================================================
// INITIAL STATE
// ============================================================================

const INITIAL_ROBOTS_BY_STATUS: Record<RobotStatus, number> = {
  online: 0,
  offline: 0,
  busy: 0,
  error: 0,
  charging: 0,
  maintenance: 0,
};

const INITIAL_ALERT_COUNTS: Record<AlertSeverity, number> = {
  critical: 0,
  error: 0,
  warning: 0,
  info: 0,
};

// ============================================================================
// HOOK
// ============================================================================

/**
 * Hook for aggregating fleet-wide statistics from robots and alerts.
 *
 * @example
 * ```tsx
 * function FleetDashboard() {
 *   const { status, robotMarkers, floors, isLoading } = useFleetStatus();
 *
 *   if (isLoading) return <Spinner />;
 *
 *   return (
 *     <>
 *       <FleetStats status={status} />
 *       <FleetMap robots={robotMarkers} />
 *     </>
 *   );
 * }
 * ```
 */
export function useFleetStatus(): UseFleetStatusReturn {
  const {
    robots,
    isLoading: robotsLoading,
    error: robotsError,
    fetchRobots,
  } = useRobots();

  const {
    alerts,
    unacknowledgedCount,
    isLoading: alertsLoading,
  } = useAlerts();

  // Fetch robots on mount
  useEffect(() => {
    fetchRobots();
  }, [fetchRobots]);

  // Aggregate robots by status
  const robotsByStatus = useMemo(() => {
    const counts = { ...INITIAL_ROBOTS_BY_STATUS };
    for (const robot of robots) {
      if (robot.status in counts) {
        counts[robot.status as RobotStatus]++;
      }
    }
    return counts;
  }, [robots]);

  // Calculate average battery level
  const avgBatteryLevel = useMemo(() => {
    if (robots.length === 0) return 0;
    const totalBattery = robots.reduce((sum, robot) => sum + (robot.batteryLevel ?? 0), 0);
    return Math.round(totalBattery / robots.length);
  }, [robots]);

  // Count alerts by severity
  const alertCounts = useMemo(() => {
    const counts = { ...INITIAL_ALERT_COUNTS };
    for (const alert of alerts) {
      if (alert.severity in counts) {
        counts[alert.severity]++;
      }
    }
    return counts;
  }, [alerts]);

  // Count active tasks (robots with currentTaskId)
  const activeTaskCount = useMemo(() => {
    return robots.filter((robot) => robot.currentTaskId).length;
  }, [robots]);

  // Count robots needing attention (error status or low battery)
  const robotsNeedingAttention = useMemo(() => {
    return robots.filter(
      (robot) =>
        robot.status === 'error' ||
        robot.status === 'maintenance' ||
        (robot.batteryLevel !== undefined && robot.batteryLevel < 20)
    ).length;
  }, [robots]);

  // Build fleet status object
  const status: FleetStatus = useMemo(
    () => ({
      totalRobots: robots.length,
      robotsByStatus,
      avgBatteryLevel,
      alertCounts,
      totalUnacknowledgedAlerts: unacknowledgedCount,
      activeTaskCount,
      robotsNeedingAttention,
    }),
    [robots.length, robotsByStatus, avgBatteryLevel, alertCounts, unacknowledgedCount, activeTaskCount, robotsNeedingAttention]
  );

  // Convert robots to map markers
  const robotMarkers: RobotMapMarker[] = useMemo(() => {
    return robots.map((robot) => ({
      robotId: robot.id,
      name: robot.name,
      position: {
        x: robot.location?.x ?? 0,
        y: robot.location?.y ?? 0,
      },
      status: robot.status,
      batteryLevel: robot.batteryLevel ?? 0,
      floor: robot.location?.floor ?? '1',
      zone: robot.location?.zone,
    }));
  }, [robots]);

  // Extract unique floors
  const floors = useMemo(() => {
    const floorSet = new Set<string>();
    for (const robot of robots) {
      if (robot.location?.floor) {
        floorSet.add(robot.location.floor);
      }
    }
    const floorArray = Array.from(floorSet).sort();
    return floorArray.length > 0 ? floorArray : ['1'];
  }, [robots]);

  // Refresh function
  const refresh = async () => {
    await fetchRobots();
  };

  return {
    status,
    robotMarkers,
    floors,
    isLoading: robotsLoading || alertsLoading,
    error: robotsError,
    refresh,
  };
}
