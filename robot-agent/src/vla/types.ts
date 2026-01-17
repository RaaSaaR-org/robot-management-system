/**
 * @file types.ts
 * @description TypeScript type definitions for VLA gRPC client
 * @feature vla
 */

/**
 * Observation represents the robot's current sensory state for VLA inference.
 */
export interface Observation {
  /** Camera image data (JPEG compressed, typically 224x224 or 336x336) */
  cameraImage: Buffer;
  /** Current joint positions in radians */
  jointPositions: number[];
  /** Current joint velocities in rad/s */
  jointVelocities: number[];
  /** Natural language instruction for the task */
  languageInstruction: string;
  /** Observation timestamp in Unix epoch seconds */
  timestamp: number;
  /** Robot embodiment identifier (e.g., "unitree_h1", "so101_arm") */
  embodimentTag: string;
  /** Optional session ID for tracking continuous control sessions */
  sessionId?: string;
}

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
 * ActionChunk contains a sequence of predicted future actions.
 */
export interface ActionChunk {
  /** Sequence of 8-16 future actions to execute */
  actions: Action[];
  /** Inference time in milliseconds */
  inferenceTimeMs: number;
  /** Model version identifier */
  modelVersion: string;
  /** Confidence score for the action prediction (0.0 - 1.0) */
  confidence: number;
  /** Sequence number for tracking in streaming mode */
  sequenceNumber: number;
}

/**
 * ModelInfo contains metadata about the loaded VLA model.
 */
export interface ModelInfo {
  /** Human-readable model name (e.g., "pi0-base", "openvla-7b") */
  modelName: string;
  /** Semantic version string (e.g., "1.2.3") */
  modelVersion: string;
  /** Action space dimensionality (number of joints + gripper) */
  actionDim: number;
  /** Number of actions per chunk (typically 8-16) */
  chunkSize: number;
  /** List of supported robot embodiments */
  supportedEmbodiments: string[];
  /** Expected image width */
  imageWidth: number;
  /** Expected image height */
  imageHeight: number;
  /** Base model architecture (e.g., "pi0", "openvla", "groot") */
  baseModel: string;
}

/**
 * HealthStatus reports server health and resource utilization.
 */
export interface HealthStatus {
  /** Whether the server is ready to accept inference requests */
  ready: boolean;
  /** GPU utilization percentage (0-100) */
  gpuUtilization: number;
  /** GPU memory utilization percentage (0-100) */
  memoryUtilization: number;
  /** Number of pending requests in the inference queue */
  queueDepth: number;
  /** Current server uptime in seconds */
  uptimeSeconds: number;
  /** Number of inference requests processed since startup */
  totalRequests: number;
  /** Average inference latency in milliseconds (rolling window) */
  avgLatencyMs: number;
}

/**
 * VLA client configuration options.
 */
export interface VLAClientConfig {
  /** gRPC server hostname */
  host: string;
  /** gRPC server port */
  port: number;
  /** Connection pool size (default: 4) */
  poolSize?: number;
  /** Health check interval in milliseconds (default: 5000) */
  healthCheckIntervalMs?: number;
  /** Initial reconnection delay in milliseconds (default: 100) */
  reconnectDelayMs?: number;
  /** Maximum reconnection delay in milliseconds (default: 30000) */
  maxReconnectDelayMs?: number;
  /** REST fallback URL (optional, for degraded mode) */
  restFallbackUrl?: string;
  /** Request timeout in milliseconds (default: 5000) */
  timeoutMs?: number;
}

/**
 * VLA client connection state.
 */
export type ConnectionState = 'connecting' | 'ready' | 'error' | 'closed';

/**
 * VLA client event types.
 */
export type VLAClientEvent =
  | 'connected'
  | 'disconnected'
  | 'error'
  | 'healthCheck'
  | 'reconnecting';

/**
 * Latency metrics for monitoring.
 */
export interface LatencyMetrics {
  /** P50 latency in milliseconds */
  p50: number;
  /** P95 latency in milliseconds */
  p95: number;
  /** P99 latency in milliseconds */
  p99: number;
  /** Average latency in milliseconds */
  avg: number;
  /** Total number of samples */
  count: number;
}

/**
 * Inference metrics for monitoring.
 */
export interface InferenceMetrics {
  /** Latency metrics */
  latency: LatencyMetrics;
  /** Number of successful requests */
  successCount: number;
  /** Number of failed requests */
  failureCount: number;
  /** Number of fallback requests (REST) */
  fallbackCount: number;
  /** Success rate (0-1) */
  successRate: number;
}

// ============================================================================
// VLA Controller Types (Task 46)
// ============================================================================

/**
 * Buffer fill level for action buffer monitoring.
 */
export type BufferLevel = 'empty' | 'low' | 'normal' | 'full';

/**
 * VLA control mode states.
 */
export type VLAControllerMode = 'inactive' | 'active' | 'paused' | 'stopped';

/**
 * Interpolation methods for smooth action transitions.
 */
export type InterpolationMethod = 'linear' | 'cubic';

/**
 * Action buffer configuration options.
 */
export interface ActionBufferConfig {
  /** Maximum number of actions in buffer (default: 16 = 320ms at 50Hz) */
  capacity: number;
  /** Low buffer threshold percentage (default: 0.25) */
  lowThreshold: number;
  /** Prefetch trigger threshold percentage (default: 0.5) */
  prefetchThreshold: number;
}

/**
 * VLA controller configuration options.
 */
export interface VLAControllerConfig {
  /** Control loop tick interval in milliseconds (default: 20ms = 50Hz) */
  tickIntervalMs: number;
  /** Action buffer capacity (default: 16 actions) */
  bufferCapacity: number;
  /** Buffer fill level to trigger prefetch (default: 0.5 = 50%) */
  prefetchThreshold: number;
  /** Time before triggering safe retract on extended underrun (default: 500ms) */
  underrunTimeoutMs: number;
  /** Interpolation method for smooth action transitions */
  interpolationMethod: InterpolationMethod;
  /** Primary cloud inference endpoint */
  cloudEndpoint: string;
  /** Optional edge device fallback endpoint */
  edgeEndpoint?: string;
  /** Robot embodiment tag for inference */
  embodimentTag: string;
}

/**
 * VLA status for monitoring and display.
 */
export interface VLAStatus {
  /** Current control mode */
  mode: VLAControllerMode;
  /** Current buffer fill level */
  bufferLevel: BufferLevel;
  /** Number of actions currently in buffer */
  bufferCount: number;
  /** Latest inference latency in milliseconds */
  inferenceLatencyMs: number;
  /** Estimated network round-trip time in milliseconds */
  networkRttMs: number;
  /** Timestamp of last applied action */
  lastActionTimestamp: number;
  /** Total number of buffer underrun events */
  underrunCount: number;
  /** Active language instruction */
  instruction?: string;
  /** Whether using edge fallback endpoint */
  usingEdgeFallback: boolean;
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
 * Action buffer event types.
 */
export type ActionBufferEvent = 'buffer:low' | 'buffer:empty' | 'buffer:full' | 'buffer:refill';

/**
 * VLA controller event types.
 */
export type VLAControllerEvent =
  | 'started'
  | 'stopped'
  | 'paused'
  | 'resumed'
  | 'underrun'
  | 'fallback:position-hold'
  | 'fallback:safe-retract'
  | 'fallback:local-controller'
  | 'endpoint:switched'
  | 'error';
