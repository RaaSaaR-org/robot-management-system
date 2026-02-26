/**
 * @file synthetic-jobs.routes.ts
 * @description REST API endpoints for NATS-based synthetic data job queue management
 * @feature Synthetic Data
 */

import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { natsClient } from '../messaging/index.js';
import { SUBJECTS } from '../messaging/streams.js';
import {
  syntheticDataWorker,
  type SyntheticJobPayload,
  type SyntheticJobRecord,
} from '../workers/SyntheticDataWorker.js';

export const syntheticJobsRoutes = Router();

// ============================================================================
// JOB QUEUE MANAGEMENT
// ============================================================================

/**
 * POST /api/synthetic-jobs
 * Enqueue a new synthetic data generation job (publish to NATS)
 */
syntheticJobsRoutes.post('/', async (req: Request, res: Response) => {
  try {
    const { datasetId, config } = req.body;

    // Validate required fields
    if (!datasetId) {
      return res.status(400).json({ error: 'datasetId is required' });
    }

    if (!config || typeof config !== 'object') {
      return res.status(400).json({ error: 'config is required and must be an object' });
    }

    if (!config.count || typeof config.count !== 'number' || config.count < 1) {
      return res.status(400).json({ error: 'config.count must be a positive integer' });
    }

    if (!Array.isArray(config.modalities) || config.modalities.length === 0) {
      return res.status(400).json({ error: 'config.modalities must be a non-empty array' });
    }

    if (!Array.isArray(config.augmentations)) {
      return res.status(400).json({ error: 'config.augmentations must be an array' });
    }

    // Check NATS availability
    if (!natsClient.isConnected()) {
      return res.status(503).json({ error: 'NATS is not connected, job queue unavailable' });
    }

    const jobId = uuidv4();
    const payload: SyntheticJobPayload = {
      jobId,
      datasetId,
      config: {
        count: config.count,
        modalities: config.modalities,
        augmentations: config.augmentations,
      },
    };

    // Store job in in-memory store
    const jobRecord: SyntheticJobRecord = {
      jobId,
      datasetId,
      config: payload.config,
      status: 'queued',
      retries: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    syntheticDataWorker.getJobStore().set(jobId, jobRecord);

    // Publish to NATS JetStream
    const pubAck = await natsClient.jetPublish(SUBJECTS.SYNTHETIC_GENERATE, payload, {
      msgID: jobId,
    });

    console.log(`[SyntheticJobsRoutes] Job ${jobId} enqueued (seq: ${pubAck.seq})`);

    res.status(201).json({
      jobId,
      datasetId,
      config: payload.config,
      status: 'queued',
      seq: pubAck.seq,
    });
  } catch (error) {
    console.error('[SyntheticJobsRoutes] Error enqueuing job:', error);
    res.status(500).json({ error: 'Failed to enqueue synthetic data job' });
  }
});

/**
 * GET /api/synthetic-jobs
 * List all synthetic data generation jobs
 */
syntheticJobsRoutes.get('/', (_req: Request, res: Response) => {
  try {
    const store = syntheticDataWorker.getJobStore();
    const jobs = Array.from(store.values()).sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    );

    res.json({
      jobs,
      total: jobs.length,
    });
  } catch (error) {
    console.error('[SyntheticJobsRoutes] Error listing jobs:', error);
    res.status(500).json({ error: 'Failed to list jobs' });
  }
});

/**
 * GET /api/synthetic-jobs/worker/stats
 * Get worker statistics (processed, failed, inFlight)
 * Note: Must be defined before /:id to avoid matching "worker" as an ID
 */
syntheticJobsRoutes.get('/worker/stats', (_req: Request, res: Response) => {
  try {
    const stats = syntheticDataWorker.getStats();
    res.json(stats);
  } catch (error) {
    console.error('[SyntheticJobsRoutes] Error getting worker stats:', error);
    res.status(500).json({ error: 'Failed to get worker stats' });
  }
});

/**
 * GET /api/synthetic-jobs/:id
 * Get a single synthetic data job
 */
syntheticJobsRoutes.get('/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const store = syntheticDataWorker.getJobStore();
    const job = store.get(id);

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    res.json(job);
  } catch (error) {
    console.error('[SyntheticJobsRoutes] Error getting job:', error);
    res.status(500).json({ error: 'Failed to get job' });
  }
});
