/**
 * @file EnsembleUncertainty.ts
 * @description Multi-model ensemble disagreement and MC Dropout uncertainty estimation.
 * @feature Active Learning
 */

import type { UncertaintyEpisode, RankedEpisode, MCDropoutResult } from '../types/uncertainty.types.js';

/**
 * Ensemble uncertainty estimation for active learning prioritization.
 * Computes Jensen-Shannon Divergence, epistemic/aleatoric uncertainty,
 * and MC Dropout statistics to rank episodes by informativeness.
 */
export class EnsembleUncertainty {
  /**
   * Kullback-Leibler Divergence: KL(P || Q) = sum_i P(i) * log(P(i) / Q(i))
   * Assumes P and Q are valid probability distributions (non-negative, sum to ~1).
   * Uses a small epsilon to avoid log(0).
   */
  computeKLD(p: number[], q: number[]): number {
    if (p.length === 0 || q.length === 0) {
      return 0;
    }
    if (p.length !== q.length) {
      throw new Error(`KLD: distribution lengths must match (got ${p.length} and ${q.length})`);
    }

    const eps = 1e-12;
    let kld = 0;
    for (let i = 0; i < p.length; i++) {
      const pi = Math.max(p[i], eps);
      const qi = Math.max(q[i], eps);
      kld += pi * Math.log(pi / qi);
    }
    return Math.max(0, kld);
  }

