/**
 * @file explainability.types.ts
 * @description Type definitions for AI explainability feature (EU AI Act Art. 13, Art. 50)
 * @feature explainability
 */

// ============================================================================
// CORE TYPES
// ============================================================================

export type DecisionType = 'command_interpretation' | 'task_execution' | 'safety_action';

export type SafetyClassification = 'safe' | 'caution' | 'dangerous';

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export type MetricsPeriod = 'daily' | 'weekly' | 'monthly';

// ============================================================================
// DECISION TYPES
// ============================================================================

export interface DecisionInputFactors {
  userCommand?: string;
  robotState: {
    location?: { x: number; y: number; z?: number };
    batteryLevel?: number;
    status?: string;
    heldObject?: string | null;
  };
  environmentContext?: {
    zones?: string[];
    restrictions?: string[];
    conditions?: string[];
  };
  conversationHistory?: string[];
}

export interface AlternativeConsidered {
  action: string;
  reason: string;
  rejectionReason?: string;
  confidence?: number;
}

export interface DecisionSafetyFactors {
  classification: SafetyClassification;
  warnings: string[];
  constraints: string[];
  riskLevel?: number;
}

export interface DecisionExplanation {
  id: string;
  decisionType: DecisionType;
  entityId: string;
  robotId: string;
  inputFactors: DecisionInputFactors;
  reasoning: string[];
  modelUsed: string;
  confidence: number;
  alternatives: AlternativeConsidered[];
  safetyFactors: DecisionSafetyFactors;
  createdAt: string;
}

// ============================================================================
// FORMATTED EXPLANATION (Human-readable)
// ============================================================================

export interface FormattedExplanation {
  id: string;
  summary: string;
  decisionType: string;
  confidence: {
    score: number;
    level: ConfidenceLevel;
    description: string;
  };
  inputFactors: {
    title: string;
    items: Array<{ label: string; value: string }>;
  };
  reasoning: {
    title: string;
    steps: string[];
  };
  alternatives: {
    title: string;
    items: Array<{ action: string; reason: string; rejected?: string }>;
  };
  safety: {
    classification: SafetyClassification;
    warnings: string[];
    constraints: string[];
  };
  metadata: {
    modelUsed: string;
    timestamp: string;
    robotId: string;
  };
}

// ============================================================================
// METRICS TYPES
// ============================================================================

export interface AIPerformanceMetrics {
  period: MetricsPeriod;
  startDate: string;
  endDate: string;
  totalDecisions: number;
  accuracy: number;
  precision: number;
  recall: number;
  errorRate: number;
  driftIndicator: number;
  avgConfidence: number;
  safetyDistribution: {
    safe: number;
    caution: number;
    dangerous: number;
  };
}

// ============================================================================
// DOCUMENTATION TYPES
// ============================================================================

export interface AIDocumentation {
  intendedPurpose: string;
  capabilities: string[];
  limitations: string[];
  operatingConditions: string[];
  humanOversightRequirements: string[];
  version: string;
  lastUpdated: string;
}

// ============================================================================
// API RESPONSE TYPES
// ============================================================================

export interface DecisionListResponse {
  decisions: DecisionExplanation[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

export interface LimitationsResponse {
  limitations: string[];
}

export interface OperatingConditionsResponse {
  conditions: string[];
}

export interface HumanOversightResponse {
  requirements: string[];
}

// ============================================================================
// STORE TYPES
// ============================================================================

export interface ExplainabilityState {
  decisions: DecisionExplanation[];
  selectedDecision: DecisionExplanation | null;
  formattedExplanation: FormattedExplanation | null;
  metrics: AIPerformanceMetrics | null;
  documentation: AIDocumentation | null;
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  isLoading: boolean;
  isLoadingExplanation: boolean;
  isLoadingMetrics: boolean;
  isLoadingDocumentation: boolean;
  error: string | null;
}

export interface ExplainabilityActions {
  fetchDecisions: (params?: {
    page?: number;
    robotId?: string;
    decisionType?: DecisionType;
  }) => Promise<void>;
  fetchDecision: (id: string) => Promise<void>;
  fetchExplanation: (id: string) => Promise<void>;
  fetchMetrics: (period?: MetricsPeriod, robotId?: string) => Promise<void>;
  fetchDocumentation: () => Promise<void>;
  clearSelectedDecision: () => void;
  reset: () => void;
}

export type ExplainabilityStore = ExplainabilityState & ExplainabilityActions;

// ============================================================================
// CONSTANTS
// ============================================================================

export const DECISION_TYPE_LABELS: Record<DecisionType, string> = {
  command_interpretation: 'Command Interpretation',
  task_execution: 'Task Execution',
  safety_action: 'Safety Action',
};

export const SAFETY_CLASSIFICATION_LABELS: Record<SafetyClassification, string> = {
  safe: 'Safe',
  caution: 'Caution Required',
  dangerous: 'Dangerous',
};

export const SAFETY_CLASSIFICATION_COLORS: Record<SafetyClassification, string> = {
  safe: 'green',
  caution: 'yellow',
  dangerous: 'red',
};

export const CONFIDENCE_LEVEL_LABELS: Record<ConfidenceLevel, string> = {
  high: 'High Confidence',
  medium: 'Medium Confidence',
  low: 'Low Confidence',
};

export const METRICS_PERIOD_LABELS: Record<MetricsPeriod, string> = {
  daily: 'Last 24 Hours',
  weekly: 'Last 7 Days',
  monthly: 'Last 30 Days',
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

export function formatConfidence(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}

export function getConfidenceLevel(confidence: number): ConfidenceLevel {
  if (confidence >= 0.8) return 'high';
  if (confidence >= 0.6) return 'medium';
  return 'low';
}

export function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleString();
}
