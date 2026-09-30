/**
 * @file SocialService.ts
 * @description Comments and ratings by people and agents on datasets, views,
 *   model versions, episodes and training jobs (TASK-241).
 * @feature social
 *
 * The rules that make this more than a comment box:
 *  - an agent's rating must cite evidence, and every cited id must exist;
 *  - one rating per actor per subject, updated in place;
 *  - a comment is never hard-deleted, so a thread with replies stays readable;
 *  - the summary keeps human and agent means apart;
 *  - every agent rating is written to the compliance log as an `ai_decision`.
 * An agent rating is a recommendation — no second approval mechanism lives here.
 */

import { AppError } from '../utils/errors.js';
import { socialRepository, type CommentRow, type RatingRow, type SocialRepository } from '../repositories/SocialRepository.js';
import { complianceLogService } from './ComplianceLogService.js';
import {
  ACTOR_TYPES,
  EVIDENCE_KINDS,
  RATING_DIMENSIONS,
  SUBJECT_TYPES,
  type Actor,
  type ActorType,
  type CommentDTO,
  type CommentThreadDTO,
  type CreateCommentInput,
  type EvidenceRef,
  type FeedItem,
  type FeedQuery,
  type PutRatingInput,
  type RatingAggregate,
  type RatingDTO,
  type RatingSummary,
  type SubjectRef,
  type SubjectType,
} from '../types/social.types.js';

/** Error with a stable `code`, answered as-is by the routes. */
export class SocialError extends AppError {
  constructor(message: string, statusCode: number, code: string, context?: Record<string, unknown>) {
    super(message, statusCode, code, context);
  }
}

const MAX_BODY = 10_000;
const MAX_EVIDENCE = 50;
const FEED_DEFAULT = 50;
const FEED_MAX = 200;

/** Minimal compliance-log surface, injectable for tests. */
export interface SocialComplianceSink {
  logAIDecision(params: {
    sessionId: string;
    robotId: string;
    operatorId?: string;
    payload: { description: string; metadata?: Record<string, unknown>; outputAction?: string; confidence?: number };
    input?: unknown;
    output?: unknown;
  }): Promise<unknown>;
}

// ----------------------------------------------------------------------------
// Parsing helpers (pure)
// ----------------------------------------------------------------------------

export function isSubjectType(v: unknown): v is SubjectType {
  return typeof v === 'string' && (SUBJECT_TYPES as readonly string[]).includes(v);
}

export function isActorType(v: unknown): v is ActorType {
  return typeof v === 'string' && (ACTOR_TYPES as readonly string[]).includes(v);
}

function bad(message: string, code: string, context?: Record<string, unknown>): SocialError {
  return new SocialError(message, 400, code, context);
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

/** Validate the shape of an evidence list. Existence is checked separately. */
export function parseEvidence(raw: unknown): EvidenceRef[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw bad('evidence must be an array', 'SOCIAL_EVIDENCE_INVALID');
  if (raw.length > MAX_EVIDENCE) {
    throw bad(`evidence may name at most ${MAX_EVIDENCE} refs`, 'SOCIAL_EVIDENCE_INVALID');
  }
  return raw.map((item, i): EvidenceRef => {
    const e = item as Record<string, unknown>;
    const where = { index: i };
    if (!e || typeof e !== 'object' || !(EVIDENCE_KINDS as readonly string[]).includes(e.kind as string)) {
      throw bad(`evidence[${i}] has an unknown kind`, 'SOCIAL_EVIDENCE_INVALID', where);
    }
    switch (e.kind) {
      case 'evaluation_episode':
        if (!Array.isArray(e.ids) || e.ids.length === 0 || !e.ids.every(nonEmptyString)) {
          throw bad(`evidence[${i}].ids must be a non-empty list of ids`, 'SOCIAL_EVIDENCE_INVALID', where);
        }
        return { kind: 'evaluation_episode', ids: [...new Set(e.ids as string[])] };
      case 'episode_reward':
        if (!nonEmptyString(e.datasetId) || !nonEmptyString(e.rewardType)) {
          throw bad(`evidence[${i}] needs datasetId and rewardType`, 'SOCIAL_EVIDENCE_INVALID', where);
        }
        return { kind: 'episode_reward', datasetId: e.datasetId, rewardType: e.rewardType };
      case 'external': {
        if (!nonEmptyString(e.uri) || !nonEmptyString(e.note)) {
          throw bad(`evidence[${i}] needs uri and note`, 'SOCIAL_EVIDENCE_INVALID', where);
        }
        let url: URL;
        try {
          url = new URL(e.uri);
        } catch {
          throw bad(`evidence[${i}].uri is not a URL`, 'SOCIAL_EVIDENCE_INVALID', where);
        }
        if (url.protocol !== 'https:' && url.protocol !== 'http:') {
          throw bad(`evidence[${i}].uri must be http(s)`, 'SOCIAL_EVIDENCE_INVALID', where);
        }
        return { kind: 'external', uri: e.uri, note: e.note };
      }
      default:
        if (!nonEmptyString(e.id)) {
          throw bad(`evidence[${i}].id is required`, 'SOCIAL_EVIDENCE_INVALID', where);
        }
        return { kind: e.kind, id: e.id } as EvidenceRef;
    }
  });
}

/** Validate a 0..1 dimension map against the subject type's vocabulary. */
export function parseDimensions(subjectType: SubjectType, raw: unknown): Record<string, number> {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw bad('dimensions must be an object', 'SOCIAL_RATING_INVALID');
  }
  const allowed = RATING_DIMENSIONS[subjectType];
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!allowed.includes(key)) {
      throw bad(`'${key}' is not a ${subjectType} dimension (allowed: ${allowed.join(', ')})`, 'SOCIAL_RATING_INVALID');
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
      throw bad(`dimension '${key}' must be a number in 0..1`, 'SOCIAL_RATING_INVALID');
    }
    out[key] = value;
  }
  return out;
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function subjectKey(subject: SubjectRef): string {
  return subject.subjectType === 'episode' ? `${subject.subjectId}#${subject.episodeIndex}` : subject.subjectId;
}

