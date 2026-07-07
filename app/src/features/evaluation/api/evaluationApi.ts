/**
 * @file evaluationApi.ts
 * @description API calls for the evaluation feature
 * @feature evaluation
 */

import { apiClient } from '@/api/client';
import type {
  EpisodeQueryParams,
  EpisodesListResponse,
  EvaluationEpisode,
  EvaluationPeriod,
  SuccessRateResult,
  ErrorBreakdownResponse,
  ModelComparisonResult,
  CreateRewardModelEvalRequest,
  RewardModelEvalResponse,
  EpisodeReward,
} from '../types';

const ENDPOINTS = {
  episodes: '/evaluation/episodes',
  episode: (id: string) => `/evaluation/episodes/${id}`,
  successRate: '/evaluation/success-rate',
  errorBreakdown: '/evaluation/error-breakdown',
  compare: '/evaluation/compare',
  runHardware: '/evaluation/run-hardware',
  rewardModel: '/evaluation/reward-model',
  rewardModelJob: (jobId: string) => `/evaluation/reward-model/${jobId}`,
  rewards: '/evaluation/rewards',
} as const;

export interface RunHardwareEvaluationRequest {
  robotId: string;
  skillId: string;
  episodes?: number;
  maxStepsPerEpisode?: number;
  taskPrompt?: string;
}

export interface HardwareEvaluationSummary {
  robotId: string;
  skillId: string;
  episodes: number;
  successCount: number;
  successRate: number;
  startedAt: string;
  results: Array<{
    index: number;
    status: string;
    steps: number;
    durationMs: number;
    error?: string;
  }>;
}

export const evaluationApi = {
  async listEpisodes(params?: EpisodeQueryParams): Promise<EpisodesListResponse> {
    const response = await apiClient.get<EpisodesListResponse>(ENDPOINTS.episodes, { params });
    return response.data;
  },

  async getEpisode(id: string): Promise<EvaluationEpisode> {
    const response = await apiClient.get<{ episode: EvaluationEpisode }>(ENDPOINTS.episode(id));
    return response.data.episode;
  },

  async getSuccessRate(params?: {
    robotId?: string;
    modelVersion?: string;
    period?: EvaluationPeriod;
  }): Promise<SuccessRateResult> {
    const response = await apiClient.get<SuccessRateResult>(ENDPOINTS.successRate, { params });
    return response.data;
  },

  async getErrorBreakdown(params?: {
    robotId?: string;
    modelVersion?: string;
    period?: EvaluationPeriod;
  }): Promise<ErrorBreakdownResponse> {
    const response = await apiClient.get<ErrorBreakdownResponse>(ENDPOINTS.errorBreakdown, { params });
    return response.data;
  },

  async compareModels(
    versionA: string,
    versionB: string,
    period?: EvaluationPeriod
  ): Promise<ModelComparisonResult> {
    const response = await apiClient.get<ModelComparisonResult>(ENDPOINTS.compare, {
      params: { versionA, versionB, period },
    });
    return response.data;
  },

  /**
   * Trigger a hardware evaluation run on the robot agent. Per-episode results
   * are persisted by the agent itself via /evaluation/episodes — the response
   * here is just the summary returned by the agent. (TASK-146)
   */
  async runHardwareEvaluation(
    request: RunHardwareEvaluationRequest
  ): Promise<HardwareEvaluationSummary> {
    const response = await apiClient.post<{ summary: HardwareEvaluationSummary }>(
      ENDPOINTS.runHardware,
      request
    );
    return response.data.summary;
  },

  // ==========================================================================
  // REWARD-MODEL EVALUATION (LeRobot 0.6.0 Robometer / TOPReward, TASK-179)
  // ==========================================================================

  /**
   * Start a reward-model evaluation job (TrainingJob kind `reward_model`)
   * that scores every episode of a dataset with per-frame progress curves.
   */
  async createRewardModelEval(
    request: CreateRewardModelEvalRequest
  ): Promise<{ jobId: string }> {
    const response = await apiClient.post<{ jobId: string }>(ENDPOINTS.rewardModel, request);
    return response.data;
  },

  /**
   * Poll a reward-model evaluation job: status + the rewards written so far.
   */
  async getRewardModelEval(jobId: string): Promise<RewardModelEvalResponse> {
    const response = await apiClient.get<RewardModelEvalResponse>(
      ENDPOINTS.rewardModelJob(jobId)
    );
    return response.data;
  },

  /**
   * List stored per-episode rewards for a dataset.
   */
  async listRewards(datasetId: string): Promise<EpisodeReward[]> {
    const response = await apiClient.get<{ rewards: EpisodeReward[] }>(ENDPOINTS.rewards, {
      params: { datasetId },
    });
    return response.data.rewards;
  },
};
