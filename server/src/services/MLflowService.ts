/**
 * @file MLflowService.ts
 * @description MLflow REST API client service for experiment tracking and model registry
 * @feature vla-training
 */

import { EventEmitter } from 'events';
import type {
  MLflowConfig,
  MLflowExperiment,
  MLflowRun,
  MLflowRunStatus,
  MLflowMetric,
  MLflowRegisteredModel,
  MLflowModelVersion,
  MLflowModelStage,
  MLflowEvent,
  MLflowEventType,
  CreateExperimentResponse,
  GetExperimentResponse,
  ListExperimentsResponse,
  CreateRunResponse,
  GetRunResponse,
  SearchRunsResponse,
  GetMetricHistoryResponse,
  CreateRegisteredModelResponse,
  GetRegisteredModelResponse,
  ListRegisteredModelsResponse,
  CreateModelVersionResponse,
  GetModelVersionResponse,
  GetLatestVersionsResponse,
  TransitionStageResponse,
  CompareRunsResult,
  RunComparison,
  MetricToLog,
} from '../types/mlflow.types.js';

/**
 * MLflow REST API client service
 * Provides experiment tracking, run management, and model registry functionality
 */
export class MLflowService extends EventEmitter {
  private static instance: MLflowService;
  private config: MLflowConfig;
  private initialized = false;

  private constructor() {
    super();
    this.config = {
      trackingUri: process.env.MLFLOW_TRACKING_URI || 'http://localhost:5000',
      timeout: 30000,
      retryAttempts: 3,
      retryDelay: 1000,
    };
  }

  /**
   * Get singleton instance
   */
  static getInstance(): MLflowService {
    if (!MLflowService.instance) {
      MLflowService.instance = new MLflowService();
    }
    return MLflowService.instance;
  }

  /**
   * Initialize service and validate connection
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    const isHealthy = await this.healthCheck();
    if (!isHealthy) {
      throw new Error(`Failed to connect to MLflow at ${this.config.trackingUri}`);
    }

    this.initialized = true;
    console.log(`[MLflowService] Initialized - connected to ${this.config.trackingUri}`);
  }

  /**
   * Check if service is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Check MLflow server health
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.fetch('/health', { method: 'GET' });
      return response.ok;
    } catch {
      return false;
    }
  }

  // ============================================================================
  // Experiment Management
  // ============================================================================

  /**
   * Create a new experiment
   */
  async createExperiment(
    name: string,
    tags?: Record<string, string>,
    artifactLocation?: string
  ): Promise<MLflowExperiment> {
    const body: Record<string, unknown> = { name };
    if (artifactLocation) {
      body.artifact_location = artifactLocation;
    }
    if (tags) {
      body.tags = Object.entries(tags).map(([key, value]) => ({ key, value }));
    }

    const response = await this.fetchJson<CreateExperimentResponse>(
      '/api/2.0/mlflow/experiments/create',
      { method: 'POST', body }
    );

    const experiment = await this.getExperiment(response.experiment_id);
    this.emitEvent('mlflow:experiment:created', { experimentId: response.experiment_id });
    return experiment;
  }

  /**
   * Get experiment by ID
   */
  async getExperiment(experimentId: string): Promise<MLflowExperiment> {
    const response = await this.fetchJson<GetExperimentResponse>(
      `/api/2.0/mlflow/experiments/get?experiment_id=${experimentId}`,
      { method: 'GET' }
    );
    return this.transformExperiment(response.experiment);
  }

