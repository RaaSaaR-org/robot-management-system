/**
 * @file index.ts
 * @description Export oversight store
 * @feature oversight
 */

export {
  useOversightStore,
  selectDashboardStats,
  selectDashboardLoading,
  selectDashboardError,
  selectActiveManualSessions,
  selectManualSessionsLoading,
  selectAnomalies,
  selectActiveAnomalies,
  selectAnomaliesLoading,
  selectAnomaliesTotal,
  selectVerificationSchedules,
  selectDueVerifications,
  selectVerificationsLoading,
  selectFleetOverview,
  selectFleetOverviewLoading,
  selectSelectedRobotId,
  selectRobotCapabilities,
  selectRobotCapabilitiesLoading,
  selectOversightLogs,
  selectLogsLoading,
  selectLogsTotal,
} from './oversightStore.js';
