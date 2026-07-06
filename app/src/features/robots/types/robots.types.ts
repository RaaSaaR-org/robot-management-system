/**
 * @file robots.types.ts
 * @description Type definitions for robot entities, telemetry, commands, and store
 * @feature robots
 * @dependencies None
 */

// ============================================================================
// STATUS TYPES
// ============================================================================

/** Robot operational status */
export type RobotStatus =
  | 'online'
  | 'offline'
  | 'busy'
  | 'error'
  | 'charging'
  | 'maintenance'
  | 'protective_stop';

/** Command execution status */
export type CommandStatus = 'pending' | 'executing' | 'completed' | 'failed' | 'cancelled';

/** Command types supported by robots */
export type CommandType =
  | 'move'
  | 'stop'
  | 'pickup'
  | 'drop'
  | 'charge'
  | 'return_home'
  | 'emergency_stop'
  | 'custom';

/** Robot type for 3D visualization */
export type RobotType = 'h1' | 'g1' | 'so101' | 'generic';

const ROBOT_TYPES: readonly RobotType[] = ['h1', 'g1', 'so101', 'generic'];

/** Reported types that render with an existing model (g1_edu = G1 body + Dex3 hands; hand joints absent from g1.urdf are ignored by the viewer) */
const ROBOT_TYPE_ALIASES: Record<string, RobotType> = {
  g1_edu: 'g1',
};

/** Normalize a backend-reported robot type (telemetry/metadata) to one the 3D viewer can render */
export function normalizeRobotType(value: unknown): RobotType {
  if (typeof value !== 'string') return 'generic';
  const lower = value.toLowerCase();
  if ((ROBOT_TYPES as readonly string[]).includes(lower)) return lower as RobotType;
  return ROBOT_TYPE_ALIASES[lower] ?? 'generic';
}

// ============================================================================
// JOINT TYPES (for 3D visualization)
// ============================================================================

/** Joint state for 3D animation */
export interface JointState {
  name: string;
  position: number;
  velocity?: number;
  effort?: number;
}

// ============================================================================
// POINT CLOUD / PERCEPTION TYPES
// ============================================================================

export type PointCloudSensorType = 'lidar' | 'depth_camera';

/** Provenance of a point cloud: synthetic, live hardware, or a real recording. */
export type PointCloudSource = 'sim' | 'hardware' | 'replay';

/**
 * Robot/sensor world pose at capture time (world frame; `yaw` in radians).
 * Present on frames produced during a digital-twin scan session, so `base_link`
 * points can be lifted into the shared world map.
 */
export interface PointCloudPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  roll?: number;
  pitch?: number;
}

/**
 * A point-cloud frame for the perception viewer. Positions/intensities are
 * flat arrays — `number[]` from the JSON snapshot path, `Float32Array` from the
 * binary WebSocket path. The viewer normalizes via `new Float32Array(...)`.
 */
export interface PointCloudFrame {
  robotId: string;
  sensor: string;
  sensorType: PointCloudSensorType;
  frame: 'sensor' | 'base_link';
  pointCount: number;
  positions: number[] | Float32Array;
  intensities: number[] | Float32Array;
  hasIntensity: boolean;
  sequence: number;
  origin?: [number, number, number];
  /** Provenance: synthetic, live hardware, or a real recording. */
  source?: PointCloudSource;
  /** Human-readable source label, e.g. "KITTI 000000.bin". */
  sourceLabel?: string;
  /** World pose at capture time (scan-session frames only). */
  pose?: PointCloudPose;
  /** Scan session this frame belongs to (scan-session frames only). */
  scanSessionId?: string;
  timestamp: string;
}

/** Summary of a recorded point-cloud scan. */
export interface SensorScanSummary {
  id: string;
  robotId: string;
  sensorName: string;
  sensorType: PointCloudSensorType;
  format: string;
  pointCount: number;
  fileSize: number;
  hasIntensity: boolean;
  /** [minX,minY,minZ, maxX,maxY,maxZ] in meters */
  bounds: [number, number, number, number, number, number];
  downloadUrl: string;
  /** Provenance of the captured cloud. */
  source?: PointCloudSource;
  /** Human-readable source label for the capture. */
  sourceLabel?: string;
  capturedAt: string;
}

// ============================================================================
// LOCATION TYPES
// ============================================================================

/** Robot location in the facility */
export interface RobotLocation {
  x: number;
  y: number;
  z?: number;
  floor?: string;
  zone?: string;
  heading?: number;
}

