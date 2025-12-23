/**
 * @file navigation.ts
 * @description Genkit tools for robot navigation commands with zone awareness
 */

import { ai, z } from '../agent/genkit.js';
import type { RobotLocation, Zone, ZoneBounds } from '../robot/types.js';
import { NAMED_LOCATIONS } from '../robot/types.js';
import type { RobotStateManager } from '../robot/state.js';

// Global reference to robot state manager (set by main)
let robotStateManager: RobotStateManager;

// Cached zones from server
let cachedZones: Zone[] = [];
let lastZoneFetch = 0;
const ZONE_CACHE_TTL_MS = 60000; // 1 minute cache

export function setRobotStateManager(manager: RobotStateManager): void {
  robotStateManager = manager;
}

/**
 * Fetch zones from server (cached)
 */
async function fetchZones(): Promise<Zone[]> {
  const now = Date.now();
  if (cachedZones.length > 0 && now - lastZoneFetch < ZONE_CACHE_TTL_MS) {
    return cachedZones;
  }

  try {
    // Fetch from server - use the server URL from environment
    const serverUrl = process.env.SERVER_URL || 'http://localhost:3000';
    const response = await fetch(`${serverUrl}/api/zones`);
    if (!response.ok) {
      console.warn('[Navigation] Failed to fetch zones:', response.status);
      return cachedZones;
    }
    const data = (await response.json()) as { data?: Zone[] };
    cachedZones = data.data || [];
    lastZoneFetch = now;
    console.log(`[Navigation] Fetched ${cachedZones.length} zones from server`);
  } catch (error) {
    console.warn('[Navigation] Error fetching zones:', error);
  }

  return cachedZones;
}

/**
 * Check if a point is inside zone bounds
 */
function isPointInBounds(x: number, y: number, bounds: ZoneBounds): boolean {
  return (
    x >= bounds.x &&
    x <= bounds.x + bounds.width &&
    y >= bounds.y &&
    y <= bounds.y + bounds.height
  );
}

/**
 * Find the zone at a specific point
 */
function findZoneAtPoint(x: number, y: number, floor: string, zones: Zone[]): Zone | null {
  for (const zone of zones) {
    if (zone.floor === floor && isPointInBounds(x, y, zone.bounds)) {
      return zone;
    }
  }
  return null;
}

/**
 * Validate that a destination is not in a restricted zone
 */
async function validateDestinationZone(
  location: RobotLocation
): Promise<{ valid: boolean; message?: string; zone?: Zone }> {
  const zones = await fetchZones();
  const floor = location.floor || '1';
  const zone = findZoneAtPoint(location.x, location.y, floor, zones);

  if (zone && zone.type === 'restricted') {
    return {
      valid: false,
      message: `Cannot navigate to "${zone.name}" - this is a restricted zone.`,
      zone,
    };
  }

  return { valid: true, zone: zone || undefined };
}

/**
 * Clear zone cache (call when zones are updated)
 */
export function clearZoneCache(): void {
  cachedZones = [];
  lastZoneFetch = 0;
}

/**
 * Resolve a destination to a RobotLocation
 */
function resolveDestination(
  destination:
    | { x: number; y: number; floor?: string; zone?: string }
    | { zone: string }
    | { namedLocation: string }
): RobotLocation {
  if ('namedLocation' in destination) {
    const loc = NAMED_LOCATIONS[destination.namedLocation.toLowerCase().replace(/\s+/g, '_')];
    if (loc) return loc;
    throw new Error(`Unknown named location: ${destination.namedLocation}`);
  }

  if ('zone' in destination && !('x' in destination)) {
    // Try to find zone in named locations
    const zoneName = destination.zone.toLowerCase().replace(/\s+/g, '_');
    const loc = NAMED_LOCATIONS[zoneName];
    if (loc) return loc;
    // Default to a position in the zone
    return { x: 25, y: 25, zone: destination.zone, floor: '1' };
  }

  // Coordinates provided
  return {
    x: destination.x,
    y: destination.y,
    floor: destination.floor || '1',
    zone: destination.zone,
  };
}

