/**
 * @file DataAugmentationService.ts
 * @description Service for data augmentation including action, image, and language augmentation
 * @feature datasets
 */

import { EventEmitter } from 'events';
import type {
  AugmentationConfig,
  AugmentationResult,
  ActionAugmentationConfig,
  ImageAugmentationConfig,
  LanguageAugmentationConfig,
  CurationEvent,
  DEFAULT_AUGMENTATION_CONFIG,
} from '../types/curation.types.js';

// ============================================================================
// DATA AUGMENTATION SERVICE
// ============================================================================

/**
 * Service for dataset augmentation operations
 */
export class DataAugmentationService extends EventEmitter {
  private static instance: DataAugmentationService;

  private constructor() {
    super();
  }

  /**
   * Get singleton instance
   */
  static getInstance(): DataAugmentationService {
    if (!DataAugmentationService.instance) {
      DataAugmentationService.instance = new DataAugmentationService();
    }
    return DataAugmentationService.instance;
  }

  // ============================================================================
  // ACTION AUGMENTATION (MimicGen-style)
  // ============================================================================

  /**
   * Add Gaussian noise to trajectory actions
   */
  addGaussianNoise(
    actions: number[][],
    scale: number = 0.05
  ): number[][] {
    return actions.map((action) =>
      action.map((val) => val + this.gaussianRandom() * scale)
    );
  }

  /**
   * Apply temporal jitter to trajectory
   */
  applyTemporalJitter(
    trajectory: { timestamp: number; action: number[] }[],
    maxJitterMs: number = 10
  ): { timestamp: number; action: number[] }[] {
    return trajectory.map((frame) => ({
      ...frame,
      timestamp: frame.timestamp + (Math.random() - 0.5) * 2 * maxJitterMs,
    }));
  }

  /**
   * Interpolate actions for smoother trajectory
   */
  interpolateActions(
    actions: number[][],
    factor: number = 2
  ): number[][] {
    if (actions.length < 2 || factor < 1) {
      return actions;
    }

    const result: number[][] = [actions[0]];

    for (let i = 1; i < actions.length; i++) {
      // Add interpolated points
      for (let j = 1; j < factor; j++) {
        const t = j / factor;
        const interpolated = actions[i - 1].map(
          (val, idx) => val + t * (actions[i][idx] - val)
        );
        result.push(interpolated);
      }
      result.push(actions[i]);
    }

    return result;
  }

  /**
   * Generate Gaussian random number using Box-Muller transform
   */
  private gaussianRandom(): number {
    let u = 0,
      v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  }

  /**
   * Apply action augmentation pipeline
   */
  augmentActions(
    actions: number[][],
    config: ActionAugmentationConfig
  ): { actions: number[][]; augmentationsApplied: string[] } {
    if (!config.enabled) {
      return { actions, augmentationsApplied: [] };
    }

    let augmented = actions;
    const augmentationsApplied: string[] = [];

    // Apply Gaussian noise
    if (config.noiseScale > 0) {
      augmented = this.addGaussianNoise(augmented, config.noiseScale);
      augmentationsApplied.push(`gaussian_noise_${config.noiseScale}`);
    }

    // Apply interpolation if specified
    if (config.interpolationFactor && config.interpolationFactor > 1) {
      augmented = this.interpolateActions(augmented, config.interpolationFactor);
      augmentationsApplied.push(`interpolation_${config.interpolationFactor}x`);
    }

    return { actions: augmented, augmentationsApplied };
  }

  // ============================================================================
  // IMAGE AUGMENTATION
  // ============================================================================

  /**
   * Apply color jitter to image data (placeholder)
   * In production, this would use a proper image processing library
   */
  applyColorJitter(
    imageData: number[],
    brightnessRange: number = 0.1,
    contrastRange: number = 0.1
  ): number[] {
    // Placeholder: actual implementation would modify pixel values
    const brightness = 1 + (Math.random() - 0.5) * 2 * brightnessRange;
    const contrast = 1 + (Math.random() - 0.5) * 2 * contrastRange;

    return imageData.map((pixel) => {
      // Apply brightness and contrast
      let value = pixel * contrast;
      value = value + (brightness - 1) * 128;
      return Math.max(0, Math.min(255, value));
    });
  }

