/**
 * @file SimulationEngine.ts
 * @description Handles robot simulation - position updates, battery drain, movement
 * @feature robot
 * @status live
 */

import type { SimulatedRobotState, RobotLocation } from './types.js';
import { chargingStationLocation } from '../tools/navigation.js';

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
    return this.chargingStation;
  }

  /**
   * The charger the battery logic drives to: the nearest `charging` place of
   * the robot's registered place graph (TASK-329), read live because the graph
   * arrives after `start()`. A robot with no such place charges at home, the
   * frame origin — the one location that needs no graph.
   */
  private get chargingStation(): RobotLocation | null {
    return chargingStationLocation() ?? { x: 0, y: 0, floor: '1', place: null };
  }

  /**
   * Tell the engine that something else owns the robot's position (TASK-195).
   *
   * `start()` is called unconditionally at boot, with no hardware check. While
   * the place resolver derives `location.place` from real odometry it is the
   * only writer of that field; the simulation names the place it arrived at
   * only when no real pose drives the location (TASK-333 — the simulation no
   * longer invents zones, and `place` is the robot's only answer to where it is).
   *
   * @param probe returns true while a real pose is driving the location; pass
   *        null to hand the arrival place back to the simulation.
   */
  setPoseAuthority(probe: (() => boolean) | null): void {
    this.poseAuthority = probe;
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
          s.location.floor = s.targetLocation.floor;
          if (!this.hasPoseAuthority()) s.location.place = s.targetLocation.place ?? null;
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
    if (!this.chargingStation) return;

    const state = this.stateGetter();
    const isAtChargingStation =
      Math.abs(state.location.x - this.chargingStation.x) < 1 &&
      Math.abs(state.location.y - this.chargingStation.y) < 1;

    if (isAtChargingStation) {
      this.stateUpdater((s) => {
        s.status = 'charging';
        s.currentTaskName = 'Charging';
      });
    }
  }

  /**
   * True while a real pose owns the position (TASK-195). Never throws: a broken
   * probe must not take the simulation tick down, and "the simulation owns the
   * position" is the safe fallback.
   */
  private hasPoseAuthority(): boolean {
    try {
      return this.poseAuthority?.() === true;
    } catch {
      return false;
    }
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
      this.chargingStation
    ) {
      return this.startReturnToCharger('Returning to charging station');
    }

    // Critical battery: emergency-dock instead of bricking the robot. Also
    // recovers robots persisted in 'error' from the old brick-on-critical
    // behavior (their errors[] contains 'Critical battery level').
    if (newState.batteryLevel < 5 && !this.isEnRouteToCharger(newState)) {
      const batteryError = newState.errors.includes('Critical battery level');
      if (this.chargingStation && (newState.status !== 'error' || batteryError)) {
        return this.startReturnToCharger('Emergency: returning to charging station', true);
      }
      if (!this.chargingStation && newState.status !== 'error') {
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
    const charger = this.chargingStation;
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
    if (!this.chargingStation || !state.targetLocation || state.status !== 'busy') {
      return false;
    }
    return (
      Math.abs(state.targetLocation.x - this.chargingStation.x) < 1 &&
      Math.abs(state.targetLocation.y - this.chargingStation.y) < 1
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
