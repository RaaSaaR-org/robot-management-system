/**
 * @file synthetic.types.ts
 * @description Type definitions for Synthetic Data Generation Pipeline (Isaac Lab)
 * @feature datasets
 */

// ============================================================================
// JOB STATUS TYPES
// ============================================================================

/**
 * Synthetic job status
 */
export type SyntheticJobStatus =
  | 'pending'
  | 'queued'
  | 'running'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled';

// ============================================================================
// DOMAIN RANDOMIZATION TYPES
// ============================================================================

/**
 * Physics domain randomization config
 */
export interface PhysicsRandomizationConfig {
  /** Mass multiplier range [min, max] */
  massRange: [number, number];
  /** Friction coefficient range [min, max] */
  frictionRange: [number, number];
  /** Damping coefficient range [min, max] */
  dampingRange: [number, number];
  /** Gravity variation range (m/s²) [min, max] */
  gravityRange?: [number, number];
  /** Joint stiffness variation [min, max] multiplier */
  jointStiffnessRange?: [number, number];
}

/**
 * Visual domain randomization config
 */
export interface VisualRandomizationConfig {
  /** Enable lighting variation */
  lightingVariation: boolean;
  /** Light intensity range [min, max] */
  lightIntensityRange?: [number, number];
  /** Enable texture randomization */
  textureRandomization: boolean;
  /** Enable background/skybox randomization */
  backgroundRandomization: boolean;
  /** Enable object color variation */
  colorVariation?: boolean;
  /** Color hue shift range in degrees [min, max] */
  hueShiftRange?: [number, number];
}

/**
 * Sensor noise config
 */
export interface SensorNoiseConfig {
  /** Camera RGB noise standard deviation */
  cameraNoiseStd: number;
  /** Camera depth noise standard deviation (meters) */
  depthNoiseStd?: number;
  /** Joint encoder noise standard deviation (radians) */
  jointEncoderNoiseStd: number;
  /** Force/torque sensor noise standard deviation */
  forceTorqueNoiseStd?: number;
  /** Enable random camera position jitter */
  cameraPositionJitter?: boolean;
  /** Camera position jitter range (meters) */
  cameraJitterRange?: number;
}

/**
 * Complete domain randomization config
 */
export interface DomainRandomizationConfig {
  physics: PhysicsRandomizationConfig;
  visual: VisualRandomizationConfig;
  sensor: SensorNoiseConfig;
}

/**
 * Default domain randomization config
 */
export const DEFAULT_DOMAIN_RANDOMIZATION: DomainRandomizationConfig = {
  physics: {
    massRange: [0.5, 2.0],
    frictionRange: [0.5, 1.5],
    dampingRange: [0.8, 1.2],
  },
  visual: {
    lightingVariation: true,
    lightIntensityRange: [0.5, 1.5],
    textureRandomization: true,
    backgroundRandomization: true,
  },
  sensor: {
    cameraNoiseStd: 0.01,
    jointEncoderNoiseStd: 0.001,
  },
};

// ============================================================================
// TASK CONFIGURATION
// ============================================================================

/**
 * Supported Isaac Lab tasks
 */
export type IsaacLabTask =
  | 'pick_place'
  | 'push'
  | 'stack'
  | 'pour'
  | 'open_drawer'
  | 'close_drawer'
  | 'turn_knob'
  | 'press_button'
  | 'insert_peg'
  | 'wipe_surface'
  | 'custom';

/**
 * Task configuration for synthetic generation
 */
export interface TaskConfig {
  /** Task type */
  task: IsaacLabTask;
  /** Custom task script path (if task is 'custom') */
  customTaskScript?: string;
  /** Object variations to use */
  objectVariations?: string[];
  /** Target positions configuration */
  targetPositions?: 'random' | 'grid' | 'predefined';
  /** Predefined target positions */
  predefinedTargets?: Array<[number, number, number]>;
  /** Success criteria threshold */
  successThreshold?: number;
}

// ============================================================================
// JOB CONFIGURATION
// ============================================================================

/**
 * Synthetic job configuration
 */
