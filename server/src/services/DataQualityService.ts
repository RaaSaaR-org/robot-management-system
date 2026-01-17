/**
 * @file DataQualityService.ts
 * @description Advanced data quality validation pipeline for VLA training datasets
 * @feature datasets
 */

import { EventEmitter } from 'events';
import type {
  TrajectoryMetrics,
  SmoothnessMetrics,
  ConsistencyMetrics,
  AnomalyDetectionResult,
  AnomalyType,
  VelocitySpike,
  DatasetQualityReport,
  QualityScoreBreakdown,
  MetricsStatistics,
  DatasetMetricsStats,
  DTWResult,
  OODDetectionResult,
  AdvancedValidationConfig,
  ValidationJobStatus,
  FlaggedTrajectorySummary,
  QualityWeights,
} from '../types/data-quality.types.js';
import {
  DEFAULT_VALIDATION_CONFIG,
  DEFAULT_QUALITY_WEIGHTS,
} from '../types/data-quality.types.js';

// ============================================================================
// TYPES FOR TRAJECTORY DATA
// ============================================================================

interface JointState {
  positions: number[];
  velocities?: number[];
  timestamps: number[];
}

interface TrajectoryData {
  jointStates: JointState;
  actions?: number[][];
  episodeId?: string;
}

// ============================================================================
// DATA QUALITY SERVICE
// ============================================================================

/**
 * Service for advanced data quality validation
 */
export class DataQualityService extends EventEmitter {
  private static instance: DataQualityService;
  private weights: QualityWeights;

  private constructor() {
    super();
    this.weights = { ...DEFAULT_QUALITY_WEIGHTS };
  }

  /**
   * Get singleton instance
   */
  static getInstance(): DataQualityService {
    if (!DataQualityService.instance) {
      DataQualityService.instance = new DataQualityService();
    }
    return DataQualityService.instance;
  }

  /**
   * Set quality scoring weights
   */
  setWeights(weights: Partial<QualityWeights>): void {
    this.weights = { ...this.weights, ...weights };
  }

  // ============================================================================
  // SMOOTHNESS METRICS
  // ============================================================================

  /**
   * Compute RMS jerk for a trajectory (third derivative of position)
   * Lower values indicate smoother motion
   */
  computeRMSJerk(positions: number[][], dt: number): number {
    if (positions.length < 4) {
      return 0; // Need at least 4 points for jerk
    }

    const jerks: number[] = [];

    for (let i = 2; i < positions.length - 1; i++) {
      // Compute acceleration at i-1 and i
      const acc_prev: number[] = [];
      const acc_curr: number[] = [];

      for (let j = 0; j < positions[i].length; j++) {
        const v1 = (positions[i - 1][j] - positions[i - 2][j]) / dt;
        const v2 = (positions[i][j] - positions[i - 1][j]) / dt;
        const v3 = (positions[i + 1][j] - positions[i][j]) / dt;

        acc_prev.push((v2 - v1) / dt);
        acc_curr.push((v3 - v2) / dt);
      }

      // Jerk is derivative of acceleration
      let jerkMag = 0;
      for (let j = 0; j < acc_prev.length; j++) {
        const jerk = (acc_curr[j] - acc_prev[j]) / dt;
        jerkMag += jerk * jerk;
      }
      jerks.push(Math.sqrt(jerkMag));
    }

    // RMS jerk
    const sumSquared = jerks.reduce((sum, j) => sum + j * j, 0);
    return Math.sqrt(sumSquared / jerks.length);
  }

