/**
 * @file index.ts
 * @description Barrel export for fleetlearning feature
 * @feature fleetlearning
 */

// Types
export * from './types/fleetlearning.types';

// Store
export { useFleetLearningStore } from './store/fleetlearningStore';
export {
  selectRounds,
  selectSelectedRound,
  selectParticipants,
  selectPrivacyBudgets,
  selectROHEMetrics,
  selectConvergenceData,
  selectFilters,
  selectPagination,
  selectIsLoading,
  selectError,
  selectRoundById,
  selectActiveRounds,
  selectCompletedRounds,
  selectLowPrivacyBudgetRobots,
} from './store/fleetlearningStore';

// API
export { fleetlearningApi } from './api/fleetlearningApi';

// Hooks
export {
  useFederatedRounds,
  useRoundDetail,
  useCreateRound,
  usePrivacyBudgets,
  useROHEMetrics,
  useConvergenceData,
} from './hooks/fleetlearning';
export type {
  UseFederatedRoundsReturn,
  UseRoundDetailReturn,
  UseCreateRoundReturn,
  UsePrivacyBudgetsReturn,
  UseROHEMetricsReturn,
  UseConvergenceDataReturn,
} from './hooks/fleetlearning';

// Components
export {
  RoundStatusBadge,
  ParticipantStatusBadge,
  FederatedRoundCard,
  ParticipantList,
  ConvergenceChart,
  PrivacyBudgetView,
  ROHEDashboard,
  CreateRoundModal,
} from './components';
export type {
  RoundStatusBadgeProps,
  ParticipantStatusBadgeProps,
  FederatedRoundCardProps,
  ParticipantListProps,
  ConvergenceChartProps,
  PrivacyBudgetViewProps,
  ROHEDashboardProps,
  CreateRoundModalProps,
} from './components';

// Pages
export { FleetLearningPage, RoundDetailPage } from './pages';
