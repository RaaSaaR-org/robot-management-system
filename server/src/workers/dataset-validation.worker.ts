/**
 * @file dataset-validation.worker.ts
 * @description NATS consumer worker for async dataset validation
 * @feature datasets
 */

import { natsClient } from '../messaging/index.js';
import { STREAM_NAMES, CONSUMER_NAMES, SUBJECTS } from '../messaging/streams.js';
import { datasetService } from '../services/DatasetService.js';
import type { JsMsg, Consumer } from 'nats';
import type { DatasetValidationJobPayload, ComputeStatsJobPayload } from '../types/dataset.types.js';

// ============================================================================
// WORKER STATE
// ============================================================================

let consumer: Consumer | null = null;
let isRunning = false;
let stopFn: (() => void) | null = null;

// ============================================================================
// WORKER FUNCTIONS
// ============================================================================

/**
 * Start the dataset validation worker
 */
export async function startDatasetValidationWorker(): Promise<void> {
  if (isRunning) {
    console.log('[DatasetValidationWorker] Already running');
    return;
  }

  if (!natsClient.isConnected()) {
    console.log('[DatasetValidationWorker] NATS not connected, skipping worker start');
    return;
  }

  const js = natsClient.getJetStream();
  if (!js) {
    console.log('[DatasetValidationWorker] JetStream not available, skipping worker start');
    return;
  }

  try {
    // Get or create consumer
    const jsm = natsClient.getJetStreamManager();
    if (!jsm) {
      console.log('[DatasetValidationWorker] JetStreamManager not available');
      return;
    }

    // Check if stream exists
    try {
      await jsm.streams.info(STREAM_NAMES.DATASET_VALIDATION);
    } catch {
      console.log(`[DatasetValidationWorker] Stream ${STREAM_NAMES.DATASET_VALIDATION} not found, skipping worker start`);
      return;
    }

    // Get consumer
    consumer = await js.consumers.get(STREAM_NAMES.DATASET_VALIDATION, CONSUMER_NAMES.DATASET_VALIDATORS);
    if (!consumer) {
      console.log('[DatasetValidationWorker] Failed to get consumer');
      return;
    }

    isRunning = true;
    console.log('[DatasetValidationWorker] Started');

    // Process messages
    processMessages(consumer);

  } catch (error) {
    console.error('[DatasetValidationWorker] Error starting worker:', error);
    isRunning = false;
  }
}

/**
 * Stop the dataset validation worker
 */
export async function stopDatasetValidationWorker(): Promise<void> {
  if (!isRunning) {
    return;
  }

  isRunning = false;
  if (stopFn) {
    stopFn();
    stopFn = null;
  }
  console.log('[DatasetValidationWorker] Stopped');
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
      console.error('[DatasetValidationWorker] Error processing messages:', error);
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
  const subject = msg.subject;

  try {
    const data = JSON.parse(msg.string());

    if (subject === SUBJECTS.DATASET_VALIDATE || subject.startsWith('jobs.dataset.validate')) {
      await handleValidationJob(data as DatasetValidationJobPayload);
    } else if (subject === SUBJECTS.DATASET_COMPUTE_STATS || subject.startsWith('jobs.dataset.compute-stats')) {
      await handleStatsJob(data as ComputeStatsJobPayload);
    } else {
      console.warn(`[DatasetValidationWorker] Unknown subject: ${subject}`);
    }

    // Acknowledge the message
    msg.ack();

  } catch (error) {
    console.error(`[DatasetValidationWorker] Error handling message:`, error);

    // Check if we should retry or move to DLQ
    const deliveryCount = msg.info.redeliveryCount ?? 0;
    if (deliveryCount >= 3) {
      // Move to dead letter queue (nak with termination)
      msg.term();
      console.log(`[DatasetValidationWorker] Message terminated after ${deliveryCount} retries`);
    } else {
      // Retry with delay
      msg.nak(30000); // 30 second delay
    }
  }
}

/**
 * Handle dataset validation job
 */
async function handleValidationJob(payload: DatasetValidationJobPayload): Promise<void> {
  const { datasetId, storagePath } = payload;

  console.log(`[DatasetValidationWorker] Processing validation for dataset: ${datasetId}`);

  await datasetService.validateAndUpdateDataset(datasetId, storagePath);

  console.log(`[DatasetValidationWorker] Validation completed for dataset: ${datasetId}`);
}

/**
 * Handle stats computation job (stubbed)
 */
async function handleStatsJob(payload: ComputeStatsJobPayload): Promise<void> {
  const { datasetId, storagePath, force } = payload;

  console.log(`[DatasetValidationWorker] Stats computation requested for dataset: ${datasetId}`);

  // Note: Actual stats computation requires Python worker
  // This is a stub that logs the request
  console.log(`[DatasetValidationWorker] Stats computation is stubbed - requires Python worker`);
  console.log(`[DatasetValidationWorker] Would compute stats for: ${storagePath} (force: ${force})`);

  // In a real implementation, this would:
  // 1. Download dataset from storage
  // 2. Run Python script to compute mean/std/min/max for each feature
  // 3. Upload stats.json to storage
  // 4. Update dataset record with statsJson
}

// ============================================================================
// EXPORTS
// ============================================================================

export const datasetValidationWorker = {
  start: startDatasetValidationWorker,
  stop: stopDatasetValidationWorker,
  isRunning: () => isRunning,
};