export const moveToLocation = ai.defineTool(
  {
    name: 'moveToLocation',
    description:
      'Move the robot to a specified location. Provide EITHER coordinates (x, y) OR a zone/location name. Named locations: home, charging_station, entrance, exit, warehouse_a, warehouse_b, loading_dock. Zone examples: "Warehouse A", "Loading Dock".',
    inputSchema: z.object({
      x: z.number().optional().describe('X coordinate (use with y for coordinates)'),
      y: z.number().optional().describe('Y coordinate (use with x for coordinates)'),
      zone: z.string().optional().describe('Zone or named location (e.g., "Warehouse A", "home", "charging_station")'),
    }),
  },
  async ({ x, y, zone }) => {
    // Convert flat params to destination object
    let destination: any;
    if (x !== undefined && y !== undefined) {
      destination = { x, y };
    } else if (zone) {
      destination = { zone };
    } else {
      return { success: false, message: 'Provide either coordinates (x, y) or a zone name' };
    }
    console.log('[Tool:moveToLocation]', JSON.stringify(destination));

    if (!robotStateManager) {
      return { success: false, message: 'Robot state manager not initialized', currentLocation: null };
    }

    try {
      const location = resolveDestination(destination);

      // Validate destination is not in a restricted zone
      const validation = await validateDestinationZone(location);
      if (!validation.valid) {
        return {
          success: false,
          message: validation.message,
          currentLocation: robotStateManager.getState().location,
          restrictedZone: validation.zone?.name,
        };
      }

      const result = await robotStateManager.moveTo(location);
      const state = robotStateManager.getState();

      return {
        success: result.success,
        message: result.message,
        estimatedTime: result.estimatedTime,
        currentLocation: state.location,
        targetLocation: location,
        destinationZone: validation.zone?.name,
      };
    } catch (error: any) {
      return {
        success: false,
        message: error.message,
        currentLocation: robotStateManager.getState().location,
      };
    }
  }
);

export const stopMovement = ai.defineTool(
  {
    name: 'stopMovement',
    description: "Stop the robot's current movement immediately. Call with no parameters.",
    inputSchema: z.object({
      reason: z.string().optional().describe('Optional reason for stopping'),
    }),
  },
  async () => {
    console.log('[Tool:stopMovement]');

    if (!robotStateManager) {
      return { success: false, message: 'Robot state manager not initialized' };
    }

    const result = await robotStateManager.stop();
    const state = robotStateManager.getState();

    return {
      success: result.success,
      message: result.message,
      location: state.location,
    };
  }
);

export const goToCharge = ai.defineTool(
  {
    name: 'goToCharge',
    description: 'Navigate the robot to the charging station. Call with no parameters.',
    inputSchema: z.object({
      priority: z.string().optional().describe('Optional priority level'),
    }),
  },
  async () => {
    console.log('[Tool:goToCharge]');

    if (!robotStateManager) {
      return { success: false, message: 'Robot state manager not initialized' };
    }

    const result = await robotStateManager.goToCharge();
    const state = robotStateManager.getState();

    return {
      success: result.success,
      message: result.message,
      estimatedTime: result.estimatedTime,
      currentLocation: state.location,
      targetLocation: NAMED_LOCATIONS.charging_station,
    };
  }
);

export const returnHome = ai.defineTool(
  {
    name: 'returnHome',
    description: 'Return the robot to its home base position. Call with no parameters.',
    inputSchema: z.object({
      priority: z.string().optional().describe('Optional priority level'),
    }),
  },
  async () => {
    console.log('[Tool:returnHome]');

    if (!robotStateManager) {
      return { success: false, message: 'Robot state manager not initialized' };
    }

    const result = await robotStateManager.returnHome();
    const state = robotStateManager.getState();

    return {
      success: result.success,
      message: result.message,
      estimatedTime: result.estimatedTime,
      currentLocation: state.location,
      targetLocation: NAMED_LOCATIONS.home,
    };
  }
);
