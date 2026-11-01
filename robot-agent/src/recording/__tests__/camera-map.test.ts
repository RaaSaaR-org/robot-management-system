/**
 * @file camera-map.test.ts
 * @description Scene camera -> dataset feature key.
 * @feature recording
 */

import { describe, it, expect } from 'vitest';
import { datasetCameraKey, datasetImageFeature, mapCameras } from '../camera-map.js';

const G1_SCENES = [
  'g1_dex3_house_scene.xml',
  'g1_dex3_room_scene.xml',
  'g1_warehouse_scene.xml',
  'g1_dex3_pickplace_scene.xml',
  'g1_apple_pnp_scene.xml',
];

describe('datasetCameraKey', () => {
  it('gives the head camera a Unitree key in every scene we ship', () => {
    for (const scene of G1_SCENES) {
      expect(datasetCameraKey(scene, 'head_camera')).toBe('cam_right_high');
    }
  });

  it('does not leak a scene name into a column', () => {
    // observation.images.house_iso is unloadable by any recipe written for a G1.
    expect(datasetCameraKey('g1_dex3_house_scene.xml', 'house_iso')).toBe('cam_third_person');
    expect(datasetCameraKey('g1_warehouse_scene.xml', 'warehouse_iso')).toBe('cam_third_person');
  });

  it('gives the apple scene its second robot-mounted view the other stereo slot', () => {
    expect(datasetCameraKey('g1_apple_pnp_scene.xml', 'ego_camera')).toBe('cam_left_high');
  });

  it('falls back to a name that cannot be mistaken for a Unitree key', () => {
    expect(datasetCameraKey('unknown_scene.xml', 'weird cam!')).toBe('cam_weird_cam');
    expect(datasetCameraKey(null, 'something')).toBe('cam_something');
  });

  it('still knows the head camera when the scene is unknown', () => {
    expect(datasetCameraKey(null, 'head_camera')).toBe('cam_right_high');
  });

  it('names the wrist cameras with the Unitree wrist keys in every G1 scene', () => {
    for (const scene of [null, ...G1_SCENES]) {
      expect(datasetCameraKey(scene, 'left_wrist_camera')).toBe('cam_left_wrist');
      expect(datasetCameraKey(scene, 'right_wrist_camera')).toBe('cam_right_wrist');
    }
  });
});

describe('datasetImageFeature', () => {
  it('prefixes the LeRobot namespace', () => {
    expect(datasetImageFeature('g1_dex3_house_scene.xml', 'head_camera')).toBe(
      'observation.images.cam_right_high',
    );
  });
});

describe('mapCameras', () => {
  it('maps head + both wrists to three distinct columns in every G1 scene', () => {
    for (const scene of G1_SCENES) {
      expect(
        mapCameras(scene, ['head_camera', 'left_wrist_camera', 'right_wrist_camera']).map((c) => c.key),
      ).toEqual(['cam_right_high', 'cam_left_wrist', 'cam_right_wrist']);
    }
  });

  it('maps a list in order', () => {
    expect(mapCameras('g1_dex3_house_scene.xml', ['head_camera', 'house_iso'])).toEqual([
      { camera: 'head_camera', key: 'cam_right_high' },
      { camera: 'house_iso', key: 'cam_third_person' },
    ]);
  });

  it('refuses a collision instead of interleaving two cameras into one video', () => {
    // Two names the fallback sanitiser cannot tell apart. Without this they
    // would both write frames into videos/observation.images.cam_side_cam.
    expect(() => mapCameras(null, ['side cam', 'side-cam'])).toThrow(/both map to/);
  });
});
