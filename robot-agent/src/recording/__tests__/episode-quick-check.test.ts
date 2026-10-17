/**
 * @file episode-quick-check.test.ts
 * @description The per-take glance: thresholds, ordering, groups and warnings.
 * @feature recording
 * @status test
 */

import { describe, it, expect } from 'vitest';
import {
  summarizeEpisode,
  middleFrame,
  groupOf,
  G1_MOTION_GROUPS,
  JOINT_MOVED_THRESHOLD_RAD,
} from '../episode-quick-check.js';
import { G1_DEX3_JOINTS } from '../dex3-layout.js';

const NAMES = ['left_elbow_joint', 'right_wrist_roll_joint', 'left_hand_thumb_0_joint', 'waist_yaw_joint'];

function frames(rows: number[][]): { state: number[] }[] {
  return rows.map((state) => ({ state }));
}

describe('summarizeEpisode', () => {
  it('lists joints above 0.05 rad, widest first, and ignores ones at or below it', () => {
    const check = summarizeEpisode(
      frames([
        [0, 0, 0, 0],
        [0.3, 0.05, 0.051, 0.02],
        [0.1, 0.0, 0.0, -0.02],
      ]),
      NAMES,
      G1_MOTION_GROUPS,
      { durationS: 5, dropped: 0 },
    );
    expect(check.jointsMoved).toEqual([
      { name: 'left_elbow_joint', rangeRad: 0.3 },
      { name: 'left_hand_thumb_0_joint', rangeRad: 0.051 },
    ]);
    expect(check.groupsMoved).toEqual(['left_arm', 'left_hand']);
    expect(check.warnings).toEqual([]);
  });

  it('caps the list at twelve but derives the groups from every moving joint', () => {
    const names = [...Array.from({ length: 13 }, (_, i) => `left_shoulder_${i}`), 'waist_yaw_joint'];
    const moved = names.map((_, i) => (i < 13 ? 1 + i * 0.01 : 0.06));
    const check = summarizeEpisode(frames([names.map(() => 0), moved]), names, G1_MOTION_GROUPS, {});
    expect(check.jointsMoved).toHaveLength(12);
    expect(check.jointsMoved[0]!.name).toBe('left_shoulder_12');
    expect(check.jointsMoved.map((j) => j.name)).not.toContain('waist_yaw_joint');
    expect(check.groupsMoved).toEqual(['left_arm', 'waist']);
  });

  it('warns short under two seconds, no_motion without motion, dropped_frames above 5 %', () => {
    const still = frames(Array.from({ length: 19 }, () => [0, 0, 0, 0]));
    // 1 dropped of 20 wanted ticks is exactly 5 %: not above it.
    expect(summarizeEpisode(still, NAMES, G1_MOTION_GROUPS, { durationS: 1.99, dropped: 1 }).warnings).toEqual([
      'short',
      'no_motion',
    ]);
    // 2 of 21 is.
    expect(summarizeEpisode(still, NAMES, G1_MOTION_GROUPS, { durationS: 2, dropped: 2 }).warnings).toEqual([
      'no_motion',
      'dropped_frames',
    ]);
  });

  it('counts frames that repeated the last sample against the 5 % like drops (TASK-415)', () => {
    const still = frames(Array.from({ length: 20 }, () => [0, 0, 0, 0]));
    // 1 of 20 brought nothing new: exactly 5 %, not above it.
    expect(summarizeEpisode(still, NAMES, G1_MOTION_GROUPS, { repeated: 1 }).warnings).toEqual(['no_motion']);
    // 1 repeated + 1 dropped of 21 wanted is.
    expect(summarizeEpisode(still, NAMES, G1_MOTION_GROUPS, { repeated: 1, dropped: 1 }).warnings).toEqual([
      'no_motion',
      'dropped_frames',
    ]);
  });

  it('reports no_motion for an empty take and ignores non-finite values', () => {
    expect(summarizeEpisode([], NAMES).warnings).toEqual(['no_motion']);
    const check = summarizeEpisode(frames([[0, NaN, 0, 0], [0, 5, 0, 0]]), NAMES);
    expect(check.jointsMoved).toEqual([]);
  });

  it('maps every G1 Dex3 recording joint to a group', () => {
    for (const name of G1_DEX3_JOINTS) expect(groupOf(name, G1_MOTION_GROUPS), name).not.toBeNull();
    expect(groupOf('left_hip_pitch_joint', G1_MOTION_GROUPS)).toBe('legs');
    expect(groupOf('left_hand_index_0_joint', G1_MOTION_GROUPS)).toBe('left_hand');
    expect(groupOf('shoulder_pan', G1_MOTION_GROUPS)).toBeNull();
  });

  it('uses the documented threshold', () => {
    expect(JOINT_MOVED_THRESHOLD_RAD).toBe(0.05);
  });
});

describe('middleFrame', () => {
  it('picks the middle frame, or null for an empty take', () => {
    expect(middleFrame(0)).toBeNull();
    expect(middleFrame(1)).toBe(0);
    expect(middleFrame(4)).toBe(1);
    expect(middleFrame(5)).toBe(2);
  });
});
