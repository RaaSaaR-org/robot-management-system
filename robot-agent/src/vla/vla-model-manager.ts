/**
 * @file vla-model-manager.ts
 * @description Manages VLA model switching and versioning for fleet deployments
 * @feature vla
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
 * Manages VLA model versions and switching for fleet deployments
 *
 * In a real implementation, this would:
 * 1. Download model artifacts from storage (RustFS/MinIO)
 * 2. Signal the VLA inference server to load the new model
 * 3. Track model version history for rollback support
 *
 * For simulation, we track model versions without actual model loading.
 */
export class VLAModelManager extends EventEmitter {
  private currentModelVersion: string | null = null;
  private currentArtifactUri: string | null = null;
  private loadedAt: Date | null = null;
  private modelHistory: Array<{ version: string; loadedAt: Date; unloadedAt?: Date }> = [];
  private isSwitching = false;

  constructor() {
    super();
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

      // In production, this would:
      // 1. Download model from artifactUri (RustFS/MinIO)
      // 2. Validate model checksum
      // 3. Signal VLA inference server to load new model
      // 4. Wait for confirmation

      // Simulate model switch delay (in production: actual download/load time)
      await this.simulateModelSwitch(request);

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
   * Simulate model switch (in production: actual download and load)
   */
  private async simulateModelSwitch(request: ModelSwitchRequest): Promise<void> {
    // Simulate download time (200-500ms)
    const downloadTime = 200 + Math.random() * 300;
    await this.sleep(downloadTime);

    // Simulate model load time (100-300ms)
    const loadTime = 100 + Math.random() * 200;
    await this.sleep(loadTime);

    // Small chance of simulated failure for testing (5%)
    if (Math.random() < 0.05 && !request.rollback) {
      throw new Error('Simulated model switch failure');
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
