/**
 * @file DataCurationService.ts
 * @description Service for data curation including balancing, deduplication, and hindsight relabeling
 * @feature datasets
 */

import { EventEmitter } from 'events';
import type {
  TaskTaxonomy,
  TaskTaxonomyLevel,
  DistributionAnalysis,
  SamplingWeight,
  BalancingConfig,
  CurationConfig,
  CurationResult,
  DuplicateGroup,
  RelabelingResult,
  CategorizationResult,
  CurationEvent,
  DEFAULT_TASK_TAXONOMY,
  DEFAULT_CURATION_CONFIG,
} from '../types/curation.types.js';
import { dataQualityService } from './DataQualityService.js';

// ============================================================================
// DATA CURATION SERVICE
// ============================================================================

/**
 * Service for dataset curation operations
 */
export class DataCurationService extends EventEmitter {
  private static instance: DataCurationService;
  private taxonomy: TaskTaxonomy[];

  private constructor() {
    super();
    // Initialize with default taxonomy
    this.taxonomy = [
      { id: 'grasp', name: 'Grasp Object', level: 'primitive', children: [] },
      { id: 'release', name: 'Release Object', level: 'primitive', children: [] },
      { id: 'move_to', name: 'Move to Position', level: 'primitive', children: [] },
      { id: 'rotate', name: 'Rotate', level: 'primitive', children: [] },
      { id: 'push', name: 'Push', level: 'primitive', children: [] },
      { id: 'pull', name: 'Pull', level: 'primitive', children: [] },
      { id: 'pick_place', name: 'Pick and Place', level: 'composed', children: ['grasp', 'move_to', 'release'] },
      { id: 'stack', name: 'Stack Objects', level: 'composed', children: ['grasp', 'move_to', 'release'] },
      { id: 'pour', name: 'Pour', level: 'composed', children: ['grasp', 'rotate', 'release'] },
      { id: 'clean_table', name: 'Clean Table', level: 'long_horizon', children: ['pick_place', 'stack'] },
      { id: 'set_table', name: 'Set Table', level: 'long_horizon', children: ['pick_place'] },
      { id: 'make_coffee', name: 'Make Coffee', level: 'long_horizon', children: ['grasp', 'pour', 'pick_place'] },
    ];
  }

  /**
   * Get singleton instance
   */
  static getInstance(): DataCurationService {
    if (!DataCurationService.instance) {
      DataCurationService.instance = new DataCurationService();
    }
    return DataCurationService.instance;
  }

  // ============================================================================
  // DISTRIBUTION ANALYSIS
  // ============================================================================

  /**
   * Analyze task/environment distribution in a dataset
   */
  analyzeDistribution(
    datasetId: string,
    trajectories: Array<{
      task?: string;
      environment?: string;
      robotType?: string;
    }>
  ): DistributionAnalysis {
    const byTask: Record<string, number> = {};
    const byEnvironment: Record<string, number> = {};
    const byRobotType: Record<string, number> = {};
    const byTaxonomyLevel: Record<TaskTaxonomyLevel, number> = {
      primitive: 0,
      composed: 0,
      long_horizon: 0,
    };

    for (const traj of trajectories) {
      // Count by task
      const task = traj.task ?? 'unknown';
      byTask[task] = (byTask[task] ?? 0) + 1;

      // Count by environment
      const env = traj.environment ?? 'unknown';
      byEnvironment[env] = (byEnvironment[env] ?? 0) + 1;

      // Count by robot type
      const robotType = traj.robotType ?? 'unknown';
      byRobotType[robotType] = (byRobotType[robotType] ?? 0) + 1;

      // Count by taxonomy level
      const taxonomy = this.taxonomy.find((t) => t.id === task || t.name === task);
      if (taxonomy) {
        byTaxonomyLevel[taxonomy.level]++;
      } else {
        byTaxonomyLevel.primitive++; // Default to primitive
      }
    }

    // Calculate imbalance score using Gini coefficient
    const taskCounts = Object.values(byTask);
    const imbalanceScore = this.calculateGiniCoefficient(taskCounts);

    // Generate recommendations
    const recommendations = this.generateBalancingRecommendations(
      byTask,
      byEnvironment,
      imbalanceScore
    );

    const result: DistributionAnalysis = {
      datasetId,
      byTask,
      byEnvironment,
      byTaxonomyLevel,
      byRobotType,
      imbalanceScore,
      totalTrajectories: trajectories.length,
      uniqueTasks: Object.keys(byTask).length,
      uniqueEnvironments: Object.keys(byEnvironment).length,
      recommendations,
    };

    this.emitEvent({
      type: 'distribution:analyzed',
      datasetId,
      result,
      timestamp: new Date(),
    });

    return result;
  }

