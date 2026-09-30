/**
 * @file SocialRepository.ts
 * @description Data access for comments and ratings (TASK-241), plus the
 *   existence checks the social layer runs against subjects and evidence.
 * @feature social
 *
 * Every query goes through the tenant-extended `prisma`, so `Comment` and
 * `Rating` (both in `TENANT_SCOPED_MODELS`) are stamped and filtered by tenant,
 * and a subject or evidence id from another tenant reads as absent.
 */

import type { Comment, Rating } from '@prisma/client';
import { prisma } from '../database/index.js';
import type { ActorType, SubjectType } from '../types/social.types.js';

export type CommentRow = Comment;
export type RatingRow = Rating;

export interface CommentCreateData {
  subjectType: SubjectType;
  subjectId: string;
  episodeIndex: number | null;
  parentId: string | null;
  actorType: ActorType;
  actorId: string;
  displayName: string;
  body: string;
  evidenceJson: string;
}

export interface RatingWriteData {
  subjectType: SubjectType;
  subjectId: string;
  episodeIndex: number | null;
  subjectKey: string;
  actorType: ActorType;
  actorId: string;
  displayName: string;
  score: number;
  dimensionsJson: string;
  evidenceJson: string;
  comment: string | null;
}

/** Minimal dataset facts the subject check needs. */
export interface DatasetFacts {
  id: string;
  kind: string;
  demonstrationCount: number;
}

export class SocialRepository {
  // --------------------------------------------------------------------------
  // Comments
  // --------------------------------------------------------------------------

  createComment(data: CommentCreateData): Promise<CommentRow> {
    return prisma.comment.create({ data });
  }

  findComment(id: string): Promise<CommentRow | null> {
    return prisma.comment.findUnique({ where: { id } });
  }

  updateComment(
    id: string,
    data: Partial<Pick<Comment, 'body' | 'editedAt' | 'deletedAt'>>
  ): Promise<CommentRow> {
    return prisma.comment.update({ where: { id }, data });
  }

  /** All comments on a subject (top level and replies), oldest first. */
  listComments(
    subjectType: SubjectType,
    subjectId: string,
    episodeIndex: number | null
  ): Promise<CommentRow[]> {
    return prisma.comment.findMany({
      where: { subjectType, subjectId, ...(episodeIndex !== null ? { episodeIndex } : {}) },
      orderBy: { createdAt: 'asc' },
    });
  }

  countComments(
    subjectType: SubjectType,
    subjectId: string,
    episodeIndex: number | null
  ): Promise<number> {
    return prisma.comment.count({
      where: {
        subjectType,
        subjectId,
        deletedAt: null,
        ...(episodeIndex !== null ? { episodeIndex } : {}),
      },
    });
  }

  recentComments(filter: {
    actorType?: ActorType;
    subjectType?: SubjectType;
    limit: number;
  }): Promise<CommentRow[]> {
    return prisma.comment.findMany({
      where: {
        deletedAt: null,
        ...(filter.actorType ? { actorType: filter.actorType } : {}),
        ...(filter.subjectType ? { subjectType: filter.subjectType } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: filter.limit,
    });
  }

  // --------------------------------------------------------------------------
  // Ratings
  // --------------------------------------------------------------------------

  findRating(
    subjectType: SubjectType,
    subjectKey: string,
    actorType: ActorType,
    actorId: string
  ): Promise<RatingRow | null> {
    // findFirst, not findUnique: the tenant extension scopes findFirst in the
    // query itself rather than by post-filtering the unique hit.
    return prisma.rating.findFirst({ where: { subjectType, subjectKey, actorType, actorId } });
  }

  createRating(data: RatingWriteData): Promise<RatingRow> {
    return prisma.rating.create({ data });
  }

  updateRating(id: string, data: RatingWriteData): Promise<RatingRow> {
    return prisma.rating.update({ where: { id }, data });
  }

  listRatings(subjectType: SubjectType, subjectKey: string): Promise<RatingRow[]> {
    return prisma.rating.findMany({
      where: { subjectType, subjectKey },
      orderBy: { updatedAt: 'desc' },
    });
  }

  recentRatings(filter: {
    actorType?: ActorType;
    subjectType?: SubjectType;
    limit: number;
  }): Promise<RatingRow[]> {
    return prisma.rating.findMany({
      where: {
        ...(filter.actorType ? { actorType: filter.actorType } : {}),
        ...(filter.subjectType ? { subjectType: filter.subjectType } : {}),
      },
      orderBy: { updatedAt: 'desc' },
      take: filter.limit,
    });
  }

  // --------------------------------------------------------------------------
  // Existence checks (subjects, evidence, actors)
  // --------------------------------------------------------------------------

  async findDataset(id: string): Promise<DatasetFacts | null> {
    const row = await prisma.dataset.findFirst({
      where: { id },
      select: { id: true, kind: true, demonstrationCount: true },
    });
    return row ?? null;
  }

  async modelVersionExists(id: string): Promise<boolean> {
    return (await prisma.modelVersion.count({ where: { id } })) > 0;
  }

  async trainingJobExists(id: string): Promise<boolean> {
    return (await prisma.trainingJob.count({ where: { id } })) > 0;
  }

  async experimentExists(id: string): Promise<boolean> {
    return (await prisma.experiment.count({ where: { id } })) > 0;
  }

  async datasetExists(id: string): Promise<boolean> {
    return (await prisma.dataset.count({ where: { id } })) > 0;
  }

  /** Ids among `ids` that exist as EvaluationEpisode rows. */
  async existingEvaluationEpisodeIds(ids: string[]): Promise<Set<string>> {
    const rows = await prisma.evaluationEpisode.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });
    return new Set(rows.map((r) => r.id));
  }

  async simToRealValidationExists(id: string): Promise<boolean> {
    return (await prisma.simToRealValidation.count({ where: { id } })) > 0;
  }

  async episodeRewardExists(datasetId: string, rewardType: string): Promise<boolean> {
    return (await prisma.episodeReward.count({ where: { datasetId, rewardType } })) > 0;
  }

  async findAgentCard(name: string): Promise<{ name: string } | null> {
    return prisma.agentCard.findUnique({ where: { name }, select: { name: true } });
  }
}

export const socialRepository = new SocialRepository();
