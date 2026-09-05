/**
 * @file deployment.types.ts
 * @description Type definitions for VLA deployment and skill library management
 * @feature deployment
 */

// ============================================================================
// ENUMS & CONSTANTS
// ============================================================================

export const DeploymentStatuses = [
  'pending',
  'deploying',
  'canary',
  'production',
  'rolling_back',
  'failed',
  'completed',
  'rolled_back',
  'cancelled',
] as const;
export type DeploymentStatus = (typeof DeploymentStatuses)[number];

export const DeploymentStrategies = ['canary', 'blue_green', 'rolling'] as const;
export type DeploymentStrategy = (typeof DeploymentStrategies)[number];

export const SkillStatuses = ['draft', 'published', 'deprecated', 'archived'] as const;
export type SkillStatus = (typeof SkillStatuses)[number];

export const SkillChainStatuses = ['draft', 'active', 'archived'] as const;
export type SkillChainStatus = (typeof SkillChainStatuses)[number];

export const SkillExecutionStatuses = [
  'pending',
  'checking_preconditions',
  'executing',
  'checking_postconditions',
  'completed',
  'failed',
  'cancelled',
] as const;
export type SkillExecutionStatus = (typeof SkillExecutionStatuses)[number];

export const FailureStrategies = ['abort', 'skip', 'retry'] as const;
export type FailureStrategy = (typeof FailureStrategies)[number];

export const ConditionTypes = ['sensor', 'state', 'custom'] as const;
export type ConditionType = (typeof ConditionTypes)[number];

// ============================================================================
// UI STATUS MAPPINGS
// ============================================================================

export const DEPLOYMENT_STATUS_LABELS: Record<DeploymentStatus, string> = {
  pending: 'Pending',
  deploying: 'Deploying',
  canary: 'Canary',
  production: 'Production',
  rolling_back: 'Rolling Back',
  failed: 'Failed',
  completed: 'Completed',
  rolled_back: 'Rolled Back',
  cancelled: 'Cancelled',
};

export const DEPLOYMENT_STATUS_COLORS: Record<DeploymentStatus, 'default' | 'info' | 'warning' | 'success' | 'error'> = {
  pending: 'default',
  deploying: 'info',
  canary: 'warning',
  production: 'success',
  rolling_back: 'warning',
  failed: 'error',
  completed: 'success',
  rolled_back: 'warning',
  cancelled: 'default',
};

export const SKILL_STATUS_LABELS: Record<SkillStatus, string> = {
  draft: 'Draft',
  published: 'Published',
  deprecated: 'Deprecated',
  archived: 'Archived',
};

export const SKILL_STATUS_COLORS: Record<SkillStatus, 'default' | 'success' | 'warning' | 'error'> = {
  draft: 'default',
  published: 'success',
  deprecated: 'warning',
  archived: 'error',
};

// ============================================================================
// CANARY CONFIGURATION
// ============================================================================

export interface CanaryStage {
  percentage: number;
  durationMinutes: number;
}

export interface CanaryConfig {
  stages: CanaryStage[];
  successThreshold: number;
  metricsWindow?: number; // Minutes to evaluate metrics
}

export interface RollbackThresholds {
  errorRate: number; // Max error rate (0-1)
  latencyP99: number; // Max P99 latency in ms
  failureRate: number; // Max failure rate (0-1)
}

export const DEFAULT_CANARY_STAGES: CanaryStage[] = [
  { percentage: 5, durationMinutes: 1440 }, // 5% for 24 hours
  { percentage: 20, durationMinutes: 1440 }, // 20% for 24 hours
  { percentage: 50, durationMinutes: 1440 }, // 50% for 24 hours
  { percentage: 100, durationMinutes: 0 }, // 100% = production
];

export const DEFAULT_ROLLBACK_THRESHOLDS: RollbackThresholds = {
  errorRate: 0.05, // 5%
  latencyP99: 500, // 500ms
  failureRate: 0.1, // 10%
};

export const DEFAULT_CANARY_CONFIG: CanaryConfig = {
  stages: DEFAULT_CANARY_STAGES,
  successThreshold: 0.95,
  metricsWindow: 60, // 60 minutes
};

