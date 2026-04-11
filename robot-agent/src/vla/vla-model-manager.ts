/**
 * @file vla-model-manager.ts
 * @description Manages VLA model switching and versioning for fleet deployments
 * @feature vla
 * @status live
 */

import { EventEmitter } from 'events';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Request to switch VLA model
 */
export interface ModelSwitchRequest {
  modelVersionId: string;
  artifactUri: string;
  rollback?: boolean;
}

/**
 * Result of a model switch operation
 */
export interface ModelSwitchResult {
  success: boolean;
  previousModelVersion: string | null;
  newModelVersion: string;
  switchTimeMs: number;
  error?: string;
}

/**
 * Current model state
 */
export interface ModelState {
  currentModelVersion: string | null;
  artifactUri: string | null;
  loadedAt: Date | null;
  isLoaded: boolean;
}

/**
 * Model switch event
 */
export interface ModelSwitchEvent {
  type: 'model:switching' | 'model:switched' | 'model:switch_failed';
  previousVersion: string | null;
  newVersion: string;
  rollback: boolean;
  timestamp: string;
  error?: string;
}

type ModelSwitchEventCallback = (event: ModelSwitchEvent) => void;

// ============================================================================
// VLA MODEL MANAGER
// ============================================================================

/**
 * Manages VLA model versions and switching for fleet deployments.
 *
 * Talks to vla-server `/load-adapter` to actually hot-swap LoRA weights.
 * The vla-server URL comes from `process.env.VLA_SERVER_URL`
 * (default `http://localhost:8000`). vla-server resolves s3:// URIs
 * itself via its boto3 client, so this manager only forwards them.
 */
export class VLAModelManager extends EventEmitter {
  private currentModelVersion: string | null = null;
  private currentArtifactUri: string | null = null;
  private loadedAt: Date | null = null;
  private modelHistory: Array<{ version: string; loadedAt: Date; unloadedAt?: Date }> = [];
  private isSwitching = false;

  // Allow tests to inject a fake fetch implementation.
  private fetchImpl: typeof fetch;

