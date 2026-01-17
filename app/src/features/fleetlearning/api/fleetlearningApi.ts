/**
 * @file fleetlearningApi.ts
 * @description API client for fleet learning (federated learning) endpoints
 * @feature fleetlearning
 * @dependencies apiClient
 */

import { apiClient } from '@/api/client';
import type {
  FederatedRound,
  FederatedParticipant,
  RobotPrivacyBudget,
  ROHEMetrics,
  ConvergenceDataPoint,
  CreateFederatedRoundRequest,
  RoundSummaryResponse,
  ListFederatedRoundsParams,
  ListFederatedRoundsResponse,
  GetROHEParams,
  PrivacyBudgetListResponse,
} from '../types/fleetlearning.types';

// ============================================================================
// ENDPOINTS
// ============================================================================

const ENDPOINTS = {
  // Rounds
  rounds: '/federated/rounds',
  round: (id: string) => `/federated/rounds/${id}`,
  roundStart: (id: string) => `/federated/rounds/${id}/start`,
  roundCancel: (id: string) => `/federated/rounds/${id}/cancel`,
  roundParticipants: (id: string) => `/federated/rounds/${id}/participants`,
  // Privacy
  privacyBudgets: '/federated/privacy-budgets',
  privacyBudget: (robotId: string) => `/federated/privacy-budgets/${robotId}`,
  // ROHE
  rohe: '/federated/rohe',
  // Convergence
  convergence: '/federated/convergence',
} as const;

// ============================================================================
// ROUNDS API
// ============================================================================

/**
 * List federated rounds
 */
async function listRounds(params?: ListFederatedRoundsParams): Promise<ListFederatedRoundsResponse> {
  const response = await apiClient.get<ListFederatedRoundsResponse>(ENDPOINTS.rounds, {
    params,
  });
  return response.data;
}

/**
 * Get a single federated round by ID
 */
async function getRound(id: string): Promise<RoundSummaryResponse> {
  const response = await apiClient.get<RoundSummaryResponse>(ENDPOINTS.round(id));
  return response.data;
}

/**
 * Create a new federated round
 */
async function createRound(data: CreateFederatedRoundRequest): Promise<FederatedRound> {
  const response = await apiClient.post<FederatedRound>(ENDPOINTS.rounds, data);
  return response.data;
}

/**
 * Start a federated round
 */
async function startRound(id: string): Promise<FederatedRound> {
  const response = await apiClient.post<FederatedRound>(ENDPOINTS.roundStart(id));
  return response.data;
}

/**
 * Cancel a federated round
 */
async function cancelRound(id: string): Promise<FederatedRound> {
  const response = await apiClient.post<FederatedRound>(ENDPOINTS.roundCancel(id));
  return response.data;
}

/**
 * Get participants for a round
 */
async function getParticipants(roundId: string): Promise<FederatedParticipant[]> {
  const response = await apiClient.get<FederatedParticipant[]>(ENDPOINTS.roundParticipants(roundId));
  return response.data;
}

// ============================================================================
// PRIVACY API
// ============================================================================

/**
 * List privacy budgets for all robots
 */
async function listPrivacyBudgets(): Promise<PrivacyBudgetListResponse> {
  const response = await apiClient.get<PrivacyBudgetListResponse>(ENDPOINTS.privacyBudgets);
  return response.data;
}

/**
 * Get privacy budget for a specific robot
 */
async function getPrivacyBudget(robotId: string): Promise<RobotPrivacyBudget> {
  const response = await apiClient.get<RobotPrivacyBudget>(ENDPOINTS.privacyBudget(robotId));
  return response.data;
}

// ============================================================================
// ROHE API
// ============================================================================

/**
 * Get ROHE (Return on Human Effort) metrics
 */
async function getROHEMetrics(params?: GetROHEParams): Promise<ROHEMetrics> {
  const response = await apiClient.get<ROHEMetrics>(ENDPOINTS.rohe, {
    params,
  });
  return response.data;
}

// ============================================================================
// CONVERGENCE API
// ============================================================================

/**
 * Get convergence data for visualization
 */
async function getConvergenceData(modelVersion?: string): Promise<ConvergenceDataPoint[]> {
  const response = await apiClient.get<ConvergenceDataPoint[]>(ENDPOINTS.convergence, {
    params: { modelVersion },
  });
  return response.data;
}

// ============================================================================
// EXPORT
// ============================================================================

export const fleetlearningApi = {
  // Rounds
  listRounds,
  getRound,
  createRound,
  startRound,
  cancelRound,
  getParticipants,
  // Privacy
  listPrivacyBudgets,
  getPrivacyBudget,
  // ROHE
  getROHEMetrics,
  // Convergence
  getConvergenceData,
};
