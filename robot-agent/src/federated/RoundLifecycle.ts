/**
 * @file RoundLifecycle.ts
 * @description Orchestrates the full federated learning round lifecycle on the robot
 * @feature Federated Learning
 * @status live-conditional
 */

import { FederatedClient } from './FederatedClient.js';
import { LocalTrainer } from './LocalTrainer.js';
import { DifferentialPrivacy } from './DifferentialPrivacy.js';
import type {
  FederatedRound,
  FederatedStatus,
  FederatedEvent,
  FederatedEventListener,
  FederatedEventType,
  TrainingEpisode,
} from './types.js';

/** Configuration for the RoundLifecycle */
export interface RoundLifecycleConfig {
  /** Server URL for the federated API */
  serverUrl: string;
  /** Robot identifier */
  robotId: string;
  /** Poll interval for checking open rounds (ms) */
  pollIntervalMs?: number;
  /** Port for the Python training bridge */
  trainingBridgePort?: number;
  /** Timeout for API requests (ms) */
  apiTimeoutMs?: number;
  /** Timeout for training requests (ms) */
  trainingTimeoutMs?: number;
  /** Function to retrieve local training episodes */
  getLocalEpisodes: () => Promise<TrainingEpisode[]>;
}

/**
 * Orchestrates the full federated learning round on the robot:
 * 1. Poll server for open rounds
 * 2. Join round
 * 3. Train locally with LoRA
 * 4. Apply differential privacy to gradients
 * 5. Upload protected gradients
 * 6. Download and apply new global model
 *
 * Emits events: round-started, training-complete, gradients-uploaded, model-updated, round-error
 */
export class RoundLifecycle {
  private readonly client: FederatedClient;
  private readonly trainer: LocalTrainer;
  private readonly dp: DifferentialPrivacy;
  private readonly pollIntervalMs: number;
  private readonly getLocalEpisodes: () => Promise<TrainingEpisode[]>;

  private listeners: Set<FederatedEventListener> = new Set();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private running: boolean = false;
  private currentRoundId: string | null = null;
  private phase: FederatedStatus['phase'] = 'idle';
  private lastError: string | null = null;
  private roundsParticipated: number = 0;
  private lastParticipation: string | null = null;

  constructor(cfg: RoundLifecycleConfig) {
    this.client = new FederatedClient(
      cfg.serverUrl,
      cfg.robotId,
      cfg.apiTimeoutMs ?? 30000,
    );
    this.trainer = new LocalTrainer(
      cfg.trainingBridgePort ?? 8766,
      cfg.trainingTimeoutMs ?? 300000,
    );
    this.dp = new DifferentialPrivacy();
    this.pollIntervalMs = cfg.pollIntervalMs ?? 30000;
    this.getLocalEpisodes = cfg.getLocalEpisodes;
  }

  /**
   * Start the lifecycle polling loop.
   * Checks for open rounds at the configured interval.
   */
  start(): void {
    if (this.running) {
      return;
    }

    this.running = true;
    this.phase = 'waiting';
    console.log(`[FederatedLearning] Lifecycle started, polling every ${this.pollIntervalMs}ms`);

    // Initial check
    void this.checkForRounds();

    this.pollTimer = setInterval(() => {
      void this.checkForRounds();
    }, this.pollIntervalMs);
  }

