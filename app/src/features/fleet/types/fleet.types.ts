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
  avgBatteryLevel: number;
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
// MAP ZONE TYPES
// ============================================================================

/** Zone type classification */
export type ZoneType = 'operational' | 'restricted' | 'charging' | 'maintenance';

/** Map zone bounds */
export interface ZoneBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Map zone definition */
export interface FloorZone {
  /** Unique zone ID */
  id: string;
  /** Display name */
  name: string;
  /** Floor identifier */
  floor: string;
  /** Zone boundaries */
  bounds: ZoneBounds;
  /** Zone type */
  type: ZoneType;
}

/** Zone from server API (includes additional fields) */
export interface Zone extends FloorZone {
  /** Optional color override */
  color?: string;
  /** Optional description */
  description?: string;
  /** Optional metadata */
  metadata?: Record<string, unknown>;
  /** Creation timestamp */
  createdAt: string;
  /** Last update timestamp */
  updatedAt: string;
}

/** Request to create a new zone */
export interface CreateZoneRequest {
  name: string;
  floor: string;
  type: ZoneType;
  bounds: ZoneBounds;
  color?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

/** Request to update a zone */
export interface UpdateZoneRequest {
  name?: string;
  floor?: string;
  type?: ZoneType;
  bounds?: ZoneBounds;
  color?: string;
  description?: string;
  metadata?: Record<string, unknown>;
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
  /** Battery level (0-100) */
  batteryLevel: number;
  /** Floor identifier */
  floor: string;
  /** Current zone name */
  zone?: string;
}

// ============================================================================
// COMPONENT PROPS TYPES
// ============================================================================

/** Editor mode for zone manipulation */
export type ZoneEditorMode = 'view' | 'draw' | 'edit' | 'delete';

/** Props for FleetMap component */
export interface FleetMapProps {
  /** Robot markers to display */
  robots: RobotMapMarker[];
  /** Optional zones to overlay */
  zones?: FloorZone[];
  /** Currently selected floor */
  selectedFloor: string;
  /** Callback when floor selection changes */
  onFloorChange: (floor: string) => void;
  /** Callback when robot marker is clicked */
  onRobotClick?: (robotId: string) => void;
  /** Editor mode for zone manipulation */
  editorMode?: ZoneEditorMode;
  /** Currently selected zone ID */
  selectedZoneId?: string | null;
  /** Callback when zone is selected */
  onSelectZone?: (id: string | null) => void;
  /** Callback when zone is double-clicked for editing */
  onEditZone?: (zone: Zone) => void;
  /** Callback when new zone bounds are drawn */
  onZoneDrawn?: (bounds: ZoneBounds) => void;
  /** Additional class names */
  className?: string;
}

/** Props for FleetStats component */
export interface FleetStatsProps {
  /** Fleet status data */
  status: FleetStatus;
  /** Whether data is loading */
  isLoading?: boolean;
  /** Additional class names */
  className?: string;
}

/** Props for ZoneOverlay component */
export interface ZoneOverlayProps {
  /** Zones to render */
  zones: FloorZone[];
  /** Scale factor for coordinates */
  scale: number;
  /** Offset for positioning */
  offset: { x: number; y: number };
}

/** Props for RobotMarker component */
export interface RobotMarkerProps {
  /** Robot marker data */
  robot: RobotMapMarker;
  /** Position on canvas */
  position: { x: number; y: number };
  /** Whether marker is selected */
  isSelected?: boolean;
  /** Click handler */
  onClick?: () => void;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/** Map canvas dimensions */
export const MAP_CANVAS_SIZE = {
  width: 600,
  height: 400,
} as const;

/** Robot status colors for map markers (futuristic theme) */
export const ROBOT_STATUS_COLORS: Record<RobotStatus, string> = {
  online: '#18E4C3', // turquoise
  busy: '#3b82f6', // blue-500
  charging: '#eab308', // yellow-500
  error: '#ef4444', // red-500
  maintenance: '#f97316', // orange-500
  offline: '#6b7280', // gray-500
};

/** Zone type colors (futuristic theme) */
export const ZONE_TYPE_COLORS: Record<ZoneType, { fill: string; stroke: string; opacity: number }> = {
  operational: { fill: '#2A5FFF', stroke: '#2A5FFF', opacity: 0.08 },
  charging: { fill: '#18E4C3', stroke: '#18E4C3', opacity: 0.08 },
  maintenance: { fill: '#f97316', stroke: '#f97316', opacity: 0.08 },
  restricted: { fill: '#ef4444', stroke: '#ef4444', opacity: 0.06 },
};

/** Default floors available */
export const DEFAULT_FLOORS = ['1', '2'] as const;

/**
 * Mock zone data for development.
 * @deprecated Use useZones() hook or zoneApi.getZones() to fetch zones from server.
 * Server database is the single source of truth - see seedZones.ts
 */
export const MOCK_ZONES: FloorZone[] = [
  { id: 'wa', name: 'Warehouse A', floor: '1', bounds: { x: 0, y: 0, width: 20, height: 15 }, type: 'operational' },
  { id: 'wb', name: 'Warehouse B', floor: '1', bounds: { x: 20, y: 0, width: 25, height: 20 }, type: 'operational' },
  { id: 'wc', name: 'Warehouse C', floor: '1', bounds: { x: 35, y: 15, width: 15, height: 15 }, type: 'operational' },
  { id: 'cs', name: 'Charging Station', floor: '1', bounds: { x: 0, y: 15, width: 10, height: 10 }, type: 'charging' },
  { id: 'ld', name: 'Loading Dock', floor: '1', bounds: { x: 10, y: 20, width: 20, height: 10 }, type: 'operational' },
  { id: 'mb', name: 'Maintenance Bay', floor: '1', bounds: { x: 0, y: 25, width: 10, height: 10 }, type: 'maintenance' },
  { id: 'oa', name: 'Office Area', floor: '2', bounds: { x: 25, y: 0, width: 20, height: 15 }, type: 'restricted' },
  { id: 'hb', name: 'Hallway B', floor: '2', bounds: { x: 10, y: 25, width: 25, height: 10 }, type: 'operational' },
];
