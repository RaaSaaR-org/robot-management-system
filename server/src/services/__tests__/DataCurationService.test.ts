/**
 * @file DataCurationService.test.ts
 * @description Unit tests for DataCurationService — distribution analysis, balancing,
 *   quality filtering, deduplication, harmful detection, hindsight relabeling, taxonomy
 * @feature datasets
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BalancingConfig } from '../../types/curation.types.js';

// Mock the DataQualityService boundary — DTW distance drives duplicate similarity.
// similarity = exp(-normalizedDistance), so distance 0 => similarity 1, large => ~0.
vi.mock('../DataQualityService.js', () => ({
  dataQualityService: {
    computeDTWDistance: vi.fn(),
  },
}));

import { DataCurationService, dataCurationService } from '../DataCurationService.js';
import { dataQualityService } from '../DataQualityService.js';

const mockedDTW = vi.mocked(dataQualityService.computeDTWDistance);

describe('DataCurationService', () => {
  let service: DataCurationService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = DataCurationService.getInstance();
    // Default: identical => distance 0 => similarity 1
    mockedDTW.mockReturnValue({ normalizedDistance: 0 } as never);
  });

  // --------------------------------------------------------------------------
  // SINGLETON
  // --------------------------------------------------------------------------

  describe('getInstance', () => {
    it('returns the same instance and matches the exported singleton', () => {
      expect(DataCurationService.getInstance()).toBe(service);
      expect(dataCurationService).toBe(service);
    });
  });

  // --------------------------------------------------------------------------
  // DISTRIBUTION ANALYSIS
  // --------------------------------------------------------------------------

  describe('analyzeDistribution', () => {
    it('counts trajectories by task, environment, and robot type', () => {
      const result = service.analyzeDistribution('ds-1', [
        { task: 'grasp', environment: 'lab', robotType: 'so101' },
        { task: 'grasp', environment: 'home', robotType: 'so101' },
        { task: 'push', environment: 'lab', robotType: 'h1' },
      ]);

      expect(result.byTask).toEqual({ grasp: 2, push: 1 });
      expect(result.byEnvironment).toEqual({ lab: 2, home: 1 });
      expect(result.byRobotType).toEqual({ so101: 2, h1: 1 });
      expect(result.totalTrajectories).toBe(3);
      expect(result.uniqueTasks).toBe(2);
      expect(result.uniqueEnvironments).toBe(2);
      expect(result.datasetId).toBe('ds-1');
    });

    it('defaults missing fields to "unknown"', () => {
      const result = service.analyzeDistribution('ds-2', [{}, {}]);
      expect(result.byTask).toEqual({ unknown: 2 });
      expect(result.byEnvironment).toEqual({ unknown: 2 });
      expect(result.byRobotType).toEqual({ unknown: 2 });
    });

    it('maps known taxonomy tasks to their level and unknown tasks to primitive', () => {
      const result = service.analyzeDistribution('ds-3', [
        { task: 'grasp' }, // primitive
        { task: 'pick_place' }, // composed
        { task: 'clean_table' }, // long_horizon
        { task: 'totally_unknown_task' }, // -> primitive default
      ]);

      expect(result.byTaxonomyLevel.primitive).toBe(2);
      expect(result.byTaxonomyLevel.composed).toBe(1);
      expect(result.byTaxonomyLevel.long_horizon).toBe(1);
    });

    it('returns imbalanceScore 0 for a perfectly balanced distribution', () => {
      const result = service.analyzeDistribution('ds-4', [
        { task: 'a' },
        { task: 'b' },
        { task: 'c' },
      ]);
      expect(result.imbalanceScore).toBeCloseTo(0, 5);
    });

    it('produces a higher imbalanceScore and recommendations for skewed distributions', () => {
      const trajs = [
        ...Array.from({ length: 100 }, () => ({ task: 'common' })),
        // many distinct rare tasks each with a single sample drives Gini above 0.5
        ...Array.from({ length: 10 }, (_, i) => ({ task: `rare${i}` })),
      ];
      const result = service.analyzeDistribution('ds-5', trajs);
      expect(result.imbalanceScore).toBeGreaterThan(0.5);
      // High imbalance recommendation + underrepresented task recommendation
      expect(result.recommendations.some((r) => r.includes('High task imbalance'))).toBe(true);
      expect(result.recommendations.some((r) => r.includes('"rare0"'))).toBe(true);
    });

    it('emits a distribution:analyzed event', () => {
      const handler = vi.fn();
      service.on('distribution:analyzed', handler);
      service.analyzeDistribution('ds-evt', [{ task: 'grasp' }]);
      service.off('distribution:analyzed', handler);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0]).toMatchObject({
        type: 'distribution:analyzed',
        datasetId: 'ds-evt',
      });
    });

    it('handles an empty dataset without throwing', () => {
      const result = service.analyzeDistribution('ds-empty', []);
      expect(result.totalTrajectories).toBe(0);
      expect(result.imbalanceScore).toBe(0);
      expect(result.uniqueTasks).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // BALANCING WEIGHTS
  // --------------------------------------------------------------------------

  describe('computeOptimalWeights', () => {
    it('uniform: gives higher weight to underrepresented categories', () => {
      const config: BalancingConfig = { method: 'uniform', groupBy: 'task' };
      const weights = service.computeOptimalWeights({ a: 10, b: 90 }, config);
      const a = weights.find((w) => w.category === 'a')!;
      const b = weights.find((w) => w.category === 'b')!;
      // targetPerCategory = ceil(100/2) = 50; weight = 50/count
      expect(a.weight).toBeCloseTo(50 / 10, 5);
      expect(b.weight).toBeCloseTo(50 / 90, 5);
      expect(a.weight).toBeGreaterThan(b.weight);
    });

    it('sqrt: targetCount values sum approximately to targetSize', () => {
      const config: BalancingConfig = { method: 'sqrt', groupBy: 'task', targetSize: 100 };
      const weights = service.computeOptimalWeights({ a: 16, b: 64 }, config);
      const totalTarget = weights.reduce((s, w) => s + w.targetCount, 0);
      // ceil rounding makes it >= targetSize but close
      expect(totalTarget).toBeGreaterThanOrEqual(100);
      expect(totalTarget).toBeLessThanOrEqual(102);
    });

    it('dro: weights by minCount/count so the smallest category gets weight 1', () => {
      // invWeight = minCount / count; capped at 3 (cap can only matter if minCount>count,
      // which is impossible, so effective weight = minCount/count <= 1).
      const config: BalancingConfig = { method: 'dro', groupBy: 'task' };
      const weights = service.computeOptimalWeights({ big: 100, tiny: 1 }, config);
      const tiny = weights.find((w) => w.category === 'tiny')!;
      const big = weights.find((w) => w.category === 'big')!;
      expect(tiny.weight).toBe(1.0); // minCount(1)/count(1)
      expect(big.weight).toBeCloseTo(1 / 100, 5); // minCount(1)/count(100)
      expect(tiny.targetCount).toBe(1); // ceil(1 * 1)
      expect(big.targetCount).toBe(1); // ceil(100 * 0.01)
    });

    it('applies min/max constraints to targetCount', () => {
      const config: BalancingConfig = {
        method: 'dro',
        groupBy: 'task',
        minSamplesPerCategory: 5,
        maxSamplesPerCategory: 50,
      };
      const weights = service.computeOptimalWeights({ big: 100, tiny: 1 }, config);
      for (const w of weights) {
        expect(w.targetCount).toBeGreaterThanOrEqual(5);
        expect(w.targetCount).toBeLessThanOrEqual(50);
      }
    });

    it('falls back to weight 1 for an unknown method', () => {
      const config = { method: 'bogus', groupBy: 'task' } as unknown as BalancingConfig;
      const weights = service.computeOptimalWeights({ a: 5, b: 7 }, config);
      for (const w of weights) {
        expect(w.weight).toBe(1.0);
        expect(w.targetCount).toBe(w.originalCount);
      }
    });
  });

  // --------------------------------------------------------------------------
  // BALANCED SUBSET
  // --------------------------------------------------------------------------

  describe('createBalancedSubset', () => {
    it('groups by task and selects indices according to computed targets', () => {
      const trajs = [
        { task: 'a' },
        { task: 'a' },
        { task: 'a' },
        { task: 'b' },
      ];
      const config: BalancingConfig = { method: 'uniform', groupBy: 'task' };
      const selected = service.createBalancedSubset(trajs, config);
      // All selected indices must be valid trajectory indices
      for (const idx of selected) {
        expect(idx).toBeGreaterThanOrEqual(0);
        expect(idx).toBeLessThan(trajs.length);
      }
      expect(selected.length).toBeGreaterThan(0);
    });

    it('uses a single "all" group when groupBy is taxonomy_level', () => {
      const trajs = [{ task: 'a' }, { task: 'b' }, { task: 'c' }];
      const config: BalancingConfig = { method: 'uniform', groupBy: 'taxonomy_level' };
      const selected = service.createBalancedSubset(trajs, config);
      // single group of all 3, uniform target = ceil(3/1)=3 -> all selected
      expect(selected.length).toBe(3);
    });
  });

  // --------------------------------------------------------------------------
  // QUALITY FILTERING
  // --------------------------------------------------------------------------

  describe('filterByQuality', () => {
    it('keeps trajectories at or above minScore and removes the rest', () => {
      const { indices, removed } = service.filterByQuality(
        [{ qualityScore: 90 }, { qualityScore: 40 }, { qualityScore: 50 }],
        50
      );
      expect(indices).toEqual([0, 2]);
      expect(removed).toEqual([1]);
    });

    it('treats missing qualityScore as 100 (kept)', () => {
      const { indices, removed } = service.filterByQuality([{}, { qualityScore: 10 }], 50);
      expect(indices).toEqual([0]);
      expect(removed).toEqual([1]);
    });
  });

  // --------------------------------------------------------------------------
  // DUPLICATE DETECTION
  // --------------------------------------------------------------------------

  describe('findDuplicates', () => {
    it('groups near-identical trajectories (similarity above threshold)', () => {
      // distance 0 => similarity 1 >= threshold for all pairs (default mock)
      const groups = service.findDuplicates(
        [{ positions: [[1]] }, { positions: [[1]] }, { positions: [[1]] }],
        0.95
      );
      expect(groups).toHaveLength(1);
      expect(groups[0].representativeIndex).toBe(0);
      expect(groups[0].duplicateIndices).toEqual([1, 2]);
      expect(groups[0].similarityScore).toBeCloseTo(1, 5);
    });

    it('returns no groups when all trajectories are dissimilar', () => {
      // large distance => similarity ~0 < threshold
      mockedDTW.mockReturnValue({ normalizedDistance: 100 } as never);
      const groups = service.findDuplicates(
        [{ positions: [[1]] }, { positions: [[2]] }],
        0.95
      );
      expect(groups).toHaveLength(0);
    });

    it('does not reassign an index already claimed by another group', () => {
      // Pair (0,1) similar; (0,2),(1,2) dissimilar -> 2 stays unassigned, no own group
      mockedDTW.mockImplementation((a: number[][], b: number[][]) => {
        const av = a[0][0];
        const bv = b[0][0];
        const close = Math.abs(av - bv) < 0.5;
        return { normalizedDistance: close ? 0 : 100 } as never;
      });
      const groups = service.findDuplicates(
        [{ positions: [[1]] }, { positions: [[1]] }, { positions: [[9]] }],
        0.95
      );
      expect(groups).toHaveLength(1);
      expect(groups[0].duplicateIndices).toEqual([1]);
    });
  });

  // --------------------------------------------------------------------------
  // HARMFUL DETECTION
  // --------------------------------------------------------------------------

  describe('identifyHarmful', () => {
    it('flags trajectories with recorded collision or violation', () => {
      const harmful = service.identifyHarmful([
        { positions: [], hasCollision: true },
        { positions: [], hasViolation: true },
        { positions: [] },
      ]);
      expect(harmful).toEqual([0, 1]);
    });

    it('flags a sudden velocity drop (>90% in one step)', () => {
      const harmful = service.identifyHarmful([
        {
          positions: [],
          velocities: [
            [1, 0, 0], // magnitude 1
            [0.01, 0, 0], // magnitude 0.01 -> >90% drop
          ],
        },
      ]);
      expect(harmful).toEqual([0]);
    });

    it('does not flag smooth velocity profiles', () => {
      const harmful = service.identifyHarmful([
        {
          positions: [],
          velocities: [
            [1, 0, 0],
            [0.9, 0, 0],
            [0.8, 0, 0],
          ],
        },
      ]);
      expect(harmful).toEqual([]);
    });
  });

  // --------------------------------------------------------------------------
  // HINDSIGHT RELABELING
  // --------------------------------------------------------------------------

  describe('relabelWithHindsight', () => {
    it('returns null for successful trajectories', () => {
      const result = service.relabelWithHindsight(
        { positions: [[1]], originalInstruction: 'grasp', success: true },
        () => 'somewhere'
      );
      expect(result).toBeNull();
    });

    it('returns null when there are no positions', () => {
      const result = service.relabelWithHindsight(
        { positions: [], originalInstruction: 'grasp', success: false },
        () => 'somewhere'
      );
      expect(result).toBeNull();
    });

    it('relabels a failed trajectory using the achieved final state', () => {
      const describer = vi.fn().mockReturnValue('the red cube');
      const result = service.relabelWithHindsight(
        { positions: [[0], [9, 9, 9]], originalInstruction: 'pour water', success: false },
        describer
      );
      expect(describer).toHaveBeenCalledWith([9, 9, 9]); // final position
      expect(result).not.toBeNull();
      expect(result!.originalInstruction).toBe('pour water');
      expect(result!.newInstruction).toContain('the red cube');
      expect(result!.reason).toContain('pour water');
    });
  });

  // --------------------------------------------------------------------------
  // TAXONOMY
  // --------------------------------------------------------------------------

  describe('getTaxonomy', () => {
    it('returns the taxonomy including known levels', () => {
      const taxonomy = service.getTaxonomy();
      expect(taxonomy.find((t) => t.id === 'grasp')?.level).toBe('primitive');
      expect(taxonomy.find((t) => t.id === 'pick_place')?.level).toBe('composed');
      expect(taxonomy.find((t) => t.id === 'clean_table')?.level).toBe('long_horizon');
    });
  });

  describe('categorizeTrajectory', () => {
    it('matches an instruction against a taxonomy entry with confidence', () => {
      const result = service.categorizeTrajectory('please grasp object now');
      expect(result.taxonomyId).toBe('grasp');
      expect(result.level).toBe('primitive');
      expect(result.confidence).toBeGreaterThan(0);
    });

    it('matches multi-word composed tasks', () => {
      const result = service.categorizeTrajectory('do a pick and place of the cube');
      expect(result.taxonomyId).toBe('pick_place');
      expect(result.level).toBe('composed');
      expect(result.parentTasks).toEqual(['grasp', 'move_to', 'release']);
    });

    it('falls back to unknown for unrecognized instructions', () => {
      const result = service.categorizeTrajectory('xyzzy frobnicate the widget');
      expect(result.taxonomyId).toBe('unknown');
      expect(result.level).toBe('primitive');
      expect(result.confidence).toBe(0.3);
    });
  });

  // --------------------------------------------------------------------------
  // FULL PIPELINE
  // --------------------------------------------------------------------------

  describe('runCurationPipeline', () => {
    it('removes low quality, dedups, flags harmful, and counts relabels', () => {
      // idx0: good, unique. idx1: low quality. idx2: duplicate of idx0. idx3: harmful + failed
      mockedDTW.mockImplementation((a: number[][], b: number[][]) => {
        const close = a[0][0] === b[0][0];
        return { normalizedDistance: close ? 0 : 100 } as never;
      });

      const trajs = [
        { positions: [[1]], qualityScore: 90, success: true },
        { positions: [[5]], qualityScore: 10, success: true }, // low quality
        { positions: [[1]], qualityScore: 90, success: true }, // dup of idx0
        { positions: [[7]], qualityScore: 90, hasCollision: true, success: false }, // harmful + failed
      ];

      const result = service.runCurationPipeline('ds-pipe', trajs, {
        minQualityScore: 50,
        deduplicationThreshold: 0.95,
        identifyHarmful: true,
        hindsightRelabeling: true,
      });

      expect(result.originalCount).toBe(4);
      expect(result.removedLowQuality).toBe(1);
      expect(result.removedDuplicates).toBe(1);
      expect(result.flaggedHarmful).toBe(1);
      expect(result.relabeled).toBe(1); // one failed trajectory
      // removedIndices deduped: idx1 (quality) + idx2 (dup)
      expect(new Set(result.removedIndices)).toEqual(new Set([1, 2]));
      expect(result.filteredCount).toBe(4 - 2);
      expect(result.flaggedIndices).toContain(3);
      expect(result.processingTime).toBeGreaterThanOrEqual(0);
    });

    it('uses the default config and skips disabled steps', () => {
      // Default config: hindsightRelabeling false. Make everything unique & good.
      mockedDTW.mockReturnValue({ normalizedDistance: 100 } as never);
      const result = service.runCurationPipeline('ds-default', [
        { positions: [[1]], qualityScore: 90 },
        { positions: [[2]], qualityScore: 80 },
      ]);
      expect(result.removedLowQuality).toBe(0);
      expect(result.removedDuplicates).toBe(0);
      expect(result.relabeled).toBe(0);
      expect(result.filteredCount).toBe(2);
    });

    it('emits a curation:completed event', () => {
      mockedDTW.mockReturnValue({ normalizedDistance: 100 } as never);
      const handler = vi.fn();
      service.on('curation:completed', handler);
      service.runCurationPipeline('ds-evt2', [{ positions: [[1]], qualityScore: 90 }]);
      service.off('curation:completed', handler);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0]).toMatchObject({
        type: 'curation:completed',
        datasetId: 'ds-evt2',
      });
    });
  });
});