// Canary preset templates for wizard
export const CANARY_PRESETS = {
  quick: {
    name: 'Quick Canary',
    description: 'Fast rollout for low-risk changes',
    stages: [
      { percentage: 10, durationMinutes: 60 },
      { percentage: 50, durationMinutes: 120 },
      { percentage: 100, durationMinutes: 0 },
    ],
  },
  conservative: {
    name: 'Conservative',
    description: 'Extended monitoring for critical changes',
    stages: [
      { percentage: 5, durationMinutes: 2880 }, // 48 hours
      { percentage: 20, durationMinutes: 2880 },
      { percentage: 50, durationMinutes: 1440 },
      { percentage: 100, durationMinutes: 0 },
    ],
  },
  standard: {
    name: 'Standard',
    description: 'Balanced rollout (default)',
    stages: DEFAULT_CANARY_STAGES,
  },
} as const;

// ============================================================================
// METRICS TYPES
// ============================================================================

export interface RobotMetricsSummary {
  robotId: string;
  totalRequests: number;
  errorCount: number;
  avgLatencyMs: number;
  lastSampleTime: number;
}

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
  sampleSize: number;
  metricsPerRobot: Record<string, RobotMetricsSummary>;
}

export interface ThresholdViolation {
  metric: 'errorRate' | 'latencyP99' | 'failureRate';
  currentValue: number;
  threshold: number;
  severity: 'warning' | 'critical';
}

// ============================================================================
// MODEL VERSION TYPES (from training feature)
// ============================================================================

export interface TrainingMetrics {
  training_loss?: number[];
  validation_loss?: number[];
  learning_rate?: number[];
  accuracy?: number[];
  epoch_times?: number[];
  best_epoch?: number;
  final_loss?: number;
}

export interface ModelVersionMetrics {
  accuracy?: number;
  latencyP50?: number;
  latencyP99?: number;
  successRate?: number;
}

export const ModelSourceKinds = ['training', 'imported', 'derived'] as const;
export type ModelSourceKind = (typeof ModelSourceKinds)[number];

export const MODEL_SOURCE_KIND_LABELS: Record<ModelSourceKind, string> = {
  training: 'Trained here',
  imported: 'Imported',
  derived: 'Derived',
};

export type ModelDeploymentStatus = 'staging' | 'canary' | 'production' | 'archived';

/**
 * Schemes an `artifactUri` may carry. A bare path is rejected by
 * `POST /api/models/versions` with a 400 — it is not portable and fails on
 * another machine in a way nobody can debug. Mirrored here so the modal can
 * say so before the round trip. (TASK-238)
 */
export const ARTIFACT_URI_SCHEMES = ['hf://', 's3://', 'file://'] as const;

export interface ModelVersion {
  id: string;
  skillId: string;
  /** null for an imported model — it was trained outside this server. */
  trainingJobId: string | null;
  /** Human-readable name beside the machine `version`. */
  name?: string | null;
  sourceKind?: ModelSourceKind;
  parentModelVersionId?: string | null;
  modelType?: 'vla' | 'rl_policy';
  version: string;
  artifactUri: string;
  checkpointUri?: string;
  trainingMetrics: TrainingMetrics;
  validationMetrics: TrainingMetrics;
  deploymentStatus: ModelDeploymentStatus;
  metrics?: ModelVersionMetrics;
  createdAt: string;
  updatedAt: string;
  skill?: SkillDefinition;
  parent?: ModelVersion | null;
  children?: ModelVersion[];
  checkpoints?: ModelCheckpoint[];
}

/** One per-epoch checkpoint reported by the training worker. (TASK-238) */
export interface ModelCheckpoint {
  id: string;
  modelVersionId?: string | null;
  trainingJobId: string;
  epoch: number;
  uri: string;
  metrics: Record<string, number>;
  createdAt: string;
}

/** Evaluation rollup returned with `GET /api/models/versions/:id`. */
export interface ModelVersionEvaluationSummary {
  count: number;
  successRate: number;
}

export interface ModelVersionDetail extends ModelVersion {
  evaluation?: ModelVersionEvaluationSummary;
}

/** `GET /api/models/versions/:id/lineage` — ancestors (nearest first) + direct children. */
export interface ModelVersionLineage {
  modelVersionId: string;
  ancestors: ModelVersion[];
  children: ModelVersion[];
}

/** Body of `POST /api/models/versions`. */
export interface RegisterModelVersionInput {
  name?: string;
  version: string;
  artifactUri: string;
  modelType?: 'vla' | 'rl_policy';
  skillId?: string | null;
  parentModelVersionId?: string | null;
  trainingJobId?: string | null;
  trainingMetrics?: TrainingMetrics;
  validationMetrics?: TrainingMetrics;
  deploymentStatus?: ModelDeploymentStatus;
}

/** Body of `PATCH /api/models/versions/:id`. */
export interface UpdateModelVersionInput {
  skillId?: string | null;
  deploymentStatus?: ModelDeploymentStatus;
  name?: string | null;
}

