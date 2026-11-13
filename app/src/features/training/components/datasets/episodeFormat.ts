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

/**
 * The transport clock: 19.67 → "0:19.7". Tenths, so the playhead and the total
 * are cut the same way and meet at the end of the episode — whole seconds made
 * a 19.67 s episode stop at "0:19" under a total that had been rounded up.
 */
export function formatPlayhead(seconds: number): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  // Work in tenths so 59.96 carries into the minute instead of reading "0:60.0".
  const tenths = Math.round(safe * 10);
  const m = Math.floor(tenths / 600);
  const rest = tenths - m * 600;
  return `${m}:${Math.floor(rest / 10).toString().padStart(2, '0')}.${rest % 10}`;
}

/**
 * Where a time sits between the first and last sample of a chart, 0..1. Always
 * a position: before the first sample is 0, past the last is 1 — a video runs
 * one frame longer than its last sample's timestamp, and the cursor must not
 * drop off the chart for it. Null when there is nothing to place it on.
 */
export function cursorFraction(time: number, first: number | undefined, last: number | undefined): number | null {
  if (first === undefined || last === undefined || !Number.isFinite(first) || !Number.isFinite(last)) return null;
  if (last <= first) return 0;
  const t = Number.isFinite(time) ? time : first;
  return Math.min(1, Math.max(0, (t - first) / (last - first)));
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
 * A name that says nothing about the joint: a bare number, or a generic stem
 * with a number (`motor_0`, `dim_3`, `joint 4`, `q7`, `action[2]`). pusht and
 * most converted datasets carry these; a G1 recording carries
 * `left_shoulder_pitch_joint`.
 */
const PLACEHOLDER_NAME =
  /^(?:motors?|dims?|ch|chan|channels?|joints?|axis|axes|state|action|obs|observation|features?|values?|idx|index|dof|[a-z])?[\s_.\-[(]*\d+[\])]?$/i;

export function isPlaceholderName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed === '' || PLACEHOLDER_NAME.test(trimmed);
}

/**
 * The names of a `width`-wide vector when they really name its channels: one
 * per channel, all different, none a placeholder. Null otherwise — GR00T
 * exports put the single name `observation_to_policy` on 43 channels, and
 * `motor_0`…`motor_5` is no better than an index.
 */
export function realChannelNames(names: readonly string[] | undefined, width: number): string[] | null {
  if (!names || width <= 0 || names.length !== width) return null;
  if (names.some(isPlaceholderName)) return null;
  if (new Set(names).size !== names.length) return null;
  return [...names];
}

/**
 * Whether one list of names can label both vectors of a chart that draws a
 * channel's state and its action as one pair. False when the other vector has
 * a real name of its own at some index and it is a different one: `arms[5]`
 * is true of both lines there, the action's name is true of one.
 */
export function channelNamesAgree(names: readonly string[], other: readonly string[] | undefined): boolean {
  if (!other) return true;
  return other.every((name, i) => i >= names.length || isPlaceholderName(name) || name === names[i]);
}

/**
 * One label per channel of a `width`-wide vector that has joint groups. The
 * joint's own name when `names` (out of info.json) really names every channel
 * — "arms[5]" says nothing where the vector alternates left and right — and
 * otherwise the group name and the index inside it (`left_arm[3]`), a channel
 * no group covers by its position in the vector (`ch[40]`).
 */
export function channelLabels(groups: ChannelGroup[], width: number, names?: readonly string[]): string[] {
  const real = realChannelNames(names, Math.max(0, width));
  if (real) return real;
  const labels = Array.from({ length: Math.max(0, width) }, (_, i) => `ch[${i}]`);
  for (const group of groups) {
    for (let i = Math.max(0, group.start); i < Math.min(group.end, labels.length); i += 1) {
      labels[i] = `${group.name}[${i - group.start}]`;
    }
  }
  return labels;
}

/**
 * The same names without a suffix they all share (`_joint`), for a legend that
 * has to fit fourteen of them. Dropped only when every name ends in it and
 * something is left of each, so two channels can never end up with one label.
 */
export function shortChannelNames(names: readonly string[]): string[] {
  const suffix = '_joint';
  if (names.length < 2 || !names.every((n) => n.length > suffix.length && n.endsWith(suffix))) return [...names];
  return names.map((n) => n.slice(0, -suffix.length));
}

/** Which side of the body a channel belongs to, and the joint it is there. */
export interface ChannelSide {
  side: 'left' | 'right';
  /** The name without its side: `left_elbow` and `right_elbow` are both `elbow`. */
  joint: string;
}

const SIDE_PREFIX = /^k?(left|right)[\s_.\-]*(.+)$/i;

/**
 * Left/right pairs among these channels: an entry per channel, or null when
 * the set is not two-sided (a name without `left_`/`right_`, or only one side
 * present — `left_arm[0]`…`left_arm[6]` is one arm, not a pair).
 */
export function channelSides(names: readonly string[]): ChannelSide[] | null {
  const sides: ChannelSide[] = [];
  for (const name of names) {
    const match = SIDE_PREFIX.exec(name);
    if (!match) return null;
    sides.push({ side: match[1]!.toLowerCase() as ChannelSide['side'], joint: match[2]! });
  }
  return sides.some((s) => s.side === 'left') && sides.some((s) => s.side === 'right') ? sides : null;
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

/** The y axis of a chart fitted to its data: where it starts and ends, and the round values it is labelled at. */
export interface FittedAxis {
  domain: [number, number];
  ticks: number[];
  /** Decimals the tick labels need to tell two neighbours apart. */
  digits: number;
}

/**
 * A y axis that fits the values on screen: from just under the lowest to just
 * over the highest (5 % of the span each side), labelled at round values in
 * between. Recharts' own axis rounds both ends OUT to its tick step, so arms
 * that stay within about ±2 rad were drawn on −4…4 and used half the plot.
 * The ends here are not ticks, so no step of empty plot is added.
 *
 * `values` yields everything drawn (state and action of every visible channel
 * over the whole episode — not the part under the cursor, so the axis holds
 * still while the episode plays). Null when nothing in it is a finite number.
 */
export function fitAxis(values: Iterable<number | undefined>, wantedTicks = 5): FittedAxis | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (lo > hi) return null;
  // A flat line still gets a band around it, wide enough to read its value.
  const pad = hi > lo ? (hi - lo) * 0.05 : Math.max(Math.abs(hi) * 0.05, 0.05);
  const domain: [number, number] = [lo - pad, hi + pad];

  const rough = (domain[1] - domain[0]) / wantedTicks;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * magnitude >= rough * (1 - 1e-9)) ?? 10) * magnitude;
  let digits = 0;
  while (digits < 12 && Math.abs(step * 10 ** digits - Math.round(step * 10 ** digits)) > 1e-9 * step * 10 ** digits) digits += 1;
  const ticks: number[] = [];
  for (let k = Math.ceil(domain[0] / step - 1e-9); k * step <= domain[1] + step * 1e-9; k += 1) {
    // Without the float tail (0.30000000000000004) that would end up in a label; and no −0.
    ticks.push(Number((k * step).toFixed(digits)) + 0);
  }
  return { domain, ticks, digits };
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