  /**
   * Calculate Gini coefficient for imbalance measurement
   */
  private calculateGiniCoefficient(values: number[]): number {
    if (values.length === 0) return 0;

    const sorted = [...values].sort((a, b) => a - b);
    const n = sorted.length;
    const sum = sorted.reduce((a, b) => a + b, 0);

    if (sum === 0) return 0;

    let cumulativeSum = 0;
    let giniSum = 0;

    for (let i = 0; i < n; i++) {
      cumulativeSum += sorted[i];
      giniSum += (2 * (i + 1) - n - 1) * sorted[i];
    }

    return giniSum / (n * sum);
  }

  /**
   * Generate recommendations for balancing
   */
  private generateBalancingRecommendations(
    byTask: Record<string, number>,
    byEnvironment: Record<string, number>,
    imbalanceScore: number
  ): string[] {
    const recommendations: string[] = [];

    if (imbalanceScore > 0.5) {
      recommendations.push('High task imbalance detected. Consider collecting more data for underrepresented tasks.');
    }

    const taskCounts = Object.entries(byTask);
    const maxCount = Math.max(...taskCounts.map(([, c]) => c));
    const underrepresented = taskCounts.filter(([, c]) => c < maxCount * 0.1);

    for (const [task, count] of underrepresented) {
      recommendations.push(
        `Task "${task}" is underrepresented (${count} samples). Consider collecting ${Math.ceil(maxCount * 0.3 - count)} more demonstrations.`
      );
    }

    const envCounts = Object.values(byEnvironment);
    const envImbalance = this.calculateGiniCoefficient(envCounts);
    if (envImbalance > 0.4) {
      recommendations.push('Environment distribution is imbalanced. Diversify collection environments.');
    }

    return recommendations;
  }

  // ============================================================================
  // DATASET BALANCING (Re-Mix Style)
  // ============================================================================

  /**
   * Compute optimal sampling weights using DRO
   */
  computeOptimalWeights(
    distribution: Record<string, number>,
    config: BalancingConfig
  ): SamplingWeight[] {
    const categories = Object.entries(distribution);
    const total = categories.reduce((sum, [, count]) => sum + count, 0);

    let weights: SamplingWeight[];

    switch (config.method) {
      case 'uniform': {
        // Uniform sampling: equal weight to all categories
        const targetPerCategory = Math.ceil(total / categories.length);
        weights = categories.map(([category, count]) => ({
          category,
          originalCount: count,
          targetCount: Math.min(count, config.maxSamplesPerCategory ?? Infinity),
          weight: count > 0 ? targetPerCategory / count : 0,
        }));
        break;
      }

      case 'sqrt': {
        // Square root balancing: weight by sqrt of inverse frequency
        const sqrtSum = categories.reduce((sum, [, count]) => sum + Math.sqrt(count), 0);
        weights = categories.map(([category, count]) => ({
          category,
          originalCount: count,
          targetCount: Math.ceil((Math.sqrt(count) / sqrtSum) * (config.targetSize ?? total)),
          weight: Math.sqrt(total / count) / sqrtSum,
        }));
        break;
      }

      case 'dro': {
        // DRO: Maximize worst-case performance
        // Simplified: weight by inverse frequency with capping
        const minCount = Math.min(...categories.map(([, c]) => c));
        weights = categories.map(([category, count]) => {
          const invWeight = minCount / count;
          const cappedWeight = Math.min(invWeight, 3.0); // Cap at 3x
          return {
            category,
            originalCount: count,
            targetCount: Math.ceil(count * cappedWeight),
            weight: cappedWeight,
          };
        });
        break;
      }

      default:
        weights = categories.map(([category, count]) => ({
          category,
          originalCount: count,
          targetCount: count,
          weight: 1.0,
        }));
    }

    // Apply min/max constraints
    if (config.minSamplesPerCategory || config.maxSamplesPerCategory) {
      weights = weights.map((w) => ({
        ...w,
        targetCount: Math.max(
          config.minSamplesPerCategory ?? 0,
          Math.min(w.targetCount, config.maxSamplesPerCategory ?? Infinity)
        ),
      }));
    }

    return weights;
  }

  /**
   * Create balanced subset indices
   */
  createBalancedSubset(
    trajectories: Array<{ task?: string; environment?: string }>,
    config: BalancingConfig
  ): number[] {
    const groupKey = config.groupBy;
    const groups: Map<string, number[]> = new Map();

    // Group trajectory indices by category
    for (let i = 0; i < trajectories.length; i++) {
      const key =
        groupKey === 'task'
          ? (trajectories[i].task ?? 'unknown')
          : groupKey === 'environment'
            ? (trajectories[i].environment ?? 'unknown')
            : 'all';

      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(i);
    }

    // Compute distribution and weights
    const distribution: Record<string, number> = {};
    for (const [key, indices] of groups) {
      distribution[key] = indices.length;
    }

    const weights = this.computeOptimalWeights(distribution, config);

    // Sample from each group
    const selectedIndices: number[] = [];
    for (const w of weights) {
      const indices = groups.get(w.category) ?? [];
      const sampled = this.sampleWithReplacement(
        indices,
        w.targetCount,
        w.weight > 1
      );
      selectedIndices.push(...sampled);
    }

    return selectedIndices;
  }