export interface SyntheticJobConfig {
  /** Task to generate data for */
  task: IsaacLabTask;
  /** Robot embodiment */
  embodiment: string;
  /** Number of trajectories to generate */
  trajectoryCount: number;
  /** Domain randomization settings */
  domainRandomization: DomainRandomizationConfig;
  /** Output format */
  outputFormat: 'lerobot_v3' | 'hdf5' | 'zarr';
  /** Task-specific configuration */
  taskConfig?: TaskConfig;
  /** Simulation settings */
  simulation?: SimulationConfig;
  /** Whether to run headless */
  headless?: boolean;
  /** GPU device ID */
  gpuDeviceId?: number;
  /** Random seed for reproducibility */
  seed?: number;
}

/**
 * Simulation configuration
 */
export interface SimulationConfig {
  /** Simulation timestep (seconds) */
  timestep: number;
  /** Control frequency (Hz) */
  controlFrequency: number;
  /** Episode length (steps) */
  episodeLength: number;
  /** Number of parallel environments */
  numEnvs: number;
  /** Rendering resolution */
  renderResolution?: [number, number];
}

/**
 * Default simulation config
 */
export const DEFAULT_SIMULATION_CONFIG: SimulationConfig = {
  timestep: 0.01,
  controlFrequency: 20,
  episodeLength: 500,
  numEnvs: 16,
  renderResolution: [224, 224],
};

// ============================================================================
// JOB TYPES
// ============================================================================

/**
 * Synthetic data generation job
 */
export interface SyntheticJob {
  id: string;
  task: IsaacLabTask;
  embodiment: string;
  trajectoryCount: number;
  config: SyntheticJobConfig;
  status: SyntheticJobStatus;
  progress: number;
  generatedCount: number;
  successfulCount: number;
  failedCount: number;
  outputDatasetId?: string;
  errorMessage?: string;
  startedAt?: Date;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  createdBy?: string;
  /** Estimated time remaining in seconds */
  estimatedTimeRemaining?: number;
  /** Processing rate (trajectories per second) */
  processingRate?: number;
}

/**
 * Job progress update
 */
export interface JobProgressUpdate {
  jobId: string;
  progress: number;
  generatedCount: number;
  successfulCount: number;
  failedCount: number;
  currentStep?: string;
  estimatedTimeRemaining?: number;
}

// ============================================================================
// SIM-TO-REAL VALIDATION
// ============================================================================

/**
 * Sim-to-real validation result
 */
export interface SimToRealValidation {
  id: string;
  syntheticJobId: string;
  modelVersionId: string;
  validationDate: Date;
  /** Success rate on synthetic data */
  simSuccessRate: number;
  /** Success rate on real data */
  realSuccessRate: number;
  /** Domain gap score (lower is better) */
  domainGapScore: number;
  /** Number of real-world tests */
  realTestCount: number;
  /** Task categories tested */
  taskCategories: string[];
  /** Detailed metrics per task */
  perTaskMetrics?: Record<string, {
    simSuccess: number;
    realSuccess: number;
    gap: number;
  }>;
  notes?: string;
}

/**
 * A/B test configuration for synthetic data
 */
export interface SyntheticABTestConfig {
  /** Baseline model (trained without synthetic) */
  baselineModelId: string;
  /** Test model (trained with synthetic) */
  testModelId: string;
  /** Task categories to test */
  taskCategories: string[];
  /** Number of trials per task */
  trialsPerTask: number;
  /** Environments to test in */
  environments: string[];
}

/**
 * A/B test result
 */
export interface SyntheticABTestResult {
  id: string;
  config: SyntheticABTestConfig;
  status: 'pending' | 'running' | 'completed' | 'failed';
  /** Performance difference (positive = synthetic helped) */
  performanceDelta: number;
  /** Statistical significance */
  pValue?: number;
  /** Is the difference significant (p < 0.05) */
  isSignificant?: boolean;
  results: {
    baseline: { successRate: number; meanConfidence: number };
    withSynthetic: { successRate: number; meanConfidence: number };
  };
  completedAt?: Date;
}

// ============================================================================
// ISAAC LAB SERVICE TYPES
// ============================================================================

/**
 * Isaac Lab service status
 */
export interface IsaacLabServiceStatus {
  available: boolean;
  version?: string;
  gpuCount?: number;
  gpuMemoryAvailable?: number[];
  queueLength: number;
  activeJobs: number;
  lastHealthCheck: Date;
}

/**
 * Isaac Lab generation request (to external service)
 */
export interface IsaacLabGenerationRequest {
  jobId: string;
  config: SyntheticJobConfig;
  callbackUrl: string;
}

