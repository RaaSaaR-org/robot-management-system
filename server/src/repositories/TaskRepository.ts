/**
 * @file TaskRepository.ts
 * @description Data access layer for Task entities
 */

import { prisma } from '../database/index.js';
import { dbTaskToDomain } from '../database/types.js';
import type { A2ATask, A2ATaskStatus, A2AMessage, A2AArtifact } from '../types/index.js';

export class TaskRepository {
  /**
   * Find a task by ID
   */
  async findById(id: string): Promise<A2ATask | null> {
    const task = await prisma.task.findUnique({
      where: { id },
    });
    return task ? dbTaskToDomain(task) : null;
  }

  /**
   * Find all tasks
   */
  async findAll(): Promise<A2ATask[]> {
    const tasks = await prisma.task.findMany({
      orderBy: { updatedAt: 'desc' },
    });
    return tasks.map(dbTaskToDomain);
  }

  /**
   * Find tasks by conversation ID
   */
  async findByConversationId(conversationId: string): Promise<A2ATask[]> {
    const tasks = await prisma.task.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
    });
    return tasks.map(dbTaskToDomain);
  }

  /**
   * Find tasks by state
   */
  async findByState(state: string): Promise<A2ATask[]> {
    const tasks = await prisma.task.findMany({
      where: { state },
      orderBy: { updatedAt: 'desc' },
    });
    return tasks.map(dbTaskToDomain);
  }

  /**
   * Create a new task
   */
  async create(conversationId?: string): Promise<A2ATask> {
    const task = await prisma.task.create({
      data: {
        conversationId,
        state: 'submitted',
        artifacts: '[]',
        history: '[]',
      },
    });
    return dbTaskToDomain(task);
  }

  /**
   * Update task status
   */
  async updateStatus(id: string, status: A2ATaskStatus): Promise<A2ATask | null> {
    try {
      // Get current task to update history
      const currentTask = await prisma.task.findUnique({ where: { id } });
      if (!currentTask) return null;

      const currentHistory = JSON.parse(currentTask.history) as A2AMessage[];
      const newHistory = status.message ? [...currentHistory, status.message] : currentHistory;

      const task = await prisma.task.update({
        where: { id },
        data: {
          state: status.state,
          statusMessage: status.message ? JSON.stringify(status.message) : null,
          statusTimestamp: status.timestamp ? new Date(status.timestamp) : new Date(),
          history: JSON.stringify(newHistory),
        },
      });
      return dbTaskToDomain(task);
    } catch {
      return null;
    }
  }

  /**
   * Add artifact to task
   */
  async addArtifact(id: string, artifact: A2AArtifact): Promise<A2ATask | null> {
    try {
      const currentTask = await prisma.task.findUnique({ where: { id } });
      if (!currentTask) return null;

      const currentArtifacts = JSON.parse(currentTask.artifacts) as A2AArtifact[];
      const newArtifacts = [...currentArtifacts, artifact];

      const task = await prisma.task.update({
        where: { id },
        data: {
          artifacts: JSON.stringify(newArtifacts),
        },
      });
      return dbTaskToDomain(task);
    } catch {
      return null;
    }
  }

  /**
   * Delete a task
   */
  async delete(id: string): Promise<boolean> {
    try {
      await prisma.task.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  }
}

export const taskRepository = new TaskRepository();
