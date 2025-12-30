/**
 * @file safetyStore.ts
 * @description Zustand store for safety state management
 * @feature safety
 */

import { enableMapSet } from 'immer';
import { createStore } from '@/store/createStore';
import { safetyApi } from '../api/safetyApi';
import type {
  RobotSafetyStatus,
  FleetSafetyStatus,
  EStopEvent,
} from '../types/safety.types';

// Enable Immer support for Map and Set
enableMapSet();

// ============================================================================
// STORE STATE
// ============================================================================

interface SafetyState {
  // Fleet status
  fleetStatus: FleetSafetyStatus | null;
  isLoadingFleetStatus: boolean;
  fleetStatusError: string | null;

  // Individual robot status cache
  robotStatuses: Map<string, RobotSafetyStatus>;

  // E-stop events
  events: EStopEvent[];
  isLoadingEvents: boolean;

  // E-stop action state
  isTriggering: boolean;
  isResetting: boolean;
  lastActionError: string | null;

  // Heartbeat state
  heartbeatsActive: boolean;
}

interface SafetyActions {
  // Fleet status
  fetchFleetStatus: () => Promise<void>;
  clearFleetStatus: () => void;

  // Robot status
  fetchRobotStatus: (robotId: string) => Promise<RobotSafetyStatus | null>;
  clearRobotStatuses: () => void;

  // E-stop actions
  triggerRobotEStop: (
    robotId: string,
    reason: string
  ) => Promise<boolean>;
  resetRobotEStop: (robotId: string) => Promise<boolean>;
  triggerFleetEStop: (reason: string) => Promise<boolean>;
  resetFleetEStop: () => Promise<boolean>;
  triggerZoneEStop: (zoneId: string, reason: string) => Promise<boolean>;

  // Events
  fetchEvents: (limit?: number) => Promise<void>;
  addEvent: (event: EStopEvent) => void;

  // Heartbeats
  startHeartbeats: (intervalMs?: number) => Promise<boolean>;
  stopHeartbeats: () => Promise<boolean>;

  // Clear errors
  clearError: () => void;
}

type SafetyStore = SafetyState & SafetyActions;

// ============================================================================
// STORE IMPLEMENTATION
// ============================================================================

