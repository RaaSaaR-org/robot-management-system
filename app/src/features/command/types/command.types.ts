/**
 * @file command.types.ts
 * @description Type definitions for natural language command interpretation
 * @feature command
 * @dependencies @/features/robots/types
 */

import type { CommandType, RobotCommand } from '@/features/robots/types/robots.types';

// ============================================================================
// SAFETY TYPES
// ============================================================================

/** Safety classification for command interpretation */
export type SafetyClassification = 'safe' | 'caution' | 'dangerous';

/** Command execution history status */
export type CommandHistoryStatus =
  | 'interpreted'
  | 'confirmed'
  | 'executed'
  | 'cancelled'
  | 'failed';

// ============================================================================
// VLA INTERPRETATION TYPES
// ============================================================================

/** Parameters extracted from natural language command */
export interface CommandParameters {
  /** Target object or location name */
  target?: string;
  /** Destination coordinates */
  destination?: {
    x: number;
    y: number;
    z?: number;
  };
  /** Quantity (for pickup/drop commands) */
  quantity?: number;
  /** Objects involved in the action */
  objects?: string[];
  /** Speed modifier */
  speed?: 'slow' | 'normal' | 'fast';
  /** Additional custom parameters */
  custom?: Record<string, unknown>;
}

/** VLA model interpretation of a natural language command */
export interface CommandInterpretation {
  /** Unique interpretation ID */
  id: string;
  /** User's original natural language input */
  originalText: string;
  /** Interpreted command type */
  commandType: CommandType;
  /** Extracted parameters from NL command */
  parameters: CommandParameters;
  /** Confidence score (0-1) */
  confidence: number;
  /** Safety classification */
  safetyClassification: SafetyClassification;
  /** Warning messages (e.g., low battery, obstacle detected) */
  warnings?: string[];
  /** Alternative command suggestions if low confidence */
  suggestedAlternatives?: string[];
  /** Timestamp of interpretation */
  timestamp: string;
}

// ============================================================================
// REQUEST/RESPONSE TYPES
// ============================================================================

/** Request to interpret a natural language command */
export interface InterpretCommandRequest {
  /** Natural language command text */
  text: string;
  /** Target robot ID */
  robotId: string;
  /** Additional context for interpretation */
  context?: Record<string, unknown>;
}

