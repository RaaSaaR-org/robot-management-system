/**
 * @file index.ts
 * @description Barrel export for explainability feature
 * @feature explainability
 */

// Types
export * from './types';

// API
export { explainabilityApi } from './api';
export type { GetDecisionsParams } from './api';

// Store
export {
  useExplainabilityStore,
  selectDecisions,
  selectSelectedDecision,
  selectFormattedExplanation,
  selectMetrics,
  selectDocumentation,
  selectPagination,
  selectIsLoading,
  selectError,
} from './store';

// Hooks
export { useDecisions, useMetrics, useDocumentation } from './hooks';
export type {
  UseDecisionsOptions,
  UseDecisionsReturn,
  UseMetricsOptions,
  UseMetricsReturn,
  UseDocumentationOptions,
  UseDocumentationReturn,
} from './hooks';

// Components
export {
  ConfidenceGauge,
  SafetyBadge,
  DecisionViewer,
  DecisionList,
  PerformanceDashboard,
  DocumentationPortal,
} from './components';
export type {
  ConfidenceGaugeProps,
  SafetyBadgeProps,
  DecisionViewerProps,
  DecisionListProps,
  PerformanceDashboardProps,
  DocumentationPortalProps,
} from './components';

// Pages
export { ExplainabilityPage } from './pages';
