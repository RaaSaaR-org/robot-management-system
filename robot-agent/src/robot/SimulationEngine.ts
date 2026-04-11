/**
 * @file SimulationEngine.ts
 * @description Handles robot simulation - position updates, battery drain, movement
 * @feature robot
 * @status live
 */

import type { SimulatedRobotState, RobotLocation, Zone } from './types.js';
import { getChargingStationLocation } from '../tools/navigation.js';
import { isPointInZone } from './zoneUtils.js';
import { formatZoneEnterEvent, formatZoneExitEvent } from './telemetry.js';

/**
 * Callback to update robot state
 */
export type StateUpdater = (updater: (state: SimulatedRobotState) => void) => void;

/**
 * Callback to notify of state changes
 */
export type ChangeNotifier = () => void;

/**
 * Configuration for simulation engine
 */
export interface SimulationConfig {
  /** Simulation tick interval in milliseconds */
  tickIntervalMs: number;
  /** Robot movement speed in units per second */
  speedUnitsPerSecond: number;
  /** Battery drain rate per second when idle */
  batteryDrainPerSecond: number;
  /** Battery charge rate per second */
  batteryChargePerSecond: number;
}

const DEFAULT_CONFIG: SimulationConfig = {
  tickIntervalMs: 100,
  speedUnitsPerSecond: 2.0,
  batteryDrainPerSecond: 0.01,
  batteryChargePerSecond: 0.5,
};

/**
 * Handles the simulation loop for robot movement, battery, and position
 */
export class SimulationEngine {
  private simulationInterval: NodeJS.Timeout | null = null;
  private cachedChargingStation: RobotLocation | null = null;
  private zoneCache: Zone[] = [];
  private previousZone: Zone | null = null;
  private readonly config: SimulationConfig;
  private stateGetter: () => SimulatedRobotState;
  private stateUpdater: StateUpdater;
  private changeNotifier: ChangeNotifier;

  constructor(
    stateGetter: () => SimulatedRobotState,
    stateUpdater: StateUpdater,
    changeNotifier: ChangeNotifier,
    config: Partial<SimulationConfig> = {}
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.stateGetter = stateGetter;
    this.stateUpdater = stateUpdater;
    this.changeNotifier = changeNotifier;
  }

  /**
   * Start the simulation loop
   */
  start(): void {
    if (this.simulationInterval) return;

    const state = this.stateGetter();
    console.log(`[SimulationEngine] Starting simulation for ${state.name}`);

    // Prefetch charging station location
    this.prefetchChargingStation();

    this.simulationInterval = setInterval(() => {
      this.tick();
    }, this.config.tickIntervalMs);
  }

  /**
   * Stop the simulation loop
   */
  stop(): void {
    if (this.simulationInterval) {
      clearInterval(this.simulationInterval);
      this.simulationInterval = null;
      const state = this.stateGetter();
      console.log(`[SimulationEngine] Stopped simulation for ${state.name}`);
    }
  }

  /**
   * Check if simulation is running
   */
  get isRunning(): boolean {
    return this.simulationInterval !== null;
  }

  /**
   * Get the cached charging station location
   */
  getChargingStationLocation(): RobotLocation | null {
    return this.cachedChargingStation;
  }

  /**
   * Set the zone cache for real-time zone tracking.
   * Called from navigation tools after zone data is fetched from the server.
   */
  setZoneCache(zones: Zone[]): void {
    this.zoneCache = zones;
  }

  /**
   * Prefetch charging station location from server
   */
  private async prefetchChargingStation(): Promise<void> {
    try {
      const loc = await getChargingStationLocation();
      this.cachedChargingStation = loc;
      console.log(`[SimulationEngine] Cached charging station location: (${loc.x}, ${loc.y})`);
    } catch (error) {
      console.error('[SimulationEngine] Failed to fetch charging station location:', error);
      this.cachedChargingStation = { x: 0, y: 0, floor: '1', zone: 'charging' };
    }
  }

  /**
   * Execute a single simulation tick
   */
  private tick(): void {
    const deltaTime = this.config.tickIntervalMs / 1000;
    let stateChanged = false;
    const state = this.stateGetter();

    // Update position if moving
    if (state.targetLocation && state.status === 'busy') {
      const moved = this.updatePosition(deltaTime);
      stateChanged = moved;
    }

    // Zone tracking — synchronous, reads from cached zone data
    if (this.zoneCache.length > 0) {
      const zoneChanged = this.updateZoneTracking();
      stateChanged = zoneChanged || stateChanged;
    }

    // Handle battery
    if (state.status !== 'charging') {
      stateChanged = this.drainBattery(deltaTime) || stateChanged;
    } else {
      stateChanged = this.chargeBattery(deltaTime) || stateChanged;
    }

    // Update lastSeen timestamp
    this.stateUpdater((s) => {
      s.lastSeen = new Date().toISOString();
    });

    if (stateChanged) {
      this.stateUpdater((s) => {
        s.updatedAt = new Date().toISOString();
      });
      this.changeNotifier();
    }
  }

