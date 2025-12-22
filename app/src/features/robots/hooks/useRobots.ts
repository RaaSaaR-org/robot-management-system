/**
 * @file useRobots.ts
 * @description React hooks for robot state and operations
 * @feature robots
 * @dependencies @/features/robots/store, @/features/robots/types, @/features/robots/api
 * @stateAccess useRobotsStore (read/write)
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  useRobotsStore,
  selectRobots,
  selectSelectedRobotId,
  selectSelectedRobot,
  selectRobotDetail,
  selectFilters,
  selectPagination,
  selectIsLoading,
  selectError,
  selectRobotById,
  selectRobotTelemetry,
} from '../store/robotsStore';
import { robotsApi } from '../api/robotsApi';
import type {
  Robot,
  RobotStatus,
  RobotFilters,
  RobotCommandRequest,
  RobotCommand,
  RobotTelemetry,
  RobotPagination,
} from '../types/robots.types';

// ============================================================================
// TYPES
// ============================================================================

export interface UseRobotsReturn {
  /** List of robots */
  robots: Robot[];
  /** Currently selected robot */
  selectedRobot: Robot | null;
  /** Selected robot ID */
  selectedRobotId: string | null;
  /** Current filters */
  filters: RobotFilters;
  /** Pagination info */
  pagination: RobotPagination;
  /** Loading state */
  isLoading: boolean;
  /** Error message */
  error: string | null;
  /** Fetch robots */
  fetchRobots: () => Promise<void>;
  /** Select a robot */
  selectRobot: (id: string | null) => void;
  /** Update filters */
  setFilters: (filters: Partial<RobotFilters>) => void;
  /** Clear all filters */
  clearFilters: () => void;
  /** Change page */
  setPage: (page: number) => void;
  /** Send command to robot */
  sendCommand: (robotId: string, command: RobotCommandRequest) => Promise<RobotCommand>;
  /** Clear error */
  clearError: () => void;
}

export interface UseRobotReturn {
  /** Robot data */
  robot: Robot | null;
  /** Telemetry data */
  telemetry: RobotTelemetry | null;
  /** Command history */
  commandHistory: RobotCommand[];
  /** Loading state */
  isLoading: boolean;
  /** Error message */
  error: string | null;
  /** Refresh robot data */
  refresh: () => Promise<void>;
  /** Refresh telemetry */
  refreshTelemetry: () => Promise<void>;
  /** Refresh command history */
  refreshCommandHistory: () => Promise<void>;
  /** Send command */
  sendCommand: (command: RobotCommandRequest) => Promise<RobotCommand>;
  /** Emergency stop */
  emergencyStop: () => Promise<RobotCommand>;
  /** Send to charging */
  sendToCharge: () => Promise<RobotCommand>;
  /** Return to home */
  returnHome: () => Promise<RobotCommand>;
}

export interface UseRobotListReturn {
  /** List of robots */
  robots: Robot[];
  /** Pagination info */
  pagination: RobotPagination;
  /** Loading state */
  isLoading: boolean;
  /** Error message */
  error: string | null;
  /** Refresh list */
  refresh: () => Promise<void>;
  /** Go to page */
  goToPage: (page: number) => void;
  /** Go to next page */
  nextPage: () => void;
  /** Go to previous page */
  prevPage: () => void;
  /** Has next page */
  hasNextPage: boolean;
  /** Has previous page */
  hasPrevPage: boolean;
}

export interface UseRobotCommandReturn {
  /** Send command */
  sendCommand: (command: RobotCommandRequest) => Promise<RobotCommand>;
  /** Emergency stop */
  emergencyStop: () => Promise<RobotCommand>;
  /** Send to charging */
  sendToCharge: () => Promise<RobotCommand>;
  /** Return to home */
  returnHome: () => Promise<RobotCommand>;
  /** Command in progress */
  isExecuting: boolean;
  /** Last error */
  error: string | null;
}

// ============================================================================
// MAIN HOOK
// ============================================================================

/**
 * Hook for accessing robot list state and operations.
 *
 * @example
 * ```tsx
 * function RobotsPage() {
 *   const { robots, isLoading, fetchRobots, setFilters } = useRobots();
 *
 *   useEffect(() => {
 *     fetchRobots();
 *   }, [fetchRobots]);
 *
 *   return (
 *     <div>
 *       {robots.map(robot => <RobotCard key={robot.id} robot={robot} />)}
 *     </div>
 *   );
 * }
 * ```
 */
