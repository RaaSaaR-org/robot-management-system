/**
 * @file videoCodec.test.ts
 * @description Reading a camera's codec from info.json and asking the browser about it.
 * @feature training
 */

import { describe, it, expect, vi } from 'vitest';
import { canPlayVideoCodec, describeVideoCodec, featureVideoCodec } from '../videoCodec';

// nvidia/GR00T-N1.7-AppleToPlate, meta/info.json.
const EGO_VIEW = {
  dtype: 'video',
  shape: [480, 640, 3],
  names: ['height', 'width', 'channels'],
  info: { 'video.height': 480, 'video.width': 640, 'video.codec': 'av1', 'video.pix_fmt': 'yuv420p', 'video.fps': 30 },
};

describe('featureVideoCodec', () => {
  it('reads the codec LeRobot writes into info.json', () => {
    expect(featureVideoCodec(EGO_VIEW)).toBe('av1');
  });

  it('reads the v2.0 `video_info` block', () => {
    expect(featureVideoCodec({ dtype: 'video', video_info: { 'video.codec': 'h264' } })).toBe('h264');
  });

  it('is undefined when the feature does not say', () => {
    expect(featureVideoCodec({ dtype: 'video', shape: [96, 96, 3] })).toBeUndefined();
    expect(featureVideoCodec({ dtype: 'video', info: { 'video.codec': '' } })).toBeUndefined();
    expect(featureVideoCodec(undefined)).toBeUndefined();
    expect(featureVideoCodec('av1')).toBeUndefined();
  });
});

describe('describeVideoCodec', () => {
  it('names the codecs datasets ship, whatever the encoder called them', () => {
    expect(describeVideoCodec('av1').label).toBe('AV1');
    expect(describeVideoCodec('libsvtav1').label).toBe('AV1');
    expect(describeVideoCodec('H264').label).toBe('H.264');
    expect(describeVideoCodec('hevc').label).toBe('H.265 (HEVC)');
    expect(describeVideoCodec('vp9').label).toBe('VP9');
  });

  it('names an unrecognised codec as written, with no type string to ask about', () => {
    const info = describeVideoCodec('ffv1');
    expect(info.label).toBe('ffv1');
    expect(info.mime).toBeUndefined();
  });
});

describe('canPlayVideoCodec', () => {
  it('asks the browser about an AV1 type string', () => {
    const probe = vi.fn(() => true);
    expect(canPlayVideoCodec('av1', probe)).toBe(true);
    expect(probe).toHaveBeenCalledWith('video/mp4; codecs="av01.0.05M.08"');
  });

  it('is false only on the browser’s own word', () => {
    expect(canPlayVideoCodec('av1', () => false)).toBe(false);
  });

  it('is null — try and see — when there is nothing to ask', () => {
    const probe = vi.fn(() => false);
    expect(canPlayVideoCodec(undefined, probe)).toBeNull();
    expect(canPlayVideoCodec('ffv1', probe)).toBeNull();
    expect(probe).not.toHaveBeenCalled();
  });

  it('is null when asking throws', () => {
    expect(canPlayVideoCodec('av1', () => { throw new Error('no media'); })).toBeNull();
  });
});
