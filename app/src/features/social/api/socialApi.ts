/**
 * @file socialApi.ts
 * @description REST client for `/api/social` — comments, ratings, summaries
 *   and the activity feed (TASK-241).
 * @feature social
 */

import { apiClient } from '@/api/client';
import type {
  Actor,
  ActorType,
  CommentDTO,
  CommentThreadDTO,
  FeedItem,
  PutRatingInput,
  RatingDTO,
  RatingSummary,
  SubjectRef,
  SubjectType,
} from '../types/social.types';

function base(s: SubjectRef): string {
  return `/social/${s.subjectType}/${encodeURIComponent(s.subjectId)}`;
}

function epQuery(s: SubjectRef): string {
  return s.subjectType === 'episode' && s.episodeIndex != null ? `?episodeIndex=${s.episodeIndex}` : '';
}

export const socialApi = {
  async me(): Promise<Actor> {
    return (await apiClient.get<{ actor: Actor }>('/social/me')).data.actor;
  },

  async threads(s: SubjectRef): Promise<CommentThreadDTO[]> {
    return (await apiClient.get<{ threads: CommentThreadDTO[] }>(`${base(s)}/comments${epQuery(s)}`)).data.threads;
  },

  async comment(s: SubjectRef, body: string, parentId?: string | null): Promise<CommentDTO> {
    const payload = { body, parentId: parentId ?? null, episodeIndex: s.episodeIndex ?? null };
    return (await apiClient.post<{ comment: CommentDTO }>(`${base(s)}/comments`, payload)).data.comment;
  },

  async editComment(id: string, body: string): Promise<CommentDTO> {
    return (await apiClient.patch<{ comment: CommentDTO }>(`/social/comments/${encodeURIComponent(id)}`, { body })).data.comment;
  },

  async deleteComment(id: string): Promise<CommentDTO> {
    return (await apiClient.delete<{ comment: CommentDTO }>(`/social/comments/${encodeURIComponent(id)}`)).data.comment;
  },

  async ratings(s: SubjectRef): Promise<{ mine: RatingDTO | null; ratings: RatingDTO[] }> {
    return (await apiClient.get<{ mine: RatingDTO | null; ratings: RatingDTO[] }>(`${base(s)}/rating${epQuery(s)}`)).data;
  },

  async rate(s: SubjectRef, input: PutRatingInput): Promise<RatingDTO> {
    const payload = { ...input, episodeIndex: s.episodeIndex ?? null };
    return (await apiClient.put<{ rating: RatingDTO }>(`${base(s)}/rating`, payload)).data.rating;
  },

  async summary(s: SubjectRef): Promise<RatingSummary> {
    return (await apiClient.get<{ summary: RatingSummary }>(`${base(s)}/summary${epQuery(s)}`)).data.summary;
  },

  async feed(filter: { actorType?: ActorType; subjectType?: SubjectType; limit?: number } = {}): Promise<FeedItem[]> {
    const q = new URLSearchParams();
    if (filter.actorType) q.set('actorType', filter.actorType);
    if (filter.subjectType) q.set('subjectType', filter.subjectType);
    if (filter.limit) q.set('limit', String(filter.limit));
    const qs = q.toString();
    return (await apiClient.get<{ items: FeedItem[] }>(`/social/feed${qs ? `?${qs}` : ''}`)).data.items;
  },
};