  /**
   * Stop the lifecycle polling loop.
   */
  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.running = false;
    this.phase = 'idle';
    console.log('[FederatedLearning] Lifecycle stopped');
  }

  /**
   * Subscribe to lifecycle events.
   *
   * @param listener - Callback for federated events
   * @returns Unsubscribe function
   */
  onEvent(listener: FederatedEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Get the current status of the federated learning subsystem.
   */
  getStatus(): FederatedStatus {
    return {
      enabled: true,
      running: this.running,
      currentRoundId: this.currentRoundId,
      phase: this.phase,
      lastError: this.lastError,
      roundsParticipated: this.roundsParticipated,
      lastParticipation: this.lastParticipation,
    };
  }

  /**
   * Poll the server for open rounds and participate if available.
   */
  private async checkForRounds(): Promise<void> {
    // Skip if already participating in a round
    if (this.phase !== 'waiting') {
      return;
    }

    try {
      const rounds = await this.client.getOpenRounds();

      if (rounds.length > 0) {
        // Participate in the first available round
        await this.participate(rounds[0]);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.warn(`[FederatedLearning] Error checking for rounds: ${message}`);
      // Don't set error phase — transient network errors shouldn't stop polling
    }
  }

  /**
   * Participate in a federated learning round:
   * join → train → apply DP → upload → download model
   */
  private async participate(round: FederatedRound): Promise<void> {
    this.currentRoundId = round.id;
    this.lastError = null;

    try {
      // 1. Join the round
      this.phase = 'training';
      this.emit('round-started', round.id);
      console.log(`[FederatedLearning] Joining round ${round.id} (round #${round.roundNumber})`);
      await this.client.joinRound(round.id);

      // 2. Get local training data
      const episodes = await this.getLocalEpisodes();
      if (episodes.length === 0) {
        console.warn('[FederatedLearning] No local episodes available, skipping round');
        this.phase = 'waiting';
        this.currentRoundId = null;
        return;
      }

      // 3. Train locally
      console.log(`[FederatedLearning] Training on ${episodes.length} episodes`);
      const result = await this.trainer.train(episodes, round.loraConfig);
      this.emit('training-complete', round.id, {
        loss: result.loss,
        steps: result.steps,
        duration_ms: result.duration_ms,
      });
      console.log(`[FederatedLearning] Training complete: loss=${result.loss.toFixed(4)}, steps=${result.steps}`);

      // 4. Apply differential privacy
      this.phase = 'uploading';
      const clipped = this.dp.clipGradients(result.gradients, round.dpConfig.maxNorm);
      const protectedGradients = this.dp.addGaussianNoise(
        clipped,
        round.dpConfig.maxNorm,
        round.dpConfig.epsilon,
        round.dpConfig.delta,
      );

      // 5. Upload protected gradients
      console.log('[FederatedLearning] Uploading DP-protected gradients');
      await this.client.uploadGradients(round.id, protectedGradients, {
        loss: result.loss,
        steps: result.steps,
        duration_ms: result.duration_ms,
      });
      this.emit('gradients-uploaded', round.id);

      // 6. Download new global model
      this.phase = 'downloading';
      console.log('[FederatedLearning] Downloading aggregated global model');
      const modelResponse = await this.client.downloadGlobalModel(round.id);
      this.emit('model-updated', round.id, {
        modelUri: modelResponse.modelUri,
        aggregatedFrom: modelResponse.aggregatedFrom,
      });
      console.log(`[FederatedLearning] Model updated from ${modelResponse.aggregatedFrom} participants`);

      // Done
      this.roundsParticipated++;
      this.lastParticipation = new Date().toISOString();
      this.phase = 'waiting';
      this.currentRoundId = null;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.lastError = message;
      this.phase = 'error';
      this.emit('round-error', round.id, { error: message });
      console.error(`[FederatedLearning] Round ${round.id} failed: ${message}`);

      // Recover to waiting state after error
      setTimeout(() => {
        if (this.phase === 'error') {
          this.phase = 'waiting';
          this.currentRoundId = null;
        }
      }, 5000);
    }
  }

  /**
   * Emit a lifecycle event to all registered listeners.
   */
  private emit(
    type: FederatedEventType,
    roundId: string,
    data?: Record<string, unknown>,
  ): void {
    const event: FederatedEvent = {
      type,
      roundId,
      timestamp: new Date().toISOString(),
      data,
    };

    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('[FederatedLearning] Event listener error:', error);
      }
    }
  }
}
