/**
 * @file process.types.ts
 * @description Process and Step type definitions for workflow management
 * @feature processes
 */

// ============================================================================
// PROCESS DEFINITION (Template)
// ============================================================================

export type ProcessDefinitionStatus = 'draft' | 'ready' | 'archived';

export type StepActionType =
  | 'move_to_location'
  | 'pickup_object'
  | 'drop_object'
  | 'wait'
  | 'inspect'
  | 'charge'
  | 'return_home'
  | 'custom';

export interface StepTemplate {
  id: string;
  order: number;
  name: string;
  description?: string;
  actionType: StepActionType;
  actionConfig: Record<string, unknown>;
  requiredCapabilities?: string[];
  estimatedDurationMinutes?: number;
  dependsOnStepIds?: string[];
  canRunParallel?: boolean;
}

export interface ProcessDefinition {
  id: string;
  name: string;
  description?: string;
  version: number;
  status: ProcessDefinitionStatus;
  stepTemplates: StepTemplate[];
  requiredCapabilities?: string[];
  estimatedDurationMinutes?: number;
  maxConcurrentInstances?: number;
  tags?: string[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// PROCESS INSTANCE (Runtime)
// ============================================================================

export type ProcessInstanceStatus =
  | 'pending'
  | 'queued'
  | 'in_progress'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type Priority = 'low' | 'normal' | 'high' | 'critical';

export interface ProcessInstance {
  id: string;
  processDefinitionId: string;
  processName: string;
  description?: string;
  status: ProcessInstanceStatus;
  priority: Priority;
  steps: StepInstance[];
  currentStepIndex: number;
  progress: number; // 0-100
  preferredRobotIds?: string[];
  assignedRobotIds: string[];
  scheduledAt?: string;
  startedAt?: string;
  completedAt?: string;
  estimatedCompletionAt?: string;
  inputData?: Record<string, unknown>;
  outputData?: Record<string, unknown>;
  errorMessage?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// STEP INSTANCE
// ============================================================================

export type StepInstanceStatus =
  | 'pending'
  | 'queued'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'cancelled';

export interface StepResult {
  success: boolean;
  data?: Record<string, unknown>;
  message?: string;
}

export interface StepInstance {
  id: string;
  processInstanceId: string;
  stepTemplateId: string;
  order: number;
  name: string;
  description?: string;
  actionType: StepActionType;
  actionConfig: Record<string, unknown>;
  status: StepInstanceStatus;
  robotTaskId?: string;
  assignedRobotId?: string;
  startedAt?: string;
  completedAt?: string;
  result?: StepResult;
  error?: string;
  retryCount: number;
  maxRetries: number;
}

// ============================================================================
// API REQUEST/RESPONSE TYPES
// ============================================================================

export interface CreateProcessDefinitionRequest {
  name: string;
  description?: string;
  stepTemplates: Omit<StepTemplate, 'id'>[];
  requiredCapabilities?: string[];
  estimatedDurationMinutes?: number;
  maxConcurrentInstances?: number;
  tags?: string[];
}

export interface UpdateProcessDefinitionRequest {
  name?: string;
  description?: string;
  status?: ProcessDefinitionStatus;
  stepTemplates?: Omit<StepTemplate, 'id'>[];
  requiredCapabilities?: string[];
  estimatedDurationMinutes?: number;
  maxConcurrentInstances?: number;
  tags?: string[];
}

export interface StartProcessRequest {
  priority?: Priority;
  preferredRobotIds?: string[];
  scheduledAt?: string;
  inputData?: Record<string, unknown>;
}

export interface ProcessInstanceActionRequest {
  action: 'pause' | 'resume' | 'cancel' | 'retry';
}

export interface ProcessListFilters {
  status?: ProcessDefinitionStatus;
  tags?: string[];
  search?: string;
}

export interface ProcessInstanceListFilters {
  status?: ProcessInstanceStatus | ProcessInstanceStatus[];
  priority?: Priority | Priority[];
  processDefinitionId?: string;
  robotId?: string;
  createdBy?: string;
  dateRange?: {
    start: string;
    end: string;
  };
}

export interface PaginationParams {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// ============================================================================
// WEBSOCKET EVENTS
// ============================================================================

export interface ProcessCreatedEvent {
  type: 'process:created';
  processInstance: ProcessInstance;
}

export interface ProcessUpdatedEvent {
  type: 'process:updated';
  processInstance: ProcessInstance;
}

export interface ProcessCompletedEvent {
  type: 'process:completed';
  processInstance: ProcessInstance;
}

export interface ProcessFailedEvent {
  type: 'process:failed';
  processInstance: ProcessInstance;
  error: string;
}

export interface StepStartedEvent {
  type: 'step:started';
  processInstanceId: string;
  stepInstance: StepInstance;
}

export interface StepCompletedEvent {
  type: 'step:completed';
  processInstanceId: string;
  stepInstance: StepInstance;
}

export interface StepFailedEvent {
  type: 'step:failed';
  processInstanceId: string;
  stepInstance: StepInstance;
  error: string;
}

export type ProcessEvent =
  | ProcessCreatedEvent
  | ProcessUpdatedEvent
  | ProcessCompletedEvent
  | ProcessFailedEvent
  | StepStartedEvent
  | StepCompletedEvent
  | StepFailedEvent;
