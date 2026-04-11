/**
 * @file LocalTrainer.ts
 * @description Local LoRA training bridge that delegates to the Python training sidecar
 * @feature Federated Learning
 * @status live-conditional
 */

import type { LoRAConfig, TrainingEpisode, TrainingResult } from './types.js';

/** Request payload for the Python training bridge */
interface TrainRequest {
  episodes: TrainingEpisode[];
  lora_config: {
    rank: number;
    alpha: number;
    target_modules: string[];
    epochs: number;
    learning_rate: number;
  };
}

/** Response from the Python training bridge */
interface TrainResponse {
  gradients: number[][];
  loss: number;
  steps: number;
  duration_ms: number;
}

/**
 * Local trainer that delegates LoRA fine-tuning to the Python training bridge
 * running on a configurable port (default 8766).
 */
export class LocalTrainer {
  private readonly bridgeUrl: string;
  private readonly timeoutMs: number;

  constructor(bridgePort: number = 8766, timeoutMs: number = 300000) {
    this.bridgeUrl = `http://localhost:${bridgePort}`;
    this.timeoutMs = timeoutMs;
  }

  /**
   * Run local LoRA training on the provided dataset by calling the Python bridge.
   *
   * @param dataset - Training episodes to learn from
   * @param config - LoRA hyperparameters
   * @returns Training result with gradients, loss, steps, and duration
   */
  async train(
    dataset: TrainingEpisode[],
    config: LoRAConfig,
  ): Promise<TrainingResult> {
    if (dataset.length === 0) {
      throw new Error('Dataset must contain at least one episode');
    }

    const requestBody: TrainRequest = {
      episodes: dataset,
      lora_config: {
        rank: config.rank,
        alpha: config.alpha,
        target_modules: config.targetModules,
        epochs: config.epochs,
        learning_rate: config.learningRate,
      },
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.bridgeUrl}/train`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => 'Unknown error');
        throw new Error(
          `Training bridge error: ${response.status} ${response.statusText} — ${errorBody}`,
        );
      }

      const result = (await response.json()) as TrainResponse;

      return {
        gradients: result.gradients,
        loss: result.loss,
        steps: result.steps,
        duration_ms: result.duration_ms,
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Training bridge timeout after ${this.timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Check if the training bridge is reachable.
   *
   * @returns true if the bridge responds to health checks
   */
  async isAvailable(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      try {
        const response = await fetch(`${this.bridgeUrl}/health`, {
          method: 'GET',
          signal: controller.signal,
        });
        return response.ok;
      } finally {
        clearTimeout(timeout);
      }
    } catch {
      return false;
    }
  }
}
