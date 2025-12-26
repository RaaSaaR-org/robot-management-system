/**
 * @file types.ts
 * @description Type definitions for CLI (subset of robot-agent types)
 */

// Status types
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

export type RobotType = 'h1' | 'so101' | 'generic';

// Location
export interface RobotLocation {
  x: number;
  y: number;
  z?: number;
  floor?: string;
  zone?: string;
  heading?: number;
}

// Joint state
export interface JointState {
  name: string;
  position: number;
  velocity?: number;
  effort?: number;
}

// Robot entity
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

// Telemetry
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

// Command types
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

// Alert types
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

// API Response types
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

// CLI-specific types
export type OutputFormat = 'table' | 'json' | 'minimal';

export interface CliOptions {
  url: string;
  robot?: string;
  format: OutputFormat;
  color: boolean;
}

export interface HealthResponse {
  status: string;
  robotId: string;
  robotStatus: string;
  batteryLevel: number;
  timestamp: string;
}

export interface ApiError {
  code: string;
  message: string;
}
