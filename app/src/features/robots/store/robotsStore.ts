/**
 * @file robotsStore.ts
 * @description Zustand store for robot state management
 * @feature robots
 * @dependencies @/store, @/features/robots/api, @/features/robots/types
 * @stateAccess Creates: useRobotsStore
 */

import { createStore } from '@/store';
import { robotsApi } from '../api/robotsApi';
import type {
  RobotsStore,
  Robot,
  RobotStatus,
  RobotTelemetry,
  RobotFilters,
  RobotCommandRequest,
  RobotErrorCode,
} from '../types/robots.types';

// ============================================================================
// INITIAL STATE
// ============================================================================

const initialState = {
  robots: [] as Robot[],
  selectedRobotId: null as string | null,
  filters: {} as RobotFilters,
  pagination: {
    page: 1,
    pageSize: 12,
    total: 0,
    totalPages: 0,
  },
  isLoading: false,
  error: null as string | null,
  robotDetail: null as Robot | null,
  telemetryCache: {} as Record<string, RobotTelemetry>,
};

// ============================================================================
// ERROR MESSAGES
// ============================================================================

const ERROR_MESSAGES: Record<RobotErrorCode, string> = {
  ROBOT_NOT_FOUND: 'Robot not found',
  ROBOT_OFFLINE: 'Robot is currently offline',
  ROBOT_BUSY: 'Robot is busy with another task',
  COMMAND_FAILED: 'Command failed to execute',
  COMMAND_TIMEOUT: 'Command timed out',
  INVALID_COMMAND: 'Invalid command for this robot',
  PERMISSION_DENIED: 'You do not have permission to control this robot',
  NETWORK_ERROR: 'Unable to connect to the server',
  UNKNOWN_ERROR: 'An unexpected error occurred',
};

// ============================================================================
// STORE
// ============================================================================

