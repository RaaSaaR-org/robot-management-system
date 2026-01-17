/**
 * @file federated.types.ts
 * @description Type definitions for Fleet Learning / Federated Learning
 * @feature fleet
 */

// ============================================================================
// ROUND STATUS TYPES
// ============================================================================

/**
 * Federated round status
 */
export type FederatedRoundStatus =
  | 'created'
  | 'selecting'
  | 'distributing'
  | 'training'
  | 'collecting'
  | 'aggregating'
  | 'completed'
  | 'failed'
  | 'cancelled';

/**
 * Participant status
 */
export type ParticipantStatus =
  | 'selected'
  | 'model_received'
  | 'training'
  | 'uploaded'
  | 'failed'
  | 'timeout'
  | 'excluded';

// ============================================================================
// AGGREGATION TYPES
// ============================================================================

/**
 * Aggregation methods
 */
export type AggregationMethod = 'fedavg' | 'fedprox' | 'scaffold';

/**
 * Participant selection strategy
 */
export type SelectionStrategy = 'random' | 'round_robin' | 'performance_based' | 'uncertainty_based';

// ============================================================================
// ROUND CONFIGURATION
// ============================================================================

/**
 * Federated round configuration
 */
export interface FederatedRoundConfig {
  /** Minimum participants required */
  minParticipants: number;
  /** Maximum participants allowed */
  maxParticipants: number;
  /** Timeout for participant training (seconds) */
  trainingTimeout: number;
  /** Timeout for model upload (seconds) */
  uploadTimeout: number;
  /** Aggregation method */
  aggregationMethod: AggregationMethod;
  /** Participant selection strategy */
  selectionStrategy: SelectionStrategy;
  /** Differential privacy epsilon (null = no DP) */
  privacyEpsilon?: number;
  /** Local training epochs */
  localEpochs: number;
  /** Local learning rate */
  localLearningRate: number;
  /** Minimum local samples required */
  minLocalSamples: number;
  /** Whether to use secure aggregation */
  secureAggregation: boolean;
}

/**
 * Default round configuration
 */
export const DEFAULT_ROUND_CONFIG: FederatedRoundConfig = {
  minParticipants: 3,
  maxParticipants: 50,
  trainingTimeout: 3600, // 1 hour
  uploadTimeout: 600, // 10 minutes
  aggregationMethod: 'fedavg',
  selectionStrategy: 'random',
  localEpochs: 1,
  localLearningRate: 0.001,
  minLocalSamples: 10,
  secureAggregation: false,
};

// ============================================================================
// ROUND TYPES
// ============================================================================

/**
 * Federated learning round
 */
export interface FederatedRound {
  id: string;
  status: FederatedRoundStatus;
  globalModelVersion: string;
  newModelVersion?: string;
  config: FederatedRoundConfig;
  participantCount: number;
  completedParticipants: number;
  failedParticipants: number;
  totalLocalSamples: number;
  startedAt?: Date;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  createdBy?: string;
  errorMessage?: string;
  metrics?: RoundMetrics;
}

/**
 * Round metrics
 */
export interface RoundMetrics {
  /** Average local loss before aggregation */
  avgLocalLoss?: number;
  /** Loss improvement after aggregation */
  lossImprovement?: number;
  /** Convergence metric */
  convergenceScore?: number;
  /** Time spent in each phase (seconds) */
  phaseDurations: {
    selection?: number;
    distribution?: number;
    training?: number;
    collection?: number;
    aggregation?: number;
  };
}

// ============================================================================
// PARTICIPANT TYPES
// ============================================================================

/**
 * Federated round participant
 */
export interface FederatedParticipant {
  id: string;
  roundId: string;
  robotId: string;
  status: ParticipantStatus;
  localSamples?: number;
  localEpochs?: number;
  localLoss?: number;
  modelReceivedAt?: Date;
  trainingStartedAt?: Date;
  trainingCompletedAt?: Date;
  uploadedAt?: Date;
  failureReason?: string;
  /** Weight in aggregation (typically local samples / total samples) */
  aggregationWeight?: number;
  /** Privacy budget consumed this round */
  privacyBudgetUsed?: number;
}

/**
 * Model update from participant
 */
export interface ModelUpdate {
  participantId: string;
  robotId: string;
  roundId: string;
  localSamples: number;
  localLoss: number;
  /** Serialized model delta (weights difference) */
  modelDelta: Buffer | string;
  /** Hash of the update for verification */
  updateHash: string;
  uploadedAt: Date;
  /** DP noise added */
  dpNoiseScale?: number;
}