  /**
   * Apply random crop (placeholder)
   */
  applyRandomCrop(
    imageWidth: number,
    imageHeight: number,
    cropRatio: number = 0.9
  ): { x: number; y: number; width: number; height: number } {
    const cropWidth = Math.floor(imageWidth * cropRatio);
    const cropHeight = Math.floor(imageHeight * cropRatio);

    const maxX = imageWidth - cropWidth;
    const maxY = imageHeight - cropHeight;

    return {
      x: Math.floor(Math.random() * maxX),
      y: Math.floor(Math.random() * maxY),
      width: cropWidth,
      height: cropHeight,
    };
  }

  /**
   * Get image augmentation parameters
   */
  getImageAugmentationParams(
    config: ImageAugmentationConfig
  ): Record<string, unknown> {
    if (!config.enabled) {
      return {};
    }

    const params: Record<string, unknown> = {};

    if (config.colorJitter) {
      params.colorJitter = {
        brightness: config.brightnessRange ?? 0.1,
        contrast: config.contrastRange ?? 0.1,
      };
    }

    if (config.randomCrops) {
      params.randomCrops = { ratio: 0.9 };
    }

    if (config.horizontalFlip) {
      params.horizontalFlip = { probability: 0.5 };
    }

    if (config.backgroundRandomization) {
      params.backgroundRandomization = true;
    }

    return params;
  }

  // ============================================================================
  // LANGUAGE AUGMENTATION
  // ============================================================================

  /**
   * Generate paraphrases of an instruction (simple template-based)
   * In production, this would use an LLM
   */
  paraphraseInstruction(
    instruction: string,
    count: number = 3
  ): string[] {
    const templates = [
      (s: string) => s,
      (s: string) => `Please ${s.toLowerCase()}`,
      (s: string) => `${s}`,
      (s: string) => `Can you ${s.toLowerCase().replace(/^(please )?/, '')}`,
      (s: string) => `I need you to ${s.toLowerCase().replace(/^(please )?/, '')}`,
      (s: string) => `Robot, ${s.toLowerCase()}`,
      (s: string) => `Execute: ${s}`,
      (s: string) => `Your task: ${s.toLowerCase()}`,
    ];

    const paraphrases: string[] = [];
    const shuffled = [...templates].sort(() => Math.random() - 0.5);

    for (let i = 0; i < Math.min(count, templates.length - 1); i++) {
      const paraphrase = shuffled[i + 1](instruction);
      if (paraphrase !== instruction) {
        paraphrases.push(paraphrase);
      }
    }

    return paraphrases;
  }

  /**
   * Chain skill instructions for complex tasks
   */
  chainSkillInstructions(
    primitiveInstructions: string[]
  ): string {
    if (primitiveInstructions.length === 0) {
      return '';
    }

    if (primitiveInstructions.length === 1) {
      return primitiveInstructions[0];
    }

    // Simple chaining with "then"
    const steps = primitiveInstructions.map((instr, i) => {
      if (i === 0) {
        return `First, ${instr.toLowerCase()}`;
      } else if (i === primitiveInstructions.length - 1) {
        return `finally, ${instr.toLowerCase()}`;
      } else {
        return `then ${instr.toLowerCase()}`;
      }
    });

    return steps.join(', ');
  }

  /**
   * Compute instruction diversity score
   */
  computeDiversityScore(instructions: string[]): number {
    if (instructions.length === 0) return 0;
    if (instructions.length === 1) return 0;

    // Simple diversity: ratio of unique instructions
    const unique = new Set(instructions.map((i) => i.toLowerCase().trim()));
    const uniqueRatio = unique.size / instructions.length;

    // Vocabulary diversity: unique words
    const allWords = instructions
      .flatMap((i) => i.toLowerCase().split(/\s+/))
      .filter((w) => w.length > 2);
    const uniqueWords = new Set(allWords);
    const vocabRatio = uniqueWords.size / Math.max(1, allWords.length);

    // Combined score
    return (uniqueRatio + vocabRatio) / 2;
  }