  /**
   * Sample from array with or without replacement
   */
  private sampleWithReplacement(
    indices: number[],
    count: number,
    withReplacement: boolean
  ): number[] {
    if (count >= indices.length || !withReplacement) {
      return indices.slice(0, count);
    }

    const sampled: number[] = [];
    const available = [...indices];

    for (let i = 0; i < count; i++) {
      const idx = Math.floor(Math.random() * available.length);
      sampled.push(available[idx]);
      if (!withReplacement) {
        available.splice(idx, 1);
      }
    }

    return sampled;
  }

  // ============================================================================
  // QUALITY-BASED CURATION
  // ============================================================================

  /**
   * Filter trajectories by quality score
   */
  filterByQuality(
    trajectories: Array<{ qualityScore?: number }>,
    minScore: number
  ): { indices: number[]; removed: number[] } {
    const indices: number[] = [];
    const removed: number[] = [];

    for (let i = 0; i < trajectories.length; i++) {
      if ((trajectories[i].qualityScore ?? 100) >= minScore) {
        indices.push(i);
      } else {
        removed.push(i);
      }
    }

    return { indices, removed };
  }

  /**
   * Find near-duplicate trajectories
   */
  findDuplicates(
    trajectories: Array<{ positions: number[][] }>,
    similarityThreshold: number = 0.95
  ): DuplicateGroup[] {
    const groups: DuplicateGroup[] = [];
    const assigned = new Set<number>();

    for (let i = 0; i < trajectories.length; i++) {
      if (assigned.has(i)) continue;

      const group: DuplicateGroup = {
        representativeIndex: i,
        duplicateIndices: [],
        similarityScore: 1.0,
      };

      for (let j = i + 1; j < trajectories.length; j++) {
        if (assigned.has(j)) continue;

        const similarity = this.computeTrajectorySimilarity(
          trajectories[i].positions,
          trajectories[j].positions
        );

        if (similarity >= similarityThreshold) {
          group.duplicateIndices.push(j);
          group.similarityScore = Math.min(group.similarityScore, similarity);
          assigned.add(j);
        }
      }

      if (group.duplicateIndices.length > 0) {
        assigned.add(i);
        groups.push(group);
      }
    }

    return groups;
  }

  /**
   * Compute similarity between two trajectories
   */
  private computeTrajectorySimilarity(
    traj1: number[][],
    traj2: number[][]
  ): number {
    // Use DTW-based distance normalized to similarity
    const dtwResult = dataQualityService.computeDTWDistance(traj1, traj2);
    // Convert distance to similarity (0-1)
    return Math.exp(-dtwResult.normalizedDistance);
  }

  /**
   * Identify potentially harmful demonstrations (CUPID-style)
   */
  identifyHarmful(
    trajectories: Array<{
      positions: number[][];
      velocities?: number[][];
      hasCollision?: boolean;
      hasViolation?: boolean;
    }>
  ): number[] {
    const harmful: number[] = [];

    for (let i = 0; i < trajectories.length; i++) {
      const traj = trajectories[i];

      // Flag if collision or violation recorded
      if (traj.hasCollision || traj.hasViolation) {
        harmful.push(i);
        continue;
      }

      // Check for sudden stops (potential collision avoidance)
      if (traj.velocities) {
        for (let j = 1; j < traj.velocities.length; j++) {
          const prevVel = Math.sqrt(
            traj.velocities[j - 1].reduce((s, v) => s + v * v, 0)
          );
          const currVel = Math.sqrt(
            traj.velocities[j].reduce((s, v) => s + v * v, 0)
          );

          // Sudden stop: velocity drops by >90% in one step
          if (prevVel > 0.1 && currVel < prevVel * 0.1) {
            harmful.push(i);
            break;
          }
        }
      }
    }

    return harmful;
  }

  // ============================================================================
  // HINDSIGHT RELABELING
  // ============================================================================

