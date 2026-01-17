/**
 * @file streams.ts
 * @description JetStream stream definitions for training job queues
 * @feature messaging
 */

import {
  JetStreamManager,
  RetentionPolicy,
  StorageType,
  DiscardPolicy,
  AckPolicy,
  DeliverPolicy,
  ReplayPolicy,
} from 'nats';

// ============================================================================
// STREAM NAMES
// ============================================================================

export const STREAM_NAMES = {
  TRAINING_JOBS: 'TRAINING_JOBS',
  DATASET_VALIDATION: 'DATASET_VALIDATION',
  DEAD_LETTER_QUEUE: 'DEAD_LETTER_QUEUE',
} as const;

export const CONSUMER_NAMES = {
  TRAINING_WORKERS: 'training-workers',
  DATASET_VALIDATORS: 'dataset-validators',
} as const;

export const SUBJECTS = {
  TRAINING_FINETUNE: 'jobs.training.finetune',
  TRAINING_EVALUATE: 'jobs.training.evaluate',
  TRAINING_EXPORT: 'jobs.training.export',
  DATASET_VALIDATE: 'jobs.dataset.validate',
  DATASET_COMPUTE_STATS: 'jobs.dataset.compute-stats',
} as const;

// ============================================================================
// STREAM CREATION
// ============================================================================

/**
 * Create all required JetStream streams
 */
export async function createStreams(jsm: JetStreamManager): Promise<void> {
  await createTrainingJobsStream(jsm);
  await createDatasetValidationStream(jsm);
  await createDeadLetterQueueStream(jsm);
  console.log('[Streams] All streams created successfully');
}

/**
 * Create TRAINING_JOBS stream for VLA model training jobs
 */
async function createTrainingJobsStream(jsm: JetStreamManager): Promise<void> {
  const streamName = STREAM_NAMES.TRAINING_JOBS;

  try {
    // Check if stream exists
    const existingStream = await jsm.streams.info(streamName).catch(() => null);

    if (existingStream) {
      console.log(`[Streams] Stream ${streamName} already exists`);
      // Ensure consumer exists
      await createTrainingWorkersConsumer(jsm);
      return;
    }

    // Create stream
    await jsm.streams.add({
      name: streamName,
      description: 'VLA model training job queue with exactly-once processing',
      subjects: [
        SUBJECTS.TRAINING_FINETUNE,
        SUBJECTS.TRAINING_EVALUATE,
        SUBJECTS.TRAINING_EXPORT,
      ],
      retention: RetentionPolicy.Workqueue, // Delete after ACK
      storage: StorageType.File,
      num_replicas: 1, // Single replica for dev, increase for prod
      max_msgs: 10000,
      max_bytes: 100 * 1024 * 1024, // 100MB
      max_age: 7 * 24 * 60 * 60 * 1e9, // 7 days in nanoseconds
      max_msg_size: 1024 * 1024, // 1MB per message
      duplicate_window: 5 * 60 * 1e9, // 5 minute deduplication window
      discard: DiscardPolicy.Old,
      deny_delete: false,
      deny_purge: false,
    });

    console.log(`[Streams] Created stream: ${streamName}`);

    // Create consumer
    await createTrainingWorkersConsumer(jsm);
  } catch (error) {
    console.error(`[Streams] Error creating stream ${streamName}:`, error);
    throw error;
  }
}

/**
 * Create training-workers consumer for TRAINING_JOBS stream
 */
async function createTrainingWorkersConsumer(jsm: JetStreamManager): Promise<void> {
  const streamName = STREAM_NAMES.TRAINING_JOBS;
  const consumerName = CONSUMER_NAMES.TRAINING_WORKERS;

  try {
    // Check if consumer exists
    const existingConsumer = await jsm.consumers.info(streamName, consumerName).catch(() => null);

    if (existingConsumer) {
      console.log(`[Streams] Consumer ${consumerName} already exists`);
      return;
    }

    await jsm.consumers.add(streamName, {
      name: consumerName,
      durable_name: consumerName,
      description: 'Durable consumer for GPU training workers',
      ack_policy: AckPolicy.Explicit,
      ack_wait: 30 * 60 * 1e9, // 30 minutes for long training jobs
      max_deliver: 3, // Max 3 delivery attempts
      max_ack_pending: 5, // Max 5 concurrent jobs per worker group
      deliver_policy: DeliverPolicy.All,
      replay_policy: ReplayPolicy.Instant,
      filter_subjects: ['jobs.training.>'],
      // Exponential backoff for retries
      backoff: [
        30 * 1e9, // 30 seconds
        5 * 60 * 1e9, // 5 minutes
        30 * 60 * 1e9, // 30 minutes
      ],
    });

    console.log(`[Streams] Created consumer: ${consumerName}`);
  } catch (error) {
    console.error(`[Streams] Error creating consumer ${consumerName}:`, error);
    throw error;
  }
}

