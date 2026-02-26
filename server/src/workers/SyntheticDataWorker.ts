/**
 * @file SyntheticDataWorker.ts
 * @description NATS JetStream consumer worker for synthetic data generation jobs
 * @feature Synthetic Data
 */

import { natsClient } from '../messaging/index.js';
import { STREAM_NAMES, CONSUMER_NAMES } from '../messaging/streams.js';
import type { JsMsg, Consumer } from 'nats';

// ============================================================================
// TYPES
// ============================================================================

export interface SyntheticJobConfig {
  count: number;
  modalities: string[];
  augmentations: string[];
}

export interface SyntheticJobPayload {
  jobId: string;
  datasetId: string;
  config: SyntheticJobConfig;
}

export type SyntheticJobStatus = 'queued' | 'processing' | 'completed' | 'failed';

export interface SyntheticJobRecord {
  jobId: string;
  datasetId: string;
  config: SyntheticJobConfig;
  status: SyntheticJobStatus;
  errorMessage?: string;
  retries: number;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

export interface SyntheticWorkerStats {
  processed: number;
  failed: number;
  inFlight: number;
}

// ============================================================================
// IN-MEMORY JOB STORE
// ============================================================================

const jobStore = new Map<string, SyntheticJobRecord>();

// ============================================================================
// WORKER STATE
// ============================================================================

let consumer: Consumer | null = null;
let isRunning = false;
let stopFn: (() => void) | null = null;

let statsProcessed = 0;
let statsFailed = 0;
let statsInFlight = 0;

// ============================================================================
// WORKER FUNCTIONS
// ============================================================================

/**
 * Start the synthetic data worker
 */
export async function startSyntheticDataWorker(): Promise<void> {
  if (isRunning) {
    console.log('[SyntheticDataWorker] Already running');
    return;
  }

  if (!natsClient.isConnected()) {
    console.log('[SyntheticDataWorker] NATS not connected, skipping worker start');
    return;
  }

  const js = natsClient.getJetStream();
  if (!js) {
    console.log('[SyntheticDataWorker] JetStream not available, skipping worker start');
    return;
  }

  try {
    const jsm = natsClient.getJetStreamManager();
    if (!jsm) {
      console.log('[SyntheticDataWorker] JetStreamManager not available');
      return;
    }

    // Check if stream exists
    try {
      await jsm.streams.info(STREAM_NAMES.SYNTHETIC_DATA);
    } catch {
      console.log(`[SyntheticDataWorker] Stream ${STREAM_NAMES.SYNTHETIC_DATA} not found, skipping worker start`);
      return;
    }

    // Get consumer
    consumer = await js.consumers.get(STREAM_NAMES.SYNTHETIC_DATA, CONSUMER_NAMES.SYNTHETIC_WORKERS);
    if (!consumer) {
      console.log('[SyntheticDataWorker] Failed to get consumer');
      return;
    }

    isRunning = true;
    console.log('[SyntheticDataWorker] Started');

    // Process messages
    processMessages(consumer);
  } catch (error) {
    console.error('[SyntheticDataWorker] Error starting worker:', error);
    isRunning = false;
  }
}

/**
 * Stop the synthetic data worker
 */
export async function stopSyntheticDataWorker(): Promise<void> {
  if (!isRunning) {
    return;
  }

  isRunning = false;
  if (stopFn) {
    stopFn();
    stopFn = null;
  }
  console.log('[SyntheticDataWorker] Stopped');
}

/**
 * Process messages from the consumer
 */
async function processMessages(consumerRef: Consumer): Promise<void> {
  try {
    const messages = await consumerRef.consume({ max_messages: 5 });

    // Store stop function
    stopFn = () => {
      messages.stop();
    };

    for await (const msg of messages) {
      if (!isRunning) {
        break;
      }

      await handleMessage(msg);
    }
  } catch (error) {
    if (isRunning) {
      console.error('[SyntheticDataWorker] Error processing messages:', error);
      // Restart after a delay
      setTimeout(() => {
        if (isRunning && consumer) {
          processMessages(consumer);
        }
      }, 5000);
    }
  }
}

/**
 * Handle a single message
 */
async function handleMessage(msg: JsMsg): Promise<void> {
  try {
    const data = JSON.parse(msg.string()) as SyntheticJobPayload;

    await processJob(data);

    // Acknowledge the message
    msg.ack();
  } catch (error) {
    console.error('[SyntheticDataWorker] Error handling message:', error);

    // Check if we should retry or terminate
    const deliveryCount = msg.info.redeliveryCount ?? 0;
    if (deliveryCount >= 3) {
      // Max retries reached — mark as failed and terminate
      try {
        const data = JSON.parse(msg.string()) as SyntheticJobPayload;
        updateJobStatus(data.jobId, 'failed', error instanceof Error ? error.message : 'Max retries exceeded');
      } catch {
        // Could not parse message for status update
      }
      msg.term();
      statsFailed++;
      console.log(`[SyntheticDataWorker] Message terminated after ${deliveryCount} retries`);
    } else {
      // Retry with delay
      msg.nak(30000); // 30 second delay
    }
  }
}

/**
 * Process a single synthetic data generation job
 */
async function processJob(job: SyntheticJobPayload): Promise<void> {
  const { jobId, datasetId, config } = job;

  console.log(`[SyntheticDataWorker] Processing job: ${jobId} (dataset: ${datasetId})`);

  // Update status to processing
  updateJobStatus(jobId, 'processing');
  statsInFlight++;

  try {
    // Stub: simulate processing (100ms)
    await new Promise((resolve) => setTimeout(resolve, 100));

    console.log(`[SyntheticDataWorker] Job ${jobId}: generating ${config.count} samples`);
    console.log(`[SyntheticDataWorker] Job ${jobId}: modalities=${config.modalities.join(',')}, augmentations=${config.augmentations.join(',')}`);

    // Mark as completed
    updateJobStatus(jobId, 'completed');
    statsProcessed++;
    console.log(`[SyntheticDataWorker] Job ${jobId} completed`);
  } catch (error) {
    updateJobStatus(jobId, 'failed', error instanceof Error ? error.message : 'Unknown error');
    statsFailed++;
    throw error;
  } finally {
    statsInFlight--;
  }
}

/**
 * Update job status in the in-memory store
 */
function updateJobStatus(jobId: string, status: SyntheticJobStatus, errorMessage?: string): void {
  const existing = jobStore.get(jobId);
  if (existing) {
    existing.status = status;
    existing.updatedAt = new Date();
    if (errorMessage) {
      existing.errorMessage = errorMessage;
    }
    if (status === 'completed' || status === 'failed') {
      existing.completedAt = new Date();
    }
  }
}

/**
 * Get worker stats
 */
export function getStats(): SyntheticWorkerStats {
  return {
    processed: statsProcessed,
    failed: statsFailed,
    inFlight: statsInFlight,
  };
}

/**
 * Get the in-memory job store (for routes)
 */
export function getJobStore(): Map<string, SyntheticJobRecord> {
  return jobStore;
}

/**
 * Reset worker stats (for testing)
 */
export function resetStats(): void {
  statsProcessed = 0;
  statsFailed = 0;
  statsInFlight = 0;
}

/**
 * Reset the job store (for testing)
 */
export function resetJobStore(): void {
  jobStore.clear();
}

// ============================================================================
// EXPORTS
// ============================================================================

export const syntheticDataWorker = {
  start: startSyntheticDataWorker,
  stop: stopSyntheticDataWorker,
  isRunning: () => isRunning,
  getStats,
  getJobStore,
  resetStats,
  resetJobStore,
};