  constructor(opts: { fetchImpl?: typeof fetch } = {}) {
    super();
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /**
   * Resolve the vla-server base URL at call time (so env changes during
   * tests are picked up).
   */
  private getVlaServerUrl(): string {
    return process.env.VLA_SERVER_URL ?? 'http://localhost:8000';
  }

  /**
   * Get current model state
   */
  getModelState(): ModelState {
    return {
      currentModelVersion: this.currentModelVersion,
      artifactUri: this.currentArtifactUri,
      loadedAt: this.loadedAt,
      isLoaded: this.currentModelVersion !== null,
    };
  }

  /**
   * Get current model version
   */
  getCurrentModelVersion(): string | null {
    return this.currentModelVersion;
  }

  /**
   * Get model switch history
   */
  getModelHistory(): Array<{ version: string; loadedAt: Date; unloadedAt?: Date }> {
    return [...this.modelHistory];
  }

  /**
   * Check if a model switch is in progress
   */
  isSwitchInProgress(): boolean {
    return this.isSwitching;
  }

  /**
   * Switch to a new model version
   *
   * @param request The model switch request
   * @returns Result of the switch operation
   */
  async switchModel(request: ModelSwitchRequest): Promise<ModelSwitchResult> {
    if (this.isSwitching) {
      return {
        success: false,
        previousModelVersion: this.currentModelVersion,
        newModelVersion: request.modelVersionId,
        switchTimeMs: 0,
        error: 'Model switch already in progress',
      };
    }

    this.isSwitching = true;
    const startTime = Date.now();
    const previousVersion = this.currentModelVersion;

    // Emit switching event
    this.emitEvent({
      type: 'model:switching',
      previousVersion,
      newVersion: request.modelVersionId,
      rollback: request.rollback ?? false,
      timestamp: new Date().toISOString(),
    });

    try {
      console.log(`[VLAModelManager] Switching model from ${previousVersion} to ${request.modelVersionId}`);

      // Real swap: vla-server downloads the artifact and hot-loads the LoRA adapter.
      await this.realModelSwitch(request);

      // Update current model tracking
      if (this.currentModelVersion) {
        // Mark previous model as unloaded
        const historyEntry = this.modelHistory.find(
          h => h.version === this.currentModelVersion && !h.unloadedAt
        );
        if (historyEntry) {
          historyEntry.unloadedAt = new Date();
        }
      }

      // Set new model as current
      this.currentModelVersion = request.modelVersionId;
      this.currentArtifactUri = request.artifactUri;
      this.loadedAt = new Date();

      // Add to history
      this.modelHistory.push({
        version: request.modelVersionId,
        loadedAt: this.loadedAt,
      });

      // Keep history bounded (last 10 versions)
      if (this.modelHistory.length > 10) {
        this.modelHistory = this.modelHistory.slice(-10);
      }

      const switchTimeMs = Date.now() - startTime;

      // Emit switched event
      this.emitEvent({
        type: 'model:switched',
        previousVersion,
        newVersion: request.modelVersionId,
        rollback: request.rollback ?? false,
        timestamp: new Date().toISOString(),
      });

      console.log(`[VLAModelManager] Model switch complete in ${switchTimeMs}ms`);

      return {
        success: true,
        previousModelVersion: previousVersion,
        newModelVersion: request.modelVersionId,
        switchTimeMs,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const switchTimeMs = Date.now() - startTime;

      // Emit failure event
      this.emitEvent({
        type: 'model:switch_failed',
        previousVersion,
        newVersion: request.modelVersionId,
        rollback: request.rollback ?? false,
        timestamp: new Date().toISOString(),
        error: errorMessage,
      });

      console.error(`[VLAModelManager] Model switch failed: ${errorMessage}`);

      return {
        success: false,
        previousModelVersion: previousVersion,
        newModelVersion: request.modelVersionId,
        switchTimeMs,
        error: errorMessage,
      };
    } finally {
      this.isSwitching = false;
    }
  }

  /**
   * Real model switch: ask vla-server to download + hot-swap the LoRA adapter.
   *
   * Throws on any failure (the caller will translate it into a
   * `model:switch_failed` event + `success: false` result).
   */
  private async realModelSwitch(request: ModelSwitchRequest): Promise<void> {
    const baseUrl = this.getVlaServerUrl();

    // 1. Health-check first so we fail fast (and with a clear message) if
    //    vla-server is down. Without this we'd wait the full load timeout
    //    on a connection refused.
    try {
      const healthResp = await this.fetchWithTimeout(`${baseUrl}/health`, { method: 'GET' }, 5_000);
      if (!healthResp.ok) {
        throw new Error(`vla-server /health returned ${healthResp.status}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`vla-server unreachable at ${baseUrl}: ${msg}`);
    }

    // 2. POST /load-adapter. First load can be slow (S3 download +
    //    PEFT wrap), so allow a generous 60s timeout.
    const body = JSON.stringify({
      adapter_path: request.artifactUri,
      adapter_id: request.modelVersionId,
    });

    let resp: Response;
    try {
      resp = await this.fetchWithTimeout(
        `${baseUrl}/load-adapter`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        },
        60_000,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`vla-server /load-adapter request failed: ${msg}`);
    }

    if (!resp.ok) {
      let detail = `HTTP ${resp.status}`;
      try {
        const errBody = (await resp.json()) as { detail?: string };
        if (errBody.detail) detail = errBody.detail;
      } catch {
        // ignore parse errors
      }
      throw new Error(`vla-server /load-adapter rejected: ${detail}`);
    }

    const data = (await resp.json()) as {
      adapter_id: string;
      load_time_ms: number;
      info?: Record<string, unknown>;
    };
    console.log(
      `[VLAModelManager] vla-server loaded adapter '${data.adapter_id}' in ${data.load_time_ms.toFixed(0)}ms`,
    );
  }

  /**
   * fetch wrapper with a per-call timeout (AbortController).
   */
  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
    timeoutMs: number,
  ): Promise<Response> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      return await this.fetchImpl(url, { ...init, signal: ctrl.signal });
    } finally {
      clearTimeout(t);
    }
  }

  /**
   * Subscribe to model switch events
   */
  onModelSwitch(callback: ModelSwitchEventCallback): () => void {
    this.on('model_switch', callback);
    return () => this.off('model_switch', callback);
  }

  /**
   * Emit a model switch event
   */
  private emitEvent(event: ModelSwitchEvent): void {
    this.emit('model_switch', event);
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get VLA inference metrics (for deployment monitoring)
   */
  getInferenceMetrics(): VLAInferenceMetrics {
    // In production, these would come from actual VLA inference tracking
    return {
      modelVersion: this.currentModelVersion ?? 'none',
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      avgLatencyMs: 0,
      p50LatencyMs: 0,
      p95LatencyMs: 0,
      p99LatencyMs: 0,
      taskSuccesses: 0,
      taskFailures: 0,
      lastUpdated: new Date().toISOString(),
    };
  }
}

/**
 * VLA inference metrics for deployment monitoring
 */
export interface VLAInferenceMetrics {
  modelVersion: string;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  taskSuccesses: number;
  taskFailures: number;
  lastUpdated: string;
}
