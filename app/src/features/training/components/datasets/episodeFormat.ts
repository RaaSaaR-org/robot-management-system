/**
 * @file episodeFormat.ts
 * @description Small helpers for the episode browser: clock time, score tone,
 *   feature names and camera keys.
 *   Error text comes from the shared `errorMessage()` in `@/shared/components/ui`.
 * @feature training
 */

import type { StatusTagTone } from '@/shared/components/ui';

/** 75 → "1:15". */
export function formatClock(seconds: number): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const m = Math.floor(safe / 60);
  const s = Math.floor(safe % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Reward-model score tone: good above 0.7, doubtful above 0.4, bad below. */
export function scoreTone(score: number): StatusTagTone {
  if (score > 0.7) return 'success';
  if (score > 0.4) return 'warning';
  return 'danger';
}

/**
 * Flatten a LeRobot feature's `names` into a list of strings, whatever its
 * shape: a flat array, a nested array (Unitree: `[["kLeftShoulderPitch", ...]]`)
 * or an object of arrays (pusht, xarm: `{ "motors": ["motor_0", "motor_1"] }`).
 */
export function featureNames(names: unknown): string[] {
  if (typeof names === 'string') return [names];
  if (Array.isArray(names)) return names.flatMap(featureNames);
  if (names && typeof names === 'object') return Object.values(names).flatMap(featureNames);
  return [];
}

/**
 * The camera feature keys of a dataset, in feature order: every feature whose
 * dtype is `video` or `image`, whatever it is called — `observation.images.top`
 * as well as pusht's singular `observation.image`. A feature with no dtype
 * still counts when it sits under `observation.images.`.
 */
export function cameraKeys(features: Record<string, unknown>): string[] {
  return Object.entries(features)
    .filter(([key, f]) => {
      const dtype = (f as { dtype?: unknown } | null)?.dtype;
      if (dtype === 'video' || dtype === 'image') return true;
      return dtype === undefined && key.startsWith('observation.images.');
    })
    .map(([key]) => key);
}

/** Short label for a camera key: `observation.images.top` → `top`. */
export function cameraLabel(key: string): string {
  return key.startsWith('observation.images.') ? key.slice('observation.images.'.length) : key;
}
