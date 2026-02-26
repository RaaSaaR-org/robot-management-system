/**
 * @file uncertainty.types.ts
 * @description Types for ensemble uncertainty estimation and active learning prioritization.
 * @feature Active Learning
 */

/** An episode with multi-model predictions for uncertainty estimation */
export interface UncertaintyEpisode {
  episodeId: string;
  predictions: number[][]; // [modelIndex][actionDim]
  metadata?: Record<string, unknown>;
}

/** A ranked episode with uncertainty scores for active learning prioritization */
export interface RankedEpisode {
  episodeId: string;
  jsd: number;
  epistemic: number;
  aleatoric: number;
  score: number;
  rank: number;
}

/** MC Dropout inference result with mean, variance, and scalar uncertainty */
export interface MCDropoutResult {
  mean: number[];
  variance: number[];
  uncertainty: number; // scalar summary
}
