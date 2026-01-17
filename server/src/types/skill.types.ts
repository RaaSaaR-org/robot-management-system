/**
 * @file skill.types.ts
 * @description Type definitions for skill library management and execution
 * @feature vla
 *
 * Implements types for:
 * - Skill chains and sequencing
 * - Skill execution and validation
 * - Condition checking
 */

import type { SkillDefinition, Condition, SkillStatus } from './vla.types.js';

// ============================================================================
// SKILL CHAIN TYPES
// ============================================================================

/**
 * Failure handling strategy for skill chain steps
 */
export type FailureStrategy = 'abort' | 'skip' | 'retry';

/**
 * Status of a skill chain
 */
export const SkillChainStatuses = ['draft', 'active', 'archived'] as const;
export type SkillChainStatus = (typeof SkillChainStatuses)[number];

/**
 * A single step in a skill chain
 */
export interface SkillChainStep {
  id: string;
  skillId: string;
  order: number;
  parameters: Record<string, unknown>;
  inputMapping?: Record<string, string>; // Map previous output to input
  onFailure: FailureStrategy;
  maxRetries?: number;
  timeoutOverride?: number; // Override skill timeout

  // Optional relation
  skill?: SkillDefinition;
}

/**
 * A chain of skills to be executed sequentially
 */
export interface SkillChain {
  id: string;
  name: string;
  description?: string;
  status: SkillChainStatus;
  steps: SkillChainStep[];
  estimatedDuration?: number; // Total estimated duration in seconds
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Input for creating a skill chain
 */
export interface CreateSkillChainInput {
  name: string;
  description?: string;
  steps: Array<{
    skillId: string;
    parameters?: Record<string, unknown>;
    inputMapping?: Record<string, string>;
    onFailure?: FailureStrategy;
    maxRetries?: number;
    timeoutOverride?: number;
  }>;
}

/**
 * Input for updating a skill chain
 */
export interface UpdateSkillChainInput {
  name?: string;
  description?: string;
  status?: SkillChainStatus;
  steps?: Array<{
    skillId: string;
    parameters?: Record<string, unknown>;
    inputMapping?: Record<string, string>;
    onFailure?: FailureStrategy;
    maxRetries?: number;
    timeoutOverride?: number;
  }>;
}

/**
 * Query parameters for skill chains
 */
export interface SkillChainQueryParams {
  name?: string;
  status?: SkillChainStatus | SkillChainStatus[];
  page?: number;
  pageSize?: number;
}

// ============================================================================
// SKILL EXECUTION TYPES
// ============================================================================

/**
 * Status of skill execution
 */
export const SkillExecutionStatuses = [
  'pending',
  'checking_preconditions',
  'executing',
  'checking_postconditions',
  'completed',
  'failed',
  'cancelled',
] as const;
export type SkillExecutionStatus = (typeof SkillExecutionStatuses)[number];

/**
 * Request to execute a single skill
 */
export interface ExecuteSkillRequest {
  skillId: string;
  robotId: string;
  parameters?: Record<string, unknown>;
  skipPreconditions?: boolean;
  skipPostconditions?: boolean;
}

/**
 * Request to execute a skill chain
 */
export interface ExecuteChainRequest {
  chainId: string;
  robotId: string;
  initialParameters?: Record<string, unknown>;
  startFromStep?: number; // Resume from a specific step
}

/**
 * Result of condition checking
 */
export interface ConditionCheckResult {
  condition: Condition;
  passed: boolean;
  actualValue?: unknown;
  expectedValue?: unknown;
  error?: string;
}

/**
 * Result of a single skill execution
 */
export interface SkillExecutionResult {
  skillId: string;
  robotId: string;
  status: SkillExecutionStatus;
  startedAt: Date;
  completedAt?: Date;
  duration?: number; // Duration in ms
  parameters: Record<string, unknown>;
  output?: Record<string, unknown>;
  preconditionResults?: ConditionCheckResult[];
  postconditionResults?: ConditionCheckResult[];
  error?: string;
  retryCount: number;
}

/**
 * Result of chain execution
 */
export interface ChainExecutionResult {
  chainId: string;
  robotId: string;
  status: SkillExecutionStatus;
  startedAt: Date;
  completedAt?: Date;
  totalDuration?: number;
  stepResults: Array<{
    stepOrder: number;
    skillId: string;
    result: SkillExecutionResult;
  }>;
  finalOutput?: Record<string, unknown>;
  failedAtStep?: number;
  error?: string;
}

// ============================================================================
// VALIDATION TYPES
// ============================================================================

/**
 * Validation error detail
 */
export interface ValidationError {
  path: string[];
  message: string;
  code: string;
}

/**
 * Result of parameter validation
 */
export interface ParameterValidationResult {
  valid: boolean;
  errors: ValidationError[];
  coercedParameters?: Record<string, unknown>; // Parameters after type coercion
}

/**
 * Request to validate skill parameters
 */
export interface ValidateParametersRequest {
  skillId: string;
  parameters: Record<string, unknown>;
}

// ============================================================================
// COMPATIBILITY TYPES
// ============================================================================

/**
 * Robot compatibility info for a skill
 */
export interface RobotCompatibility {
  robotId: string;
  robotName: string;
  robotType: string;
  compatible: boolean;
  missingCapabilities: string[];
  matchingCapabilities: string[];
}

/**
 * Result of compatibility check
 */
export interface CompatibilityCheckResult {
  skillId: string;
  totalRobots: number;
  compatibleRobots: number;
  robots: RobotCompatibility[];
}

// ============================================================================
// API RESPONSE TYPES
// ============================================================================

/**
 * Response for skill creation/update
 */
export interface SkillResponse {
  skill: SkillDefinition;
  message?: string;
}

/**
 * Response for skill list
 */
export interface SkillListResponse {
  skills: SkillDefinition[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

/**
 * Response for skill chain
 */
export interface SkillChainResponse {
  chain: SkillChain;
  message?: string;
}

/**
 * Response for skill chain list
 */
export interface SkillChainListResponse {
  chains: SkillChain[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

/**
 * Response for skill execution
 */
export interface ExecutionResponse {
  executionId: string;
  result: SkillExecutionResult | ChainExecutionResult;
  message?: string;
}

// ============================================================================
// EVENT TYPES
// ============================================================================

/**
 * Skill execution event types
 */
export const SkillEventTypes = [
  'skill:execution:started',
  'skill:execution:preconditions:checking',
  'skill:execution:preconditions:passed',
  'skill:execution:preconditions:failed',
  'skill:execution:running',
  'skill:execution:postconditions:checking',
  'skill:execution:postconditions:passed',
  'skill:execution:postconditions:failed',
  'skill:execution:completed',
  'skill:execution:failed',
  'skill:execution:cancelled',
  'skill:chain:started',
  'skill:chain:step:started',
  'skill:chain:step:completed',
  'skill:chain:step:failed',
  'skill:chain:completed',
  'skill:chain:failed',
] as const;
export type SkillEventType = (typeof SkillEventTypes)[number];

/**
 * Skill execution event
 */
export interface SkillEvent {
  type: SkillEventType;
  skillId?: string;
  chainId?: string;
  robotId: string;
  timestamp: string;
  stepOrder?: number;
  result?: SkillExecutionResult;
  error?: string;
}

/**
 * Callback type for skill events
 */
export type SkillEventCallback = (event: SkillEvent) => void;
