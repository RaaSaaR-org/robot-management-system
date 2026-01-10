/**
 * @file index.ts
 * @description Barrel export for GDPR feature
 * @feature gdpr
 */

// Types
export * from './types';

// API
export { gdprApi } from './api';

// Store
export {
  useGDPRStore,
  selectRequests,
  selectSelectedRequest,
  selectRequestHistory,
  selectConsents,
  selectMetrics,
  selectSLAReport,
  selectPagination,
  selectIsLoading,
  selectIsLoadingRequest,
  selectIsLoadingConsents,
  selectIsLoadingMetrics,
  selectIsSubmitting,
  selectError,
} from './store';

// Components
export {
  SLABadge,
  StatusBadge,
  RequestTypeCard,
  RequestList,
  ConsentToggle,
  ConsentManager,
  RequestDetail,
} from './components';
export type {
  SLABadgeProps,
  StatusBadgeProps,
  RequestTypeCardProps,
  RequestListProps,
  ConsentToggleProps,
  ConsentManagerProps,
  RequestDetailProps,
} from './components';

// Pages
export { GDPRPortalPage } from './pages';
