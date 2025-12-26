/**
 * @file commandApi.ts
 * @description API calls for natural language command interpretation
 * @feature command
 * @dependencies @/api/client, @/features/command/types, @/features/robots/api, @/features/fleet/api
 * @apiCalls POST /command/interpret, GET /command/history
 */

import { apiClient } from '@/api/client';
import { robotsApi } from '@/features/robots/api';
import { zoneApi, type NamedLocation } from '@/features/fleet/api';
import type { RobotCommand, CommandType } from '@/features/robots/types';
import type {
  CommandInterpretation,
  InterpretCommandRequest,
  CommandHistoryResponse,
} from '../types/command.types';

// ============================================================================
// NAMED LOCATIONS (fetched from server - single source of truth)
// ============================================================================

/** Cached named locations from server */
let cachedLocations: Record<string, NamedLocation> | null = null;
let lastLocationFetch = 0;
const LOCATION_CACHE_TTL_MS = 60000; // 1 minute cache

/**
 * Fetch named locations from server (with caching)
 */
async function fetchNamedLocations(): Promise<Record<string, { x: number; y: number }>> {
  const now = Date.now();
  if (cachedLocations && now - lastLocationFetch < LOCATION_CACHE_TTL_MS) {
    // Return cached locations (simplified format)
    return Object.fromEntries(
      Object.entries(cachedLocations).map(([key, val]) => [key, { x: val.x, y: val.y }])
    );
  }

  try {
    cachedLocations = await zoneApi.getNamedLocations();
    lastLocationFetch = now;
  } catch (error) {
    console.warn('[commandApi] Failed to fetch named locations from server:', error);
    if (!cachedLocations) {
      // Return fallback home location if no cache available
      cachedLocations = { home: { x: 0, y: 0, floor: '1', zone: 'Home Base' } };
    }
  }

  return Object.fromEntries(
    Object.entries(cachedLocations).map(([key, val]) => [key, { x: val.x, y: val.y }])
  );
}

/**
 * Resolve a named location to coordinates (async - fetches from server)
 */
async function getLocationByName(name?: string): Promise<{ x: number; y: number } | undefined> {
  if (!name) return undefined;

  const locations = await fetchNamedLocations();
  const key = name.toLowerCase().trim().replace(/\s+/g, '_');

  // Exact match first
  if (locations[key]) return locations[key];

  // Try with spaces instead of underscores
  const keyWithSpaces = name.toLowerCase().trim();
  if (locations[keyWithSpaces]) return locations[keyWithSpaces];

  // Partial match
  const found = Object.entries(locations).find(([k]) => key.includes(k) || k.includes(key));
  return found?.[1];
}

/**
 * Map NL command types to robot command types
 */
function mapCommandType(
  nlType: string,
  parameters: CommandInterpretation['parameters']
): CommandType {
  switch (nlType) {
    case 'navigation':
      return 'move';
    case 'manipulation':
      // If objects exist, it's a pickup; otherwise drop
      return parameters.objects?.length ? 'pickup' : 'drop';
    case 'emergency':
      return 'emergency_stop';
    default:
      return 'custom';
  }
}

// ============================================================================
// ENDPOINTS
// ============================================================================

const ENDPOINTS = {
  interpret: '/command/interpret',
  history: '/command/history',
  updateStatus: (id: string) => `/command/${id}/status`,
} as const;

// ============================================================================
// API FUNCTIONS
// ============================================================================

export const commandApi = {
  /**
   * Interpret a natural language command using the VLA model.
   * @param request - Interpretation request with text and robot ID
   * @returns VLA model interpretation
   */
  async interpretCommand(request: InterpretCommandRequest): Promise<CommandInterpretation> {
    const response = await apiClient.post<CommandInterpretation>(ENDPOINTS.interpret, request);
    return response.data;
  },

  /**
   * Execute a command on a robot after interpretation.
   * Maps NL command types to robot command types and resolves named locations.
   * Updates interpretation status to 'executed' after successful execution.
   * @param robotId - Target robot ID
   * @param interpretation - VLA interpretation to execute
   * @returns Executed command
   */
  async executeCommand(
    robotId: string,
    interpretation: CommandInterpretation
  ): Promise<RobotCommand> {
    // Map NL command type to robot command type
    const robotCommandType = mapCommandType(
      interpretation.commandType,
      interpretation.parameters
    );

    // Determine priority based on safety classification
    const priority =
      interpretation.safetyClassification === 'dangerous'
        ? 'critical'
        : interpretation.safetyClassification === 'caution'
          ? 'high'
          : 'normal';

    let command: RobotCommand;

    // Handle special cases with existing helpers
    if (robotCommandType === 'move') {
      const target = interpretation.parameters.target?.toLowerCase() || '';

      // Use existing charge helper for charging station
      if (target.includes('charging')) {
        command = await robotsApi.sendToCharge(robotId);
      }
      // Use existing home helper for home
      else if (target.includes('home')) {
        command = await robotsApi.returnHome(robotId);
      }
      // Regular move command
      else {
        const payload: Record<string, unknown> = {
          ...interpretation.parameters,
          nlOriginalText: interpretation.originalText,
          interpretationId: interpretation.id,
        };

        // Resolve named location to coordinates (from server)
        const destination = await getLocationByName(interpretation.parameters.target);
        if (destination) {
          payload.destination = destination;
        }

        command = await robotsApi.sendCommand(robotId, {
          type: robotCommandType,
          payload,
          priority,
        });
      }
    } else if (robotCommandType === 'emergency_stop') {
      command = await robotsApi.emergencyStop(robotId);
    } else {
      // Build payload for other command types
      const payload: Record<string, unknown> = {
        ...interpretation.parameters,
        nlOriginalText: interpretation.originalText,
        interpretationId: interpretation.id,
      };

      command = await robotsApi.sendCommand(robotId, {
        type: robotCommandType,
        payload,
        priority,
      });
    }

    // Update interpretation status to 'executed' after successful command
    try {
      await apiClient.patch(ENDPOINTS.updateStatus(interpretation.id), {
        status: 'executed',
        executedCommandId: command.id,
      });
    } catch (error) {
      // Log but don't fail the command - the robot command already succeeded
      console.error('[commandApi] Failed to update interpretation status:', error);
    }

    return command;
  },

  /**
   * Get command history for natural language commands.
   * @param params - Pagination and filter parameters
   * @returns Paginated command history
   */
  async getHistory(params?: {
    page?: number;
    pageSize?: number;
    robotId?: string;
  }): Promise<CommandHistoryResponse> {
    const response = await apiClient.get<CommandHistoryResponse>(ENDPOINTS.history, {
      params: {
        page: params?.page,
        pageSize: params?.pageSize,
        robotId: params?.robotId,
      },
    });
    return response.data;
  },
};
