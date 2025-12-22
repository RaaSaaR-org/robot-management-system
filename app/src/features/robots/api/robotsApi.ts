/**
 * @file robotsApi.ts
 * @description API calls for robot management endpoints
 * @feature robots
 * @dependencies axios
 */

import axios from 'axios';
import type {
  Robot,
  RobotTelemetry,
  RobotCommand,
  RobotCommandRequest,
  RobotListParams,
  RobotListResponse,
  CommandListResponse,
} from '../types/robots.types';

// ============================================================================
// CONFIGURATION
// ============================================================================

const ROBOT_API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// Create axios instance for robot API
const robotClient = axios.create({
  baseURL: ROBOT_API_BASE,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// ============================================================================
// ENDPOINTS
// ============================================================================

const ENDPOINTS = {
  list: '/api/robots',
  register: '/api/robots/register',
  get: (id: string) => `/api/robots/${id}`,
  command: (id: string) => `/api/robots/${id}/command`,
  telemetry: (id: string) => `/api/robots/${id}/telemetry`,
} as const;

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
    const response = await robotClient.post<{
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
    await robotClient.delete(ENDPOINTS.get(robotId));
  },

  /**
   * List robots with optional filtering and pagination.
   * @param params - Filter and pagination parameters
   * @returns Paginated list of robots
   */
  async listRobots(params?: RobotListParams): Promise<RobotListResponse> {
    const response = await robotClient.get<RobotListResponse>(ENDPOINTS.list, {
      params: {
        status: params?.status,
        search: params?.search,
        capabilities: params?.capabilities?.join(','),
        zone: params?.zone,
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
    const response = await robotClient.get<Robot>(ENDPOINTS.get(id));
    return response.data;
  },

  /**
   * Send a command to a robot.
   * @param robotId - Target robot ID
   * @param command - Command to execute
   * @returns Created command with status
   */
  async sendCommand(robotId: string, command: RobotCommandRequest): Promise<RobotCommand> {
    const response = await robotClient.post<RobotCommand>(ENDPOINTS.command(robotId), command);
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
    const response = await robotClient.get<RobotTelemetry>(ENDPOINTS.telemetry(robotId));
    return response.data;
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
