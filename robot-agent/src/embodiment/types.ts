/**
 * @file types.ts
 * @description Zod schemas and TypeScript interfaces for embodiment configuration
 * @feature vla
 */

import { z } from 'zod';

// ============================================================================
// ZOD SCHEMAS
// ============================================================================

/**
 * Action normalization configuration for VLA pipeline
 * Transforms raw joint values to normalized [-1, 1] range
 */
export const ActionNormalizationSchema = z.object({
  mean: z.array(z.number()).describe('Mean values for each action dimension'),
  std: z.array(z.number()).min(1).describe('Standard deviation values for each action dimension'),
});

/**
 * Proprioception configuration for VLA observations
 */
export const ProprioceptionConfigSchema = z.object({
  dim: z.number().int().positive().describe('Total proprioception dimension'),
  joint_names: z.array(z.string()).describe('Ordered list of joint names'),
});

/**
 * Camera specification for VLA observations
 */
export const CameraSpecSchema = z.object({
  name: z.string().describe('Camera identifier'),
  resolution: z.tuple([z.number().int().positive(), z.number().int().positive()])
    .describe('Width x Height in pixels'),
  fov: z.number().positive().optional().describe('Field of view in degrees'),
  position: z.tuple([z.number(), z.number(), z.number()]).optional()
    .describe('Camera position relative to robot base [x, y, z]'),
  enabled: z.boolean().default(true).describe('Whether camera is active'),
});

/**
 * Joint position, velocity, and torque limits
 */
export const JointLimitsSchema = z.object({
  position: z.object({
    lower: z.array(z.number()).describe('Lower position limits in radians'),
    upper: z.array(z.number()).describe('Upper position limits in radians'),
  }).optional(),
  velocity: z.array(z.number()).optional().describe('Max velocity limits in rad/s'),
  torque: z.array(z.number()).optional().describe('Max torque limits in Nm'),
});

/**
 * Workspace boundary definition
 */
export const WorkspaceBoundsSchema = z.object({
  type: z.enum(['box', 'sphere', 'cylinder']).describe('Boundary shape type'),
  min: z.tuple([z.number(), z.number(), z.number()]).optional()
    .describe('Min bounds for box [x, y, z]'),
  max: z.tuple([z.number(), z.number(), z.number()]).optional()
    .describe('Max bounds for box [x, y, z]'),
  center: z.tuple([z.number(), z.number(), z.number()]).optional()
    .describe('Center for sphere/cylinder'),
  radius: z.number().positive().optional().describe('Radius for sphere/cylinder'),
  height: z.number().positive().optional().describe('Height for cylinder'),
});

/**
 * Safety configuration for the embodiment
 */
export const SafetyConfigSchema = z.object({
  max_speed: z.number().positive().describe('Maximum end-effector speed in m/s'),
  workspace: WorkspaceBoundsSchema.optional().describe('Workspace boundaries'),
  collision_margin: z.number().positive().optional().describe('Safety margin for collision avoidance in meters'),
  force_limit: z.number().positive().optional().describe('Maximum contact force in Newtons'),
});

/**
 * Main embodiment configuration schema
 */
export const EmbodimentConfigSchema = z.object({
  // Identity
  embodiment_tag: z.string().describe('Unique identifier for this embodiment'),
  manufacturer: z.string().describe('Robot manufacturer name'),
  model: z.string().describe('Robot model name'),
  description: z.string().optional().describe('Human-readable description'),

  // Action space
  action: z.object({
    dim: z.number().int().positive().describe('Action space dimension (number of DOFs)'),
    normalization: ActionNormalizationSchema.describe('Normalization parameters for actions'),
  }),

  // Observation space
  proprioception: ProprioceptionConfigSchema.describe('Proprioception configuration'),

  // Camera configuration
  cameras: z.array(CameraSpecSchema).default([]).describe('Camera configurations'),

  // Joint limits
  limits: JointLimitsSchema.optional().describe('Joint limits configuration'),

  // Safety
  safety: SafetyConfigSchema.optional().describe('Safety configuration'),

  // Metadata
  version: z.string().optional().default('1.0.0').describe('Configuration version'),
  created_at: z.string().optional().describe('Creation timestamp'),
  updated_at: z.string().optional().describe('Last update timestamp'),
});

// ============================================================================
// TYPESCRIPT TYPES (inferred from Zod schemas)
// ============================================================================

export type ActionNormalization = z.infer<typeof ActionNormalizationSchema>;
export type ProprioceptionConfig = z.infer<typeof ProprioceptionConfigSchema>;
export type CameraSpec = z.infer<typeof CameraSpecSchema>;
export type JointLimits = z.infer<typeof JointLimitsSchema>;
export type WorkspaceBounds = z.infer<typeof WorkspaceBoundsSchema>;
export type SafetyConfig = z.infer<typeof SafetyConfigSchema>;
export type EmbodimentConfig = z.infer<typeof EmbodimentConfigSchema>;

// ============================================================================
// HELPER TYPES
// ============================================================================

/**
 * Resolution tuple type
 */
export type Resolution = [number, number];

/**
 * Joint command from VLA action
 */
export interface JointCommand {
  name: string;
  position?: number;
  velocity?: number;
  torque?: number;
}

/**
 * Joint state observation
 */
export interface JointState {
  name: string;
  position: number;
  velocity: number;
}

/**
 * Validation result for action dimension checks
 */
export interface ValidationResult {
  valid: boolean;
  expected: number;
  actual: number;
  message?: string;
}

/**
 * Embodiment loader events
 */
export type EmbodimentLoaderEvent =
  | 'embodiment:loaded'
  | 'embodiment:reloaded'
  | 'embodiment:error'
  | 'config:changed';

/**
 * Event data for embodiment events
 */
export interface EmbodimentEventData {
  tag: string;
  config?: EmbodimentConfig;
  error?: Error;
  path?: string;
}

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

/**
 * Validate an embodiment configuration
 * @param config Configuration object to validate
 * @returns Validated configuration or throws error
 */
export function validateEmbodimentConfig(config: unknown): EmbodimentConfig {
  return EmbodimentConfigSchema.parse(config);
}

/**
 * Safe validation that returns error instead of throwing
 * @param config Configuration object to validate
 * @returns Success result with config or error result
 */
export function safeValidateEmbodimentConfig(
  config: unknown
): { success: true; data: EmbodimentConfig } | { success: false; error: z.ZodError } {
  const result = EmbodimentConfigSchema.safeParse(config);
  return result;
}

/**
 * Validate action dimensions match configuration
 * @param action Action array to validate
 * @param config Embodiment configuration
 * @returns Validation result
 */
export function validateActionDimensions(
  action: number[],
  config: EmbodimentConfig
): ValidationResult {
  const expected = config.action.dim;
  const actual = action.length;

  if (actual !== expected) {
    return {
      valid: false,
      expected,
      actual,
      message: `Action dimension mismatch: expected ${expected}, got ${actual}`,
    };
  }

  return { valid: true, expected, actual };
}

/**
 * Validate proprioception dimensions match configuration
 * @param proprioception Proprioception array to validate
 * @param config Embodiment configuration
 * @returns Validation result
 */
export function validateProprioceptionDimensions(
  proprioception: number[],
  config: EmbodimentConfig
): ValidationResult {
  const expected = config.proprioception.dim;
  const actual = proprioception.length;

  if (actual !== expected) {
    return {
      valid: false,
      expected,
      actual,
      message: `Proprioception dimension mismatch: expected ${expected}, got ${actual}`,
    };
  }

  return { valid: true, expected, actual };
}
