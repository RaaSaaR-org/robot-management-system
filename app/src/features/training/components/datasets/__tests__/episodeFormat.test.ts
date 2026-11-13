/**
 * @file episodeFormat.test.ts
 * @description Feature names and camera keys of real LeRobot info.json shapes (TASK-361)
 * @feature training
 */

import { describe, expect, it } from 'vitest';
import {
  cameraKeys, cameraLabel, channelLabels, channelSides, channelStats, cursorFraction, featureNames, formatPlayhead, formatStat,
  groupLabel, isPlaceholderName, mostActiveGroup, realChannelNames, shortChannelNames, statsFrameCount,
} from '../episodeFormat';

// nvidia/GR00T-N1.7-AppleToPlate meta/modality.json: the state groups of a Unitree G1.
const G1_GROUPS = [
  { name: 'left_leg', start: 0, end: 6 },
  { name: 'right_leg', start: 6, end: 12 },
  { name: 'waist', start: 12, end: 15 },
  { name: 'left_arm', start: 15, end: 22 },
  { name: 'right_arm', start: 22, end: 29 },
  { name: 'left_hand', start: 29, end: 36 },
  { name: 'right_hand', start: 36, end: 43 },
];

describe('channelLabels (TASK-476)', () => {
  it('labels all 43 channels of a G1 vector by body part and index', () => {
    const labels = channelLabels(G1_GROUPS, 43);
    expect(labels).toHaveLength(43);
    expect(labels[0]).toBe('left_leg[0]');
    expect(labels[18]).toBe('left_arm[3]');
    expect(labels[42]).toBe('right_hand[6]');
    expect(new Set(labels).size).toBe(43);
  });

  it('labels a channel no group covers by its position, and ignores a group past the width', () => {
    expect(channelLabels([{ name: 'arm', start: 1, end: 3 }, { name: 'far', start: 4, end: 9 }], 4))
      .toEqual(['ch[0]', 'arm[0]', 'arm[1]', 'ch[3]']);
  });

  it('spells a group name for a button', () => {
    expect(groupLabel('left_arm')).toBe('left arm');
  });
});

// g1-dex3-bottle-sorting-sim meta/info.json: 31 joints, left and right alternating.
const G1_DEX3_NAMES = [
  'waist_yaw_joint', 'waist_roll_joint', 'waist_pitch_joint',
  'left_shoulder_pitch_joint', 'right_shoulder_pitch_joint', 'left_shoulder_roll_joint', 'right_shoulder_roll_joint',
  'left_shoulder_yaw_joint', 'right_shoulder_yaw_joint', 'left_elbow_joint', 'right_elbow_joint',
  'left_wrist_roll_joint', 'right_wrist_roll_joint', 'left_wrist_pitch_joint', 'right_wrist_pitch_joint',
  'left_wrist_yaw_joint', 'right_wrist_yaw_joint',
  'left_hand_index_0_joint', 'left_hand_middle_0_joint', 'left_hand_thumb_0_joint',
  'right_hand_index_0_joint', 'right_hand_middle_0_joint', 'right_hand_thumb_0_joint',
  'left_hand_index_1_joint', 'left_hand_middle_1_joint', 'left_hand_thumb_1_joint',
  'right_hand_index_1_joint', 'right_hand_middle_1_joint', 'right_hand_thumb_1_joint',
  'left_hand_thumb_2_joint', 'right_hand_thumb_2_joint',
];
// Its meta/modality.json.
const G1_DEX3_GROUPS = [
  { name: 'waist', start: 0, end: 3 },
  { name: 'arms', start: 3, end: 17 },
  { name: 'hands', start: 17, end: 31 },
];

