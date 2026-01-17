/**
 * @file fleetlearning.types.ts
 * @description Type definitions for fleet learning (federated learning) feature
 * @feature fleetlearning
 * @dependencies None
 */

// ============================================================================
// STATUS TYPES
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

/**
 * Aggregation methods
 */
export type AggregationMethod = 'fedavg' | 'fedprox' | 'scaffold';

/**
 * Participant selection strategy
 */
export type SelectionStrategy = 'random' | 'round_robin' | 'performance_based' | 'uncertainty_based';

// ============================================================================
// LABELS AND COLORS
// ============================================================================

export const ROUND_STATUS_LABELS: Record<FederatedRoundStatus, string> = {
  created: 'Created',
  selecting: 'Selecting Participants',
  distributing: 'Distributing Model',
  training: 'Training',
  collecting: 'Collecting Updates',
  aggregating: 'Aggregating',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export const ROUND_STATUS_COLORS: Record<FederatedRoundStatus, 'default' | 'primary' | 'success' | 'warning' | 'destructive'> = {
  created: 'default',
  selecting: 'primary',
  distributing: 'primary',
  training: 'primary',
  collecting: 'primary',
  aggregating: 'primary',
  completed: 'success',
  failed: 'destructive',
  cancelled: 'warning',
};

export const PARTICIPANT_STATUS_LABELS: Record<ParticipantStatus, string> = {
  selected: 'Selected',
  model_received: 'Model Received',
  training: 'Training',
  uploaded: 'Uploaded',
  failed: 'Failed',
  timeout: 'Timeout',
  excluded: 'Excluded',
};

export const AGGREGATION_METHOD_LABELS: Record<AggregationMethod, string> = {
  fedavg: 'FedAvg',
  fedprox: 'FedProx',
  scaffold: 'SCAFFOLD',
};

export const SELECTION_STRATEGY_LABELS: Record<SelectionStrategy, string> = {
  random: 'Random',
  round_robin: 'Round Robin',
  performance_based: 'Performance Based',
  uncertainty_based: 'Uncertainty Based',
};

// ============================================================================
// CONFIGURATION TYPES
// ============================================================================

/**
 * Federated round configuration
 */
export interface FederatedRoundConfig {
  minParticipants: number;
  maxParticipants: number;
  trainingTimeout: number;
  uploadTimeout: number;
  aggregationMethod: AggregationMethod;
  selectionStrategy: SelectionStrategy;
  privacyEpsilon?: number;
  localEpochs: number;
  localLearningRate: number;
  minLocalSamples: number;
  secureAggregation: boolean;
}

export const DEFAULT_ROUND_CONFIG: FederatedRoundConfig = {
  minParticipants: 3,
  maxParticipants: 50,
  trainingTimeout: 3600,
  uploadTimeout: 600,
  aggregationMethod: 'fedavg',
  selectionStrategy: 'random',
  localEpochs: 1,
  localLearningRate: 0.001,
  minLocalSamples: 10,
  secureAggregation: false,
};

// ============================================================================
// ENTITY TYPES
// ============================================================================

/**
 * Round metrics
 */
export interface RoundMetrics {
  avgLocalLoss?: number;
  lossImprovement?: number;
  convergenceScore?: number;
  phaseDurations: {
    selection?: number;
    distribution?: number;
    training?: number;
    collection?: number;
    aggregation?: number;
  };
}

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
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  errorMessage?: string;
  metrics?: RoundMetrics;
}

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
  modelReceivedAt?: string;
  trainingStartedAt?: string;
  trainingCompletedAt?: string;
  uploadedAt?: string;
  failureReason?: string;
  aggregationWeight?: number;
  privacyBudgetUsed?: number;
}

/**
 * Robot privacy budget
 */
export interface RobotPrivacyBudget {
  robotId: string;
  totalEpsilon: number;
  usedEpsilon: number;
  remainingEpsilon: number;
  lastUpdated: string;
  roundsParticipated: number;
}

/**
 * ROHE metrics
 */
export interface ROHEMetrics {
  period: { start: string; end: string };
  totalInterventions: number;
  performanceImprovement: number;
  improvementPerIntervention: number;
  byRobot: Record<string, {
    interventions: number;
    improvement: number;
    rohe: number;
  }>;
  byTask: Record<string, {
    interventions: number;
    improvement: number;
    rohe: number;
  }>;
}

/**
 * Convergence data point (for charts)
 */
export interface ConvergenceDataPoint {
  roundNumber: number;
  roundId: string;
  loss: number;
  accuracy?: number;
  participants: number;
  timestamp: string;
}

