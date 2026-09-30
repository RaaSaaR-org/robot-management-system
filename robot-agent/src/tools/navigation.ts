/**
 * @file navigation.ts
 * @description Genkit tools for robot navigation: moves go to a place of the
 * robot's place graph by name, or to coordinates, and never into a keepout.
 * @feature navigation
 */

import { ai, z } from '../agent/genkit.js';
import type { RobotLocation } from '../robot/types.js';
import type { RobotStateManager } from '../robot/state.js';
import type { Place } from '../agent-mode/place-resolver.js';
import {
  HOME_ALIAS,
  keepoutAt,
  nearest,
  placeTarget,
  resolvePlaceDestination,
} from './place-destination.js';

// Global reference to robot state manager (set by main)
let robotStateManager: RobotStateManager;

/** The frame origin — the only destination that needs no place graph. */
const HOME_LOCATION: RobotLocation = { x: 0, y: 0, floor: '1', place: null };

export function setRobotStateManager(manager: RobotStateManager): void {
  robotStateManager = manager;
}

/**
 * The places a destination may be resolved against and judged by: the loaded
 * graph, but only when its frame is registered to the robot's pose. An
 * unregistered graph (real robot, TASK-325) names places the robot is not in,
 * so it answers nothing here — the same fail-closed rule the geofence follows.
 */
function registeredPlaces(): readonly Place[] | null {
  if (!robotStateManager) return null;
  if (robotStateManager.getPlaceFrameRegistration()?.registered !== true) return null;
  const places = robotStateManager.getPlaces();
  return places.length > 0 ? places : null;
}

function currentFloor(): string {
  return robotStateManager?.getState().location.floor ?? '1';
}

function locationOf(place: Place): RobotLocation {
  const { x, y } = placeTarget(place);
  return { x, y, floor: currentFloor(), place: place.id };
}

/**
 * The nearest `charging` place of the registered graph, or null when there is
 * none (no graph, an unregistered one, or a site without a charger).
 */
export function chargingStationLocation(): RobotLocation | null {
  const places = registeredPlaces();
  if (!places) return null;
  const from = robotStateManager.getState().location;
  const charger = nearest(places.filter((p) => p.placeType === 'charging' && !p.keepout), from);
  return charger ? locationOf(charger) : null;
}

/**
 * Get the charging station location: the nearest `charging` place. Throws when
 * the robot knows none — a made-up charger is a drive to nowhere.
 */
export async function getChargingStationLocation(): Promise<RobotLocation> {
  const loc = chargingStationLocation();
  if (loc) return loc;
  throw new Error(noChargerReason());
}

/** Why {@link chargingStationLocation} came back empty, operator-facing. */
function noChargerReason(): string {
  return registeredPlaces()
    ? 'No charging place in this robot\'s place graph.'
    : 'Cannot find a charging place: this robot has no registered place graph.';
}

/**
 * Get the home location: the frame origin.
 */
export async function getHomeLocation(): Promise<RobotLocation> {
  return { ...HOME_LOCATION };
}

/**
 * Resolve a named destination to a location. `home` is the frame origin; every
 * other name must be a place of the registered graph.
 */
function resolveNamedDestination(name: string): { location: RobotLocation; place: Place | null } {
  if (name.trim().toLowerCase() === HOME_ALIAS) return { location: { ...HOME_LOCATION }, place: null };
  const places = registeredPlaces();
  if (!places) {
    throw new Error(
      `Cannot resolve place "${name}": this robot has no registered place graph, so no place is known. ` +
        'Bind the robot to a site, or move by coordinates.',
    );
  }
  const place = resolvePlaceDestination(name, places, robotStateManager.getState().location);
  if (!place) {
    const known = places.map((p) => p.id).join(', ');
    throw new Error(`Unknown place "${name}". Known places: ${known}.`);
  }
  return { location: locationOf(place), place };
}

/** A move request resolved to a point, or refused with the reason. */
export type MoveTarget =
  | { ok: true; location: RobotLocation; label: string }
  | { ok: false; message: string; keepout?: string };

/**
 * Turn a move request — coordinates, or a place by id, name or type — into the
 * point to drive to, refusing any point inside a keepout of the registered
 * place graph. Shared by the agent's `moveToLocation` tool and the REST `move`
 * command (`roboctl move`), so both refuse the same things.
 *
 * Without a registered graph a named move fails (no place is known) and a
 * coordinate move proceeds: there is nothing to judge a keepout by, and the
 * geofence remains the safety layer.
 */
export function resolveMoveTarget(input: { x?: number; y?: number; place?: string; floor?: string }): MoveTarget {
  const { x, y, place } = input;
  let location: RobotLocation;
  let label: string;
  if (x !== undefined && y !== undefined) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return { ok: false, message: 'Invalid coordinates: x and y must be valid numbers' };
    }
    location = { x, y, floor: input.floor ?? currentFloor() };
    label = `(${x}, ${y})`;
  } else if (typeof place === 'string') {
    const name = place.trim();
    if (name.length === 0 || name.length > 100) {
      return { ok: false, message: 'Invalid place: must be 1-100 characters' };
    }
    try {
      location = resolveNamedDestination(name).location;
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
    label = name;
  } else {
    return { ok: false, message: 'Provide either coordinates (x, y) or a place' };
  }

  const places = registeredPlaces();
  const keepout = places ? keepoutAt(location.x, location.y, places) : null;
  if (keepout) {
    return { ok: false, message: `Cannot navigate to "${keepout.id}" — it is a keepout.`, keepout: keepout.id };
  }
  return { ok: true, location, label };
}

export const moveToLocation = ai.defineTool(
  {
    name: 'moveToLocation',
    description:
      'Move the robot to a place of its site, or to coordinates. Provide EITHER coordinates (x, y, metres) OR a place: ' +
      'a place id (e.g. "CHARGING-A"), its name (e.g. "Charging Bay A") or its type (e.g. "charging station" — the nearest one). ' +
      '"home" is the frame origin. Keepout places (rack faces, dock edges) are refused.',
    inputSchema: z.object({
      x: z.number().optional().describe('X coordinate in metres (use with y)'),
      y: z.number().optional().describe('Y coordinate in metres (use with x)'),
      place: z.string().optional().describe('Place id, name or type (e.g. "CHARGING-A", "Aisle 1", "home")'),
    }),
  },
  async ({ x, y, place }) => {
    if (!robotStateManager) {
      return { success: false, message: 'Robot state manager not initialized', currentLocation: null };
    }
    console.log('[Tool:moveToLocation]', JSON.stringify({ x, y, place }));

    const target = resolveMoveTarget({ x, y, place });
    if (!target.ok) {
      return {
        success: false,
        message: target.message,
        ...(target.keepout ? { keepout: target.keepout } : {}),
        currentLocation: robotStateManager.getState().location,
      };
    }

    try {
      const result = await robotStateManager.moveTo(target.location);
      const state = robotStateManager.getState();
      return {
        success: result.success,
        message: result.message,
        estimatedTime: result.estimatedTime,
        currentLocation: state.location,
        targetLocation: target.location,
        destination: target.label,
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error occurred',
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

    // The nearest charging place of the robot's registered place graph.
    const chargingStation = chargingStationLocation();
    if (!chargingStation) {
      return { success: false, message: noChargerReason() };
    }
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

    // Home is the frame origin.
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
