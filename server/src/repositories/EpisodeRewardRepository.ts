/**
 * @file EpisodeRewardRepository.ts
 * @description Data access layer for EpisodeReward rows — per-episode
 *   reward-model scores + progress curves produced by `reward_model`
 *   training jobs (LeRobot 0.6.0 Robometer/TOPReward, TASK-179).
 * @feature evaluation
 */

import { prisma } from '../database/index.js';
import type { EpisodeReward as PrismaEpisodeReward } from '@prisma/client';
import type { RewardType } from '../types/vla.types.js';

// ============================================================================
// TYPES
// ============================================================================

/** Domain shape of an episode reward — `curve` parsed to number[]. */
export interface EpisodeReward {
  id: string;
  datasetId: string;
  episodeIndex: number;
  rewardType: RewardType;
  score: number;
  success: boolean | null;
  curve: number[];
  fps: number | null;
  jobId: string | null;
  createdAt: Date;
}

export interface UpsertEpisodeRewardInput {
  datasetId: string;
  episodeIndex: number;
  rewardType: RewardType;
  score: number;
  success?: boolean | null;
  curve?: number[];
  fps?: number | null;
  jobId?: string | null;
}

// ============================================================================
// HELPERS
// ============================================================================

const parseCurve = (val: string): number[] => {
  try {
    const parsed = JSON.parse(val);
    return Array.isArray(parsed) ? parsed.map(Number) : [];
  } catch {
    return [];
  }
};

function dbEpisodeRewardToDomain(db: PrismaEpisodeReward): EpisodeReward {
  return {
    id: db.id,
    datasetId: db.datasetId,
    episodeIndex: db.episodeIndex,
    rewardType: db.rewardType as RewardType,
    score: db.score,
    success: db.success,
    curve: parseCurve(db.curve),
    fps: db.fps,
    jobId: db.jobId,
    createdAt: db.createdAt,
  };
}

// ============================================================================
// REPOSITORY
// ============================================================================

export class EpisodeRewardRepository {
  /**
   * Upsert one reward row keyed on (datasetId, episodeIndex, rewardType) —
   * re-running an evaluation overwrites the previous score for that episode.
   */
  async upsert(input: UpsertEpisodeRewardInput): Promise<EpisodeReward> {
    const data = {
      score: input.score,
      success: input.success ?? null,
      curve: JSON.stringify(input.curve ?? []),
      fps: input.fps ?? null,
      jobId: input.jobId ?? null,
    };
    const row = await prisma.episodeReward.upsert({
      where: {
        datasetId_episodeIndex_rewardType: {
          datasetId: input.datasetId,
          episodeIndex: input.episodeIndex,
          rewardType: input.rewardType,
        },
      },
      create: {
        datasetId: input.datasetId,
        episodeIndex: input.episodeIndex,
        rewardType: input.rewardType,
        ...data,
      },
      update: data,
    });
    return dbEpisodeRewardToDomain(row);
  }

  /** Upsert a batch of reward rows (one worker completion). */
  async upsertMany(inputs: UpsertEpisodeRewardInput[]): Promise<EpisodeReward[]> {
    const results: EpisodeReward[] = [];
    for (const input of inputs) {
      results.push(await this.upsert(input));
    }
    return results;
  }

  /** All rewards for a dataset, ordered by episode. */
  async findByDataset(datasetId: string, rewardType?: RewardType): Promise<EpisodeReward[]> {
    const rows = await prisma.episodeReward.findMany({
      where: { datasetId, ...(rewardType ? { rewardType } : {}) },
      orderBy: [{ episodeIndex: 'asc' }, { rewardType: 'asc' }],
    });
    return rows.map(dbEpisodeRewardToDomain);
  }

  /** Rewards produced by one reward_model job. */
  async findByJob(jobId: string): Promise<EpisodeReward[]> {
    const rows = await prisma.episodeReward.findMany({
      where: { jobId },
      orderBy: { episodeIndex: 'asc' },
    });
    return rows.map(dbEpisodeRewardToDomain);
  }
}

export const episodeRewardRepository = new EpisodeRewardRepository();
