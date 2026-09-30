/**
 * @file fleet.types.ts
 * @description Type definitions for fleet monitoring and visualization
 * @feature fleet
 * @dependencies @/features/robots/types, @/features/alerts/types
 */

import type { RobotStatus } from '@/features/robots/types';
import type { AlertSeverity } from '@/features/alerts/types';

// ============================================================================
// FLEET STATUS TYPES
// ============================================================================

/** Fleet-level aggregated statistics */
export interface FleetStatus {
  /** Total number of robots in fleet */
  totalRobots: number;
  /** Count of robots by status */
  robotsByStatus: Record<RobotStatus, number>;
  /** Average battery level across fleet (0-100) */
  avgBatteryLevel: number | null;
  /** Count of alerts by severity */
  alertCounts: Record<AlertSeverity, number>;
  /** Total unacknowledged alerts */
  totalUnacknowledgedAlerts: number;
  /** Number of currently active tasks */
  activeTaskCount: number;
  /** Robots requiring attention (error, low battery, etc.) */
  robotsNeedingAttention: number;
}

// ============================================================================
// ROBOT MAP TYPES
// ============================================================================

/** Robot position on map */
export interface RobotMapMarker {
  /** Robot ID */
  robotId: string;
  /** Robot name for display */
  name: string;
  /** Position coordinates */
  position: { x: number; y: number };
  /** Robot status */
  status: RobotStatus;
  /** Battery level (0-100), or null for AC-powered robots */
  batteryLevel: number | null;
  /** Floor identifier */
  floor: string;
  /** Current zone name */
  zone?: string;
  /** Name of the task the robot is running, if any */
  currentTask?: string;
  /** Robot metadata (power source, etc.) */
  metadata?: Record<string, unknown>;
}

// ============================================================================
// COMPONENT PROPS TYPES
// ============================================================================

/** Props for FleetStats component */
export interface FleetStatsProps {
  /** Fleet status data */
  status: FleetStatus;
  /** Whether data is loading */
  isLoading?: boolean;
  /** Additional class names */
  className?: string;
}