  /**
   * Get experiment by name
   */
  async getExperimentByName(name: string): Promise<MLflowExperiment | null> {
    try {
      const response = await this.fetchJson<GetExperimentResponse>(
        `/api/2.0/mlflow/experiments/get-by-name?experiment_name=${encodeURIComponent(name)}`,
        { method: 'GET' }
      );
      return this.transformExperiment(response.experiment);
    } catch (error) {
      if (error instanceof MLflowError && error.statusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * List all experiments
   */
  async listExperiments(maxResults = 1000): Promise<MLflowExperiment[]> {
    const experiments: MLflowExperiment[] = [];
    let pageToken: string | undefined;

    do {
      const url = new URL(`${this.config.trackingUri}/api/2.0/mlflow/experiments/search`);
      url.searchParams.set('max_results', String(maxResults));
      if (pageToken) {
        url.searchParams.set('page_token', pageToken);
      }

      const response = await this.fetchJson<ListExperimentsResponse>(
        url.pathname + url.search,
        { method: 'GET' }
      );

      if (response.experiments) {
        experiments.push(...response.experiments.map((e) => this.transformExperiment(e)));
      }
      pageToken = response.nextPageToken;
    } while (pageToken);

    return experiments;
  }

  // ============================================================================
  // Run Management
  // ============================================================================

  /**
   * Create a new run in an experiment
   */
  async createRun(
    experimentId: string,
    runName?: string,
    tags?: Record<string, string>
  ): Promise<MLflowRun> {
    const body: Record<string, unknown> = {
      experiment_id: experimentId,
      start_time: Date.now(),
    };

    if (runName) {
      body.run_name = runName;
    }

    if (tags) {
      body.tags = Object.entries(tags).map(([key, value]) => ({ key, value }));
    }

    const response = await this.fetchJson<CreateRunResponse>(
      '/api/2.0/mlflow/runs/create',
      { method: 'POST', body }
    );

    const run = this.transformRun(response.run);
    this.emitEvent('mlflow:run:created', { experimentId, runId: run.info.runId });
    return run;
  }

  /**
   * Get run by ID
   */
  async getRun(runId: string): Promise<MLflowRun> {
    const response = await this.fetchJson<GetRunResponse>(
      `/api/2.0/mlflow/runs/get?run_id=${runId}`,
      { method: 'GET' }
    );
    return this.transformRun(response.run);
  }

  /**
   * Log parameters to a run
   */
  async logParams(runId: string, params: Record<string, string | number>): Promise<void> {
    const paramsList = Object.entries(params).map(([key, value]) => ({
      key,
      value: String(value),
    }));

    await this.fetchJson('/api/2.0/mlflow/runs/log-batch', {
      method: 'POST',
      body: {
        run_id: runId,
        params: paramsList,
      },
    });
  }

  /**
   * Log metrics to a run
   */
  async logMetrics(runId: string, metrics: MetricToLog[]): Promise<void> {
    const timestamp = Date.now();
    const metricsList = metrics.map((m) => ({
      key: m.key,
      value: m.value,
      timestamp: m.timestamp ?? timestamp,
      step: m.step ?? 0,
    }));

    await this.fetchJson('/api/2.0/mlflow/runs/log-batch', {
      method: 'POST',
      body: {
        run_id: runId,
        metrics: metricsList,
      },
    });
  }

  /**
   * Log a single metric to a run
   */
  async logMetric(
    runId: string,
    key: string,
    value: number,
    step?: number,
    timestamp?: number
  ): Promise<void> {
    await this.fetchJson('/api/2.0/mlflow/runs/log-metric', {
      method: 'POST',
      body: {
        run_id: runId,
        key,
        value,
        timestamp: timestamp ?? Date.now(),
        step: step ?? 0,
      },
    });
  }

  /**
   * Set a tag on a run
   */
  async setRunTag(runId: string, key: string, value: string): Promise<void> {
    await this.fetchJson('/api/2.0/mlflow/runs/set-tag', {
      method: 'POST',
      body: { run_id: runId, key, value },
    });
  }

  /**
   * End a run
   */
  async endRun(runId: string, status: MLflowRunStatus = 'FINISHED'): Promise<void> {
    await this.fetchJson('/api/2.0/mlflow/runs/update', {
      method: 'POST',
      body: {
        run_id: runId,
        status,
        end_time: Date.now(),
      },
    });

    this.emitEvent('mlflow:run:ended', { runId });
  }

  /**
   * Search runs across experiments
   */
  async searchRuns(
    experimentIds: string[],
    filter?: string,
    orderBy?: string[],
    maxResults = 1000
  ): Promise<MLflowRun[]> {
    const runs: MLflowRun[] = [];
    let pageToken: string | undefined;

    do {
      const body: Record<string, unknown> = {
        experiment_ids: experimentIds,
        max_results: maxResults,
      };

      if (filter) {
        body.filter = filter;
      }
      if (orderBy) {
        body.order_by = orderBy;
      }
      if (pageToken) {
        body.page_token = pageToken;
      }

      const response = await this.fetchJson<SearchRunsResponse>(
        '/api/2.0/mlflow/runs/search',
        { method: 'POST', body }
      );

      if (response.runs) {
        runs.push(...response.runs.map((r) => this.transformRun(r)));
      }
      pageToken = response.nextPageToken;
    } while (pageToken);

    return runs;
  }

  /**
   * Get metric history for a run
   */
  async getMetricHistory(runId: string, metricKey: string): Promise<MLflowMetric[]> {
    const metrics: MLflowMetric[] = [];
    let pageToken: string | undefined;

    do {
      const url = new URL(`${this.config.trackingUri}/api/2.0/mlflow/metrics/get-history`);
      url.searchParams.set('run_id', runId);
      url.searchParams.set('metric_key', metricKey);
      if (pageToken) {
        url.searchParams.set('page_token', pageToken);
      }

      const response = await this.fetchJson<GetMetricHistoryResponse>(
        url.pathname + url.search,
        { method: 'GET' }
      );

      if (response.metrics) {
        metrics.push(...response.metrics);
      }
      pageToken = response.nextPageToken;
    } while (pageToken);

    return metrics;
  }

  // ============================================================================
  // Model Registry
  // ============================================================================

  /**
   * Create a registered model
   */
  async createRegisteredModel(
    name: string,
    description?: string,
    tags?: Record<string, string>
  ): Promise<MLflowRegisteredModel> {
    const body: Record<string, unknown> = { name };

    if (description) {
      body.description = description;
    }
    if (tags) {
      body.tags = Object.entries(tags).map(([key, value]) => ({ key, value }));
    }

    const response = await this.fetchJson<CreateRegisteredModelResponse>(
      '/api/2.0/mlflow/registered-models/create',
      { method: 'POST', body }
    );

    const model = this.transformRegisteredModel(response.registered_model);
    this.emitEvent('mlflow:model:registered', { modelName: name });
    return model;
  }

  /**
   * Get a registered model by name
   */
  async getRegisteredModel(name: string): Promise<MLflowRegisteredModel> {
    const response = await this.fetchJson<GetRegisteredModelResponse>(
      `/api/2.0/mlflow/registered-models/get?name=${encodeURIComponent(name)}`,
      { method: 'GET' }
    );
    return this.transformRegisteredModel(response.registered_model);
  }

  /**
   * List all registered models
   */
  async listRegisteredModels(maxResults = 1000): Promise<MLflowRegisteredModel[]> {
    const models: MLflowRegisteredModel[] = [];
    let pageToken: string | undefined;

    do {
      const url = new URL(`${this.config.trackingUri}/api/2.0/mlflow/registered-models/search`);
      url.searchParams.set('max_results', String(maxResults));
      if (pageToken) {
        url.searchParams.set('page_token', pageToken);
      }

      const response = await this.fetchJson<ListRegisteredModelsResponse>(
        url.pathname + url.search,
        { method: 'GET' }
      );

      if (response.registered_models) {
        models.push(...response.registered_models.map((m) => this.transformRegisteredModel(m)));
      }
      pageToken = response.next_page_token;
    } while (pageToken);

    return models;
  }

  /**
   * Update registered model description
   */
  async updateRegisteredModel(name: string, description: string): Promise<MLflowRegisteredModel> {
    const response = await this.fetchJson<{ registered_model: MLflowRegisteredModel }>(
      '/api/2.0/mlflow/registered-models/update',
      {
        method: 'PATCH',
        body: { name, description },
      }
    );
    return this.transformRegisteredModel(response.registered_model);
  }

  /**
   * Delete a registered model
   */
  async deleteRegisteredModel(name: string): Promise<void> {
    await this.fetchJson('/api/2.0/mlflow/registered-models/delete', {
      method: 'DELETE',
      body: { name },
    });
  }

  /**
   * Set a tag on a registered model
   */
  async setRegisteredModelTag(name: string, key: string, value: string): Promise<void> {
    await this.fetchJson('/api/2.0/mlflow/registered-models/set-tag', {
      method: 'POST',
      body: { name, key, value },
    });
  }

  // ============================================================================
  // Model Versions
  // ============================================================================

  /**
   * Create a model version
   */
  async createModelVersion(
    name: string,
    source: string,
    runId?: string,
    description?: string,
    tags?: Record<string, string>
  ): Promise<MLflowModelVersion> {
    const body: Record<string, unknown> = { name, source };

    if (runId) {
      body.run_id = runId;
    }
    if (description) {
      body.description = description;
    }
    if (tags) {
      body.tags = Object.entries(tags).map(([key, value]) => ({ key, value }));
    }

    const response = await this.fetchJson<CreateModelVersionResponse>(
      '/api/2.0/mlflow/model-versions/create',
      { method: 'POST', body }
    );

    const version = this.transformModelVersion(response.model_version);
    this.emitEvent('mlflow:model:version:created', {
      modelName: name,
      version: version.version,
    });
    return version;
  }

  /**
   * Get a model version
   */
  async getModelVersion(name: string, version: string): Promise<MLflowModelVersion> {
    const response = await this.fetchJson<GetModelVersionResponse>(
      `/api/2.0/mlflow/model-versions/get?name=${encodeURIComponent(name)}&version=${version}`,
      { method: 'GET' }
    );
    return this.transformModelVersion(response.model_version);
  }

  /**
   * Transition model version stage
   */
  async transitionModelVersionStage(
    name: string,
    version: string,
    stage: MLflowModelStage,
    archiveExistingVersions = false
  ): Promise<MLflowModelVersion> {
    const response = await this.fetchJson<TransitionStageResponse>(
      '/api/2.0/mlflow/model-versions/transition-stage',
      {
        method: 'POST',
        body: {
          name,
          version,
          stage,
          archive_existing_versions: archiveExistingVersions,
        },
      }
    );

    const modelVersion = this.transformModelVersion(response.model_version);
    this.emitEvent('mlflow:model:stage:transitioned', {
      modelName: name,
      version,
      stage,
    });
    return modelVersion;
  }

  /**
   * Get latest model versions by stage
   */
  async getLatestVersions(name: string, stages?: MLflowModelStage[]): Promise<MLflowModelVersion[]> {
    const body: Record<string, unknown> = { name };
    if (stages) {
      body.stages = stages;
    }

    const response = await this.fetchJson<GetLatestVersionsResponse>(
      '/api/2.0/mlflow/registered-models/get-latest-versions',
      { method: 'POST', body }
    );

    return (response.model_versions || []).map((v) => this.transformModelVersion(v));
  }

  /**
   * Update model version description
   */
  async updateModelVersion(
    name: string,
    version: string,
    description: string
  ): Promise<MLflowModelVersion> {
    const response = await this.fetchJson<{ model_version: MLflowModelVersion }>(
      '/api/2.0/mlflow/model-versions/update',
      {
        method: 'PATCH',
        body: { name, version, description },
      }
    );
    return this.transformModelVersion(response.model_version);
  }

  /**
   * Delete a model version
   */
  async deleteModelVersion(name: string, version: string): Promise<void> {
    await this.fetchJson('/api/2.0/mlflow/model-versions/delete', {
      method: 'DELETE',
      body: { name, version },
    });
  }

  /**
   * Set a tag on a model version
   */
  async setModelVersionTag(
    name: string,
    version: string,
    key: string,
    value: string
  ): Promise<void> {
    await this.fetchJson('/api/2.0/mlflow/model-versions/set-tag', {
      method: 'POST',
      body: { name, version, key, value },
    });
  }

  // ============================================================================
  // Model Aliases
  // ============================================================================

  /**
   * Set a model alias
   */
  async setModelAlias(name: string, alias: string, version: string): Promise<void> {
    await this.fetchJson('/api/2.0/mlflow/registered-models/alias', {
      method: 'POST',
      body: { name, alias, version },
    });

    this.emitEvent('mlflow:model:alias:set', {
      modelName: name,
      alias,
      version,
    });
  }

  /**
   * Delete a model alias
   */
  async deleteModelAlias(name: string, alias: string): Promise<void> {
    await this.fetchJson(
      `/api/2.0/mlflow/registered-models/alias?name=${encodeURIComponent(name)}&alias=${encodeURIComponent(alias)}`,
      { method: 'DELETE' }
    );
  }

  /**
   * Get model version by alias
   */
  async getModelVersionByAlias(name: string, alias: string): Promise<MLflowModelVersion> {
    const response = await this.fetchJson<{ model_version: MLflowModelVersion }>(
      `/api/2.0/mlflow/registered-models/alias?name=${encodeURIComponent(name)}&alias=${encodeURIComponent(alias)}`,
      { method: 'GET' }
    );
    return this.transformModelVersion(response.model_version);
  }

  // ============================================================================
  // Comparison & Analysis
  // ============================================================================

  /**
   * Compare multiple runs by metrics
   */
  async compareRuns(runIds: string[], metricKeys: string[]): Promise<CompareRunsResult> {
    const comparisons: RunComparison[] = [];

    for (const runId of runIds) {
      const run = await this.getRun(runId);

      const params: Record<string, string> = {};
      for (const param of run.data.params) {
        params[param.key] = param.value;
      }

      const metrics: Record<string, number> = {};
      for (const metric of run.data.metrics) {
        metrics[metric.key] = metric.value;
      }

      const metricHistory: Record<string, MLflowMetric[]> = {};
      for (const key of metricKeys) {
        metricHistory[key] = await this.getMetricHistory(runId, key);
      }

      comparisons.push({
        runId: run.info.runId,
        experimentId: run.info.experimentId,
        status: run.info.status,
        startTime: run.info.startTime,
        endTime: run.info.endTime,
        params,
        metrics,
        metricHistory,
      });
    }

    return {
      runs: comparisons,
      metricKeys,
    };
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Make HTTP request to MLflow API
   */
  private async fetch(path: string, options: RequestInit): Promise<Response> {
    const url = `${this.config.trackingUri}${path}`;

    let lastError: Error | null = null;
    for (let attempt = 0; attempt < (this.config.retryAttempts ?? 3); attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(
          () => controller.abort(),
          this.config.timeout ?? 30000
        );

        const response = await fetch(url, {
          ...options,
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            ...options.headers,
          },
        });

        clearTimeout(timeout);
        return response;
      } catch (error) {
        lastError = error as Error;
        if (attempt < (this.config.retryAttempts ?? 3) - 1) {
          await this.sleep((this.config.retryDelay ?? 1000) * Math.pow(2, attempt));
        }
      }
    }

    throw lastError || new Error('Request failed');
  }

  /**
   * Make HTTP request and parse JSON response
   */
  private async fetchJson<T>(
    path: string,
    options: { method: string; body?: Record<string, unknown> }
  ): Promise<T> {
    const fetchOptions: RequestInit = {
      method: options.method,
    };

    if (options.body) {
      fetchOptions.body = JSON.stringify(options.body);
    }

    const response = await this.fetch(path, fetchOptions);

    if (!response.ok) {
      const errorBody = await response.text();
      throw new MLflowError(
        `MLflow API error: ${response.status} ${response.statusText}`,
        response.status,
        errorBody
      );
    }

    const text = await response.text();
    if (!text) {
      return {} as T;
    }

    return JSON.parse(text) as T;
  }

  /**
   * Transform MLflow API experiment response to our format
   */
  private transformExperiment(experiment: unknown): MLflowExperiment {
    const exp = experiment as Record<string, unknown>;
    return {
      experimentId: String(exp.experiment_id || exp.experimentId),
      name: String(exp.name),
      artifactLocation: String(exp.artifact_location || exp.artifactLocation || ''),
      lifecycleStage: (exp.lifecycle_stage || exp.lifecycleStage || 'active') as 'active' | 'deleted',
      tags: this.transformTags(exp.tags),
      creationTime: Number(exp.creation_time || exp.creationTime || 0),
      lastUpdateTime: Number(exp.last_update_time || exp.lastUpdateTime || 0),
    };
  }

  /**
   * Transform MLflow API run response to our format
   */
  private transformRun(run: unknown): MLflowRun {
    const r = run as Record<string, unknown>;
    const info = (r.info || r) as Record<string, unknown>;
    const data = (r.data || {}) as Record<string, unknown>;

    return {
      info: {
        runId: String(info.run_id || info.runId),
        runUuid: String(info.run_uuid || info.runUuid || info.run_id || info.runId),
        experimentId: String(info.experiment_id || info.experimentId),
        status: (info.status || 'RUNNING') as MLflowRunStatus,
        startTime: Number(info.start_time || info.startTime || 0),
        endTime: info.end_time || info.endTime ? Number(info.end_time || info.endTime) : undefined,
        artifactUri: String(info.artifact_uri || info.artifactUri || ''),
        lifecycleStage: (info.lifecycle_stage || info.lifecycleStage || 'active') as 'active' | 'deleted',
      },
      data: {
        params: this.transformParams(data.params),
        metrics: this.transformMetrics(data.metrics),
        tags: this.transformTags(data.tags),
      },
    };
  }

  /**
   * Transform MLflow API registered model response to our format
   */
  private transformRegisteredModel(model: unknown): MLflowRegisteredModel {
    const m = model as Record<string, unknown>;
    const latestVersions = m.latest_versions || m.latestVersions;
    return {
      name: String(m.name),
      creationTimestamp: Number(m.creation_timestamp || m.creationTimestamp || 0),
      lastUpdatedTimestamp: Number(m.last_updated_timestamp || m.lastUpdatedTimestamp || 0),
      description: m.description ? String(m.description) : undefined,
      latestVersions: Array.isArray(latestVersions)
        ? latestVersions.map((v) => this.transformModelVersion(v))
        : undefined,
      tags: this.transformTags(m.tags),
      aliases: m.aliases as Record<string, string> | undefined,
    };
  }

  /**
   * Transform MLflow API model version response to our format
   */
  private transformModelVersion(version: unknown): MLflowModelVersion {
    const v = version as Record<string, unknown>;
    return {
      name: String(v.name),
      version: String(v.version),
      creationTimestamp: Number(v.creation_timestamp || v.creationTimestamp || 0),
      lastUpdatedTimestamp: Number(v.last_updated_timestamp || v.lastUpdatedTimestamp || 0),
      currentStage: (v.current_stage || v.currentStage || 'None') as MLflowModelStage,
      description: v.description ? String(v.description) : undefined,
      source: String(v.source || ''),
      runId: v.run_id || v.runId ? String(v.run_id || v.runId) : undefined,
      status: (v.status || 'READY') as 'PENDING_REGISTRATION' | 'FAILED_REGISTRATION' | 'READY',
      statusMessage: v.status_message ? String(v.status_message) : undefined,
      tags: this.transformTags(v.tags),
      runLink: v.run_link ? String(v.run_link) : undefined,
      aliases: v.aliases as string[] | undefined,
    };
  }

  /**
   * Transform tags array
   */
  private transformTags(tags: unknown): Array<{ key: string; value: string }> {
    if (!Array.isArray(tags)) {
      return [];
    }
    return tags.map((t: { key?: string; value?: string }) => ({
      key: String(t.key || ''),
      value: String(t.value || ''),
    }));
  }

  /**
   * Transform params array
   */
  private transformParams(params: unknown): Array<{ key: string; value: string }> {
    if (!Array.isArray(params)) {
      return [];
    }
    return params.map((p: { key?: string; value?: string }) => ({
      key: String(p.key || ''),
      value: String(p.value || ''),
    }));
  }

  /**
   * Transform metrics array
   */
  private transformMetrics(metrics: unknown): MLflowMetric[] {
    if (!Array.isArray(metrics)) {
      return [];
    }
    return metrics.map((m: { key?: string; value?: number; timestamp?: number; step?: number }) => ({
      key: String(m.key || ''),
      value: Number(m.value || 0),
      timestamp: Number(m.timestamp || 0),
      step: Number(m.step || 0),
    }));
  }

  /**
   * Emit typed event
   */
  private emitEvent(type: MLflowEventType, data: MLflowEvent['data']): void {
    const event: MLflowEvent = {
      type,
      timestamp: new Date().toISOString(),
      data,
    };
    this.emit(type, event);
    this.emit('mlflow:event', event);
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * MLflow API error
 */
export class MLflowError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public responseBody?: string
  ) {
    super(message);
    this.name = 'MLflowError';
  }
}

// Export singleton instance
export const mlflowService = MLflowService.getInstance();
