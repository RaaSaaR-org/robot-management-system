/**
 * @file agentmodeApi.ts
 * @description REST calls for the server-side Agent Mode endpoints (TASK-194)
 * @feature agentmode
 * @dependencies @/api/client
 */

import { apiClient } from '@/api/client';
import type {
  AgentCommandResponse,
  AgentEstopResponse,
  AgentModeState,
  SceneMemory,
} from '../types/agentmode.types';

// ============================================================================
// ENDPOINTS
// ============================================================================

// Note: apiClient already has the /api prefix in its baseURL. The server mounts
// these under /api/robots, mirroring the robot-agent's /api/v1 routes.
const ENDPOINTS = {
  state: (robotId: string) => `/robots/${robotId}/agent-mode`,
  scene: (robotId: string) => `/robots/${robotId}/agent-mode/scene`,
  command: (robotId: string) => `/robots/${robotId}/agent-mode/command`,
  toggle: (robotId: string) => `/robots/${robotId}/agent-mode/toggle`,
  estop: (robotId: string) => `/robots/${robotId}/agent-mode/estop`,
  estopReset: (robotId: string) => `/robots/${robotId}/agent-mode/estop/reset`,
} as const;

// ============================================================================
// API FUNCTIONS
// ============================================================================

export const agentmodeApi = {
  /**
   * Get the last known Agent Mode state the server holds for a robot.
   * @param robotId - Robot ID
   */
  async getState(robotId: string): Promise<AgentModeState> {
    const response = await apiClient.get<AgentModeState>(ENDPOINTS.state(robotId));
    return response.data;
  },

  /**
   * Get the last known scene memory. `null` before the first `look`.
   * @param robotId - Robot ID
   */
  async getScene(robotId: string): Promise<SceneMemory | null> {
    const response = await apiClient.get<SceneMemory | null>(ENDPOINTS.scene(robotId));
    return response.data ?? null;
  },

  /**
   * Send a plain-language command. The server proxies it to the robot-agent,
   * which acknowledges immediately and streams block events over the WebSocket.
   * @param robotId - Robot ID
   * @param text - The utterance
   * @param contextId - Optional A2A context
   */
  async sendCommand(
    robotId: string,
    text: string,
    contextId?: string
  ): Promise<AgentCommandResponse> {
    const response = await apiClient.post<AgentCommandResponse>(ENDPOINTS.command(robotId), {
      text,
      contextId,
    });
    return response.data;
  },

  /**
   * Turn Agent Mode on or off for a robot.
   * @param robotId - Robot ID
   * @param enabled - Desired mode
   */
  async toggle(robotId: string, enabled: boolean): Promise<AgentModeState> {
    const response = await apiClient.post<AgentModeState>(ENDPOINTS.toggle(robotId), { enabled });
    return response.data;
  },

  /**
   * Latch the manual E-Stop: discards the plan, stops and damps the robot.
   * @param robotId - Robot ID
   * @param reason - Optional operator note
   */
  async estop(robotId: string, reason?: string): Promise<AgentEstopResponse> {
    const response = await apiClient.post<AgentEstopResponse>(ENDPOINTS.estop(robotId), { reason });
    return response.data;
  },

  /**
   * Clear a latched E-Stop so commands are accepted again.
   * @param robotId - Robot ID
   */
  async resetEstop(robotId: string): Promise<AgentModeState> {
    const response = await apiClient.post<AgentModeState>(ENDPOINTS.estopReset(robotId));
    return response.data;
  },
};