describe('real channel names inside joint groups (TASK-494)', () => {
  it('knows a placeholder from a name', () => {
    for (const name of ['motor_0', 'dim_3', '7', ' 12 ', 'joint_4', 'joint 4', 'q7', 'j0', 'action[2]', 'ch[40]', 'state.5', 'axis-1', ''])
      expect(isPlaceholderName(name), name).toBe(true);
    for (const name of ['left_shoulder_pitch_joint', 'kLeftShoulderPitch', 'left_hand_thumb_2_joint', 'main_gripper', 'x', 'yaw', 'shoulder_pan', 'gripper'])
      expect(isPlaceholderName(name), name).toBe(false);
  });

  it('takes names only when there is a real, different one for every channel', () => {
    expect(realChannelNames(G1_DEX3_NAMES, 31)).toEqual(G1_DEX3_NAMES);
    // GR00T: one name for 43 channels.
    expect(realChannelNames(['observation_to_policy'], 43)).toBeNull();
    // pusht.
    expect(realChannelNames(['motor_0', 'motor_1'], 2)).toBeNull();
    expect(realChannelNames(['0', '1', '2'], 3)).toBeNull();
    // One placeholder among real names, the same name twice, no names at all.
    expect(realChannelNames(['shoulder_pan', 'dim_1'], 2)).toBeNull();
    expect(realChannelNames(['elbow', 'elbow'], 2)).toBeNull();
    expect(realChannelNames(undefined, 2)).toBeNull();
    expect(realChannelNames([], 0)).toBeNull();
  });

  it('labels a grouped vector by joint name where info.json names every joint', () => {
    const labels = channelLabels(G1_DEX3_GROUPS, 31, G1_DEX3_NAMES);
    expect(labels[3]).toBe('left_shoulder_pitch_joint');
    expect(labels[4]).toBe('right_shoulder_pitch_joint');
    // arms[5] of the group is the left yaw, not a fifth joint of one arm.
    expect(labels[8]).toBe('right_shoulder_yaw_joint');
    expect(labels).toEqual(G1_DEX3_NAMES);
  });

  it('keeps group and index where the names are placeholders or do not fit', () => {
    const byIndex = channelLabels(G1_GROUPS, 43);
    expect(channelLabels(G1_GROUPS, 43, ['observation_to_policy'])).toEqual(byIndex);
    expect(channelLabels(G1_GROUPS, 43, Array.from({ length: 43 }, (_, i) => `motor_${i}`))).toEqual(byIndex);
    expect(channelLabels(G1_DEX3_GROUPS, 31, G1_DEX3_NAMES.slice(0, 30))[8]).toBe('arms[5]');
  });

  it('shortens a suffix every name shares, and only then', () => {
    expect(shortChannelNames(G1_DEX3_NAMES.slice(3, 6))).toEqual(['left_shoulder_pitch', 'right_shoulder_pitch', 'left_shoulder_roll']);
    expect(shortChannelNames(['elbow_joint', 'gripper'])).toEqual(['elbow_joint', 'gripper']);
    // Nothing would be left of the first one.
    expect(shortChannelNames(['_joint', 'elbow_joint'])).toEqual(['_joint', 'elbow_joint']);
    expect(shortChannelNames(['elbow_joint'])).toEqual(['elbow_joint']);
    const short = shortChannelNames(G1_DEX3_NAMES);
    expect(new Set(short).size).toBe(31);
  });

  it('pairs left and right joints, and leaves a one-sided set alone', () => {
    const arms = channelSides(shortChannelNames(G1_DEX3_NAMES.slice(3, 17)));
    expect(arms).toHaveLength(14);
    expect(arms![0]).toEqual({ side: 'left', joint: 'shoulder_pitch' });
    expect(arms![1]).toEqual({ side: 'right', joint: 'shoulder_pitch' });
    expect(channelSides(['kLeftElbow', 'kRightElbow'])).toEqual([{ side: 'left', joint: 'Elbow' }, { side: 'right', joint: 'Elbow' }]);
    // The waist has no side; one arm of a GR00T dataset has one.
    expect(channelSides(['waist_yaw', 'left_elbow', 'right_elbow'])).toBeNull();
    expect(channelSides(['left_arm[0]', 'left_arm[1]'])).toBeNull();
  });
});

describe('mostActiveGroup', () => {
  const frame = (state: number[]) => ({ frameIndex: 0, timestamp: 0, action: state, observationState: state });

  it('picks the group whose state travels furthest', () => {
    const groups = [{ name: 'legs', start: 0, end: 2 }, { name: 'arms', start: 2, end: 4 }];
    const frames = [frame([0, 0, 0, 0]), frame([0.01, 0, 0.5, -0.4]), frame([0, 0.01, 1, 0])];
    expect(mostActiveGroup(groups, frames)).toBe('arms');
  });

  it('answers the first group when nothing moves, and null without groups', () => {
    expect(mostActiveGroup([{ name: 'a', start: 0, end: 1 }, { name: 'b', start: 1, end: 2 }], [])).toBe('a');
    expect(mostActiveGroup([], [])).toBeNull();
  });
});