function aggregate(values: number[]): RatingAggregate {
  if (values.length === 0) return { count: 0, mean: null };
  return { count: values.length, mean: values.reduce((a, b) => a + b, 0) / values.length };
}

export function toCommentDTO(row: CommentRow): CommentDTO {
  const deleted = row.deletedAt !== null;
  return {
    id: row.id,
    subjectType: row.subjectType as SubjectType,
    subjectId: row.subjectId,
    episodeIndex: row.episodeIndex,
    parentId: row.parentId,
    actorType: row.actorType as ActorType,
    actorId: row.actorId,
    displayName: row.displayName,
    body: deleted ? '' : row.body,
    evidence: deleted ? [] : parseJson<EvidenceRef[]>(row.evidenceJson, []),
    editedAt: row.editedAt?.toISOString() ?? null,
    deletedAt: row.deletedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toRatingDTO(row: RatingRow): RatingDTO {
  return {
    id: row.id,
    subjectType: row.subjectType as SubjectType,
    subjectId: row.subjectId,
    episodeIndex: row.episodeIndex,
    actorType: row.actorType as ActorType,
    actorId: row.actorId,
    displayName: row.displayName,
    score: row.score,
    dimensions: parseJson<Record<string, number>>(row.dimensionsJson, {}),
    evidence: parseJson<EvidenceRef[]>(row.evidenceJson, []),
    comment: row.comment,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ----------------------------------------------------------------------------
// Service
// ----------------------------------------------------------------------------

export class SocialService {
  constructor(
    private readonly repo: SocialRepository = socialRepository,
    private readonly compliance: SocialComplianceSink = complianceLogService
  ) {}

  /**
   * Normalize and check a subject: the type is known, `episodeIndex` is present
   * exactly for episodes, and the row it names exists (in this tenant). A
   * comment on a deleted dataset is a dangling row nobody will notice.
   */
  async resolveSubject(subjectType: unknown, subjectId: unknown, episodeIndexRaw: unknown): Promise<SubjectRef> {
    if (!isSubjectType(subjectType)) {
      throw bad(`Unknown subject type '${String(subjectType)}' (allowed: ${SUBJECT_TYPES.join(', ')})`, 'SOCIAL_SUBJECT_TYPE_INVALID');
    }
    if (!nonEmptyString(subjectId)) throw bad('subjectId is required', 'SOCIAL_SUBJECT_INVALID');

    let episodeIndex: number | null = null;
    if (subjectType === 'episode') {
      const n = typeof episodeIndexRaw === 'string' ? Number(episodeIndexRaw) : episodeIndexRaw;
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) {
        throw bad('an episode subject needs a non-negative integer episodeIndex', 'SOCIAL_SUBJECT_INVALID');
      }
      episodeIndex = n;
    } else if (episodeIndexRaw !== undefined && episodeIndexRaw !== null && episodeIndexRaw !== '') {
      throw bad('episodeIndex is only valid for subjectType episode', 'SOCIAL_SUBJECT_INVALID');
    }

    const missing = () =>
      new SocialError(`${subjectType} '${subjectId}' not found`, 404, 'SOCIAL_SUBJECT_NOT_FOUND', {
        subjectType,
        subjectId,
        ...(episodeIndex !== null ? { episodeIndex } : {}),
      });

    switch (subjectType) {
      case 'dataset':
      case 'dataset_view':
      case 'episode': {
        const ds = await this.repo.findDataset(subjectId);
        if (!ds) throw missing();
        if (subjectType === 'dataset' && ds.kind === 'view') {
          throw bad(`'${subjectId}' is a dataset view — use subjectType dataset_view`, 'SOCIAL_SUBJECT_INVALID');
        }
        if (subjectType === 'dataset_view' && ds.kind !== 'view') throw missing();
        if (subjectType === 'episode' && ds.demonstrationCount > 0 && episodeIndex! >= ds.demonstrationCount) {
          throw missing();
        }
        break;
      }
      case 'model_version':
        if (!(await this.repo.modelVersionExists(subjectId))) throw missing();
        break;
      case 'training_job':
        if (!(await this.repo.trainingJobExists(subjectId))) throw missing();
        break;
    }
    return { subjectType, subjectId, episodeIndex };
  }

  /** Reject evidence that names an id which does not exist. */
  async assertEvidenceExists(evidence: EvidenceRef[]): Promise<void> {
    const notFound = (i: number, what: string) =>
      bad(`evidence[${i}] names a ${what} that does not exist`, 'SOCIAL_EVIDENCE_NOT_FOUND', { index: i });
    for (const [i, e] of evidence.entries()) {
      switch (e.kind) {
        case 'evaluation_episode': {
          const found = await this.repo.existingEvaluationEpisodeIds(e.ids);
          const absent = e.ids.filter((id) => !found.has(id));
          if (absent.length > 0) {
            throw bad(`evidence[${i}] names evaluation episodes that do not exist: ${absent.join(', ')}`, 'SOCIAL_EVIDENCE_NOT_FOUND', { index: i, missing: absent });
          }
          break;
        }
        case 'sim_to_real_validation':
          if (!(await this.repo.simToRealValidationExists(e.id))) throw notFound(i, 'sim-to-real validation');
          break;
        case 'episode_reward':
          if (!(await this.repo.episodeRewardExists(e.datasetId, e.rewardType))) throw notFound(i, 'episode reward');
          break;
        case 'training_job':
          if (!(await this.repo.trainingJobExists(e.id))) throw notFound(i, 'training job');
          break;
        case 'model_version':
          if (!(await this.repo.modelVersionExists(e.id))) throw notFound(i, 'model version');
          break;
        case 'dataset':
          if (!(await this.repo.datasetExists(e.id))) throw notFound(i, 'dataset');
          break;
        case 'external':
          break;
      }
    }
  }

  // --------------------------------------------------------------------------
  // Comments
  // --------------------------------------------------------------------------

  async listThreads(subject: SubjectRef): Promise<CommentThreadDTO[]> {
    const rows = await this.repo.listComments(subject.subjectType, subject.subjectId, subject.episodeIndex ?? null);
    const threads = new Map<string, CommentThreadDTO>();
    const replies: CommentDTO[] = [];
    for (const row of rows) {
      const dto = toCommentDTO(row);
      if (dto.parentId === null) threads.set(dto.id, { ...dto, replies: [] });
      else replies.push(dto);
    }
    for (const reply of replies) threads.get(reply.parentId!)?.replies.push(reply);
    // A soft-deleted top-level comment with no replies has nothing left to read.
    return [...threads.values()].filter((t) => t.deletedAt === null || t.replies.length > 0);
  }

  async createComment(subject: SubjectRef, actor: Actor, input: CreateCommentInput): Promise<CommentDTO> {
    if (!nonEmptyString(input.body)) throw bad('body is required', 'SOCIAL_COMMENT_INVALID');
    if (input.body.length > MAX_BODY) throw bad(`body exceeds ${MAX_BODY} characters`, 'SOCIAL_COMMENT_INVALID');
    const evidence = parseEvidence(input.evidence);
    await this.assertEvidenceExists(evidence);

    let parentId: string | null = null;
    if (input.parentId !== undefined && input.parentId !== null) {
      const parent = await this.repo.findComment(String(input.parentId));
      if (
        !parent ||
        parent.subjectType !== subject.subjectType ||
        parent.subjectId !== subject.subjectId ||
        parent.episodeIndex !== (subject.episodeIndex ?? null)
      ) {
        throw bad('parentId does not name a comment on this subject', 'SOCIAL_COMMENT_INVALID');
      }
      if (parent.parentId !== null) {
        throw bad('replies are one level deep — reply to the top-level comment', 'SOCIAL_COMMENT_INVALID');
      }
      if (parent.deletedAt !== null) throw bad('cannot reply to a deleted comment', 'SOCIAL_COMMENT_INVALID');
      parentId = parent.id;
    }

    const row = await this.repo.createComment({
      subjectType: subject.subjectType,
      subjectId: subject.subjectId,
      episodeIndex: subject.episodeIndex ?? null,
      parentId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      displayName: actor.displayName,
      body: input.body.trim(),
      evidenceJson: JSON.stringify(evidence),
    });
    return toCommentDTO(row);
  }

  private async ownComment(id: string, actor: Actor): Promise<CommentRow> {
    const row = await this.repo.findComment(id);
    if (!row) throw new SocialError(`Comment '${id}' not found`, 404, 'SOCIAL_COMMENT_NOT_FOUND');
    if (row.actorType !== actor.actorType || row.actorId !== actor.actorId) {
      throw new SocialError('Only the author can change a comment', 403, 'SOCIAL_NOT_AUTHOR');
    }
    return row;
  }

  async editComment(id: string, actor: Actor, body: unknown): Promise<CommentDTO> {
    if (!nonEmptyString(body)) throw bad('body is required', 'SOCIAL_COMMENT_INVALID');
    if (body.length > MAX_BODY) throw bad(`body exceeds ${MAX_BODY} characters`, 'SOCIAL_COMMENT_INVALID');
    const row = await this.ownComment(id, actor);
    if (row.deletedAt !== null) throw new SocialError('Comment was deleted', 409, 'SOCIAL_COMMENT_DELETED');
    return toCommentDTO(await this.repo.updateComment(id, { body: body.trim(), editedAt: new Date() }));
  }

  /** Soft delete: the row stays so replies keep their parent. */
  async deleteComment(id: string, actor: Actor): Promise<CommentDTO> {
    const row = await this.ownComment(id, actor);
    if (row.deletedAt !== null) return toCommentDTO(row);
    return toCommentDTO(await this.repo.updateComment(id, { deletedAt: new Date() }));
  }

  // --------------------------------------------------------------------------
  // Ratings
  // --------------------------------------------------------------------------

  async getRatings(subject: SubjectRef): Promise<RatingDTO[]> {
    return (await this.repo.listRatings(subject.subjectType, subjectKey(subject))).map(toRatingDTO);
  }

  async getMyRating(subject: SubjectRef, actor: Actor): Promise<RatingDTO | null> {
    const row = await this.repo.findRating(subject.subjectType, subjectKey(subject), actor.actorType, actor.actorId);
    return row ? toRatingDTO(row) : null;
  }

  /**
   * Create or replace the actor's rating on a subject. An agent must cite
   * evidence; every cited id must exist. Agent ratings are compliance-logged.
   */
  async putRating(subject: SubjectRef, actor: Actor, input: PutRatingInput): Promise<{ rating: RatingDTO; created: boolean }> {
    const score = input.score;
    if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 1) {
      throw bad('score must be a number in 0..1', 'SOCIAL_RATING_INVALID');
    }
    const dimensions = parseDimensions(subject.subjectType, input.dimensions);
    const evidence = parseEvidence(input.evidence);
    if (actor.actorType === 'agent' && evidence.length === 0) {
      throw bad(
        'An agent rating must cite evidence: name the evaluation, validation, reward scores, run or dataset that justifies the score.',
        'SOCIAL_AGENT_EVIDENCE_REQUIRED'
      );
    }
    await this.assertEvidenceExists(evidence);
    if (input.comment !== undefined && input.comment !== null && typeof input.comment !== 'string') {
      throw bad('comment must be a string', 'SOCIAL_RATING_INVALID');
    }
    const comment = typeof input.comment === 'string' && input.comment.trim() ? input.comment.trim().slice(0, MAX_BODY) : null;

    const key = subjectKey(subject);
    const data = {
      subjectType: subject.subjectType,
      subjectId: subject.subjectId,
      episodeIndex: subject.episodeIndex ?? null,
      subjectKey: key,
      actorType: actor.actorType,
      actorId: actor.actorId,
      displayName: actor.displayName,
      score,
      dimensionsJson: JSON.stringify(dimensions),
      evidenceJson: JSON.stringify(evidence),
      comment,
    };

    let row: RatingRow;
    let created = false;
    const existing = await this.repo.findRating(subject.subjectType, key, actor.actorType, actor.actorId);
    if (existing) {
      row = await this.repo.updateRating(existing.id, data);
    } else {
      try {
        row = await this.repo.createRating(data);
        created = true;
      } catch (error) {
        // Lost a race with a concurrent PUT by the same actor: the unique
        // index held, so update the row that won instead of duplicating it.
        if ((error as { code?: string }).code !== 'P2002') throw error;
        const winner = await this.repo.findRating(subject.subjectType, key, actor.actorType, actor.actorId);
        if (!winner) throw error;
        row = await this.repo.updateRating(winner.id, data);
      }
    }

    const rating = toRatingDTO(row);
    if (actor.actorType === 'agent') await this.logAgentRating(rating);
    return { rating, created };
  }

  private async logAgentRating(rating: RatingDTO): Promise<void> {
    await this.compliance.logAIDecision({
      sessionId: `social-rating-${rating.actorId}`,
      robotId: 'platform',
      payload: {
        description: `Agent ${rating.actorId} rated ${rating.subjectType} ${rating.subjectId}${rating.episodeIndex !== null ? `#${rating.episodeIndex}` : ''} at ${rating.score}`,
        outputAction: 'rating',
        confidence: rating.score,
        metadata: {
          component: 'social',
          ratingId: rating.id,
          actorType: rating.actorType,
          actorId: rating.actorId,
          subjectType: rating.subjectType,
          subjectId: rating.subjectId,
          episodeIndex: rating.episodeIndex,
          score: rating.score,
          dimensions: rating.dimensions,
          evidence: rating.evidence,
        },
      },
      input: { evidence: rating.evidence },
      output: { score: rating.score, dimensions: rating.dimensions },
    });
  }

  /** Counts and means for one subject, human and agent kept apart. */
  async summary(subject: SubjectRef): Promise<RatingSummary> {
    const [rows, commentCount] = await Promise.all([
      this.repo.listRatings(subject.subjectType, subjectKey(subject)),
      this.repo.countComments(subject.subjectType, subject.subjectId, subject.episodeIndex ?? null),
    ]);
    const ratings = rows.map(toRatingDTO);
    const byDimension: Record<string, RatingAggregate> = {};
    for (const dim of RATING_DIMENSIONS[subject.subjectType]) {
      const values = ratings.map((r) => r.dimensions[dim]).filter((v): v is number => typeof v === 'number');
      if (values.length > 0) byDimension[dim] = aggregate(values);
    }
    const byActorType = Object.fromEntries(
      ACTOR_TYPES.map((t) => [t, aggregate(ratings.filter((r) => r.actorType === t).map((r) => r.score))])
    ) as Record<ActorType, RatingAggregate>;
    const all = aggregate(ratings.map((r) => r.score));
    return { count: all.count, mean: all.mean, byDimension, byActorType, commentCount };
  }

  // --------------------------------------------------------------------------
  // Feed
  // --------------------------------------------------------------------------

  async feed(query: FeedQuery): Promise<FeedItem[]> {
    const limit = Math.min(Math.max(1, Math.floor(query.limit ?? FEED_DEFAULT)), FEED_MAX);
    const filter = { actorType: query.actorType, subjectType: query.subjectType, limit };
    const [comments, ratings] = await Promise.all([this.repo.recentComments(filter), this.repo.recentRatings(filter)]);
    const items: FeedItem[] = [
      ...comments.map(toCommentDTO).map((c): FeedItem => ({
        kind: 'comment',
        id: c.id,
        subjectType: c.subjectType,
        subjectId: c.subjectId,
        episodeIndex: c.episodeIndex,
        actorType: c.actorType,
        actorId: c.actorId,
        displayName: c.displayName,
        text: c.body,
        score: null,
        evidence: c.evidence,
        at: c.createdAt,
      })),
      ...ratings.map(toRatingDTO).map((r): FeedItem => ({
        kind: 'rating',
        id: r.id,
        subjectType: r.subjectType,
        subjectId: r.subjectId,
        episodeIndex: r.episodeIndex,
        actorType: r.actorType,
        actorId: r.actorId,
        displayName: r.displayName,
        text: r.comment,
        score: r.score,
        evidence: r.evidence,
        at: r.updatedAt,
      })),
    ];
    items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
    return items.slice(0, limit);
  }
}

export const socialService = new SocialService();
