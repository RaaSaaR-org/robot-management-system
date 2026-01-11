/**
 * @file index.ts
 * @description Export all public APIs from the incidents feature
 * @feature incidents
 */

// Types - explicit exports to avoid naming conflicts
export type {
  Incident,
  IncidentNotification,
  NotificationTemplate,
  IncidentType,
  IncidentSeverity,
  IncidentStatus,
  Authority,
  Regulation,
  NotificationType,
  NotificationStatus,
  SystemSnapshot,
  CreateIncidentRequest,
  UpdateIncidentRequest,
  IncidentListResponse,
  NotificationTimeline as NotificationTimelineType,
  RiskAssessment,
  DashboardStats,
  IncidentFilters as IncidentFiltersType,
  IncidentPagination,
  IncidentsState,
  IncidentsActions,
  IncidentsStore,
} from './types/index.js';

export {
  INCIDENT_TYPE_LABELS,
  INCIDENT_SEVERITY_LABELS,
  INCIDENT_STATUS_LABELS,
  AUTHORITY_LABELS,
  REGULATION_LABELS,
  NOTIFICATION_TYPE_LABELS,
  NOTIFICATION_STATUS_LABELS,
  SEVERITY_PRIORITY,
} from './types/index.js';

// API
export * from './api/index.js';

// Store
export * from './store/index.js';

// Hooks
export * from './hooks/index.js';

// Components
export * from './components/index.js';

// Pages
export * from './pages/index.js';
