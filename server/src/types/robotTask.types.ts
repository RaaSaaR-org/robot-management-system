/**
 * @file robotTask.types.ts
 * @description Robot-facing Task type definitions for work distribution
 * @feature processes
 *
 * Note: This is distinct from A2ATask which is the internal protocol-level task.
 * RobotTask is the user/system-facing executable work item pushed to robots.
 */

import { Priority, StepActionType } from './process.types';

// ============================================================================
// ROBOT TASK (Work Item for Robots)
// ============================================================================

export type RobotTaskStatus =
  | 'pending' // Created, not yet assigned
  | 'assigned' // Robot knows about it
  | 'executing' // Robot is working on it
  | 'completed' // Done successfully
  | 'failed' // Error occurred
  | 'cancelled'; // Aborted

export type RobotTaskSource = 'process' | 'command' | 'manual';

export interface RobotTaskResult {
  success: boolean;
  data?: Record<string, unknown>;
  message?: string;
  durationMs: number;
}

export interface RobotTask {
  id: string;

  // Source linkage (null for command/manual tasks)
  processInstanceId?: string;
  stepInstanceId?: string;
  source: RobotTaskSource;

  // Assignment
  robotId: string | null; // null until assigned by TaskDistributor
  priority: Priority;
  status: RobotTaskStatus;

  // What to do
  actionType: StepActionType;
  actionConfig: Record<string, unknown>;

  // Natural language instruction for AI agent
  instruction: string;

  // A2A execution tracking (populated when robot starts)
  a2aTaskId?: string;
  a2aContextId?: string;

  // Timing
  createdAt: string;
  assignedAt?: string;
  startedAt?: string;
  completedAt?: string;

  // Timeout (optional)
  timeoutMs?: number;

  // Result
  result?: RobotTaskResult;
  error?: string;
  retryCount: number;
  maxRetries: number;
}

// ============================================================================
// TASK DISTRIBUTION
// ============================================================================

export interface RobotScore {
  robotId: string;
  score: number;
  reasons: string[];
}

export interface DistributionResult {
  taskId: string;
  robotId: string | null;
  success: boolean;
  reason?: string;
  scores?: RobotScore[];
}

export interface TaskQueueStats {
  pending: number;
  assigned: number;
  executing: number;
  completed: number;
  failed: number;
  byPriority: {
    critical: number;
    high: number;
    normal: number;
    low: number;
  };
  byRobot: Record<
    string,
    {
      queued: number;
      executing: number;
    }
  >;
}

// ============================================================================
// API REQUEST/RESPONSE TYPES
// ============================================================================

export interface CreateRobotTaskRequest {
  robotId?: string; // Optional - if not provided, will be auto-assigned
  priority?: Priority;
  actionType: StepActionType;
  actionConfig: Record<string, unknown>;
  instruction: string;
  timeoutMs?: number;
  maxRetries?: number;
}

export interface UpdateRobotTaskStatusRequest {
  status: RobotTaskStatus;
  result?: RobotTaskResult;
  error?: string;
  a2aTaskId?: string;
  a2aContextId?: string;
}

export interface RobotTaskListFilters {
  status?: RobotTaskStatus | RobotTaskStatus[];
  priority?: Priority | Priority[];
  robotId?: string;
  processInstanceId?: string;
  source?: RobotTaskSource;
  dateRange?: {
    start: string;
    end: string;
  };
}

// ============================================================================
// WEBSOCKET EVENTS
// ============================================================================

export interface TaskCreatedEvent {
  type: 'task:created';
  task: RobotTask;
}

export interface TaskAssignedEvent {
  type: 'task:assigned';
  task: RobotTask;
  robotId: string;
}

export interface TaskProgressEvent {
  type: 'task:progress';
  taskId: string;
  robotId: string | null;
  progress: number; // 0-100
  message?: string;
}

export interface TaskCompletedEvent {
  type: 'task:completed';
  task: RobotTask;
  result: RobotTaskResult;
}

export interface TaskFailedEvent {
  type: 'task:failed';
  task: RobotTask;
  error: string;
}

export type TaskEvent =
  | TaskCreatedEvent
  | TaskAssignedEvent
  | TaskProgressEvent
  | TaskCompletedEvent
  | TaskFailedEvent;

// ============================================================================
// ROBOT WORK QUEUE TYPES
// ============================================================================

export interface WorkAssignment {
  type: 'work:assigned';
  task: RobotTask;
}

export interface WorkCancelled {
  type: 'work:cancelled';
  taskId: string;
  reason?: string;
}

export interface WorkPriorityChanged {
  type: 'work:priority_changed';
  taskId: string;
  newPriority: Priority;
}

export type WorkEvent = WorkAssignment | WorkCancelled | WorkPriorityChanged;
