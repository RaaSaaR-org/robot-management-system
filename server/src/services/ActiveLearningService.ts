/**
 * @file ActiveLearningService.ts
 * @description Service for active learning prioritization and uncertainty tracking
 * @feature datasets
 */

import { EventEmitter } from 'events';
import { PrismaClient } from '@prisma/client';
import type {
  PredictionLog,
  CreatePredictionLogRequest,
  CategoryUncertainty,
  UncertaintyAnalysis,
  LearningProgress,
  CollectionPriority,
  CollectionPrioritiesResponse,
  CollectionTarget,
  CollectionProgress,
  ProgressSummary,
  PriorityWeights,
  PriorityScoringConfig,
  DiversityMetrics,
  DiversityAnalysis,
  ActiveLearningEvent,
  CollectionTargetType,
  CollectionTargetStatus,
} from '../types/active-learning.types.js';
import {
  DEFAULT_PRIORITY_WEIGHTS,
  DEFAULT_SCORING_CONFIG,
} from '../types/active-learning.types.js';

// ============================================================================
// ACTIVE LEARNING SERVICE
// ============================================================================

/**
 * Service for active learning data collection prioritization
 */
export class ActiveLearningService extends EventEmitter {
  private static instance: ActiveLearningService;

  private prisma: PrismaClient;
  private config: PriorityScoringConfig = DEFAULT_SCORING_CONFIG;

  private constructor() {
    super();
    this.prisma = new PrismaClient();
  }

  /**
   * Get singleton instance
   */
  static getInstance(): ActiveLearningService {
    if (!ActiveLearningService.instance) {
      ActiveLearningService.instance = new ActiveLearningService();
    }
    return ActiveLearningService.instance;
  }

  // ============================================================================
  // PREDICTION LOGGING
  // ============================================================================

  /**
   * Log a prediction with confidence
   */
  async logPrediction(request: CreatePredictionLogRequest): Promise<PredictionLog> {
    const log = await this.prisma.predictionLog.create({
      data: {
        modelId: request.modelId,
        robotId: request.robotId,
        inputHash: request.inputHash,
        taskCategory: request.taskCategory,
        environment: request.environment,
        confidence: request.confidence,
        wasCorrect: request.wasCorrect,
        metadata: request.metadata ? JSON.parse(JSON.stringify(request.metadata)) : undefined,
      },
    });

    this.emitEvent({
      type: 'prediction:logged',
      modelId: request.modelId,
      data: { predictionId: log.id, confidence: request.confidence },
      timestamp: new Date(),
    });

    return this.toPredictionLog(log);
  }

  /**
   * Log multiple predictions in batch
   */
  async logPredictionsBatch(requests: CreatePredictionLogRequest[]): Promise<PredictionLog[]> {
    const data = requests.map((req) => ({
      modelId: req.modelId,
      robotId: req.robotId,
      inputHash: req.inputHash,
      taskCategory: req.taskCategory,
      environment: req.environment,
      confidence: req.confidence,
      wasCorrect: req.wasCorrect,
      metadata: req.metadata ? JSON.parse(JSON.stringify(req.metadata)) : undefined,
    }));

    await this.prisma.predictionLog.createMany({ data });

    // Get the created logs by fetching recent logs for these models
    const modelIds = [...new Set(requests.map((r) => r.modelId))];
    const logs = await this.prisma.predictionLog.findMany({
      where: {
        modelId: { in: modelIds },
      },
      orderBy: { timestamp: 'desc' },
      take: requests.length,
    });

    return logs.map((l) => this.toPredictionLog(l));
  }

