/**
 * @file useSocial.ts
 * @description Hooks over the social store: one subject's comments, ratings
 *   and summary, and the activity feed (TASK-241).
 * @feature social
 */

import { useEffect } from 'react';
import { useSocialStore, EMPTY_SUBJECT_STATE } from '../store/socialStore';
import { subjectKey } from '../utils/social';
import type { ActorType, SubjectRef, SubjectType } from '../types/social.types';

/** Load and follow one subject's discussion. */
export function useSocial(subject: SubjectRef) {
  const key = subjectKey(subject);
  const state = useSocialStore((s) => s.subjects[key]) ?? EMPTY_SUBJECT_STATE;
  const me = useSocialStore((s) => s.me);
  const load = useSocialStore((s) => s.load);
  const loadMe = useSocialStore((s) => s.loadMe);
  const addComment = useSocialStore((s) => s.addComment);
  const editComment = useSocialStore((s) => s.editComment);
  const deleteComment = useSocialStore((s) => s.deleteComment);
  const rate = useSocialStore((s) => s.rate);

  const { subjectType, subjectId, episodeIndex } = subject;
  useEffect(() => {
    void loadMe();
    void load({ subjectType, subjectId, episodeIndex });
  }, [load, loadMe, subjectType, subjectId, episodeIndex]);

  return {
    ...state,
    me,
    reload: () => load(subject),
    addComment: (body: string, parentId?: string | null) => addComment(subject, body, parentId),
    editComment: (id: string, body: string) => editComment(subject, id, body),
    deleteComment: (id: string) => deleteComment(subject, id),
    rate: (input: Parameters<typeof rate>[1]) => rate(subject, input),
  };
}

/** Load the activity feed, optionally filtered. */
export function useActivityFeed(filter: { actorType?: ActorType; subjectType?: SubjectType; limit?: number } = {}) {
  const feed = useSocialStore((s) => s.feed);
  const loading = useSocialStore((s) => s.feedLoading);
  const error = useSocialStore((s) => s.feedError);
  const loadFeed = useSocialStore((s) => s.loadFeed);
  const { actorType, subjectType, limit } = filter;
  useEffect(() => {
    void loadFeed({ actorType, subjectType, limit });
  }, [loadFeed, actorType, subjectType, limit]);
  return { items: feed, loading, error, reload: () => loadFeed({ actorType, subjectType, limit }) };
}
