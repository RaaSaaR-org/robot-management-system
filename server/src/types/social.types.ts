/**
 * @file social.types.ts
 * @description Actors, comments, ratings and evidence — the shared discussion
 *   layer over datasets, views, model versions, episodes and training jobs
 *   (TASK-241).
 * @feature social
 */

/** Who wrote a comment or rating. A value object, not a table. */
export type ActorType = 'user' | 'agent' | 'system';

export const ACTOR_TYPES: readonly ActorType[] = ['user', 'agent', 'system'];

export interface Actor {
  actorType: ActorType;
  /** User.id, AgentCard.name, or a service name. */
  actorId: string;
  /** Denormalized, so a deleted actor still reads. */
  displayName: string;
}

/**
 * What can be discussed. `episode` addresses one episode of a dataset:
 * subjectId is the dataset id and `episodeIndex` names the episode.
 * `dataset_view` is a Dataset row with `kind = 'view'` (TASK-240).
 * `experiment` is an Experiment (TASK-242) — where its verdict is posted.
 */
export type SubjectType =
  | 'dataset'
  | 'dataset_view'
  | 'model_version'
  | 'episode'
  | 'training_job'
  | 'experiment';

export const SUBJECT_TYPES: readonly SubjectType[] = [
  'dataset',
  'dataset_view',
  'model_version',
  'episode',
  'training_job',
  'experiment',
];

/**
 * Fixed rating dimensions per subject type, so ratings are comparable. All
 * optional; `score` is the only required number. Each value is 0..1.
 */
export const RATING_DIMENSIONS: Readonly<Record<SubjectType, readonly string[]>> = {
  dataset: ['coverage', 'cleanliness', 'diversity', 'labelQuality'],
  dataset_view: ['coverage', 'cleanliness', 'diversity', 'labelQuality'],
  model_version: ['successRate', 'robustness', 'latency', 'simToRealGap'],
  episode: ['demonstrationQuality', 'taskCompletion'],
  training_job: ['resultStrength', 'reproducibility'],
  experiment: ['rigor', 'usefulness'],
};

/**
 * A pointer to the measurement a judgement rests on. An agent's rating must
 * carry at least one; every referenced id must exist.
 */
export type EvidenceRef =
  | { kind: 'evaluation_episode'; ids: string[] }
  | { kind: 'sim_to_real_validation'; id: string }
  | { kind: 'episode_reward'; datasetId: string; rewardType: string }
  | { kind: 'training_job'; id: string }
  | { kind: 'model_version'; id: string }
  | { kind: 'dataset'; id: string }
  | { kind: 'external'; uri: string; note: string };

export type EvidenceKind = EvidenceRef['kind'];

export const EVIDENCE_KINDS: readonly EvidenceKind[] = [
  'evaluation_episode',
  'sim_to_real_validation',
  'episode_reward',
  'training_job',
  'model_version',
  'dataset',
  'external',
];

/** Identifies one subject. */
export interface SubjectRef {
  subjectType: SubjectType;
  subjectId: string;
  /** Required for `episode`, forbidden otherwise. */
  episodeIndex?: number | null;
}

export interface CommentDTO extends Actor {
  id: string;
  subjectType: SubjectType;
  subjectId: string;
  episodeIndex: number | null;
  parentId: string | null;
  /** Empty string when the comment is soft-deleted. */
  body: string;
  evidence: EvidenceRef[];
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
}

/** A top-level comment with its replies (threading is one level deep). */
export interface CommentThreadDTO extends CommentDTO {
  replies: CommentDTO[];
}

export interface RatingDTO extends Actor {
  id: string;
  subjectType: SubjectType;
  subjectId: string;
  episodeIndex: number | null;
  score: number;
  dimensions: Record<string, number>;
  evidence: EvidenceRef[];
  comment: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCommentInput {
  body: string;
  parentId?: string | null;
  evidence?: EvidenceRef[];
  episodeIndex?: number | null;
}

export interface UpdateCommentInput {
  body: string;
}

export interface PutRatingInput {
  score: number;
  dimensions?: Record<string, number>;
  evidence?: EvidenceRef[];
  comment?: string | null;
  episodeIndex?: number | null;
}

export interface RatingAggregate {
  count: number;
  /** null when count is 0. */
  mean: number | null;
}

/**
 * Ratings summary for one subject. `byActorType` keeps the human mean and the
 * agent mean apart instead of conflating them.
 */
export interface RatingSummary {
  count: number;
  mean: number | null;
  byDimension: Record<string, RatingAggregate>;
  byActorType: Record<ActorType, RatingAggregate>;
  commentCount: number;
}

export type FeedItemKind = 'comment' | 'rating';

export interface FeedItem {
  kind: FeedItemKind;
  id: string;
  subjectType: SubjectType;
  subjectId: string;
  episodeIndex: number | null;
  actorType: ActorType;
  actorId: string;
  displayName: string;
  /** Comment body, or the rating's comment. */
  text: string | null;
  /** Rating score; null for comments. */
  score: number | null;
  evidence: EvidenceRef[];
  /** createdAt for comments, updatedAt for ratings. */
  at: string;
}

export interface FeedQuery {
  actorType?: ActorType;
  subjectType?: SubjectType;
  /** Default 50, max 200. */
  limit?: number;
}