export function useRobots(): UseRobotsReturn {
  const robots = useRobotsStore(selectRobots);
  const selectedRobotId = useRobotsStore(selectSelectedRobotId);
  const selectedRobot = useRobotsStore(selectSelectedRobot);
  const filters = useRobotsStore(selectFilters);
  const pagination = useRobotsStore(selectPagination);
  const isLoading = useRobotsStore(selectIsLoading);
  const error = useRobotsStore(selectError);

  const storeFetchRobots = useRobotsStore((state) => state.fetchRobots);
  const storeSelectRobot = useRobotsStore((state) => state.selectRobot);
  const storeSetFilters = useRobotsStore((state) => state.setFilters);
  const storeClearFilters = useRobotsStore((state) => state.clearFilters);
  const storeSetPage = useRobotsStore((state) => state.setPage);
  const storeSendCommand = useRobotsStore((state) => state.sendCommand);
  const storeClearError = useRobotsStore((state) => state.clearError);

  const fetchRobots = useCallback(async () => {
    await storeFetchRobots();
  }, [storeFetchRobots]);

  const selectRobot = useCallback(
    (id: string | null) => {
      storeSelectRobot(id);
    },
    [storeSelectRobot]
  );

  const setFilters = useCallback(
    (newFilters: Partial<RobotFilters>) => {
      storeSetFilters(newFilters);
    },
    [storeSetFilters]
  );

  const clearFilters = useCallback(() => {
    storeClearFilters();
  }, [storeClearFilters]);

  const setPage = useCallback(
    (page: number) => {
      storeSetPage(page);
    },
    [storeSetPage]
  );

  const sendCommand = useCallback(
    async (robotId: string, command: RobotCommandRequest) => {
      return storeSendCommand(robotId, command);
    },
    [storeSendCommand]
  );

  const clearError = useCallback(() => {
    storeClearError();
  }, [storeClearError]);

  return useMemo(
    () => ({
      robots,
      selectedRobot,
      selectedRobotId,
      filters,
      pagination,
      isLoading,
      error,
      fetchRobots,
      selectRobot,
      setFilters,
      clearFilters,
      setPage,
      sendCommand,
      clearError,
    }),
    [
      robots,
      selectedRobot,
      selectedRobotId,
      filters,
      pagination,
      isLoading,
      error,
      fetchRobots,
      selectRobot,
      setFilters,
      clearFilters,
      setPage,
      sendCommand,
      clearError,
    ]
  );
}

// ============================================================================
// SINGLE ROBOT HOOK
// ============================================================================

/**
 * Hook for accessing a single robot's data and operations.
 * Automatically fetches robot data on mount.
 *
 * @param id - Robot ID
 *
 * @example
 * ```tsx
 * function RobotDetailPage({ robotId }: { robotId: string }) {
 *   const { robot, telemetry, isLoading, sendCommand } = useRobot(robotId);
 *
 *   if (isLoading) return <Spinner />;
 *   if (!robot) return <div>Robot not found</div>;
 *
 *   return <RobotDetailPanel robot={robot} telemetry={telemetry} />;
 * }
 * ```
 */
export function useRobot(id: string): UseRobotReturn {
  const isLoading = useRobotsStore(selectIsLoading);
  const error = useRobotsStore(selectError);
  const robotDetail = useRobotsStore(selectRobotDetail);
  const robotFromList = useRobotsStore(selectRobotById(id));
  const telemetry = useRobotsStore(selectRobotTelemetry(id));

  const storeFetchRobot = useRobotsStore((state) => state.fetchRobot);
  const storeSendCommand = useRobotsStore((state) => state.sendCommand);
  const storeUpdateTelemetry = useRobotsStore((state) => state.updateTelemetry);

  // Local state for command history
  const [commandHistory, setCommandHistory] = useState<RobotCommand[]>([]);

  // Use detail if available, otherwise fall back to list
  const robot = robotDetail?.id === id ? robotDetail : robotFromList;

  // Fetch robot on mount
  useEffect(() => {
    storeFetchRobot(id);
  }, [id, storeFetchRobot]);

  const refresh = useCallback(async () => {
    await storeFetchRobot(id);
  }, [id, storeFetchRobot]);

  const refreshTelemetry = useCallback(async () => {
    const data = await robotsApi.getTelemetry(id);
    storeUpdateTelemetry(id, data);
  }, [id, storeUpdateTelemetry]);

  const refreshCommandHistory = useCallback(async () => {
    const response = await robotsApi.getCommands(id, { pageSize: 10 });
    setCommandHistory(response.commands);
  }, [id]);

  // Fetch command history on mount
  useEffect(() => {
    refreshCommandHistory();
  }, [refreshCommandHistory]);

  const sendCommand = useCallback(
    async (command: RobotCommandRequest) => {
      const result = await storeSendCommand(id, command);
      // Refresh command history after sending a command
      await refreshCommandHistory();
      return result;
    },
    [id, storeSendCommand, refreshCommandHistory]
  );

  const emergencyStop = useCallback(async () => {
    const result = await robotsApi.emergencyStop(id);
    await refreshCommandHistory();
    return result;
  }, [id, refreshCommandHistory]);

  const sendToCharge = useCallback(async () => {
    const result = await robotsApi.sendToCharge(id);
    await refreshCommandHistory();
    return result;
  }, [id, refreshCommandHistory]);

  const returnHome = useCallback(async () => {
    const result = await robotsApi.returnHome(id);
    await refreshCommandHistory();
    return result;
  }, [id, refreshCommandHistory]);

  return useMemo(
    () => ({
      robot,
      telemetry,
      commandHistory,
      isLoading,
      error,
      refresh,
      refreshTelemetry,
      refreshCommandHistory,
      sendCommand,
      emergencyStop,
      sendToCharge,
      returnHome,
    }),
    [
      robot,
      telemetry,
      commandHistory,
      isLoading,
      error,
      refresh,
      refreshTelemetry,
      refreshCommandHistory,
      sendCommand,
      emergencyStop,
      sendToCharge,
      returnHome,
    ]
  );
}

