/**
 * @file job-queue.ts
 * @description JetStream-based job queue for training jobs
 * @feature messaging
 */

import {
  JetStreamClient,
  JetStreamManager,
  StringCodec,
  ConsumerMessages,
  JsMsg,
  KV,
} from 'nats';
import { natsClient } from './nats-client.js';
import { STREAM_NAMES, CONSUMER_NAMES, SUBJECTS } from './streams.js';
import { KV_STORE_NAMES, kvGet, kvPut, kvDelete, kvWatch } from './kv-stores.js';
import type {
  TrainingJobType,
  JobProgress,
  QueueStats,
} from '../types/training.types.js';
import type {
  BaseModel,
  FineTuneMethod,
  Hyperparameters,
  GpuRequirements,
} from '../types/vla.types.js';

// ============================================================================
// TYPES
// ============================================================================

// Re-export types for convenience
export type { TrainingJobType, JobProgress, QueueStats };

export interface JobPayload {
  jobId: string;
  datasetId: string;
  baseModel: BaseModel;
  fineTuneMethod: FineTuneMethod;
  hyperparameters: Hyperparameters;
  gpuRequirements: GpuRequirements;
  priority: number;
  metadata?: Record<string, unknown>;
}

export interface JobOptions {
  msgID?: string;
  priority?: number;
}

export interface JobContext {
  jobId: string;
  msg: JsMsg;
  updateProgress: (progress: Partial<JobProgress>) => Promise<void>;
  heartbeat: () => void;
  isCancelled: () => Promise<boolean>;
}

export type JobProcessor = (payload: JobPayload, context: JobContext) => Promise<void>;

// ============================================================================
// JOB QUEUE CLASS
// ============================================================================

/**
 * JetStream-based job queue for training jobs
 */
export class JetStreamJobQueue {
  private js: JetStreamClient;
  private jsm: JetStreamManager;
  private progressKV: KV | null = null;
  private readonly sc = StringCodec();
  private cancelledJobs: Set<string> = new Set();

  constructor() {
    this.js = natsClient.getJetStream();
    this.jsm = natsClient.getJetStreamManager();
  }

  /**
   * Initialize the job queue
   */
  async initialize(): Promise<void> {
    this.progressKV = await natsClient.getKV(KV_STORE_NAMES.JOB_PROGRESS);
    console.log('[JobQueue] Initialized');
  }

  /**
   * Add a job to the queue
   */
  async addJob(type: TrainingJobType, data: JobPayload, options?: JobOptions): Promise<string> {
    const subject = this.getSubjectForType(type);
    const msgID = options?.msgID ?? data.jobId;

    // Publish to JetStream
    const result = await natsClient.jetPublish(subject, data, { msgID });

    if (result.duplicate) {
      console.log(`[JobQueue] Duplicate job detected: ${msgID}`);
    } else {
      console.log(`[JobQueue] Job added: ${msgID} (seq: ${result.seq})`);
    }

    // Initialize progress in KV store
    await this.initializeProgress(data.jobId);

    return data.jobId;
  }

  /**
   * Initialize job progress in KV store
   */
  private async initializeProgress(jobId: string): Promise<void> {
    if (!this.progressKV) {
      throw new Error('Job queue not initialized');
    }

    const progress: JobProgress = {
      status: 'pending',
      progress: 0,
      updatedAt: new Date().toISOString(),
    };

    await kvPut(this.progressKV, `job.${jobId}`, progress);
  }

  /**
   * Get subject for job type
   */
  private getSubjectForType(type: TrainingJobType): string {
    switch (type) {
      case 'finetune':
        return SUBJECTS.TRAINING_FINETUNE;
      case 'evaluate':
        return SUBJECTS.TRAINING_EVALUATE;
      case 'export':
        return SUBJECTS.TRAINING_EXPORT;
      default:
        throw new Error(`Unknown job type: ${type}`);
    }
  }

  /**
   * Process jobs from the queue
   */
  async process(processor: JobProcessor, concurrency = 1): Promise<() => void> {
    const consumer = await this.js.consumers.get(
      STREAM_NAMES.TRAINING_JOBS,
      CONSUMER_NAMES.TRAINING_WORKERS
    );

    let running = true;

    const processMessages = async () => {
      while (running) {
        try {
          const messages = await consumer.consume({ max_messages: concurrency });

          for await (const msg of messages) {
            if (!running) break;

            try {
              const payload = JSON.parse(this.sc.decode(msg.data)) as JobPayload;
              console.log(`[JobQueue] Processing job: ${payload.jobId}`);

              // Update progress to running
              await this.updateJobProgress(payload.jobId, {
                status: 'running',
                progress: 0,
                updatedAt: new Date().toISOString(),
              });

              // Create job context
              const context: JobContext = {
                jobId: payload.jobId,
                msg,
                updateProgress: async (progress) => {
                  await this.updateJobProgress(payload.jobId, {
                    ...progress,
                    updatedAt: new Date().toISOString(),
                  });
                },
                heartbeat: () => {
                  msg.working();
                },
                isCancelled: async () => {
                  return this.cancelledJobs.has(payload.jobId);
                },
              };

              // Process the job
              await processor(payload, context);

              // Update progress to completed
              await this.updateJobProgress(payload.jobId, {
                status: 'completed',
                progress: 100,
                updatedAt: new Date().toISOString(),
              });

              // Acknowledge the message
              msg.ack();
              console.log(`[JobQueue] Job completed: ${payload.jobId}`);
            } catch (error) {
              console.error(`[JobQueue] Job processing error:`, error);

              const payload = JSON.parse(this.sc.decode(msg.data)) as JobPayload;

              // Update progress to failed
              await this.updateJobProgress(payload.jobId, {
                status: 'failed',
                message: error instanceof Error ? error.message : 'Unknown error',
                updatedAt: new Date().toISOString(),
              });

              // NAK the message (will be redelivered based on backoff)
              msg.nak();
            }
          }
        } catch (error) {
          if (running) {
            console.error('[JobQueue] Consumer error:', error);
            // Wait before retrying
            await new Promise((resolve) => setTimeout(resolve, 5000));
          }
        }
      }
    };

    processMessages().catch((err) => {
      console.error('[JobQueue] Fatal processing error:', err);
    });

    // Return stop function
    return () => {
      running = false;
      console.log('[JobQueue] Stopping job processor');
    };
  }

