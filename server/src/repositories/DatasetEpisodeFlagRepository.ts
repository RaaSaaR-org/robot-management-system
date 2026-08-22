/**
 * @file DatasetEpisodeFlagRepository.ts
 * @description Operator judgements about individual episodes — flag, list,
 *              review.
 * @feature training
 *
 * Keyed on `(datasetId, episodeIndex)` and not on an Episode row, because there
 * is no Episode row: an episode is a range inside a parquet on disk or in a
 * bucket, and this database has never held one. `EpisodeReward` keys the same
 * way for the same reason.
 */

import { prisma } from '../database/index.js';

export interface EpisodeFlag {
  datasetId: string;
  episodeIndex: number;
  flagged: boolean;
  reason: string | null;
  reviewDecision: string | null;
  reviewedAt: Date | null;
  reviewedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function toDomain(row: {
  datasetId: string;
  episodeIndex: number;
  flagged: boolean;
  reason: string | null;
  reviewDecision: string | null;
  reviewedAt: Date | null;
  reviewedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}): EpisodeFlag {
  return {
    datasetId: row.datasetId,
    episodeIndex: row.episodeIndex,
    flagged: row.flagged,
    reason: row.reason,
    reviewDecision: row.reviewDecision,
    reviewedAt: row.reviewedAt,
    reviewedBy: row.reviewedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class DatasetEpisodeFlagRepository {
  /**
   * Flag or unflag one episode.
   *
   * Un-flagging keeps the row rather than deleting it: "this was flagged and
   * then cleared" is a different state from "nobody has ever looked", and the
   * review fields would go with the row if it were deleted.
   */
  async set(
    datasetId: string,
    episodeIndex: number,
    flagged: boolean,
    reason?: string,
  ): Promise<EpisodeFlag> {
    const row = await prisma.datasetEpisodeFlag.upsert({
      where: { datasetId_episodeIndex: { datasetId, episodeIndex } },
      create: { datasetId, episodeIndex, flagged, reason: reason ?? null },
      update: {
        flagged,
        reason: reason ?? null,
        // Re-flagging clears an earlier decision. Keeping it would leave an
        // episode both flagged and already reviewed, which reads as reviewed.
        ...(flagged ? { reviewDecision: null, reviewedAt: null, reviewedBy: null } : {}),
      },
    });
    return toDomain(row);
  }

  /** One episode's flag, or null when nobody has flagged it. */
  async get(datasetId: string, episodeIndex: number): Promise<EpisodeFlag | null> {
    const row = await prisma.datasetEpisodeFlag.findUnique({
      where: { datasetId_episodeIndex: { datasetId, episodeIndex } },
    });
    return row ? toDomain(row) : null;
  }

  /** Every currently-flagged episode index, for annotating an episode listing. */
  async flaggedIndices(datasetId: string): Promise<Set<number>> {
    const rows = await prisma.datasetEpisodeFlag.findMany({
      where: { datasetId, flagged: true },
      select: { episodeIndex: true },
    });
    return new Set(rows.map((r: { episodeIndex: number }) => r.episodeIndex));
  }

  async countFlagged(datasetId: string): Promise<number> {
    return prisma.datasetEpisodeFlag.count({ where: { datasetId, flagged: true } });
  }

  async listFlagged(
    datasetId: string,
    page = 1,
    limit = 20,
  ): Promise<{ rows: EpisodeFlag[]; total: number }> {
    const safePage = Math.max(1, Math.floor(page) || 1);
    const safeLimit = Math.min(200, Math.max(1, Math.floor(limit) || 20));
    const [rows, total] = await Promise.all([
      prisma.datasetEpisodeFlag.findMany({
        where: { datasetId, flagged: true },
        orderBy: { episodeIndex: 'asc' },
        skip: (safePage - 1) * safeLimit,
        take: safeLimit,
      }),
      prisma.datasetEpisodeFlag.count({ where: { datasetId, flagged: true } }),
    ]);
    return { rows: rows.map(toDomain), total };
  }

  /**
   * Record a decision on a flagged episode.
   *
   * Returns null when there is no flag to review — a review of nothing is a
   * 404 and not a success, which is what the endpoint used to answer.
   */
  async review(
    datasetId: string,
    episodeIndex: number,
    decision: 'keep' | 'remove',
    reviewedBy?: string,
  ): Promise<EpisodeFlag | null> {
    const existing = await prisma.datasetEpisodeFlag.findUnique({
      where: { datasetId_episodeIndex: { datasetId, episodeIndex } },
    });
    if (!existing || !existing.flagged) return null;
    const row = await prisma.datasetEpisodeFlag.update({
      where: { datasetId_episodeIndex: { datasetId, episodeIndex } },
      data: {
        // Reviewed means no longer awaiting review, whichever way it went. The
        // decision itself is what says whether the episode should be dropped.
        flagged: false,
        reviewDecision: decision,
        reviewedAt: new Date(),
        reviewedBy: reviewedBy ?? null,
      },
    });
    return toDomain(row);
  }
}

export const datasetEpisodeFlagRepository = new DatasetEpisodeFlagRepository();
