/**
 * @file TaskDistributor.ts
 * @description Service for distributing tasks to robots (Push model)
 * @feature processes
 *
 * Assigns tasks to robots based on:
 * - Robot status (online/busy)
 * - Capabilities match
 * - Current queue size
 * - Proximity to task location
 * - Battery level
 */

import { EventEmitter } from 'events';
import { robotTaskRepository } from '../repositories/RobotTaskRepository.js';
import { processRepository } from '../repositories/ProcessRepository.js';
import { processManager } from './ProcessManager.js';
import { robotManager, type Robot, type RobotLocation } from './RobotManager.js';
import type { Priority } from '../types/process.types.js';
import type {
  RobotTask,
  RobotScore,
  DistributionResult,
  TaskEvent,
  RobotTaskResult,
  CreateRobotTaskRequest,
  RobotTaskSource,
} from '../types/robotTask.types.js';

// Simple logger wrapper
const logger = {
  info: (msg: string) => console.log(`[TaskDistributor] ${msg}`),
  warn: (msg: string) => console.warn(`[TaskDistributor] ${msg}`),
  error: (msg: string, err?: unknown) => console.error(`[TaskDistributor] ${msg}`, err ?? ''),
  debug: (msg: string) => console.log(`[TaskDistributor:debug] ${msg}`),
};

// Maximum number of tasks in a robot's queue
const MAX_QUEUE_SIZE = 5;

// Priority weights for scoring
const PRIORITY_WEIGHTS: Record<Priority, number> = {
  critical: 100,
  high: 75,
  normal: 50,
  low: 25,
};

export class TaskDistributor extends EventEmitter {
  private static instance: TaskDistributor;
  private distributionInterval: NodeJS.Timeout | null = null;

  private constructor() {
    super();
    this.setupEventListeners();
  }

  static getInstance(): TaskDistributor {
    if (!TaskDistributor.instance) {
      TaskDistributor.instance = new TaskDistributor();
    }
    return TaskDistributor.instance;
  }

  /**
   * Start the distribution loop
   */
  start(): void {
    if (this.distributionInterval) return;

    // Run distribution every 2 seconds
    this.distributionInterval = setInterval(() => {
      this.distributePendingTasks().catch((err) => {
        logger.error('Error distributing tasks:', err);
      });
    }, 2000);

    logger.info('TaskDistributor started');
  }

  /**
   * Stop the distribution loop
   */
  stop(): void {
    if (this.distributionInterval) {
      clearInterval(this.distributionInterval);
      this.distributionInterval = null;
      logger.info('TaskDistributor stopped');
    }
  }

  private setupEventListeners(): void {
    // Listen for new tasks from ProcessManager
    processManager.on('task:created', (task: RobotTask) => {
      this.distributeTask(task).catch((err) => {
        logger.error(`Error distributing task ${task.id}:`, err);
      });
    });
  }

  // ============================================================================
  // TASK CREATION
  // ============================================================================

  /**
   * Create a new task (from Command or manual)
   */
  async createTask(
    request: CreateRobotTaskRequest,
    source: RobotTaskSource
  ): Promise<RobotTask> {
    const task = await robotTaskRepository.create(request, source);

    this.emitTaskEvent({
      type: 'task:created',
      task,
    });

    // If robot is specified, assign directly
    if (request.robotId) {
      await this.assignTaskToRobot(task.id, request.robotId);
    } else {
      // Otherwise, distribute
      await this.distributeTask(task);
    }

    return task;
  }

  // ============================================================================
  // TASK DISTRIBUTION
  // ============================================================================

  /**
   * Distribute all pending tasks
   */
  async distributePendingTasks(): Promise<DistributionResult[]> {
    const pendingTasks = await robotTaskRepository.findPendingTasks(10);
    const results: DistributionResult[] = [];

    for (const task of pendingTasks) {
      const result = await this.distributeTask(task);
      results.push(result);
    }

    return results;
  }

