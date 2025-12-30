/**
 * @file index.ts
 * @description Safety feature module exports
 * @feature safety
 */

// Types
export * from './types/safety.types';

// API
export { safetyApi } from './api/safetyApi';

// Store
export {
  useSafetyStore,
  selectFleetStatus,
  selectIsLoadingFleetStatus,
  selectFleetHasTriggeredEStop,
  selectTriggeredRobotCount,
  selectRobotStatus,
  selectIsRobotEStopTriggered,
  selectEvents,
  selectIsTriggering,
  selectIsResetting,
  selectLastActionError,
  selectHeartbeatsActive,
} from './store/safetyStore';

// Hooks
export {
  useFleetSafety,
  useRobotSafety,
  useZoneSafety,
  useSafetyEvents,
  useHeartbeats,
  useSafetyOverview,
} from './hooks/useSafety';

// Components
export { FleetEmergencyStopButton } from './components/FleetEmergencyStopButton';
export { ZoneEmergencyStopButton } from './components/ZoneEmergencyStopButton';
export { RobotEmergencyStopButton } from './components/RobotEmergencyStopButton';
export { SafetyStatusDashboard } from './components/SafetyStatusDashboard';
