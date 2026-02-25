/**
 * @file evaluation.types.ts
 * @description TypeScript types for the evaluation feature
 * @feature evaluation
 */

// ============================================================================
// DOMAIN TYPES
// ============================================================================

export type EvaluationPeriod = '24h' | '7d' | '30d';

export interface EvaluationEpisode {
  id: string;
  robotId: string;
  modelVersion: string;
  taskPrompt: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  success: boolean;
  errorType: string | null;
  videoUrl: string | null;
  metadata: string;
  createdAt: string;
  robot?: {
    id: string;
    name: string;
    model: string;
  };
}

export interface SuccessRateResult {
  successRate: number;
  totalEpisodes: number;
  successfulEpisodes: number;
  period: EvaluationPeriod;
}

export interface ErrorBreakdownItem {
  errorType: string;
  count: number;
  percentage: number;
}

export interface ModelStats {
  modelVersion: string;
  successRate: number;
  totalEpisodes: number;
  avgDurationMs: number;
  errorBreakdown: ErrorBreakdownItem[];
}

export interface ModelComparisonResult {
  versionA: ModelStats;
  versionB: ModelStats;
}

// ============================================================================
// API TYPES
// ============================================================================

export interface EpisodeQueryParams {
  robotId?: string;
  modelVersion?: string;
  period?: EvaluationPeriod;
  success?: boolean;
  page?: number;
  limit?: number;
}

export interface EpisodesListResponse {
  episodes: EvaluationEpisode[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ErrorBreakdownResponse {
  errors: ErrorBreakdownItem[];
}
