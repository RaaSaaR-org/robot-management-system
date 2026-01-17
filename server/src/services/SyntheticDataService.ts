/**
 * @file SyntheticDataService.ts
 * @description Service for synthetic data generation via Isaac Lab integration
 * @feature datasets
 */

import { EventEmitter } from 'events';
import { PrismaClient } from '@prisma/client';
import type {
  SyntheticJob,
  SyntheticJobConfig,
  SyntheticJobStatus,
  CreateSyntheticJobRequest,
  JobProgressUpdate,
  SimToRealValidation,
  ValidateSimToRealRequest,
  IsaacLabServiceStatus,
  IsaacLabTask,
  DomainRandomizationConfig,
  DRPreset,
  SyntheticEvent,
} from '../types/synthetic.types.js';
import {
  DEFAULT_DOMAIN_RANDOMIZATION,
  DEFAULT_SIMULATION_CONFIG,
  DR_PRESETS,
} from '../types/synthetic.types.js';

// ============================================================================
// SYNTHETIC DATA SERVICE
// ============================================================================

/**
 * Service for managing synthetic data generation jobs
 */
export class SyntheticDataService extends EventEmitter {
  private static instance: SyntheticDataService;

  private prisma: PrismaClient;

  // Isaac Lab service configuration
  private isaacLabEndpoint: string;
  private isaacLabApiKey?: string;

  private constructor() {
    super();
    this.prisma = new PrismaClient();
    this.isaacLabEndpoint =
      process.env.ISAAC_LAB_ENDPOINT || 'http://localhost:8100';
    this.isaacLabApiKey = process.env.ISAAC_LAB_API_KEY;
  }

  /**
   * Get singleton instance
   */
  static getInstance(): SyntheticDataService {
    if (!SyntheticDataService.instance) {
      SyntheticDataService.instance = new SyntheticDataService();
    }
    return SyntheticDataService.instance;
  }

  // ============================================================================
  // JOB MANAGEMENT
  // ============================================================================

  /**
   * Submit a synthetic data generation job
   */
  async submitJob(request: CreateSyntheticJobRequest): Promise<SyntheticJob> {
    // Merge with defaults
    const domainRandomization: DomainRandomizationConfig = {
      physics: {
        ...DEFAULT_DOMAIN_RANDOMIZATION.physics,
        ...request.domainRandomization?.physics,
      },
      visual: {
        ...DEFAULT_DOMAIN_RANDOMIZATION.visual,
        ...request.domainRandomization?.visual,
      },
      sensor: {
        ...DEFAULT_DOMAIN_RANDOMIZATION.sensor,
        ...request.domainRandomization?.sensor,
      },
    };

    const config: SyntheticJobConfig = {
      task: request.task,
      embodiment: request.embodiment,
      trajectoryCount: request.trajectoryCount,
      domainRandomization,
      outputFormat: request.outputFormat || 'lerobot_v3',
      taskConfig: request.taskConfig
        ? {
            task: request.task,
            ...request.taskConfig,
          }
        : undefined,
      simulation: {
        ...DEFAULT_SIMULATION_CONFIG,
        ...request.simulation,
      },
      headless: request.headless ?? true,
      seed: request.seed,
    };

    const job = await this.prisma.syntheticJob.create({
      data: {
        task: request.task,
        embodiment: request.embodiment,
        trajectoryCount: request.trajectoryCount,
        config: JSON.parse(JSON.stringify(config)),
        status: 'pending',
        progress: 0,
        generatedCount: 0,
        successfulCount: 0,
        failedCount: 0,
      },
    });

    this.emitEvent({
      type: 'job:created',
      jobId: job.id,
      data: { task: request.task, trajectoryCount: request.trajectoryCount },
      timestamp: new Date(),
    });

    // In a real implementation, this would publish to NATS job queue
    // For now, we simulate starting the job
    this.simulateJobExecution(job.id);

    return this.toSyntheticJob(job);
  }

  /**
   * Get a job by ID
   */
  async getJob(jobId: string): Promise<SyntheticJob | undefined> {
    const job = await this.prisma.syntheticJob.findUnique({
      where: { id: jobId },
    });
    return job ? this.toSyntheticJob(job) : undefined;
  }

  /**
   * List jobs with optional filters
   */
  async listJobs(options?: {
    status?: SyntheticJobStatus;
    task?: IsaacLabTask;
    embodiment?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ jobs: SyntheticJob[]; total: number }> {
    const where: Record<string, unknown> = {};

    if (options?.status) {
      where.status = options.status;
    }
    if (options?.task) {
      where.task = options.task;
    }
    if (options?.embodiment) {
      where.embodiment = options.embodiment;
    }

    const [jobs, total] = await Promise.all([
      this.prisma.syntheticJob.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: options?.offset,
        take: options?.limit,
      }),
      this.prisma.syntheticJob.count({ where }),
    ]);

