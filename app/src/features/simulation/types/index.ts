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

export interface SimJob {
  jobId: string;
  modelId: string;
  environment: string;
  rolloutCount: number;
  backend: 'mujoco' | 'isaac';
  status: 'queued' | 'running' | 'completed' | 'failed';
  progress: number;
  metrics?: SimMetrics;
  createdAt: string;
  updatedAt: string;
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
}

export interface SubmitSimJobInput {
  modelId: string;
  environment: string;
  rolloutCount: number;
  backend: 'mujoco' | 'isaac';
}
