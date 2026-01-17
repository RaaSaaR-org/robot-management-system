/**
 * @file action-interpolator.ts
 * @description Action interpolation and latency compensation for smooth VLA control
 * @feature vla
 */

import type { Action, InterpolationMethod } from './types.js';

/**
 * Configuration for action interpolation.
 */
export interface InterpolatorConfig {
  /** Interpolation method: 'linear' or 'cubic' */
  method: InterpolationMethod;
  /** Exponential moving average alpha for RTT smoothing (default: 0.2) */
  rttAlpha: number;
  /** Maximum allowed clock drift in seconds (default: 0.5) */
  maxClockDriftSeconds: number;
}

const DEFAULT_CONFIG: InterpolatorConfig = {
  method: 'linear',
  rttAlpha: 0.2,
  maxClockDriftSeconds: 0.5,
};

/**
 * Handles action interpolation and network latency compensation for VLA control.
 *
 * Features:
 * - Linear and cubic interpolation between actions
 * - Timestamp-based action selection
 * - RTT estimation with exponential moving average
 * - Clock drift compensation
 *
 * @example
 * ```typescript
 * const interpolator = new ActionInterpolator({ method: 'linear' });
 *
 * // Update RTT estimate when receiving responses
 * interpolator.updateRtt(latencyMs);
 *
 * // Select or interpolate action for current time
 * const action = interpolator.selectAction(actions, Date.now() / 1000);
 * ```
 */
export class ActionInterpolator {
  private config: InterpolatorConfig;
  private rttEstimateMs: number = 0;
  private rttSamples: number = 0;
  private lastServerTime: number = 0;
  private clockOffset: number = 0;

  constructor(config: Partial<InterpolatorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Update the RTT estimate with a new sample.
   * Uses exponential moving average for smoothing.
   * @param rttMs Round-trip time in milliseconds
   */
  updateRtt(rttMs: number): void {
    if (this.rttSamples === 0) {
      this.rttEstimateMs = rttMs;
    } else {
      this.rttEstimateMs =
        this.config.rttAlpha * rttMs + (1 - this.config.rttAlpha) * this.rttEstimateMs;
    }
    this.rttSamples++;
  }

  /**
   * Get the current RTT estimate in milliseconds.
   */
  getRttEstimate(): number {
    return this.rttEstimateMs;
  }

  /**
   * Update clock offset estimate based on server timestamp.
   * Helps compensate for clock drift between robot and server.
   * @param serverTimestamp Server timestamp in Unix epoch seconds
   * @param localTimestamp Local timestamp when response was received (Unix epoch seconds)
   */
  updateClockOffset(serverTimestamp: number, localTimestamp: number): void {
    // Estimated server time when we received the response
    const estimatedServerTime = serverTimestamp + this.rttEstimateMs / 2000;
    const newOffset = localTimestamp - estimatedServerTime;

    // Use EMA for clock offset too
    if (this.lastServerTime === 0) {
      this.clockOffset = newOffset;
    } else {
      this.clockOffset =
        this.config.rttAlpha * newOffset + (1 - this.config.rttAlpha) * this.clockOffset;
    }

    // Clamp to max drift
    this.clockOffset = Math.max(
      -this.config.maxClockDriftSeconds,
      Math.min(this.config.maxClockDriftSeconds, this.clockOffset)
    );

    this.lastServerTime = serverTimestamp;
  }

  /**
   * Get the estimated clock offset in seconds (local - server).
   */
  getClockOffset(): number {
    return this.clockOffset;
  }

  /**
   * Convert local timestamp to estimated server timestamp.
   */
  localToServerTime(localTimestamp: number): number {
    return localTimestamp - this.clockOffset;
  }

  /**
   * Select the best action for the current time from a list of actions.
   * Applies RTT compensation to select the action that should be executing now.
   *
   * @param actions Array of actions with timestamps
   * @param currentTime Current local time in Unix epoch seconds
   * @returns Selected action, or null if no suitable action found
   */
  selectAction(actions: Action[], currentTime: number): Action | null {
    if (actions.length === 0) {
      return null;
    }

    // Compensate for network latency - look ahead by RTT/2
    const targetTime = this.localToServerTime(currentTime) + this.rttEstimateMs / 2000;

    // Find the action closest to target time
    let bestAction = actions[0];
    let bestDiff = Math.abs(actions[0].timestamp - targetTime);

    for (let i = 1; i < actions.length; i++) {
      const diff = Math.abs(actions[i].timestamp - targetTime);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestAction = actions[i];
      }
    }

    return bestAction;
  }

