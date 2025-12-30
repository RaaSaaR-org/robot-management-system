/**
 * @file useSafety.ts
 * @description React hooks for safety functionality
 * @feature safety
 */

import { useCallback, useEffect } from 'react';
import {
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
} from '../store/safetyStore';
// Type re-exported from store

// ============================================================================
// FLEET SAFETY HOOK
// ============================================================================

/**
 * Hook for fleet-wide safety operations
 */
export function useFleetSafety() {
  const fleetStatus = useSafetyStore(selectFleetStatus);
  const isLoading = useSafetyStore(selectIsLoadingFleetStatus);
  const hasTriggeredEStop = useSafetyStore(selectFleetHasTriggeredEStop);
  const triggeredCount = useSafetyStore(selectTriggeredRobotCount);
  const isTriggering = useSafetyStore(selectIsTriggering);
  const isResetting = useSafetyStore(selectIsResetting);
  const lastError = useSafetyStore(selectLastActionError);

  const fetchFleetStatus = useSafetyStore((s) => s.fetchFleetStatus);
  const triggerFleetEStop = useSafetyStore((s) => s.triggerFleetEStop);
  const resetFleetEStop = useSafetyStore((s) => s.resetFleetEStop);
  const clearError = useSafetyStore((s) => s.clearError);

  // Fetch fleet status on mount
  useEffect(() => {
    fetchFleetStatus();
  }, [fetchFleetStatus]);

  const triggerEStop = useCallback(
    async (reason: string) => {
      return triggerFleetEStop(reason);
    },
    [triggerFleetEStop]
  );

  const resetEStop = useCallback(async () => {
    return resetFleetEStop();
  }, [resetFleetEStop]);

  return {
    fleetStatus,
    isLoading,
    hasTriggeredEStop,
    triggeredCount,
    isTriggering,
    isResetting,
    lastError,
    fetchFleetStatus,
    triggerEStop,
    resetEStop,
    clearError,
  };
}

// ============================================================================
// ROBOT SAFETY HOOK
// ============================================================================

/**
 * Hook for individual robot safety operations
 */
export function useRobotSafety(robotId: string) {
  const status = useSafetyStore(selectRobotStatus(robotId));
  const isTriggered = useSafetyStore(selectIsRobotEStopTriggered(robotId));
  const isTriggering = useSafetyStore(selectIsTriggering);
  const isResetting = useSafetyStore(selectIsResetting);
  const lastError = useSafetyStore(selectLastActionError);

  const fetchRobotStatus = useSafetyStore((s) => s.fetchRobotStatus);
  const triggerRobotEStop = useSafetyStore((s) => s.triggerRobotEStop);
  const resetRobotEStop = useSafetyStore((s) => s.resetRobotEStop);
  const clearError = useSafetyStore((s) => s.clearError);

  // Fetch status on mount
  useEffect(() => {
    if (robotId) {
      fetchRobotStatus(robotId);
    }
  }, [robotId, fetchRobotStatus]);

  const triggerEStop = useCallback(
    async (reason: string) => {
      return triggerRobotEStop(robotId, reason);
    },
    [robotId, triggerRobotEStop]
  );

  const resetEStop = useCallback(async () => {
    return resetRobotEStop(robotId);
  }, [robotId, resetRobotEStop]);

  const refreshStatus = useCallback(async () => {
    return fetchRobotStatus(robotId);
  }, [robotId, fetchRobotStatus]);

  return {
    status,
    isTriggered,
    isTriggering,
    isResetting,
    lastError,
    triggerEStop,
    resetEStop,
    refreshStatus,
    clearError,
  };
}

// ============================================================================
// ZONE SAFETY HOOK
// ============================================================================

/**
 * Hook for zone-based safety operations
 */
export function useZoneSafety(zoneId: string) {
  const isTriggering = useSafetyStore(selectIsTriggering);
  const lastError = useSafetyStore(selectLastActionError);

  const triggerZoneEStop = useSafetyStore((s) => s.triggerZoneEStop);
  const clearError = useSafetyStore((s) => s.clearError);

  const triggerEStop = useCallback(
    async (reason: string) => {
      return triggerZoneEStop(zoneId, reason);
    },
    [zoneId, triggerZoneEStop]
  );

  return {
    isTriggering,
    lastError,
    triggerEStop,
    clearError,
  };
}

// ============================================================================
// SAFETY EVENTS HOOK
// ============================================================================

/**
 * Hook for safety event log
 */
export function useSafetyEvents() {
  const events = useSafetyStore(selectEvents);
  const isLoading = useSafetyStore((s) => s.isLoadingEvents);

  const fetchEvents = useSafetyStore((s) => s.fetchEvents);
  const addEvent = useSafetyStore((s) => s.addEvent);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  return {
    events,
    isLoading,
    fetchEvents,
    addEvent,
  };
}

// ============================================================================
// HEARTBEAT CONTROL HOOK
// ============================================================================

/**
 * Hook for managing server heartbeats
 */
export function useHeartbeats() {
  const isActive = useSafetyStore(selectHeartbeatsActive);

  const startHeartbeats = useSafetyStore((s) => s.startHeartbeats);
  const stopHeartbeats = useSafetyStore((s) => s.stopHeartbeats);

  const toggle = useCallback(async () => {
    if (isActive) {
      return stopHeartbeats();
    } else {
      return startHeartbeats();
    }
  }, [isActive, startHeartbeats, stopHeartbeats]);

  return {
    isActive,
    startHeartbeats,
    stopHeartbeats,
    toggle,
  };
}

// ============================================================================
// COMBINED SAFETY STATUS HOOK
// ============================================================================

/**
 * Hook that provides a summary of overall safety status
 */
export function useSafetyOverview() {
  const fleetStatus = useSafetyStore(selectFleetStatus);
  const hasTriggeredEStop = useSafetyStore(selectFleetHasTriggeredEStop);
  const triggeredCount = useSafetyStore(selectTriggeredRobotCount);
  const heartbeatsActive = useSafetyStore(selectHeartbeatsActive);
  const events = useSafetyStore(selectEvents);

  const fetchFleetStatus = useSafetyStore((s) => s.fetchFleetStatus);
  const fetchEvents = useSafetyStore((s) => s.fetchEvents);

  // Refresh data periodically
  useEffect(() => {
    fetchFleetStatus();
    fetchEvents();

    const interval = setInterval(() => {
      fetchFleetStatus();
    }, 5000); // Every 5 seconds

    return () => clearInterval(interval);
  }, [fetchFleetStatus, fetchEvents]);

  const systemHealthy =
    !hasTriggeredEStop &&
    (fleetStatus?.robots.every((r) => r.systemHealthy) ?? true);

  const recentEvents = events.slice(0, 5);

  return {
    fleetStatus,
    hasTriggeredEStop,
    triggeredCount,
    heartbeatsActive,
    systemHealthy,
    recentEvents,
    totalRobots: fleetStatus?.robots.length ?? 0,
    onlineRobots: fleetStatus?.robots.filter((r) => r.serverConnected).length ?? 0,
  };
}
