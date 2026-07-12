/**
 * @file index.ts
 * @description Barrel export for datacollection feature
 * @feature datacollection
 */

// Types
export * from './types/datacollection.types';

// Store
export { useDataCollectionStore } from './store/datacollectionStore';
export {
  selectSessions,
  selectSelectedSession,
  selectActiveSession,
  selectQualityFeedback,
  selectEpisodes,
  selectRecordingProgress,
  selectSessionFilters,
  selectSessionPagination,
  selectUncertaintyAnalysis,
  selectCollectionPriorities,
  selectCollectionTargets,
  selectIsLoading,
  selectError,
  selectSessionById,
  selectHighPriorityTargets,
} from './store/datacollectionStore';

// API
export { datacollectionApi } from './api/datacollectionApi';

// Hooks
export {
  useTeleoperationSessions,
  useActiveSession,
  useSessionDetail,
  useCollectionPriorities,
  useUncertaintyAnalysis,
} from './hooks/datacollection';
export type {
  UseTeleoperationSessionsReturn,
  UseActiveSessionReturn,
  UseSessionDetailReturn,
  UseCollectionPrioritiesReturn,
  UseUncertaintyAnalysisReturn,
} from './hooks/datacollection';
export { useTeleopEvents } from './hooks/useTeleopEvents';
export type { UseTeleopEventsReturn } from './hooks/useTeleopEvents';
export { useSimulatedVrInput } from './hooks/useSimulatedVrInput';
export type { SimInputStatus } from './hooks/useSimulatedVrInput';

// Components
export {
  SessionStatusBadge,
  SessionCard,
  SessionList,
  SessionTypeSelector,
  QualityIndicator,
  PriorityDashboard,
  UncertaintyHeatmap,
  SessionStepIndicator,
  EpisodePanel,
  VRSessionPanel,
} from './components';
export type {
  SessionStatusBadgeProps,
  SessionCardProps,
  SessionListProps,
  SessionTypeSelectorProps,
  QualityIndicatorProps,
  PriorityDashboardProps,
  UncertaintyHeatmapProps,
  SessionStepIndicatorProps,
  EpisodePanelProps,
  VRSessionPanelProps,
} from './components';

// Pages
export {
  DataCollectionPage,
  NewSessionPage,
  SessionDetailPage,
} from './pages';
