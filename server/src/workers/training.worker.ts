/**
 * @file training.worker.ts
 * @description NATS consumer worker for training job processing (stubbed)
 * @feature vla
 *
 * This worker bridges NATS JetStream to Python training workers.
 * Currently stubbed - logs jobs and marks them as running.
 * Actual Python integration is deferred to a future task.
 *
 * Worker callback endpoints are fully functional for external Python workers:
 * - POST /api/training/workers/heartbeat
 * - POST /api/training/workers/progress
 * - POST /api/training/workers/complete
 * - POST /api/training/workers/failed
 * - POST /api/training/workers/checkpoint
 */

import { natsClient } from '../messaging/index.js';
import { STREAM_NAMES, CONSUMER_NAMES } from '../messaging/streams.js';
import { trainingOrchestrator } from '../services/TrainingOrchestrator.js';
import type { JsMsg, Consumer } from 'nats';
import type { TrainingJobPayload } from '../types/training.types.js';

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
 * Start the training worker
 */
export async function startTrainingWorker(): Promise<void> {
  if (isRunning) {
    console.log('[TrainingWorker] Already running');
    return;
  }

  if (!natsClient.isConnected()) {
    console.log('[TrainingWorker] NATS not connected, skipping worker start');
    return;
  }

  const js = natsClient.getJetStream();
  if (!js) {
    console.log('[TrainingWorker] JetStream not available, skipping worker start');
    return;
  }

  try {
    // Get or create consumer
    const jsm = natsClient.getJetStreamManager();
    if (!jsm) {
      console.log('[TrainingWorker] JetStreamManager not available');
      return;
    }

    // Check if stream exists
    try {
      await jsm.streams.info(STREAM_NAMES.TRAINING_JOBS);
    } catch {
      console.log(`[TrainingWorker] Stream ${STREAM_NAMES.TRAINING_JOBS} not found, skipping worker start`);
      return;
    }

    // Get consumer
    consumer = await js.consumers.get(STREAM_NAMES.TRAINING_JOBS, CONSUMER_NAMES.TRAINING_WORKERS);
    if (!consumer) {
      console.log('[TrainingWorker] Failed to get consumer');
      return;
    }

    isRunning = true;
    console.log('[TrainingWorker] Started (stubbed - Python integration deferred)');

    // Process messages
    processMessages(consumer);
  } catch (error) {
    console.error('[TrainingWorker] Error starting worker:', error);
    isRunning = false;
  }
}

/**
 * Stop the training worker
 */
export async function stopTrainingWorker(): Promise<void> {
  if (!isRunning) {
    return;
  }

  isRunning = false;
  if (stopFn) {
    stopFn();
    stopFn = null;
  }
  console.log('[TrainingWorker] Stopped');
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
      console.error('[TrainingWorker] Error processing messages:', error);
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
    const data = JSON.parse(msg.string()) as TrainingJobPayload;
    const { jobId, datasetId, baseModel, fineTuneMethod, hyperparameters, gpuRequirements } = data;

    console.log(`[TrainingWorker] Received job: ${jobId}`);
    console.log(`[TrainingWorker]   Dataset: ${datasetId}`);
    console.log(`[TrainingWorker]   Model: ${baseModel} (${fineTuneMethod})`);
    console.log(`[TrainingWorker]   Hyperparameters:`, hyperparameters);
    console.log(`[TrainingWorker]   GPU Requirements:`, gpuRequirements);

    // Mark job as started via orchestrator
    await trainingOrchestrator.startJob(jobId);

    // STUBBED: In a real implementation, this would:
    // 1. Prepare training config JSON
    // 2. HTTP POST to Python training service:
    //    POST http://training-service:8000/train
    //    Body: { jobId, datasetPath, baseModel, hyperparameters, ... }
    // 3. Python worker would call back to our endpoints:
    //    - POST /api/training/workers/progress (repeating)
    //    - POST /api/training/workers/checkpoint (on checkpoints)
    //    - POST /api/training/workers/complete (on success)
    //    - POST /api/training/workers/failed (on failure)

    console.log('[TrainingWorker] Job started (stubbed - awaiting external Python worker)');
    console.log('[TrainingWorker] External workers can call back to:');
    console.log('[TrainingWorker]   POST /api/training/workers/progress');
    console.log('[TrainingWorker]   POST /api/training/workers/complete');
    console.log('[TrainingWorker]   POST /api/training/workers/failed');

    // Acknowledge the message
    msg.ack();
  } catch (error) {
    console.error('[TrainingWorker] Error handling message:', error);

    // Check if we should retry or move to DLQ
    const deliveryCount = msg.info.redeliveryCount ?? 0;
    if (deliveryCount >= 3) {
      // Move to dead letter queue (nak with termination)
      msg.term();
      console.log(`[TrainingWorker] Message terminated after ${deliveryCount} retries`);
    } else {
      // Retry with delay
      msg.nak(30000); // 30 second delay
    }
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export const trainingWorker = {
  start: startTrainingWorker,
  stop: stopTrainingWorker,
  isRunning: () => isRunning,
};