  /**
   * Compute Logarithmic Dimensionless Jerk (LDLJ)
   * Normalized, noise-resistant smoothness metric
   * More negative values indicate smoother motion
   */
  computeLDLJ(positions: number[][], timestamps: number[]): number {
    if (positions.length < 4) {
      return 0;
    }

    const duration = timestamps[timestamps.length - 1] - timestamps[0];
    if (duration === 0) {
      return 0;
    }

    // Compute path length
    let pathLength = 0;
    for (let i = 1; i < positions.length; i++) {
      let dist = 0;
      for (let j = 0; j < positions[i].length; j++) {
        const d = positions[i][j] - positions[i - 1][j];
        dist += d * d;
      }
      pathLength += Math.sqrt(dist);
    }

    if (pathLength === 0) {
      return 0;
    }

    // Compute jerk squared integral
    const dt = duration / (positions.length - 1);
    let jerkIntegral = 0;

    for (let i = 2; i < positions.length - 1; i++) {
      let jerkSquared = 0;
      for (let j = 0; j < positions[i].length; j++) {
        // Central difference for velocity
        const v1 = (positions[i - 1][j] - positions[i - 2][j]) / dt;
        const v2 = (positions[i][j] - positions[i - 1][j]) / dt;
        const v3 = (positions[i + 1][j] - positions[i][j]) / dt;

        // Central difference for acceleration
        const a1 = (v2 - v1) / dt;
        const a2 = (v3 - v2) / dt;

        // Jerk
        const jerk = (a2 - a1) / dt;
        jerkSquared += jerk * jerk;
      }
      jerkIntegral += jerkSquared * dt;
    }

    // LDLJ formula: -ln((duration^5 / pathLength^2) * jerkIntegral)
    const normalizedJerk =
      (Math.pow(duration, 5) / Math.pow(pathLength, 2)) * jerkIntegral;

    return normalizedJerk > 0 ? -Math.log(normalizedJerk) : 0;
  }

  /**
   * Compute position instability (variation in position changes)
   */
  computePositionInstability(positions: number[][]): number {
    if (positions.length < 2) {
      return 0;
    }

    const deltas: number[] = [];
    for (let i = 1; i < positions.length; i++) {
      let dist = 0;
      for (let j = 0; j < positions[i].length; j++) {
        const d = positions[i][j] - positions[i - 1][j];
        dist += d * d;
      }
      deltas.push(Math.sqrt(dist));
    }

    // Compute variance of deltas
    const mean = deltas.reduce((a, b) => a + b, 0) / deltas.length;
    const variance =
      deltas.reduce((sum, d) => sum + Math.pow(d - mean, 2), 0) / deltas.length;

    return Math.sqrt(variance);
  }

  /**
   * Compute maximum acceleration
   */
  computeMaxAcceleration(positions: number[][], dt: number): number {
    if (positions.length < 3) {
      return 0;
    }

    let maxAcc = 0;
    for (let i = 1; i < positions.length - 1; i++) {
      let accMag = 0;
      for (let j = 0; j < positions[i].length; j++) {
        const v1 = (positions[i][j] - positions[i - 1][j]) / dt;
        const v2 = (positions[i + 1][j] - positions[i][j]) / dt;
        const acc = (v2 - v1) / dt;
        accMag += acc * acc;
      }
      maxAcc = Math.max(maxAcc, Math.sqrt(accMag));
    }

    return maxAcc;
  }

  /**
   * Compute all smoothness metrics for a trajectory
   */
  computeSmoothnessMetrics(
    positions: number[][],
    timestamps: number[]
  ): SmoothnessMetrics {
    const dt =
      timestamps.length > 1
        ? (timestamps[timestamps.length - 1] - timestamps[0]) /
          (timestamps.length - 1)
        : 0.033; // default 30Hz

    return {
      rmsJerk: this.computeRMSJerk(positions, dt),
      ldlj: this.computeLDLJ(positions, timestamps),
      positionInstability: this.computePositionInstability(positions),
      maxAcceleration: this.computeMaxAcceleration(positions, dt),
    };
  }

  // ============================================================================
  // CONSISTENCY METRICS
  // ============================================================================

  /**
   * Compute path length of trajectory
   */
  computePathLength(positions: number[][]): number {
    if (positions.length < 2) {
      return 0;
    }

    let length = 0;
    for (let i = 1; i < positions.length; i++) {
      let dist = 0;
      for (let j = 0; j < positions[i].length; j++) {
        const d = positions[i][j] - positions[i - 1][j];
        dist += d * d;
      }
      length += Math.sqrt(dist);
    }

    return length;
  }

