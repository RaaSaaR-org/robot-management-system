/**
 * @file EvaluationService.ts
 * @description Service for managing VLA model evaluation episodes
 * @feature evaluation
 */

import { prisma } from '../database/index.js';
import { episodeRewardRepository, type EpisodeReward } from '../repositories/index.js';
import type { RewardType } from '../types/vla.types.js';
import type { SubmitRewardModelJobRequest } from '../types/training.types.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Wire shape of an EpisodeReward in API responses (TASK-179 contract §3) —
 * `curve` is parsed to number[] by the repository.
 */
export type EpisodeRewardDto = EpisodeReward;

/** Job summary embedded in GET /api/evaluation/reward-model/:jobId. */
export interface RewardModelJobStatus {
  id: string;
  status: string;
  progress: number;
  error?: string;
}

/** Response of GET /api/evaluation/reward-model/:jobId. */
export interface RewardModelJobResponse {
  job: RewardModelJobStatus;
  rewards: EpisodeRewardDto[];
}

export interface RecordEpisodeDto {
  robotId: string;
  modelVersion: string;
  taskPrompt: string;
  startedAt: string | Date;
  endedAt: string | Date;
  durationMs: number;
  success: boolean;
  errorType?: string;
  videoUrl?: string;
  metadata?: Record<string, unknown>;
}

export type EvaluationPeriod = '24h' | '7d' | '30d';

export interface EpisodeFilters {
  robotId?: string;
  modelVersion?: string;
  period?: EvaluationPeriod;
  success?: boolean;
  page?: number;
  limit?: number;
}

export interface SuccessRateResult {
  successRate: number;
  totalEpisodes: number;
  successfulEpisodes: number;
  period: EvaluationPeriod;
}

export interface ErrorBreakdownItem {
  errorType: string;
  count: number;
  percentage: number;
}

export interface ModelComparisonResult {
  versionA: ModelStats;
  versionB: ModelStats;
}

export interface ModelStats {
  modelVersion: string;
  successRate: number;
  totalEpisodes: number;
  avgDurationMs: number;
  errorBreakdown: ErrorBreakdownItem[];
}

// ============================================================================
// SERVICE
// ============================================================================

export class EvaluationService {
  private static instance: EvaluationService;

  private constructor() {}

  static getInstance(): EvaluationService {
    if (!EvaluationService.instance) {
      EvaluationService.instance = new EvaluationService();
    }
    return EvaluationService.instance;
  }

  /**
   * Get the start date for a given period
   */
  private getPeriodStart(period: EvaluationPeriod): Date {
    const now = new Date();
    switch (period) {
      case '24h':
        return new Date(now.getTime() - 24 * 60 * 60 * 1000);
      case '7d':
        return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      case '30d':
        return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }
  }

  /**
   * Build where clause from common filters
   */
  private buildWhere(filters: { robotId?: string; modelVersion?: string; period?: EvaluationPeriod; success?: boolean }) {
    const where: Record<string, unknown> = {};
    if (filters.robotId) where.robotId = filters.robotId;
    if (filters.modelVersion) where.modelVersion = filters.modelVersion;
    if (filters.period) {
      where.startedAt = { gte: this.getPeriodStart(filters.period) };
    }
    if (filters.success !== undefined) where.success = filters.success;
    return where;
  }

  // ==========================================================================
  // REWARD-MODEL EVALUATION (LeRobot 0.6.0 Robometer/TOPReward, TASK-179 §3)
  // ==========================================================================

  /**
   * Start a reward-model evaluation: creates a TrainingJob of kind
   * `reward_model` (baseModel mirrors the rewardType) that a training-worker
   * claims over HTTP. Returns the created job id.
   */
  async startRewardModelEvaluation(request: SubmitRewardModelJobRequest): Promise<{ jobId: string }> {
    // Lazy import to keep this service's static dependency graph light (the
    // training service pulls in NATS messaging).
    const { trainingJobService } = await import('./TrainingJobService.js');
    const job = await trainingJobService.submitRewardModelJob(request);
    return { jobId: job.id };
  }

  /**
   * Get a reward_model job's status plus the EpisodeReward rows it has
   * produced so far. Returns null when the job does not exist.
   */
  async getRewardModelJob(jobId: string): Promise<RewardModelJobResponse | null> {
    const { trainingJobService } = await import('./TrainingJobService.js');
    const job = await trainingJobService.getJob(jobId);
    if (!job) {
      return null;
    }
    const rewards = await episodeRewardRepository.findByJob(jobId);
    return {
      job: {
        id: job.id,
        status: job.status,
        progress: job.progress,
        ...(job.errorMessage ? { error: job.errorMessage } : {}),
      },
      rewards,
    };
  }

  /**
   * List episode rewards for a dataset (curves parsed to number[]).
   */
  async getRewards(datasetId: string, rewardType?: RewardType): Promise<EpisodeRewardDto[]> {
    return episodeRewardRepository.findByDataset(datasetId, rewardType);
  }