  /**
   * Distribute a single task to the best available robot
   */
  async distributeTask(task: RobotTask): Promise<DistributionResult> {
    // If already assigned, skip
    if (task.status !== 'pending') {
      return {
        taskId: task.id,
        robotId: task.robotId || null,
        success: false,
        reason: 'Task is not pending',
      };
    }

    // Find eligible robots
    const eligibleRobots = await this.findEligibleRobots(task);
    if (eligibleRobots.length === 0) {
      logger.debug(`No eligible robots for task ${task.id}`);
      return {
        taskId: task.id,
        robotId: null,
        success: false,
        reason: 'No eligible robots available',
      };
    }

    // Score and rank robots
    const scoredRobots = await this.scoreRobots(eligibleRobots, task);
    scoredRobots.sort((a, b) => b.score - a.score);

    // Assign to best robot
    const bestRobot = scoredRobots[0];
    const assigned = await this.assignTaskToRobot(task.id, bestRobot.robotId);

    if (assigned) {
      logger.info(
        `Assigned task ${task.id} to robot ${bestRobot.robotId} (score: ${bestRobot.score})`
      );
      return {
        taskId: task.id,
        robotId: bestRobot.robotId,
        success: true,
        scores: scoredRobots,
      };
    }

    return {
      taskId: task.id,
      robotId: null,
      success: false,
      reason: 'Failed to assign task',
      scores: scoredRobots,
    };
  }

  /**
   * Find robots eligible to handle a task
   */
  private async findEligibleRobots(task: RobotTask): Promise<Robot[]> {
    const allRobots = await robotManager.listRobots();

    return allRobots.filter((robot: Robot) => {
      // Must be online or busy
      if (!['online', 'busy'].includes(robot.status)) {
        return false;
      }

      // Check required capabilities
      const requiredCaps = (task.actionConfig.requiredCapabilities as string[]) ?? [];
      if (requiredCaps.length > 0) {
        const robotCaps = robot.capabilities ?? [];
        if (!requiredCaps.every((cap) => robotCaps.includes(cap))) {
          return false;
        }
      }

      return true;
    });
  }

  /**
   * Score robots for a task
   */
  private async scoreRobots(robots: Robot[], task: RobotTask): Promise<RobotScore[]> {
    const scores: RobotScore[] = [];

    for (const robot of robots) {
      const score = await this.calculateRobotScore(robot, task);
      scores.push(score);
    }

    return scores;
  }

  /**
   * Calculate a robot's score for a specific task
   */
  private async calculateRobotScore(robot: Robot, task: RobotTask): Promise<RobotScore> {
    let score = 0;
    const reasons: string[] = [];

    // 1. Queue size (prefer robots with shorter queues)
    const queueSize = await robotTaskRepository.countByRobot(robot.id, ['assigned', 'executing']);
    if (queueSize >= MAX_QUEUE_SIZE) {
      return { robotId: robot.id, score: -1, reasons: ['Queue full'] };
    }
    const queueScore = (MAX_QUEUE_SIZE - queueSize) * 10;
    score += queueScore;
    reasons.push(`Queue: ${queueSize}/${MAX_QUEUE_SIZE} (+${queueScore})`);

    // 2. Status (prefer idle robots)
    if (robot.status === 'online') {
      score += 50;
      reasons.push('Idle (+50)');
    } else {
      reasons.push('Busy (+0)');
    }

    // 3. Battery level
    const batteryScore = robot.batteryLevel;
    score += batteryScore;
    reasons.push(`Battery: ${robot.batteryLevel}% (+${batteryScore})`);

    // 4. Proximity to task location (if applicable)
    const taskLocation = task.actionConfig.location as RobotLocation | undefined;
    if (taskLocation && robot.location) {
      const distance = this.calculateDistance(robot.location, taskLocation);
      const proximityScore = Math.max(0, 100 - distance);
      score += proximityScore;
      reasons.push(`Proximity: ${distance.toFixed(0)}m (+${proximityScore.toFixed(0)})`);
    }

    // 5. Priority preference (assign high-priority tasks to healthier robots)
    if (['critical', 'high'].includes(task.priority) && robot.batteryLevel > 50) {
      score += 25;
      reasons.push('High-priority capable (+25)');
    }

    // 6. Preferred robot bonus
    if (task.processInstanceId) {
      const instance = await processRepository.findInstanceById(task.processInstanceId);
      if (instance?.preferredRobotIds?.includes(robot.id)) {
        score += 100;
        reasons.push('Preferred robot (+100)');
      }
    }

    return { robotId: robot.id, score, reasons };
  }