  /**
   * Compute effort metric (integrated squared velocity as proxy for torque)
   */
  computeEffort(positions: number[][], dt: number): number {
    if (positions.length < 2) {
      return 0;
    }

    let effort = 0;
    for (let i = 1; i < positions.length; i++) {
      let velSquared = 0;
      for (let j = 0; j < positions[i].length; j++) {
        const v = (positions[i][j] - positions[i - 1][j]) / dt;
        velSquared += v * v;
      }
      effort += velSquared * dt;
    }

    return effort;
  }

  /**
   * Compute consistency metrics for a trajectory
   */
  computeConsistencyMetrics(
    positions: number[][],
    timestamps: number[]
  ): ConsistencyMetrics {
    const duration =
      timestamps.length > 1
        ? timestamps[timestamps.length - 1] - timestamps[0]
        : 0;
    const dt = timestamps.length > 1 ? duration / (timestamps.length - 1) : 0.033;

    return {
      pathLength: this.computePathLength(positions),
      effort: this.computeEffort(positions, dt),
      duration,
    };
  }

  /**
   * Compute path length variance across multiple demonstrations
   */
  computePathLengthVariance(trajectories: number[][][]): number {
    if (trajectories.length < 2) {
      return 0;
    }

    const lengths = trajectories.map((t) => this.computePathLength(t));
    const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
    const variance =
      lengths.reduce((sum, l) => sum + Math.pow(l - mean, 2), 0) / lengths.length;

    return variance;
  }

  // ============================================================================
  // DYNAMIC TIME WARPING (DTW)
  // ============================================================================

  /**
   * Compute DTW distance between two trajectories
   */
  computeDTWDistance(traj1: number[][], traj2: number[][]): DTWResult {
    const n = traj1.length;
    const m = traj2.length;

    if (n === 0 || m === 0) {
      return { distance: 0, normalizedDistance: 0 };
    }

    // Initialize DTW matrix
    const dtw: number[][] = Array(n + 1)
      .fill(null)
      .map(() => Array(m + 1).fill(Infinity));
    dtw[0][0] = 0;

    // Euclidean distance between points
    const dist = (p1: number[], p2: number[]): number => {
      let sum = 0;
      for (let i = 0; i < Math.min(p1.length, p2.length); i++) {
        sum += Math.pow(p1[i] - p2[i], 2);
      }
      return Math.sqrt(sum);
    };

    // Fill DTW matrix
    for (let i = 1; i <= n; i++) {
      for (let j = 1; j <= m; j++) {
        const cost = dist(traj1[i - 1], traj2[j - 1]);
        dtw[i][j] =
          cost + Math.min(dtw[i - 1][j], dtw[i][j - 1], dtw[i - 1][j - 1]);
      }
    }

    const distance = dtw[n][m];
    const pathLength = n + m; // Approximate path length

    return {
      distance,
      normalizedDistance: distance / pathLength,
    };
  }

  // ============================================================================
  // ANOMALY DETECTION
  // ============================================================================

  /**
   * Detect statistical outliers using Z-score
   */
  detectStatisticalOutliers(
    values: number[],
    threshold: number = 3.0
  ): { indices: number[]; zScores: number[] } {
    if (values.length < 2) {
      return { indices: [], zScores: [] };
    }

    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const std = Math.sqrt(
      values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length
    );

    if (std === 0) {
      return { indices: [], zScores: values.map(() => 0) };
    }

    const zScores = values.map((v) => Math.abs((v - mean) / std));
    const indices = zScores
      .map((z, i) => (z > threshold ? i : -1))
      .filter((i) => i >= 0);

    return { indices, zScores };
  }

