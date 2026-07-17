/**
 * @file telemetryLive.ts
 * @description Transient store for high-rate telemetry frames (TASK-191).
 *              `robot_telemetry_fast` frames arrive at ~10 Hz and are read
 *              imperatively inside the 3D viewer's useFrame loop — they must
 *              never pass through React state or the Zustand store, where every
 *              frame would re-render the whole Canvas subtree.
 * @feature robots
 */

import type { RobotTelemetry } from '../types/robots.types';

/** Partial frame from the fast channel plus its local arrival time. */
export interface FastTelemetryEntry {
  frame: Partial<RobotTelemetry>;
  /** Local wall-clock ms when the frame arrived (drives freshness checks). */
  receivedAt: number;
}

/** A fast frame older than this is considered stale — consumers fall back to
 * the regular 2 s frames from the store cache (still interpolated). */
export const FAST_FRAME_FRESHNESS_MS = 2000;

const frames = new Map<string, FastTelemetryEntry>();

/** Record a fast frame for a robot. Called from the app-wide WebSocket handler. */
export function pushFastTelemetry(robotId: string, frame: Partial<RobotTelemetry>): void {
  frames.set(robotId, { frame, receivedAt: Date.now() });
}

/**
 * Latest fast frame for a robot, or null when none arrived within
 * `maxAgeMs` — the graceful-degradation signal (older agents, fast channel
 * disabled, poll-only mode).
 */
export function getFastTelemetry(
  robotId: string,
  maxAgeMs: number = FAST_FRAME_FRESHNESS_MS
): FastTelemetryEntry | null {
  const entry = frames.get(robotId);
  if (!entry || Date.now() - entry.receivedAt > maxAgeMs) return null;
  return entry;
}

/** Drop cached frames — one robot's, or all (tests / teardown). */
export function clearFastTelemetry(robotId?: string): void {
  if (robotId === undefined) frames.clear();
  else frames.delete(robotId);
}
