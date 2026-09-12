/**
 * @file tasksApi.ts
 * @description API calls for process management endpoints
 * @feature processes
 * @dependencies @/api/client, @/features/processes/types
 * @apiCalls GET /processes/instances/list, GET /processes/instances/:id, POST /processes, PUT /processes/instances/:id/*
 *
 * Note: This API manages "Processes" (user-facing workflows) which map to
 * ProcessInstances on the server. This is distinct from A2A Tasks.
 */

import { apiClient } from '@/api/client';
import type {
  Process as Task,
  ProcessListParams as TaskListParams,
  ProcessListResponse as TaskListResponse,
  ProcessActionRequest as TaskActionRequest,
  ProcessActionResponse as TaskActionResponse,
  CreateProcessRequest as CreateTaskRequest,
} from '../types';
// ============================================================================
// ENDPOINTS
// ============================================================================

const ENDPOINTS = {
  // Process definitions
  definitions: '/processes',
  getDefinition: (id: string) => `/processes/${id}`,
  publishDefinition: (id: string) => `/processes/${id}/publish`,
  startProcess: (id: string) => `/processes/${id}/start`,
  // Process instances (what users see as "Processes")
  instances: '/processes/instances/list',
  getInstance: (id: string) => `/processes/instances/${id}`,
  startInstance: (id: string) => `/processes/instances/${id}/start`,
  pauseInstance: (id: string) => `/processes/instances/${id}/pause`,
  resumeInstance: (id: string) => `/processes/instances/${id}/resume`,
  cancelInstance: (id: string) => `/processes/instances/${id}/cancel`,
  retryInstance: (id: string) => `/processes/instances/${id}/retry`,
} as const;

// ============================================================================
// API FUNCTIONS
// ============================================================================

/**
 * Transform server ProcessInstance to frontend Process
 * Maps field names for compatibility
 */
function transformServerToFrontend(serverData: Record<string, unknown>): Task {
  return {
    ...serverData,
    // Instances carry the definition's name as `processName`; without this the
    // list and the detail page render an automation with no name.
    name: (serverData.name as string | undefined) ?? (serverData.processName as string | undefined) ?? 'Untitled automation',
    // Map assignedRobotIds[0] to robotId for frontend compatibility
    robotId: Array.isArray(serverData.assignedRobotIds) && serverData.assignedRobotIds.length > 0
      ? serverData.assignedRobotIds[0]
      : (serverData.robotId as string || ''),
  } as Task;
}

/**
 * Transform server response list
 */
function transformListResponse(serverResponse: { data: Record<string, unknown>[]; pagination: unknown }): TaskListResponse {
  return {
    tasks: serverResponse.data.map(transformServerToFrontend),
    pagination: serverResponse.pagination as TaskListResponse['pagination'],
  };
}