  /**
   * Detect velocity spikes in trajectory
   */
  detectVelocitySpikes(
    positions: number[][],
    dt: number,
    threshold: number = 5.0
  ): VelocitySpike[] {
    const spikes: VelocitySpike[] = [];

    for (let i = 1; i < positions.length; i++) {
      for (let j = 0; j < positions[i].length; j++) {
        const velocity = Math.abs((positions[i][j] - positions[i - 1][j]) / dt);
        if (velocity > threshold) {
          spikes.push({
            index: i,
            joint: j,
            magnitude: velocity,
            isAnomaly: true,
          });
        }
      }
    }

    return spikes;
  }

  /**
   * Check if trajectory violates envelope bounds
   */
  checkEnvelopeViolation(
    positions: number[][],
    bounds: { min: number[]; max: number[] }
  ): { violated: boolean; violationIndices: number[] } {
    const violationIndices: number[] = [];

    for (let i = 0; i < positions.length; i++) {
      for (let j = 0; j < positions[i].length; j++) {
        if (
          j < bounds.min.length &&
          j < bounds.max.length &&
          (positions[i][j] < bounds.min[j] || positions[i][j] > bounds.max[j])
        ) {
          violationIndices.push(i);
          break;
        }
      }
    }

    return {
      violated: violationIndices.length > 0,
      violationIndices,
    };
  }

  /**
   * Detect stuck joints (no movement over time)
   */
  detectStuckJoints(
    positions: number[][],
    windowSize: number = 10,
    threshold: number = 0.001
  ): number[] {
    if (positions.length < windowSize) {
      return [];
    }

    const stuckJoints: Set<number> = new Set();
    const numJoints = positions[0]?.length || 0;

    for (let j = 0; j < numJoints; j++) {
      let stuckCount = 0;
      for (let i = windowSize; i < positions.length; i++) {
        let movement = 0;
        for (let k = i - windowSize; k < i; k++) {
          movement += Math.abs(positions[k + 1][j] - positions[k][j]);
        }
        if (movement < threshold) {
          stuckCount++;
        }
      }
      // If stuck for more than 50% of trajectory, flag as stuck
      if (stuckCount > (positions.length - windowSize) / 2) {
        stuckJoints.add(j);
      }
    }

    return Array.from(stuckJoints);
  }

  /**
   * Run full anomaly detection on a trajectory
   */
  detectAnomalies(
    positions: number[][],
    timestamps: number[],
    config: AdvancedValidationConfig
  ): AnomalyDetectionResult {
    const dt =
      timestamps.length > 1
        ? (timestamps[timestamps.length - 1] - timestamps[0]) /
          (timestamps.length - 1)
        : 0.033;

    const anomalyTypes: AnomalyType[] = [];
    const anomalyIndices: Set<number> = new Set();

    // Compute velocities for analysis
    const velocities: number[] = [];
    for (let i = 1; i < positions.length; i++) {
      let velMag = 0;
      for (let j = 0; j < positions[i].length; j++) {
        const v = (positions[i][j] - positions[i - 1][j]) / dt;
        velMag += v * v;
      }
      velocities.push(Math.sqrt(velMag));
    }

    // Statistical outliers
    const outlierResult = this.detectStatisticalOutliers(
      velocities,
      config.anomalyZScoreThreshold
    );
    if (outlierResult.indices.length > 0) {
      anomalyTypes.push('statistical_outlier');
      outlierResult.indices.forEach((i) => anomalyIndices.add(i));
    }

    // Velocity spikes
    const velocitySpikes = this.detectVelocitySpikes(
      positions,
      dt,
      config.velocitySpikeThreshold
    );
    if (velocitySpikes.some((s) => s.isAnomaly)) {
      anomalyTypes.push('velocity_spike');
      velocitySpikes.filter((s) => s.isAnomaly).forEach((s) => anomalyIndices.add(s.index));
    }

    // Stuck joints
    const stuckJoints = this.detectStuckJoints(positions);
    if (stuckJoints.length > 0) {
      anomalyTypes.push('stuck_joint');
    }

    return {
      hasAnomalies: anomalyTypes.length > 0,
      anomalyTypes,
      anomalyIndices: Array.from(anomalyIndices).sort((a, b) => a - b),
      zScores: outlierResult.zScores,
      envelopeViolation: false, // Would need bounds to check
      velocitySpikes,
    };
  }

