/**
 * @file experiment.types.ts
 * @description The experiment loop (TASK-242): one hypothesis, several arms,
 *   each a (dataset view × hyperparameters × starting model) that trains,
 *   evaluates in sim and gets rated. An agent proposes, a human approves.
 * @feature training
 */

import type { Actor } from './social.types.js';
import type { MixtureMemberInput } from './mixture.types.js';

export type ExperimentStatus =
  | 'proposed'
  | 'approved'
  | 'running'
  | 'completed'
  | 'cancelled'
  | 'rejected';

export const EXPERIMENT_STATUSES: readonly ExperimentStatus[] = [
  'proposed',
  'approved',
  'running',
  'completed',
  'cancelled',
  'rejected',
];

export type ArmStatus = 'pending' | 'training' | 'evaluating' | 'scored' | 'failed' | 'cancelled';

/** The spend a human approves. */
export interface ExperimentBudget {
  /** Most arms this experiment may run (baseline included). */
  maxArms: number;
  /** Ceiling on the whole experiment's GPU time. */
  maxGpuHours: number;
  /** The proposer's estimate per arm — arms × this must fit maxGpuHours. */
  gpuHoursPerArm: number;
}

/** How every arm's model is evaluated: one sim environment, one rollout count. */
export interface ExperimentEvaluation {
  /** A SimulationService environment id, e.g. 'g1_apple_pnp'. Picks the VLA_EVAL_PROFILES profile. */
  environment: string;
  rolloutCount: number;
}

export type HyperparameterValue = number | string | boolean;

export interface ArmInput {
  name: string;
  /** What this arm varies, one phrase. Derived from the diff when omitted. */
  label?: string | null;
  /** Exactly one arm is the baseline; the first arm when none is flagged. */
  isBaseline?: boolean;
  datasetRefs: MixtureMemberInput[];
  initFromModelVersionId?: string | null;
  hyperparameters?: Record<string, HyperparameterValue>;
}

export interface ProposeExperimentInput {
  title: string;
  hypothesis: string;
  baseModel: string;
  fineTuneMethod: string;
  budget?: Partial<ExperimentBudget>;
  evaluation: ExperimentEvaluation;
  arms: ArmInput[];
}

/** What a scored arm measured. Every number carries the count behind it. */
export interface ArmResult {
  successRate: number;
  successCount: number;
  episodeCount: number;
  meanDurationMs: number;
  /** sim − real success rate, when a SimToRealValidation exists for the model. */
  domainGapScore: number | null;
  evaluationEpisodeIds: string[];
  simJobId: string;
  taskPrompt: string;
}

/** One arm against the baseline, with the arithmetic that judged it. */
export interface ArmComparison {
  armId: string;
  name: string;
  successRate: number;
  episodeCount: number;
  /** arm − baseline success rate. */
  delta: number;
  /** Pooled two-proportion standard error of the delta. */
  standardError: number;
  /** delta / standardError; 0 when the error is 0. */
  zScore: number;
  /** |z| beyond the critical value for this many comparisons. */
  significant: boolean;
  direction: 'better' | 'worse' | 'within_noise' | 'too_few_episodes';
}

export interface ExperimentVerdict {
  /** null when no arm is distinguishable from the baseline — and the note says so. */
  winnerArmId: string | null;
  baselineArmId: string;
  baselineSuccessRate: number | null;
  baselineEpisodeCount: number;
  deltas: ArmComparison[];
  /** Bonferroni-adjusted two-sided critical z used for every comparison. */
  criticalZ: number;
  confidenceNote: string;
  failedArmIds: string[];
  concludedAt: string;
}

export interface ExperimentArmDTO {
  id: string;
  experimentId: string;
  name: string;
  label: string | null;
  isBaseline: boolean;
  datasetRefs: MixtureMemberInput[];
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

export interface ExperimentDTO extends Actor {
  id: string;
  title: string;
  hypothesis: string;
  status: ExperimentStatus;
  baseModel: string;
  fineTuneMethod: string;
  approvedBy: string | null;
  approvedAt: string | null;
  rejectedReason: string | null;
  budget: ExperimentBudget;
  evaluation: ExperimentEvaluation;
  baselineArmId: string | null;
  verdict: ExperimentVerdict | null;
  arms: ExperimentArmDTO[];
  createdAt: string;
  updatedAt: string;
}