// ============================================================================
// DEPLOYMENT TYPES
// ============================================================================

export interface Deployment {
  id: string;
  modelVersionId: string;
  strategy: DeploymentStrategy;
  targetRobotTypes: string[];
  targetZones: string[];
  trafficPercentage: number;
  canaryConfig: CanaryConfig;
  rollbackThresholds: RollbackThresholds;
  status: DeploymentStatus;
  deployedRobotIds: string[];
  failedRobotIds: string[];
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
  modelVersion?: ModelVersion;
}

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

export interface CreateDeploymentInput {
  modelVersionId: string;
  strategy?: DeploymentStrategy;
  targetRobotTypes?: string[];
  targetZones?: string[];
  canaryConfig?: Partial<CanaryConfig>;
  rollbackThresholds?: Partial<RollbackThresholds>;
}

export interface RollbackRequest {
  reason: string;
}

export interface DeploymentQueryParams {
  modelVersionId?: string;
  strategy?: DeploymentStrategy | DeploymentStrategy[];
  status?: DeploymentStatus | DeploymentStatus[];
  page?: number;
  pageSize?: number;
}

// ============================================================================
// SKILL TYPES
// ============================================================================

export interface Condition {
  type: ConditionType;
  name: string; // e.g., "gripper_empty", "object_visible"
  check: string; // Expression or function name
  params?: Record<string, unknown>;
}

// Skill parameter definition for UI
export interface SkillParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  required: boolean;
  description?: string;
  default?: unknown;
}

export interface SkillDefinition {
  id: string;
  name: string;
  version: string;
  description?: string;
  parametersSchema: Record<string, unknown>; // JSON Schema format
  defaultParameters: Record<string, unknown>;
  parameters: SkillParameter[]; // Flattened parameter list for UI
  preconditions: Condition[];
  postconditions: Condition[];
  requiredCapabilities: string[];
  timeout?: number; // seconds
  maxRetries: number;
  status: SkillStatus;
  linkedModelVersionId?: string;
  createdAt: string;
  updatedAt: string;
  compatibleRobotTypes?: RobotType[];
  linkedModelVersion?: ModelVersion;
}

export interface CreateSkillInput {
  name: string;
  version: string;
  description?: string;
  parametersSchema?: Record<string, unknown>;
  defaultParameters?: Record<string, unknown>;
  preconditions?: Condition[];
  postconditions?: Condition[];
  requiredCapabilities?: string[];
  timeout?: number;
  maxRetries?: number;
  status?: SkillStatus;
  linkedModelVersionId?: string;
  compatibleRobotTypeIds?: string[];
}

export interface UpdateSkillInput {
  id?: string;
  name?: string;
  version?: string;
  description?: string;
  parametersSchema?: Record<string, unknown>;
  defaultParameters?: Record<string, unknown>;
  preconditions?: Condition[];
  postconditions?: Condition[];
  requiredCapabilities?: string[];
  timeout?: number;
  maxRetries?: number;
  linkedModelVersionId?: string;
  compatibleRobotTypeIds?: string[];
}

export interface SkillQueryParams {
  name?: string;
  status?: SkillStatus | SkillStatus[];
  robotTypeId?: string;
  capability?: string;
  linkedModelVersionId?: string;
  page?: number;
  pageSize?: number;
}

// ============================================================================
// SKILL CHAIN TYPES
// ============================================================================

export interface SkillChainStep {
  id: string;
  skillId: string;
  order: number;
  parameters: Record<string, unknown>;
  inputMapping?: Record<string, string>; // Map previous output to input
  onFailure: FailureStrategy;
  maxRetries?: number;
  timeoutOverride?: number;
  skill?: SkillDefinition;
}

export interface SkillChain {
  id: string;
  name: string;
  version: string;
  description?: string;
  status: SkillChainStatus;
  steps: SkillChainStep[];
  estimatedDuration?: number; // Total estimated duration in seconds
  createdAt: string;
  updatedAt: string;
}

export interface CreateSkillChainInput {
  name: string;
  description?: string;
  steps: Array<{
    skillId: string;
    parameters?: Record<string, unknown>;
    inputMapping?: Record<string, string>;
    onFailure?: FailureStrategy;
    maxRetries?: number;
    timeoutOverride?: number;
  }>;
}

export interface UpdateSkillChainInput {
  name?: string;
  description?: string;
  status?: SkillChainStatus;
  steps?: Array<{
    skillId: string;
    parameters?: Record<string, unknown>;
    inputMapping?: Record<string, string>;
    onFailure?: FailureStrategy;
    maxRetries?: number;
    timeoutOverride?: number;
  }>;
}

