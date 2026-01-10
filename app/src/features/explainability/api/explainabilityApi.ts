/**
 * @file explainabilityApi.ts
 * @description API calls for AI explainability
 * @feature explainability
 */

import { apiClient } from '@/api/client';
import type {
  DecisionExplanation,
  DecisionListResponse,
  FormattedExplanation,
  AIPerformanceMetrics,
  AIDocumentation,
  DecisionType,
  MetricsPeriod,
  LimitationsResponse,
  OperatingConditionsResponse,
  HumanOversightResponse,
} from '../types';

const ENDPOINTS = {
  decisions: '/explainability/decisions',
  metrics: '/explainability/metrics',
  documentation: '/explainability/documentation',
  limitations: '/explainability/limitations',
  operatingConditions: '/explainability/operating-conditions',
  humanOversight: '/explainability/human-oversight',
} as const;

export interface GetDecisionsParams {
  page?: number;
  pageSize?: number;
  robotId?: string;
  decisionType?: DecisionType;
  startDate?: string;
  endDate?: string;
}

export const explainabilityApi = {
  /**
   * Get list of AI decisions with pagination
   */
  async getDecisions(params?: GetDecisionsParams): Promise<DecisionListResponse> {
    const response = await apiClient.get<DecisionListResponse>(ENDPOINTS.decisions, {
      params,
    });
    return response.data;
  },

  /**
   * Get a single decision by ID
   */
  async getDecision(id: string): Promise<DecisionExplanation> {
    const response = await apiClient.get<DecisionExplanation>(`${ENDPOINTS.decisions}/${id}`);
    return response.data;
  },

  /**
   * Get formatted human-readable explanation for a decision
   */
  async getExplanation(id: string): Promise<FormattedExplanation> {
    const response = await apiClient.get<FormattedExplanation>(
      `${ENDPOINTS.decisions}/${id}/explanation`
    );
    return response.data;
  },

  /**
   * Get decision by entity ID (e.g., CommandInterpretation ID)
   */
  async getDecisionByEntityId(entityId: string): Promise<DecisionExplanation> {
    const response = await apiClient.get<DecisionExplanation>(
      `${ENDPOINTS.decisions}/entity/${entityId}`
    );
    return response.data;
  },

  /**
   * Get AI performance metrics
   */
  async getMetrics(period?: MetricsPeriod, robotId?: string): Promise<AIPerformanceMetrics> {
    const response = await apiClient.get<AIPerformanceMetrics>(ENDPOINTS.metrics, {
      params: { period, robotId },
    });
    return response.data;
  },

  /**
   * Get AI system documentation
   */
  async getDocumentation(): Promise<AIDocumentation> {
    const response = await apiClient.get<AIDocumentation>(ENDPOINTS.documentation);
    return response.data;
  },

  /**
   * Get AI system limitations
   */
  async getLimitations(): Promise<LimitationsResponse> {
    const response = await apiClient.get<LimitationsResponse>(ENDPOINTS.limitations);
    return response.data;
  },

  /**
   * Get AI operating conditions
   */
  async getOperatingConditions(): Promise<OperatingConditionsResponse> {
    const response = await apiClient.get<OperatingConditionsResponse>(
      ENDPOINTS.operatingConditions
    );
    return response.data;
  },

  /**
   * Get human oversight requirements
   */
  async getHumanOversight(): Promise<HumanOversightResponse> {
    const response = await apiClient.get<HumanOversightResponse>(ENDPOINTS.humanOversight);
    return response.data;
  },
};
