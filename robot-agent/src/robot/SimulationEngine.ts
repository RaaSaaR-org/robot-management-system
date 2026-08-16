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
/** 'Critical battery level' (raised below 5 %) is dropped again from here up. */
const CRITICAL_BATTERY_CLEAR_PCT = 10;
/** 'Low battery' (raised below 20 %) is dropped again from here up. */
const LOW_BATTERY_CLEAR_PCT = 25;

export class SimulationEngine {
  private simulationInterval: NodeJS.Timeout | null = null;
  private cachedChargingStation: RobotLocation | null = null;
  private zoneCache: Zone[] = [];
  private previousZone: Zone | null = null;
  /** See {@link SimulationEngine.setPoseAuthority}. Null = simulation owns the position. */
  private poseAuthority: (() => boolean) | null = null;
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
   * Tell the engine that something else owns the robot's position (TASK-195).
   *
   * `start()` is called unconditionally at boot, with no hardware check, so
   * `updateZoneTracking()` used to write `location.zone` ten times a second
   * from a FROZEN simulated position while a real robot walked — and its
   * enter/exit events were `console.log`'d and went nowhere. Now that the place
   * resolver derives position from real odometry, that writer must stand down
   * whenever the resolver has an authoritative pose; otherwise the two disagree
   * at 10 Hz and the last writer wins.
   *
   * The zone writer is the only thing gated. Zones and places are different
   * vocabularies — see `RobotLocation.place` — so the resolver does not take
   * `zone` over, it simply stops the simulation from inventing one.
   *
   * @param probe returns true while a real pose is driving the location; pass
   *        null to hand zone tracking back to the simulation.
   */
  setPoseAuthority(probe: (() => boolean) | null): void {
    this.poseAuthority = probe;
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
    // Something else owns the position (TASK-195) — do not fabricate a zone
    // from a simulated one. Never throws: a broken probe must not take the
    // whole simulation tick down, and "the simulation keeps tracking" is the
    // pre-TASK-195 behaviour, which is the safe fallback.
    try {
      if (this.poseAuthority?.() === true) return false;
    } catch {
      // fall through to simulated zone tracking
    }

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

    // A flag that outlived its cause is a lie the SafetyMonitor acts on: it
    // treats any error containing 'Critical' as a system failure and latches a
    // protective stop — again after every reset — so a robot restored from disk
    // with 62 % battery and a stale 'Critical battery level' could never move.
    if (this.clearRecoveredBatteryFlags(newState)) return true;

    // Check low battery warning
    if (newState.batteryLevel < 20 && !newState.warnings.includes('Low battery')) {
      this.stateUpdater((s) => {
        s.warnings.push('Low battery');
      });
      return true;
    }

    // Low battery while idle: head to the charging station before it gets critical
    if (
      newState.batteryLevel < 20 &&
      newState.status === 'online' &&
      !newState.targetLocation &&
      this.cachedChargingStation
    ) {
      return this.startReturnToCharger('Returning to charging station');
    }

    // Critical battery: emergency-dock instead of bricking the robot. Also
    // recovers robots persisted in 'error' from the old brick-on-critical
    // behavior (their errors[] contains 'Critical battery level').
    if (newState.batteryLevel < 5 && !this.isEnRouteToCharger(newState)) {
      const batteryError = newState.errors.includes('Critical battery level');
      if (this.cachedChargingStation && (newState.status !== 'error' || batteryError)) {
        return this.startReturnToCharger('Emergency: returning to charging station', true);
      }
      if (!this.cachedChargingStation && newState.status !== 'error') {
        // No charging station known — nothing to dock to, report the failure
        this.stateUpdater((s) => {
          if (!s.errors.includes('Critical battery level')) {
            s.errors.push('Critical battery level');
          }
          s.status = 'error';
          s.targetLocation = undefined;
        });
        return true;
      }
    }

    return false;
  }

  /**
   * Send the robot to the cached charging station
   * @returns true (state changed)
   */
  private startReturnToCharger(taskName: string, critical = false): boolean {
    const charger = this.cachedChargingStation;
    if (!charger) return false;

    const state = this.stateGetter();
    console.log(
      `[SimulationEngine] ${state.name}: battery ${state.batteryLevel.toFixed(1)}% — ${taskName}`
    );

    this.stateUpdater((s) => {
      if (critical && !s.errors.includes('Critical battery level')) {
        s.errors.push('Critical battery level');
      }
      s.status = 'busy';
      s.currentTaskName = taskName;
      s.targetLocation = { ...charger };
    });
    return true;
  }

  /**
   * Whether the robot is already moving towards the charging station
   */
  private isEnRouteToCharger(state: SimulatedRobotState): boolean {
    if (!this.cachedChargingStation || !state.targetLocation || state.status !== 'busy') {
      return false;
    }
    return (
      Math.abs(state.targetLocation.x - this.cachedChargingStation.x) < 1 &&
      Math.abs(state.targetLocation.y - this.cachedChargingStation.y) < 1
    );
  }

  /**
   * Charge battery
   * @returns true if fully charged
   */
  private chargeBattery(deltaTime: number): boolean {
    this.stateUpdater((s) => {
      s.batteryLevel = Math.min(100, s.batteryLevel + this.config.batteryChargePerSecond * deltaTime);
    });

    const newState = this.stateGetter();
    const flagsCleared = this.clearRecoveredBatteryFlags(newState);

    if (newState.batteryLevel >= 100) {
      this.stateUpdater((s) => {
        s.status = 'online';
        s.warnings = s.warnings.filter((w) => w !== 'Low battery');
        s.errors = s.errors.filter((e) => e !== 'Critical battery level');
      });
      return true;
    }

    return flagsCleared;
  }

  /**
   * Drop 'Critical battery level' / 'Low battery' once the battery is clearly
   * above the level that raised them (hysteresis so a level hovering at the
   * threshold does not flap). Returns true when something was removed.
   */
  private clearRecoveredBatteryFlags(state: SimulatedRobotState): boolean {
    const dropCritical =
      state.batteryLevel >= CRITICAL_BATTERY_CLEAR_PCT && state.errors.includes('Critical battery level');
    const dropLow = state.batteryLevel >= LOW_BATTERY_CLEAR_PCT && state.warnings.includes('Low battery');
    if (!dropCritical && !dropLow) return false;
    this.stateUpdater((s) => {
      if (dropCritical) s.errors = s.errors.filter((e) => e !== 'Critical battery level');
      if (dropLow) s.warnings = s.warnings.filter((w) => w !== 'Low battery');
    });
    return true;
  }
}