  /**
   * Get prediction logs for a model
   */
  async getPredictionLogs(
    modelId: string,
    options?: {
      limit?: number;
      taskCategory?: string;
      environment?: string;
      minConfidence?: number;
      maxConfidence?: number;
      startDate?: Date;
      endDate?: Date;
    }
  ): Promise<PredictionLog[]> {
    const where: Record<string, unknown> = { modelId };

    if (options?.taskCategory) {
      where.taskCategory = options.taskCategory;
    }
    if (options?.environment) {
      where.environment = options.environment;
    }
    if (options?.minConfidence !== undefined || options?.maxConfidence !== undefined) {
      where.confidence = {};
      if (options?.minConfidence !== undefined) {
        (where.confidence as Record<string, number>).gte = options.minConfidence;
      }
      if (options?.maxConfidence !== undefined) {
        (where.confidence as Record<string, number>).lte = options.maxConfidence;
      }
    }
    if (options?.startDate || options?.endDate) {
      where.timestamp = {};
      if (options?.startDate) {
        (where.timestamp as Record<string, Date>).gte = options.startDate;
      }
      if (options?.endDate) {
        (where.timestamp as Record<string, Date>).lte = options.endDate;
      }
    }

    const logs = await this.prisma.predictionLog.findMany({
      where,
      orderBy: { timestamp: 'desc' },
      take: options?.limit,
    });

    return logs.map((l) => this.toPredictionLog(l));
  }

  // ============================================================================
  // UNCERTAINTY ANALYSIS
  // ============================================================================

