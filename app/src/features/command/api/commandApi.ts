/**
 * @file commandApi.ts
 * @description API calls for natural language command interpretation
 * @feature command
 * @dependencies @/api/client, @/features/command/types, @/features/robots/api, @/features/digitaltwin
 * @apiCalls POST /command/interpret, GET /command/history, GET /robots/:id/places
 */

import { apiClient } from '@/api/client';
import { robotsApi } from '@/features/robots/api';
import type { PlaceGraph } from '@/features/digitaltwin/types/twin.types';
import { placeCentroid, reachablePlaces } from '@/features/digitaltwin/utils/places';
import type { RobotCommand, CommandType } from '@/features/robots/types';
import type {
  CommandInterpretation,
  InterpretCommandRequest,
  CommandHistoryResponse,
} from '../types/command.types';

// ============================================================================
// NAMED LOCATIONS — the places of the robot's site (TASK-332)
// ============================================================================

/** A named destination: a place centroid, or the fallback home. */
interface NamedLocation {
  x: number;
  y: number;
  /** Place id when the name came from the site's place graph. */
  place?: string;
}

const HOME: NamedLocation = { x: 0, y: 0 };

/** Per-robot cache: robot id → { name → location }. */
const locationCache = new Map<string, { at: number; locations: Record<string, NamedLocation> }>();
const LOCATION_CACHE_TTL_MS = 60000; // 1 minute cache

/** Drop the per-robot cache (tests; a robot re-bound to another site). */
export function clearNamedLocationCache(): void {
  locationCache.clear();
}

/**
 * The robot's named locations: every reachable place of its site, keyed by
 * lower-cased place id and name, at the place centroid. A robot without a site
 * (the endpoint answers 404) only knows `home`.
 */
export async function fetchNamedLocations(robotId: string): Promise<Record<string, NamedLocation>> {
  const now = Date.now();
  const cached = locationCache.get(robotId);
  if (cached && now - cached.at < LOCATION_CACHE_TTL_MS) return cached.locations;

  const locations: Record<string, NamedLocation> = { home: HOME };
  try {
    const res = await apiClient.get<PlaceGraph>(ENDPOINTS.robotPlaces(robotId));
    for (const place of reachablePlaces(res.data?.places ?? [])) {
      const centroid = placeCentroid(place.polygon);
      if (!centroid) continue;
      const location = { ...centroid, place: place.id };
      locations[place.id.toLowerCase()] = location;
      locations[place.name.toLowerCase().trim()] = location;
    }
  } catch (error) {
    // 404 = no site bound; anything else is logged. Either way only `home` is known.
    if ((error as { response?: { status?: number } })?.response?.status !== 404) {
      console.warn('[commandApi] Failed to fetch robot places:', error);
    }
  }
  locationCache.set(robotId, { at: now, locations });
  return locations;
}

/**
 * Resolve a place name of the robot's site to coordinates
 */
export async function getLocationByName(
  robotId: string,
  name?: string
): Promise<NamedLocation | undefined> {
  if (!name) return undefined;

  const locations = await fetchNamedLocations(robotId);
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
  robotPlaces: (robotId: string) => `/robots/${robotId}/places`,
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

        // Resolve the place name against the robot's site
        const destination = await getLocationByName(robotId, interpretation.parameters.target);
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
