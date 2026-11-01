/**
 * @file episode-quick-check.ts
 * @description The glance an operator gets at a take the moment it ends: which
 *              joints moved, which body parts that adds up to, which frame to
 *              show as its thumbnail, and what looks wrong with it.
 * @feature recording
 * @status live
 */

/** A joint moves when its measured range over the take exceeds this, in rad. */
export const JOINT_MOVED_THRESHOLD_RAD = 0.05;

/** How many moving joints a report lists. The rest are summed up in groups. */
export const JOINTS_MOVED_LIMIT = 12;

/** A take shorter than this is flagged `short`. */
export const SHORT_TAKE_S = 2;

/** Ticks with no new sample (dropped or repeated) above this share of the ticks the take wanted flag it. */
export const DROPPED_FRAMES_RATIO = 0.05;

export type MotionGroup = 'left_arm' | 'right_arm' | 'left_hand' | 'right_hand' | 'waist' | 'legs';

export type EpisodeWarning = 'short' | 'no_motion' | 'dropped_frames';

export interface MotionGroupRule {
  group: MotionGroup;
  /** Joint-name prefixes that belong to the group. */
  prefixes: readonly string[];
}

/**
 * The G1 joint names, grouped by body part. Hands come first: `left_hand_*`
 * would otherwise be read as part of the left arm by nothing, but the order is
 * also the order `groupsMoved` is reported in, and it should read top-down.
 *
 * A layout whose names match none of these (the SO-101 arm) reports no groups,
 * which is the honest answer rather than a wrong one.
 */
export const G1_MOTION_GROUPS: readonly MotionGroupRule[] = [
  { group: 'left_arm', prefixes: ['left_shoulder_', 'left_elbow', 'left_wrist_'] },
  { group: 'right_arm', prefixes: ['right_shoulder_', 'right_elbow', 'right_wrist_'] },
  { group: 'left_hand', prefixes: ['left_hand_'] },
  { group: 'right_hand', prefixes: ['right_hand_'] },
  { group: 'waist', prefixes: ['waist_'] },
  {
    group: 'legs',
    prefixes: ['left_hip_', 'right_hip_', 'left_knee', 'right_knee', 'left_ankle_', 'right_ankle_'],
  },
];

export interface JointMoved {
  name: string;
  rangeRad: number;
}

export interface EpisodeQuickCheck {
  /** Joints whose range exceeded the threshold, widest first, at most 12. */
  jointsMoved: JointMoved[];
  /** Body parts with at least one moving joint, in `groups` order. */
  groupsMoved: MotionGroup[];
  warnings: EpisodeWarning[];
}

export interface QuickCheckExtras {
  /** Recorded span of the take, seconds. Omitted: no `short` check. */
  durationS?: number;
  /** Ticks of this take that produced no frame. */
  dropped?: number;
  /**
   * Frames of this take that re-read the previous measured sample (TASK-415).
   * They count against the rate like drops: a tick that stored the same state
   * twice delivered no new sample, whatever the frame count says.
   */
  repeated?: number;
}

/** Which group a joint name belongs to, or null. */
export function groupOf(name: string, groups: readonly MotionGroupRule[]): MotionGroup | null {
  for (const rule of groups) {
    if (rule.prefixes.some((p) => name.startsWith(p))) return rule.group;
  }
  return null;
}

/**
 * Summarise one take from its MEASURED pose. Pure: the recorder holds the
 * frames, so the check runs where they are and the server only relays it.
 *
 * Measured and not commanded, because the question is "did the robot move",
 * and a commanded pose the sidecar refused moved nothing.
 */
export function summarizeEpisode(
  frames: readonly { state: readonly number[] }[],
  jointNames: readonly string[],
  groups: readonly MotionGroupRule[] = G1_MOTION_GROUPS,
  extras: QuickCheckExtras = {},
): EpisodeQuickCheck {
  const dim = jointNames.length;
  const min = new Array<number>(dim).fill(Infinity);
  const max = new Array<number>(dim).fill(-Infinity);
  for (const f of frames) {
    for (let j = 0; j < dim; j++) {
      const v = f.state[j];
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      if (v < min[j]!) min[j] = v;
      if (v > max[j]!) max[j] = v;
    }
  }

  const moved: JointMoved[] = [];
  for (let j = 0; j < dim; j++) {
    const range = max[j]! - min[j]!;
    if (Number.isFinite(range) && range > JOINT_MOVED_THRESHOLD_RAD) {
      moved.push({ name: jointNames[j]!, rangeRad: Math.round(range * 1000) / 1000 });
    }
  }
  moved.sort((a, b) => b.rangeRad - a.rangeRad || a.name.localeCompare(b.name));

  // Groups from EVERY moving joint, not only the twelve listed: a take that
  // moved thirteen arm joints and one waist joint still moved the waist.
  const seen = new Set<MotionGroup>();
  for (const m of moved) {
    const g = groupOf(m.name, groups);
    if (g) seen.add(g);
  }
  const groupsMoved = groups.map((r) => r.group).filter((g, i, all) => seen.has(g) && all.indexOf(g) === i);

  const warnings: EpisodeWarning[] = [];
  if (extras.durationS !== undefined && extras.durationS < SHORT_TAKE_S) warnings.push('short');
  if (moved.length === 0) warnings.push('no_motion');
  const dropped = extras.dropped ?? 0;
  const repeated = extras.repeated ?? 0;
  // Every tick of an open, unpaused take is either a frame or a drop, so the
  // ticks the take WANTED are the two together. Of those, the ones that brought
  // no new sample are the drops plus the frames that repeated the last one.
  const wanted = frames.length + dropped;
  if (wanted > 0 && (dropped + repeated) / wanted > DROPPED_FRAMES_RATIO) warnings.push('dropped_frames');

  return { jointsMoved: moved.slice(0, JOINTS_MOVED_LIMIT), groupsMoved, warnings };
}

/** The middle frame of a take, or null when it has none. */
export function middleFrame(frameCount: number): number | null {
  return frameCount > 0 ? Math.floor((frameCount - 1) / 2) : null;
}
