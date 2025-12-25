/**
 * @file commandApi.ts
 * @description API calls for natural language command interpretation
 * @feature command
 * @dependencies @/api/client, @/features/command/types, @/features/robots/api
 * @apiCalls POST /command/interpret, GET /command/history
 */

import { apiClient } from '@/api/client';
import { robotsApi } from '@/features/robots/api';
import type { RobotCommand, RobotCommandRequest, CommandType } from '@/features/robots/types';
import type {
  CommandInterpretation,
  InterpretCommandRequest,
  CommandHistoryResponse,
} from '../types/command.types';

// ============================================================================
// NAMED LOCATIONS
// ============================================================================

/** Known named locations in the facility */
const NAMED_LOCATIONS: Record<string, { x: number; y: number }> = {
  'charging station': { x: 5, y: 0 },
  'home': { x: 0, y: 0 },
  'warehouse': { x: 10, y: 5 },
  'assembly line': { x: 15, y: 10 },
  'dock': { x: 20, y: 0 },
};

/**
 * Resolve a named location to coordinates
 */
function getLocationByName(name?: string): { x: number; y: number } | undefined {
  if (!name) return undefined;
  const key = name.toLowerCase().trim();
  // Exact match first
  if (NAMED_LOCATIONS[key]) return NAMED_LOCATIONS[key];
  // Partial match
  const found = Object.entries(NAMED_LOCATIONS).find(([k]) => key.includes(k));
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

    // Handle special cases with existing helpers
    if (robotCommandType === 'move') {
      const target = interpretation.parameters.target?.toLowerCase() || '';

      // Use existing charge helper for charging station
      if (target.includes('charging')) {
        return robotsApi.sendToCharge(robotId);
      }

      // Use existing home helper for home
      if (target.includes('home')) {
        return robotsApi.returnHome(robotId);
      }
    }

    if (robotCommandType === 'emergency_stop') {
      return robotsApi.emergencyStop(robotId);
    }

    // Build payload with destination for move commands
    const payload: Record<string, unknown> = {
      ...interpretation.parameters,
      nlOriginalText: interpretation.originalText,
      interpretationId: interpretation.id,
    };

    // Resolve named location to coordinates for move commands
    if (robotCommandType === 'move' && !payload.destination) {
      const destination = getLocationByName(interpretation.parameters.target);
      if (destination) {
        payload.destination = destination;
      }
    }

    const commandRequest: RobotCommandRequest = {
      type: robotCommandType,
      payload,
      priority,
    };

    return robotsApi.sendCommand(robotId, commandRequest);
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
