/**
 * @file TaskQueue.ts
 * @description Manages robot task queue for server-pushed tasks
 * @feature robot
 */

import type {
  SimulatedRobotState,
  RobotLocation,
  CommandResult,
  PushedTask,
} from './types.js';
import { config } from '../config/config.js';

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
    try {
      const response = await fetch(`${config.serverUrl}/api/processes/tasks/${taskId}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, result, error }),
      });

      if (!response.ok) {
        console.error(`[TaskQueue] Failed to report task ${taskId} status: HTTP ${response.status}`);
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

      case 'inspect':
      case 'custom':
      default:
        // Simulate successful completion
        console.log(`[TaskQueue] Simulating ${task.actionType} action`);
        await new Promise((resolve) => setTimeout(resolve, 2000));
        return { success: true, message: `Completed ${task.actionType}` };
    }
  }
}