  /**
   * Record a new evaluation episode
   */
  async recordEpisode(dto: RecordEpisodeDto) {
    const episode = await prisma.evaluationEpisode.create({
      data: {
        robotId: dto.robotId,
        modelVersion: dto.modelVersion,
        taskPrompt: dto.taskPrompt,
        startedAt: new Date(dto.startedAt),
        endedAt: new Date(dto.endedAt),
        durationMs: dto.durationMs,
        success: dto.success,
        errorType: dto.errorType ?? null,
        videoUrl: dto.videoUrl ?? null,
        metadata: dto.metadata ? JSON.stringify(dto.metadata) : '{}',
      },
      include: { robot: true },
    });
    return episode;
  }

  /**
   * Get success rate for given filters
   */
  async getSuccessRate(
    robotId?: string,
    modelVersion?: string,
    period: EvaluationPeriod = '24h'
  ): Promise<SuccessRateResult> {
    const where = this.buildWhere({ robotId, modelVersion, period });

    const totalEpisodes = await prisma.evaluationEpisode.count({ where });
    const successfulEpisodes = await prisma.evaluationEpisode.count({
      where: { ...where, success: true },
    });

    return {
      successRate: totalEpisodes > 0 ? (successfulEpisodes / totalEpisodes) * 100 : 0,
      totalEpisodes,
      successfulEpisodes,
      period,
    };
  }

  /**
   * Get episodes with pagination and filters
   */
  async getEpisodes(filters: EpisodeFilters) {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 20;
    const skip = (page - 1) * limit;

    const where = this.buildWhere(filters);

    const [episodes, total] = await Promise.all([
      prisma.evaluationEpisode.findMany({
        where,
        include: { robot: { select: { id: true, name: true, model: true } } },
        orderBy: { startedAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.evaluationEpisode.count({ where }),
    ]);

    return {
      episodes,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Get a single episode by ID
   */
  async getEpisodeById(id: string) {
    return prisma.evaluationEpisode.findUnique({
      where: { id },
      include: { robot: { select: { id: true, name: true, model: true } } },
    });
  }

  /**
   * Get error breakdown by type
   */
  async getErrorBreakdown(
    robotId?: string,
    modelVersion?: string,
    period: EvaluationPeriod = '24h'
  ): Promise<ErrorBreakdownItem[]> {
    const where = this.buildWhere({ robotId, modelVersion, period, success: false });

    const failedEpisodes = await prisma.evaluationEpisode.findMany({
      where,
      select: { errorType: true },
    });

    const totalFailed = failedEpisodes.length;
    if (totalFailed === 0) return [];

    // Aggregate error types
    const errorCounts = new Map<string, number>();
    for (const ep of failedEpisodes) {
      const errorType = ep.errorType ?? 'unknown';
      errorCounts.set(errorType, (errorCounts.get(errorType) ?? 0) + 1);
    }

    return Array.from(errorCounts.entries())
      .map(([errorType, count]) => ({
        errorType,
        count,
        percentage: (count / totalFailed) * 100,
      }))
      .sort((a, b) => b.count - a.count);
  }

  /**
   * Compare two model versions
   */
  async compareModels(
    versionA: string,
    versionB: string,
    period: EvaluationPeriod = '7d'
  ): Promise<ModelComparisonResult> {
    const [statsA, statsB] = await Promise.all([
      this.getModelStats(versionA, period),
      this.getModelStats(versionB, period),
    ]);

    return { versionA: statsA, versionB: statsB };
  }

  /**
   * Get aggregated stats for a model version
   */
  private async getModelStats(modelVersion: string, period: EvaluationPeriod): Promise<ModelStats> {
    const where = this.buildWhere({ modelVersion, period });

    const episodes = await prisma.evaluationEpisode.findMany({
      where,
      select: { success: true, durationMs: true, errorType: true },
    });

    const totalEpisodes = episodes.length;
    const successfulEpisodes = episodes.filter((e) => e.success).length;
    const avgDurationMs =
      totalEpisodes > 0
        ? Math.round(episodes.reduce((sum, e) => sum + e.durationMs, 0) / totalEpisodes)
        : 0;

    // Error breakdown
    const failedEpisodes = episodes.filter((e) => !e.success);
    const totalFailed = failedEpisodes.length;
    const errorCounts = new Map<string, number>();
    for (const ep of failedEpisodes) {
      const errorType = ep.errorType ?? 'unknown';
      errorCounts.set(errorType, (errorCounts.get(errorType) ?? 0) + 1);
    }
    const errorBreakdown = Array.from(errorCounts.entries())
      .map(([errorType, count]) => ({
        errorType,
        count,
        percentage: totalFailed > 0 ? (count / totalFailed) * 100 : 0,
      }))
      .sort((a, b) => b.count - a.count);

    return {
      modelVersion,
      successRate: totalEpisodes > 0 ? (successfulEpisodes / totalEpisodes) * 100 : 0,
      totalEpisodes,
      avgDurationMs,
      errorBreakdown,
    };
  }
}

export const evaluationService = EvaluationService.getInstance();
