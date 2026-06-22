/**
 * @file DataAugmentationService.test.ts
 * @description Unit tests for DataAugmentationService — action/image/language augmentation math, validation, pipeline
 * @feature datasets
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DataAugmentationService, dataAugmentationService } from '../DataAugmentationService.js';
import type {
  ActionAugmentationConfig,
  ImageAugmentationConfig,
  LanguageAugmentationConfig,
  AugmentationConfig,
} from '../../types/curation.types.js';

describe('DataAugmentationService', () => {
  let service: DataAugmentationService;

  beforeEach(() => {
    service = DataAugmentationService.getInstance();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // --------------------------------------------------------------------------
  // SINGLETON
  // --------------------------------------------------------------------------

  describe('getInstance', () => {
    it('returns the same instance every time', () => {
      expect(DataAugmentationService.getInstance()).toBe(DataAugmentationService.getInstance());
    });

    it('exports a shared singleton', () => {
      expect(dataAugmentationService).toBe(DataAugmentationService.getInstance());
    });
  });

  // --------------------------------------------------------------------------
  // GAUSSIAN NOISE
  // --------------------------------------------------------------------------

  describe('addGaussianNoise', () => {
    it('preserves shape of the action matrix', () => {
      const actions = [
        [1, 2, 3],
        [4, 5, 6],
      ];
      const result = service.addGaussianNoise(actions, 0.05);
      expect(result).toHaveLength(2);
      expect(result[0]).toHaveLength(3);
      expect(result[1]).toHaveLength(3);
    });

    it('adds zero noise when scale is 0 (values unchanged)', () => {
      const actions = [
        [1, 2],
        [3, 4],
      ];
      const result = service.addGaussianNoise(actions, 0);
      expect(result).toEqual(actions);
    });

    it('applies noise = gaussianRandom * scale to each value', () => {
      // gaussianRandom is private; control it via Math.random.
      // Box-Muller: u, v from Math.random. With deterministic random, output is deterministic.
      const seq = [0.5, 0.5, 0.5, 0.5];
      let i = 0;
      vi.spyOn(Math, 'random').mockImplementation(() => seq[i++ % seq.length]);

      const scale = 2;
      const actions = [[10]];
      const result = service.addGaussianNoise(actions, scale);

      // Recompute expected gaussian value with u=v=0.5
      const u = 0.5;
      const v = 0.5;
      const g = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
      expect(result[0][0]).toBeCloseTo(10 + g * scale, 10);
    });

    it('returns empty array for empty input', () => {
      expect(service.addGaussianNoise([], 0.1)).toEqual([]);
    });
  });

  // --------------------------------------------------------------------------
  // TEMPORAL JITTER
  // --------------------------------------------------------------------------

  describe('applyTemporalJitter', () => {
    it('keeps actions intact and only perturbs timestamps within bounds', () => {
      const traj = [
        { timestamp: 100, action: [1, 2] },
        { timestamp: 200, action: [3, 4] },
      ];
      const result = service.applyTemporalJitter(traj, 10);
      expect(result).toHaveLength(2);
      expect(result[0].action).toEqual([1, 2]);
      expect(result[1].action).toEqual([3, 4]);
      // jitter in [-maxJitterMs, +maxJitterMs]
      expect(Math.abs(result[0].timestamp - 100)).toBeLessThanOrEqual(10);
      expect(Math.abs(result[1].timestamp - 200)).toBeLessThanOrEqual(10);
    });

    it('applies the exact jitter formula (timestamp + (random-0.5)*2*max)', () => {
      vi.spyOn(Math, 'random').mockReturnValue(1);
      const result = service.applyTemporalJitter([{ timestamp: 50, action: [0] }], 10);
      // (1 - 0.5) * 2 * 10 = 10
      expect(result[0].timestamp).toBe(60);
    });

    it('returns empty for empty trajectory', () => {
      expect(service.applyTemporalJitter([], 5)).toEqual([]);
    });
  });

  // --------------------------------------------------------------------------
  // INTERPOLATION
  // --------------------------------------------------------------------------

  describe('interpolateActions', () => {
    it('returns input unchanged when fewer than 2 actions', () => {
      expect(service.interpolateActions([[1, 2]], 2)).toEqual([[1, 2]]);
      expect(service.interpolateActions([], 2)).toEqual([]);
    });

    it('returns input unchanged when factor < 1', () => {
      const actions = [
        [0],
        [10],
      ];
      expect(service.interpolateActions(actions, 0)).toEqual(actions);
    });

    it('inserts correct linearly interpolated points for factor 2', () => {
      const actions = [
        [0, 0],
        [10, 20],
      ];
      const result = service.interpolateActions(actions, 2);
      // factor 2 inserts 1 midpoint between each pair
      expect(result).toHaveLength(3);
      expect(result[0]).toEqual([0, 0]);
      expect(result[1]).toEqual([5, 10]); // t=0.5
      expect(result[2]).toEqual([10, 20]);
    });

    it('inserts (factor-1) interpolated points per segment for factor 4', () => {
      const actions = [
        [0],
        [4],
      ];
      const result = service.interpolateActions(actions, 4);
      // 2 endpoints + 3 interior = 5
      expect(result).toHaveLength(5);
      expect(result.map((a) => a[0])).toEqual([0, 1, 2, 3, 4]);
    });

    it('grows length to factor*(n-1)+1 for a multi-segment trajectory', () => {
      const actions = [[0], [2], [4]];
      const result = service.interpolateActions(actions, 2);
      // 2*(3-1)+1 = 5
      expect(result).toHaveLength(5);
      expect(result.map((a) => a[0])).toEqual([0, 1, 2, 3, 4]);
    });
  });

  // --------------------------------------------------------------------------
  // AUGMENT ACTIONS PIPELINE
  // --------------------------------------------------------------------------

  describe('augmentActions', () => {
    it('returns actions unchanged with no augmentations when disabled', () => {
      const actions = [[1], [2]];
      const config: ActionAugmentationConfig = { enabled: false, noiseScale: 0.5 };
      const result = service.augmentActions(actions, config);
      expect(result.actions).toBe(actions);
      expect(result.augmentationsApplied).toEqual([]);
    });

    it('applies gaussian noise and records the label when noiseScale > 0', () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const config: ActionAugmentationConfig = { enabled: true, noiseScale: 0.1 };
      const result = service.augmentActions([[1]], config);
      expect(result.augmentationsApplied).toContain('gaussian_noise_0.1');
    });

    it('does not apply noise when noiseScale is 0', () => {
      const config: ActionAugmentationConfig = { enabled: true, noiseScale: 0 };
      const result = service.augmentActions([[1], [2]], config);
      expect(result.augmentationsApplied).toEqual([]);
    });

    it('applies interpolation and records label when factor > 1', () => {
      const config: ActionAugmentationConfig = {
        enabled: true,
        noiseScale: 0,
        interpolationFactor: 2,
      };
      const result = service.augmentActions([[0], [10]], config);
      expect(result.actions).toHaveLength(3);
      expect(result.augmentationsApplied).toContain('interpolation_2x');
    });

    it('does not interpolate when factor is 1', () => {
      const config: ActionAugmentationConfig = {
        enabled: true,
        noiseScale: 0,
        interpolationFactor: 1,
      };
      const result = service.augmentActions([[0], [10]], config);
      expect(result.actions).toHaveLength(2);
      expect(result.augmentationsApplied).toEqual([]);
    });

    it('applies both noise and interpolation when both enabled', () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const config: ActionAugmentationConfig = {
        enabled: true,
        noiseScale: 0.05,
        interpolationFactor: 2,
      };
      const result = service.augmentActions([[0], [10]], config);
      expect(result.augmentationsApplied).toEqual([
        'gaussian_noise_0.05',
        'interpolation_2x',
      ]);
    });
  });

  // --------------------------------------------------------------------------
  // COLOR JITTER
  // --------------------------------------------------------------------------

  describe('applyColorJitter', () => {
    it('clamps output pixel values into [0, 255]', () => {
      vi.spyOn(Math, 'random').mockReturnValue(1); // max brightness/contrast
      const result = service.applyColorJitter([0, 128, 255], 0.5, 0.5);
      for (const v of result) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(255);
      }
    });

    it('leaves pixels unchanged when ranges are 0', () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      // brightness = contrast = 1 -> value = pixel*1 + 0
      const result = service.applyColorJitter([10, 50, 100], 0, 0);
      expect(result).toEqual([10, 50, 100]);
    });

    it('applies the brightness/contrast formula', () => {
      // random=0.5 => brightness=contrast=1+0=... actually (0.5-0.5)*2*r = 0
      // Use random=1 to get brightness=1+range, contrast=1+range
      vi.spyOn(Math, 'random').mockReturnValue(1);
      const brightnessRange = 0.1;
      const contrastRange = 0.1;
      const pixel = 100;
      const contrast = 1 + (1 - 0.5) * 2 * contrastRange; // 1.1
      const brightness = 1 + (1 - 0.5) * 2 * brightnessRange; // 1.1
      const expected = Math.max(0, Math.min(255, pixel * contrast + (brightness - 1) * 128));
      const result = service.applyColorJitter([pixel], brightnessRange, contrastRange);
      expect(result[0]).toBeCloseTo(expected, 10);
    });
  });

  // --------------------------------------------------------------------------
  // RANDOM CROP
  // --------------------------------------------------------------------------

  describe('applyRandomCrop', () => {
    it('computes crop dimensions from ratio', () => {
      vi.spyOn(Math, 'random').mockReturnValue(0);
      const crop = service.applyRandomCrop(100, 200, 0.9);
      expect(crop.width).toBe(90);
      expect(crop.height).toBe(180);
      expect(crop.x).toBe(0);
      expect(crop.y).toBe(0);
    });

    it('keeps crop window inside the image bounds', () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.999);
      const crop = service.applyRandomCrop(100, 100, 0.8);
      expect(crop.x + crop.width).toBeLessThanOrEqual(100);
      expect(crop.y + crop.height).toBeLessThanOrEqual(100);
    });
  });

  // --------------------------------------------------------------------------
  // IMAGE AUGMENTATION PARAMS
  // --------------------------------------------------------------------------

  describe('getImageAugmentationParams', () => {
    it('returns empty object when disabled', () => {
      const config: ImageAugmentationConfig = {
        enabled: false,
        colorJitter: true,
        randomCrops: true,
        horizontalFlip: true,
        backgroundRandomization: true,
      };
      expect(service.getImageAugmentationParams(config)).toEqual({});
    });

    it('includes colorJitter with defaults when no ranges specified', () => {
      const config: ImageAugmentationConfig = {
        enabled: true,
        colorJitter: true,
        randomCrops: false,
        horizontalFlip: false,
        backgroundRandomization: false,
      };
      const params = service.getImageAugmentationParams(config);
      expect(params.colorJitter).toEqual({ brightness: 0.1, contrast: 0.1 });
    });

    it('uses provided brightness/contrast ranges', () => {
      const config: ImageAugmentationConfig = {
        enabled: true,
        colorJitter: true,
        randomCrops: false,
        horizontalFlip: false,
        backgroundRandomization: false,
        brightnessRange: 0.3,
        contrastRange: 0.4,
      };
      const params = service.getImageAugmentationParams(config);
      expect(params.colorJitter).toEqual({ brightness: 0.3, contrast: 0.4 });
    });

    it('includes all enabled augmentation params', () => {
      const config: ImageAugmentationConfig = {
        enabled: true,
        colorJitter: false,
        randomCrops: true,
        horizontalFlip: true,
        backgroundRandomization: true,
      };
      const params = service.getImageAugmentationParams(config);
      expect(params.randomCrops).toEqual({ ratio: 0.9 });
      expect(params.horizontalFlip).toEqual({ probability: 0.5 });
      expect(params.backgroundRandomization).toBe(true);
      expect(params.colorJitter).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // PARAPHRASE INSTRUCTION
  // --------------------------------------------------------------------------

  describe('paraphraseInstruction', () => {
    it('returns at most `count` paraphrases', () => {
      const result = service.paraphraseInstruction('Pick up the cube', 3);
      expect(result.length).toBeLessThanOrEqual(3);
    });

    it('never exceeds templates.length - 1', () => {
      const result = service.paraphraseInstruction('Move forward', 100);
      // 8 templates -> max 7
      expect(result.length).toBeLessThanOrEqual(7);
    });

    it('excludes paraphrases identical to the original instruction', () => {
      const original = 'Pick up the cube';
      const result = service.paraphraseInstruction(original, 7);
      expect(result).not.toContain(original);
    });

    it('returns no paraphrases when count is 0', () => {
      const result = service.paraphraseInstruction('Do something', 0);
      expect(result).toEqual([]);
    });
  });

  // --------------------------------------------------------------------------
  // SKILL CHAINING
  // --------------------------------------------------------------------------

  describe('chainSkillInstructions', () => {
    it('returns empty string for empty list', () => {
      expect(service.chainSkillInstructions([])).toBe('');
    });

    it('returns the single instruction unchanged', () => {
      expect(service.chainSkillInstructions(['Pick up the cube'])).toBe('Pick up the cube');
    });

    it('chains two instructions with First/finally', () => {
      const result = service.chainSkillInstructions(['Open the gripper', 'Close the gripper']);
      expect(result).toBe('First, open the gripper, finally, close the gripper');
    });

    it('uses then for middle instructions', () => {
      const result = service.chainSkillInstructions(['Grab', 'Lift', 'Place']);
      expect(result).toBe('First, grab, then lift, finally, place');
    });
  });

  // --------------------------------------------------------------------------
  // DIVERSITY SCORE
  // --------------------------------------------------------------------------

  describe('computeDiversityScore', () => {
    it('returns 0 for empty or single-element lists', () => {
      expect(service.computeDiversityScore([])).toBe(0);
      expect(service.computeDiversityScore(['only one'])).toBe(0);
    });

    it('returns 0 uniqueRatio contribution when all instructions identical', () => {
      // unique=1/2 => 0.5; vocab: words all identical => unique/total
      const result = service.computeDiversityScore(['pick the cube', 'pick the cube']);
      // uniqueRatio = 1/2 = 0.5
      // words (len>2): ['pick','the','cube','pick','the','cube'] -> 'the' filtered? len 3 keeps it
      // unique words: pick,the,cube = 3 ; total = 6 ; vocab = 0.5
      // score = (0.5 + 0.5)/2 = 0.5
      expect(result).toBeCloseTo(0.5, 10);
    });

    it('returns higher score for diverse instructions than identical ones', () => {
      const diverse = service.computeDiversityScore([
        'pick the red cube',
        'place blue sphere down',
      ]);
      const identical = service.computeDiversityScore(['same task here', 'same task here']);
      expect(diverse).toBeGreaterThan(identical);
    });

    it('is bounded in [0, 1]', () => {
      const result = service.computeDiversityScore(['alpha beta', 'gamma delta', 'epsilon zeta']);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(1);
    });
  });

  // --------------------------------------------------------------------------
  // AUGMENT LANGUAGE
  // --------------------------------------------------------------------------

  describe('augmentLanguage', () => {
    it('returns instructions unchanged with no augmentations when disabled', () => {
      const instructions = ['Pick up the cube'];
      const config: LanguageAugmentationConfig = {
        enabled: false,
        paraphrasesPerInstruction: 3,
        useLLM: false,
        enableSkillChaining: false,
      };
      const result = service.augmentLanguage(instructions, config);
      expect(result.instructions).toBe(instructions);
      expect(result.augmentationsApplied).toEqual([]);
    });

    it('adds paraphrases and keeps originals when enabled', () => {
      const config: LanguageAugmentationConfig = {
        enabled: true,
        paraphrasesPerInstruction: 3,
        useLLM: false,
        enableSkillChaining: false,
      };
      const result = service.augmentLanguage(['Pick up the cube'], config);
      // originals preserved
      expect(result.instructions[0]).toBe('Pick up the cube');
      // at least the original plus some paraphrases
      expect(result.instructions.length).toBeGreaterThanOrEqual(1);
      expect(result.augmentationsApplied).toContain('paraphrases_3');
    });

    it('does not paraphrase when paraphrasesPerInstruction is 0', () => {
      const config: LanguageAugmentationConfig = {
        enabled: true,
        paraphrasesPerInstruction: 0,
        useLLM: false,
        enableSkillChaining: false,
      };
      const result = service.augmentLanguage(['Pick up the cube'], config);
      expect(result.instructions).toEqual(['Pick up the cube']);
      expect(result.augmentationsApplied).toEqual([]);
    });
  });

  // --------------------------------------------------------------------------
  // FULL PIPELINE
  // --------------------------------------------------------------------------

  describe('runAugmentationPipeline', () => {
    const baseConfig: AugmentationConfig = {
      action: { enabled: true, noiseScale: 0.05 },
      image: {
        enabled: true,
        colorJitter: true,
        randomCrops: false,
        horizontalFlip: false,
        backgroundRandomization: false,
      },
      language: {
        enabled: false,
        paraphrasesPerInstruction: 3,
        useLLM: false,
        enableSkillChaining: false,
      },
    };

    beforeEach(() => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
    });

    it('produces a result with original/augmented counts', () => {
      const result = service.runAugmentationPipeline(
        'ds-1',
        [
          { actions: [[1], [2]] },
          { actions: [[3], [4]] },
        ],
        baseConfig,
      );
      expect(result.datasetId).toBe('ds-1');
      expect(result.originalCount).toBe(2);
      // no language augmentation -> augmentedCount equals original
      expect(result.augmentedCount).toBe(2);
      expect(result.config).toBe(baseConfig);
      expect(typeof result.processingTime).toBe('number');
    });

    it('counts action augmentations per trajectory', () => {
      const result = service.runAugmentationPipeline(
        'ds-2',
        [{ actions: [[1]] }, { actions: [[2]] }],
        baseConfig,
      );
      expect(result.actionAugmentations).toBe(2);
    });

    it('counts image augmentations when image config produces params', () => {
      const result = service.runAugmentationPipeline(
        'ds-3',
        [{ actions: [[1]] }],
        baseConfig,
      );
      expect(result.imageAugmentations).toBe(1);
    });

    it('does not count image augmentation when image disabled', () => {
      const config: AugmentationConfig = {
        ...baseConfig,
        image: { ...baseConfig.image, enabled: false },
      };
      const result = service.runAugmentationPipeline('ds-4', [{ actions: [[1]] }], config);
      expect(result.imageAugmentations).toBe(0);
    });

    it('generates extra trajectories from language augmentation', () => {
      const config: AugmentationConfig = {
        ...baseConfig,
        language: {
          enabled: true,
          paraphrasesPerInstruction: 5,
          useLLM: false,
          enableSkillChaining: false,
        },
      };
      const result = service.runAugmentationPipeline(
        'ds-5',
        [{ actions: [[1]], instruction: 'Pick up the cube' }],
        config,
      );
      // augmentedCount > originalCount due to paraphrase-derived trajectories
      expect(result.augmentedCount).toBeGreaterThan(result.originalCount);
      expect(result.languageAugmentations).toBeGreaterThan(0);
    });

    it('emits augmentation:completed event with the result', () => {
      const listener = vi.fn();
      service.once('augmentation:completed', listener);
      const result = service.runAugmentationPipeline('ds-6', [{ actions: [[1]] }], baseConfig);
      expect(listener).toHaveBeenCalledTimes(1);
      const event = listener.mock.calls[0][0];
      expect(event.type).toBe('augmentation:completed');
      expect(event.datasetId).toBe('ds-6');
      expect(event.result).toBe(result);
    });

    it('emits the generic augmentation:event channel too', () => {
      const listener = vi.fn();
      service.once('augmentation:event', listener);
      service.runAugmentationPipeline('ds-7', [{ actions: [[1]] }], baseConfig);
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('handles empty trajectory list', () => {
      const result = service.runAugmentationPipeline('ds-8', [], baseConfig);
      expect(result.originalCount).toBe(0);
      expect(result.augmentedCount).toBe(0);
      expect(result.actionAugmentations).toBe(0);
    });
  });
});
