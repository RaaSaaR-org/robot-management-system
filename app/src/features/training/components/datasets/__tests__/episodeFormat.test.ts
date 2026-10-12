/**
 * @file episodeFormat.test.ts
 * @description Feature names and camera keys of real LeRobot info.json shapes (TASK-361)
 * @feature training
 */

import { describe, expect, it } from 'vitest';
import { cameraKeys, cameraLabel, featureNames } from '../episodeFormat';

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
