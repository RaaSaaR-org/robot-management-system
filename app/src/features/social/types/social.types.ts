/**
 * @file social.types.ts
 * @description Comments, ratings, evidence and feed shapes — the client side of
 *   `server/src/types/social.types.ts` (TASK-241).
 * @feature social
 */

export type ActorType = 'user' | 'agent' | 'system';

export interface Actor {
  actorType: ActorType;
  actorId: string;
  displayName: string;
}

export type SubjectType = 'dataset' | 'dataset_view' | 'model_version' | 'episode' | 'training_job';

export interface SubjectRef {
  subjectType: SubjectType;
  subjectId: string;
  /** Only for `episode`; subjectId is then the dataset id. */
  episodeIndex?: number | null;
}

export const RATING_DIMENSIONS: Readonly<Record<SubjectType, readonly string[]>> = {
  dataset: ['coverage', 'cleanliness', 'diversity', 'labelQuality'],
  dataset_view: ['coverage', 'cleanliness', 'diversity', 'labelQuality'],
  model_version: ['successRate', 'robustness', 'latency', 'simToRealGap'],
  episode: ['demonstrationQuality', 'taskCompletion'],
  training_job: ['resultStrength', 'reproducibility'],
};

export type EvidenceRef =
  | { kind: 'evaluation_episode'; ids: string[] }
  | { kind: 'sim_to_real_validation'; id: string }
  | { kind: 'episode_reward'; datasetId: string; rewardType: string }
  | { kind: 'training_job'; id: string }
  | { kind: 'model_version'; id: string }
  | { kind: 'dataset'; id: string }
  | { kind: 'external'; uri: string; note: string };

export interface CommentDTO extends Actor {
  id: string;
  subjectType: SubjectType;
  subjectId: string;
  episodeIndex: number | null;
  parentId: string | null;
  body: string;
  evidence: EvidenceRef[];
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
}

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

export interface RatingAggregate {
  count: number;
  mean: number | null;
}

export interface RatingSummary {
  count: number;
  mean: number | null;
  byDimension: Record<string, RatingAggregate>;
  byActorType: Record<ActorType, RatingAggregate>;
  commentCount: number;
}

export interface FeedItem {
  kind: 'comment' | 'rating';
  id: string;
  subjectType: SubjectType;
  subjectId: string;
  episodeIndex: number | null;
  actorType: ActorType;
  actorId: string;
  displayName: string;
  text: string | null;
  score: number | null;
  evidence: EvidenceRef[];
  at: string;
}

export interface PutRatingInput {
  score: number;
  dimensions?: Record<string, number>;
  evidence?: EvidenceRef[];
  comment?: string | null;
}