  /**
   * Apply language augmentation pipeline
   */
  augmentLanguage(
    instructions: string[],
    config: LanguageAugmentationConfig
  ): { instructions: string[]; augmentationsApplied: string[] } {
    if (!config.enabled) {
      return { instructions, augmentationsApplied: [] };
    }

    const augmented: string[] = [...instructions];
    const augmentationsApplied: string[] = [];

    // Generate paraphrases
    if (config.paraphrasesPerInstruction > 0) {
      for (const instruction of instructions) {
        const paraphrases = this.paraphraseInstruction(
          instruction,
          config.paraphrasesPerInstruction
        );
        augmented.push(...paraphrases);
      }
      augmentationsApplied.push(`paraphrases_${config.paraphrasesPerInstruction}`);
    }

    return { instructions: augmented, augmentationsApplied };
  }

  // ============================================================================
  // FULL AUGMENTATION PIPELINE
  // ============================================================================

  /**
   * Run full augmentation pipeline on a dataset
   */
  runAugmentationPipeline(
    datasetId: string,
    trajectories: Array<{
      actions: number[][];
      instruction?: string;
      imageData?: number[];
    }>,
    config: AugmentationConfig = {
      action: { enabled: true, noiseScale: 0.05 },
      image: { enabled: true, colorJitter: true, randomCrops: false, horizontalFlip: false, backgroundRandomization: false },
      language: { enabled: false, paraphrasesPerInstruction: 3, useLLM: false, enableSkillChaining: false },
    }
  ): AugmentationResult {
    const startTime = Date.now();
    let actionAugmentations = 0;
    let imageAugmentations = 0;
    let languageAugmentations = 0;

    const augmentedTrajectories: typeof trajectories = [];

    for (const traj of trajectories) {
      // Action augmentation
      const { actions, augmentationsApplied: actionAugs } = this.augmentActions(
        traj.actions,
        config.action
      );
      if (actionAugs.length > 0) {
        actionAugmentations++;
      }

      // Image augmentation (just get params, actual processing is elsewhere)
      const imageParams = this.getImageAugmentationParams(config.image);
      if (Object.keys(imageParams).length > 0) {
        imageAugmentations++;
      }

      // Language augmentation
      let instructions: string[] = [];
      if (traj.instruction) {
        const { instructions: langInstructions, augmentationsApplied: langAugs } =
          this.augmentLanguage([traj.instruction], config.language);
        instructions = langInstructions;
        if (langAugs.length > 0) {
          languageAugmentations += langInstructions.length - 1;
        }
      }

      // Original trajectory with augmented actions
      augmentedTrajectories.push({
        ...traj,
        actions,
      });

      // Additional trajectories from language augmentation
      if (instructions.length > 1) {
        for (let i = 1; i < instructions.length; i++) {
          augmentedTrajectories.push({
            ...traj,
            actions,
            instruction: instructions[i],
          });
        }
      }
    }

    const result: AugmentationResult = {
      datasetId,
      originalCount: trajectories.length,
      augmentedCount: augmentedTrajectories.length,
      actionAugmentations,
      imageAugmentations,
      languageAugmentations,
      processingTime: Date.now() - startTime,
      config,
    };

    this.emitEvent({
      type: 'augmentation:completed',
      datasetId,
      result,
      timestamp: new Date(),
    });

    return result;
  }

  // ============================================================================
  // EVENT HANDLING
  // ============================================================================

  private emitEvent(event: CurationEvent): void {
    this.emit('augmentation:event', event);
    this.emit(event.type, event);
  }
}

// ============================================================================
// SINGLETON EXPORT
// ============================================================================

export const dataAugmentationService = DataAugmentationService.getInstance();
