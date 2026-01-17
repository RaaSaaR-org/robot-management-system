/**
 * @file curation.types.ts
 * @description Type definitions for Data Curation & Augmentation Pipeline
 * @feature datasets
 */

// ============================================================================
// TASK TAXONOMY TYPES
// ============================================================================

/**
 * Task taxonomy levels
 */
export type TaskTaxonomyLevel = 'primitive' | 'composed' | 'long_horizon';

/**
 * Task taxonomy node
 */
export interface TaskTaxonomy {
  id: string;
  name: string;
  level: TaskTaxonomyLevel;
  description?: string;
  parent?: string;
  children?: string[];
  examples?: string[];
}

/**
 * Predefined task taxonomy
 */
export const DEFAULT_TASK_TAXONOMY: TaskTaxonomy[] = [
  // Primitive tasks
  { id: 'grasp', name: 'Grasp Object', level: 'primitive', children: [] },
  { id: 'release', name: 'Release Object', level: 'primitive', children: [] },
  { id: 'move_to', name: 'Move to Position', level: 'primitive', children: [] },
  { id: 'rotate', name: 'Rotate', level: 'primitive', children: [] },
  { id: 'push', name: 'Push', level: 'primitive', children: [] },
  { id: 'pull', name: 'Pull', level: 'primitive', children: [] },
  // Composed tasks
  { id: 'pick_place', name: 'Pick and Place', level: 'composed', parent: undefined, children: ['grasp', 'move_to', 'release'] },
  { id: 'stack', name: 'Stack Objects', level: 'composed', children: ['grasp', 'move_to', 'release'] },
  { id: 'pour', name: 'Pour', level: 'composed', children: ['grasp', 'rotate', 'release'] },
  // Long-horizon tasks
  { id: 'clean_table', name: 'Clean Table', level: 'long_horizon', children: ['pick_place', 'stack'] },
  { id: 'set_table', name: 'Set Table', level: 'long_horizon', children: ['pick_place'] },
  { id: 'make_coffee', name: 'Make Coffee', level: 'long_horizon', children: ['grasp', 'pour', 'pick_place'] },
];

// ============================================================================
// DISTRIBUTION ANALYSIS TYPES
// ============================================================================

/**
 * Distribution analysis result
 */
export interface DistributionAnalysis {
  datasetId: string;
  byTask: Record<string, number>;
  byEnvironment: Record<string, number>;
  byTaxonomyLevel: Record<TaskTaxonomyLevel, number>;
  byRobotType: Record<string, number>;
  imbalanceScore: number; // 0 = balanced, 1 = highly imbalanced
  totalTrajectories: number;
  uniqueTasks: number;
  uniqueEnvironments: number;
  recommendations: string[];
}

/**
 * Sampling weight for balanced training
 */
export interface SamplingWeight {
  category: string;
  originalCount: number;
  targetCount: number;
  weight: number;
}

/**
 * Re-Mix style balancing config
 */
export interface BalancingConfig {
  method: 'uniform' | 'sqrt' | 'dro'; // DRO = Distributionally Robust Optimization
  targetSize?: number; // Target number of trajectories
  minSamplesPerCategory?: number;
  maxSamplesPerCategory?: number;
  groupBy: 'task' | 'environment' | 'taxonomy_level';
}

// ============================================================================
// CURATION TYPES
// ============================================================================

/**
 * Curation pipeline configuration
 */
export interface CurationConfig {
  /** Minimum quality score to include */
  minQualityScore?: number;
  /** Similarity threshold for deduplication (0-1) */
  deduplicationThreshold?: number;
  /** Whether to identify potentially harmful demos */
  identifyHarmful?: boolean;
  /** Apply hindsight relabeling */
  hindsightRelabeling?: boolean;
}

/**
 * Default curation config
 */
export const DEFAULT_CURATION_CONFIG: CurationConfig = {
  minQualityScore: 50,
  deduplicationThreshold: 0.95,
  identifyHarmful: true,
  hindsightRelabeling: false,
};

/**
 * Curation result
 */
export interface CurationResult {
  datasetId: string;
  originalCount: number;
  filteredCount: number;
  removedLowQuality: number;
  removedDuplicates: number;
  flaggedHarmful: number;
  relabeled: number;
  processingTime: number; // ms
  config: CurationConfig;
  removedIndices: number[];
  flaggedIndices: number[];
}

/**
 * Duplicate detection result
 */
export interface DuplicateGroup {
  representativeIndex: number;
  duplicateIndices: number[];
  similarityScore: number;
}

// ============================================================================
// AUGMENTATION TYPES
// ============================================================================

