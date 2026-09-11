/**
 * @file simulation.types.ts
 * @description Type definitions for safety simulation preview
 * @feature command
 * @dependencies none
 */

// ============================================================================
// BASIC TYPES
// ============================================================================

/** Point on the simulation canvas */
export interface SimulationPoint {
  x: number;
  y: number;
}

/** Obstacle type classification */
export type ObstacleType = 'static' | 'dynamic';

/** Waypoint type along path */
export type WaypointType = 'start' | 'waypoint' | 'destination';

// ============================================================================
// OBSTACLE TYPES
// ============================================================================

/** Obstacle in the simulation */
export interface SimulationObstacle {
  /** Unique obstacle ID */
  id: string;
  /** Position on canvas */
  position: SimulationPoint;
  /** Obstacle radius/size */
  size: number;
  /** Display label */
  label: string;
  /** Static or moving obstacle */
  type: ObstacleType;
}

// ============================================================================
// PATH TYPES
// ============================================================================

/** Waypoint along the path */
export interface SimulationWaypoint {
  /** Position on canvas */
  position: SimulationPoint;
  /** Type of waypoint */
  type: WaypointType;
}

/** Path data for visualization */
export interface SimulationPath {
  /** SVG path d attribute */
  pathData: string;
  /** Waypoints along path */
  waypoints: SimulationWaypoint[];
  /** Total distance in meters */
  distance: number;
  /** Estimated time in seconds */
  eta: number;
}

// ============================================================================
// STATE TYPES
// ============================================================================

/** Safety status from interpretation */
export type SimulationSafetyStatus = 'safe' | 'caution' | 'dangerous';

/** Full simulation state */
export interface SimulationState {
  /** Current robot position */
  robotPosition: SimulationPoint;
  /** Robot heading in degrees */
  robotHeading: number;
  /** Target destination (null if no move command) */
  destination: SimulationPoint | null;
  /** Calculated path (null if not calculated) */
  path: SimulationPath | null;
  /** Obstacles along the path */
  obstacles: SimulationObstacle[];
  /** Safety classification */
  safetyStatus: SimulationSafetyStatus;
  /** Whether animation is playing */
  isAnimating: boolean;
}

// ============================================================================
// COMPONENT PROPS TYPES
// ============================================================================

/** Props for SafetySimulationPreview component */
export interface SafetySimulationPreviewProps {
  /** Robot's current position */
  robotPosition: SimulationPoint;
  /** Command destination (null hides simulation) */
  destination: SimulationPoint | null;
  /** Obstacles to display */
  obstacles?: SimulationObstacle[];
  /** Safety classification from interpretation */
  safetyClassification: SimulationSafetyStatus;
  /** Robot speed in m/s (for ETA calculation) */
  speed?: number;
  /** Whether the simulation is visible */
  isVisible: boolean;
  /** Additional class names */
  className?: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/** Default robot speed in m/s */
export const DEFAULT_ROBOT_SPEED = 0.5;

/** Canvas dimensions for SVG viewBox */
export const CANVAS_SIZE = {
  width: 400,
  height: 225,
} as const;

/** Safety status colors */
export const SAFETY_STATUS_COLORS: Record<
  SimulationSafetyStatus,
  { primary: string; secondary: string; bg: string }
> = {
  safe: {
    primary: 'var(--signal-measured)',
    secondary: 'var(--signal-measured)',
    bg: 'color-mix(in srgb, var(--signal-measured) 15%, transparent)',
  },
  caution: {
    primary: 'var(--signal-unknown)',
    secondary: 'var(--signal-unknown)',
    bg: 'color-mix(in srgb, var(--signal-unknown) 15%, transparent)',
  },
  dangerous: {
    primary: 'var(--signal-stopped)',
    secondary: 'var(--signal-stopped)',
    bg: 'color-mix(in srgb, var(--signal-stopped) 15%, transparent)',
  },
};

/** Movement command types that show simulation */
export const MOVEMENT_COMMAND_TYPES = ['move', 'return_home', 'pickup', 'drop'] as const;
