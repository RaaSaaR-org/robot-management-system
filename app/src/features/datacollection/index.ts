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
export { useDeviceRole, detectDeviceRole } from './hooks/useDeviceRole';
export type { DeviceRole } from './hooks/useDeviceRole';
export { useTakeHotkeys, DISCARD_UNDO_MS } from './hooks/useTakeHotkeys';
export type { TakeControls, UseTakeHotkeysOptions } from './hooks/useTakeHotkeys';
export { useViewportFill, consoleHeight } from './hooks/useViewportFill';
export { sessionPhase, commandBarTally } from './utils/sessionPhase';
export type { SessionPhase, CommandBarTally } from './utils/sessionPhase';
export type { SimInputStatus } from './hooks/useSimulatedVrInput';

// Components
export {
  SessionStatusBadge,
  SessionList,
  SessionTypeSelector,
  QualityIndicator,
  PriorityDashboard,
  UncertaintyHeatmap,
  TakeDock,
  TakesList,
  SystemsStrip,
  OperatorChip,
  VRSessionPanel,
  SessionCommandBar,
  TestingTools,
  HeadsetHero,
} from './components';
export type {
  SessionStatusBadgeProps,
  SessionListProps,
  SessionTypeSelectorProps,
  QualityIndicatorProps,
  PriorityDashboardProps,
  UncertaintyHeatmapProps,
  TakeDockProps,
  TakesListProps,
  SystemsStripProps,
  OperatorChipProps,
  VRSessionPanelProps,
  SessionCommandBarProps,
  TestingToolsProps,
  HeadsetHeroProps,
} from './components';

// Pages
export {
  DataCollectionPage,
  NewSessionPage,
  SessionDetailPage,
  LiveSessionRedirect,
} from './pages';