export const tasksApi = {
  /**
   * List processes with optional filtering and pagination.
   * @param params - Filter and pagination parameters
   * @returns Paginated list of processes
   */
  async listTasks(params?: TaskListParams): Promise<TaskListResponse> {
    const response = await apiClient.get<{ data: Record<string, unknown>[]; pagination: unknown }>(ENDPOINTS.instances, {
      params: {
        status: Array.isArray(params?.status) ? params.status.join(',') : params?.status,
        priority: Array.isArray(params?.priority) ? params.priority.join(',') : params?.priority,
        robotId: params?.robotId,
        search: params?.search,
        page: params?.page,
        limit: params?.pageSize,
        sortBy: params?.sortBy,
        sortOrder: params?.sortOrder,
      },
    });
    return transformListResponse(response.data);
  },

  /**
   * Get a single process by ID.
   * @param id - Process ID
   * @returns Process details
   */
  async getTask(id: string): Promise<Task> {
    const response = await apiClient.get<Record<string, unknown>>(ENDPOINTS.getInstance(id));
    return transformServerToFrontend(response.data);
  },

  /**
   * Create a new process.
   * Creates a process definition and a run that waits: no task reaches a robot
   * until the run is started, either by `startNow` or by the Run act later.
   * @param data - Process creation data
   * @returns Created process instance
   */
  async createTask(data: CreateTaskRequest): Promise<Task> {
    // An automation with no steps used to get one invented `custom` step named
    // after it — a step the agent has no code for, which it now refuses. There
    // is nothing honest to send, so this fails before the request.
    if (!data.steps || data.steps.length === 0) {
      throw new Error('An automation needs at least one step');
    }

    // The action type the user picked travels verbatim. Hardcoding 'custom'
    // here is what made every automation a row of fake completed steps.
    const stepTemplates = data.steps.map((step, index) => ({
      order: index + 1,
      name: step.name,
      description: step.description,
      actionType: step.actionType,
      actionConfig: step.actionConfig,
    }));

    const definitionResponse = await apiClient.post<{ id: string }>(ENDPOINTS.definitions, {
      name: data.name,
      description: data.description,
      stepTemplates,
    });

    // Publish the definition (draft → ready)
    await apiClient.post(ENDPOINTS.publishDefinition(definitionResponse.data.id));

    // Then start the process
    const instanceResponse = await apiClient.post<Record<string, unknown>>(
      ENDPOINTS.startProcess(definitionResponse.data.id),
      {
        priority: data.priority,
        preferredRobotIds: data.robotId ? [data.robotId] : undefined,
        // Creating an automation must not dispatch a robot: the run stays
        // pending unless the form explicitly asked for it to run now.
        autoStart: data.startNow === true,
      }
    );

    return transformServerToFrontend(instanceResponse.data);
  },

  /**
   * Execute an action on a process.
   * @param taskId - Process ID
   * @param action - Action to execute
   * @returns Updated process
   */
  async executeAction(taskId: string, action: TaskActionRequest): Promise<TaskActionResponse> {
    // Map action to endpoint
    let endpoint: string;
    switch (action.action) {
      case 'pause':
        endpoint = ENDPOINTS.pauseInstance(taskId);
        break;
      case 'resume':
        endpoint = ENDPOINTS.resumeInstance(taskId);
        break;
      case 'cancel':
        endpoint = ENDPOINTS.cancelInstance(taskId);
        break;
      case 'retry':
        endpoint = ENDPOINTS.retryInstance(taskId);
        break;
      default:
        throw new Error(`Unknown action: ${action.action}`);
    }

    const response = await apiClient.put<Record<string, unknown>>(endpoint);
    const task = transformServerToFrontend(response.data);
    return { task, message: `Process ${action.action}d successfully` };
  },

  /**
   * Start a process that was created but never run.
   * @param taskId - Process ID
   * @returns Updated process
   */
  async startTask(taskId: string): Promise<Task> {
    const response = await apiClient.put<Record<string, unknown>>(ENDPOINTS.startInstance(taskId));
    return transformServerToFrontend(response.data);
  },

  /**
   * Pause a process.
   * @param taskId - Process ID
   * @returns Updated process
   */
  async pauseTask(taskId: string): Promise<Task> {
    const response = await tasksApi.executeAction(taskId, { action: 'pause' });
    return response.task;
  },

  /**
   * Resume a paused process.
   * @param taskId - Process ID
   * @returns Updated process
   */
  async resumeTask(taskId: string): Promise<Task> {
    const response = await tasksApi.executeAction(taskId, { action: 'resume' });
    return response.task;
  },

  /**
   * Cancel a process.
   * @param taskId - Process ID
   * @returns Updated process
   */
  async cancelTask(taskId: string): Promise<Task> {
    const response = await tasksApi.executeAction(taskId, { action: 'cancel' });
    return response.task;
  },

  /**
   * Retry a failed or cancelled process.
   * Resumes execution from the first failed/cancelled step.
   * @param taskId - Process ID
   * @returns Updated process
   */
  async retryTask(taskId: string): Promise<Task> {
    const response = await tasksApi.executeAction(taskId, { action: 'retry' });
    return response.task;
  },

  /**
   * Get processes for a specific robot.
   * @param robotId - Robot ID
   * @param params - Additional filter parameters
   * @returns Paginated list of processes for the robot
   */
  async getTasksByRobot(robotId: string, params?: Omit<TaskListParams, 'robotId'>): Promise<TaskListResponse> {
    return tasksApi.listTasks({ ...params, robotId });
  },

  /**
   * Get active processes (pending, queued, in_progress, paused).
   * @param params - Additional filter parameters
   * @returns Paginated list of active processes
   */
  async getActiveTasks(params?: Omit<TaskListParams, 'status'>): Promise<TaskListResponse> {
    return tasksApi.listTasks({
      ...params,
      status: ['pending', 'queued', 'in_progress', 'paused'],
    });
  },
};