/**
 * Create DATASET_VALIDATION stream for dataset validation jobs
 */
async function createDatasetValidationStream(jsm: JetStreamManager): Promise<void> {
  const streamName = STREAM_NAMES.DATASET_VALIDATION;

  try {
    // Check if stream exists
    const existingStream = await jsm.streams.info(streamName).catch(() => null);

    if (existingStream) {
      console.log(`[Streams] Stream ${streamName} already exists`);
      // Ensure consumer exists
      await createDatasetValidatorsConsumer(jsm);
      return;
    }

    // Create stream
    await jsm.streams.add({
      name: streamName,
      description: 'Dataset validation and stats computation jobs',
      subjects: [
        SUBJECTS.DATASET_VALIDATE,
        SUBJECTS.DATASET_COMPUTE_STATS,
      ],
      retention: RetentionPolicy.Workqueue,
      storage: StorageType.File,
      num_replicas: 1,
      max_msgs: 1000,
      max_bytes: 50 * 1024 * 1024, // 50MB
      max_age: 24 * 60 * 60 * 1e9, // 24 hours in nanoseconds
      max_msg_size: 64 * 1024, // 64KB per message
      duplicate_window: 5 * 60 * 1e9, // 5 minute deduplication window
      discard: DiscardPolicy.Old,
      deny_delete: false,
      deny_purge: false,
    });

    console.log(`[Streams] Created stream: ${streamName}`);

    // Create consumer
    await createDatasetValidatorsConsumer(jsm);
  } catch (error) {
    console.error(`[Streams] Error creating stream ${streamName}:`, error);
    throw error;
  }
}

/**
 * Create dataset-validators consumer for DATASET_VALIDATION stream
 */
async function createDatasetValidatorsConsumer(jsm: JetStreamManager): Promise<void> {
  const streamName = STREAM_NAMES.DATASET_VALIDATION;
  const consumerName = CONSUMER_NAMES.DATASET_VALIDATORS;

  try {
    // Check if consumer exists
    const existingConsumer = await jsm.consumers.info(streamName, consumerName).catch(() => null);

    if (existingConsumer) {
      console.log(`[Streams] Consumer ${consumerName} already exists`);
      return;
    }

    await jsm.consumers.add(streamName, {
      name: consumerName,
      durable_name: consumerName,
      description: 'Durable consumer for dataset validation workers',
      ack_policy: AckPolicy.Explicit,
      ack_wait: 10 * 60 * 1e9, // 10 minutes for validation
      max_deliver: 3, // Max 3 delivery attempts
      max_ack_pending: 10, // Max 10 concurrent validations
      deliver_policy: DeliverPolicy.All,
      replay_policy: ReplayPolicy.Instant,
      filter_subjects: ['jobs.dataset.>'],
      // Exponential backoff for retries
      backoff: [
        30 * 1e9, // 30 seconds
        2 * 60 * 1e9, // 2 minutes
        10 * 60 * 1e9, // 10 minutes
      ],
    });

    console.log(`[Streams] Created consumer: ${consumerName}`);
  } catch (error) {
    console.error(`[Streams] Error creating consumer ${consumerName}:`, error);
    throw error;
  }
}

/**
 * Create DEAD_LETTER_QUEUE stream for failed jobs
 */
async function createDeadLetterQueueStream(jsm: JetStreamManager): Promise<void> {
  const streamName = STREAM_NAMES.DEAD_LETTER_QUEUE;

  try {
    // Check if stream exists
    const existingStream = await jsm.streams.info(streamName).catch(() => null);

    if (existingStream) {
      console.log(`[Streams] Stream ${streamName} already exists`);
      return;
    }

    await jsm.streams.add({
      name: streamName,
      description: 'Failed jobs and terminated messages',
      subjects: [
        'dlq.training.>',
      ],
      retention: RetentionPolicy.Limits,
      storage: StorageType.File,
      num_replicas: 1,
      max_age: 30 * 24 * 60 * 60 * 1e9, // 30 days
      max_bytes: 500 * 1024 * 1024, // 500MB
      discard: DiscardPolicy.Old,
    });

    console.log(`[Streams] Created stream: ${streamName}`);
  } catch (error) {
    console.error(`[Streams] Error creating stream ${streamName}:`, error);
    throw error;
  }
}

/**
 * Get stream info
 */
export async function getStreamInfo(jsm: JetStreamManager, streamName: string) {
  try {
    return await jsm.streams.info(streamName);
  } catch {
    return null;
  }
}

/**
 * Get consumer info
 */
export async function getConsumerInfo(jsm: JetStreamManager, streamName: string, consumerName: string) {
  try {
    return await jsm.consumers.info(streamName, consumerName);
  } catch {
    return null;
  }
}
