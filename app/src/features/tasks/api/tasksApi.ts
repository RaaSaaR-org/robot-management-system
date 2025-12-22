/**
 * @file tasksApi.ts
 * @description API calls for task management endpoints
 * @feature tasks
 * @dependencies @/api/client, @/features/tasks/types
 * @apiCalls GET /tasks, GET /tasks/:id, POST /tasks, POST /tasks/:id/action
 */

import { apiClient } from '@/api/client';
import type {
  Task,
  TaskListParams,
  TaskListResponse,
  TaskActionRequest,
  TaskActionResponse,
  CreateTaskRequest,
} from '../types/tasks.types';
import {
  getMockTaskList,
  getMockTask,
  createMockTask,
  executeMockTaskAction,
  mockDelay,
} from '@/mocks/taskMockData';

// ============================================================================
// ENDPOINTS
// ============================================================================

const ENDPOINTS = {
  list: '/tasks',
  get: (id: string) => `/tasks/${id}`,
  create: '/tasks',
  action: (id: string) => `/tasks/${id}/action`,
  steps: (id: string) => `/tasks/${id}/steps`,
} as const;

// ============================================================================
// API FUNCTIONS
// ============================================================================

export const tasksApi = {
  /**
   * List tasks with optional filtering and pagination.
   * @param params - Filter and pagination parameters
   * @returns Paginated list of tasks
   */
  async listTasks(params?: TaskListParams): Promise<TaskListResponse> {
    // Development mode: return mock data
    if (import.meta.env.DEV) {
      await mockDelay();
      return getMockTaskList(params);
    }

    const response = await apiClient.get<TaskListResponse>(ENDPOINTS.list, {
      params: {
        status: Array.isArray(params?.status) ? params.status.join(',') : params?.status,
        priority: Array.isArray(params?.priority) ? params.priority.join(',') : params?.priority,
        robotId: params?.robotId,
        search: params?.search,
        dateFrom: params?.dateFrom,
        dateTo: params?.dateTo,
        page: params?.page,
        pageSize: params?.pageSize,
        sortBy: params?.sortBy,
        sortOrder: params?.sortOrder,
      },
    });
    return response.data;
  },

  /**
   * Get a single task by ID.
   * @param id - Task ID
   * @returns Task details
   */
  async getTask(id: string): Promise<Task> {
    // Development mode: return mock data
    if (import.meta.env.DEV) {
      await mockDelay();
      const task = getMockTask(id);
      if (!task) {
        throw new Error(`Task ${id} not found`);
      }
      return task;
    }

    const response = await apiClient.get<Task>(ENDPOINTS.get(id));
    return response.data;
  },

  /**
   * Create a new task.
   * @param data - Task creation data
   * @returns Created task
   */
  async createTask(data: CreateTaskRequest): Promise<Task> {
    // Development mode: return mock task
    if (import.meta.env.DEV) {
      await mockDelay(500);
      return createMockTask(data);
    }

    const response = await apiClient.post<Task>(ENDPOINTS.create, data);
    return response.data;
  },

  /**
   * Execute an action on a task.
   * @param taskId - Task ID
   * @param action - Action to execute
   * @returns Updated task
   */
  async executeAction(taskId: string, action: TaskActionRequest): Promise<TaskActionResponse> {
    // Development mode: return mock response
    if (import.meta.env.DEV) {
      await mockDelay(300);
      return executeMockTaskAction(taskId, action);
    }

    const response = await apiClient.post<TaskActionResponse>(ENDPOINTS.action(taskId), action);
    return response.data;
  },

  /**
   * Pause a task.
   * @param taskId - Task ID
   * @returns Updated task
   */
  async pauseTask(taskId: string): Promise<Task> {
    const response = await tasksApi.executeAction(taskId, { action: 'pause' });
    return response.task;
  },

  /**
   * Resume a paused task.
   * @param taskId - Task ID
   * @returns Updated task
   */
  async resumeTask(taskId: string): Promise<Task> {
    const response = await tasksApi.executeAction(taskId, { action: 'resume' });
    return response.task;
  },

  /**
   * Cancel a task.
   * @param taskId - Task ID
   * @returns Updated task
   */
  async cancelTask(taskId: string): Promise<Task> {
    const response = await tasksApi.executeAction(taskId, { action: 'cancel' });
    return response.task;
  },

  /**
   * Retry a failed task.
   * @param taskId - Task ID
   * @returns Updated task
   */
  async retryTask(taskId: string): Promise<Task> {
    const response = await tasksApi.executeAction(taskId, { action: 'retry' });
    return response.task;
  },

  /**
   * Get tasks for a specific robot.
   * @param robotId - Robot ID
   * @param params - Additional filter parameters
   * @returns Paginated list of tasks for the robot
   */
  async getTasksByRobot(robotId: string, params?: Omit<TaskListParams, 'robotId'>): Promise<TaskListResponse> {
    return tasksApi.listTasks({ ...params, robotId });
  },

  /**
   * Get active tasks (pending, queued, in_progress, paused).
   * @param params - Additional filter parameters
   * @returns Paginated list of active tasks
   */
  async getActiveTasks(params?: Omit<TaskListParams, 'status'>): Promise<TaskListResponse> {
    return tasksApi.listTasks({
      ...params,
      status: ['pending', 'queued', 'in_progress', 'paused'],
    });
  },
};
