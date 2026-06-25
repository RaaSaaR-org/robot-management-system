/**
 * @file depth-sensor-config.test.ts
 * @description Unit tests for DepthSensorManager + G1 depth-sensor YAML config
 * @feature vla
 * @status test
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DepthSensorManager } from '../depth-sensor-config.js';
import { EmbodimentLoader } from '../embodiment-loader.js';
import type { EmbodimentConfig } from '../types.js';

function baseConfig(overrides: Partial<EmbodimentConfig> = {}): EmbodimentConfig {
  return {
    embodiment_tag: 'test_robot',
    manufacturer: 'Test',
    model: 'T1',
    action: { dim: 1, normalization: { mean: [0], std: [1] } },
    proprioception: { dim: 2, joint_names: ['j0'] },
    cameras: [],
    version: '1.0.0',
    ...overrides,
  } as EmbodimentConfig;
}

describe('DepthSensorManager', () => {
  let manager: DepthSensorManager;

  beforeEach(() => {
    manager = new DepthSensorManager();
  });

  it('returns an empty list when no depth sensors are configured', () => {
    expect(manager.getDepthSensorSpecs(baseConfig())).toEqual([]);
    expect(manager.getPrimaryDepthSensor(baseConfig())).toBeUndefined();
  });

  it('filters disabled sensors and finds the primary (first enabled)', () => {
    const config = baseConfig({
      depth_sensors: [
        { name: 'off', type: 'lidar', has_intensity: true, enabled: false },
        { name: 'mid360', type: 'lidar', has_intensity: true, enabled: true },
        { name: 'd435i', type: 'depth_camera', has_intensity: false, enabled: true },
      ],
    });
    const enabled = manager.getEnabledDepthSensors(config);
    expect(enabled.map((s) => s.name)).toEqual(['mid360', 'd435i']);
    expect(manager.getPrimaryDepthSensor(config)?.name).toBe('mid360');
    expect(manager.getDepthSensor('d435i', config)?.type).toBe('depth_camera');
  });

  it('flags duplicate sensor names', () => {
    const config = baseConfig({
      depth_sensors: [
        { name: 'dup', type: 'lidar', has_intensity: true, enabled: true },
        { name: 'dup', type: 'lidar', has_intensity: true, enabled: true },
      ],
    });
    expect(manager.validateDepthSensors(config)).toContain('Duplicate depth sensor name: dup');
  });

  it('flags invalid FOV and range', () => {
    const config = baseConfig({
      depth_sensors: [
        { name: 'bad', type: 'lidar', fov_horizontal: 400, range: [5, 1], has_intensity: true, enabled: true },
      ],
    });
    const errors = manager.validateDepthSensors(config);
    expect(errors.some((e) => e.includes('horizontal FOV'))).toBe(true);
    expect(errors.some((e) => e.includes('range'))).toBe(true);
  });
});

describe('G1 depth-sensor YAML config', () => {
  beforeEach(() => {
    EmbodimentLoader.resetInstance();
  });

  it('loads the Livox MID-360 + RealSense D435i for the G1', async () => {
    const loader = EmbodimentLoader.getInstance();
    const config = await loader.loadEmbodiment('unitree_g1');
    const manager = new DepthSensorManager();
    const sensors = manager.getDepthSensorSpecs(config);

    expect(sensors.map((s) => s.name)).toContain('mid360_lidar');
    expect(sensors.map((s) => s.name)).toContain('d435i_depth');

    const lidar = manager.getDepthSensor('mid360_lidar', config);
    expect(lidar?.type).toBe('lidar');
    expect(lidar?.fov_horizontal).toBe(360);
    expect(lidar?.points_per_frame).toBe(20000);
    expect(manager.validateDepthSensors(config)).toEqual([]);
  });

  it('loads depth sensors for the G1 EDU', async () => {
    const loader = EmbodimentLoader.getInstance();
    const config = await loader.loadEmbodiment('unitree_g1_edu_dex3');
    const manager = new DepthSensorManager();
    expect(manager.getEnabledDepthSensors(config).length).toBeGreaterThanOrEqual(2);
  });
});