  /**
   * Calculate distance between two locations
   */
  private calculateDistance(loc1: RobotLocation, loc2: RobotLocation): number {
    const dx = (loc1.x ?? 0) - (loc2.x ?? 0);
    const dy = (loc1.y ?? 0) - (loc2.y ?? 0);
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * Assign a task to a specific robot
   */
  async assignTaskToRobot(taskId: string, robotId: string): Promise<boolean> {
    const task = await robotTaskRepository.assignToRobot(taskId, robotId);
    if (!task) {
      return false;
    }

    this.emitTaskEvent({
      type: 'task:assigned',
      task,
      robotId,
    });

    // Update process instance if applicable
    if (task.processInstanceId) {
      await processRepository.addAssignedRobot(task.processInstanceId, robotId);
    }

    // Notify robot via WebSocket (to be implemented in websocket handler)
    this.emit('robot:work_assigned', {
      robotId,
      task,
    });

    return true;
  }

  // ============================================================================
  // TASK STATUS UPDATES
  // ============================================================================

  /**
   * Update task status (called by robot agent)
   */
  async updateTaskStatus(
    taskId: string,
    status: 'executing' | 'completed' | 'failed',
    data?: {
      a2aTaskId?: string;
      a2aContextId?: string;
      result?: RobotTaskResult;
      error?: string;
    }
  ): Promise<RobotTask | null> {
    let task: RobotTask | null = null;

    switch (status) {
      case 'executing':
        task = await robotTaskRepository.updateStatus(
          taskId,
          'executing',
          data?.a2aTaskId,
          data?.a2aContextId
        );
        if (task) {
          this.emitTaskEvent({ type: 'task:progress', taskId, robotId: task.robotId, progress: 0 });
        }
        break;

      case 'completed':
        if (!data?.result) {
          logger.warn(`Task ${taskId} completed without result`);
          return null;
        }
        task = await robotTaskRepository.complete(taskId, data.result);
        if (task) {
          this.emitTaskEvent({ type: 'task:completed', task, result: data.result });

          // Notify ProcessManager
          if (task.stepInstanceId) {
            await processManager.onStepCompleted(task.stepInstanceId, {
              success: data.result.success,
              data: data.result.data,
              message: data.result.message,
            });
          }
        }
        break;

      case 'failed':
        task = await robotTaskRepository.fail(taskId, data?.error ?? 'Unknown error');
        if (task) {
          this.emitTaskEvent({ type: 'task:failed', task, error: data?.error ?? 'Unknown error' });

          // Notify ProcessManager
          if (task.stepInstanceId) {
            await processManager.onStepCompleted(task.stepInstanceId, {
              success: false,
              message: data?.error ?? 'Unknown error',
            });
          }
        }
        break;
    }

    return task;
  }

  /**
   * Update task progress
   */
  async updateTaskProgress(taskId: string, progress: number, message?: string): Promise<void> {
    const task = await robotTaskRepository.findById(taskId);
    if (task) {
      this.emitTaskEvent({
        type: 'task:progress',
        taskId,
        robotId: task.robotId,
        progress,
        message,
      });
    }
  }

  /**
   * Cancel a task
   */
  async cancelTask(taskId: string, reason?: string): Promise<RobotTask | null> {
    const task = await robotTaskRepository.cancel(taskId, reason);
    if (task) {
      this.emitTaskEvent({
        type: 'task:failed',
        task,
        error: reason ?? 'Cancelled',
      });

      // Notify robot to stop
      this.emit('robot:work_cancelled', {
        robotId: task.robotId,
        taskId: task.id,
        reason,
      });
    }
    return task;
  }

  // ============================================================================
  // QUERY METHODS
  // ============================================================================

  async getTask(id: string): Promise<RobotTask | null> {
    return robotTaskRepository.findById(id);
  }

  async getTasksByRobot(robotId: string): Promise<RobotTask[]> {
    return robotTaskRepository.findByRobotId(robotId);
  }

  async getQueueStats() {
    return robotTaskRepository.getQueueStats();
  }

  // ============================================================================
  // EVENT HELPERS
  // ============================================================================

  private emitTaskEvent(event: TaskEvent): void {
    this.emit(event.type, event);
    this.emit('task:event', event);
  }

  /**
   * Subscribe to all task events
   */
  onTaskEvent(handler: (event: TaskEvent) => void): void {
    this.on('task:event', handler);
  }
}

export const taskDistributor = TaskDistributor.getInstance();