  /**
   * Relabel failed trajectories with achieved goals
   */
  relabelWithHindsight(
    trajectory: {
      positions: number[][];
      originalInstruction: string;
      success: boolean;
    },
    achievedStateDescriber: (finalPosition: number[]) => string
  ): RelabelingResult | null {
    if (trajectory.success) {
      return null; // Don't relabel successful trajectories
    }

    if (trajectory.positions.length === 0) {
      return null;
    }

    const finalPosition = trajectory.positions[trajectory.positions.length - 1];
    const achievedState = achievedStateDescriber(finalPosition);

    // Generate new instruction based on achieved state
    const newInstruction = this.generateAchievedInstruction(achievedState);

    return {
      trajectoryIndex: 0, // Caller should set this
      originalInstruction: trajectory.originalInstruction,
      newInstruction,
      reason: `Failed to achieve "${trajectory.originalInstruction}", relabeled to achieved state`,
    };
  }

  /**
   * Generate instruction for achieved state
   */
  private generateAchievedInstruction(achievedState: string): string {
    // Simple template-based generation
    const templates = [
      `Move the robot arm to ${achievedState}`,
      `Position the end effector at ${achievedState}`,
      `Reach ${achievedState}`,
    ];

    return templates[Math.floor(Math.random() * templates.length)];
  }

  // ============================================================================
  // TASK TAXONOMY
  // ============================================================================

  /**
   * Get task taxonomy
   */
  getTaxonomy(): TaskTaxonomy[] {
    return this.taxonomy;
  }

  /**
   * Categorize a trajectory based on instruction
   */
  categorizeTrajectory(instruction: string): CategorizationResult {
    const lowerInstr = instruction.toLowerCase();

    // Simple keyword matching (would use ML in production)
    for (const task of this.taxonomy) {
      const keywords = task.name.toLowerCase().split(' ');
      const matchCount = keywords.filter((kw) => lowerInstr.includes(kw)).length;

      if (matchCount >= keywords.length * 0.5) {
        return {
          taxonomyId: task.id,
          taxonomyName: task.name,
          level: task.level,
          confidence: matchCount / keywords.length,
          parentTasks: task.children,
        };
      }
    }

    // Default to primitive
    return {
      taxonomyId: 'unknown',
      taxonomyName: 'Unknown Task',
      level: 'primitive',
      confidence: 0.3,
    };
  }

  // ============================================================================
  // FULL CURATION PIPELINE
  // ============================================================================

  /**
   * Run full curation pipeline
   */
  runCurationPipeline(
    datasetId: string,
    trajectories: Array<{
      positions: number[][];
      velocities?: number[][];
      qualityScore?: number;
      hasCollision?: boolean;
      hasViolation?: boolean;
      originalInstruction?: string;
      success?: boolean;
    }>,
    config: CurationConfig = { minQualityScore: 50, deduplicationThreshold: 0.95, identifyHarmful: true, hindsightRelabeling: false }
  ): CurationResult {
    const startTime = Date.now();
    const removedIndices: number[] = [];
    const flaggedIndices: number[] = [];

    // Step 1: Filter by quality
    let removed = 0;
    if (config.minQualityScore !== undefined) {
      const { removed: lowQuality } = this.filterByQuality(
        trajectories,
        config.minQualityScore
      );
      removedIndices.push(...lowQuality);
      removed = lowQuality.length;
    }

    // Step 2: Remove duplicates
    let duplicates = 0;
    if (config.deduplicationThreshold !== undefined) {
      const groups = this.findDuplicates(
        trajectories,
        config.deduplicationThreshold
      );
      for (const group of groups) {
        removedIndices.push(...group.duplicateIndices);
        duplicates += group.duplicateIndices.length;
      }
    }

    // Step 3: Identify harmful
    let harmful = 0;
    if (config.identifyHarmful) {
      const harmfulIndices = this.identifyHarmful(trajectories);
      flaggedIndices.push(...harmfulIndices);
      harmful = harmfulIndices.length;
    }

    // Step 4: Hindsight relabeling (just count, actual relabeling happens elsewhere)
    let relabeled = 0;
    if (config.hindsightRelabeling) {
      const failedTrajectories = trajectories.filter((t) => t.success === false);
      relabeled = failedTrajectories.length;
    }

    const result: CurationResult = {
      datasetId,
      originalCount: trajectories.length,
      filteredCount:
        trajectories.length - new Set([...removedIndices]).size,
      removedLowQuality: removed,
      removedDuplicates: duplicates,
      flaggedHarmful: harmful,
      relabeled,
      processingTime: Date.now() - startTime,
      config,
      removedIndices: [...new Set(removedIndices)],
      flaggedIndices: [...new Set(flaggedIndices)],
    };

    this.emitEvent({
      type: 'curation:completed',
      datasetId,
      result,
      timestamp: new Date(),
    });

    return result;
  }

  // ============================================================================
  // EVENT HANDLING
  // ============================================================================

  private emitEvent(event: CurationEvent): void {
    this.emit('curation:event', event);
    this.emit(event.type, event);
  }
}

// ============================================================================
// SINGLETON EXPORT
// ============================================================================

export const dataCurationService = DataCurationService.getInstance();
