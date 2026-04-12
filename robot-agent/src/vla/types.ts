/**
 * @file types.ts
 * @description Minimal VLA type definitions retained for TypeScript consumers.
 * @feature vla
 *
 * The VLA inference server is a separate Python repo (see ../vla-server/).
 * Only types still referenced by robot-agent TypeScript code are kept here.
 * @status live
 */

/**
 * Action represents a single timestep control command.
 */
export interface Action {
  /** Joint position commands, normalized to [-1, 1] range */
  jointCommands: number[];
  /** Gripper command: 0.0 = fully open, 1.0 = fully closed */
  gripperCommand: number;
  /** Target timestamp for this action in Unix epoch seconds */
  timestamp: number;
}

/**
 * Result of executing a VLA action.
 */
export interface ActionResult {
  /** Whether the action was successfully applied */
  success: boolean;
  /** The action that was applied (if successful) */
  appliedAction?: Action;
  /** Error message (if failed) */
  error?: string;
  /** Execution timestamp */
  timestamp: number;
}

/**
 * VLA control mode states.
 */
export type VLAControllerMode = 'inactive' | 'active' | 'paused' | 'stopped';

/**
 * Buffer fill level for action buffer monitoring.
 */
export type BufferLevel = 'empty' | 'low' | 'normal' | 'full';

/**
 * Interpolation methods for smooth action transitions.
 */
export type InterpolationMethod = 'linear' | 'cubic';

/**
 * VLA controller configuration options.
 */
export interface VLAControllerConfig {
  tickIntervalMs: number;
  bufferCapacity: number;
  prefetchThreshold: number;
  underrunTimeoutMs: number;
  interpolationMethod: InterpolationMethod;
  cloudEndpoint: string;
  edgeEndpoint?: string;
  embodimentTag: string;
}

/**
 * VLA status for monitoring and display.
 */
export interface VLAStatus {
  mode: VLAControllerMode;
  bufferLevel: BufferLevel;
  bufferCount: number;
  inferenceLatencyMs: number;
  networkRttMs: number;
  lastActionTimestamp: number;
  underrunCount: number;
  instruction?: string;
  usingEdgeFallback: boolean;
}

/**
 * VLA safety monitoring status from the hardware sidecar.
 */
export interface VLASafetyStatus {
  /** Whether joint-limit validation is enabled */
  validatorEnabled: boolean;
  /** Whether movement rate limiting is enabled */
  rateLimiterEnabled: boolean;
  /** Whether the network watchdog considers the VLA server healthy */
  watchdogHealthy: boolean;
  /** Most recent VLA server response latency in ms */
  lastLatencyMs: number | null;
  /** Total actions that passed validation */
  actionsValidated: number;
  /** Total actions rejected by joint-limit validation */
  actionsRejected: number;
  /** Total actions clipped by joint-limit or rate-limit */
  actionsClipped: number;
  /** Current max delta degrees setting for rate limiter */
  rateLimiterMaxDelta: number;
  /** Current watchdog timeout threshold in ms */
  watchdogTimeoutMs: number;
  /** Degradation events (safe stops) */
  degradationEvents: Array<{
    type: string;
    reason: string;
    timestamp: number;
  }>;
}

/**
 * Observation represents the robot's current sensory state for VLA inference.
 */
export interface Observation {
  cameraImage: Buffer;
  jointPositions: number[];
  jointVelocities: number[];
  languageInstruction: string;
  timestamp: number;
  embodimentTag: string;
  sessionId?: string;
}