describe('channelStats', () => {
  it('turns the four vectors of a feature into one row per channel', () => {
    expect(channelStats({ min: [0, -1], max: [1, 2], mean: [0.5, 0], std: [0.1, 0.2], count: [40] })).toEqual([
      { index: 0, min: 0, max: 1, mean: 0.5, std: 0.1 },
      { index: 1, min: -1, max: 2, mean: 0, std: 0.2 },
    ]);
  });

  it('leaves a missing statistic undefined instead of inventing 0', () => {
    expect(channelStats({ mean: [1, 2], std: [0.1] })).toEqual([
      { index: 0, min: undefined, max: undefined, mean: 1, std: 0.1 },
      { index: 1, min: undefined, max: undefined, mean: 2, std: undefined },
    ]);
    expect(channelStats(undefined)).toEqual([]);
  });

  it('reads the frame count, as a one-element list or a number', () => {
    expect(statsFrameCount({ count: [171625] })).toBe(171625);
    expect(statsFrameCount({ count: 12 })).toBe(12);
    expect(statsFrameCount({ mean: [1] })).toBeNull();
  });

  it('formats a statistic in four significant digits', () => {
    expect(formatStat(-0.5811261375918659)).toBe('-0.5811');
    expect(formatStat(19.633333)).toBe('19.63');
    expect(formatStat(0)).toBe('0');
    expect(formatStat(0.0000035476)).toBe('3.548e-6');
    expect(formatStat(undefined)).toBe('–');
  });
});

// lerobot/pusht meta/info.json (v3.0), trimmed to its features.
const PUSHT_FEATURES = {
  'observation.image': { dtype: 'video', shape: [96, 96, 3], names: ['height', 'width', 'channel'] },
  'observation.state': { dtype: 'float32', shape: [2], names: { motors: ['motor_0', 'motor_1'] } },
  action: { dtype: 'float32', shape: [2], names: { motors: ['motor_0', 'motor_1'] } },
  episode_index: { dtype: 'int64', shape: [1], names: null },
};

describe('featureNames', () => {
  it('flattens the object-of-arrays names of pusht and xarm', () => {
    expect(featureNames(PUSHT_FEATURES.action.names)).toEqual(['motor_0', 'motor_1']);
  });

  it('flattens flat and Unitree-style nested arrays', () => {
    expect(featureNames(['a.pos', 'b.pos'])).toEqual(['a.pos', 'b.pos']);
    expect(featureNames([['kLeftShoulderPitch', 'kLeftShoulderRoll']])).toEqual(['kLeftShoulderPitch', 'kLeftShoulderRoll']);
  });

  it('returns nothing for absent names', () => {
    expect(featureNames(null)).toEqual([]);
    expect(featureNames(undefined)).toEqual([]);
  });
});

describe('cameraKeys', () => {
  it('finds the singular observation.image camera of pusht', () => {
    expect(cameraKeys(PUSHT_FEATURES)).toEqual(['observation.image']);
  });

  it('keeps image and video features and drops state-only ones', () => {
    expect(
      cameraKeys({
        'observation.images.top': { dtype: 'video' },
        'observation.images.wrist': { dtype: 'image' },
        'observation.state': { dtype: 'float32' },
      }),
    ).toEqual(['observation.images.top', 'observation.images.wrist']);
  });

  it('labels a camera by its short name', () => {
    expect(cameraLabel('observation.images.top')).toBe('top');
    expect(cameraLabel('observation.image')).toBe('observation.image');
  });
});

describe('formatPlayhead (TASK-484)', () => {
  it('cuts the playhead and the total the same way, so they meet at the end', () => {
    // Whole seconds showed 19.67 as "0:19" under a total that read "0:20".
    expect(formatPlayhead(19.67)).toBe('0:19.7');
    expect(formatPlayhead(0)).toBe('0:00.0');
    expect(formatPlayhead(75.04)).toBe('1:15.0');
  });

  it('carries into the minute instead of showing sixty seconds', () => {
    expect(formatPlayhead(59.96)).toBe('1:00.0');
  });

  it('reads nonsense as zero', () => {
    expect(formatPlayhead(Number.NaN)).toBe('0:00.0');
    expect(formatPlayhead(-3)).toBe('0:00.0');
  });
});

describe('cursorFraction (TASK-484)', () => {
  it('is on the chart at the start and past the last sample', () => {
    expect(cursorFraction(0, 0, 19.633)).toBe(0);
    // The video runs one frame longer than the last sample's timestamp.
    expect(cursorFraction(19.67, 0, 19.633)).toBe(1);
    expect(cursorFraction(-1, 0, 10)).toBe(0);
  });

  it('is proportional in between', () => {
    expect(cursorFraction(5, 0, 10)).toBe(0.5);
    expect(cursorFraction(6, 2, 10)).toBe(0.5);
  });

  it('has no position without samples, and one position on a single sample', () => {
    expect(cursorFraction(1, undefined, undefined)).toBeNull();
    expect(cursorFraction(1, 3, 3)).toBe(0);
  });
});