  /**
   * Get job progress from KV store
   */
  async getJobProgress(jobId: string): Promise<JobProgress | null> {
    if (!this.progressKV) {
      throw new Error('Job queue not initialized');
    }
    return await kvGet<JobProgress>(this.progressKV, `job.${jobId}`);
  }

  /**
   * Update job progress in KV store
   */
  async updateJobProgress(jobId: string, progress: Partial<JobProgress>): Promise<void> {
    if (!this.progressKV) {
      throw new Error('Job queue not initialized');
    }

    const current = await this.getJobProgress(jobId);
    const updated: JobProgress = {
      status: progress.status ?? current?.status ?? 'pending',
      progress: progress.progress ?? current?.progress ?? 0,
      currentEpoch: progress.currentEpoch ?? current?.currentEpoch,
      totalEpochs: progress.totalEpochs ?? current?.totalEpochs,
      metrics: progress.metrics ?? current?.metrics,
      eta: progress.eta ?? current?.eta,
      message: progress.message ?? current?.message,
      updatedAt: progress.updatedAt ?? new Date().toISOString(),
    };

    await kvPut(this.progressKV, `job.${jobId}`, updated);
  }

  /**
   * Watch job progress for real-time updates
   */
  async watchJobProgress(
    jobId: string,
    callback: (progress: JobProgress | null) => void
  ): Promise<() => void> {
    if (!this.progressKV) {
      throw new Error('Job queue not initialized');
    }
    return await kvWatch<JobProgress>(this.progressKV, `job.${jobId}`, callback);
  }

  /**
   * Cancel a job
   */
  async cancelJob(jobId: string): Promise<boolean> {
    // Mark as cancelled in memory (for running jobs to check)
    this.cancelledJobs.add(jobId);

    // Update progress to cancelled
    await this.updateJobProgress(jobId, {
      status: 'cancelled',
      message: 'Job cancelled by user',
      updatedAt: new Date().toISOString(),
    });

    console.log(`[JobQueue] Job cancelled: ${jobId}`);
    return true;
  }

  /**
   * Clear cancelled job from memory
   */
  clearCancelledJob(jobId: string): void {
    this.cancelledJobs.delete(jobId);
  }

  /**
   * Delete job progress from KV store
   */
  async deleteJobProgress(jobId: string): Promise<void> {
    if (!this.progressKV) {
      throw new Error('Job queue not initialized');
    }
    await kvDelete(this.progressKV, `job.${jobId}`);
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(): Promise<QueueStats> {
    const streamInfo = await this.jsm.streams.info(STREAM_NAMES.TRAINING_JOBS);
    const consumerInfo = await this.jsm.consumers.info(
      STREAM_NAMES.TRAINING_JOBS,
      CONSUMER_NAMES.TRAINING_WORKERS
    );

    // Count jobs by status from KV store
    let pending = 0;
    let running = 0;
    let completed = 0;
    let failed = 0;

    if (this.progressKV) {
      const keys = await this.progressKV.keys('job.>');
      for await (const key of keys) {
        const progress = await kvGet<JobProgress>(this.progressKV, key);
        if (progress) {
          switch (progress.status) {
            case 'pending':
            case 'queued':
              pending++;
              break;
            case 'running':
              running++;
              break;
            case 'completed':
              completed++;
              break;
            case 'failed':
            case 'cancelled':
              failed++;
              break;
          }
        }
      }
    }

    return {
      pending,
      running,
      completed,
      failed,
      streamInfo: {
        messages: Number(streamInfo.state.messages),
        bytes: Number(streamInfo.state.bytes),
        firstSeq: Number(streamInfo.state.first_seq),
        lastSeq: Number(streamInfo.state.last_seq),
        consumerCount: streamInfo.state.consumer_count,
      },
    };
  }
}

// ============================================================================
// SINGLETON EXPORT
// ============================================================================

let jobQueueInstance: JetStreamJobQueue | null = null;

export function getJobQueue(): JetStreamJobQueue {
  if (!jobQueueInstance) {
    jobQueueInstance = new JetStreamJobQueue();
  }
  return jobQueueInstance;
}

export async function initializeJobQueue(): Promise<JetStreamJobQueue> {
  const queue = getJobQueue();
  await queue.initialize();
  return queue;
}
