/**
 * @file embodiment-loader.test.ts
 * @description Unit tests for EmbodimentLoader
 * @feature vla
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EmbodimentLoader } from '../embodiment-loader.js';

describe('EmbodimentLoader', () => {
  let loader: EmbodimentLoader;

  beforeEach(() => {
    // Reset singleton for each test
    EmbodimentLoader.resetInstance();
    loader = EmbodimentLoader.getInstance();
  });

  afterEach(() => {
    loader.stopWatching();
    EmbodimentLoader.resetInstance();
  });

  describe('singleton', () => {
    it('should return same instance', () => {
      const instance1 = EmbodimentLoader.getInstance();
      const instance2 = EmbodimentLoader.getInstance();

      expect(instance1).toBe(instance2);
    });

    it('should reset instance', () => {
      const instance1 = EmbodimentLoader.getInstance();
      EmbodimentLoader.resetInstance();
      const instance2 = EmbodimentLoader.getInstance();

      expect(instance1).not.toBe(instance2);
    });
  });

  describe('initialize', () => {
    it('should load configurations from configs directory', async () => {
      await loader.initialize();

      expect(loader.isInitialized()).toBe(true);
      expect(loader.getLoadedCount()).toBeGreaterThan(0);
    });

    it('should be idempotent', async () => {
      await loader.initialize();
      const countAfterFirst = loader.getLoadedCount();

      await loader.initialize();
      const countAfterSecond = loader.getLoadedCount();

      expect(countAfterFirst).toBe(countAfterSecond);
    });
  });

  describe('loadEmbodiment', () => {
    beforeEach(async () => {
      await loader.initialize();
    });

    it('should load generic embodiment', async () => {
      const config = await loader.loadEmbodiment('generic');

      expect(config).toBeDefined();
      expect(config.embodiment_tag).toBe('generic');
      expect(config.manufacturer).toBe('Generic');
    });

    it('should load h1 embodiment', async () => {
      const config = await loader.loadEmbodiment('unitree_h1');

      expect(config).toBeDefined();
      expect(config.embodiment_tag).toBe('unitree_h1');
      expect(config.manufacturer).toBe('Unitree');
      expect(config.action.dim).toBe(19);
    });

    it('should load so101 embodiment', async () => {
      const config = await loader.loadEmbodiment('so101_arm');

      expect(config).toBeDefined();
      expect(config.embodiment_tag).toBe('so101_arm');
      expect(config.manufacturer).toBe('SO-ARM100');
      expect(config.action.dim).toBe(6);
    });

    it('should throw for unknown embodiment', async () => {
      await expect(loader.loadEmbodiment('nonexistent')).rejects.toThrow('not found');
    });

    it('should cache loaded embodiments', async () => {
      const config1 = await loader.loadEmbodiment('generic');
      const config2 = await loader.loadEmbodiment('generic');

      expect(config1).toBe(config2);
    });
  });

  describe('getEmbodiment', () => {
    beforeEach(async () => {
      await loader.initialize();
    });

    it('should return cached embodiment synchronously', () => {
      const config = loader.getEmbodiment('generic');

      expect(config).toBeDefined();
      expect(config?.embodiment_tag).toBe('generic');
    });

    it('should return undefined for unknown embodiment', () => {
      const config = loader.getEmbodiment('nonexistent');

      expect(config).toBeUndefined();
    });
  });

  describe('listEmbodiments', () => {
    beforeEach(async () => {
      await loader.initialize();
    });

    it('should return list of loaded embodiment tags', () => {
      const tags = loader.listEmbodiments();

      expect(Array.isArray(tags)).toBe(true);
      expect(tags.length).toBeGreaterThan(0);
      expect(tags).toContain('generic');
    });
  });

  describe('getDefault', () => {
    beforeEach(async () => {
      await loader.initialize();
    });

    it('should return default embodiment', async () => {
      const config = await loader.getDefault();

      expect(config).toBeDefined();
      expect(config.embodiment_tag).toBe('generic');
    });
  });

  describe('hasEmbodiment', () => {
    beforeEach(async () => {
      await loader.initialize();
    });

    it('should return true for loaded embodiments', () => {
      expect(loader.hasEmbodiment('generic')).toBe(true);
    });

    it('should return false for unknown embodiments', () => {
      expect(loader.hasEmbodiment('nonexistent')).toBe(false);
    });
  });

  describe('getStats', () => {
    beforeEach(async () => {
      await loader.initialize();
    });

    it('should return loader statistics', () => {
      const stats = loader.getStats();

      expect(stats.loadedCount).toBeGreaterThan(0);
      expect(Array.isArray(stats.tags)).toBe(true);
      expect(typeof stats.watchEnabled).toBe('boolean');
    });
  });

  describe('validation', () => {
    beforeEach(async () => {
      await loader.initialize();
    });

    it('should validate action dimensions', async () => {
      const h1Config = await loader.loadEmbodiment('unitree_h1');

      expect(h1Config.action.dim).toBe(19);
      expect(h1Config.action.normalization.mean.length).toBe(19);
      expect(h1Config.action.normalization.std.length).toBe(19);
    });

    it('should validate proprioception dimensions', async () => {
      const h1Config = await loader.loadEmbodiment('unitree_h1');

      expect(h1Config.proprioception.dim).toBe(38);
      expect(h1Config.proprioception.joint_names.length).toBe(19);
    });

    it('should have valid camera configs', async () => {
      const h1Config = await loader.loadEmbodiment('unitree_h1');

      expect(h1Config.cameras.length).toBeGreaterThan(0);
      for (const camera of h1Config.cameras) {
        expect(camera.name).toBeDefined();
        expect(camera.resolution[0]).toBeGreaterThan(0);
        expect(camera.resolution[1]).toBeGreaterThan(0);
      }
    });
  });

  describe('events', () => {
    beforeEach(async () => {
      await loader.initialize();
    });

    it('should emit embodiment:loaded events', async () => {
      const onLoaded = vi.fn();
      loader.on('embodiment:loaded', onLoaded);

      // Force reload
      await loader.reloadAll();

      expect(onLoaded).toHaveBeenCalled();
    });

    it('should emit embodiment:reloaded events on reload', async () => {
      const onReloaded = vi.fn();
      loader.on('embodiment:reloaded', onReloaded);

      await loader.reloadEmbodiment('generic');

      expect(onReloaded).toHaveBeenCalled();
      expect(onReloaded).toHaveBeenCalledWith(
        expect.objectContaining({
          tag: 'generic',
        })
      );
    });
  });

  describe('reloadAll', () => {
    beforeEach(async () => {
      await loader.initialize();
    });

    it('should reload all embodiments', async () => {
      const initialCount = loader.getLoadedCount();

      await loader.reloadAll();

      expect(loader.getLoadedCount()).toBe(initialCount);
    });
  });

  describe('getConfigsDir', () => {
    it('should return configs directory path', () => {
      const dir = loader.getConfigsDir();

      expect(dir).toContain('configs');
    });
  });
});