    return {
      jobs: jobs.map((j) => this.toSyntheticJob(j)),
      total,
    };
  }

  /**
   * Cancel a job
   */
  async cancelJob(jobId: string): Promise<SyntheticJob | undefined> {
    const job = await this.prisma.syntheticJob.findUnique({
      where: { id: jobId },
    });

    if (!job) return undefined;

    if (job.status === 'completed' || job.status === 'failed') {
      return this.toSyntheticJob(job); // Already finished
    }

    const updated = await this.prisma.syntheticJob.update({
      where: { id: jobId },
      data: { status: 'cancelled' },
    });

    this.emitEvent({
      type: 'job:cancelled',
      jobId,
      timestamp: new Date(),
    });

    return this.toSyntheticJob(updated);
  }

  /**
   * Update job progress (called by worker)
   */
  async updateJobProgress(update: JobProgressUpdate): Promise<SyntheticJob | undefined> {
    const job = await this.prisma.syntheticJob.findUnique({
      where: { id: update.jobId },
    });

    if (!job) return undefined;

    let processingRate: number | undefined;
    if (update.generatedCount > 0) {
      const elapsed =
        (new Date().getTime() - (job.startedAt?.getTime() || job.createdAt.getTime())) /
        1000;
      processingRate = update.generatedCount / elapsed;
    }

    const updated = await this.prisma.syntheticJob.update({
      where: { id: update.jobId },
      data: {
        progress: update.progress,
        generatedCount: update.generatedCount,
        successfulCount: update.successfulCount,
        failedCount: update.failedCount,
        estimatedTimeRemaining: update.estimatedTimeRemaining,
        processingRate,
      },
    });

    this.emitEvent({
      type: 'job:progress',
      jobId: update.jobId,
      data: update,
      timestamp: new Date(),
    });

    return this.toSyntheticJob(updated);
  }

  /**
   * Mark job as completed
   */
  async completeJob(
    jobId: string,
    outputDatasetId: string,
    successfulCount: number
  ): Promise<SyntheticJob | undefined> {
    const job = await this.prisma.syntheticJob.findUnique({
      where: { id: jobId },
    });

    if (!job) return undefined;

    const updated = await this.prisma.syntheticJob.update({
      where: { id: jobId },
      data: {
        status: 'completed',
        progress: 100,
        outputDatasetId,
        successfulCount,
        completedAt: new Date(),
      },
    });

    this.emitEvent({
      type: 'job:completed',
      jobId,
      data: { outputDatasetId, successfulCount },
      timestamp: new Date(),
    });

    return this.toSyntheticJob(updated);
  }

  /**
   * Mark job as failed
   */
  async failJob(jobId: string, errorMessage: string): Promise<SyntheticJob | undefined> {
    const job = await this.prisma.syntheticJob.findUnique({
      where: { id: jobId },
    });

    if (!job) return undefined;

    const updated = await this.prisma.syntheticJob.update({
      where: { id: jobId },
      data: {
        status: 'failed',
        errorMessage,
      },
    });

    this.emitEvent({
      type: 'job:failed',
      jobId,
      data: { errorMessage },
      timestamp: new Date(),
    });

    return this.toSyntheticJob(updated);
  }

  // ============================================================================
  // SIM-TO-REAL VALIDATION
  // ============================================================================

  /**
   * Record sim-to-real validation result
   */
  async recordSimToRealValidation(
    request: ValidateSimToRealRequest
  ): Promise<SimToRealValidation> {
    // Compute domain gap score
    const domainGapScore = Math.abs(request.simSuccessRate - request.realSuccessRate);

    // Compute per-task gaps if provided
    const perTaskMetrics = request.perTaskMetrics
      ? Object.fromEntries(
          Object.entries(request.perTaskMetrics).map(([task, metrics]) => [
            task,
            {
              simSuccess: metrics.simSuccess,
              realSuccess: metrics.realSuccess,
              gap: Math.abs(metrics.simSuccess - metrics.realSuccess),
            },
          ])
        )
      : undefined;

    const validation = await this.prisma.simToRealValidation.create({
      data: {
        syntheticJobId: request.syntheticJobId,
        modelVersionId: request.modelVersionId,
        simSuccessRate: request.simSuccessRate,
        realSuccessRate: request.realSuccessRate,
        domainGapScore,
        realTestCount: request.realTestCount,
        taskCategories: request.taskCategories,
        perTaskMetrics: perTaskMetrics ? JSON.parse(JSON.stringify(perTaskMetrics)) : undefined,
        notes: request.notes,
      },
    });

    this.emitEvent({
      type: 'validation:recorded',
      jobId: request.syntheticJobId,
      data: { validationId: validation.id, domainGapScore },
      timestamp: new Date(),
    });

    return this.toSimToRealValidation(validation);
  }

  /**
   * Get validation results for a job
   */
  async getValidationsForJob(syntheticJobId: string): Promise<SimToRealValidation[]> {
    const validations = await this.prisma.simToRealValidation.findMany({
      where: { syntheticJobId },
      orderBy: { validationDate: 'desc' },
    });

    return validations.map((v) => this.toSimToRealValidation(v));
  }

  /**
   * Get validation by ID
   */
  async getValidation(validationId: string): Promise<SimToRealValidation | undefined> {
    const validation = await this.prisma.simToRealValidation.findUnique({
      where: { id: validationId },
    });

    return validation ? this.toSimToRealValidation(validation) : undefined;
  }

  /**
   * List all validations
   */
  async listValidations(options?: {
    modelVersionId?: string;
    minRealSuccessRate?: number;
    maxDomainGap?: number;
  }): Promise<SimToRealValidation[]> {
    const where: Record<string, unknown> = {};

    if (options?.modelVersionId) {
      where.modelVersionId = options.modelVersionId;
    }
    if (options?.minRealSuccessRate !== undefined) {
      where.realSuccessRate = { gte: options.minRealSuccessRate };
    }
    if (options?.maxDomainGap !== undefined) {
      where.domainGapScore = { lte: options.maxDomainGap };
    }

    const validations = await this.prisma.simToRealValidation.findMany({
      where,
      orderBy: { validationDate: 'desc' },
    });

    return validations.map((v) => this.toSimToRealValidation(v));
  }

  // ============================================================================
  // DOMAIN RANDOMIZATION PRESETS
  // ============================================================================

  /**
   * Get all DR presets
   */
  getDRPresets(): DRPreset[] {
    return DR_PRESETS;
  }

  /**
   * Get DR preset by ID
   */
  getDRPreset(presetId: string): DRPreset | undefined {
    return DR_PRESETS.find((p) => p.id === presetId);
  }

  /**
   * Get recommended preset for a task
   */
  getRecommendedPreset(task: IsaacLabTask): DRPreset {
    const recommended = DR_PRESETS.find((p) => p.recommendedFor.includes(task));
    return recommended || DR_PRESETS.find((p) => p.id === 'moderate')!;
  }

  // ============================================================================
  // ISAAC LAB SERVICE STATUS
  // ============================================================================

  /**
   * Check Isaac Lab service status
   */
  async checkIsaacLabStatus(): Promise<IsaacLabServiceStatus> {
    try {
      // In production, this would make an actual HTTP request to Isaac Lab service
      // For now, return a mock status
      const activeJobs = await this.prisma.syntheticJob.count({
        where: {
          status: { in: ['running', 'processing'] },
        },
      });

      const queueLength = await this.prisma.syntheticJob.count({
        where: {
          status: { in: ['pending', 'queued'] },
        },
      });

      return {
        available: true,
        version: '0.4.0',
        gpuCount: 1,
        gpuMemoryAvailable: [24000], // MB
        queueLength,
        activeJobs,
        lastHealthCheck: new Date(),
      };
    } catch (error) {
      return {
        available: false,
        queueLength: 0,
        activeJobs: 0,
        lastHealthCheck: new Date(),
      };
    }
  }

  // ============================================================================
  // JOB SIMULATION (for development)
  // ============================================================================

  /**
   * Simulate job execution (for development without Isaac Lab)
   */
  private async simulateJobExecution(jobId: string): Promise<void> {
    const job = await this.prisma.syntheticJob.findUnique({
      where: { id: jobId },
    });

    if (!job) return;

    // Start the job
    await this.prisma.syntheticJob.update({
      where: { id: jobId },
      data: {
        status: 'running',
        startedAt: new Date(),
      },
    });

    this.emitEvent({
      type: 'job:started',
      jobId,
      timestamp: new Date(),
    });

    // Simulate progress updates
    const totalSteps = 10;
    let currentStep = 0;

    const progressInterval = setInterval(async () => {
      const currentJob = await this.prisma.syntheticJob.findUnique({
        where: { id: jobId },
      });

      if (!currentJob || currentJob.status === 'cancelled') {
        clearInterval(progressInterval);
        return;
      }

      currentStep++;
      const progress = (currentStep / totalSteps) * 100;
      const generatedCount = Math.floor(
        (currentStep / totalSteps) * job.trajectoryCount
      );
      const successfulCount = Math.floor(generatedCount * 0.95); // 95% success rate

      await this.updateJobProgress({
        jobId,
        progress,
        generatedCount,
        successfulCount,
        failedCount: generatedCount - successfulCount,
        currentStep: `Generating trajectory batch ${currentStep}/${totalSteps}`,
        estimatedTimeRemaining: (totalSteps - currentStep) * 2,
      });

      if (currentStep >= totalSteps) {
        clearInterval(progressInterval);

        // Complete the job
        const outputDatasetId = `synthetic_${job.task}_${Date.now()}`;
        await this.completeJob(jobId, outputDatasetId, successfulCount);
      }
    }, 2000); // Update every 2 seconds
  }

  // ============================================================================
  // STATISTICS
  // ============================================================================

  /**
   * Get job statistics
   */
  async getJobStatistics(): Promise<{
    total: number;
    byStatus: Record<SyntheticJobStatus, number>;
    totalTrajectories: number;
    successRate: number;
  }> {
    const jobs = await this.prisma.syntheticJob.findMany();

    const byStatus: Record<SyntheticJobStatus, number> = {
      pending: 0,
      queued: 0,
      running: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
    };

    let totalTrajectories = 0;
    let totalSuccessful = 0;

    for (const job of jobs) {
      byStatus[job.status as SyntheticJobStatus]++;
      if (job.status === 'completed') {
        totalTrajectories += job.generatedCount;
        totalSuccessful += job.successfulCount;
      }
    }

    const successRate =
      totalTrajectories > 0 ? totalSuccessful / totalTrajectories : 0;

    return {
      total: jobs.length,
      byStatus,
      totalTrajectories,
      successRate,
    };
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  /**
   * Convert Prisma model to SyntheticJob type
   */
  private toSyntheticJob(job: {
    id: string;
    task: string;
    embodiment: string;
    trajectoryCount: number;
    config: unknown;
    status: string;
    progress: number;
    generatedCount: number;
    successfulCount: number;
    failedCount: number;
    processingRate: number | null;
    estimatedTimeRemaining: number | null;
    outputDatasetId: string | null;
    errorMessage: string | null;
    startedAt: Date | null;
    completedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): SyntheticJob {
    return {
      id: job.id,
      task: job.task as IsaacLabTask,
      embodiment: job.embodiment,
      trajectoryCount: job.trajectoryCount,
      config: job.config as SyntheticJobConfig,
      status: job.status as SyntheticJobStatus,
      progress: job.progress,
      generatedCount: job.generatedCount,
      successfulCount: job.successfulCount,
      failedCount: job.failedCount,
      processingRate: job.processingRate ?? undefined,
      estimatedTimeRemaining: job.estimatedTimeRemaining ?? undefined,
      outputDatasetId: job.outputDatasetId ?? undefined,
      errorMessage: job.errorMessage ?? undefined,
      startedAt: job.startedAt ?? undefined,
      completedAt: job.completedAt ?? undefined,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };
  }

  /**
   * Convert Prisma model to SimToRealValidation type
   */
  private toSimToRealValidation(validation: {
    id: string;
    syntheticJobId: string;
    modelVersionId: string;
    validationDate: Date;
    simSuccessRate: number;
    realSuccessRate: number;
    domainGapScore: number;
    realTestCount: number;
    taskCategories: unknown;
    perTaskMetrics: unknown;
    notes: string | null;
  }): SimToRealValidation {
    return {
      id: validation.id,
      syntheticJobId: validation.syntheticJobId,
      modelVersionId: validation.modelVersionId,
      validationDate: validation.validationDate,
      simSuccessRate: validation.simSuccessRate,
      realSuccessRate: validation.realSuccessRate,
      domainGapScore: validation.domainGapScore,
      realTestCount: validation.realTestCount,
      taskCategories: validation.taskCategories as string[],
      perTaskMetrics: validation.perTaskMetrics as
        | Record<string, { simSuccess: number; realSuccess: number; gap: number }>
        | undefined,
      notes: validation.notes ?? undefined,
    };
  }

  // ============================================================================
  // EVENT HANDLING
  // ============================================================================

  private emitEvent(event: SyntheticEvent): void {
    this.emit('synthetic:event', event);
    this.emit(event.type, event);
  }
}

// ============================================================================
// SINGLETON EXPORT
// ============================================================================

export const syntheticDataService = SyntheticDataService.getInstance();
