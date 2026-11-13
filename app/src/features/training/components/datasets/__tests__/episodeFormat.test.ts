/**
 * @file episodeFormat.test.ts
 * @description Feature names and camera keys of real LeRobot info.json shapes (TASK-361)
 * @feature training
 */

import { describe, expect, it } from 'vitest';
import {
  cameraKeys, cameraLabel, channelLabels, channelStats, featureNames, formatStat, groupLabel, mostActiveGroup, statsFrameCount,
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