// ============================================================================
// PRIVACY TYPES
// ============================================================================

/**
 * Robot privacy budget
 */
export interface RobotPrivacyBudget {
  robotId: string;
  totalEpsilon: number;
  usedEpsilon: number;
  remainingEpsilon: number;
  lastUpdated: Date;
  roundsParticipated: number;
}

/**
 * Differential privacy config
 */
export interface DifferentialPrivacyConfig {
  /** Privacy budget (epsilon) */
  epsilon: number;
  /** Noise multiplier */
  noiseMultiplier: number;
  /** Max gradient norm for clipping */
  maxGradNorm: number;
  /** Delta parameter (typically 1/n) */
  delta?: number;
}

/**
 * Default DP config
 */
export const DEFAULT_DP_CONFIG: DifferentialPrivacyConfig = {
  epsilon: 1.0,
  noiseMultiplier: 1.1,
  maxGradNorm: 1.0,
  delta: 1e-5,
};

// ============================================================================
// ROHE (RETURN ON HUMAN EFFORT) TYPES
// ============================================================================

/**
 * ROHE metrics
 */
export interface ROHEMetrics {
  /** Time period for metrics */
  period: { start: Date; end: Date };
  /** Total human interventions in period */
  totalInterventions: number;
  /** Performance improvement (0-1 scale) */
  performanceImprovement: number;
  /** Improvement per intervention */
  improvementPerIntervention: number;
  /** Interventions by robot */
  byRobot: Record<string, {
    interventions: number;
    improvement: number;
    rohe: number;
  }>;
  /** Interventions by task */
  byTask: Record<string, {
    interventions: number;
    improvement: number;
    rohe: number;
  }>;
}

/**
 * Intervention record
 */
export interface InterventionRecord {
  id: string;
  robotId: string;
  task: string;
  timestamp: Date;
  interventionType: 'correction' | 'demonstration' | 'abort';
  confidenceBefore?: number;
  confidenceAfter?: number;
  description?: string;
}

// ============================================================================
// FEDAVG AGGREGATION TYPES
// ============================================================================

/**
 * FedAvg aggregation input
 */
export interface FedAvgInput {
  participantId: string;
  weight: number;
  modelDelta: number[];
}

/**
 * Aggregation result
 */
export interface AggregationResult {
  roundId: string;
  aggregatedDelta: number[];
  participantCount: number;
  totalSamples: number;
  timestamp: Date;
}

// ============================================================================
// API REQUEST/RESPONSE TYPES
// ============================================================================

/**
 * Create round request
 */
export interface CreateFederatedRoundRequest {
  globalModelVersion: string;
  config?: Partial<FederatedRoundConfig>;
}

/**
 * Select participants request
 */
export interface SelectParticipantsRequest {
  robotIds?: string[];
  count?: number;
  strategy?: SelectionStrategy;
  minLocalSamples?: number;
}

/**
 * Submit model update request
 */
export interface SubmitModelUpdateRequest {
  participantId: string;
  robotId: string;
  localSamples: number;
  localLoss: number;
  modelDelta: string; // Base64 encoded
  updateHash: string;
  dpNoiseScale?: number;
}

/**
 * Round summary response
 */
export interface RoundSummaryResponse {
  round: FederatedRound;
  participants: FederatedParticipant[];
  metrics?: RoundMetrics;
}

/**
 * List rounds params
 */
export interface ListFederatedRoundsParams {
  status?: FederatedRoundStatus;
  globalModelVersion?: string;
  limit?: number;
  offset?: number;
}

/**
 * ROHE request params
 */
export interface GetROHEParams {
  startDate?: Date;
  endDate?: Date;
  robotId?: string;
  task?: string;
}

// ============================================================================
// EVENT TYPES
// ============================================================================

/**
 * Federated learning event types
 */
export type FederatedEventType =
  | 'round:created'
  | 'round:selecting'
  | 'round:distributing'
  | 'round:training'
  | 'round:collecting'
  | 'round:aggregating'
  | 'round:completed'
  | 'round:failed'
  | 'participant:selected'
  | 'participant:model_received'
  | 'participant:training'
  | 'participant:uploaded'
  | 'participant:failed'
  | 'intervention:recorded';

/**
 * Federated learning event
 */
export interface FederatedEvent {
  type: FederatedEventType;
  roundId?: string;
  participantId?: string;
  robotId?: string;
  data?: unknown;
  timestamp: Date;
}
