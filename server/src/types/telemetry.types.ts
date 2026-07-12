/**
 * @file telemetry.types.ts
 * @description Rich robot telemetry field types (TASK-184 real-data flow).
 *
 * Server-side mirror of the robot-agent telemetry types
 * (robot-agent/src/robot/types.ts). Field names are part of the shared
 * TASK-184 data contract (bridge → sidecar → agent → server → app) and MUST
 * stay identical across all four layers. Never fabricate values: a field whose
 * source has no fresh data is left undefined.
 */

/** IMU reading (body IMU from rt/lowstate). */
export interface ImuTelemetry {
  rpy?: [number, number, number] | null;
  gyro?: [number, number, number] | null;
  accel?: [number, number, number] | null;
  temperature?: number | null;
}

/** One Dex3 pressure pad (pressure/temperature arrays per sensor cell). */
export interface TouchPad {
  pressure: number[];
  temperature?: number[];
}

/** Dex3 hand touch state, per hand. */
export interface HandTouch {
  left?: TouchPad[];
  right?: TouchPad[];
}

/** Battery / BMS state. Only `soc` is guaranteed when present. */
export interface BatteryState {
  soc: number; // 0-100
  voltage?: number | null;
  current?: number | null;
  temperature?: number | null;
  soh?: number | null;
  cycles?: number | null;
  cellVoltages?: number[] | null;
}

/** Odometry state (rt/odommodestate). Only `position` is guaranteed. */
export interface OdometryState {
  position: [number, number, number];
  rpy?: [number, number, number] | null;
  velocity?: [number, number, number] | null;
  yawSpeed?: number | null;
}

/**
 * Field groups a telemetry frame can carry. The sim telemetry generator marks
 * every group it fabricates in `RobotTelemetry.simulated`; the real-over-sim
 * override replaces a group's values with hardware data AND removes the group
 * from `simulated`.
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