  /**
   * Compute uncertainty analysis for a model
   */
  async computeUncertaintyAnalysis(
    modelId: string,
    windowDays: number = 7
  ): Promise<UncertaintyAnalysis> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - windowDays);

    const recentLogs = await this.prisma.predictionLog.findMany({
      where: {
        modelId,
        timestamp: { gte: cutoffDate },
      },
    });

    // Group by task
    const byTaskMap = new Map<string, typeof recentLogs>();
    for (const log of recentLogs) {
      const existing = byTaskMap.get(log.taskCategory) || [];
      existing.push(log);
      byTaskMap.set(log.taskCategory, existing);
    }

    const byTask: Record<string, CategoryUncertainty> = {};
    for (const [task, logs] of byTaskMap) {
      byTask[task] = this.computeCategoryUncertainty(
        task,
        logs.map((l) => this.toPredictionLog(l))
      );
    }

    // Group by environment
    const byEnvMap = new Map<string, typeof recentLogs>();
    for (const log of recentLogs) {
      const existing = byEnvMap.get(log.environment) || [];
      existing.push(log);
      byEnvMap.set(log.environment, existing);
    }

    const byEnvironment: Record<string, CategoryUncertainty> = {};
    for (const [env, logs] of byEnvMap) {
      byEnvironment[env] = this.computeCategoryUncertainty(
        env,
        logs.map((l) => this.toPredictionLog(l))
      );
    }

    // Compute overall uncertainty
    const allConfidences = recentLogs.map((log) => log.confidence);
    const overallUncertainty =
      allConfidences.length > 0
        ? 1 - allConfidences.reduce((a, b) => a + b, 0) / allConfidences.length
        : 0.5;

    const highUncertaintyCount = recentLogs.filter(
      (log) => log.confidence < 1 - this.config.highUncertaintyThreshold
    ).length;

    const analysis: UncertaintyAnalysis = {
      modelId,
      analysisDate: new Date(),
      byTask,
      byEnvironment,
      overallUncertainty,
      totalPredictions: recentLogs.length,
      highUncertaintyCount,
      highUncertaintyThreshold: this.config.highUncertaintyThreshold,
    };

    this.emitEvent({
      type: 'uncertainty:analyzed',
      modelId,
      data: analysis,
      timestamp: new Date(),
    });

    return analysis;
  }

  /**
   * Compute uncertainty metrics for a category
   */
  private computeCategoryUncertainty(
    category: string,
    logs: PredictionLog[]
  ): CategoryUncertainty {
    if (logs.length === 0) {
      return {
        category,
        meanUncertainty: 0.5,
        stdUncertainty: 0,
        sampleCount: 0,
        minConfidence: 0,
        maxConfidence: 0,
        recentTrend: 'stable',
      };
    }

    const confidences = logs.map((log) => log.confidence);
    const uncertainties = confidences.map((c) => 1 - c);

    const mean = uncertainties.reduce((a, b) => a + b, 0) / uncertainties.length;
    const variance =
      uncertainties.reduce((sum, u) => sum + Math.pow(u - mean, 2), 0) /
      uncertainties.length;
    const std = Math.sqrt(variance);

    // Compute trend by comparing recent vs older predictions
    const sortedLogs = [...logs].sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
    );
    const midpoint = Math.floor(sortedLogs.length / 2);
    const olderConfidences = sortedLogs.slice(0, midpoint).map((l) => l.confidence);
    const recentConfidences = sortedLogs.slice(midpoint).map((l) => l.confidence);

    const olderMean =
      olderConfidences.length > 0
        ? olderConfidences.reduce((a, b) => a + b, 0) / olderConfidences.length
        : 0.5;
    const recentMean =
      recentConfidences.length > 0
        ? recentConfidences.reduce((a, b) => a + b, 0) / recentConfidences.length
        : 0.5;

    let recentTrend: 'improving' | 'stable' | 'degrading' = 'stable';
    const trendThreshold = 0.05;
    if (recentMean - olderMean > trendThreshold) {
      recentTrend = 'improving';
    } else if (olderMean - recentMean > trendThreshold) {
      recentTrend = 'degrading';
    }

    return {
      category,
      meanUncertainty: mean,
      stdUncertainty: std,
      sampleCount: logs.length,
      minConfidence: Math.min(...confidences),
      maxConfidence: Math.max(...confidences),
      recentTrend,
    };
  }

  // ============================================================================
  // LEARNING PROGRESS
  // ============================================================================

  /**
   * Compute learning progress for a model on a task
   */
  async computeLearningProgress(
    modelId: string,
    task: string,
    windowDays: number = 14
  ): Promise<LearningProgress> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - windowDays);

    const logs = await this.prisma.predictionLog.findMany({
      where: {
        modelId,
        taskCategory: task,
        timestamp: { gte: cutoffDate },
      },
      orderBy: { timestamp: 'asc' },
    });

    if (logs.length < this.config.minSamplesForAnalysis) {
      return {
        modelId,
        task,
        windowSize: windowDays,
        improvementRate: 0,
        currentPerformance: 0.5,
        previousPerformance: 0.5,
        isPlateaued: false,
        lastUpdated: new Date(),
      };
    }

    // Split into two halves
    const midpoint = Math.floor(logs.length / 2);
    const previousLogs = logs.slice(0, midpoint);
    const currentLogs = logs.slice(midpoint);

    const previousPerformance =
      previousLogs.reduce((sum, log) => sum + log.confidence, 0) / previousLogs.length;
    const currentPerformance =
      currentLogs.reduce((sum, log) => sum + log.confidence, 0) / currentLogs.length;

    const improvementRate = currentPerformance - previousPerformance;
    const isPlateaued = Math.abs(improvementRate) < this.config.plateauThreshold;

    return {
      modelId,
      task,
      windowSize: windowDays,
      improvementRate,
      currentPerformance,
      previousPerformance,
      isPlateaued,
      plateauDuration: isPlateaued ? windowDays : undefined,
      lastUpdated: new Date(),
    };
  }

  /**
   * Identify tasks where learning has plateaued
   */
  async identifyPlateaus(modelId: string): Promise<LearningProgress[]> {
    // Get all unique tasks for the model
    const logs = await this.prisma.predictionLog.findMany({
      where: { modelId },
      select: { taskCategory: true },
      distinct: ['taskCategory'],
    });

    const tasks = logs.map((l) => l.taskCategory);
    const plateauedTasks: LearningProgress[] = [];

    for (const task of tasks) {
      const progress = await this.computeLearningProgress(modelId, task);
      if (progress.isPlateaued) {
        plateauedTasks.push(progress);
      }
    }

    return plateauedTasks;
  }

  // ============================================================================
  // COLLECTION PRIORITIES (MUSEL-INSPIRED)
  // ============================================================================

  /**
   * Compute collection priorities for a model
   */
  async computeCollectionPriorities(
    modelId: string,
    weights: PriorityWeights = DEFAULT_PRIORITY_WEIGHTS
  ): Promise<CollectionPrioritiesResponse> {
    const uncertaintyAnalysis = await this.computeUncertaintyAnalysis(modelId);
    const priorities: CollectionPriority[] = [];

    // Compute priorities for each task
    for (const [task, uncertainty] of Object.entries(uncertaintyAnalysis.byTask)) {
      const progress = await this.computeLearningProgress(modelId, task);
      const diversity = await this.computeDiversityForCategory(modelId, 'task', task);

      const priority = this.computePriorityScore(
        uncertainty,
        diversity,
        progress,
        weights
      );

      priorities.push(priority);
    }

    // Compute priorities for each environment
    for (const [env, uncertainty] of Object.entries(
      uncertaintyAnalysis.byEnvironment
    )) {
      const progress = await this.computeLearningProgress(modelId, env);
      const diversity = await this.computeDiversityForCategory(modelId, 'environment', env);

      const priority = this.computePriorityScore(
        uncertainty,
        diversity,
        progress,
        weights,
        'environment'
      );

      priorities.push(priority);
    }

    // Sort by priority score descending
    priorities.sort((a, b) => b.priorityScore - a.priorityScore);

    const highPriorityCount = priorities.filter((p) => p.priorityScore > 0.7).length;
    const totalDemosNeeded = priorities.reduce(
      (sum, p) => sum + p.estimatedDemosNeeded,
      0
    );

    const response: CollectionPrioritiesResponse = {
      modelId,
      generatedAt: new Date(),
      priorities,
      summary: {
        totalTargets: priorities.length,
        highPriorityCount,
        totalDemosNeeded,
        topRecommendation:
          priorities.length > 0
            ? priorities[0].recommendation
            : 'No collection targets identified',
      },
    };

    this.emitEvent({
      type: 'priorities:updated',
      modelId,
      data: response,
      timestamp: new Date(),
    });

    return response;
  }

  /**
   * Compute priority score using MUSEL-inspired formula
   */
  private computePriorityScore(
    uncertainty: CategoryUncertainty,
    diversity: DiversityMetrics,
    progress: LearningProgress,
    weights: PriorityWeights,
    targetType: CollectionTargetType = 'task'
  ): CollectionPriority {
    // Normalize components to 0-1 range
    const uncertaintyComponent = Math.min(1, uncertainty.meanUncertainty);
    const diversityComponent = 1 - Math.min(1, diversity.diversityRatio);
    const progressComponent = progress.isPlateaued ? 1 : 1 - Math.abs(progress.improvementRate);

    // Weighted combination
    const priorityScore =
      weights.uncertainty * uncertaintyComponent +
      weights.diversity * diversityComponent +
      weights.progress * progressComponent;

    // Estimate demos needed based on uncertainty and current samples
    const estimatedDemosNeeded = Math.ceil(
      (uncertaintyComponent * 50 + diversityComponent * 30) *
        (1 + (progress.isPlateaued ? 0.5 : 0))
    );

    // Generate recommendation
    const reasoning: string[] = [];
    if (uncertaintyComponent > 0.5) {
      reasoning.push('High uncertainty indicates model struggles with this category');
    }
    if (diversityComponent > 0.5) {
      reasoning.push('Low diversity suggests need for more varied examples');
    }
    if (progress.isPlateaued) {
      reasoning.push('Learning has plateaued, diverse data may help');
    }
    if (uncertainty.recentTrend === 'degrading') {
      reasoning.push('Performance is degrading, urgent attention needed');
    }

    const recommendation = this.generateRecommendation(
      uncertainty.category,
      targetType,
      priorityScore,
      reasoning
    );

    return {
      target: uncertainty.category,
      targetType,
      priorityScore,
      uncertaintyComponent,
      diversityComponent,
      progressComponent,
      estimatedDemosNeeded,
      currentDemoCount: uncertainty.sampleCount,
      recommendation,
      reasoning,
    };
  }

  /**
   * Generate human-readable recommendation
   */
  private generateRecommendation(
    category: string,
    targetType: CollectionTargetType,
    score: number,
    reasoning: string[]
  ): string {
    const urgency =
      score > 0.8 ? 'Urgent' : score > 0.6 ? 'High priority' : 'Consider';

    const typeLabel = targetType === 'task' ? 'task' : 'environment';

    if (reasoning.length === 0) {
      return `${urgency}: Collect more data for ${typeLabel} "${category}"`;
    }

    return `${urgency}: Collect more data for ${typeLabel} "${category}". ${reasoning[0]}.`;
  }

  /**
   * Compute diversity metrics for a category
   */
  private async computeDiversityForCategory(
    modelId: string,
    type: 'task' | 'environment',
    category: string
  ): Promise<DiversityMetrics> {
    const where: Record<string, string> = { modelId };
    if (type === 'task') {
      where.taskCategory = category;
    } else {
      where.environment = category;
    }

    const logs = await this.prisma.predictionLog.findMany({ where });

    const uniqueInputs = new Set(logs.map((log) => log.inputHash)).size;
    const totalInputs = logs.length;
    const diversityRatio = totalInputs > 0 ? uniqueInputs / totalInputs : 0;

    return {
      category,
      uniqueInputs,
      totalInputs,
      diversityRatio,
      clusterCount: Math.ceil(uniqueInputs / 10), // Simplified clustering
      averageClusterSize: uniqueInputs > 0 ? totalInputs / uniqueInputs : 0,
      sparseRegions: [],
    };
  }

  // ============================================================================
  // COLLECTION TARGETS
  // ============================================================================

  /**
   * Create a collection target
   */
  async createCollectionTarget(
    targetType: CollectionTargetType,
    targetName: string,
    estimatedDemos: number,
    priorityScore?: number
  ): Promise<CollectionTarget> {
    const target = await this.prisma.collectionTarget.create({
      data: {
        targetType,
        targetName,
        estimatedDemos,
        priorityScore: priorityScore ?? 0.5,
        collectedDemos: 0,
        status: 'active',
      },
    });

    this.emitEvent({
      type: 'target:created',
      targetId: target.id,
      data: this.toCollectionTarget(target),
      timestamp: new Date(),
    });

    return this.toCollectionTarget(target);
  }

  /**
   * Get a collection target
   */
  async getCollectionTarget(targetId: string): Promise<CollectionTarget | undefined> {
    const target = await this.prisma.collectionTarget.findUnique({
      where: { id: targetId },
    });
    return target ? this.toCollectionTarget(target) : undefined;
  }

  /**
   * List collection targets
   */
  async listCollectionTargets(options?: {
    status?: CollectionTargetStatus;
    targetType?: CollectionTargetType;
    minPriorityScore?: number;
  }): Promise<CollectionTarget[]> {
    const where: Record<string, unknown> = {};

    if (options?.status) {
      where.status = options.status;
    }
    if (options?.targetType) {
      where.targetType = options.targetType;
    }
    if (options?.minPriorityScore !== undefined) {
      where.priorityScore = { gte: options.minPriorityScore };
    }

    const targets = await this.prisma.collectionTarget.findMany({
      where,
      orderBy: { priorityScore: 'desc' },
    });

    return targets.map((t) => this.toCollectionTarget(t));
  }

  /**
   * Update collection progress
   */
  async updateCollectionProgress(
    targetId: string,
    demosCollected: number,
    uncertaintyAfter?: number
  ): Promise<CollectionTarget | undefined> {
    const target = await this.prisma.collectionTarget.findUnique({
      where: { id: targetId },
    });
    if (!target) return undefined;

    const newCollectedDemos = target.collectedDemos + demosCollected;
    const newStatus =
      newCollectedDemos >= target.estimatedDemos ? 'completed' : target.status;

    const updated = await this.prisma.collectionTarget.update({
      where: { id: targetId },
      data: {
        collectedDemos: newCollectedDemos,
        status: newStatus,
      },
    });

    if (newStatus === 'completed') {
      this.emitEvent({
        type: 'target:completed',
        targetId,
        data: this.toCollectionTarget(updated),
        timestamp: new Date(),
      });
    } else {
      this.emitEvent({
        type: 'progress:updated',
        targetId,
        data: { demosCollected, total: newCollectedDemos },
        timestamp: new Date(),
      });
    }

    return this.toCollectionTarget(updated);
  }

  /**
   * Get progress summary
   */
  async getProgressSummary(): Promise<ProgressSummary> {
    const targets = await this.prisma.collectionTarget.findMany();

    const completedTargets = targets.filter((t) => t.status === 'completed').length;
    const activeTargets = targets.filter((t) => t.status === 'active').length;
    const totalDemosCollected = targets.reduce((sum, t) => sum + t.collectedDemos, 0);
    const totalDemosNeeded = targets.reduce((sum, t) => sum + t.estimatedDemos, 0);
    const overallProgress =
      totalDemosNeeded > 0 ? totalDemosCollected / totalDemosNeeded : 0;

    return {
      totalTargets: targets.length,
      completedTargets,
      activeTargets,
      totalDemosCollected,
      totalDemosNeeded,
      overallProgress,
      averageUncertaintyReduction: 0, // Would need before/after tracking
    };
  }

  // ============================================================================
  // DIVERSITY ANALYSIS
  // ============================================================================

  /**
   * Compute full diversity analysis
   */
  async computeDiversityAnalysis(modelId: string): Promise<DiversityAnalysis> {
    // Get unique tasks and environments
    const taskLogs = await this.prisma.predictionLog.findMany({
      where: { modelId },
      select: { taskCategory: true },
      distinct: ['taskCategory'],
    });

    const envLogs = await this.prisma.predictionLog.findMany({
      where: { modelId },
      select: { environment: true },
      distinct: ['environment'],
    });

    const tasks = taskLogs.map((l) => l.taskCategory);
    const environments = envLogs.map((l) => l.environment);

    const byTask: Record<string, DiversityMetrics> = {};
    for (const task of tasks) {
      byTask[task] = await this.computeDiversityForCategory(modelId, 'task', task);
    }

    const byEnvironment: Record<string, DiversityMetrics> = {};
    for (const env of environments) {
      byEnvironment[env] = await this.computeDiversityForCategory(
        modelId,
        'environment',
        env
      );
    }

    // Overall diversity score
    const allRatios = [
      ...Object.values(byTask).map((m) => m.diversityRatio),
      ...Object.values(byEnvironment).map((m) => m.diversityRatio),
    ];
    const overallDiversityScore =
      allRatios.length > 0
        ? allRatios.reduce((a, b) => a + b, 0) / allRatios.length
        : 0;

    // Generate recommendations
    const recommendations: string[] = [];
    for (const [task, metrics] of Object.entries(byTask)) {
      if (metrics.diversityRatio < 0.3) {
        recommendations.push(
          `Task "${task}" has low diversity (${(metrics.diversityRatio * 100).toFixed(1)}%). Collect more varied examples.`
        );
      }
    }

    return {
      modelId,
      analysisDate: new Date(),
      byTask,
      byEnvironment,
      overallDiversityScore,
      recommendations,
    };
  }

  // ============================================================================
  // CONFIGURATION
  // ============================================================================

  /**
   * Update scoring configuration
   */
  updateConfig(config: Partial<PriorityScoringConfig>): PriorityScoringConfig {
    this.config = {
      ...this.config,
      ...config,
      weights: {
        ...this.config.weights,
        ...config.weights,
      },
    };
    return this.config;
  }

  /**
   * Get current configuration
   */
  getConfig(): PriorityScoringConfig {
    return { ...this.config };
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  /**
   * Convert Prisma model to PredictionLog type
   */
  private toPredictionLog(log: {
    id: string;
    modelId: string;
    robotId: string;
    inputHash: string;
    taskCategory: string;
    environment: string;
    confidence: number;
    wasCorrect: boolean | null;
    metadata: unknown;
    timestamp: Date;
  }): PredictionLog {
    return {
      id: log.id,
      modelId: log.modelId,
      robotId: log.robotId,
      inputHash: log.inputHash,
      taskCategory: log.taskCategory,
      environment: log.environment,
      confidence: log.confidence,
      wasCorrect: log.wasCorrect ?? undefined,
      metadata: log.metadata as Record<string, unknown> | undefined,
      timestamp: log.timestamp,
    };
  }

  /**
   * Convert Prisma model to CollectionTarget type
   */
  private toCollectionTarget(target: {
    id: string;
    targetType: string;
    targetName: string;
    priorityScore: number;
    estimatedDemos: number;
    collectedDemos: number;
    status: string;
    createdAt: Date;
    updatedAt: Date;
  }): CollectionTarget {
    return {
      id: target.id,
      targetType: target.targetType as CollectionTargetType,
      targetName: target.targetName,
      priorityScore: target.priorityScore,
      estimatedDemos: target.estimatedDemos,
      collectedDemos: target.collectedDemos,
      status: target.status as CollectionTargetStatus,
      createdAt: target.createdAt,
      updatedAt: target.updatedAt,
    };
  }

  // ============================================================================
  // EVENT HANDLING
  // ============================================================================

  private emitEvent(event: ActiveLearningEvent): void {
    this.emit('active-learning:event', event);
    this.emit(event.type, event);
  }
}

// ============================================================================
// SINGLETON EXPORT
// ============================================================================

export const activeLearningService = ActiveLearningService.getInstance();