// ============================================================================
// REQUEST/RESPONSE TYPES
// ============================================================================

/**
 * Create round request
 */
export interface CreateFederatedRoundRequest {
  globalModelVersion: string;
  config?: Partial<FederatedRoundConfig>;
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
 * List rounds response
 */
export interface ListFederatedRoundsResponse {
  rounds: FederatedRound[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * ROHE request params
 */
export interface GetROHEParams {
  startDate?: string;
  endDate?: string;
  robotId?: string;
  task?: string;
}

/**
 * Privacy budget list response
 */
export interface PrivacyBudgetListResponse {
  budgets: RobotPrivacyBudget[];
  totalRobots: number;
}

// ============================================================================
// FILTER TYPES
// ============================================================================

/**
 * Round filters
 */
export interface RoundFilters {
  status?: FederatedRoundStatus;
  globalModelVersion?: string;
}

/**
 * Round pagination
 */
export interface RoundPagination {
  limit: number;
  offset: number;
  total: number;
}

export const DEFAULT_ROUND_PAGINATION: RoundPagination = {
  limit: 20,
  offset: 0,
  total: 0,
};

// ============================================================================
// STORE TYPES
// ============================================================================

/**
 * Error codes
 */
export type FleetLearningErrorCode =
  | 'ROUND_NOT_FOUND'
  | 'ROUND_ALREADY_STARTED'
  | 'INSUFFICIENT_PARTICIPANTS'
  | 'AGGREGATION_FAILED'
  | 'PRIVACY_BUDGET_EXCEEDED'
  | 'NETWORK_ERROR'
  | 'UNKNOWN_ERROR';

/**
 * Fleet learning state
 */
export interface FleetLearningState {
  rounds: FederatedRound[];
  selectedRound: FederatedRound | null;
  participants: FederatedParticipant[];
  privacyBudgets: RobotPrivacyBudget[];
  roheMetrics: ROHEMetrics | null;
  convergenceData: ConvergenceDataPoint[];
  filters: RoundFilters;
  pagination: RoundPagination;
  isLoading: boolean;
  error: string | null;
}

/**
 * Fleet learning actions
 */
export interface FleetLearningActions {
  // Rounds
  fetchRounds: () => Promise<void>;
  fetchRound: (id: string) => Promise<void>;
  createRound: (data: CreateFederatedRoundRequest) => Promise<FederatedRound>;
  startRound: (id: string) => Promise<void>;
  cancelRound: (id: string) => Promise<void>;
  selectRound: (round: FederatedRound | null) => void;
  // Participants
  fetchParticipants: (roundId: string) => Promise<void>;
  // Privacy
  fetchPrivacyBudgets: () => Promise<void>;
  // ROHE
  fetchROHEMetrics: (params?: GetROHEParams) => Promise<void>;
  // Convergence
  fetchConvergenceData: (modelVersion?: string) => Promise<void>;
  // Filters
  setFilters: (filters: Partial<RoundFilters>) => void;
  clearFilters: () => void;
  setPage: (offset: number) => void;
  // Error handling
  clearError: () => void;
  reset: () => void;
}

/**
 * Fleet learning store type
 */
export type FleetLearningStore = FleetLearningState & FleetLearningActions;

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Get status color class
 */
export function getStatusColor(status: FederatedRoundStatus): string {
  const colors: Record<FederatedRoundStatus, string> = {
    created: 'text-gray-600 dark:text-gray-400',
    selecting: 'text-blue-600 dark:text-blue-400',
    distributing: 'text-purple-600 dark:text-purple-400',
    training: 'text-yellow-600 dark:text-yellow-400',
    collecting: 'text-orange-600 dark:text-orange-400',
    aggregating: 'text-cyan-600 dark:text-cyan-400',
    completed: 'text-green-600 dark:text-green-400',
    failed: 'text-red-600 dark:text-red-400',
    cancelled: 'text-gray-500 dark:text-gray-500',
  };
  return colors[status];
}

/**
 * Check if round is active
 */
export function isRoundActive(round: FederatedRound): boolean {
  return ['selecting', 'distributing', 'training', 'collecting', 'aggregating'].includes(round.status);
}

/**
 * Check if round can be started
 */
export function canStartRound(round: FederatedRound): boolean {
  return round.status === 'created';
}

/**
 * Check if round can be cancelled
 */
export function canCancelRound(round: FederatedRound): boolean {
  return isRoundActive(round);
}

/**
 * Format duration in seconds
 */
export function formatDuration(seconds: number | undefined): string {
  if (!seconds) return '-';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${mins}m`;
}
