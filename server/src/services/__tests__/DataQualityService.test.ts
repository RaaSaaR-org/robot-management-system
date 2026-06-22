/**
 * @file DataQualityService.test.ts
 * @description Unit tests for DataQualityService — smoothness/consistency/anomaly metrics,
 *              DTW, OOD heuristic, scoring, statistics, and dataset report generation.
 * @feature datasets
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DataQualityService, dataQualityService } from '../DataQualityService.js';
import {
  DEFAULT_VALIDATION_CONFIG,
  DEFAULT_QUALITY_WEIGHTS,
} from '../../types/data-quality.types.js';
import type {
  AdvancedValidationConfig,
  TrajectoryMetrics,
  SmoothnessMetrics,
  ConsistencyMetrics,
  AnomalyDetectionResult,
} from '../../types/data-quality.types.js';

// Helper to build a fresh service instance (singleton + reset weights)
function freshService(): DataQualityService {
  const svc = DataQualityService.getInstance();
  svc.setWeights({ ...DEFAULT_QUALITY_WEIGHTS });
  return svc;
}

// Generates a perfectly linear (zero-jerk) trajectory of `count` points
function linearTrajectory(count: number, step: number): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < count; i++) {
    out.push([i * step, i * step]);
  }
  return out;
}

function makeTimestamps(count: number, dt: number): number[] {
  return Array.from({ length: count }, (_, i) => i * dt);
}

describe('DataQualityService', () => {
  let svc: DataQualityService;

  beforeEach(() => {
    svc = freshService();
  });

  // --------------------------------------------------------------------------
  // SINGLETON + WEIGHTS
  // --------------------------------------------------------------------------

  describe('getInstance / singleton', () => {
    it('returns the same instance', () => {
      expect(DataQualityService.getInstance()).toBe(DataQualityService.getInstance());
    });

    it('exported dataQualityService is the singleton', () => {
      expect(dataQualityService).toBe(DataQualityService.getInstance());
    });
  });

  describe('setWeights', () => {
    it('merges partial weights without clobbering others', () => {
      svc.setWeights({ smoothness: 50 });
      // anomalyFree should remain at default for trajectory scoring of a clean traj.
      const anomalies: AnomalyDetectionResult = {
        hasAnomalies: false,
        anomalyTypes: [],
        anomalyIndices: [],
        zScores: [],
        envelopeViolation: false,
        velocitySpikes: [],
      };
      const smoothness: SmoothnessMetrics = {
        rmsJerk: 0,
        ldlj: 0,
        positionInstability: 0,
        maxAcceleration: 0,
      };
      const consistency: ConsistencyMetrics = { pathLength: 0, effort: 0, duration: 2 };
      // rmsJerk=0 → jerkScore=100, smoothnessScore=min(50, 100*50/100)=50
      // consistency=30*0.8=24, anomalyFree=20, completeness=20 → 114
      const score = svc.computeTrajectoryQualityScore({ smoothness, consistency }, anomalies);
      expect(score).toBe(114);
    });
  });

  // --------------------------------------------------------------------------
  // SMOOTHNESS METRICS
  // --------------------------------------------------------------------------

  describe('computeRMSJerk', () => {
    it('returns 0 for fewer than 4 points', () => {
      expect(svc.computeRMSJerk([[0], [1], [2]], 0.1)).toBe(0);
    });

    it('returns 0 for a perfectly linear trajectory (constant velocity)', () => {
      const positions = linearTrajectory(10, 1);
      expect(svc.computeRMSJerk(positions, 0.1)).toBeCloseTo(0, 10);
    });

    it('returns a positive value for a jerky trajectory', () => {
      const positions = [[0], [0], [5], [0], [5], [0]];
      expect(svc.computeRMSJerk(positions, 0.1)).toBeGreaterThan(0);
    });
  });

  describe('computeLDLJ', () => {
    it('returns 0 for fewer than 4 points', () => {
      expect(svc.computeLDLJ([[0], [1], [2]], [0, 1, 2])).toBe(0);
    });

    it('returns 0 when duration is zero', () => {
      const positions = linearTrajectory(5, 1);
      expect(svc.computeLDLJ(positions, [0, 0, 0, 0, 0])).toBe(0);
    });

    it('returns 0 when path length is zero (no movement)', () => {
      const positions = [[0, 0], [0, 0], [0, 0], [0, 0]];
      expect(svc.computeLDLJ(positions, [0, 1, 2, 3])).toBe(0);
    });

    it('returns 0 for a linear trajectory (zero jerk integral → normalizedJerk 0)', () => {
      const positions = linearTrajectory(6, 1);
      const ts = makeTimestamps(6, 0.1);
      // Zero jerk → normalizedJerk = 0 → returns 0
      expect(svc.computeLDLJ(positions, ts)).toBe(0);
    });

    it('returns a finite number for a jerky trajectory', () => {
      const positions = [[0], [0], [5], [0], [5], [10]];
      const ts = makeTimestamps(6, 0.1);
      const v = svc.computeLDLJ(positions, ts);
      expect(Number.isFinite(v)).toBe(true);
    });
  });

  describe('computePositionInstability', () => {
    it('returns 0 for fewer than 2 points', () => {
      expect(svc.computePositionInstability([[0]])).toBe(0);
    });

    it('returns 0 for constant-step movement (zero variance of deltas)', () => {
      const positions = linearTrajectory(5, 2);
      expect(svc.computePositionInstability(positions)).toBeCloseTo(0, 10);
    });

    it('returns positive std for irregular movement', () => {
      const positions = [[0], [1], [10], [11]];
      expect(svc.computePositionInstability(positions)).toBeGreaterThan(0);
    });
  });

  describe('computeMaxAcceleration', () => {
    it('returns 0 for fewer than 3 points', () => {
      expect(svc.computeMaxAcceleration([[0], [1]], 0.1)).toBe(0);
    });

    it('returns 0 for constant velocity', () => {
      const positions = linearTrajectory(5, 1);
      expect(svc.computeMaxAcceleration(positions, 0.1)).toBeCloseTo(0, 10);
    });

    it('captures the largest acceleration magnitude', () => {
      // pos jumps: velocities differ → nonzero acceleration
      const positions = [[0], [0], [10], [10]];
      const dt = 0.1;
      // i=1: v1=(0-0)/.1=0, v2=(10-0)/.1=100, acc=(100-0)/.1=1000 → mag 1000
      // i=2: v1=100, v2=(10-10)/.1=0, acc=(0-100)/.1=-1000 → mag 1000
      expect(svc.computeMaxAcceleration(positions, dt)).toBeCloseTo(1000, 5);
    });
  });

  describe('computeSmoothnessMetrics', () => {
    it('derives dt from timestamps and assembles all four metrics', () => {
      const positions = linearTrajectory(6, 1);
      const ts = makeTimestamps(6, 0.1);
      const m = svc.computeSmoothnessMetrics(positions, ts);
      expect(m.rmsJerk).toBeCloseTo(0, 10);
      expect(m.ldlj).toBe(0);
      expect(m.positionInstability).toBeCloseTo(0, 10);
      expect(m.maxAcceleration).toBeCloseTo(0, 10);
    });

    it('uses default dt (0.033) when only one timestamp present', () => {
      // Single timestamp → fewer than 4/3/2 points so all guards return 0,
      // but the call should not throw.
      const m = svc.computeSmoothnessMetrics([[0]], [0]);
      expect(m.rmsJerk).toBe(0);
      expect(m.maxAcceleration).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // CONSISTENCY METRICS
  // --------------------------------------------------------------------------

  describe('computePathLength', () => {
    it('returns 0 for fewer than 2 points', () => {
      expect(svc.computePathLength([[0, 0]])).toBe(0);
    });

    it('sums euclidean step distances', () => {
      // [0,0]->[3,4] = 5, [3,4]->[3,4] = 0 → total 5
      const positions = [[0, 0], [3, 4], [3, 4]];
      expect(svc.computePathLength(positions)).toBeCloseTo(5, 10);
    });
  });

  describe('computeEffort', () => {
    it('returns 0 for fewer than 2 points', () => {
      expect(svc.computeEffort([[0]], 0.1)).toBe(0);
    });

    it('integrates squared velocity over time', () => {
      // single joint, move by 1 over dt=0.1 each step (2 steps)
      // v = 1/0.1 = 10, velSquared=100, *dt=0.1 → 10 per step, 2 steps → 20
      const positions = [[0], [1], [2]];
      expect(svc.computeEffort(positions, 0.1)).toBeCloseTo(20, 10);
    });
  });

  describe('computeConsistencyMetrics', () => {
    it('computes duration from timestamps', () => {
      const positions = linearTrajectory(4, 1);
      const ts = [0, 0.5, 1.0, 1.5];
      const m = svc.computeConsistencyMetrics(positions, ts);
      expect(m.duration).toBeCloseTo(1.5, 10);
      expect(m.pathLength).toBeGreaterThan(0);
      expect(m.effort).toBeGreaterThan(0);
    });

    it('returns duration 0 for a single timestamp', () => {
      const m = svc.computeConsistencyMetrics([[0]], [0]);
      expect(m.duration).toBe(0);
    });
  });

  describe('computePathLengthVariance', () => {
    it('returns 0 for fewer than 2 trajectories', () => {
      expect(svc.computePathLengthVariance([linearTrajectory(3, 1)])).toBe(0);
    });

    it('returns 0 when all trajectories have equal path length', () => {
      const a = [[0, 0], [3, 4]];
      const b = [[1, 1], [4, 5]];
      expect(svc.computePathLengthVariance([a, b])).toBeCloseTo(0, 10);
    });

    it('returns positive variance for differing path lengths', () => {
      const a = [[0, 0], [3, 4]]; // length 5
      const b = [[0, 0], [6, 8]]; // length 10
      expect(svc.computePathLengthVariance([a, b])).toBeGreaterThan(0);
    });
  });

  // --------------------------------------------------------------------------
  // DTW
  // --------------------------------------------------------------------------

  describe('computeDTWDistance', () => {
    it('returns zero distance for empty input', () => {
      expect(svc.computeDTWDistance([], [[1]])).toEqual({ distance: 0, normalizedDistance: 0 });
      expect(svc.computeDTWDistance([[1]], [])).toEqual({ distance: 0, normalizedDistance: 0 });
    });

    it('returns zero distance for identical trajectories', () => {
      const t = [[0, 0], [1, 1], [2, 2]];
      const r = svc.computeDTWDistance(t, t);
      expect(r.distance).toBeCloseTo(0, 10);
      expect(r.normalizedDistance).toBeCloseTo(0, 10);
    });

    it('returns positive distance for differing trajectories and normalizes by n+m', () => {
      const a = [[0], [0]];
      const b = [[3], [3]];
      const r = svc.computeDTWDistance(a, b);
      expect(r.distance).toBeGreaterThan(0);
      expect(r.normalizedDistance).toBeCloseTo(r.distance / 4, 10);
    });
  });

  // --------------------------------------------------------------------------
  // ANOMALY DETECTION
  // --------------------------------------------------------------------------

  describe('detectStatisticalOutliers', () => {
    it('returns empty for fewer than 2 values', () => {
      expect(svc.detectStatisticalOutliers([5])).toEqual({ indices: [], zScores: [] });
    });

    it('returns all-zero zScores and no indices when std is 0', () => {
      const r = svc.detectStatisticalOutliers([4, 4, 4, 4]);
      expect(r.indices).toEqual([]);
      expect(r.zScores).toEqual([0, 0, 0, 0]);
    });

    it('flags a clear outlier above threshold', () => {
      const values = [1, 1, 1, 1, 1, 1, 1, 1, 1, 100];
      const r = svc.detectStatisticalOutliers(values, 2.0);
      expect(r.indices).toContain(9);
    });

    it('respects a higher threshold (no flag when below it)', () => {
      const values = [1, 1, 1, 1, 1, 1, 1, 1, 1, 100];
      const r = svc.detectStatisticalOutliers(values, 1000);
      expect(r.indices).toEqual([]);
    });
  });

  describe('detectVelocitySpikes', () => {
    it('detects spikes above threshold and records joint/index', () => {
      const positions = [[0, 0], [0, 0], [10, 0]];
      const dt = 0.1; // velocity for joint 0 at i=2 = 10/0.1 = 100
      const spikes = svc.detectVelocitySpikes(positions, dt, 5.0);
      expect(spikes.length).toBeGreaterThan(0);
      expect(spikes[0].index).toBe(2);
      expect(spikes[0].joint).toBe(0);
      expect(spikes[0].isAnomaly).toBe(true);
    });

    it('returns no spikes for slow motion under threshold', () => {
      const positions = [[0], [0.1], [0.2]];
      const spikes = svc.detectVelocitySpikes(positions, 1.0, 5.0);
      expect(spikes).toEqual([]);
    });
  });

  describe('checkEnvelopeViolation', () => {
    it('flags indices outside bounds', () => {
      const positions = [[0, 0], [5, 0], [-5, 0]];
      const bounds = { min: [-1, -1], max: [1, 1] };
      const r = svc.checkEnvelopeViolation(positions, bounds);
      expect(r.violated).toBe(true);
      expect(r.violationIndices).toEqual([1, 2]);
    });

    it('reports no violation when all within bounds', () => {
      const positions = [[0, 0], [0.5, -0.5]];
      const bounds = { min: [-1, -1], max: [1, 1] };
      const r = svc.checkEnvelopeViolation(positions, bounds);
      expect(r.violated).toBe(false);
      expect(r.violationIndices).toEqual([]);
    });

    it('ignores joints beyond the bounds arrays length', () => {
      // joint 1 is out of range but bounds only cover joint 0
      const positions = [[0, 999]];
      const bounds = { min: [-1], max: [1] };
      const r = svc.checkEnvelopeViolation(positions, bounds);
      expect(r.violated).toBe(false);
    });
  });

  describe('detectStuckJoints', () => {
    it('returns empty when trajectory shorter than window', () => {
      expect(svc.detectStuckJoints([[0], [0]], 10)).toEqual([]);
    });

    it('flags a joint that never moves', () => {
      // joint 0 stuck at 0, joint 1 moving
      const positions = Array.from({ length: 30 }, (_, i) => [0, i]);
      const stuck = svc.detectStuckJoints(positions, 5, 0.001);
      expect(stuck).toContain(0);
      expect(stuck).not.toContain(1);
    });

    it('does not flag a continuously moving joint', () => {
      const positions = Array.from({ length: 30 }, (_, i) => [i, i * 2]);
      const stuck = svc.detectStuckJoints(positions, 5, 0.001);
      expect(stuck).toEqual([]);
    });
  });

  describe('detectAnomalies', () => {
    const config: AdvancedValidationConfig = { ...DEFAULT_VALIDATION_CONFIG };

    it('reports no anomalies for a smooth slow trajectory', () => {
      const positions = linearTrajectory(20, 0.01);
      const ts = makeTimestamps(20, 0.1);
      const r = svc.detectAnomalies(positions, ts, config);
      expect(r.hasAnomalies).toBe(false);
      expect(r.anomalyTypes).toEqual([]);
      expect(r.anomalyIndices).toEqual([]);
    });

    it('detects velocity spikes and aggregates indices sorted', () => {
      const positions = [[0], [0], [50], [0], [0]];
      const ts = makeTimestamps(5, 0.1);
      const r = svc.detectAnomalies(positions, ts, config);
      expect(r.hasAnomalies).toBe(true);
      expect(r.anomalyTypes).toContain('velocity_spike');
      // indices should be sorted ascending
      const sorted = [...r.anomalyIndices].sort((a, b) => a - b);
      expect(r.anomalyIndices).toEqual(sorted);
    });

    it('detects a stuck joint', () => {
      // joint 0 stuck, joint 1 moving slowly to avoid spikes
      const positions = Array.from({ length: 30 }, (_, i) => [0, i * 0.001]);
      const ts = makeTimestamps(30, 0.1);
      const r = svc.detectAnomalies(positions, ts, config);
      expect(r.anomalyTypes).toContain('stuck_joint');
    });

    it('envelopeViolation is always false (no bounds supplied)', () => {
      const positions = linearTrajectory(5, 1);
      const ts = makeTimestamps(5, 0.1);
      const r = svc.detectAnomalies(positions, ts, config);
      expect(r.envelopeViolation).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // OOD DETECTION (heuristic)
  // --------------------------------------------------------------------------

  describe('detectOOD', () => {
    it('flags large magnitude observations as OOD', () => {
      const r = svc.detectOOD([0, 0, 50], 0.5);
      expect(r.isOOD).toBe(true);
      expect(r.reconstructionError).toBe(0.8);
      expect(r.threshold).toBe(0.5);
    });

    it('treats small magnitude observations as in-distribution', () => {
      const r = svc.detectOOD([0.1, -0.2, 1], 0.5);
      expect(r.isOOD).toBe(false);
      expect(r.reconstructionError).toBe(0.2);
    });

    it('computes confidence relative to threshold', () => {
      const r = svc.detectOOD([0.1], 0.5);
      // |0.2 - 0.5| / 0.5 = 0.6
      expect(r.confidence).toBeCloseTo(0.6, 10);
    });
  });

  // --------------------------------------------------------------------------
  // SCORING
  // --------------------------------------------------------------------------

  describe('computeTrajectoryQualityScore', () => {
    const cleanAnomalies: AnomalyDetectionResult = {
      hasAnomalies: false,
      anomalyTypes: [],
      anomalyIndices: [],
      zScores: [],
      envelopeViolation: false,
      velocitySpikes: [],
    };

    it('scores a perfect trajectory at the maximum (sum of weights)', () => {
      const smoothness: SmoothnessMetrics = {
        rmsJerk: 0,
        ldlj: 0,
        positionInstability: 0,
        maxAcceleration: 0,
      };
      const consistency: ConsistencyMetrics = { pathLength: 1, effort: 1, duration: 5 };
      // smoothness 30, consistency 30*0.8=24, anomalyFree 20, completeness 20 → 94
      const score = svc.computeTrajectoryQualityScore({ smoothness, consistency }, cleanAnomalies);
      expect(score).toBe(94);
    });

    it('halves completeness score for short trajectories', () => {
      const smoothness: SmoothnessMetrics = {
        rmsJerk: 0,
        ldlj: 0,
        positionInstability: 0,
        maxAcceleration: 0,
      };
      const longC: ConsistencyMetrics = { pathLength: 1, effort: 1, duration: 5 };
      const shortC: ConsistencyMetrics = { pathLength: 1, effort: 1, duration: 0.5 };
      const longScore = svc.computeTrajectoryQualityScore({ smoothness, consistency: longC }, cleanAnomalies);
      const shortScore = svc.computeTrajectoryQualityScore({ smoothness, consistency: shortC }, cleanAnomalies);
      // completeness 20 vs 10 → difference of 10
      expect(longScore - shortScore).toBe(10);
    });

    it('penalizes anomalies based on number of anomaly indices', () => {
      const smoothness: SmoothnessMetrics = {
        rmsJerk: 0,
        ldlj: 0,
        positionInstability: 0,
        maxAcceleration: 0,
      };
      const consistency: ConsistencyMetrics = { pathLength: 1, effort: 1, duration: 5 };
      const anomalies: AnomalyDetectionResult = {
        hasAnomalies: true,
        anomalyTypes: ['velocity_spike'],
        anomalyIndices: [1, 2, 3, 4, 5], // 5 indices
        zScores: [],
        envelopeViolation: false,
        velocitySpikes: [],
      };
      // anomalyFree = 20 * (1 - 5/100) = 19
      const score = svc.computeTrajectoryQualityScore({ smoothness, consistency }, anomalies);
      expect(score).toBe(93); // 30 + 24 + 19 + 20
    });

    it('lowers smoothness contribution for high jerk', () => {
      const lowJerk: SmoothnessMetrics = { rmsJerk: 0, ldlj: 0, positionInstability: 0, maxAcceleration: 0 };
      const highJerk: SmoothnessMetrics = { rmsJerk: 1000, ldlj: 0, positionInstability: 0, maxAcceleration: 0 };
      const consistency: ConsistencyMetrics = { pathLength: 1, effort: 1, duration: 5 };
      const low = svc.computeTrajectoryQualityScore({ smoothness: lowJerk, consistency }, cleanAnomalies);
      const high = svc.computeTrajectoryQualityScore({ smoothness: highJerk, consistency }, cleanAnomalies);
      expect(high).toBeLessThan(low);
    });
  });

  describe('computeTrajectoryMetrics', () => {
    const config: AdvancedValidationConfig = { ...DEFAULT_VALIDATION_CONFIG };

    it('assembles metrics, score, and index for a clean trajectory', () => {
      const positions = linearTrajectory(20, 0.01);
      const timestamps = makeTimestamps(20, 0.1);
      const traj = {
        jointStates: { positions: positions as unknown as number[], timestamps },
        episodeId: 'ep-1',
      };
      const m = svc.computeTrajectoryMetrics(traj, 7, config);
      expect(m.trajectoryIndex).toBe(7);
      expect(m.episodeId).toBe('ep-1');
      expect(m.computedAt).toBeInstanceOf(Date);
      expect(m.anomalies.hasAnomalies).toBe(false);
      expect(m.flagged).toBe(false);
    });

    it('flags a trajectory with anomalies and sets a flag reason', () => {
      // includes a velocity spike
      const positions = [[0], [0], [50], [0], [0]];
      const timestamps = makeTimestamps(5, 0.1);
      const traj = {
        jointStates: { positions: positions as unknown as number[], timestamps },
        episodeId: 'ep-spike',
      };
      const m = svc.computeTrajectoryMetrics(traj, 0, config);
      expect(m.flagged).toBe(true);
      expect(m.flagReason).toBeDefined();
      expect(m.flagReason).toContain('Anomalies');
    });
  });

  // --------------------------------------------------------------------------
  // STATISTICS
  // --------------------------------------------------------------------------

  describe('computeStatistics', () => {
    it('returns all-zero stats for empty input', () => {
      expect(svc.computeStatistics([])).toEqual({
        mean: 0,
        std: 0,
        min: 0,
        max: 0,
        median: 0,
        p25: 0,
        p75: 0,
      });
    });

    it('computes mean, std, min, max, median, and percentiles', () => {
      const values = [1, 2, 3, 4, 5];
      const s = svc.computeStatistics(values);
      expect(s.mean).toBeCloseTo(3, 10);
      expect(s.min).toBe(1);
      expect(s.max).toBe(5);
      expect(s.median).toBe(3); // sorted[floor(5/2)] = sorted[2]
      expect(s.p25).toBe(2); // sorted[floor(5*0.25)] = sorted[1]
      expect(s.p75).toBe(4); // sorted[floor(5*0.75)] = sorted[3]
      // population std of 1..5 = sqrt(2)
      expect(s.std).toBeCloseTo(Math.sqrt(2), 10);
    });

    it('std is 0 for constant values', () => {
      const s = svc.computeStatistics([7, 7, 7]);
      expect(s.std).toBe(0);
      expect(s.mean).toBe(7);
    });
  });

  // --------------------------------------------------------------------------
  // DATASET REPORT
  // --------------------------------------------------------------------------

  describe('generateQualityReport', () => {
    function makeMetric(overrides: Partial<TrajectoryMetrics>): TrajectoryMetrics {
      return {
        trajectoryIndex: 0,
        episodeId: undefined,
        smoothness: { rmsJerk: 0, ldlj: 0, positionInstability: 0, maxAcceleration: 0 },
        consistency: { pathLength: 1, effort: 1, duration: 2 },
        anomalies: {
          hasAnomalies: false,
          anomalyTypes: [],
          anomalyIndices: [],
          zScores: [],
          envelopeViolation: false,
          velocitySpikes: [],
        },
        qualityScore: 90,
        flagged: false,
        flagReason: undefined,
        computedAt: new Date(),
        ...overrides,
      };
    }

    it('handles an empty dataset gracefully', () => {
      const report = svc.generateQualityReport('ds-1', 'Empty', []);
      expect(report.trajectoryCount).toBe(0);
      expect(report.overallScore).toBe(0);
      expect(report.cleanTrajectoryPercentage).toBe(100);
      expect(report.flaggedTrajectoryCount).toBe(0);
      expect(report.anomalousTrajectoryCount).toBe(0);
      expect(report.validationStatus).toBe('completed');
    });

    it('computes overall score as the rounded mean of trajectory scores', () => {
      const metrics = [
        makeMetric({ trajectoryIndex: 0, qualityScore: 80 }),
        makeMetric({ trajectoryIndex: 1, qualityScore: 90 }),
      ];
      const report = svc.generateQualityReport('ds-1', 'DS', metrics);
      expect(report.overallScore).toBe(85);
      expect(report.scoreBreakdown.total).toBe(85);
    });

    it('counts flagged and anomalous trajectories and builds flagged summary', () => {
      const metrics = [
        makeMetric({ trajectoryIndex: 0, qualityScore: 90 }),
        makeMetric({
          trajectoryIndex: 1,
          qualityScore: 30,
          flagged: true,
          flagReason: 'Low quality score: 30',
          anomalies: {
            hasAnomalies: true,
            anomalyTypes: ['velocity_spike'],
            anomalyIndices: [2],
            zScores: [],
            envelopeViolation: false,
            velocitySpikes: [],
          },
          episodeId: 'ep-x',
        }),
      ];
      const report = svc.generateQualityReport('ds-1', 'DS', metrics);
      expect(report.flaggedTrajectoryCount).toBe(1);
      expect(report.anomalousTrajectoryCount).toBe(1);
      expect(report.flaggedSummary).toHaveLength(1);
      expect(report.flaggedSummary[0].trajectoryIndex).toBe(1);
      expect(report.flaggedSummary[0].episodeId).toBe('ep-x');
      expect(report.flaggedSummary[0].flagReason).toBe('Low quality score: 30');
      expect(report.flaggedSummary[0].reviewed).toBe(false);
      // clean = (2 - 1) / 2 * 100 = 50
      expect(report.cleanTrajectoryPercentage).toBe(50);
    });

    it('falls back to "Unknown" flag reason when missing', () => {
      const metrics = [
        makeMetric({ trajectoryIndex: 0, flagged: true, flagReason: undefined, qualityScore: 10 }),
      ];
      const report = svc.generateQualityReport('ds-1', 'DS', metrics);
      expect(report.flaggedSummary[0].flagReason).toBe('Unknown');
    });

    it('populates dataset-level statistics from trajectory metrics', () => {
      const metrics = [
        makeMetric({
          trajectoryIndex: 0,
          smoothness: { rmsJerk: 10, ldlj: 1, positionInstability: 0, maxAcceleration: 0 },
          consistency: { pathLength: 5, effort: 2, duration: 3 },
        }),
        makeMetric({
          trajectoryIndex: 1,
          smoothness: { rmsJerk: 20, ldlj: 2, positionInstability: 0, maxAcceleration: 0 },
          consistency: { pathLength: 15, effort: 4, duration: 7 },
        }),
      ];
      const report = svc.generateQualityReport('ds-1', 'DS', metrics);
      expect(report.statistics.rmsJerk.mean).toBeCloseTo(15, 10);
      expect(report.statistics.pathLength.min).toBe(5);
      expect(report.statistics.pathLength.max).toBe(15);
      expect(report.statistics.duration.mean).toBeCloseTo(5, 10);
    });

    it('passes through datasetId and datasetName', () => {
      const report = svc.generateQualityReport('the-id', 'The Name', []);
      expect(report.datasetId).toBe('the-id');
      expect(report.datasetName).toBe('The Name');
      expect(report.generatedAt).toBeInstanceOf(Date);
    });
  });
});
