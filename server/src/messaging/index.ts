/**
 * @file index.ts
 * @description Barrel export for messaging module
 * @feature messaging
 */

export { natsClient, NatsClient } from './nats-client.js';
export type {
  NatsClientConfig,
  NatsConnectionStatus,
  NatsStatusCallback,
} from './nats-client.js';

export { createStreams, STREAM_NAMES, CONSUMER_NAMES, SUBJECTS } from './streams.js';

export {
  createKVStores,
  KV_STORE_NAMES,
  kvGet,
  kvPut,
  kvDelete,
  kvWatch,
  kvKeys,
} from './kv-stores.js';

export {
  JetStreamJobQueue,
  getJobQueue,
  initializeJobQueue,
} from './job-queue.js';
export type {
  JobPayload,
  JobOptions,
  JobContext,
  JobProcessor,
} from './job-queue.js';

// Re-export types from training.types for convenience
export type {
  TrainingJobType,
  JobProgress,
  QueueStats,
} from '../types/training.types.js';
