/**
 * @file navigation.ts
 * @description Genkit tools for robot navigation commands with zone awareness
 */

import { ai, z } from '../agent/genkit.js';
import type { RobotLocation, Zone, ZoneBounds } from '../robot/types.js';
import type { RobotStateManager } from '../robot/state.js';
import { config } from '../config/config.js';

// Global reference to robot state manager (set by main)
let robotStateManager: RobotStateManager;

// Cached zones and derived named locations from server
let cachedZones: Zone[] = [];
let cachedNamedLocations: Record<string, RobotLocation> = {};
let lastZoneFetch = 0;

// Default fallback locations (used when server is unavailable)
const FALLBACK_LOCATIONS: Record<string, RobotLocation> = {
  home: { x: 0, y: 0, floor: '1', zone: 'Home Base' },
  charging_station: { x: 5, y: 20, floor: '1', zone: 'Charging Bay' },
};

export function setRobotStateManager(manager: RobotStateManager): void {
  robotStateManager = manager;
}

/**
 * Derive named locations from zone center points
 * This is the single source of truth for location name -> coordinates
 */
function deriveNamedLocationsFromZones(zones: Zone[]): Record<string, RobotLocation> {
  const locations: Record<string, RobotLocation> = {};

  for (const zone of zones) {
    // Calculate center point of zone bounds
    const centerX = Math.round(zone.bounds.x + zone.bounds.width / 2);
    const centerY = Math.round(zone.bounds.y + zone.bounds.height / 2);
    const key = zone.name.toLowerCase().replace(/\s+/g, '_');

    locations[key] = {
      x: centerX,
      y: centerY,
      floor: zone.floor,
      zone: zone.name,
    };

    // Add common aliases for special zone types
    if (zone.type === 'charging') {
      locations['charging_station'] = locations[key];
      locations['charge'] = locations[key];
    }
    if (zone.type === 'maintenance') {
      locations['maintenance'] = locations[key];
    }
  }

  // Ensure home location exists (default to origin)
  if (!locations['home']) {
    locations['home'] = { x: 0, y: 0, floor: '1', zone: 'Home Base' };
  }

  return locations;
}

/**
 * Fetch zones from server (cached) and derive named locations
 */
async function fetchZones(): Promise<Zone[]> {
  const now = Date.now();
  if (cachedZones.length > 0 && now - lastZoneFetch < config.zoneCacheTtlMs) {
    return cachedZones;
  }

  try {
    // Fetch from server - use the server URL from config
    const response = await fetch(`${config.serverUrl}/api/zones`);
    if (!response.ok) {
      console.warn('[Navigation] Failed to fetch zones:', response.status);
      return cachedZones;
    }
    const data = (await response.json()) as { data?: Zone[] };
    cachedZones = data.data || [];
    lastZoneFetch = now;

    // Derive named locations from zones
    cachedNamedLocations = deriveNamedLocationsFromZones(cachedZones);
    console.log(
      `[Navigation] Fetched ${cachedZones.length} zones, derived ${Object.keys(cachedNamedLocations).length} named locations`
    );
  } catch (error) {
    // Log a concise message - this is expected when server isn't running yet
    const message = error instanceof Error ? error.message : 'Unknown error';
    const isConnectionError = message.includes('fetch failed') || message.includes('ECONNREFUSED');
    if (isConnectionError) {
      console.warn('[Navigation] Server not available, using fallback locations');
    } else {
      console.warn('[Navigation] Error fetching zones:', message);
    }
    // Use fallback locations if no cache available
    if (Object.keys(cachedNamedLocations).length === 0) {
      cachedNamedLocations = { ...FALLBACK_LOCATIONS };
    }
  }

  return cachedZones;
}

/**
 * Get a named location by name (async - fetches from server if needed)
 * @param name - Location name (e.g., "home", "charging_station", "warehouse_a")
 * @returns Location coordinates or undefined if not found
 */
export async function getNamedLocation(name: string): Promise<RobotLocation | undefined> {
  // Ensure zones are fetched (which also populates named locations)
  await fetchZones();

  const key = name.toLowerCase().trim().replace(/\s+/g, '_');

  // Exact match first
  if (cachedNamedLocations[key]) {
    return cachedNamedLocations[key];
  }

  // Try with spaces instead of underscores
  const keyWithSpaces = name.toLowerCase().trim();
  if (cachedNamedLocations[keyWithSpaces]) {
    return cachedNamedLocations[keyWithSpaces];
  }

  // Partial match
  const found = Object.entries(cachedNamedLocations).find(
    ([k]) => key.includes(k) || k.includes(key)
  );
  return found?.[1];
}

/**
 * Get the charging station location (async)
 */
export async function getChargingStationLocation(): Promise<RobotLocation> {
  const loc = await getNamedLocation('charging_station');
  return loc || FALLBACK_LOCATIONS.charging_station;
}

/**
 * Get the home location (async)
 */
export async function getHomeLocation(): Promise<RobotLocation> {
  const loc = await getNamedLocation('home');
  return loc || FALLBACK_LOCATIONS.home;
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
 * Resolve a destination to a RobotLocation (async - fetches from server)
 */
async function resolveDestination(
  destination:
    | { x: number; y: number; floor?: string; zone?: string }
    | { zone: string }
    | { namedLocation: string }
): Promise<RobotLocation> {
  if ('namedLocation' in destination) {
    const loc = await getNamedLocation(destination.namedLocation);
    if (loc) return loc;
    throw new Error(`Unknown named location: ${destination.namedLocation}`);
  }

  if ('zone' in destination && !('x' in destination)) {
    // Try to find zone in named locations (from server)
    const loc = await getNamedLocation(destination.zone);
    if (loc) return loc;
    // Default to a position in the zone if not found
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
    // Convert flat params to destination object with proper typing
    type Destination = { x: number; y: number } | { zone: string };
    let destination: Destination;

    if (x !== undefined && y !== undefined) {
      // Validate coordinates are finite numbers
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return { success: false, message: 'Invalid coordinates: x and y must be valid numbers' };
      }
      destination = { x, y };
    } else if (zone) {
      // Validate zone string
      const trimmedZone = zone.trim();
      if (trimmedZone.length === 0 || trimmedZone.length > 100) {
        return { success: false, message: 'Invalid zone: must be 1-100 characters' };
      }
      destination = { zone: trimmedZone };
    } else {
      return { success: false, message: 'Provide either coordinates (x, y) or a zone name' };
    }
    console.log('[Tool:moveToLocation]', JSON.stringify(destination));

    if (!robotStateManager) {
      return { success: false, message: 'Robot state manager not initialized', currentLocation: null };
    }

    try {
      const location = await resolveDestination(destination);

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
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      return {
        success: false,
        message: errorMessage,
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

    // Get charging station location from server
    const chargingStation = await getChargingStationLocation();
    const result = await robotStateManager.moveTo(chargingStation);
    const state = robotStateManager.getState();

    return {
      success: result.success,
      message: result.success
        ? `Navigating to charging station at (${chargingStation.x}, ${chargingStation.y})`
        : result.message,
      estimatedTime: result.estimatedTime,
      currentLocation: state.location,
      targetLocation: chargingStation,
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

    // Get home location from server
    const home = await getHomeLocation();
    const result = await robotStateManager.moveTo(home);
    const state = robotStateManager.getState();

    return {
      success: result.success,
      message: result.success
        ? `Returning to home base at (${home.x}, ${home.y})`
        : result.message,
      estimatedTime: result.estimatedTime,
      currentLocation: state.location,
      targetLocation: home,
    };
  }
);
