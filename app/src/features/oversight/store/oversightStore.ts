/**
 * @file oversightStore.ts
 * @description Zustand store for human oversight state management (EU AI Act Art. 14)
 * @feature oversight
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { oversightApi } from '../api';
import type {
  OversightState,
  OversightActions,
  VerificationSchedule,
  ActivateManualModeInput,
  ManualModeResponse,
  CreateVerificationScheduleInput,
  CompleteVerificationInput,
  AnomalyQueryParams,
  VerificationScheduleQueryParams,
  OversightLogQueryParams,
} from '../types';

type OversightStore = OversightState & OversightActions;

const initialState: OversightState = {
  // Dashboard
  dashboardStats: null,
  dashboardLoading: false,
  dashboardError: null,

  // Manual control
  activeManualSessions: [],
  manualSessionsLoading: false,

  // Anomalies
  anomalies: [],
  activeAnomalies: [],
  anomaliesLoading: false,
  anomaliesTotal: 0,
  anomaliesPage: 1,

  // Verifications
  verificationSchedules: [],
  dueVerifications: [],
  verificationsLoading: false,

  // Fleet overview
  fleetOverview: null,
  fleetOverviewLoading: false,

  // Selected robot capabilities
  selectedRobotId: null,
  robotCapabilities: null,
  robotCapabilitiesLoading: false,

  // Oversight logs
  oversightLogs: [],
  logsLoading: false,
  logsTotal: 0,
  logsPage: 1,
};

export const useOversightStore = create<OversightStore>()(
  devtools(
    immer((set) => ({
      ...initialState,

      // ========================================================================
      // DASHBOARD
      // ========================================================================

      fetchDashboardStats: async () => {
        set((state) => {
          state.dashboardLoading = true;
          state.dashboardError = null;
        });

        try {
          const stats = await oversightApi.getDashboardStats();

          set((state) => {
            state.dashboardStats = stats;
            state.dashboardLoading = false;
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to fetch dashboard';
          set((state) => {
            state.dashboardError = message;
            state.dashboardLoading = false;
          });
        }
      },

      // ========================================================================
      // MANUAL CONTROL
      // ========================================================================

      fetchActiveManualSessions: async () => {
        set((state) => {
          state.manualSessionsLoading = true;
        });

        try {
          const sessions = await oversightApi.getManualSessions({ isActive: true });

          set((state) => {
            state.activeManualSessions = sessions;
            state.manualSessionsLoading = false;
          });
        } catch (error) {
          console.error('Failed to fetch manual sessions:', error);
          set((state) => {
            state.manualSessionsLoading = false;
          });
        }
      },

      activateManualMode: async (input: ActivateManualModeInput): Promise<ManualModeResponse> => {
        const response = await oversightApi.activateManualMode(input);

        // Add the new session to active sessions
        set((state) => {
          state.activeManualSessions.push(response.session);
        });

        return response;
      },

      deactivateManualMode: async (robotId: string) => {
        await oversightApi.deactivateManualMode(robotId);

        // Remove the session from active sessions
        set((state) => {
          state.activeManualSessions = state.activeManualSessions.filter(
            (s) => s.robotId !== robotId
          );
        });
      },

      // ========================================================================
      // ANOMALIES
      // ========================================================================

      fetchAnomalies: async (params?: AnomalyQueryParams) => {
        set((state) => {
          state.anomaliesLoading = true;
        });

        try {
          const response = await oversightApi.getAnomalies(params);

          set((state) => {
            state.anomalies = response.anomalies;
            state.anomaliesTotal = response.total;
            state.anomaliesPage = response.page;
            state.anomaliesLoading = false;
          });
        } catch (error) {
          console.error('Failed to fetch anomalies:', error);
          set((state) => {
            state.anomaliesLoading = false;
          });
        }
      },

      fetchActiveAnomalies: async (robotId?: string) => {
        set((state) => {
          state.anomaliesLoading = true;
        });

        try {
          const anomalies = await oversightApi.getActiveAnomalies(robotId);

          set((state) => {
            state.activeAnomalies = anomalies;
            state.anomaliesLoading = false;
          });
        } catch (error) {
          console.error('Failed to fetch active anomalies:', error);
          set((state) => {
            state.anomaliesLoading = false;
          });
        }
      },

      acknowledgeAnomaly: async (anomalyId: string) => {
        const updated = await oversightApi.acknowledgeAnomaly(anomalyId);

        set((state) => {
          // Update in anomalies list
          const index = state.anomalies.findIndex((a) => a.id === anomalyId);
          if (index !== -1) {
            state.anomalies[index] = updated;
          }

          // Update in active anomalies list
          const activeIndex = state.activeAnomalies.findIndex((a) => a.id === anomalyId);
          if (activeIndex !== -1) {
            state.activeAnomalies[activeIndex] = updated;
          }
        });
      },

      resolveAnomaly: async (anomalyId: string, resolution: string) => {
        const updated = await oversightApi.resolveAnomaly(anomalyId, resolution);

        set((state) => {
          // Update in anomalies list
          const index = state.anomalies.findIndex((a) => a.id === anomalyId);
          if (index !== -1) {
            state.anomalies[index] = updated;
          }

          // Remove from active anomalies
          state.activeAnomalies = state.activeAnomalies.filter((a) => a.id !== anomalyId);
        });
      },

      // ========================================================================
      // VERIFICATIONS
      // ========================================================================

      fetchVerificationSchedules: async (params?: VerificationScheduleQueryParams) => {
        set((state) => {
          state.verificationsLoading = true;
        });

        try {
          const schedules = await oversightApi.getVerificationSchedules(params);

          set((state) => {
            state.verificationSchedules = schedules;
            state.verificationsLoading = false;
          });
        } catch (error) {
          console.error('Failed to fetch verification schedules:', error);
          set((state) => {
            state.verificationsLoading = false;
          });
        }
      },

      fetchDueVerifications: async () => {
        set((state) => {
          state.verificationsLoading = true;
        });

        try {
          const due = await oversightApi.getDueVerifications();

          set((state) => {
            state.dueVerifications = due;
            state.verificationsLoading = false;
          });
        } catch (error) {
          console.error('Failed to fetch due verifications:', error);
          set((state) => {
            state.verificationsLoading = false;
          });
        }
      },

      createVerificationSchedule: async (
        input: CreateVerificationScheduleInput
      ): Promise<VerificationSchedule> => {
        const schedule = await oversightApi.createVerificationSchedule(input);

        set((state) => {
          state.verificationSchedules.push(schedule);
        });

        return schedule;
      },

      completeVerification: async (input: CompleteVerificationInput) => {
        await oversightApi.completeVerification(input);

        // Refresh due verifications
        const due = await oversightApi.getDueVerifications();
        set((state) => {
          state.dueVerifications = due;
        });
      },

      // ========================================================================
      // FLEET & ROBOT CAPABILITIES
      // ========================================================================

      fetchFleetOverview: async () => {
        set((state) => {
          state.fleetOverviewLoading = true;
        });

        try {
          const overview = await oversightApi.getFleetOverview();

          set((state) => {
            state.fleetOverview = overview;
            state.fleetOverviewLoading = false;
          });
        } catch (error) {
          console.error('Failed to fetch fleet overview:', error);
          set((state) => {
            state.fleetOverviewLoading = false;
          });
        }
      },

      fetchRobotCapabilities: async (robotId: string) => {
        set((state) => {
          state.robotCapabilitiesLoading = true;
        });

        try {
          const capabilities = await oversightApi.getRobotCapabilities(robotId);

          set((state) => {
            state.robotCapabilities = capabilities;
            state.selectedRobotId = robotId;
            state.robotCapabilitiesLoading = false;
          });
        } catch (error) {
          console.error('Failed to fetch robot capabilities:', error);
          set((state) => {
            state.robotCapabilitiesLoading = false;
          });
        }
      },

      setSelectedRobotId: (robotId: string | null) => {
        set((state) => {
          state.selectedRobotId = robotId;
          if (!robotId) {
            state.robotCapabilities = null;
          }
        });
      },

      // ========================================================================
      // OVERSIGHT LOGS
      // ========================================================================

      fetchOversightLogs: async (params?: OversightLogQueryParams) => {
        set((state) => {
          state.logsLoading = true;
        });

        try {
          const response = await oversightApi.getOversightLogs(params);

          set((state) => {
            state.oversightLogs = response.logs;
            state.logsTotal = response.total;
            state.logsPage = response.page;
            state.logsLoading = false;
          });
        } catch (error) {
          console.error('Failed to fetch oversight logs:', error);
          set((state) => {
            state.logsLoading = false;
          });
        }
      },

      // ========================================================================
      // RESET
      // ========================================================================

      reset: () => {
        set(() => ({ ...initialState }));
      },
    })),
    { name: 'oversight-store' }
  )
);

// ============================================================================
// SELECTORS
// ============================================================================

// Dashboard
export const selectDashboardStats = (state: OversightStore) => state.dashboardStats;
export const selectDashboardLoading = (state: OversightStore) => state.dashboardLoading;
export const selectDashboardError = (state: OversightStore) => state.dashboardError;

// Manual control
export const selectActiveManualSessions = (state: OversightStore) => state.activeManualSessions;
export const selectManualSessionsLoading = (state: OversightStore) => state.manualSessionsLoading;

// Anomalies
export const selectAnomalies = (state: OversightStore) => state.anomalies;
export const selectActiveAnomalies = (state: OversightStore) => state.activeAnomalies;
export const selectAnomaliesLoading = (state: OversightStore) => state.anomaliesLoading;
export const selectAnomaliesTotal = (state: OversightStore) => state.anomaliesTotal;

// Verifications
export const selectVerificationSchedules = (state: OversightStore) => state.verificationSchedules;
export const selectDueVerifications = (state: OversightStore) => state.dueVerifications;
export const selectVerificationsLoading = (state: OversightStore) => state.verificationsLoading;

// Fleet & robot
export const selectFleetOverview = (state: OversightStore) => state.fleetOverview;
export const selectFleetOverviewLoading = (state: OversightStore) => state.fleetOverviewLoading;
export const selectSelectedRobotId = (state: OversightStore) => state.selectedRobotId;
export const selectRobotCapabilities = (state: OversightStore) => state.robotCapabilities;
export const selectRobotCapabilitiesLoading = (state: OversightStore) =>
  state.robotCapabilitiesLoading;

// Logs
export const selectOversightLogs = (state: OversightStore) => state.oversightLogs;
export const selectLogsLoading = (state: OversightStore) => state.logsLoading;
export const selectLogsTotal = (state: OversightStore) => state.logsTotal;