export const useRobotsStore = createStore<RobotsStore>(
  (set, get) => ({
    ...initialState,

    // --------------------------------------------------------------------------
    // Fetch Robots
    // --------------------------------------------------------------------------
    fetchRobots: async () => {
      set((state) => {
        state.isLoading = true;
        state.error = null;
      });

      try {
        const { filters, pagination } = get();
        const response = await robotsApi.listRobots({
          ...filters,
          page: pagination.page,
          pageSize: pagination.pageSize,
        });

        set((state) => {
          state.robots = response.robots;
          state.pagination = response.pagination;
          state.isLoading = false;
        });
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        set((state) => {
          state.isLoading = false;
          state.error = errorMessage;
        });
      }
    },

    // --------------------------------------------------------------------------
    // Fetch Single Robot
    // --------------------------------------------------------------------------
    fetchRobot: async (id: string) => {
      set((state) => {
        state.isLoading = true;
        state.error = null;
      });

      try {
        const robot = await robotsApi.getRobot(id);

        set((state) => {
          state.robotDetail = robot;
          state.isLoading = false;
          // Also update in list if present
          const index = state.robots.findIndex((r) => r.id === id);
          if (index !== -1) {
            state.robots[index] = robot;
          }
        });
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        set((state) => {
          state.isLoading = false;
          state.error = errorMessage;
        });
      }
    },

    // --------------------------------------------------------------------------
    // Register Robot
    // --------------------------------------------------------------------------
    registerRobot: async (robotUrl: string) => {
      set((state) => {
        state.isLoading = true;
        state.error = null;
      });

      try {
        const response = await robotsApi.registerRobot(robotUrl);
        const robot = response.robot;

        set((state) => {
          // Add to list if not already present
          const index = state.robots.findIndex((r) => r.id === robot.id);
          if (index === -1) {
            state.robots.push(robot);
            state.pagination.total += 1;
          } else {
            state.robots[index] = robot;
          }
          state.isLoading = false;
        });

        return robot;
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        set((state) => {
          state.isLoading = false;
          state.error = errorMessage;
        });
        throw new Error(errorMessage);
      }
    },

    // --------------------------------------------------------------------------
    // Unregister Robot
    // --------------------------------------------------------------------------
    unregisterRobot: async (robotId: string) => {
      set((state) => {
        state.error = null;
      });

      try {
        await robotsApi.unregisterRobot(robotId);

        set((state) => {
          // Remove from list
          state.robots = state.robots.filter((r) => r.id !== robotId);
          state.pagination.total = Math.max(0, state.pagination.total - 1);

          // Clear detail if viewing this robot
          if (state.robotDetail?.id === robotId) {
            state.robotDetail = null;
          }

          // Clear selection if this robot was selected
          if (state.selectedRobotId === robotId) {
            state.selectedRobotId = null;
          }

          // Clear telemetry cache
          delete state.telemetryCache[robotId];
        });
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        set((state) => {
          state.error = errorMessage;
        });
        throw new Error(errorMessage);
      }
    },

    // --------------------------------------------------------------------------
    // Select Robot
    // --------------------------------------------------------------------------
    selectRobot: (id: string | null) => {
      set((state) => {
        state.selectedRobotId = id;
        if (id === null) {
          state.robotDetail = null;
        }
      });
    },

    // --------------------------------------------------------------------------
    // Set Filters
    // --------------------------------------------------------------------------
    setFilters: (filters: Partial<RobotFilters>) => {
      set((state) => {
        state.filters = { ...state.filters, ...filters };
        state.pagination.page = 1; // Reset to first page on filter change
      });
      // Auto-fetch with new filters
      get().fetchRobots();
    },

    // --------------------------------------------------------------------------
    // Clear Filters
    // --------------------------------------------------------------------------
    clearFilters: () => {
      set((state) => {
        state.filters = {};
        state.pagination.page = 1;
      });
      get().fetchRobots();
    },

    // --------------------------------------------------------------------------
    // Set Page
    // --------------------------------------------------------------------------
    setPage: (page: number) => {
      set((state) => {
        state.pagination.page = page;
      });
      get().fetchRobots();
    },

    // --------------------------------------------------------------------------
    // Send Command
    // --------------------------------------------------------------------------
    sendCommand: async (robotId: string, command: RobotCommandRequest) => {
      set((state) => {
        state.error = null;
      });

      try {
        const result = await robotsApi.sendCommand(robotId, command);
        return result;
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        set((state) => {
          state.error = errorMessage;
        });
        throw new Error(errorMessage);
      }
    },

    // --------------------------------------------------------------------------
    // Update Robot Status (for WebSocket updates)
    // --------------------------------------------------------------------------
    updateRobotStatus: (robotId: string, status: RobotStatus) => {
      set((state) => {
        // Update in list
        const robot = state.robots.find((r) => r.id === robotId);
        if (robot) {
          robot.status = status;
          robot.updatedAt = new Date().toISOString();
        }
        // Update in detail if viewing
        if (state.robotDetail?.id === robotId) {
          state.robotDetail.status = status;
          state.robotDetail.updatedAt = new Date().toISOString();
        }
      });
    },

    // --------------------------------------------------------------------------
    // Update Robot Data (for WebSocket updates)
    // --------------------------------------------------------------------------
    updateRobot: (robotUpdate: Partial<Robot> & { id: string }) => {
      set((state) => {
        // Update in list
        const index = state.robots.findIndex((r) => r.id === robotUpdate.id);
        if (index !== -1) {
          state.robots[index] = { ...state.robots[index], ...robotUpdate };
        }
        // Update in detail if viewing
        if (state.robotDetail?.id === robotUpdate.id) {
          state.robotDetail = { ...state.robotDetail, ...robotUpdate };
        }
      });
    },

    // --------------------------------------------------------------------------
    // Update Telemetry Cache
    // --------------------------------------------------------------------------
    updateTelemetry: (robotId: string, telemetry: RobotTelemetry) => {
      set((state) => {
        state.telemetryCache[robotId] = telemetry;
      });
    },

    // --------------------------------------------------------------------------
    // Add Robot (for WebSocket updates)
    // --------------------------------------------------------------------------
    addRobot: (robot: Robot) => {
      set((state) => {
        const index = state.robots.findIndex((r) => r.id === robot.id);
        if (index === -1) {
          state.robots.push(robot);
          state.pagination.total += 1;
        } else {
          state.robots[index] = robot;
        }
      });
    },

    // --------------------------------------------------------------------------
    // Remove Robot (for WebSocket updates)
    // --------------------------------------------------------------------------
    removeRobot: (robotId: string) => {
      set((state) => {
        state.robots = state.robots.filter((r) => r.id !== robotId);
        state.pagination.total = Math.max(0, state.pagination.total - 1);

        if (state.robotDetail?.id === robotId) {
          state.robotDetail = null;
        }
        if (state.selectedRobotId === robotId) {
          state.selectedRobotId = null;
        }
        delete state.telemetryCache[robotId];
      });
    },

    // --------------------------------------------------------------------------
    // Clear Error
    // --------------------------------------------------------------------------
    clearError: () => {
      set((state) => {
        state.error = null;
      });
    },

    // --------------------------------------------------------------------------
    // Reset Store
    // --------------------------------------------------------------------------
    reset: () => {
      set((state) => {
        Object.assign(state, initialState);
      });
    },
  }),
  {
    name: 'RobotsStore',
    persist: false, // Robot data should always be fresh from API
  }
);

