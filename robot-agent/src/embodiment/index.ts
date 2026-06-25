/**
 * @file index.ts
 * @description Embodiment configuration system exports
 * @feature vla
 * @status live
 */

// Types and schemas
export {
  // Zod Schemas
  ActionNormalizationSchema,
  ProprioceptionConfigSchema,
  CameraSpecSchema,
  DepthSensorSpecSchema,
  JointLimitsSchema,
  WorkspaceBoundsSchema,
  SafetyConfigSchema,
  EmbodimentConfigSchema,

  // TypeScript types
  type ActionNormalization,
  type ProprioceptionConfig,
  type CameraSpec,
  type DepthSensorSpec,
  type JointLimits,
  type WorkspaceBounds,
  type SafetyConfig,
  type EmbodimentConfig,

  // Helper types
  type Resolution,
  type JointCommand,
  type JointState,
  type ValidationResult,
  type EmbodimentLoaderEvent,
  type EmbodimentEventData,

  // Validation functions
  validateEmbodimentConfig,
  safeValidateEmbodimentConfig,
  validateActionDimensions,
  validateProprioceptionDimensions,
} from './types.js';

// Core components
export { ActionNormalizer } from './normalizer.js';
export { JointMapper } from './joint-mapper.js';
export { CameraConfigManager } from './camera-config.js';
export { DepthSensorManager } from './depth-sensor-config.js';
export {
  EmbodimentLoader,
  type EmbodimentLoaderOptions,
} from './embodiment-loader.js';

// Convenience singleton access
import { EmbodimentLoader } from './embodiment-loader.js';
import { ActionNormalizer } from './normalizer.js';
import { JointMapper } from './joint-mapper.js';
import { CameraConfigManager } from './camera-config.js';
import { DepthSensorManager } from './depth-sensor-config.js';

/**
 * Get the singleton EmbodimentLoader instance.
 *
 * @returns EmbodimentLoader singleton
 */
export function getEmbodimentLoader(): EmbodimentLoader {
  return EmbodimentLoader.getInstance();
}

/**
 * Create a new ActionNormalizer instance.
 *
 * @returns ActionNormalizer instance
 */
export function createActionNormalizer(): ActionNormalizer {
  return new ActionNormalizer();
}

/**
 * Create a new JointMapper instance.
 *
 * @returns JointMapper instance
 */
export function createJointMapper(): JointMapper {
  return new JointMapper();
}

/**
 * Create a new CameraConfigManager instance.
 *
 * @returns CameraConfigManager instance
 */
export function createCameraConfigManager(): CameraConfigManager {
  return new CameraConfigManager();
}

/**
 * Create a new DepthSensorManager instance.
 *
 * @returns DepthSensorManager instance
 */
export function createDepthSensorManager(): DepthSensorManager {
  return new DepthSensorManager();
}