// ============================================================================
// ROBOT LIST HOOK
// ============================================================================

/**
 * Hook for robot list with pagination controls.
 *
 * @example
 * ```tsx
 * function RobotListWithPagination() {
 *   const { robots, pagination, nextPage, prevPage, hasNextPage } = useRobotList();
 *
 *   return (
 *     <>
 *       <RobotGrid robots={robots} />
 *       <Pagination
 *         page={pagination.page}
 *         total={pagination.totalPages}
 *         onNext={nextPage}
 *         onPrev={prevPage}
 *       />
 *     </>
 *   );
 * }
 * ```
 */
export function useRobotList(): UseRobotListReturn {
  const robots = useRobotsStore(selectRobots);
  const pagination = useRobotsStore(selectPagination);
  const isLoading = useRobotsStore(selectIsLoading);
  const error = useRobotsStore(selectError);

  const storeFetchRobots = useRobotsStore((state) => state.fetchRobots);
  const storeSetPage = useRobotsStore((state) => state.setPage);

  const refresh = useCallback(async () => {
    await storeFetchRobots();
  }, [storeFetchRobots]);

  const goToPage = useCallback(
    (page: number) => {
      storeSetPage(page);
    },
    [storeSetPage]
  );

  const nextPage = useCallback(() => {
    if (pagination.page < pagination.totalPages) {
      storeSetPage(pagination.page + 1);
    }
  }, [pagination.page, pagination.totalPages, storeSetPage]);

  const prevPage = useCallback(() => {
    if (pagination.page > 1) {
      storeSetPage(pagination.page - 1);
    }
  }, [pagination.page, storeSetPage]);

  const hasNextPage = pagination.page < pagination.totalPages;
  const hasPrevPage = pagination.page > 1;

  return useMemo(
    () => ({
      robots,
      pagination,
      isLoading,
      error,
      refresh,
      goToPage,
      nextPage,
      prevPage,
      hasNextPage,
      hasPrevPage,
    }),
    [robots, pagination, isLoading, error, refresh, goToPage, nextPage, prevPage, hasNextPage, hasPrevPage]
  );
}

// ============================================================================
// ROBOT COMMAND HOOK
// ============================================================================

/**
 * Hook for sending commands to a specific robot.
 *
 * @param robotId - Robot ID
 *
 * @example
 * ```tsx
 * function RobotControls({ robotId }: { robotId: string }) {
 *   const { sendCommand, emergencyStop, isExecuting } = useRobotCommand(robotId);
 *
 *   return (
 *     <div>
 *       <Button onClick={() => emergencyStop()} variant="destructive">
 *         Emergency Stop
 *       </Button>
 *     </div>
 *   );
 * }
 * ```
 */
export function useRobotCommand(robotId: string): UseRobotCommandReturn {
  const isLoading = useRobotsStore(selectIsLoading);
  const error = useRobotsStore(selectError);
  const storeSendCommand = useRobotsStore((state) => state.sendCommand);

  const sendCommand = useCallback(
    async (command: RobotCommandRequest) => {
      return storeSendCommand(robotId, command);
    },
    [robotId, storeSendCommand]
  );

  const emergencyStop = useCallback(async () => {
    return robotsApi.emergencyStop(robotId);
  }, [robotId]);

  const sendToCharge = useCallback(async () => {
    return robotsApi.sendToCharge(robotId);
  }, [robotId]);

  const returnHome = useCallback(async () => {
    return robotsApi.returnHome(robotId);
  }, [robotId]);

  return useMemo(
    () => ({
      sendCommand,
      emergencyStop,
      sendToCharge,
      returnHome,
      isExecuting: isLoading,
      error,
    }),
    [sendCommand, emergencyStop, sendToCharge, returnHome, isLoading, error]
  );
}

// ============================================================================
// UTILITY HOOKS
// ============================================================================

/**
 * Hook to get a robot by ID from the store.
 */
export function useRobotById(id: string): Robot | null {
  return useRobotsStore(selectRobotById(id));
}

/**
 * Hook to get robots filtered by status.
 */
export function useRobotsByStatus(status: RobotStatus): Robot[] {
  const robots = useRobotsStore(selectRobots);
  return useMemo(() => robots.filter((r) => r.status === status), [robots, status]);
}

/**
 * Hook to get robots needing attention (error or low battery).
 */
export function useRobotsNeedingAttention(): Robot[] {
  const robots = useRobotsStore(selectRobots);
  return useMemo(
    () => robots.filter((r) => r.status === 'error' || r.batteryLevel < 20),
    [robots]
  );
}