/**
 * Isaac Lab generation response (from external service)
 */
export interface IsaacLabGenerationResponse {
  jobId: string;
  status: SyntheticJobStatus;
  outputPath?: string;
  trajectoryCount?: number;
  successRate?: number;
  errorMessage?: string;
}

// ============================================================================
// API REQUEST/RESPONSE TYPES
// ============================================================================

/**
 * Create synthetic job request
 */
export interface CreateSyntheticJobRequest {
  task: IsaacLabTask;
  embodiment: string;
  trajectoryCount: number;
  domainRandomization?: Partial<DomainRandomizationConfig>;
  outputFormat?: 'lerobot_v3' | 'hdf5' | 'zarr';
  taskConfig?: Partial<TaskConfig>;
  simulation?: Partial<SimulationConfig>;
  headless?: boolean;
  seed?: number;
}

/**
 * Synthetic job response
 */
export interface SyntheticJobResponse {
  job: SyntheticJob;
  estimatedDuration?: number;
  queuePosition?: number;
}

/**
 * List jobs params
 */
export interface ListSyntheticJobsParams {
  status?: SyntheticJobStatus;
  task?: IsaacLabTask;
  embodiment?: string;
  limit?: number;
  offset?: number;
}

/**
 * Validate sim-to-real request
 */
export interface ValidateSimToRealRequest {
  syntheticJobId: string;
  modelVersionId: string;
  simSuccessRate: number;
  realSuccessRate: number;
  realTestCount: number;
  taskCategories: string[];
  perTaskMetrics?: Record<string, { simSuccess: number; realSuccess: number }>;
  notes?: string;
}

// ============================================================================
// TEMPLATE TYPES
// ============================================================================

/**
 * Domain randomization preset
 */
export interface DRPreset {
  id: string;
  name: string;
  description: string;
  config: DomainRandomizationConfig;
  recommendedFor: IsaacLabTask[];
}

/**
 * Built-in DR presets
 */
export const DR_PRESETS: DRPreset[] = [
  {
    id: 'conservative',
    name: 'Conservative',
    description: 'Minimal randomization for stable sim-to-real transfer',
    config: {
      physics: {
        massRange: [0.8, 1.2],
        frictionRange: [0.9, 1.1],
        dampingRange: [0.95, 1.05],
      },
      visual: {
        lightingVariation: true,
        lightIntensityRange: [0.8, 1.2],
        textureRandomization: false,
        backgroundRandomization: false,
      },
      sensor: {
        cameraNoiseStd: 0.005,
        jointEncoderNoiseStd: 0.0005,
      },
    },
    recommendedFor: ['pick_place', 'push'],
  },
  {
    id: 'moderate',
    name: 'Moderate',
    description: 'Balanced randomization for general use',
    config: DEFAULT_DOMAIN_RANDOMIZATION,
    recommendedFor: ['pick_place', 'stack', 'pour'],
  },
  {
    id: 'aggressive',
    name: 'Aggressive',
    description: 'High randomization for robust generalization',
    config: {
      physics: {
        massRange: [0.3, 3.0],
        frictionRange: [0.3, 2.0],
        dampingRange: [0.5, 1.5],
        gravityRange: [9.5, 10.1],
      },
      visual: {
        lightingVariation: true,
        lightIntensityRange: [0.3, 2.0],
        textureRandomization: true,
        backgroundRandomization: true,
        colorVariation: true,
        hueShiftRange: [-30, 30],
      },
      sensor: {
        cameraNoiseStd: 0.02,
        depthNoiseStd: 0.005,
        jointEncoderNoiseStd: 0.002,
        cameraPositionJitter: true,
        cameraJitterRange: 0.02,
      },
    },
    recommendedFor: ['pick_place', 'push', 'open_drawer'],
  },
];

// ============================================================================
// EVENT TYPES
// ============================================================================

/**
 * Synthetic generation event types
 */
export type SyntheticEventType =
  | 'job:created'
  | 'job:started'
  | 'job:progress'
  | 'job:completed'
  | 'job:failed'
  | 'job:cancelled'
  | 'validation:recorded';

/**
 * Synthetic generation event
 */
export interface SyntheticEvent {
  type: SyntheticEventType;
  jobId: string;
  data?: unknown;
  timestamp: Date;
}
