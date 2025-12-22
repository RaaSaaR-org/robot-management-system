/**
 * @file commandApi.ts
 * @description API calls for natural language command interpretation
 * @feature command
 * @dependencies @/api/client, @/features/command/types, @/features/robots/api
 * @apiCalls POST /command/interpret, GET /command/history
 */

import { apiClient } from '@/api/client';
import { robotsApi } from '@/features/robots/api';
import type { RobotCommand, RobotCommandRequest } from '@/features/robots/types';
import type {
  CommandInterpretation,
  InterpretCommandRequest,
  CommandHistoryResponse,
} from '../types/command.types';
import { getMockInterpretation, getMockNLCommandHistory, mockDelay } from '@/mocks/mockData';

// ============================================================================
// ENDPOINTS
// ============================================================================

const ENDPOINTS = {
  interpret: '/command/interpret',
  history: '/command/history',
} as const;

// ============================================================================
// API FUNCTIONS
// ============================================================================

export const commandApi = {
  /**
   * Interpret a natural language command using the VLA model.
   * @param request - Interpretation request with text and robot ID
   * @returns VLA model interpretation
   */
  async interpretCommand(request: InterpretCommandRequest): Promise<CommandInterpretation> {
    // Development mode: return mock interpretation
    if (import.meta.env.DEV) {
      await mockDelay(800); // Simulate VLA processing time
      return getMockInterpretation(request);
    }

    const response = await apiClient.post<CommandInterpretation>(ENDPOINTS.interpret, request);
    return response.data;
  },

  /**
   * Execute a command on a robot after interpretation.
   * Delegates to robotsApi.sendCommand.
   * @param robotId - Target robot ID
   * @param interpretation - VLA interpretation to execute
   * @returns Executed command
   */
  async executeCommand(
    robotId: string,
    interpretation: CommandInterpretation
  ): Promise<RobotCommand> {
    const commandRequest: RobotCommandRequest = {
      type: interpretation.commandType,
      payload: {
        ...interpretation.parameters,
        nlOriginalText: interpretation.originalText,
        interpretationId: interpretation.id,
      },
      priority:
        interpretation.safetyClassification === 'dangerous'
          ? 'critical'
          : interpretation.safetyClassification === 'caution'
            ? 'high'
            : 'normal',
    };

    return robotsApi.sendCommand(robotId, commandRequest);
  },

  /**
   * Get command history for natural language commands.
   * @param params - Pagination and filter parameters
   * @returns Paginated command history
   */
  async getHistory(params?: {
    page?: number;
    pageSize?: number;
    robotId?: string;
  }): Promise<CommandHistoryResponse> {
    // Development mode: return mock history
    if (import.meta.env.DEV) {
      await mockDelay();
      return getMockNLCommandHistory(params?.page, params?.pageSize, params?.robotId);
    }

    const response = await apiClient.get<CommandHistoryResponse>(ENDPOINTS.history, {
      params: {
        page: params?.page,
        pageSize: params?.pageSize,
        robotId: params?.robotId,
      },
    });
    return response.data;
  },
};
