/**
 * @file IProcessManager.ts
 * @description Interface for process management service
 * @feature processes
 */

import type {
  ProcessDefinition,
  ProcessInstance,
  CreateProcessDefinitionRequest,
  UpdateProcessDefinitionRequest,
  StartProcessRequest,
  ProcessListFilters,
  ProcessInstanceListFilters,
  PaginationParams,
  PaginatedResponse,
  ProcessEvent,
  StepResult,
} from '../types/process.types.js';

/**
 * Process event handler type
 */
export type ProcessEventHandler = (event: ProcessEvent) => void;

/**
 * Interface for process management operations
 * Enables dependency injection and testing
 */
export interface IProcessManager {
  // ============================================================================
  // PROCESS DEFINITION MANAGEMENT
  // ============================================================================

  /**
   * Get a process definition by ID
   * @param id - The definition's unique identifier
   */
  getDefinition(id: string): Promise<ProcessDefinition | null>;

  /**
   * List process definitions with optional filters and pagination
   * @param filters - Optional filters
   * @param pagination - Optional pagination params
   */
  listDefinitions(
    filters?: ProcessListFilters,
    pagination?: PaginationParams
  ): Promise<PaginatedResponse<ProcessDefinition>>;

  /**
   * Create a new process definition
   * @param request - Definition creation request
   * @param createdBy - User ID who created it
   */
  createDefinition(
    request: CreateProcessDefinitionRequest,
    createdBy: string
  ): Promise<ProcessDefinition>;

  /**
   * Update an existing process definition
   * @param id - The definition's unique identifier
   * @param request - Definition update request
   */
  updateDefinition(
    id: string,
    request: UpdateProcessDefinitionRequest
  ): Promise<ProcessDefinition | null>;

  /**
   * Publish a draft definition to make it ready for execution
   * @param id - The definition's unique identifier
   */
  publishDefinition(id: string): Promise<ProcessDefinition | null>;

  /**
   * Archive (soft delete) a process definition
   * @param id - The definition's unique identifier
   * @returns True if successfully archived
   */
  archiveDefinition(id: string): Promise<boolean>;

  // ============================================================================
  // PROCESS INSTANCE MANAGEMENT
  // ============================================================================

  /**
   * Get a process instance by ID
   * @param id - The instance's unique identifier
   */
  getInstance(id: string): Promise<ProcessInstance | null>;

  /**
   * List process instances with optional filters and pagination
   * @param filters - Optional filters
   * @param pagination - Optional pagination params
   */
  listInstances(
    filters?: ProcessInstanceListFilters,
    pagination?: PaginationParams
  ): Promise<PaginatedResponse<ProcessInstance>>;

  /**
   * Start a new process instance from a definition
   * @param definitionId - The definition's unique identifier
   * @param request - Process start request with parameters
   * @param createdBy - User ID who started it
   */
  startProcess(
    definitionId: string,
    request: StartProcessRequest,
    createdBy: string
  ): Promise<ProcessInstance | null>;

  /**
   * Begin executing a pending process
   * @param instanceId - The instance's unique identifier
   * @returns True if execution started
   */
  beginExecution(instanceId: string): Promise<boolean>;

  /**
   * Pause a running process
   * @param id - The instance's unique identifier
   */
  pauseProcess(id: string): Promise<ProcessInstance | null>;

  /**
   * Resume a paused process
   * @param id - The instance's unique identifier
   */
  resumeProcess(id: string): Promise<ProcessInstance | null>;

  /**
   * Cancel a process
   * @param id - The instance's unique identifier
   */
  cancelProcess(id: string): Promise<ProcessInstance | null>;

  // ============================================================================
  // STEP EXECUTION
  // ============================================================================

  /**
   * Execute the next pending step in a process
   * @param instanceId - The instance's unique identifier
   */
  executeNextStep(instanceId: string): Promise<void>;

  /**
   * Handle step completion from robot task
   * @param stepId - The step's unique identifier
   * @param result - Step execution result
   */
  onStepCompleted(stepId: string, result: StepResult): Promise<void>;

  // ============================================================================
  // EVENTS
  // ============================================================================

  /**
   * Subscribe to all process events
   * @param handler - Event handler function
   */
  onProcessEvent(handler: ProcessEventHandler): void;
}
