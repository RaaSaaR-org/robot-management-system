/**
 * @file types.ts
 * @description Robot type definitions aligned with RoboMindOS
 */

// ============================================================================
// STATUS TYPES (aligned with RoboMindOS)
// ============================================================================

export type RobotStatus =
  | 'online'
  | 'offline'
  | 'busy'
  | 'error'
  | 'charging'
  | 'maintenance';

export type CommandStatus = 'pending' | 'executing' | 'completed' | 'failed' | 'cancelled';

export type CommandType =
  | 'move'
  | 'stop'
  | 'pickup'
  | 'drop'
  | 'charge'
  | 'return_home'
  | 'emergency_stop'
  | 'custom';

export type RobotClass = 'lightweight' | 'heavy-duty' | 'standard';

export type RobotType = 'h1' | 'so101' | 'generic';

// ============================================================================
// JOINT TYPES (for 3D visualization)
// ============================================================================

export interface JointConfig {
  name: string;
  axis: 'x' | 'y' | 'z';
  limitLower: number;
  limitUpper: number;
  defaultPosition: number;
}

export interface JointState {
  name: string;
  position: number; // radians
  velocity?: number; // rad/s
  effort?: number; // torque
}

// ============================================================================
// LOCATION TYPES
// ============================================================================

export interface RobotLocation {
  x: number;
  y: number;
  z?: number;
  floor?: string;
  zone?: string;
  heading?: number;
}

// ============================================================================
// ROBOT ENTITY (aligned with RoboMindOS)
// ============================================================================

export interface Robot {
  id: string;
  name: string;
  model: string;
  serialNumber?: string;
  status: RobotStatus;
  batteryLevel: number;
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
}

// ============================================================================
// TELEMETRY TYPES
// ============================================================================

export interface RobotTelemetry {
  robotId: string;
  robotType?: RobotType;
  batteryLevel: number;
  batteryVoltage?: number;
  batteryTemperature?: number;
  cpuUsage: number;
  memoryUsage: number;
  diskUsage?: number;
  temperature: number;
  humidity?: number;
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

export interface RobotCommandRequest {
  type: CommandType;
  payload?: Record<string, unknown>;
  priority?: 'low' | 'normal' | 'high' | 'critical';
}

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
// ALERT TYPES (for server integration)
// ============================================================================

export type AlertSeverity = 'critical' | 'error' | 'warning' | 'info';
export type AlertSource = 'robot' | 'task' | 'system' | 'user';

export interface RobotAlert {
  id: string;
  severity: AlertSeverity;
  title: string;
  message: string;
  source: AlertSource;
  sourceId: string;
  timestamp: string;
  dismissable: boolean;
  autoDismissMs?: number;
}

// ============================================================================
// SIMULATED ROBOT STATE
// ============================================================================

export interface SimulatedRobotState {
  id: string;
  name: string;
  model: string;
  serialNumber: string;
  robotClass: RobotClass;
  robotType: RobotType;
  maxPayloadKg: number;
  description: string;
  status: RobotStatus;
  batteryLevel: number;
  location: RobotLocation;
  targetLocation?: RobotLocation;
  heldObject?: string;
  currentTaskId?: string;
  currentTaskName?: string;
  capabilities: string[];
  firmware: string;
  ipAddress: string;
  speed: number;
  lastSeen: string;
  createdAt: string;
  updatedAt: string;
  errors: string[];
  warnings: string[];
}

export interface RobotConfig {
  id: string;
  name: string;
  model: string;
  robotClass: RobotClass;
  robotType: RobotType;
  maxPayloadKg: number;
  description: string;
  initialLocation: RobotLocation;
  capabilities: string[];
}

export interface CommandResult {
  success: boolean;
  message: string;
  estimatedTime?: number;
  data?: Record<string, unknown>;
}

// ============================================================================
// ZONE TYPES (for zone-aware navigation)
// ============================================================================

export type ZoneType = 'operational' | 'restricted' | 'charging' | 'maintenance';

export interface ZoneBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Zone {
  id: string;
  name: string;
  floor: string;
  type: ZoneType;
  bounds: ZoneBounds;
  color?: string;
  description?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// NAMED LOCATIONS
// ============================================================================

export const NAMED_LOCATIONS: Record<string, RobotLocation> = {
  home: { x: 0, y: 0, floor: '1', zone: 'Home Base' },
  charging_station: { x: 5, y: 0, floor: '1', zone: 'Charging Bay' },
  entrance: { x: 50, y: 0, floor: '1', zone: 'Entrance' },
  exit: { x: 50, y: 50, floor: '1', zone: 'Exit' },
  warehouse_a: { x: 25, y: 15, floor: '1', zone: 'Warehouse A' },
  warehouse_b: { x: 25, y: 35, floor: '1', zone: 'Warehouse B' },
  loading_dock: { x: 45, y: 25, floor: '1', zone: 'Loading Dock' },
};

// ============================================================================
// API RESPONSE TYPES
// ============================================================================

export interface RegistrationInfo {
  robot: Robot;
  endpoints: {
    robot: string;
    command: string;
    telemetry: string;
    telemetryWs: string;
  };
  a2a: {
    agentCard: string;
  };
}

export interface CommandListResponse {
  commands: RobotCommand[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}
