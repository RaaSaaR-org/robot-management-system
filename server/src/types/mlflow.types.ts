/**
 * @file mlflow.types.ts
 * @description MLflow API type definitions for model registry integration
 * @feature vla-training
 */

// ============================================================================
// MLflow Core Types
// ============================================================================

/**
 * MLflow tag key-value pair
 */
export interface MLflowTag {
  key: string;
  value: string;
}

/**
 * MLflow parameter (hyperparameter) stored with a run
 */
export interface MLflowParam {
  key: string;
  value: string;
}

/**
 * MLflow metric data point
 */
export interface MLflowMetric {
  key: string;
  value: number;
  timestamp: number;
  step: number;
}

// ============================================================================
// Experiment Types
// ============================================================================

/**
 * MLflow experiment lifecycle stage
 */
export type MLflowLifecycleStage = 'active' | 'deleted';

/**
 * MLflow experiment containing multiple runs
 */
export interface MLflowExperiment {
  experimentId: string;
  name: string;
  artifactLocation: string;
  lifecycleStage: MLflowLifecycleStage;
  tags: MLflowTag[];
  creationTime: number;
  lastUpdateTime: number;
}

// ============================================================================
// Run Types
// ============================================================================

/**
 * MLflow run status
 */
export type MLflowRunStatus = 'RUNNING' | 'SCHEDULED' | 'FINISHED' | 'FAILED' | 'KILLED';

/**
 * MLflow run info (metadata)
 */
export interface MLflowRunInfo {
  runId: string;
  runUuid: string;
  experimentId: string;
  status: MLflowRunStatus;
  startTime: number;
  endTime?: number;
  artifactUri: string;
  lifecycleStage: MLflowLifecycleStage;
}

/**
 * MLflow run data (params, metrics, tags)
 */
export interface MLflowRunData {
  params: MLflowParam[];
  metrics: MLflowMetric[];
  tags: MLflowTag[];
}

/**
 * MLflow run (complete run object)
 */
export interface MLflowRun {
  info: MLflowRunInfo;
  data: MLflowRunData;
}

// ============================================================================
// Model Registry Types
// ============================================================================

/**
 * MLflow model stage for deployment lifecycle
 */
export type MLflowModelStage = 'None' | 'Staging' | 'Production' | 'Archived';

/**
 * MLflow model version registration status
 */
export type MLflowModelVersionStatus = 'PENDING_REGISTRATION' | 'FAILED_REGISTRATION' | 'READY';

/**
 * MLflow model version
 */
export interface MLflowModelVersion {
  name: string;
  version: string;
  creationTimestamp: number;
  lastUpdatedTimestamp: number;
  currentStage: MLflowModelStage;
  description?: string;
  source: string;
  runId?: string;
  status: MLflowModelVersionStatus;
  statusMessage?: string;
  tags: MLflowTag[];
  runLink?: string;
  aliases?: string[];
}

/**
 * MLflow registered model
 */
export interface MLflowRegisteredModel {
  name: string;
  creationTimestamp: number;
  lastUpdatedTimestamp: number;
  description?: string;
  latestVersions?: MLflowModelVersion[];
  tags: MLflowTag[];
  aliases?: Record<string, string>;
}

/**
 * MLflow model alias
 */
export interface MLflowModelAlias {
  alias: string;
  version: string;
}

// ============================================================================
// API Request Types
// ============================================================================

/**
 * Request to create an experiment
 */
export interface CreateExperimentRequest {
  name: string;
  artifactLocation?: string;
  tags?: Record<string, string>;
}

/**
 * Request to create a run
 */
export interface CreateRunRequest {
  experimentId: string;
  startTime?: number;
  runName?: string;
  tags?: Record<string, string>;
}

/**
 * Request to log parameters
 */
export interface LogParamsRequest {
  runId: string;
  params: Record<string, string | number>;
}

/**
 * Single metric to log
 */
export interface MetricToLog {
  key: string;
  value: number;
  step?: number;
  timestamp?: number;
}

/**
 * Request to log metrics
 */
export interface LogMetricsRequest {
  runId: string;
  metrics: MetricToLog[];
}

/**
 * Request to end a run
 */
export interface EndRunRequest {
  runId: string;
  status: MLflowRunStatus;
  endTime?: number;
}

/**
 * Request to register a model
 */
export interface CreateRegisteredModelRequest {
  name: string;
  description?: string;
  tags?: Record<string, string>;
}

/**
 * Request to create a model version
 */