export interface SkillChainQueryParams {
  name?: string;
  status?: SkillChainStatus | SkillChainStatus[];
  page?: number;
  pageSize?: number;
}

// ============================================================================
// SKILL EXECUTION TYPES
// ============================================================================

export interface ConditionCheckResult {
  condition: Condition;
  passed: boolean;
  actualValue?: unknown;
  expectedValue?: unknown;
  error?: string;
}

export interface SkillExecutionResult {
  skillId: string;
  robotId: string;
  status: SkillExecutionStatus;
  startedAt: string;
  completedAt?: string;
  duration?: number; // Duration in ms
  parameters: Record<string, unknown>;
  output?: Record<string, unknown>;
  preconditionResults?: ConditionCheckResult[];
  postconditionResults?: ConditionCheckResult[];
  error?: string;
  retryCount: number;
}

export interface ChainExecutionResult {
  chainId: string;
  robotId: string;
  status: SkillExecutionStatus;
  startedAt: string;
  completedAt?: string;
  totalDuration?: number;
  stepResults: Array<{
    stepOrder: number;
    skillId: string;
    result: SkillExecutionResult;
  }>;
  finalOutput?: Record<string, unknown>;
  failedAtStep?: number;
  error?: string;
}

/**
 * Rollout strategy for a skill execution (lerobot-rollout, LeRobot 0.6.0 —
 * TASK-179). NOT the fleet DeploymentStrategy (canary/blue_green) — this
 * controls how a single rollout is recorded/monitored on the robot agent:
 * - `default`: run the policy directly
 * - `sentry`: record the whole rollout
 * - `highlight`: ring-buffer recent frames, capture an incident clip on failure
 * - `dagger`: tag human teleop corrections as intervention episodes
 */
export type RolloutStrategy = 'default' | 'sentry' | 'highlight' | 'dagger';

export interface ExecuteSkillRequest {
  robotId: string;
  parameters?: Record<string, unknown>;
  skipPreconditions?: boolean;
  skipPostconditions?: boolean;
  rolloutStrategy?: RolloutStrategy;
}

export interface ExecuteChainRequest {
  robotId: string;
  initialParameters?: Record<string, unknown>;
  startFromStep?: number;
}

// ============================================================================
// VALIDATION TYPES
// ============================================================================

export interface ValidationError {
  path: string[];
  message: string;
  code: string;
}

export interface ParameterValidationResult {
  skillId: string;
  valid: boolean;
  errors: ValidationError[];
  coercedParameters?: Record<string, unknown>;
}

// ============================================================================
// COMPATIBILITY TYPES
// ============================================================================

export interface RobotType {
  id: string;
  name: string;
  manufacturer: string;
  model: string;
  actionDim: number;
  proprioceptionDim: number;
  capabilities: string[];
  createdAt: string;
  updatedAt: string;
}

export interface RobotCompatibility {
  robotId: string;
  robotName: string;
  robotType: string;
  compatible: boolean;
  missingCapabilities: string[];
  matchingCapabilities: string[];
}

export interface CompatibilityCheckResult {
  skillId: string;
  totalRobots: number;
  compatibleRobots: number;
  robots: RobotCompatibility[];
}

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

export const SkillEventTypes = [
  'skill:execution:started',
  'skill:execution:preconditions:checking',
  'skill:execution:preconditions:passed',
  'skill:execution:preconditions:failed',
  'skill:execution:running',
  'skill:execution:postconditions:checking',
  'skill:execution:postconditions:passed',
  'skill:execution:postconditions:failed',
  'skill:execution:completed',
  'skill:execution:failed',
  'skill:execution:cancelled',
  'skill:chain:started',
  'skill:chain:step:started',
  'skill:chain:step:completed',
  'skill:chain:step:failed',
  'skill:chain:completed',
  'skill:chain:failed',
] as const;
export type SkillEventType = (typeof SkillEventTypes)[number];

export interface SkillEvent {
  type: SkillEventType;
  skillId?: string;
  chainId?: string;
  robotId: string;
  timestamp: string;
  stepOrder?: number;
  result?: SkillExecutionResult;
  error?: string;
}

// ============================================================================
// API RESPONSE TYPES
// ============================================================================