// ============================================================================
// ROBOT ENTITY
// ============================================================================

/** Core robot entity */
export interface Robot {
  id: string;
  name: string;
  model: string;
  serialNumber?: string;
  status: RobotStatus;
  batteryLevel: number | null;  // null = no battery / AC-powered
  location: RobotLocation;
  lastSeen: string;
  currentTaskId?: string;
  currentTaskName?: string;
  capabilities: string[];
  firmware?: string;
  ipAddress?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  /** A2A agent enabled for this robot */
  a2aEnabled?: boolean;
  /** A2A agent URL for this robot */
  a2aAgentUrl?: string;
}

// ============================================================================
// TELEMETRY TYPES
// ============================================================================

/** Real-time robot telemetry data */
export interface RobotTelemetry {
  robotId: string;
  robotType?: RobotType;
  batteryLevel: number | null;        // null = no battery / AC-powered
  batteryVoltage?: number | null;
  batteryTemperature?: number | null;
  powerSource?: 'battery' | 'ac_powered';
  cpuUsage: number;
  memoryUsage: number;
  diskUsage?: number;
  temperature: number;
  humidity?: number | null;            // null = no humidity sensor
  speed?: number;
  sensors: Record<string, number | boolean | string>;
  jointStates?: JointState[];
  errors?: string[];
  warnings?: string[];
  timestamp: string;
}

// ============================================================================
// COMMAND TYPES
// ============================================================================

/** Robot command request */
export interface RobotCommandRequest {
  type: CommandType;
  payload?: Record<string, unknown>;
  priority?: 'low' | 'normal' | 'high' | 'critical';
}