  // ============================================================================
  // OOD DETECTION (Placeholder for ML Model)
  // ============================================================================

  /**
   * OOD detection placeholder - returns mock result
   * In production, this would call a cVAE or similar model
   */
  detectOOD(observation: number[], threshold: number = 0.5): OODDetectionResult {
    // Placeholder: Use simple heuristic based on value ranges
    const maxVal = Math.max(...observation.map(Math.abs));
    const reconstructionError = maxVal > 10 ? 0.8 : 0.2; // Mock

    return {
      isOOD: reconstructionError > threshold,
      reconstructionError,
      threshold,
      confidence: Math.abs(reconstructionError - threshold) / threshold,
    };
  }

  // ============================================================================
  // TRAJECTORY QUALITY SCORING
  // ============================================================================

  /**
   * Compute quality score for a single trajectory
   */
  computeTrajectoryQualityScore(
    metrics: { smoothness: SmoothnessMetrics; consistency: ConsistencyMetrics },
    anomalies: AnomalyDetectionResult
  ): number {
    // Smoothness score (lower jerk = better)
    // Normalize: assume good jerk is < 100, bad is > 1000
    const jerkScore = Math.max(0, 100 - (metrics.smoothness.rmsJerk / 10));
    const smoothnessScore = Math.min(this.weights.smoothness, jerkScore * (this.weights.smoothness / 100));

    // Consistency score (based on path length and effort reasonableness)
    // Just use a fraction of the weight for now
    const consistencyScore = this.weights.consistency * 0.8; // Placeholder

    // Anomaly score
    const anomalyPenalty = anomalies.hasAnomalies
      ? this.weights.anomalyFree * (1 - anomalies.anomalyIndices.length / 100)
      : this.weights.anomalyFree;
    const anomalyScore = Math.max(0, anomalyPenalty);

    // Completeness (based on duration, assume > 1 second is complete)
    const completenessScore =
      metrics.consistency.duration > 1 ? this.weights.completeness : this.weights.completeness * 0.5;

    return Math.round(smoothnessScore + consistencyScore + anomalyScore + completenessScore);
  }

  /**
   * Compute full metrics for a trajectory
   */
  computeTrajectoryMetrics(
    trajectory: TrajectoryData,
    index: number,
    config: AdvancedValidationConfig
  ): TrajectoryMetrics {
    const { jointStates, episodeId } = trajectory;
    const positions = this.extractPositions(jointStates);
    const timestamps = jointStates.timestamps;

    const smoothness = this.computeSmoothnessMetrics(positions, timestamps);
    const consistency = this.computeConsistencyMetrics(positions, timestamps);
    const anomalies = this.detectAnomalies(positions, timestamps, config);

    const qualityScore = this.computeTrajectoryQualityScore(
      { smoothness, consistency },
      anomalies
    );

    // Flag if quality is low or anomalies detected
    const flagged = qualityScore < 50 || anomalies.hasAnomalies;
    let flagReason: string | undefined;
    if (flagged) {
      const reasons: string[] = [];
      if (qualityScore < 50) reasons.push(`Low quality score: ${qualityScore}`);
      if (anomalies.hasAnomalies) reasons.push(`Anomalies: ${anomalies.anomalyTypes.join(', ')}`);
      flagReason = reasons.join('; ');
    }

    return {
      trajectoryIndex: index,
      episodeId,
      smoothness,
      consistency,
      anomalies,
      qualityScore,
      flagged,
      flagReason,
      computedAt: new Date(),
    };
  }

  /**
   * Extract positions array from joint states
   */
  private extractPositions(jointStates: JointState): number[][] {
    // If positions is already a 2D array in the expected format
    // Otherwise, need to restructure
    if (Array.isArray(jointStates.positions[0])) {
      return jointStates.positions as unknown as number[][];
    }

    // Single array - wrap each timestamp
    return jointStates.timestamps.map((_, i) => {
      // Assume positions are flat and need to be reshaped
      // This is a placeholder - actual implementation depends on data format
      return [jointStates.positions[i] ?? 0];
    });
  }