export interface CreateModelVersionRequest {
  name: string;
  source: string;
  runId?: string;
  description?: string;
  tags?: Record<string, string>;
}

/**
 * Request to transition model version stage
 */
export interface TransitionStageRequest {
  name: string;
  version: string;
  stage: MLflowModelStage;
  archiveExistingVersions?: boolean;
}

/**
 * Request to set model alias
 */
export interface SetModelAliasRequest {
  name: string;
  alias: string;
  version: string;
}

/**
 * Request to search runs
 */
export interface SearchRunsRequest {
  experimentIds: string[];
  filter?: string;
  orderBy?: string[];
  maxResults?: number;
  pageToken?: string;
}

/**
 * Request to compare runs
 */
export interface CompareRunsRequest {
  runIds: string[];
  metricKeys: string[];
}

// ============================================================================
// API Response Types
// ============================================================================

/**
 * Response from create experiment
 * Note: MLflow API returns snake_case
 */
export interface CreateExperimentResponse {
  experiment_id: string;
}

/**
 * Response from get experiment
 */
export interface GetExperimentResponse {
  experiment: MLflowExperiment;
}

/**
 * Response from list experiments
 */
export interface ListExperimentsResponse {
  experiments: MLflowExperiment[];
  nextPageToken?: string;
}

/**
 * Response from create run
 */
export interface CreateRunResponse {
  run: MLflowRun;
}

/**
 * Response from get run
 */
export interface GetRunResponse {
  run: MLflowRun;
}

/**
 * Response from search runs
 */
export interface SearchRunsResponse {
  runs: MLflowRun[];
  nextPageToken?: string;
}

/**
 * Response from get metric history
 */
export interface GetMetricHistoryResponse {
  metrics: MLflowMetric[];
  nextPageToken?: string;
}

/**
 * Response from create registered model
 * Note: MLflow API returns snake_case
 */
export interface CreateRegisteredModelResponse {
  registered_model: MLflowRegisteredModel;
}

/**
 * Response from get registered model
 * Note: MLflow API returns snake_case
 */
export interface GetRegisteredModelResponse {
  registered_model: MLflowRegisteredModel;
}

/**
 * Response from list registered models
 * Note: MLflow API returns snake_case
 */
export interface ListRegisteredModelsResponse {
  registered_models?: MLflowRegisteredModel[];
  next_page_token?: string;
}

/**
 * Response from create model version
 * Note: MLflow API returns snake_case
 */
export interface CreateModelVersionResponse {
  model_version: MLflowModelVersion;
}

/**
 * Response from get model version
 * Note: MLflow API returns snake_case
 */
export interface GetModelVersionResponse {
  model_version: MLflowModelVersion;
}

/**
 * Response from get latest versions
 * Note: MLflow API returns snake_case
 */
export interface GetLatestVersionsResponse {
  model_versions?: MLflowModelVersion[];
}

/**
 * Response from transition stage
 * Note: MLflow API returns snake_case
 */
export interface TransitionStageResponse {
  model_version: MLflowModelVersion;
}

// ============================================================================
// Service Event Types
// ============================================================================

/**
 * MLflow service event types
 */
export const MLflowEventTypes = [
  'mlflow:experiment:created',
  'mlflow:run:created',
  'mlflow:run:ended',
  'mlflow:model:registered',
  'mlflow:model:version:created',
  'mlflow:model:stage:transitioned',
  'mlflow:model:alias:set',
] as const;

export type MLflowEventType = (typeof MLflowEventTypes)[number];

/**
 * MLflow service event
 */
export interface MLflowEvent {
  type: MLflowEventType;
  timestamp: string;
  data: {
    experimentId?: string;
    runId?: string;
    modelName?: string;
    version?: string;
    stage?: MLflowModelStage;
    alias?: string;
  };
}

// ============================================================================
// Compare Runs Result
// ============================================================================

/**
 * Result of comparing multiple runs
 */
export interface RunComparison {
  runId: string;
  experimentId: string;
  status: MLflowRunStatus;
  startTime: number;
  endTime?: number;
  params: Record<string, string>;
  metrics: Record<string, number>;
  metricHistory: Record<string, MLflowMetric[]>;
}

/**
 * Full comparison result
 */
export interface CompareRunsResult {
  runs: RunComparison[];
  metricKeys: string[];
}

// ============================================================================
// MLflow Config
// ============================================================================

/**
 * MLflow service configuration
 */
export interface MLflowConfig {
  trackingUri: string;
  timeout?: number;
  retryAttempts?: number;
  retryDelay?: number;
}