  /**
   * Jensen-Shannon Divergence between multiple model predictions.
   * Generalized JSD: JSD(P1, ..., Pn) = H(M) - (1/n) * sum_i H(Pi)
   * where M = (1/n) * sum_i Pi and H is Shannon entropy.
   * Normalized to [0, 1] by dividing by log(n).
   */
  computeJSD(predictions: number[][]): number {
    if (predictions.length <= 1) {
      return 0;
    }

    const n = predictions.length;
    const dim = predictions[0].length;
    if (dim === 0) {
      return 0;
    }

    // For 2 distributions, use the classic formula: JSD = (KL(P||M) + KL(Q||M)) / 2
    if (n === 2) {
      const m = new Array<number>(dim);
      for (let i = 0; i < dim; i++) {
        m[i] = (predictions[0][i] + predictions[1][i]) / 2;
      }
      return (this.computeKLD(predictions[0], m) + this.computeKLD(predictions[1], m)) / 2;
    }

    // Generalized JSD for n distributions
    const eps = 1e-12;

    // Compute mixture M = (1/n) * sum Pi
    const m = new Array<number>(dim).fill(0);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < dim; i++) {
        m[i] += predictions[j][i];
      }
    }
    for (let i = 0; i < dim; i++) {
      m[i] /= n;
    }

    // H(M) - Shannon entropy of mixture
    let hM = 0;
    for (let i = 0; i < dim; i++) {
      const mi = Math.max(m[i], eps);
      hM -= mi * Math.log(mi);
    }

    // (1/n) * sum H(Pi) - average entropy
    let avgH = 0;
    for (let j = 0; j < n; j++) {
      let hPj = 0;
      for (let i = 0; i < dim; i++) {
        const pi = Math.max(predictions[j][i], eps);
        hPj -= pi * Math.log(pi);
      }
      avgH += hPj;
    }
    avgH /= n;

    const jsd = hM - avgH;
    // Normalize by log(n) to get [0, 1]
    const maxJsd = Math.log(n);
    return Math.max(0, Math.min(1, jsd / maxJsd));
  }

  /**
   * Epistemic uncertainty via ensemble variance.
   * Computes the mean variance across all action dimensions:
   * epistemic = mean_i(var_j(predictions[j][i]))
   */
  computeEpistemicUncertainty(predictions: number[][]): number {
    if (predictions.length <= 1) {
      return 0;
    }

    const n = predictions.length;
    const dim = predictions[0].length;
    if (dim === 0) {
      return 0;
    }

    let totalVariance = 0;
    for (let i = 0; i < dim; i++) {
      // Compute mean for dimension i
      let mean = 0;
      for (let j = 0; j < n; j++) {
        mean += predictions[j][i];
      }
      mean /= n;

      // Compute variance for dimension i
      let variance = 0;
      for (let j = 0; j < n; j++) {
        const diff = predictions[j][i] - mean;
        variance += diff * diff;
      }
      variance /= n;
      totalVariance += variance;
    }

    return totalVariance / dim;
  }

  /**
   * Aleatoric uncertainty: variance of the prediction means.
   * aleatoric = var(mean(predictions))
   * Computes the mean prediction across models, then the variance of those means.
   */
  computeAleatoricUncertainty(predictions: number[][]): number {
    if (predictions.length <= 1) {
      return 0;
    }

    const n = predictions.length;
    const dim = predictions[0].length;
    if (dim === 0) {
      return 0;
    }

    // Compute mean prediction per model: mean_j = mean_i(predictions[j][i])
    const modelMeans: number[] = [];
    for (let j = 0; j < n; j++) {
      let sum = 0;
      for (let i = 0; i < dim; i++) {
        sum += predictions[j][i];
      }
      modelMeans.push(sum / dim);
    }

    // Compute variance of model means
    let grandMean = 0;
    for (let j = 0; j < n; j++) {
      grandMean += modelMeans[j];
    }
    grandMean /= n;

    let variance = 0;
    for (let j = 0; j < n; j++) {
      const diff = modelMeans[j] - grandMean;
      variance += diff * diff;
    }
    variance /= n;

    return variance;
  }

  /**
   * MC Dropout result: computes mean, variance per dimension, and scalar uncertainty.
   * Each row in predictions is one forward pass with dropout enabled.
   */
  computeMCDropout(predictions: number[][]): MCDropoutResult {
    if (predictions.length === 0) {
      return { mean: [], variance: [], uncertainty: 0 };
    }

    const n = predictions.length;
    const dim = predictions[0].length;

    if (dim === 0) {
      return { mean: [], variance: [], uncertainty: 0 };
    }

    const mean = new Array<number>(dim).fill(0);
    const variance = new Array<number>(dim).fill(0);

    // Compute mean per dimension
    for (let i = 0; i < dim; i++) {
      for (let j = 0; j < n; j++) {
        mean[i] += predictions[j][i];
      }
      mean[i] /= n;
    }

    // Compute variance per dimension
    for (let i = 0; i < dim; i++) {
      for (let j = 0; j < n; j++) {
        const diff = predictions[j][i] - mean[i];
        variance[i] += diff * diff;
      }
      variance[i] /= n;
    }

    // Scalar uncertainty = mean of variances
    let uncertainty = 0;
    for (let i = 0; i < dim; i++) {
      uncertainty += variance[i];
    }
    uncertainty /= dim;

    return { mean, variance, uncertainty };
  }

  /**
   * Rank episodes by uncertainty for active learning prioritization.
   * Score = 0.6 * JSD + 0.4 * epistemic. Higher scores = more informative.
   * Episodes are sorted descending by score (highest uncertainty first).
   */
  rankEpisodes(episodes: UncertaintyEpisode[]): RankedEpisode[] {
    const scored = episodes.map((ep) => {
      const jsd = this.computeJSD(ep.predictions);
      const epistemic = this.computeEpistemicUncertainty(ep.predictions);
      const aleatoric = this.computeAleatoricUncertainty(ep.predictions);
      const score = 0.6 * jsd + 0.4 * epistemic;

      return {
        episodeId: ep.episodeId,
        jsd,
        epistemic,
        aleatoric,
        score,
        rank: 0,
      };
    });

    // Sort descending by score
    scored.sort((a, b) => b.score - a.score);

    // Assign ranks (1-based)
    for (let i = 0; i < scored.length; i++) {
      scored[i].rank = i + 1;
    }

    return scored;
  }
}

/** Singleton instance */
export const ensembleUncertainty = new EnsembleUncertainty();
