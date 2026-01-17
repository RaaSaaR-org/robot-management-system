/**
 * @file deployment.types.ts
 * @description Type definitions for VLA model deployment pipeline
 * @feature vla
 */

import type {
  Deployment,
  DeploymentStatus,
  DeploymentStrategy,
  CanaryConfig,
  RollbackThresholds,
  ModelVersion,
} from './vla.types.js';

// ============================================================================
// WEBSOCKET EVENT TYPES
// ============================================================================

export const DeploymentEventTypes = [
  'deployment:created',
  'deployment:started',
  'deployment:stage:started',
  'deployment:stage:completed',
  'deployment:robot:deployed',
  'deployment:robot:failed',
  'deployment:metrics:threshold_warning',
  'deployment:rollback:started',
  'deployment:rollback:completed',
  'deployment:promoted',
  'deployment:completed',
  'deployment:failed',
  'deployment:cancelled',
] as const;

export type DeploymentEventType = (typeof DeploymentEventTypes)[number];

/**
 * Deployment event for WebSocket broadcasting
 */
export interface DeploymentEvent {
  type: DeploymentEventType;
  deploymentId: string;
  deployment?: Deployment;
  robotId?: string;
  stage?: number;
  totalStages?: number;
  metrics?: AggregatedDeploymentMetrics;
  error?: string;
  reason?: string;
  timestamp: string;
}

export type DeploymentEventCallback = (event: DeploymentEvent) => void;

// ============================================================================
// REQUEST/RESPONSE TYPES
// ============================================================================

/**
 * Request to start a new deployment
 */
export interface StartDeploymentRequest {
  modelVersionId: string;
  strategy?: DeploymentStrategy;
  targetRobotTypes?: string[];
  targetZones?: string[];
  canaryConfig?: Partial<CanaryConfig>;
  rollbackThresholds?: Partial<RollbackThresholds>;
}

/**
 * Response with deployment details and status
 */
export interface DeploymentResponse {
  deployment: Deployment;
  modelVersion?: ModelVersion;
  currentStage: number;
  totalStages: number;
  metrics?: AggregatedDeploymentMetrics;
  nextStageTime?: string;
  eligibleRobotCount: number;
  deployedCount: number;
  failedCount: number;
}

/**
 * Rollback request
 */
export interface RollbackRequest {
  reason: string;
}

// ============================================================================
// INTERNAL STATE TYPES
// ============================================================================

/**
 * Internal deployment context for tracking active deployments
 */
export interface DeploymentContext {
  deployment: Deployment;
  currentStageIndex: number;
  stageStartTime: Date;
  robotsInCurrentStage: string[];
  previousModelVersionByRobot: Map<string, string>;
  stageTimer?: NodeJS.Timeout;
}

/**
 * Canary stage definition with defaults
 */
export interface CanaryStage {
  percentage: number;
  durationMinutes: number;
}

// ============================================================================
// METRICS TYPES
// ============================================================================

/**
 * Single metric sample from a robot
 */
export interface DeploymentMetricSample {
  robotId: string;
  timestamp: number;
  inferenceLatencyMs: number;
  errorCount: number;
  successCount: number;
  taskFailures: number;
  taskSuccesses: number;
}

/**
 * Metric window for rolling aggregation
 */
export interface MetricWindow {
  deploymentId: string;
  samples: DeploymentMetricSample[];
  windowDurationMs: number;
  windowStartTime: number;
}

/**
 * Aggregated metrics for a deployment
 */
export interface AggregatedDeploymentMetrics {
  deploymentId: string;
  windowStartTime: number;
  windowEndTime: number;
  totalInferences: number;
  successfulInferences: number;
  errorRate: number;
  latencyP50: number;
  latencyP95: number;
  latencyP99: number;
  taskSuccessRate: number;
  robotCount: number;
  metricsPerRobot: Record<string, RobotMetricsSummary>;
}

/**
 * Per-robot metric summary
 */
export interface RobotMetricsSummary {
  robotId: string;
  totalRequests: number;
  errorCount: number;
  avgLatencyMs: number;
  lastSampleTime: number;
}

/**
 * Robot VLA metrics fetched from robot agent
 */
export interface RobotVLAMetrics {
  robotId: string;
  modelVersion: string;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  taskSuccesses: number;
  taskFailures: number;
  lastUpdated: string;
}

// ============================================================================
// THRESHOLD CHECKING TYPES
// ============================================================================

/**
 * Result of checking rollback thresholds
 */
export interface ThresholdCheckResult {
  passed: boolean;
  violations: ThresholdViolation[];
}

/**
 * Individual threshold violation
 */
export interface ThresholdViolation {
  metric: 'errorRate' | 'latencyP99' | 'failureRate';
  currentValue: number;
  threshold: number;
  severity: 'warning' | 'critical';
}

// ============================================================================
// ROBOT SELECTION TYPES
// ============================================================================

/**
 * Robot with eligibility score for deployment
 */
export interface RobotEligibility {
  robotId: string;
  score: number;
  robotType?: string;
  zone?: string;
  status: string;
  utilization: number;
}

/**
 * Result of robot selection for a stage
 */
export interface RobotSelectionResult {
  selectedRobots: string[];
  totalEligible: number;
  excludedCount: number;
  excludedReasons: Record<string, string[]>;
}

// ============================================================================
// ROBOT AGENT TYPES
// ============================================================================

/**
 * Request to switch model on a robot
 */
export interface ModelSwitchRequest {
  modelVersionId: string;
  artifactUri: string;
  rollback?: boolean;
}

/**
 * Response from robot after model switch
 */
export interface ModelSwitchResponse {
  robotId: string;
  previousModelVersion: string | null;
  newModelVersion: string;
  status: 'switched' | 'failed';
  switchTimeMs?: number;
  error?: string;
  timestamp: string;
}

/**
 * Result of deploying to a single robot
 */
export interface RobotDeployResult {
  robotId: string;
  success: boolean;
  previousModelVersion?: string;
  error?: string;
  timestamp: string;
}

// ============================================================================
// DEFAULT CONFIGURATIONS
// ============================================================================

export const DEFAULT_CANARY_STAGES: CanaryStage[] = [
  { percentage: 5, durationMinutes: 1440 },   // 5% for 24 hours
  { percentage: 20, durationMinutes: 1440 },  // 20% for 24 hours
  { percentage: 50, durationMinutes: 1440 },  // 50% for 24 hours
  { percentage: 100, durationMinutes: 0 },    // 100% = production
];

export const DEFAULT_ROLLBACK_THRESHOLDS: RollbackThresholds = {
  errorRate: 0.05,      // 5%
  latencyP99: 500,      // 500ms
  failureRate: 0.10,    // 10%
};

export const DEFAULT_CANARY_CONFIG: CanaryConfig = {
  stages: DEFAULT_CANARY_STAGES,
  successThreshold: 0.95,
  metricsWindow: 60, // 60 minutes
};

// Timing constants
export const METRICS_POLL_INTERVAL_MS = 30000;    // 30 seconds
export const THRESHOLD_CHECK_INTERVAL_MS = 60000; // 60 seconds
export const ROBOT_SWITCH_TIMEOUT_MS = 30000;     // 30 seconds
