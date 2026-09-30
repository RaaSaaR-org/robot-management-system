/**
 * @file robotsApi.ts
 * @description API calls for robot management endpoints
 * @feature robots
 * @dependencies @/api/client
 */

import { apiClient } from '@/api/client';
import type {
  Robot,
  RobotTelemetry,
  RobotCommand,
  RobotCommandRequest,
  RobotListParams,
  RobotListResponse,
  CommandListResponse,
  TelemetryHistoryParams,
  TelemetryHistoryResponse,
  FrameRegistration,
  FrameRegistrationRequest,
  SitePlace,
} from '../types/robots.types';

// ============================================================================
// ENDPOINTS
// ============================================================================

// Note: apiClient already has /api prefix in baseURL
const ENDPOINTS = {
  list: '/robots',
  register: '/robots/register',
  get: (id: string) => `/robots/${id}`,
  command: (id: string) => `/robots/${id}/command`,
  telemetry: (id: string) => `/robots/${id}/telemetry`,
  telemetryHistory: (id: string) => `/robots/${id}/telemetry/history`,
  frameRegistration: (id: string) => `/robots/${id}/frame-registration`,
  places: (id: string) => `/robots/${id}/places`,
} as const;

function isNotFound(error: unknown): boolean {
  return (error as { response?: { status?: number } })?.response?.status === 404;
}

// ============================================================================
// API FUNCTIONS
// ============================================================================