  /**
   * Update robot position towards target
   * @returns true if state changed
   */
  private updatePosition(deltaTime: number): boolean {
    const state = this.stateGetter();
    if (!state.targetLocation) return false;

    const dx = state.targetLocation.x - state.location.x;
    const dy = state.targetLocation.y - state.location.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance < 0.1) {
      // Arrived at destination
      this.stateUpdater((s) => {
        if (s.targetLocation) {
          s.location.x = s.targetLocation.x;
          s.location.y = s.targetLocation.y;
          s.location.zone = s.targetLocation.zone;
          s.location.floor = s.targetLocation.floor;
        }
        s.targetLocation = undefined;
        s.speed = 0;
        s.status = 'online';
        s.currentTaskName = undefined;
      });

      // Check if arrived at charging station
      this.checkChargingStationArrival();

      return true;
    }

    // Move towards target
    const moveDistance = this.config.speedUnitsPerSecond * deltaTime;
    const ratio = Math.min(moveDistance / distance, 1);

    this.stateUpdater((s) => {
      s.location.x += dx * ratio;
      s.location.y += dy * ratio;
      s.speed = this.config.speedUnitsPerSecond;
      s.location.heading = Math.atan2(dy, dx) * (180 / Math.PI);
    });

    return true;
  }

  /**
   * Check if robot arrived at charging station
   */
  private checkChargingStationArrival(): void {
    if (!this.cachedChargingStation) return;

    const state = this.stateGetter();
    const isAtChargingStation =
      Math.abs(state.location.x - this.cachedChargingStation.x) < 1 &&
      Math.abs(state.location.y - this.cachedChargingStation.y) < 1;

    if (isAtChargingStation) {
      this.stateUpdater((s) => {
        s.status = 'charging';
        s.currentTaskName = 'Charging';
      });
    }
  }

  /**
   * Check current zone and emit enter/exit events on transitions.
   * Fully synchronous — reads from in-memory zoneCache.
   * @returns true if zone changed
   */
  private updateZoneTracking(): boolean {
    const state = this.stateGetter();
    const floor = state.location.floor ?? '1';

    // Find which cached zone the robot is currently in
    let currentZone: Zone | null = null;
    for (const zone of this.zoneCache) {
      if (zone.floor === floor && isPointInZone(state.location.x, state.location.y, zone.bounds)) {
        currentZone = zone;
        break;
      }
    }

    const prevId = this.previousZone?.id ?? null;
    const currId = currentZone?.id ?? null;

    if (currId === prevId) {
      return false;
    }

    // Zone transition detected
    if (this.previousZone) {
      const exitEvent = formatZoneExitEvent(state.id, {
        id: this.previousZone.id,
        name: this.previousZone.name,
        type: this.previousZone.type,
      });
      console.log(`[SimulationEngine] ${exitEvent.type}: ${this.previousZone.name}`);
    }

    if (currentZone) {
      const enterEvent = formatZoneEnterEvent(state.id, {
        id: currentZone.id,
        name: currentZone.name,
        type: currentZone.type,
      });
      console.log(`[SimulationEngine] ${enterEvent.type}: ${currentZone.name}`);
    }

    // Update location.zone on state
    this.stateUpdater((s) => {
      s.location.zone = currentZone?.name ?? '';
    });

    this.previousZone = currentZone;
    return true;
  }

  /**
   * Drain battery based on activity
   * @returns true if state changed significantly
   */
  private drainBattery(deltaTime: number): boolean {
    const state = this.stateGetter();

    // SO-101 is AC-powered — no battery drain
    if (state.robotType === 'so101') return false;

    const drainRate =
      state.status === 'busy'
        ? this.config.batteryDrainPerSecond * 2
        : this.config.batteryDrainPerSecond;

    this.stateUpdater((s) => {
      s.batteryLevel = Math.max(0, s.batteryLevel - drainRate * deltaTime);
    });

    const newState = this.stateGetter();

    // Check low battery warning
    if (newState.batteryLevel < 20 && !newState.warnings.includes('Low battery')) {
      this.stateUpdater((s) => {
        s.warnings.push('Low battery');
      });
      return true;
    }

    // Check critical battery
    if (newState.batteryLevel < 5 && newState.status !== 'error') {
      this.stateUpdater((s) => {
        s.errors.push('Critical battery level');
        s.status = 'error';
        s.targetLocation = undefined;
      });
      return true;
    }

    return false;
  }

  /**
   * Charge battery
   * @returns true if fully charged
   */
  private chargeBattery(deltaTime: number): boolean {
    const state = this.stateGetter();

    this.stateUpdater((s) => {
      s.batteryLevel = Math.min(100, s.batteryLevel + this.config.batteryChargePerSecond * deltaTime);
    });

    const newState = this.stateGetter();

    if (newState.batteryLevel >= 100) {
      this.stateUpdater((s) => {
        s.status = 'online';
        s.warnings = s.warnings.filter((w) => w !== 'Low battery');
      });
      return true;
    }

    return false;
  }
}