  // ============================================================================
  // DATASET-LEVEL QUALITY REPORT
  // ============================================================================

  /**
   * Compute statistics for a set of values
   */
  computeStatistics(values: number[]): MetricsStatistics {
    if (values.length === 0) {
      return { mean: 0, std: 0, min: 0, max: 0, median: 0, p25: 0, p75: 0 };
    }

    const sorted = [...values].sort((a, b) => a - b);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const std = Math.sqrt(
      values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length
    );

    return {
      mean,
      std,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      median: sorted[Math.floor(sorted.length / 2)],
      p25: sorted[Math.floor(sorted.length * 0.25)],
      p75: sorted[Math.floor(sorted.length * 0.75)],
    };
  }

  /**
   * Generate quality report for a dataset
   */
  generateQualityReport(
    datasetId: string,
    datasetName: string,
    trajectoryMetrics: TrajectoryMetrics[]
  ): DatasetQualityReport {
    const trajectoryCount = trajectoryMetrics.length;
    const flaggedMetrics = trajectoryMetrics.filter((m) => m.flagged);
    const anomalousMetrics = trajectoryMetrics.filter((m) => m.anomalies.hasAnomalies);

    // Compute score breakdown
    const scores = trajectoryMetrics.map((m) => m.qualityScore);
    const smoothnessScores = trajectoryMetrics.map(
      (m) => Math.max(0, 100 - m.smoothness.rmsJerk / 10) * (this.weights.smoothness / 100)
    );

    const overallScore = Math.round(
      scores.reduce((a, b) => a + b, 0) / Math.max(1, scores.length)
    );

    const scoreBreakdown: QualityScoreBreakdown = {
      smoothnessScore: Math.round(
        smoothnessScores.reduce((a, b) => a + b, 0) / Math.max(1, smoothnessScores.length)
      ),
      consistencyScore: this.weights.consistency, // Placeholder
      anomalyScore: Math.round(
        this.weights.anomalyFree * (1 - anomalousMetrics.length / Math.max(1, trajectoryCount))
      ),
      completenessScore: this.weights.completeness, // Placeholder
      total: overallScore,
    };

    // Compute dataset-level statistics
    const statistics: DatasetMetricsStats = {
      rmsJerk: this.computeStatistics(trajectoryMetrics.map((m) => m.smoothness.rmsJerk)),
      ldlj: this.computeStatistics(trajectoryMetrics.map((m) => m.smoothness.ldlj)),
      pathLength: this.computeStatistics(trajectoryMetrics.map((m) => m.consistency.pathLength)),
      effort: this.computeStatistics(trajectoryMetrics.map((m) => m.consistency.effort)),
      duration: this.computeStatistics(trajectoryMetrics.map((m) => m.consistency.duration)),
    };

    // Generate flagged summary
    const flaggedSummary: FlaggedTrajectorySummary[] = flaggedMetrics.map((m) => ({
      trajectoryIndex: m.trajectoryIndex,
      episodeId: m.episodeId,
      flagReason: m.flagReason || 'Unknown',
      anomalyTypes: m.anomalies.anomalyTypes,
      qualityScore: m.qualityScore,
      reviewed: false,
    }));

    return {
      datasetId,
      datasetName,
      generatedAt: new Date(),
      overallScore,
      scoreBreakdown,
      trajectoryCount,
      flaggedTrajectoryCount: flaggedMetrics.length,
      anomalousTrajectoryCount: anomalousMetrics.length,
      cleanTrajectoryPercentage:
        trajectoryCount > 0
          ? Math.round(((trajectoryCount - flaggedMetrics.length) / trajectoryCount) * 100)
          : 100,
      statistics,
      flaggedSummary,
      validationStatus: 'completed',
    };
  }
}

// ============================================================================
// SINGLETON EXPORT
// ============================================================================

export const dataQualityService = DataQualityService.getInstance();
