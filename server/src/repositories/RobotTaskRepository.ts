/**
 * @file RobotTaskRepository.ts
 * @description Data access layer for RobotTask entities (work items for robots)
 * @feature processes
 */

import { prisma } from '../database/index.js';
import { dbRobotTaskToDomain } from '../database/types.js';
import type { Priority } from '../types/process.types.js';
import type {
  RobotTask,
  RobotTaskStatus,
  RobotTaskSource,
  RobotTaskResult,
  RobotTaskListFilters,
  CreateRobotTaskRequest,
  TaskQueueStats,
} from '../types/robotTask.types.js';
import type { PaginationParams, PaginatedResponse } from '../types/process.types.js';
import { v4 as uuidv4 } from 'uuid';

export class RobotTaskRepository {
  /**
   * Find a robot task by ID
   */
  async findById(id: string): Promise<RobotTask | null> {
    const task = await prisma.robotTask.findUnique({ where: { id } });
    return task ? dbRobotTaskToDomain(task) : null;
  }

  /**
   * Find all robot tasks with optional filters and pagination
   */
  async findAll(
    filters?: RobotTaskListFilters,
    pagination?: PaginationParams
  ): Promise<PaginatedResponse<RobotTask>> {
    const page = pagination?.page ?? 1;
    const limit = pagination?.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (filters?.status) {
      where.status = Array.isArray(filters.status) ? { in: filters.status } : filters.status;
    }
    if (filters?.priority) {
      where.priority = Array.isArray(filters.priority) ? { in: filters.priority } : filters.priority;
    }
    if (filters?.robotId) {
      where.robotId = filters.robotId;
    }
    if (filters?.processInstanceId) {
      where.processInstanceId = filters.processInstanceId;
    }
    if (filters?.source) {
      where.source = filters.source;
    }
    if (filters?.dateRange) {
      where.createdAt = {
        gte: new Date(filters.dateRange.start),
        lte: new Date(filters.dateRange.end),
      };
    }

    const [total, tasks] = await Promise.all([
      prisma.robotTask.count({ where }),
      prisma.robotTask.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [pagination?.sortBy ?? 'createdAt']: pagination?.sortOrder ?? 'desc' },
      }),
    ]);

    return {
      data: tasks.map(dbRobotTaskToDomain),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Find pending tasks for distribution
   */
  async findPendingTasks(limit = 10): Promise<RobotTask[]> {
    const tasks = await prisma.robotTask.findMany({
      where: { status: 'pending' },
      orderBy: [
        { priority: 'desc' }, // critical > high > normal > low
        { createdAt: 'asc' }, // oldest first
      ],
      take: limit,
    });
    return tasks.map(dbRobotTaskToDomain);
  }

  /**
   * Find tasks assigned to a robot
   */
  async findByRobotId(
    robotId: string,
    statuses?: RobotTaskStatus[]
  ): Promise<RobotTask[]> {
    const where: Record<string, unknown> = { robotId };
    if (statuses && statuses.length > 0) {
      where.status = { in: statuses };
    }

    const tasks = await prisma.robotTask.findMany({
      where,
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    });
    return tasks.map(dbRobotTaskToDomain);
  }

  /**
   * Find tasks by process instance ID
   */
  async findByProcessInstanceId(processInstanceId: string): Promise<RobotTask[]> {
    const tasks = await prisma.robotTask.findMany({
      where: { processInstanceId },
      orderBy: { createdAt: 'asc' },
    });
    return tasks.map(dbRobotTaskToDomain);
  }

  /**
   * Create a new robot task
   */
  async create(
    request: CreateRobotTaskRequest,
    source: RobotTaskSource,
    processInstanceId?: string,
    stepInstanceId?: string
  ): Promise<RobotTask> {
    const id = uuidv4();
    const now = new Date();

    const task = await prisma.robotTask.create({
      data: {
        id,
        processInstanceId,
        stepInstanceId,
        source,
        robotId: request.robotId ?? undefined, // null until assigned by TaskDistributor
        priority: request.priority ?? 'normal',
        status: request.robotId ? 'assigned' : 'pending',
        actionType: request.actionType,
        actionConfig: JSON.stringify(request.actionConfig),
        instruction: request.instruction,
        assignedAt: request.robotId ? now : undefined,
        timeoutMs: request.timeoutMs,
        maxRetries: request.maxRetries ?? 3,
        retryCount: 0,
      },
    });

    return dbRobotTaskToDomain(task);
  }

  /**
   * Assign a task to a robot
   */
  async assignToRobot(taskId: string, robotId: string): Promise<RobotTask | null> {
    try {
      const task = await prisma.robotTask.update({
        where: { id: taskId, status: 'pending' },
        data: {
          robotId,
          status: 'assigned',
          assignedAt: new Date(),
        },
      });
      return dbRobotTaskToDomain(task);
    } catch {
      return null;
    }
  }

  /**
   * Update task status
   */
  async updateStatus(
    id: string,
    status: RobotTaskStatus,
    a2aTaskId?: string,
    a2aContextId?: string
  ): Promise<RobotTask | null> {
    try {
      const updateData: Record<string, unknown> = { status };

      if (status === 'executing') {
        updateData.startedAt = new Date();
      } else if (status === 'completed' || status === 'failed' || status === 'cancelled') {
        updateData.completedAt = new Date();
      }
      if (a2aTaskId !== undefined) {
        updateData.a2aTaskId = a2aTaskId;
      }
      if (a2aContextId !== undefined) {
        updateData.a2aContextId = a2aContextId;
      }

      const task = await prisma.robotTask.update({
        where: { id },
        data: updateData,
      });
      return dbRobotTaskToDomain(task);
    } catch {
      return null;
    }
  }

  /**
   * Complete a task with result
   */
  async complete(id: string, result: RobotTaskResult): Promise<RobotTask | null> {
    try {
      const task = await prisma.robotTask.update({
        where: { id },
        data: {
          status: result.success ? 'completed' : 'failed',
          result: JSON.stringify(result),
          completedAt: new Date(),
          error: result.success ? undefined : result.message,
        },
      });
      return dbRobotTaskToDomain(task);
    } catch {
      return null;
    }
  }

  /**
   * Fail a task with error
   */
  async fail(id: string, error: string): Promise<RobotTask | null> {
    try {
      const task = await prisma.robotTask.update({
        where: { id },
        data: {
          status: 'failed',
          error,
          completedAt: new Date(),
        },
      });
      return dbRobotTaskToDomain(task);
    } catch {
      return null;
    }
  }

  /**
   * Cancel a task
   */
  async cancel(id: string, reason?: string): Promise<RobotTask | null> {
    try {
      const task = await prisma.robotTask.update({
        where: { id },
        data: {
          status: 'cancelled',
          error: reason ?? 'Cancelled by user',
          completedAt: new Date(),
        },
      });
      return dbRobotTaskToDomain(task);
    } catch {
      return null;
    }
  }

  /**
   * Increment retry count and reset to pending
   */
  async retry(id: string): Promise<RobotTask | null> {
    try {
      const task = await prisma.robotTask.update({
        where: { id },
        data: {
          status: 'pending',
          retryCount: { increment: 1 },
          error: null,
          result: null,
          startedAt: null,
          completedAt: null,
        },
      });
      return dbRobotTaskToDomain(task);
    } catch {
      return null;
    }
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(): Promise<TaskQueueStats> {
    const [statusCounts, priorityCounts, robotCounts] = await Promise.all([
      prisma.robotTask.groupBy({
        by: ['status'],
        _count: true,
      }),
      prisma.robotTask.groupBy({
        by: ['priority'],
        where: { status: { in: ['pending', 'assigned'] } },
        _count: true,
      }),
      prisma.robotTask.groupBy({
        by: ['robotId', 'status'],
        where: { status: { in: ['assigned', 'executing'] } },
        _count: true,
      }),
    ]);

    const stats: TaskQueueStats = {
      pending: 0,
      assigned: 0,
      executing: 0,
      completed: 0,
      failed: 0,
      byPriority: { critical: 0, high: 0, normal: 0, low: 0 },
      byRobot: {},
    };

    for (const sc of statusCounts) {
      const status = sc.status as RobotTaskStatus;
      if (status === 'pending') stats.pending = sc._count;
      else if (status === 'assigned') stats.assigned = sc._count;
      else if (status === 'executing') stats.executing = sc._count;
      else if (status === 'completed') stats.completed = sc._count;
      else if (status === 'failed') stats.failed = sc._count;
    }

    for (const pc of priorityCounts) {
      const priority = pc.priority as Priority;
      if (priority in stats.byPriority) {
        stats.byPriority[priority] = pc._count;
      }
    }

    for (const rc of robotCounts) {
      if (!rc.robotId) continue;
      if (!stats.byRobot[rc.robotId]) {
        stats.byRobot[rc.robotId] = { queued: 0, executing: 0 };
      }
      if (rc.status === 'assigned') {
        stats.byRobot[rc.robotId].queued = rc._count;
      } else if (rc.status === 'executing') {
        stats.byRobot[rc.robotId].executing = rc._count;
      }
    }

    return stats;
  }

  /**
   * Count tasks by robot
   */
  async countByRobot(robotId: string, statuses?: RobotTaskStatus[]): Promise<number> {
    const where: Record<string, unknown> = { robotId };
    if (statuses && statuses.length > 0) {
      where.status = { in: statuses };
    }
    return prisma.robotTask.count({ where });
  }

  /**
   * Delete a task
   */
  async delete(id: string): Promise<boolean> {
    try {
      await prisma.robotTask.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  }
}

export const robotTaskRepository = new RobotTaskRepository();
