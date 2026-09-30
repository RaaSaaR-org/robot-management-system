/**
 * @file index.ts
 * @description Social feature exports — comments, ratings, evidence and the
 *   activity feed over datasets, views, models, episodes and runs (TASK-241).
 * @feature social
 */

export { SocialPanel } from './components/SocialPanel';
export type { SocialPanelProps } from './components/SocialPanel';
export { CommentThread } from './components/CommentThread';
export { RatingWidget, RatingValue, Stars } from './components/RatingWidget';
export { EvidenceChips } from './components/EvidenceChips';
export { ActivityFeed } from './components/ActivityFeed';
export { ActivityPage } from './pages/ActivityPage';
export { useSocial, useActivityFeed } from './hooks/useSocial';
export { useSocialStore } from './store/socialStore';
export { socialApi } from './api/socialApi';
export { evidenceLink, subjectLink } from './utils/social';
export type * from './types/social.types';