  /**
   * Interpolate between two actions at a specific time.
   *
   * @param actionA First action (earlier timestamp)
   * @param actionB Second action (later timestamp)
   * @param targetTime Target time for interpolation in Unix epoch seconds
   * @returns Interpolated action
   */
  interpolate(actionA: Action, actionB: Action, targetTime: number): Action {
    // Calculate interpolation factor (0.0 = actionA, 1.0 = actionB)
    const timeDiff = actionB.timestamp - actionA.timestamp;
    if (timeDiff <= 0) {
      return actionA;
    }

    let t = (targetTime - actionA.timestamp) / timeDiff;
    t = Math.max(0, Math.min(1, t)); // Clamp to [0, 1]

    if (this.config.method === 'cubic') {
      return this.cubicInterpolate(actionA, actionB, t);
    } else {
      return this.linearInterpolate(actionA, actionB, t);
    }
  }

  /**
   * Linear interpolation between two actions.
   */
  private linearInterpolate(actionA: Action, actionB: Action, t: number): Action {
    const jointCommands = actionA.jointCommands.map((a, i) => {
      const b = actionB.jointCommands[i] ?? a;
      return a + t * (b - a);
    });

    const gripperCommand =
      actionA.gripperCommand + t * (actionB.gripperCommand - actionA.gripperCommand);

    const timestamp = actionA.timestamp + t * (actionB.timestamp - actionA.timestamp);

    return {
      jointCommands,
      gripperCommand,
      timestamp,
    };
  }

  /**
   * Cubic (Hermite) interpolation for smoother acceleration curves.
   * Uses smoothstep function for ease-in-ease-out behavior.
   */
  private cubicInterpolate(actionA: Action, actionB: Action, t: number): Action {
    // Smoothstep: 3t^2 - 2t^3 for ease-in-ease-out
    const smoothT = t * t * (3 - 2 * t);

    const jointCommands = actionA.jointCommands.map((a, i) => {
      const b = actionB.jointCommands[i] ?? a;
      return a + smoothT * (b - a);
    });

    const gripperCommand =
      actionA.gripperCommand + smoothT * (actionB.gripperCommand - actionA.gripperCommand);

    const timestamp = actionA.timestamp + t * (actionB.timestamp - actionA.timestamp);

    return {
      jointCommands,
      gripperCommand,
      timestamp,
    };
  }

  /**
   * Find the two actions that bracket the target time and interpolate between them.
   *
   * @param actions Sorted array of actions (by timestamp, ascending)
   * @param currentTime Current local time in Unix epoch seconds
   * @returns Interpolated action, or null if no suitable actions found
   */
  interpolateAtTime(actions: Action[], currentTime: number): Action | null {
    if (actions.length === 0) {
      return null;
    }

    if (actions.length === 1) {
      return actions[0];
    }

    const targetTime = this.localToServerTime(currentTime) + this.rttEstimateMs / 2000;

    // Find the bracketing actions
    let beforeIdx = -1;
    let afterIdx = -1;

    for (let i = 0; i < actions.length; i++) {
      if (actions[i].timestamp <= targetTime) {
        beforeIdx = i;
      }
      if (actions[i].timestamp >= targetTime && afterIdx === -1) {
        afterIdx = i;
      }
    }

    // Handle edge cases
    if (beforeIdx === -1) {
      // Target time is before all actions, use first action
      return actions[0];
    }
    if (afterIdx === -1) {
      // Target time is after all actions, use last action
      return actions[actions.length - 1];
    }
    if (beforeIdx === afterIdx) {
      // Exact match
      return actions[beforeIdx];
    }

    // Interpolate between bracketing actions
    return this.interpolate(actions[beforeIdx], actions[afterIdx], targetTime);
  }

  /**
   * Set the interpolation method.
   */
  setMethod(method: InterpolationMethod): void {
    this.config.method = method;
  }

  /**
   * Get the current interpolation method.
   */
  getMethod(): InterpolationMethod {
    return this.config.method;
  }

  /**
   * Reset RTT and clock offset estimates.
   */
  reset(): void {
    this.rttEstimateMs = 0;
    this.rttSamples = 0;
    this.clockOffset = 0;
    this.lastServerTime = 0;
  }

  /**
   * Get interpolator statistics.
   */
  getStats(): {
    rttEstimateMs: number;
    rttSamples: number;
    clockOffsetSeconds: number;
    method: InterpolationMethod;
  } {
    return {
      rttEstimateMs: this.rttEstimateMs,
      rttSamples: this.rttSamples,
      clockOffsetSeconds: this.clockOffset,
      method: this.config.method,
    };
  }
}