/** Response for command history list */
export interface CommandHistoryResponse {
  /** List of history entries */
  entries: CommandHistoryEntry[];
  /** Pagination info */
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

// ============================================================================
// HISTORY TYPES
// ============================================================================

/** Entry in command history */
export interface CommandHistoryEntry {
  /** Unique history entry ID */
  id: string;
  /** Robot ID command was sent to */
  robotId: string;
  /** Robot name for display */
  robotName: string;
  /** Original natural language text */
  originalText: string;
  /** VLA interpretation */
  interpretation: CommandInterpretation;
  /** Executed command (if executed) */
  executedCommand?: RobotCommand;
  /** Current status */
  status: CommandHistoryStatus;
  /** When entry was created */
  createdAt: string;
  /** When command was executed (if applicable) */
  executedAt?: string;
}

// ============================================================================
// STORE TYPES
// ============================================================================

/** Command store state */
export interface CommandState {
  /** Current input text */
  currentText: string;
  /** Current VLA interpretation */
  interpretation: CommandInterpretation | null;
  /** Interpreting state */
  isInterpreting: boolean;
  /** Executing state */
  isExecuting: boolean;
  /** Command history */
  history: CommandHistoryEntry[];
  /** History loading state */
  isLoadingHistory: boolean;
  /** Error message */
  error: string | null;
}

/** Command store actions */
export interface CommandActions {
  /** Set current input text */
  setCurrentText: (text: string) => void;
  /** Interpret command via VLA */
  interpretCommand: (request: InterpretCommandRequest) => Promise<void>;
  /** Execute the interpreted command */
  executeCommand: (robotId: string) => Promise<RobotCommand>;
  /** Clear current interpretation */
  clearInterpretation: () => void;
  /** Fetch command history */
  fetchHistory: (params?: { page?: number; pageSize?: number; robotId?: string }) => Promise<void>;
  /** Add entry to history */
  addToHistory: (entry: CommandHistoryEntry) => void;
  /** Clear error */
  clearError: () => void;
  /** Reset store */
  reset: () => void;
}

/** Combined command store type */
export type CommandStore = CommandState & CommandActions;

// ============================================================================
// CONSTANTS
// ============================================================================

/** Safety classification labels */
export const SAFETY_CLASSIFICATION_LABELS: Record<SafetyClassification, string> = {
  safe: 'Safe',
  caution: 'Caution',
  dangerous: 'Dangerous',
};

/** Signal token classes (docs/brand.md): measured = fine, unknown = caution, stopped = fault */
const SIGNAL_CLASSES = {
  measured: {
    bg: 'bg-signal-measured/10',
    text: 'text-signal-measured',
    border: 'border-signal-measured/30',
  },
  unknown: {
    bg: 'bg-signal-unknown/10',
    text: 'text-signal-unknown',
    border: 'border-signal-unknown/30',
  },
  stopped: {
    bg: 'bg-signal-stopped/10',
    text: 'text-signal-stopped',
    border: 'border-signal-stopped/30',
  },
} as const;

/** Safety classification colors (token classes) */
export const SAFETY_CLASSIFICATION_COLORS: Record<
  SafetyClassification,
  { bg: string; text: string; border: string }
> = {
  safe: SIGNAL_CLASSES.measured,
  caution: SIGNAL_CLASSES.unknown,
  dangerous: SIGNAL_CLASSES.stopped,
};

/** Safety classification → kit StatusTag tone */
export const SAFETY_CLASSIFICATION_TONE: Record<SafetyClassification, 'live' | 'gated' | 'stopped'> = {
  safe: 'live',
  caution: 'gated',
  dangerous: 'stopped',
};

/** History status → kit StatusTag tone */
export const HISTORY_STATUS_TONE: Record<
  CommandHistoryStatus,
  'success' | 'info' | 'warning' | 'danger' | 'neutral'
> = {
  interpreted: 'info',
  confirmed: 'warning',
  executed: 'success',
  cancelled: 'neutral',
  failed: 'danger',
};

/** History status labels */
export const HISTORY_STATUS_LABELS: Record<CommandHistoryStatus, string> = {
  interpreted: 'Interpreted',
  confirmed: 'Confirmed',
  executed: 'Executed',
  cancelled: 'Cancelled',
  failed: 'Failed',
};

/** History status colors (Badge variants) */
export const HISTORY_STATUS_COLORS: Record<
  CommandHistoryStatus,
  'default' | 'success' | 'error' | 'warning' | 'info'
> = {
  interpreted: 'info',
  confirmed: 'warning',
  executed: 'success',
  cancelled: 'default',
  failed: 'error',
};

/** Confidence thresholds */
export const CONFIDENCE_THRESHOLDS = {
  high: 0.9,
  medium: 0.7,
} as const;

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Get confidence level category
 */
export function getConfidenceLevel(confidence: number): 'high' | 'medium' | 'low' {
  if (confidence >= CONFIDENCE_THRESHOLDS.high) return 'high';
  if (confidence >= CONFIDENCE_THRESHOLDS.medium) return 'medium';
  return 'low';
}

/**
 * Get confidence color classes
 */
export function getConfidenceColors(confidence: number): {
  bg: string;
  text: string;
  border: string;
} {
  const level = getConfidenceLevel(confidence);
  switch (level) {
    case 'high':
      return SIGNAL_CLASSES.measured;
    case 'medium':
      return SIGNAL_CLASSES.unknown;
    case 'low':
      return SIGNAL_CLASSES.stopped;
  }
}

/**
 * Format confidence as percentage
 */
export function formatConfidence(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}

/** Sentence-case label of a command type; unknown types ("navigation") are humanized */
export function commandTypeLabel(type: string, labels: Record<string, string>): string {
  const known = labels[type];
  const text = known ?? type.replace(/[_-]+/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
}
