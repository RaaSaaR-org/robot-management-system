/**
 * @file camera-config.test.ts
 * @description Unit tests for CameraConfigManager
 * @feature vla
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CameraConfigManager } from '../camera-config.js';
import type { EmbodimentConfig } from '../types.js';

describe('CameraConfigManager', () => {
  let manager: CameraConfigManager;
  let mockConfig: EmbodimentConfig;

  beforeEach(() => {
    manager = new CameraConfigManager();

    mockConfig = {
      embodiment_tag: 'test_robot',
      manufacturer: 'Test',
      model: 'TestBot',
      action: {
        dim: 6,
        normalization: { mean: [], std: [] },
      },
      proprioception: {
        dim: 12,
        joint_names: [],
      },
      cameras: [
        {
          name: 'head_camera',
          resolution: [224, 224] as [number, number],
          fov: 90,
          position: [0, 0, 1.7] as [number, number, number],
          enabled: true,
        },
        {
          name: 'wrist_camera',
          resolution: [640, 480] as [number, number],
          fov: 60,
          enabled: true,
        },
        {
          name: 'disabled_camera',
          resolution: [320, 240] as [number, number],
          enabled: false,
        },
      ],
      version: '1.0.0',
    };
  });

  describe('getCameraSpecs', () => {
    it('should return all camera specifications', () => {
      const cameras = manager.getCameraSpecs(mockConfig);

      expect(cameras.length).toBe(3);
      expect(cameras[0].name).toBe('head_camera');
    });

    it('should return empty array when no cameras', () => {
      const configNoCameras: EmbodimentConfig = {
        ...mockConfig,
        cameras: [],
      };

      const cameras = manager.getCameraSpecs(configNoCameras);

      expect(cameras).toEqual([]);
    });
  });

  describe('getEnabledCameras', () => {
    it('should return only enabled cameras', () => {
      const cameras = manager.getEnabledCameras(mockConfig);

      expect(cameras.length).toBe(2);
      expect(cameras.every((c) => c.enabled !== false)).toBe(true);
    });
  });

  describe('getCamera', () => {
    it('should return camera by name', () => {
      const camera = manager.getCamera('head_camera', mockConfig);

      expect(camera).toBeDefined();
      expect(camera?.name).toBe('head_camera');
      expect(camera?.resolution).toEqual([224, 224]);
    });

    it('should return undefined for unknown camera', () => {
      const camera = manager.getCamera('unknown', mockConfig);

      expect(camera).toBeUndefined();
    });
  });

  describe('getExpectedResolution', () => {
    it('should return camera resolution', () => {
      const resolution = manager.getExpectedResolution('head_camera', mockConfig);

      expect(resolution).toEqual([224, 224]);
    });

    it('should return default resolution for unknown camera', () => {
      const resolution = manager.getExpectedResolution('unknown', mockConfig);

      expect(resolution).toEqual([224, 224]); // Default
    });
  });

  describe('getPrimaryCamera', () => {
    it('should return first enabled camera', () => {
      const camera = manager.getPrimaryCamera(mockConfig);

      expect(camera).toBeDefined();
      expect(camera?.name).toBe('head_camera');
    });

    it('should return undefined when no enabled cameras', () => {
      const configDisabled: EmbodimentConfig = {
        ...mockConfig,
        cameras: [
          { name: 'cam1', resolution: [224, 224] as [number, number], enabled: false },
        ],
      };

      const camera = manager.getPrimaryCamera(configDisabled);

      expect(camera).toBeUndefined();
    });
  });

  describe('preprocessImage', () => {
    it('should return image buffer with correct size', () => {
      const image = Buffer.alloc(224 * 224 * 3, 128);

      const processed = manager.preprocessImage(image, 'head_camera', mockConfig);

      expect(processed.length).toBe(224 * 224 * 3);
    });

    it('should pad smaller images', () => {
      const smallImage = Buffer.alloc(100 * 100 * 3, 128);

      const processed = manager.preprocessImage(smallImage, 'head_camera', mockConfig);

      expect(processed.length).toBe(224 * 224 * 3);
    });

    it('should truncate larger images', () => {
      const largeImage = Buffer.alloc(640 * 480 * 3, 128);

      const processed = manager.preprocessImage(largeImage, 'head_camera', mockConfig);

      expect(processed.length).toBe(224 * 224 * 3);
    });
  });

  describe('normalizePixels', () => {
    it('should normalize pixel values to [0, 1] range', () => {
      const image = Buffer.from([0, 128, 255]);

      const normalized = manager.normalizePixels(image);

      expect(normalized[0]).toBeCloseTo(0);
      expect(normalized[1]).toBeCloseTo(0.502, 2);
      expect(normalized[2]).toBe(1);
    });
  });

  describe('applyImageNetNormalization', () => {
    it('should apply mean subtraction and std division', () => {
      // Single pixel RGB (all 0.5)
      const image = new Float32Array([0.5, 0.5, 0.5]);

      const normalized = manager.applyImageNetNormalization(image, 1, 1);

      // (0.5 - 0.485) / 0.229 = 0.0655
      // (0.5 - 0.456) / 0.224 = 0.196
      // (0.5 - 0.406) / 0.225 = 0.418
      expect(normalized[0]).toBeCloseTo(0.0655, 2);
      expect(normalized[1]).toBeCloseTo(0.196, 2);
      expect(normalized[2]).toBeCloseTo(0.418, 2);
    });
  });

  describe('preprocessForModel', () => {
    it('should run full preprocessing pipeline', () => {
      const image = Buffer.alloc(224 * 224 * 3, 128);

      const processed = manager.preprocessForModel(image, 'head_camera', mockConfig);

      // Should return Float32Array
      expect(processed).toBeInstanceOf(Float32Array);
      expect(processed.length).toBe(224 * 224 * 3);
    });
  });

  describe('createPlaceholderImage', () => {
    it('should create correctly sized placeholder', () => {
      const placeholder = manager.createPlaceholderImage('head_camera', mockConfig);

      expect(placeholder.length).toBe(224 * 224 * 3);
    });

    it('should use specified fill value', () => {
      const placeholder = manager.createPlaceholderImage('head_camera', mockConfig, 200);

      expect(placeholder[0]).toBe(200);
      expect(placeholder[100]).toBe(200);
    });
  });

  describe('validateCameras', () => {
    it('should return no errors for valid config', () => {
      const errors = manager.validateCameras(mockConfig);

      expect(errors).toEqual([]);
    });

    it('should detect duplicate camera names', () => {
      const configDupe: EmbodimentConfig = {
        ...mockConfig,
        cameras: [
          { name: 'cam1', resolution: [224, 224] as [number, number], enabled: true },
          { name: 'cam1', resolution: [320, 240] as [number, number], enabled: true },
        ],
      };

      const errors = manager.validateCameras(configDupe);

      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('Duplicate');
    });

    it('should detect invalid resolution', () => {
      const configBadRes: EmbodimentConfig = {
        ...mockConfig,
        cameras: [
          { name: 'cam1', resolution: [-1, 224] as [number, number], enabled: true },
        ],
      };

      const errors = manager.validateCameras(configBadRes);

      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('resolution');
    });

    it('should detect invalid FOV', () => {
      const configBadFov: EmbodimentConfig = {
        ...mockConfig,
        cameras: [
          { name: 'cam1', resolution: [224, 224] as [number, number], fov: 200, enabled: true },
        ],
      };

      const errors = manager.validateCameras(configBadFov);

      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('FOV');
    });
  });

  describe('getCameraInfo', () => {
    it('should return human-readable camera info', () => {
      const info = manager.getCameraInfo(mockConfig);

      expect(info).toContain('head_camera');
      expect(info).toContain('224x224');
      expect(info).toContain('FOV: 90');
    });

    it('should return message when no cameras', () => {
      const configNoCameras: EmbodimentConfig = {
        ...mockConfig,
        cameras: [],
      };

      const info = manager.getCameraInfo(configNoCameras);

      expect(info).toBe('No cameras configured');
    });
  });
});
