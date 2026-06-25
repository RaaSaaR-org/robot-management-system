/**
 * @file types.ts
 * @description Shared types for robot detail tab components
 * @feature robots
 */

import type { Robot, RobotTelemetry, RobotCommand } from '../../types/robots.types';
import type { Process } from '@/features/processes/types';

/**
 * Common props shared across all tab components
 */
export interface TabCommonProps {
  /** Robot data */
  robot: Robot;
  /** Robot ID */
  robotId: string;
}

/**
 * Props for the TelemetryTab component
 */
export interface TelemetryTabProps extends TabCommonProps {
  /** Live telemetry data */
  telemetry: RobotTelemetry | null;
  /** Whether telemetry connection is active */
  isTelemetryConnected: boolean;
  /** Last telemetry update timestamp */
  telemetryLastUpdate: Date | null;
}

/**
 * Props for the CommandsTab component
 */
export interface CommandsTabProps extends TabCommonProps {
  /** Command history */
  commandHistory: RobotCommand[];
  /** Whether a command is currently being executed */
  isCommandLoading: boolean;
  /** Whether commands can be executed */
  canExecuteCommands: boolean;
  /** Execute the send to charge command */
  onSendToCharge: () => Promise<void>;
  /** Execute the return home command */
  onReturnHome: () => Promise<void>;
}

/**
 * Props for the TasksTab component
 */
export interface TasksTabProps extends TabCommonProps {
  /** Tasks assigned to this robot */
  tasks: Process[];
}

/**
 * Props for the InfoTab component
 */
export interface InfoTabProps extends TabCommonProps {}

/**
 * Props for the Model3DTab component
 */
export interface Model3DTabProps extends TabCommonProps {
  /** Live telemetry data for joint states */
  telemetry: RobotTelemetry | null;
  /** Whether telemetry connection is active */
  isTelemetryConnected: boolean;
}

/**
 * Props for the OverviewTab component — the default landing view that pairs the
 * 3D model with the robot's primary controls (VLA task + safe ops).
 */
export interface OverviewTabProps extends TabCommonProps {
  /** Live telemetry data (drives the 3D pose) */
  telemetry: RobotTelemetry | null;
  /** Whether telemetry connection is active */
  isTelemetryConnected: boolean;
  /** Whether a command is currently being executed */
  isCommandLoading: boolean;
  /** Whether commands can be executed */
  canExecuteCommands: boolean;
  /** Send the robot to a charging dock */
  onSendToCharge: () => Promise<void>;
  /** Send the robot to its home base */
  onReturnHome: () => Promise<void>;
}

/**
 * Props for the PerceptionTab component (point-cloud / depth perception)
 */
export interface PerceptionTabProps extends TabCommonProps {
  /** Live telemetry data (poses the embedded robot model) */
  telemetry: RobotTelemetry | null;
}

/**
 * Props for the ChatTab component
 */
export interface ChatTabProps extends TabCommonProps {}

/**
 * Props for the TeleopTab component
 */
export interface TeleopTabProps extends TabCommonProps {}
