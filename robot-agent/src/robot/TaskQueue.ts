/**
 * @file TaskQueue.ts
 * @description Manages robot task queue for server-pushed tasks
 * @feature robot
 * @status live
 */

import type {
  SimulatedRobotState,
  RobotLocation,
  CommandResult,
  PushedTask,
} from './types.js';
import { config } from '../config/config.js';
import {
  SERVICE_TOKEN_ENV,
  isAuthRejection,
  platformAuthHeaders,
  recordPlatformAuthRejection,
} from '../utils/platform-auth.js';

/**
 * The action types this agent actually executes.
 *
 * Everything else — `inspect`, `custom`, and the server-only members of the
 * wider union such as `execute_skill` — is refused, not simulated. A branch
 * that slept two seconds and reported `completed` turned a user's automation
 * into a row of green ticks for work no robot did; a refusal is the only
 * honest answer for an action there is no code for.
 *
 * The app keeps its own copy (`StepActionType` in
 * `app/src/features/processes/types/process.types.ts`): separate package, no
 * import path between them.
 */
export const IMPLEMENTED_ACTION_TYPES = [
  'move_to_location',
  'pickup_object',
  'drop_object',
  'wait',
  'charge',
  'return_home',
] as const;

/**
 * The failure an unimplemented action type reports. Returned immediately — a
 * refusal has nothing to wait for.
 */
function notImplemented(actionType: string): CommandResult {
  return {
    success: false,
    message: `Action type '${actionType}' is not implemented by this robot agent`,
  };
}

/**
 * Callback to get current state
 */
export type StateGetter = () => SimulatedRobotState;

/**
 * Callback to update robot state
 */
export type StateUpdater = (updater: (state: SimulatedRobotState) => void) => void;

/**
 * Callback to notify of state changes
 */
export type ChangeNotifier = () => void;

/**
 * Command execution function
 */
export type CommandExecuteFn = {
  moveTo: (location: RobotLocation) => Promise<CommandResult>;
  pickup: (objectId: string) => Promise<CommandResult>;
  drop: () => Promise<CommandResult>;
  goToCharge: () => Promise<CommandResult>;
  returnHome: () => Promise<CommandResult>;
  stop: () => Promise<CommandResult>;
};

/**
 * Configuration for task queue
 */
export interface TaskQueueConfig {
  /** Maximum number of tasks in queue */
  maxQueueSize: number;
}

const DEFAULT_CONFIG: TaskQueueConfig = {
  maxQueueSize: 5,
};

/**
 * Manages the queue of tasks pushed from the server
 */
export class TaskQueue {
  private queue: PushedTask[] = [];
  private currentTask: PushedTask | null = null;
  private readonly config: TaskQueueConfig;
  private stateGetter: StateGetter;
  private stateUpdater: StateUpdater;
  private changeNotifier: ChangeNotifier;
  private commands: CommandExecuteFn;

  constructor(
    stateGetter: StateGetter,
    stateUpdater: StateUpdater,
    changeNotifier: ChangeNotifier,
    commands: CommandExecuteFn,
    config: Partial<TaskQueueConfig> = {}
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.stateGetter = stateGetter;
    this.stateUpdater = stateUpdater;
    this.changeNotifier = changeNotifier;
    this.commands = commands;
  }

  /**
   * Restore queued tasks from persisted state (called once on startup).
   * Does not trigger execution — the simulation loop handles that.
   */
  restoreQueue(tasks: PushedTask[]): void {
    this.queue = [...tasks];
    this.sortQueue();
    console.log(`[TaskQueue] Restored ${this.queue.length} task(s) from persisted state`);
  }

  /**
   * Accept a task pushed from the server
   * @returns true if task was accepted
   */
  async accept(task: PushedTask): Promise<boolean> {
    const state = this.stateGetter();

    // Check if robot can accept tasks
    if (state.status === 'error' || state.status === 'maintenance') {
      return false;
    }

    // Check queue size
    if (this.queue.length >= this.config.maxQueueSize) {
      console.warn(`[TaskQueue] Queue full, rejecting task ${task.id}`);
      return false;
    }

    // Add task to queue (sorted by priority)
    this.queue.push(task);
    this.sortQueue();

    console.log(`[TaskQueue] Task ${task.id} added (${this.queue.length}/${this.config.maxQueueSize})`);

    // If no current task, start executing
    if (!this.currentTask && state.status !== 'busy') {
      this.executeNext();
    }

    return true;
  }

  /**
   * Get all tasks in the queue
   */
  getTasks(): PushedTask[] {
    return [...this.queue];
  }

  /**
   * Get the queue length
   */
  get length(): number {
    return this.queue.length;
  }

  /**
   * Get the current task being executed
   */
  getCurrentTask(): PushedTask | null {
    return this.currentTask;
  }

  /**
   * Cancel a task by ID
   * @returns true if task was cancelled
   */
  async cancel(taskId: string): Promise<boolean> {
    // Check current task
    if (this.currentTask && this.currentTask.id === taskId) {
      await this.commands.stop();
      this.currentTask = null;
      this.executeNext();
      return true;
    }

    // Check queue
    const index = this.queue.findIndex((t) => t.id === taskId);
    if (index !== -1) {
      this.queue.splice(index, 1);
      return true;
    }

    return false;
  }