export interface PaginationInfo {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface DeploymentsListResponse {
  deployments: Deployment[];
  pagination: PaginationInfo;
}

export interface SkillsListResponse {
  skills: SkillDefinition[];
  pagination: PaginationInfo;
}

export interface SkillChainsListResponse {
  chains: SkillChain[];
  pagination: PaginationInfo;
}

// ============================================================================
// UI FILTER TYPES
// ============================================================================

export interface DeploymentFilters {
  status?: DeploymentStatus[];
  strategy?: DeploymentStrategy[];
  dateRange?: { start: string; end: string };
  skillId?: string;
}

export interface SkillFilters {
  status?: SkillStatus[];
  robotTypeId?: string;
  capability?: string;
  search?: string;
}

// ============================================================================
// STORE STATE TYPES
// ============================================================================

export interface DeploymentState {
  // Deployments
  deployments: Deployment[];
  deploymentsLoading: boolean;
  deploymentsError: string | null;
  deploymentsPagination: PaginationInfo;
  selectedDeploymentId: string | null;

  // Skills
  skills: SkillDefinition[];
  skillsLoading: boolean;
  skillsError: string | null;
  skillsPagination: PaginationInfo;
  selectedSkillId: string | null;

  // Skill Chains
  skillChains: SkillChain[];
  skillChainsLoading: boolean;
  skillChainsError: string | null;
  skillChainsPagination: PaginationInfo;

  // Real-time metrics
  deploymentMetrics: Record<string, AggregatedDeploymentMetrics>;

  // Model Versions (for deployment)
  modelVersions: ModelVersion[];
  modelVersionsLoading: boolean;

  // Filters
  deploymentFilters: DeploymentFilters;
  skillFilters: SkillFilters;
}

export interface DeploymentActions {
  // Deployments
  fetchDeployments: (params?: DeploymentQueryParams) => Promise<void>;
  fetchActiveDeployments: () => Promise<void>;
  fetchDeployment: (id: string) => Promise<DeploymentResponse>;
  createDeployment: (input: CreateDeploymentInput) => Promise<Deployment>;
  startDeployment: (id: string) => Promise<void>;
  advanceStage: (id: string) => Promise<void>;
  promoteDeployment: (id: string) => Promise<void>;
  rollbackDeployment: (id: string, reason: string) => Promise<void>;
  cancelDeployment: (id: string) => Promise<void>;
  setDeploymentFilters: (filters: Partial<DeploymentFilters>) => void;
  selectDeployment: (id: string | null) => void;

  // Deployment Metrics
  fetchDeploymentMetrics: (id: string) => Promise<void>;
  updateDeploymentMetrics: (id: string, metrics: AggregatedDeploymentMetrics) => void;

  // Skills
  fetchSkills: (params?: SkillQueryParams) => Promise<void>;
  fetchPublishedSkills: () => Promise<void>;
  fetchSkill: (id: string) => Promise<SkillDefinition>;
  createSkill: (input: CreateSkillInput) => Promise<SkillDefinition>;
  updateSkill: (id: string, input: UpdateSkillInput) => Promise<SkillDefinition>;
  deleteSkill: (id: string) => Promise<void>;
  publishSkill: (id: string) => Promise<void>;
  deprecateSkill: (id: string) => Promise<void>;
  archiveSkill: (id: string) => Promise<void>;
  validateSkillParams: (id: string, params: Record<string, unknown>) => Promise<ParameterValidationResult>;
  getCompatibleRobots: (id: string) => Promise<CompatibilityCheckResult>;
  executeSkill: (id: string, request: ExecuteSkillRequest) => Promise<SkillExecutionResult>;
  setSkillFilters: (filters: Partial<SkillFilters>) => void;
  selectSkill: (id: string | null) => void;

  // Skill Chains
  fetchSkillChains: (params?: SkillChainQueryParams) => Promise<void>;
  fetchActiveChains: () => Promise<void>;
  fetchSkillChain: (id: string) => Promise<SkillChain>;
  createSkillChain: (input: CreateSkillChainInput) => Promise<SkillChain>;
  updateSkillChain: (id: string, input: UpdateSkillChainInput) => Promise<SkillChain>;
  deleteSkillChain: (id: string) => Promise<void>;
  activateChain: (id: string) => Promise<void>;
  archiveChain: (id: string) => Promise<void>;
  executeChain: (id: string, request: ExecuteChainRequest) => Promise<ChainExecutionResult>;

  // Model Versions
  fetchModelVersions: (params?: { skillId?: string; deploymentStatus?: string }) => Promise<void>;

  // WebSocket event handlers
  handleDeploymentEvent: (event: DeploymentEvent) => void;
  handleSkillEvent: (event: SkillEvent) => void;

  // Reset
  reset: () => void;
}

export type DeploymentStore = DeploymentState & DeploymentActions;