export const useSafetyStore = createStore<SafetyStore>(
  (set, get) => ({
    // Initial state
    fleetStatus: null,
    isLoadingFleetStatus: false,
    fleetStatusError: null,
    robotStatuses: new Map(),
    events: [],
    isLoadingEvents: false,
    isTriggering: false,
    isResetting: false,
    lastActionError: null,
    heartbeatsActive: false,

    // Fleet status actions
    fetchFleetStatus: async () => {
      set((state) => {
        state.isLoadingFleetStatus = true;
        state.fleetStatusError = null;
      });

      try {
        const status = await safetyApi.getFleetSafetyStatus();
        set((state) => {
          state.fleetStatus = status;
          state.isLoadingFleetStatus = false;

          // Also update robot status cache
          for (const robot of status.robots) {
            state.robotStatuses.set(robot.robotId, robot);
          }
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to fetch fleet status';
        set((state) => {
          state.fleetStatusError = message;
          state.isLoadingFleetStatus = false;
        });
      }
    },

    clearFleetStatus: () => {
      set((state) => {
        state.fleetStatus = null;
        state.fleetStatusError = null;
      });
    },

    // Robot status actions
    fetchRobotStatus: async (robotId: string) => {
      try {
        const status = await safetyApi.getRobotSafetyStatus(robotId);
        set((state) => {
          state.robotStatuses.set(robotId, status);
        });
        return status;
      } catch {
        return null;
      }
    },

    clearRobotStatuses: () => {
      set((state) => {
        state.robotStatuses.clear();
      });
    },

    // E-stop trigger actions
    triggerRobotEStop: async (robotId: string, reason: string) => {
      set((state) => {
        state.isTriggering = true;
        state.lastActionError = null;
      });

      try {
        const status = await safetyApi.triggerRobotEStop(robotId, {
          reason,
          triggeredBy: 'user',
        });

        set((state) => {
          state.isTriggering = false;
          state.robotStatuses.set(robotId, status);
        });

        // Refresh fleet status
        get().fetchFleetStatus();
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to trigger E-stop';
        set((state) => {
          state.isTriggering = false;
          state.lastActionError = message;
        });
        return false;
      }
    },

    resetRobotEStop: async (robotId: string) => {
      set((state) => {
        state.isResetting = true;
        state.lastActionError = null;
      });

      try {
        const status = await safetyApi.resetRobotEStop(robotId);

        set((state) => {
          state.isResetting = false;
          state.robotStatuses.set(robotId, status);
        });

        // Refresh fleet status
        get().fetchFleetStatus();
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to reset E-stop';
        set((state) => {
          state.isResetting = false;
          state.lastActionError = message;
        });
        return false;
      }
    },

    triggerFleetEStop: async (reason: string) => {
      set((state) => {
        state.isTriggering = true;
        state.lastActionError = null;
      });

      try {
        await safetyApi.triggerFleetEStop({
          reason,
          triggeredBy: 'user',
        });

        set((state) => {
          state.isTriggering = false;
        });

        // Refresh fleet status
        get().fetchFleetStatus();
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to trigger fleet E-stop';
        set((state) => {
          state.isTriggering = false;
          state.lastActionError = message;
        });
        return false;
      }
    },

    resetFleetEStop: async () => {
      set((state) => {
        state.isResetting = true;
        state.lastActionError = null;
      });

      try {
        await safetyApi.resetFleetEStop();

        set((state) => {
          state.isResetting = false;
        });

        // Refresh fleet status
        get().fetchFleetStatus();
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to reset fleet E-stop';
        set((state) => {
          state.isResetting = false;
          state.lastActionError = message;
        });
        return false;
      }
    },

    triggerZoneEStop: async (zoneId: string, reason: string) => {
      set((state) => {
        state.isTriggering = true;
        state.lastActionError = null;
      });

      try {
        await safetyApi.triggerZoneEStop(zoneId, {
          reason,
          triggeredBy: 'user',
        });

        set((state) => {
          state.isTriggering = false;
        });

        // Refresh fleet status
        get().fetchFleetStatus();
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to trigger zone E-stop';
        set((state) => {
          state.isTriggering = false;
          state.lastActionError = message;
        });
        return false;
      }
    },

    // Event actions
    fetchEvents: async (limit = 50) => {
      set((state) => {
        state.isLoadingEvents = true;
      });

      try {
        const response = await safetyApi.getEStopEvents(limit);
        set((state) => {
          state.events = response.events;
          state.isLoadingEvents = false;
        });
      } catch {
        set((state) => {
          state.isLoadingEvents = false;
        });
      }
    },

    addEvent: (event: EStopEvent) => {
      set((state) => {
        state.events.unshift(event);
        // Keep only last 100 events
        if (state.events.length > 100) {
          state.events.pop();
        }
      });
    },

    // Heartbeat actions
    startHeartbeats: async (intervalMs = 500) => {
      try {
        await safetyApi.startHeartbeats(intervalMs);
        set((state) => {
          state.heartbeatsActive = true;
        });
        return true;
      } catch {
        return false;
      }
    },

    stopHeartbeats: async () => {
      try {
        await safetyApi.stopHeartbeats();
        set((state) => {
          state.heartbeatsActive = false;
        });
        return true;
      } catch {
        return false;
      }
    },

    // Clear error
    clearError: () => {
      set((state) => {
        state.lastActionError = null;
      });
    },
  }),
  { name: 'safety-store' }
);

// ============================================================================
// SELECTORS
// ============================================================================

export const selectFleetStatus = (state: SafetyStore) => state.fleetStatus;
export const selectIsLoadingFleetStatus = (state: SafetyStore) =>
  state.isLoadingFleetStatus;
export const selectFleetHasTriggeredEStop = (state: SafetyStore) =>
  state.fleetStatus?.anyTriggered ?? false;
export const selectTriggeredRobotCount = (state: SafetyStore) =>
  state.fleetStatus?.triggeredCount ?? 0;

export const selectRobotStatus = (robotId: string) => (state: SafetyStore) =>
  state.robotStatuses.get(robotId);
export const selectIsRobotEStopTriggered = (robotId: string) => (state: SafetyStore) =>
  state.robotStatuses.get(robotId)?.status === 'triggered';

export const selectEvents = (state: SafetyStore) => state.events;
export const selectIsTriggering = (state: SafetyStore) => state.isTriggering;
export const selectIsResetting = (state: SafetyStore) => state.isResetting;
export const selectLastActionError = (state: SafetyStore) => state.lastActionError;

export const selectHeartbeatsActive = (state: SafetyStore) => state.heartbeatsActive;
