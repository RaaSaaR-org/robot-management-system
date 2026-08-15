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
  AgentIdentityPatch,
  AgentIdentityResponse,
  AgentMemoryDigest,
  AgentModeState,
  RobotMapPayload,
  MirroredAgentModeState,
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
  /**
   * Server-side proxies for the robot's two personal-data routes
   * (`GET /api/v1/robots/:id/memory`, `POST /api/v1/robots/:id/identity`).
   *
   * They MUST go through the server: the robot's `personalDataGate` refuses
   * cross-origin browser requests outright and strips the CORS header, so this
   * app cannot call the agent directly no matter what token it holds — and it
   * should not, since a bearer token in a browser bundle is not a secret.
   */
  memory: (robotId: string) => `/robots/${robotId}/agent-mode/memory`,
  /** Server proxy of the agent's `GET /api/v1/robots/:id/map` (TASK-206/207). */
  map: (robotId: string) => `/robots/${robotId}/agent-mode/map`,
  identity: (robotId: string) => `/robots/${robotId}/agent-mode/identity`,
} as const;

// ============================================================================
// API FUNCTIONS
// ============================================================================

export const agentmodeApi = {
  /**
   * Get the last known Agent Mode state the server holds for a robot.
   *
   * A MIRROR read, and the answer says so: `mirroredAt` is when the server last
   * heard from the robot. Callers must carry it instead of stamping their own
   * fetch time — the mirror only moves when the robot pushes, so "when I asked"
   * says nothing about how old the answer is.
   *
   * @param robotId - Robot ID
   */
  async getState(robotId: string): Promise<MirroredAgentModeState> {
    const response = await apiClient.get<MirroredAgentModeState>(ENDPOINTS.state(robotId));
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
   * Get the durable-memory digest — counts and budgets, never the content of
   * `MEMORY.md`. Null when this deployment cannot answer (no proxy, no
   * workspace on the robot, robot unreachable), which is "unknown", not "empty".
   * @param robotId - Robot ID
   */
  async getMemory(robotId: string): Promise<AgentMemoryDigest | null> {
    const response = await apiClient.get<AgentMemoryDigest | null>(ENDPOINTS.memory(robotId));
    return response.data ?? null;
  },

  /**
   * The robot's own occupancy map with peers and keepouts. Throws on any
   * failure — the store tells a 404 ("this robot has no map") from a 502.
   * @param robotId - Robot ID
   */
  async getMap(robotId: string): Promise<RobotMapPayload> {
    const response = await apiClient.get<RobotMapPayload>(ENDPOINTS.map(robotId));
    return response.data;
  },

  /**
   * Name the robot: writes Name/Emoji/Operator/Site into its `IDENTITY.md`.
   * @param robotId - Robot ID
   * @param patch - Fields to set; `null` clears one, omitted leaves it alone
   */
  async writeIdentity(
    robotId: string,
    patch: AgentIdentityPatch
  ): Promise<AgentIdentityResponse> {
    const response = await apiClient.post<AgentIdentityResponse>(
      ENDPOINTS.identity(robotId),
      patch
    );
    return response.data;
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
