/**
 * @file experiment.types.ts
 * @description The experiment loop as the API returns it (TASK-242) — mirrors
 *   `server/src/types/experiment.types.ts`.
 * @feature experiments
 */

import type { ActorType } from '@/features/social';

export type ExperimentStatus = 'proposed' | 'approved' | 'running' | 'completed' | 'cancelled' | 'rejected';

export const EXPERIMENT_STATUSES: readonly ExperimentStatus[] = [
  'proposed',
  'approved',
  'running',
  'completed',
  'cancelled',
  'rejected',
];

export type ArmStatus = 'pending' | 'training' | 'evaluating' | 'scored' | 'failed' | 'cancelled';

export type HyperparameterValue = number | string | boolean;

export interface ExperimentBudget {
  maxArms: number;
  maxGpuHours: number;
  gpuHoursPerArm: number;
}

export interface ExperimentEvaluation {
  environment: string;
  rolloutCount: number;
}

export interface ArmResult {
  successRate: number;
  successCount: number;
  episodeCount: number;
  meanDurationMs: number;
  domainGapScore: number | null;
  evaluationEpisodeIds: string[];
  simJobId: string;
  taskPrompt: string;
}

export interface ArmComparison {
  armId: string;
  name: string;
  successRate: number;
  episodeCount: number;
  delta: number;
  standardError: number;
  zScore: number;
  significant: boolean;
  direction: 'better' | 'worse' | 'within_noise' | 'too_few_episodes';
}

export interface ExperimentVerdict {
  winnerArmId: string | null;
  baselineArmId: string;
  baselineSuccessRate: number | null;
  baselineEpisodeCount: number;
  deltas: ArmComparison[];
  criticalZ: number;
  confidenceNote: string;
  failedArmIds: string[];
  concludedAt: string;
}

export interface ExperimentArm {
  id: string;
  experimentId: string;
  name: string;
  label: string | null;
  isBaseline: boolean;
  datasetRefs: Array<{ datasetId: string; weight?: number }>;
  initFromModelVersionId: string | null;
  hyperparameters: Record<string, HyperparameterValue>;
  trainingJobId: string | null;
  modelVersionId: string | null;
  simJobId: string | null;
  status: ArmStatus;
  failureReason: string | null;
  result: ArmResult | null;
  /** How this arm differs from the baseline, in words; empty for the baseline. */
  varies: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Experiment {
  id: string;
  title: string;
  hypothesis: string;
  status: ExperimentStatus;
  actorType: ActorType;
  actorId: string;
  displayName: string;
  baseModel: string;
  fineTuneMethod: string;
  approvedBy: string | null;
  approvedAt: string | null;
  rejectedReason: string | null;
  budget: ExperimentBudget;
  evaluation: ExperimentEvaluation;
  baselineArmId: string | null;
  verdict: ExperimentVerdict | null;
  arms: ExperimentArm[];
  createdAt: string;
  updatedAt: string;
}