/**
 * Action augmentation config
 */
export interface ActionAugmentationConfig {
  enabled: boolean;
  /** Gaussian noise scale (default 0.05) */
  noiseScale: number;
  /** Max temporal jitter in ms */
  temporalJitterMs?: number;
  /** Interpolation factor for smoothing */
  interpolationFactor?: number;
}

/**
 * Image augmentation config
 */
export interface ImageAugmentationConfig {
  enabled: boolean;
  colorJitter: boolean;
  randomCrops: boolean;
  horizontalFlip: boolean;
  backgroundRandomization: boolean;
  /** Brightness adjustment range [-x, x] */
  brightnessRange?: number;
  /** Contrast adjustment range [1-x, 1+x] */
  contrastRange?: number;
}

/**
 * Language augmentation config
 */
export interface LanguageAugmentationConfig {
  enabled: boolean;
  /** Number of paraphrases to generate per instruction */
  paraphrasesPerInstruction: number;
  /** Use LLM for paraphrasing */
  useLLM: boolean;
  /** Skill chaining for complex instructions */
  enableSkillChaining: boolean;
}

/**
 * Complete augmentation config
 */
export interface AugmentationConfig {
  action: ActionAugmentationConfig;
  image: ImageAugmentationConfig;
  language: LanguageAugmentationConfig;
}

/**
 * Default augmentation config
 */
export const DEFAULT_AUGMENTATION_CONFIG: AugmentationConfig = {
  action: {
    enabled: true,
    noiseScale: 0.05,
    temporalJitterMs: 10,
    interpolationFactor: undefined,
  },
  image: {
    enabled: true,
    colorJitter: true,
    randomCrops: false,
    horizontalFlip: false,
    backgroundRandomization: false,
    brightnessRange: 0.1,
    contrastRange: 0.1,
  },
  language: {
    enabled: false,
    paraphrasesPerInstruction: 3,
    useLLM: false,
    enableSkillChaining: false,
  },
};

/**
 * Augmentation result
 */
export interface AugmentationResult {
  datasetId: string;
  originalCount: number;
  augmentedCount: number;
  actionAugmentations: number;
  imageAugmentations: number;
  languageAugmentations: number;
  outputDatasetId?: string;
  processingTime: number;
  config: AugmentationConfig;
}

// ============================================================================
// HINDSIGHT RELABELING TYPES
// ============================================================================

/**
 * Hindsight relabeling config
 */
export interface HindsightRelabelingConfig {
  /** Original goal/instruction */
  originalInstruction: string;
  /** Achieved state description */
  achievedState: string;
  /** New instruction matching achieved state */
  newInstruction: string;
  /** Confidence in relabeling */
  confidence: number;
}

/**
 * Relabeling result
 */
export interface RelabelingResult {
  trajectoryIndex: number;
  originalInstruction: string;
  newInstruction: string;
  reason: string;
}

// ============================================================================
// API REQUEST/RESPONSE TYPES
// ============================================================================

/**
 * Distribution analysis request
 */
export interface AnalyzeDistributionRequest {
  groupBy?: 'task' | 'environment' | 'all';
}

/**
 * Create balanced subset request
 */
export interface CreateBalancedSubsetRequest {
  config: BalancingConfig;
  outputName?: string;
  outputDescription?: string;
}

/**
 * Run curation request
 */
export interface RunCurationRequest {
  config?: Partial<CurationConfig>;
  createNewDataset?: boolean;
  outputName?: string;
}

/**
 * Apply augmentation request
 */
export interface ApplyAugmentationRequest {
  config?: Partial<AugmentationConfig>;
  createNewDataset?: boolean;
  outputName?: string;
}

/**
 * Categorize trajectory request
 */
export interface CategorizeTrajectoryRequest {
  languageInstruction: string;
  actionSequence?: number[][];
}

/**
 * Categorization result
 */
export interface CategorizationResult {
  taxonomyId: string;
  taxonomyName: string;
  level: TaskTaxonomyLevel;
  confidence: number;
  parentTasks?: string[];
}

// ============================================================================
// EVENT TYPES
// ============================================================================

/**
 * Curation event types
 */
export type CurationEventType =
  | 'distribution:analyzed'
  | 'balanced:created'
  | 'curation:started'
  | 'curation:completed'
  | 'augmentation:started'
  | 'augmentation:completed'
  | 'relabeling:completed';

/**
 * Curation event
 */
export interface CurationEvent {
  type: CurationEventType;
  datasetId: string;
  result?: CurationResult | AugmentationResult | DistributionAnalysis;
  timestamp: Date;
}