  /**
   * Sort queue by priority
   */
  private sortQueue(): void {
    const priorityWeight = {
      critical: 4,
      high: 3,
      normal: 2,
      low: 1,
    };

    this.queue.sort((a, b) => {
      return priorityWeight[b.priority] - priorityWeight[a.priority];
    });
  }

  /**
   * Report task status back to server
   */
  private async reportTaskStatus(
    taskId: string,
    status: 'executing' | 'completed' | 'failed',
    result?: { success: boolean; data?: Record<string, unknown>; message?: string },
    error?: string
  ): Promise<void> {
    const url = `${config.serverUrl}/api/processes/tasks/${taskId}/status`;
    try {
      const response = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...platformAuthHeaders() },
        body: JSON.stringify({ status, result, error }),
      });

      if (!response.ok) {
        if (isAuthRejection(response.status)) {
          // No retry queue here (that is separate work) — but the operator has
          // to be told, because the server's row for this task stays
          // `executing` forever and nothing else says why.
          recordPlatformAuthRejection('TaskQueue', response.status, url);
          console.error(
            `[TaskQueue] Task ${taskId} status report rejected: HTTP ${response.status} — ${
              process.env[SERVICE_TOKEN_ENV]
                ? `the configured ${SERVICE_TOKEN_ENV} was refused (a fleet write needs a member service account)`
                : `no ${SERVICE_TOKEN_ENV} is configured`
            }. The server still shows this task as executing.`
          );
        } else {
          console.error(`[TaskQueue] Failed to report task ${taskId} status: HTTP ${response.status}`);
        }
      } else {
        console.log(`[TaskQueue] Reported task ${taskId} status: ${status}`);
      }
    } catch (err) {
      console.error('[TaskQueue] Error reporting task status:', err);
    }
  }

  /**
   * Execute the next task in the queue
   */
  private async executeNext(): Promise<void> {
    if (this.queue.length === 0) {
      this.currentTask = null;
      return;
    }

    const task = this.queue.shift()!;
    this.currentTask = task;

    this.stateUpdater((s) => {
      s.currentTaskId = task.id;
      s.currentTaskName = task.instruction;
    });

    console.log(`[TaskQueue] Executing task ${task.id}: ${task.instruction}`);

    // Report executing status to server
    await this.reportTaskStatus(task.id, 'executing');

    // Execute task based on action type
    const result = await this.executeAction(task);

    // Task completed or failed
    console.log(`[TaskQueue] Task ${task.id} ${result.success ? 'completed' : 'failed'}: ${result.message}`);

    // Report completion/failure status to server
    if (result.success) {
      await this.reportTaskStatus(task.id, 'completed', {
        success: true,
        message: result.message,
        data: result.data,
      });
    } else {
      await this.reportTaskStatus(task.id, 'failed', undefined, result.message);
    }

    this.currentTask = null;
    this.stateUpdater((s) => {
      s.currentTaskId = undefined;
      s.currentTaskName = undefined;
    });
    this.changeNotifier();

    // Execute next task if available
    this.executeNext();
  }

  /**
   * Execute a task's action
   */
  private async executeAction(task: PushedTask): Promise<CommandResult> {
    switch (task.actionType) {
      case 'move_to_location': {
        const location = task.actionConfig.location as RobotLocation | undefined;
        if (location) {
          return this.commands.moveTo(location);
        }
        return { success: false, message: 'No location provided' };
      }

      case 'pickup_object': {
        const objectId = task.actionConfig.objectId as string | undefined;
        if (objectId) {
          return this.commands.pickup(objectId);
        }
        return { success: false, message: 'No object ID provided' };
      }

      case 'drop_object':
        return this.commands.drop();

      case 'charge':
        return this.commands.goToCharge();

      case 'return_home':
        return this.commands.returnHome();

      case 'wait': {
        const duration = (task.actionConfig.durationMs as number) ?? 1000;
        await new Promise((resolve) => setTimeout(resolve, duration));
        return { success: true, message: `Waited ${duration}ms` };
      }

      // Declared by the server, executed by nobody. Agent Mode's real inspect
      // needs a patrol host and a checkpointId that a pushed task does not
      // carry, so wiring it is separate work — until then it refuses.
      case 'inspect':
      case 'custom':
        return notImplemented(task.actionType);
    }

    // Two guards, and they catch different things.
    //
    // Compile time: every member of `StepActionType` is handled above, so
    // `task.actionType` narrows to `never` here. Adding a member to the union
    // in `types.ts` breaks `npm run typecheck` on this line — there is no
    // default branch left to quietly answer for it.
    const unhandled: never = task.actionType;
    // Run time: the server's union is wider than this one (it also carries
    // `execute_skill`), and nothing on the wire is typed. A string outside the
    // union lands here and is reported failed, never completed.
    return notImplemented(String(unhandled));
  }
}
