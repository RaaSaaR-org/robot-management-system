/**
 * @file types.ts
 * @description Robot type definitions aligned with NeoDEM
 * @status live
 */

// ============================================================================
// STATUS TYPES (aligned with NeoDEM)
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

export type RobotType = 'h1' | 'g1' | 'g1_edu' | 'so101' | 'generic';

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
  temperature?: number; // motor temperature °C (real hardware only — never fabricated)
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
// ROBOT ENTITY (aligned with NeoDEM)
// ============================================================================

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
}

// ============================================================================
// TELEMETRY TYPES
// ============================================================================

// TASK-184 shared data contract (§3) — these shapes are mirrored verbatim in
// server/src/types and the app. Never fabricate values: a field whose source
// has no fresh data is left undefined/null, NOT zero-filled.

/** Base IMU sample (rt/lowstate imu_state on the real G1). */
export interface ImuTelemetry {
  rpy?: [number, number, number] | null;
  gyro?: [number, number, number] | null;
  accel?: [number, number, number] | null;
  temperature?: number | null;
}

/** One Dex3 pressure pad (press_sensor_state entry). */
export interface TouchPad {
  pressure: number[];
  temperature?: number[];
}

/** Dex3 hand touch sensing, per hand (omitted hand = no fresh data). */
export interface HandTouch {
  left?: TouchPad[];
  right?: TouchPad[];
}

/** Battery/BMS state (rt/lf/bmsstate on the real G1). All but soc optional. */
export interface BatteryState {
  soc: number; // 0-100
  voltage?: number | null;
  current?: number | null;
  temperature?: number | null;
  soh?: number | null;
  cycles?: number | null;
  cellVoltages?: number[] | null;
}

/** Odometry sample (rt/odommodestate SportModeState_). All but position optional. */
export interface OdometryState {
  position: [number, number, number];
  rpy?: [number, number, number] | null;
  velocity?: [number, number, number] | null;
  yawSpeed?: number | null;
}

/**
 * A telemetry field group that can independently be real or simulated.
 * The sim generator marks every group it fabricates in `RobotTelemetry.simulated`;
 * the real-over-sim override in state.ts removes a group when hardware data
 * replaces it.
 */
export type TelemetryFieldGroup =
  | 'joints'
  | 'imu'
  | 'touch'
  | 'battery'
  | 'motorTemperatures'
  | 'odometry'
  | 'position'
  | 'sensors';

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
  // TASK-184 field groups — undefined/null = no data (sim didn't fabricate it
  // and hardware has nothing fresh); never zero-filled.
  imu?: ImuTelemetry | null;
  touch?: HandTouch | null;
  battery?: BatteryState | null;
  motorTemperatures?: Record<string, number> | null; // joint name → °C
  odometry?: OdometryState | null;
  /** True when the hardware sidecar reports a connected robot this frame. */
  hardwareConnected?: boolean;
  /** Field groups whose values are SIMULATED this frame (contract §3 semantics). */
  simulated?: TelemetryFieldGroup[];
  errors?: string[];
  warnings?: string[];
  timestamp: string;
}

// ============================================================================
// POINT CLOUD / DEPTH PERCEPTION TYPES
// ============================================================================

export type PointCloudSensorType = 'lidar' | 'depth_camera';

/**
 * Where a point-cloud frame came from:
 *   - `sim`      synthetic generator (no hardware)
 *   - `hardware` live Livox / RealSense via the sidecar
 *   - `replay`   a real recorded scan played back through the pipeline
 */
export type PointCloudSource = 'sim' | 'hardware' | 'replay';

/**
 * Robot/sensor pose in the world frame at the moment a point-cloud frame was
 * captured. Carried on frames produced during a scan session so the points can
 * be lifted from `base_link` into one shared world map (the digital twin).
 *
 * IMPORTANT: `yaw` is in **radians** (robotics frame, about +z). The simulator
 * stores heading in degrees — convert in exactly one place
 * (`RobotStateManager.getPointCloudFrame`) to avoid a silent deg/rad bug.
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
 * A single point-cloud frame from a depth / LiDAR sensor.
 *
 * Points are carried as flat numeric arrays (structure-of-arrays) so the wire
 * format can later swap from JSON to a binary `Float32Array` without changing
 * any consumer: `positions` is `[x0,y0,z0, x1,y1,z1, ...]` (length
 * `pointCount * 3`, meters, robotics frame: x-forward, y-left, z-up) and
 * `intensities` is `[i0, i1, ...]` (length `pointCount`, normalized 0..1).
 */
export interface PointCloudFrame {
  robotId: string;
  /** Sensor identifier, e.g. "mid360_lidar" */
  sensor: string;
  sensorType: PointCloudSensorType;
  /** Reference frame the points are expressed in */
  frame: 'sensor' | 'base_link';
  pointCount: number;
  positions: number[];
  intensities: number[];
  hasIntensity: boolean;
  /** Monotonic frame counter for drop detection */
  sequence: number;
  /** Sensor origin relative to robot base [x, y, z] in meters */
  origin?: [number, number, number];
  /** Provenance of the frame (synthetic, live hardware, or a real recording) */
  source?: PointCloudSource;
  /** Human-readable label for the data source, e.g. "KITTI 000000.bin" */
  sourceLabel?: string;
  /**
   * World pose of the robot/sensor when this frame was captured. Present only
   * on frames produced during a scan session; used to merge `base_link` frames
   * into one world map. Absent on ordinary live/replay frames.
   */
  pose?: PointCloudPose;
  /** Scan session this frame belongs to, when captured during a sweep. */
  scanSessionId?: string;
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
  powerSource?: 'battery' | 'ac_powered';
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
// API RESPONSE TYPES
// ============================================================================

export interface RegistrationInfo {
  robot: Robot;
  endpoints: {
    robot: string;
    command: string;
    telemetry: string;
    telemetryWs: string;
    pointCloud?: string;
    pointCloudWs?: string;
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

// ============================================================================
// ROBOT TASK TYPES (pushed from server)
// ============================================================================

export type RobotTaskStatus = 'pending' | 'assigned' | 'executing' | 'completed' | 'failed' | 'cancelled';
export type RobotTaskSource = 'process' | 'command' | 'manual';
export type StepActionType =
  | 'move_to_location'
  | 'pickup_object'
  | 'drop_object'
  | 'wait'
  | 'inspect'
  | 'charge'
  | 'return_home'
  | 'custom';

export type Priority = 'low' | 'normal' | 'high' | 'critical';

/** Task pushed from server to robot */
export interface PushedTask {
  id: string;
  processInstanceId?: string;
  stepInstanceId?: string;
  actionType: StepActionType;
  actionConfig: Record<string, unknown>;
  instruction: string;
  priority: Priority;
  source: RobotTaskSource;
}

/** Task status update request (robot → server) */
export interface TaskStatusUpdateRequest {
  status: 'executing' | 'completed' | 'failed';
  a2aTaskId?: string;
  a2aContextId?: string;
  result?: {
    success: boolean;
    data?: Record<string, unknown>;
    message?: string;
  };
  error?: string;
}

/** Task progress update request (robot → server) */
export interface TaskProgressUpdateRequest {
  progress: number; // 0-100
  message?: string;
}
