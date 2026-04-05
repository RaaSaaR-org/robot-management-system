/**
 * @file SimulationJobRepository.ts
 * @description Data access layer for simulation jobs and their captured frames
 */

import { prisma } from '../database/index.js';
import type { SimJob, SimFrame, SimMetrics } from '../services/SimulationService.js';

type DbJob = {
  id: string;
  modelId: string;
  environment: string;
  backend: string;
  rolloutCount: number;
  status: string;
  progress: number;
  successRate: number | null;
  avgSteps: number | null;
  collisionCount: number | null;
  avgDuration: number | null;
  simToRealGap: number | null;
  totalEpisodes: number | null;
  successfulEpisodes: number | null;
  framesDir: string | null;
  failureReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  frames?: { episode: number; step: number; filename: string }[];
};

function dbToDomain(row: DbJob): SimJob {
  const hasMetrics = row.successRate !== null && row.totalEpisodes !== null;
  const metrics: SimMetrics | undefined = hasMetrics
    ? {
        successRate: row.successRate!,
        avgStepsToCompletion: row.avgSteps ?? 0,
        collisionCount: row.collisionCount ?? 0,
        avgEpisodeDuration: row.avgDuration ?? 0,
        simToRealGap: row.simToRealGap ?? undefined,
        // extra fields carried through JSON
        ...(row.totalEpisodes !== null ? { totalEpisodes: row.totalEpisodes } : {}),
        ...(row.successfulEpisodes !== null
          ? { successfulEpisodes: row.successfulEpisodes }
          : {}),
      } as SimMetrics
    : undefined;

  const frames: SimFrame[] | undefined = row.frames?.map((f) => ({
    episode: f.episode,
    step: f.step,
    file: f.filename,
  }));

  return {
    jobId: row.id,
    modelId: row.modelId,
    environment: row.environment,
    rolloutCount: row.rolloutCount,
    backend: row.backend as 'mujoco' | 'isaac',
    status: row.status as SimJob['status'],
    progress: row.progress,
    metrics,
    frames: frames && frames.length > 0 ? frames : undefined,
    framesDir: row.framesDir ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class SimulationJobRepository {
  async create(job: SimJob): Promise<void> {
    await prisma.simulationJob.create({
      data: {
        id: job.jobId,
        modelId: job.modelId,
        environment: job.environment,
        backend: job.backend,
        rolloutCount: job.rolloutCount,
        status: job.status,
        progress: job.progress,
        framesDir: job.framesDir ?? null,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
      },
    });
  }

  async update(
    jobId: string,
    patch: Partial<{
      status: SimJob['status'];
      progress: number;
      framesDir: string | null;
      failureReason: string | null;
      metrics: SimMetrics | null;
    }>
  ): Promise<void> {
    const data: Record<string, unknown> = {};
    if (patch.status !== undefined) data.status = patch.status;
    if (patch.progress !== undefined) data.progress = patch.progress;
    if (patch.framesDir !== undefined) data.framesDir = patch.framesDir;
    if (patch.failureReason !== undefined) data.failureReason = patch.failureReason;
    if (patch.metrics !== undefined) {
      const m = patch.metrics;
      if (m === null) {
        data.successRate = null;
        data.avgSteps = null;
        data.collisionCount = null;
        data.avgDuration = null;
        data.simToRealGap = null;
        data.totalEpisodes = null;
        data.successfulEpisodes = null;
      } else {
        data.successRate = m.successRate;
        data.avgSteps = m.avgStepsToCompletion;
        data.collisionCount = m.collisionCount;
        data.avgDuration = m.avgEpisodeDuration;
        data.simToRealGap = m.simToRealGap ?? null;
        // Carry through the extra fields the Python evaluator returns.
        const extended = m as SimMetrics & {
          totalEpisodes?: number;
          successfulEpisodes?: number;
        };
        data.totalEpisodes = extended.totalEpisodes ?? null;
        data.successfulEpisodes = extended.successfulEpisodes ?? null;
      }
    }
    await prisma.simulationJob.update({ where: { id: jobId }, data });
  }

  async createFrames(jobId: string, frames: SimFrame[]): Promise<void> {
    if (frames.length === 0) return;
    await prisma.simulationFrame.createMany({
      data: frames.map((f) => ({
        jobId,
        episode: f.episode,
        step: f.step,
        filename: f.file,
      })),
    });
  }

  async findAll(): Promise<SimJob[]> {
    const rows = await prisma.simulationJob.findMany({
      include: { frames: { orderBy: [{ episode: 'asc' }, { step: 'asc' }] } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => dbToDomain(r as DbJob));
  }

  async findById(jobId: string): Promise<SimJob | null> {
    const row = await prisma.simulationJob.findUnique({
      where: { id: jobId },
      include: { frames: { orderBy: [{ episode: 'asc' }, { step: 'asc' }] } },
    });
    return row ? dbToDomain(row as DbJob) : null;
  }

  /**
   * Mark any jobs that were still queued or running as failed.
   * Called on service boot — their subprocesses died with the previous server.
   */
  async markFailedOnBoot(): Promise<number> {
    const res = await prisma.simulationJob.updateMany({
      where: { status: { in: ['queued', 'running'] } },
      data: { status: 'failed', failureReason: 'server restart' },
    });
    return res.count;
  }
}

export const simulationJobRepository = new SimulationJobRepository();