/** Robot command entity */
export interface RobotCommand {
  id: string;
  robotId: string;
  type: CommandType;
  payload: Record<string, unknown>;
  status: CommandStatus;
  priority: 'low' | 'normal' | 'high' | 'critical';
  result?: Record<string, unknown>;
  errorMessage?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

// ============================================================================
// FILTER & PAGINATION TYPES
// ============================================================================

/** Robot list filter parameters */
export interface RobotFilters {
  status?: RobotStatus | RobotStatus[];
  search?: string;
  capabilities?: string[];
  zone?: string;
}

/** Pagination parameters */
export interface RobotPagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

// ============================================================================
// API REQUEST/RESPONSE TYPES
// ============================================================================

/** Parameters for listing robots */
export interface RobotListParams {
  status?: RobotStatus | RobotStatus[];
  search?: string;
  capabilities?: string[];
  zone?: string;
  page?: number;
  pageSize?: number;
  sortBy?: keyof Robot;
  sortOrder?: 'asc' | 'desc';
}

/** Response for robot list endpoint */
export interface RobotListResponse {
  robots: Robot[];
  pagination: RobotPagination;
}

/** Response for command list endpoint */
export interface CommandListResponse {
  commands: RobotCommand[];
  pagination: RobotPagination;
}

// ============================================================================
// STORE TYPES
// ============================================================================

/** Robots store state */
export interface RobotsState {
  /** List of robots */
  robots: Robot[];
  /** Currently selected robot ID */
  selectedRobotId: string | null;
  /** Current filters */
  filters: RobotFilters;
  /** Pagination state */
  pagination: RobotPagination;
  /** Loading state */
  isLoading: boolean;
  /** Error message */
  error: string | null;
  /** Individual robot detail (when viewing single robot) */
  robotDetail: Robot | null;
  /** Robot telemetry cache */
  telemetryCache: Record<string, RobotTelemetry>;
  /** Recorded point-cloud scans for the current detail view */
  sensorScans: SensorScanSummary[];
}

/** Robot endpoints for communication */
export interface RobotEndpoints {
  robot: string;
  command: string;
  telemetry: string;
  telemetryWs: string;
}

/** Robot registration response */
export interface RegisterRobotResponse {
  robot: Robot;
  endpoints: RobotEndpoints;
}

/** Robots store actions */
export interface RobotsActions {
  /** Fetch robots with current filters */
  fetchRobots: () => Promise<void>;
  /** Fetch a single robot by ID */
  fetchRobot: (id: string) => Promise<void>;
  /** Register a robot from URL */
  registerRobot: (robotUrl: string) => Promise<Robot>;
  /** Unregister a robot */
  unregisterRobot: (robotId: string) => Promise<void>;
  /** Select a robot */
  selectRobot: (id: string | null) => void;
  /** Update filters */
  setFilters: (filters: Partial<RobotFilters>) => void;
  /** Clear all filters */
  clearFilters: () => void;
  /** Set page number */
  setPage: (page: number) => void;
  /** Send command to a robot */
  sendCommand: (robotId: string, command: RobotCommandRequest) => Promise<RobotCommand>;
  /** Update robot status (for WebSocket updates) */
  updateRobotStatus: (robotId: string, status: RobotStatus) => void;
  /** Update robot data (for WebSocket updates) */
  updateRobot: (robot: Partial<Robot> & { id: string }) => void;
  /** Update telemetry cache */
  updateTelemetry: (robotId: string, telemetry: RobotTelemetry) => void;
  /** Fetch recorded point-cloud scans for a robot */
  fetchSensorScans: (robotId: string) => Promise<void>;
  /** Add a robot to the list (for WebSocket updates) */
  addRobot: (robot: Robot) => void;
  /** Remove a robot from the list (for WebSocket updates) */
  removeRobot: (robotId: string) => void;
  /** Clear error */
  clearError: () => void;
  /** Reset store to initial state */
  reset: () => void;
}

/** Combined robots store type */
export type RobotsStore = RobotsState & RobotsActions;

// ============================================================================
// ERROR TYPES
// ============================================================================

/** Robot-related error codes */
export type RobotErrorCode =
  | 'ROBOT_NOT_FOUND'
  | 'ROBOT_OFFLINE'
  | 'ROBOT_BUSY'
  | 'COMMAND_FAILED'
  | 'COMMAND_TIMEOUT'
  | 'INVALID_COMMAND'
  | 'PERMISSION_DENIED'
  | 'NETWORK_ERROR'
  | 'UNKNOWN_ERROR';

/** Robot error */
export interface RobotError {
  code: RobotErrorCode;
  message: string;
  robotId?: string;
  details?: Record<string, unknown>;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/** Status display labels */
export const ROBOT_STATUS_LABELS: Record<RobotStatus, string> = {
  online: 'Online',
  offline: 'Offline',
  busy: 'Busy',
  error: 'Error',
  charging: 'Charging',
  maintenance: 'Maintenance',
  protective_stop: 'Protective Stop',
};

/** Status colors for UI (maps to Badge variants) */
export const ROBOT_STATUS_COLORS: Record<RobotStatus, 'success' | 'default' | 'info' | 'error' | 'warning'> = {
  online: 'success',
  offline: 'default',
  busy: 'info',
  error: 'error',
  charging: 'warning',
  maintenance: 'warning',
  protective_stop: 'error',
};

/** Command type labels */
export const COMMAND_TYPE_LABELS: Record<CommandType, string> = {
  move: 'Move',
  stop: 'Stop',
  pickup: 'Pick Up',
  drop: 'Drop',
  charge: 'Go Charge',
  return_home: 'Return Home',
  emergency_stop: 'Emergency Stop',
  custom: 'Custom Command',
};

/** Default pagination */
export const DEFAULT_PAGINATION: RobotPagination = {
  page: 1,
  pageSize: 12,
  total: 0,
  totalPages: 0,
};

/** Default filters */
export const DEFAULT_FILTERS: RobotFilters = {};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Check if a robot is available for commands
 */
export function isRobotAvailable(robot: Robot): boolean {
  return robot.status === 'online' || robot.status === 'busy';
}

/**
 * Check if a robot needs attention (error or low battery)
 */
export function robotNeedsAttention(robot: Robot): boolean {
  return robot.status === 'error' || (robot.batteryLevel !== null && robot.batteryLevel < 20);
}

/**
 * Get battery level category. Returns null for AC-powered robots (no battery).
 */
export function getBatteryCategory(level: number | null): 'critical' | 'low' | 'medium' | 'high' | 'full' | null {
  if (level === null) return null;
  if (level <= 10) return 'critical';
  if (level <= 25) return 'low';
  if (level <= 50) return 'medium';
  if (level <= 90) return 'high';
  return 'full';
}

/**
 * Format robot location for display
 */
export function formatRobotLocation(location: RobotLocation): string {
  const parts: string[] = [];
  if (location.zone) parts.push(location.zone);
  if (location.floor) parts.push(`Floor ${location.floor}`);
  if (parts.length === 0) {
    parts.push(`(${location.x.toFixed(1)}, ${location.y.toFixed(1)})`);
  }
  return parts.join(' - ');
}
