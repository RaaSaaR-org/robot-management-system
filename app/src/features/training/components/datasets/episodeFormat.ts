/**
 * @file episodeFormat.ts
 * @description Small helpers for the episode browser: clock time, score tone,
 *   feature names, joint groups, per-channel statistics and camera keys.
 *   Error text comes from the shared `errorMessage()` in `@/shared/components/ui`.
 * @feature training
 */

import type { StatusTagTone } from '@/shared/components/ui';
import type { ChannelGroup, FeatureStats, FrameData } from '../../types';

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
 * One label per channel of a `width`-wide vector from its joint groups: the
 * group name and the index inside it (`left_arm[3]`). A channel no group covers
 * is labelled by its position in the vector (`ch[40]`).
 */
export function channelLabels(groups: ChannelGroup[], width: number): string[] {
  const labels = Array.from({ length: Math.max(0, width) }, (_, i) => `ch[${i}]`);
  for (const group of groups) {
    for (let i = Math.max(0, group.start); i < Math.min(group.end, labels.length); i += 1) {
      labels[i] = `${group.name}[${i - group.start}]`;
    }
  }
  return labels;
}

/** `left_arm` → `left arm`, for a button. */
export function groupLabel(name: string): string {
  return name.replace(/_/g, ' ');
}

/**
 * The group whose state channels travel furthest over these frames — the one
 * worth looking at first. A standing G1's legs barely move while its arms do
 * the task. Null when there are no groups.
 */
export function mostActiveGroup(groups: ChannelGroup[], frames: FrameData[]): string | null {
  let best: string | null = null;
  let bestTravel = -1;
  for (const group of groups) {
    let travel = 0;
    for (let i = group.start; i < group.end; i += 1) {
      let lo = Infinity;
      let hi = -Infinity;
      for (const frame of frames) {
        const v = frame.observationState[i];
        if (typeof v !== 'number' || !Number.isFinite(v)) continue;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      if (hi > lo) travel += hi - lo;
    }
    if (travel > bestTravel) {
      best = group.name;
      bestTravel = travel;
    }
  }
  return best;
}

/** One channel's row of the statistics table. */
export interface ChannelStats {
  index: number;
  min?: number;
  max?: number;
  mean?: number;
  std?: number;
}

/**
 * Per-channel rows out of one feature's statistics. Each of min/max/mean/std is
 * a vector with one entry per channel; a missing or non-numeric entry is left
 * undefined rather than shown as 0.
 */
export function channelStats(stats: FeatureStats | undefined): ChannelStats[] {
  if (!stats) return [];
  const vector = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
  const min = vector(stats.min);
  const max = vector(stats.max);
  const mean = vector(stats.mean);
  const std = vector(stats.std);
  const width = Math.max(min.length, max.length, mean.length, std.length);
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  return Array.from({ length: width }, (_, index) => ({
    index, min: num(min[index]), max: num(max[index]), mean: num(mean[index]), std: num(std[index]),
  }));
}

/** How many frames a feature's statistics cover, when the file says. */
export function statsFrameCount(stats: FeatureStats | undefined): number | null {
  const raw = Array.isArray(stats?.count) ? (stats.count as unknown[])[0] : stats?.count;
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : null;
}

/** A statistic in four significant digits: `-0.5811`; `0.000003548` → `3.548e-6`. */
export function formatStat(value: number | undefined): string {
  if (value === undefined) return '–';
  if (value === 0) return '0';
  const abs = Math.abs(value);
  return abs >= 1e5 || abs < 1e-3 ? value.toExponential(3) : String(Number(value.toPrecision(4)));
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
