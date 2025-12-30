/**
 * @file safetyApi.ts
 * @description API client for safety endpoints
 * @feature safety
 */

import { apiClient } from '@/api/client';
import type {
  RobotSafetyStatus,
  FleetSafetyStatus,
  FleetEStopResult,
  ZoneEStopResult,
  TriggerEStopRequest,
  EStopEvent,
} from '../types/safety.types';

const BASE_URL = '/safety';

// ============================================================================
// INDIVIDUAL ROBOT SAFETY
// ============================================================================

/**
 * Get safety status for a single robot
 */
export async function getRobotSafetyStatus(
  robotId: string
): Promise<RobotSafetyStatus> {
  const response = await apiClient.get<RobotSafetyStatus>(
    `${BASE_URL}/robots/${robotId}`
  );
  return response.data;
}

/**
 * Trigger E-stop on a single robot
 */
export async function triggerRobotEStop(
  robotId: string,
  request: TriggerEStopRequest
): Promise<RobotSafetyStatus> {
  const response = await apiClient.post<RobotSafetyStatus>(
    `${BASE_URL}/robots/${robotId}/estop`,
    request
  );
  return response.data;
}

/**
 * Reset E-stop on a single robot
 */
export async function resetRobotEStop(
  robotId: string
): Promise<RobotSafetyStatus> {
  const response = await apiClient.post<RobotSafetyStatus>(
    `${BASE_URL}/robots/${robotId}/estop/reset`
  );
  return response.data;
}

// ============================================================================
// FLEET-WIDE SAFETY
// ============================================================================

/**
 * Get safety status for all robots
 */
export async function getFleetSafetyStatus(): Promise<FleetSafetyStatus> {
  const response = await apiClient.get<FleetSafetyStatus>(
    `${BASE_URL}/fleet`
  );
  return response.data;
}

/**
 * Trigger fleet-wide E-stop
 */
export async function triggerFleetEStop(
  request: TriggerEStopRequest
): Promise<FleetEStopResult> {
  const response = await apiClient.post<FleetEStopResult>(
    `${BASE_URL}/fleet/estop`,
    request
  );
  return response.data;
}

/**
 * Reset fleet-wide E-stop
 */
export async function resetFleetEStop(): Promise<FleetEStopResult> {
  const response = await apiClient.post<FleetEStopResult>(
    `${BASE_URL}/fleet/estop/reset`
  );
  return response.data;
}

// ============================================================================
// ZONE-BASED SAFETY
// ============================================================================

/**
 * Trigger E-stop for all robots in a zone
 */
export async function triggerZoneEStop(
  zoneId: string,
  request: TriggerEStopRequest
): Promise<ZoneEStopResult> {
  const response = await apiClient.post<ZoneEStopResult>(
    `${BASE_URL}/zones/${zoneId}/estop`,
    request
  );
  return response.data;
}

// ============================================================================
// E-STOP EVENT LOG
// ============================================================================

/**
 * Get E-stop event log
 */
export async function getEStopEvents(limit = 50): Promise<{
  events: EStopEvent[];
  count: number;
}> {
  const response = await apiClient.get<{ events: EStopEvent[]; count: number }>(
    `${BASE_URL}/events`,
    { params: { limit } }
  );
  return response.data;
}

// ============================================================================
// HEARTBEAT CONTROL
// ============================================================================

/**
 * Start heartbeats to robots
 */
export async function startHeartbeats(
  intervalMs = 500
): Promise<{ message: string }> {
  const response = await apiClient.post<{ message: string }>(
    `${BASE_URL}/heartbeats/start`,
    { intervalMs }
  );
  return response.data;
}

/**
 * Stop heartbeats to robots
 */
export async function stopHeartbeats(): Promise<{ message: string }> {
  const response = await apiClient.post<{ message: string }>(
    `${BASE_URL}/heartbeats/stop`
  );
  return response.data;
}

// ============================================================================
// EXPORTED API OBJECT
// ============================================================================

export const safetyApi = {
  // Robot
  getRobotSafetyStatus,
  triggerRobotEStop,
  resetRobotEStop,

  // Fleet
  getFleetSafetyStatus,
  triggerFleetEStop,
  resetFleetEStop,

  // Zone
  triggerZoneEStop,

  // Events
  getEStopEvents,

  // Heartbeats
  startHeartbeats,
  stopHeartbeats,
};
