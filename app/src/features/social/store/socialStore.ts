/**
 * @file socialStore.ts
 * @description Zustand store for comments, ratings and summaries per subject,
 *   the viewer's own actor, and the activity feed (TASK-241).
 * @feature social
 */

import { createStore } from '@/store';
import { errorMessage } from '@/shared/components/ui';
import { socialApi } from '../api/socialApi';
import { subjectKey } from '../utils/social';
import type {
  Actor,
  CommentThreadDTO,
  FeedItem,
  PutRatingInput,
  RatingDTO,
  RatingSummary,
  SubjectRef,
} from '../types/social.types';

export interface SubjectSocialState {
  threads: CommentThreadDTO[];
  mine: RatingDTO | null;
  ratings: RatingDTO[];
  summary: RatingSummary | null;
  loading: boolean;
  error: string | null;
}

interface SocialStore {
  me: Actor | null;
  subjects: Record<string, SubjectSocialState>;
  feed: FeedItem[];
  feedLoading: boolean;
  feedError: string | null;

  loadMe: () => Promise<void>;
  load: (s: SubjectRef) => Promise<void>;
  addComment: (s: SubjectRef, body: string, parentId?: string | null) => Promise<void>;
  editComment: (s: SubjectRef, id: string, body: string) => Promise<void>;
  deleteComment: (s: SubjectRef, id: string) => Promise<void>;
  rate: (s: SubjectRef, input: PutRatingInput) => Promise<void>;
  loadFeed: (filter?: Parameters<typeof socialApi.feed>[0]) => Promise<void>;
}

const EMPTY: SubjectSocialState = { threads: [], mine: null, ratings: [], summary: null, loading: false, error: null };

const message = (e: unknown): string => errorMessage(e);

export const useSocialStore = createStore<SocialStore>(
  (set, get) => ({
    me: null,
    subjects: {},
    feed: [],
    feedLoading: false,
    feedError: null,

    loadMe: async () => {
      if (get().me) return;
      try {
        const me = await socialApi.me();
        set((st) => {
          st.me = me;
        });
      } catch {
        // Without an actor the thread still reads; only edit/delete hide.
      }
    },

    load: async (s) => {
      const key = subjectKey(s);
      set((st) => {
        st.subjects[key] = { ...(st.subjects[key] ?? EMPTY), loading: true, error: null };
      });
      try {
        const [threads, ratings, summary] = await Promise.all([socialApi.threads(s), socialApi.ratings(s), socialApi.summary(s)]);
        set((st) => {
          st.subjects[key] = { threads, mine: ratings.mine, ratings: ratings.ratings, summary, loading: false, error: null };
        });
      } catch (e) {
        set((st) => {
          st.subjects[key] = { ...(st.subjects[key] ?? EMPTY), loading: false, error: message(e) };
        });
      }
    },

    addComment: async (s, body, parentId) => {
      await socialApi.comment(s, body, parentId);
      await get().load(s);
    },

    editComment: async (s, id, body) => {
      await socialApi.editComment(id, body);
      await get().load(s);
    },

    deleteComment: async (s, id) => {
      await socialApi.deleteComment(id);
      await get().load(s);
    },

    rate: async (s, input) => {
      await socialApi.rate(s, input);
      await get().load(s);
    },

    loadFeed: async (filter) => {
      set((st) => {
        st.feedLoading = true;
        st.feedError = null;
      });
      try {
        const items = await socialApi.feed(filter);
        set((st) => {
          st.feed = items;
          st.feedLoading = false;
        });
      } catch (e) {
        set((st) => {
          st.feedLoading = false;
          st.feedError = message(e);
        });
      }
    },
  }),
  { name: 'SocialStore' }
);

export const EMPTY_SUBJECT_STATE = EMPTY;
