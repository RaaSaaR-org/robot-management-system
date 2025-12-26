/**
 * @file client.ts
 * @description HTTP client for robot-agent REST API
 */

import type {
  Robot,
  RobotTelemetry,
  RobotCommand,
  RobotCommandRequest,
  CommandListResponse,
  HealthResponse,
  CommandType,
  ApiError,
} from './types.js';

export class RobotApiClient {
  private baseUrl: string;
  private robotId: string | null = null;

  constructor(baseUrl: string, robotId?: string) {
    // Remove trailing slash
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.robotId = robotId || null;
  }

  /**
   * Auto-discover robot ID from health endpoint
   */
  async discover(): Promise<string> {
    const health = await this.getHealth();
    this.robotId = health.robotId;
    return health.robotId;
  }

  /**
   * Get the current robot ID, discovering if needed
   */
  async getRobotId(): Promise<string> {
    if (!this.robotId) {
      await this.discover();
    }
    return this.robotId!;
  }

  /**
   * Make a fetch request with error handling
   */
  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${path}`;

    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...options?.headers,
        },
      });

      if (!response.ok) {
        const error = (await response.json().catch(() => ({}))) as ApiError;
        throw new Error(error.message || `HTTP ${response.status}: ${response.statusText}`);
      }

      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof TypeError && error.message.includes('fetch')) {
        throw new Error(`Cannot connect to robot at ${this.baseUrl}. Is the robot agent running?`);
      }
      throw error;
    }
  }

  /**
   * Health check - also returns robot ID
   */
  async getHealth(): Promise<HealthResponse> {
    return this.request<HealthResponse>('/api/v1/health');
  }

  /**
   * Get robot status
   */
  async getStatus(): Promise<Robot> {
    const robotId = await this.getRobotId();
    return this.request<Robot>(`/api/v1/robots/${robotId}`);
  }

  /**
   * Get robot telemetry
   */
  async getTelemetry(): Promise<RobotTelemetry> {
    const robotId = await this.getRobotId();
    return this.request<RobotTelemetry>(`/api/v1/robots/${robotId}/telemetry`);
  }

  /**
   * Send a command to the robot
   */
  async sendCommand(type: CommandType, payload?: Record<string, unknown>): Promise<RobotCommand> {
    const robotId = await this.getRobotId();
    const request: RobotCommandRequest = { type, payload };

    return this.request<RobotCommand>(`/api/v1/robots/${robotId}/command`, {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  /**
   * Get command history
   */
  async getCommandHistory(page = 1, pageSize = 10): Promise<CommandListResponse> {
    const robotId = await this.getRobotId();
    return this.request<CommandListResponse>(
      `/api/v1/robots/${robotId}/commands?page=${page}&pageSize=${pageSize}`
    );
  }

  /**
   * Get WebSocket URL for telemetry streaming
   */
  async getWebSocketUrl(): Promise<string> {
    const robotId = await this.getRobotId();
    const wsProtocol = this.baseUrl.startsWith('https') ? 'wss' : 'ws';
    const host = this.baseUrl.replace(/^https?:\/\//, '');
    return `${wsProtocol}://${host}/ws/telemetry/${robotId}`;
  }
}

/**
 * Create a new API client
 */
export function createClient(url: string, robotId?: string): RobotApiClient {
  return new RobotApiClient(url, robotId);
}
