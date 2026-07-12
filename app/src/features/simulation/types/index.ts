/**
 * @file index.ts
 * @description Type definitions for simulation feature
 * @feature simulation
 */

// ============================================================================
// SIMULATION TYPES
// ============================================================================

export interface SimMetrics {
  successRate: number;
  avgStepsToCompletion: number;
  collisionCount: number;
  avgEpisodeDuration: number;
  simToRealGap?: number;
}

export interface SimFrame {
  episode: number;
  step: number;
  file: string;
}

/**
 * Backend honesty flag (TASK-184): 'mock' = results fabricated by a mock
 * backend, 'real' = a real simulator run. Optional — old servers omit it.
 */
export type SimBackendMode = 'mock' | 'real';

export interface SimJob {
  jobId: string;
  modelId: string;
  environment: string;
  rolloutCount: number;
  /**
   * Physics backend. Servers with TASK-184 backend honesty may also report
   * 'mock' / 'real' here — prefer `getSimBackendMode()` to read the flag.
   */
  backend: 'mujoco' | 'isaac' | SimBackendMode;
  /** Backend honesty flag (TASK-184) when reported as a dedicated field. */
  backendMode?: SimBackendMode;
  status: 'queued' | 'running' | 'completed' | 'failed';
  progress: number;
  /** Human-readable reason a job ended in `failed` (evaluator stderr tail). */
  failureReason?: string;
  metrics?: SimMetrics;
  frames?: SimFrame[];
  createdAt: string;
  updatedAt: string;
  /** Set when the job was launched from a registry scene. */
  sceneId?: string;
  /** Embodiment resolved server-side from the scene (e.g. 'g1', 'so101'). */
  embodiment?: string;
}

/**
 * Resolve a job's backend honesty flag, tolerating both server shapes:
 * a dedicated `backendMode` field or `backend` itself set to 'mock'/'real'.
 * Returns undefined for old servers that don't report the flag.
 */
export function getSimBackendMode(job: SimJob): SimBackendMode | undefined {
  if (job.backendMode === 'mock' || job.backendMode === 'real') return job.backendMode;
  if (job.backend === 'mock' || job.backend === 'real') return job.backend;
  return undefined;
}

// ============================================================================
// SIM SCENES (registry — built-in environments + twin-derived rooms)
// ============================================================================

export interface SimSceneBounds {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

export interface SimScene {
  id: string;
  name: string;
  description: string | null;
  source: 'builtin' | 'twin';
  builtinEnvId: string | null;
  twinId: string | null;
  embodimentTag: string;
  backend: 'mujoco' | 'isaac';
  mjcfKey: string | null;
  usdKey: string | null;
  status: string;
  bounds: SimSceneBounds;
  tenantId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SimToRealValidation {
  id: string;
  modelVersionId: string;
  twinId: string | null;
  simSceneId: string | null;
  embodimentTag: string | null;
  validationDate: string;
  simSuccessRate: number;
  realSuccessRate: number;
  domainGapScore: number;
  realTestCount: number;
  taskCategories: string[];
  notes: string | null;
}

export interface SimEnvironment {
  id: string;
  name: string;
  description: string;
  backend: 'mujoco' | 'isaac';
  imageUrl?: string;
}

export interface SimToRealComparison {
  modelId: string;
  simSuccessRate: number;
  realSuccessRate: number;
  gap: number;
  twinId?: string | null;
  simSceneId?: string | null;
  validationDate?: string;
  realTestCount?: number;
}

export interface SubmitSimJobInput {
  modelId: string;
  rolloutCount: number;
  /** Preferred: backend + embodiment resolved server-side from the scene. */
  sceneId?: string;
  /** Legacy: explicit environment id (when not submitting via a registry scene). */
  environment?: string;
  /** Legacy: explicit backend (when not submitting via a registry scene). */
  backend?: 'mujoco' | 'isaac';
}

/** Body for POST /api/simulation/validations. */
export interface CreateSimValidationInput {
  modelVersionId: string;
  simSuccessRate: number;
  modelVersion?: string;
  twinId?: string;
  simSceneId?: string;
  embodimentTag?: string;
  realSuccessRate?: number;
  /** Real episode sample size behind an explicit realSuccessRate. */
  realTestCount?: number;
  realRobotId?: string;
  period?: string;
  taskCategories?: string[];
  notes?: string;
}
