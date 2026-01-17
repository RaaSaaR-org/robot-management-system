/**
 * @file active-learning.types.ts
 * @description Type definitions for Active Learning System
 * @feature datasets
 */

// ============================================================================
// PREDICTION LOGGING TYPES
// ============================================================================

/**
 * Logged prediction with confidence
 */
export interface PredictionLog {
  id: string;
  modelId: string;
  robotId: string;
  timestamp: Date;
  inputHash: string;
  taskCategory: string;
  environment: string;
  confidence: number;
  wasCorrect?: boolean;
  metadata?: Record<string, unknown>;
}

/**
 * Create prediction log request
 */
export interface CreatePredictionLogRequest {
  modelId: string;
  robotId: string;
  inputHash: string;
  taskCategory: string;
  environment: string;
  confidence: number;
  wasCorrect?: boolean;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// UNCERTAINTY ANALYSIS TYPES
// ============================================================================

/**
 * Uncertainty metrics for a category
 */
export interface CategoryUncertainty {
  category: string;
  meanUncertainty: number;
  stdUncertainty: number;
  sampleCount: number;
  minConfidence: number;
  maxConfidence: number;
  recentTrend: 'improving' | 'stable' | 'degrading';
}

/**
 * Uncertainty analysis result
 */
export interface UncertaintyAnalysis {
  modelId: string;
  analysisDate: Date;
  byTask: Record<string, CategoryUncertainty>;
  byEnvironment: Record<string, CategoryUncertainty>;
  overallUncertainty: number;
  totalPredictions: number;
  highUncertaintyCount: number;
  highUncertaintyThreshold: number;
}

/**
 * Ensemble disagreement metrics
 */
export interface EpistemicUncertainty {
  modelId: string;
  task: string;
  ensembleDisagreement: number;
  varianceAcrossModels: number;
  sampleCount: number;
}

// ============================================================================
// LEARNING PROGRESS TYPES
// ============================================================================

/**
 * Learning progress metrics
 */
export interface LearningProgress {
  modelId: string;
  task: string;
  environment?: string;
  windowSize: number;
  improvementRate: number;
  currentPerformance: number;
  previousPerformance: number;
  isPlateaued: boolean;
  plateauDuration?: number;
  lastUpdated: Date;
}

/**
 * Model improvement tracking
 */
export interface ImprovementTracker {
  modelId: string;
  periods: {
    startDate: Date;
    endDate: Date;
    performance: number;
    sampleCount: number;
  }[];
  overallTrend: 'improving' | 'stable' | 'degrading';
  improvementRate: number;
}

// ============================================================================
// COLLECTION PRIORITY TYPES
// ============================================================================

/**
 * Target type for data collection
 */
export type CollectionTargetType = 'task' | 'environment' | 'task_environment';

/**
 * Collection priority for a target
 */
export interface CollectionPriority {
  target: string;
  targetType: CollectionTargetType;
  priorityScore: number;
  uncertaintyComponent: number;
  diversityComponent: number;
  progressComponent: number;
  estimatedDemosNeeded: number;
  currentDemoCount: number;
  recommendation: string;
  reasoning: string[];
}

/**
 * Collection priorities response
 */
export interface CollectionPrioritiesResponse {
  modelId: string;
  generatedAt: Date;
  priorities: CollectionPriority[];
  summary: {
    totalTargets: number;
    highPriorityCount: number;
    totalDemosNeeded: number;
    topRecommendation: string;
  };
}

/**
 * Collection target status
 */
export type CollectionTargetStatus = 'active' | 'completed' | 'paused' | 'cancelled';

/**
 * Collection target in database
 */
export interface CollectionTarget {
  id: string;
  targetType: CollectionTargetType;
  targetName: string;
  priorityScore: number;
  estimatedDemos: number;
  collectedDemos: number;
  status: CollectionTargetStatus;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Collection progress tracking
 */
export interface CollectionProgress {
  targetId: string;
  targetName: string;
  targetType: CollectionTargetType;
  recommendedDemos: number;
  collectedDemos: number;
  completionPercentage: number;
  startDate: Date;
  lastCollectionDate?: Date;
  uncertaintyBefore?: number;
  uncertaintyAfter?: number;
  uncertaintyReduction: number;
  isCompleted: boolean;
}

/**
 * Progress summary
 */
export interface ProgressSummary {
  totalTargets: number;
  completedTargets: number;
  activeTargets: number;
  totalDemosCollected: number;
  totalDemosNeeded: number;
  overallProgress: number;
  averageUncertaintyReduction: number;
}

// ============================================================================
// MUSEL-INSPIRED PRIORITY SCORING
// ============================================================================

/**
 * Priority scoring weights
 */
export interface PriorityWeights {
  uncertainty: number;
  diversity: number;
  progress: number;
}

/**
 * Default weights for MUSEL-inspired scoring
 */
export const DEFAULT_PRIORITY_WEIGHTS: PriorityWeights = {
  uncertainty: 0.4,
  diversity: 0.35,
  progress: 0.25,
};

/**
 * Priority scoring config
 */
export interface PriorityScoringConfig {
  weights: PriorityWeights;
  highUncertaintyThreshold: number;
  minSamplesForAnalysis: number;
  plateauThreshold: number;
  recentWindowDays: number;
}

/**
 * Default scoring config
 */
export const DEFAULT_SCORING_CONFIG: PriorityScoringConfig = {
  weights: DEFAULT_PRIORITY_WEIGHTS,
  highUncertaintyThreshold: 0.3,
  minSamplesForAnalysis: 10,
  plateauThreshold: 0.01,
  recentWindowDays: 7,
};

// ============================================================================
// INPUT DIVERSITY TYPES
// ============================================================================

/**
 * Diversity metrics
 */
export interface DiversityMetrics {
  category: string;
  uniqueInputs: number;
  totalInputs: number;
  diversityRatio: number;
  clusterCount: number;
  averageClusterSize: number;
  sparseRegions: string[];
}

/**
 * Overall diversity analysis
 */
export interface DiversityAnalysis {
  modelId: string;
  analysisDate: Date;
  byTask: Record<string, DiversityMetrics>;
  byEnvironment: Record<string, DiversityMetrics>;
  overallDiversityScore: number;
  recommendations: string[];
}

// ============================================================================
// API REQUEST/RESPONSE TYPES
// ============================================================================

/**
 * Log prediction request
 */
export interface LogPredictionRequest {
  modelId: string;
  robotId: string;
  inputHash: string;
  taskCategory: string;
  environment: string;
  confidence: number;
  wasCorrect?: boolean;
  metadata?: Record<string, unknown>;
}

/**
 * Log prediction response
 */
export interface LogPredictionResponse {
  id: string;
  logged: boolean;
  timestamp: Date;
}

/**
 * Get uncertainty request params
 */
export interface GetUncertaintyParams {
  modelId: string;
  groupBy?: 'task' | 'environment' | 'both';
  windowDays?: number;
}

/**
 * Get priorities request params
 */
export interface GetPrioritiesParams {
  modelId?: string;
  limit?: number;
  minPriorityScore?: number;
  targetType?: CollectionTargetType;
}

/**
 * Update progress request
 */
export interface UpdateProgressRequest {
  demosCollected: number;
  uncertaintyAfter?: number;
}

/**
 * Create collection target request
 */
export interface CreateCollectionTargetRequest {
  targetType: CollectionTargetType;
  targetName: string;
  estimatedDemos: number;
  priorityScore?: number;
}

// ============================================================================
// EVENT TYPES
// ============================================================================

/**
 * Active learning event types
 */
export type ActiveLearningEventType =
  | 'prediction:logged'
  | 'uncertainty:analyzed'
  | 'priorities:updated'
  | 'target:created'
  | 'target:completed'
  | 'progress:updated';

/**
 * Active learning event
 */
export interface ActiveLearningEvent {
  type: ActiveLearningEventType;
  modelId?: string;
  targetId?: string;
  data?: unknown;
  timestamp: Date;
}