// ============================================================================
// SELECTORS
// ============================================================================

/** Select all robots */
export const selectRobots = (state: RobotsStore) => state.robots;

/** Select selected robot ID */
export const selectSelectedRobotId = (state: RobotsStore) => state.selectedRobotId;

/** Select robot detail */
export const selectRobotDetail = (state: RobotsStore) => state.robotDetail;

/** Select filters */
export const selectFilters = (state: RobotsStore) => state.filters;

/** Select pagination */
export const selectPagination = (state: RobotsStore) => state.pagination;

/** Select loading state */
export const selectIsLoading = (state: RobotsStore) => state.isLoading;

/** Select error */
export const selectError = (state: RobotsStore) => state.error;

/** Select telemetry cache */
export const selectTelemetryCache = (state: RobotsStore) => state.telemetryCache;

/** Select robot by ID from list */
export const selectRobotById = (id: string) => (state: RobotsStore) =>
  state.robots.find((r) => r.id === id) ?? null;

/** Select robots by status */
export const selectRobotsByStatus = (status: RobotStatus) => (state: RobotsStore) =>
  state.robots.filter((r) => r.status === status);

/** Select robots that need attention */
export const selectRobotsNeedingAttention = (state: RobotsStore) =>
  state.robots.filter((r) => r.status === 'error' || r.batteryLevel < 20);

/** Select telemetry for a specific robot */
export const selectRobotTelemetry = (robotId: string) => (state: RobotsStore) =>
  state.telemetryCache[robotId] ?? null;

/** Select selected robot from list */
export const selectSelectedRobot = (state: RobotsStore) =>
  state.selectedRobotId ? state.robots.find((r) => r.id === state.selectedRobotId) ?? null : null;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Extract error message from API error
 */
function getErrorMessage(error: unknown): string {
  if (error && typeof error === 'object') {
    // Check for API error format
    if ('code' in error && typeof error.code === 'string') {
      const code = error.code as RobotErrorCode;
      if (code in ERROR_MESSAGES) {
        return ERROR_MESSAGES[code];
      }
    }

    // Check for message property
    if ('message' in error && typeof error.message === 'string') {
      return error.message;
    }

    // Check for response.data.message (Axios error format)
    if ('response' in error) {
      const response = error.response as { data?: { message?: string } };
      if (response?.data?.message) {
        return response.data.message;
      }
    }
  }

  return ERROR_MESSAGES.UNKNOWN_ERROR;
}