export const robotsApi = {
  /**
   * Register a robot from its base URL.
   * @param robotUrl - Robot's base URL (e.g., http://localhost:41243)
   * @returns Registered robot with endpoints and agent card
   */
  async registerRobot(robotUrl: string): Promise<{
    robot: Robot;
    endpoints: {
      robot: string;
      command: string;
      telemetry: string;
      telemetryWs: string;
    };
  }> {
    const response = await apiClient.post<{
      robot: Robot;
      endpoints: {
        robot: string;
        command: string;
        telemetry: string;
        telemetryWs: string;
      };
    }>(ENDPOINTS.register, { robotUrl });
    return response.data;
  },

  /**
   * Unregister a robot by ID.
   * @param robotId - Robot ID
   */
  async unregisterRobot(robotId: string): Promise<void> {
    await apiClient.delete(ENDPOINTS.get(robotId));
  },

  /**
   * List robots with optional filtering and pagination.
   * @param params - Filter and pagination parameters
   * @returns Paginated list of robots
   */
  async listRobots(params?: RobotListParams): Promise<RobotListResponse> {
    const response = await apiClient.get<RobotListResponse>(ENDPOINTS.list, {
      params: {
        status: params?.status,
        search: params?.search,
        capabilities: params?.capabilities?.join(','),
        page: params?.page,
        pageSize: params?.pageSize,
        sortBy: params?.sortBy,
        sortOrder: params?.sortOrder,
      },
    });
    return response.data;
  },

  /**
   * Get a single robot by ID.
   * @param id - Robot ID
   * @returns Robot details
   */
  async getRobot(id: string): Promise<Robot> {
    const response = await apiClient.get<Robot>(ENDPOINTS.get(id));
    return response.data;
  },

  /**
   * Bind a robot to a site (TASK-327), or unbind it with `null`.
   * @param robotId - Robot ID
   * @param twinId - Digital twin id of the site, or null for no site
   * @returns The updated robot
   */
  async updateRobotSite(robotId: string, twinId: string | null): Promise<Robot> {
    const response = await apiClient.patch<Robot>(ENDPOINTS.get(robotId), { twinId });
    return response.data;
  },

  /**
   * The robot's frame registration to its site (TASK-341), or null when it has none.
   * @param robotId - Robot ID
   */
  async getFrameRegistration(robotId: string): Promise<FrameRegistration | null> {
    try {
      const response = await apiClient.get<FrameRegistration>(ENDPOINTS.frameRegistration(robotId));
      return response.data;
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  },

  /**
   * Align a robot to its site (TASK-341). Refused with 409 when the robot has
   * no site, is offline, or is a sim already in the twin frame.
   */
  async putFrameRegistration(robotId: string, request: FrameRegistrationRequest): Promise<FrameRegistration> {
    const response = await apiClient.put<FrameRegistration>(ENDPOINTS.frameRegistration(robotId), request);
    return response.data;
  },

  /** Forget a robot's alignment (TASK-341). */
  async deleteFrameRegistration(robotId: string): Promise<void> {
    await apiClient.delete(ENDPOINTS.frameRegistration(robotId));
  },

  /**
   * The places of the robot's site (TASK-327), or an empty list when it has none.
   */
  async getSitePlaces(robotId: string): Promise<SitePlace[]> {
    try {
      const response = await apiClient.get<{ places?: SitePlace[] }>(ENDPOINTS.places(robotId));
      return (response.data?.places ?? []).map((p) => ({ id: p.id, name: p.name, keepout: p.keepout === true }));
    } catch (error) {
      if (isNotFound(error)) return [];
      throw error;
    }
  },

  /**
   * Send a command to a robot.
   * @param robotId - Target robot ID
   * @param command - Command to execute
   * @returns Created command with status
   */
  async sendCommand(robotId: string, command: RobotCommandRequest): Promise<RobotCommand> {
    const response = await apiClient.post<RobotCommand>(ENDPOINTS.command(robotId), command);
    return response.data;
  },

  /**
   * Get command history for a robot.
   * Note: This endpoint is served by the robot agent, not the server.
   * @param robotId - Robot ID
   * @param params - Pagination parameters
   * @returns Paginated list of commands
   */
  async getCommands(
    _robotId: string,
    params?: { page?: number; pageSize?: number }
  ): Promise<CommandListResponse> {
    // TODO: This would need to be fetched from the robot's endpoint
    // For now, return empty list
    return {
      commands: [],
      pagination: {
        page: params?.page ?? 1,
        pageSize: params?.pageSize ?? 10,
        total: 0,
        totalPages: 0,
      },
    };
  },

  /**
   * Get current telemetry data for a robot.
   * @param robotId - Robot ID
   * @returns Latest telemetry data
   */
  async getTelemetry(robotId: string): Promise<RobotTelemetry> {
    const response = await apiClient.get<RobotTelemetry>(ENDPOINTS.telemetry(robotId));
    return response.data;
  },

  /**
   * Get persisted telemetry history for a robot (rows ascending by timestamp).
   * @param robotId - Robot ID
   * @param params - Time window and row limit
   * @returns Telemetry rows in the requested window
   */
  async getTelemetryHistory(
    robotId: string,
    params?: TelemetryHistoryParams
  ): Promise<RobotTelemetry[]> {
    const response = await apiClient.get<TelemetryHistoryResponse>(
      ENDPOINTS.telemetryHistory(robotId),
      { params: { from: params?.from, to: params?.to, limit: params?.limit } }
    );
    return response.data.telemetry ?? [];
  },

  /**
   * Send emergency stop command to a robot.
   * @param robotId - Robot ID
   * @returns Command result
   */
  async emergencyStop(robotId: string): Promise<RobotCommand> {
    return robotsApi.sendCommand(robotId, {
      type: 'emergency_stop',
      priority: 'critical',
    });
  },

  /**
   * Send robot to charging station.
   * @param robotId - Robot ID
   * @returns Command result
   */
  async sendToCharge(robotId: string): Promise<RobotCommand> {
    return robotsApi.sendCommand(robotId, {
      type: 'charge',
      priority: 'normal',
    });
  },

  /**
   * Send robot to home position.
   * @param robotId - Robot ID
   * @returns Command result
   */
  async returnHome(robotId: string): Promise<RobotCommand> {
    return robotsApi.sendCommand(robotId, {
      type: 'return_home',
      priority: 'normal',
    });
  },
};
