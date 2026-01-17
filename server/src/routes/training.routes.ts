/**
 * @file training.routes.ts
 * @description REST API endpoints for training job management
 * @feature vla
 */

import { Router, Request, Response } from 'express';
import { trainingJobService } from '../services/TrainingJobService.js';
import type {
  SubmitTrainingJobRequest,
  ListTrainingJobsQuery,
} from '../types/training.types.js';
import type { TrainingJobStatus, BaseModel, FineTuneMethod } from '../types/vla.types.js';

export const trainingRoutes = Router();

// ============================================================================
// POST /api/training/jobs - Submit new training job
// ============================================================================

trainingRoutes.post('/jobs', async (req: Request, res: Response) => {
  try {
    const request = req.body as SubmitTrainingJobRequest;

    // Validate required fields
    if (!request.datasetId) {
      return res.status(400).json({ error: 'datasetId is required' });
    }
    if (!request.baseModel) {
      return res.status(400).json({ error: 'baseModel is required' });
    }
    if (!request.fineTuneMethod) {
      return res.status(400).json({ error: 'fineTuneMethod is required' });
    }

    // Validate hyperparameters with Zod schema
    if (request.hyperparameters) {
      try {
        const { trainingOrchestrator } = await import('../services/TrainingOrchestrator.js');
        const validatedHyperparameters = trainingOrchestrator.validateHyperparameters(
          request.hyperparameters,
          request.fineTuneMethod
        );
        request.hyperparameters = validatedHyperparameters;
      } catch (validationError) {
        const message = validationError instanceof Error ? validationError.message : 'Invalid hyperparameters';
        return res.status(400).json({ error: message });
      }
    }

    const job = await trainingJobService.submitJob(request);

    res.status(201).json({
      job,
      message: 'Training job submitted successfully',
    });
  } catch (error) {
    console.error('[TrainingRoutes] Error submitting job:', error);
    const message = error instanceof Error ? error.message : 'Failed to submit training job';
    res.status(400).json({ error: message });
  }
});

// ============================================================================
// GET /api/training/jobs - List jobs with filtering
// ============================================================================

trainingRoutes.get('/jobs', async (req: Request, res: Response) => {
  try {
    const query = req.query as Record<string, string | undefined>;

    // Parse query parameters
    const params: ListTrainingJobsQuery = {
      datasetId: query.datasetId,
      page: query.page ? parseInt(query.page, 10) : undefined,
      pageSize: query.pageSize ? parseInt(query.pageSize, 10) : undefined,
    };

    // Parse array parameters
    if (query.baseModel) {
      params.baseModel = query.baseModel.includes(',')
        ? (query.baseModel.split(',') as BaseModel[])
        : (query.baseModel as BaseModel);
    }

    if (query.fineTuneMethod) {
      params.fineTuneMethod = query.fineTuneMethod.includes(',')
        ? (query.fineTuneMethod.split(',') as FineTuneMethod[])
        : (query.fineTuneMethod as FineTuneMethod);
    }

    if (query.status) {
      params.status = query.status.includes(',')
        ? (query.status.split(',') as TrainingJobStatus[])
        : (query.status as TrainingJobStatus);
    }

    const result = await trainingJobService.getJobs(params);

    res.json({
      jobs: result.data,
      pagination: result.pagination,
    });
  } catch (error) {
    console.error('[TrainingRoutes] Error listing jobs:', error);
    res.status(500).json({ error: 'Failed to list training jobs' });
  }
});

// ============================================================================
// GET /api/training/jobs/:id - Get job details with progress
// ============================================================================

trainingRoutes.get('/jobs/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await trainingJobService.getJobWithProgress(id);
    if (!result) {
      return res.status(404).json({ error: 'Training job not found' });
    }

    res.json({
      job: result.job,
      progress: result.progress,
    });
  } catch (error) {
    console.error('[TrainingRoutes] Error getting job:', error);
    res.status(500).json({ error: 'Failed to get training job' });
  }
});

// ============================================================================
// POST /api/training/jobs/:id/cancel - Cancel job
// ============================================================================

trainingRoutes.post('/jobs/:id/cancel', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const job = await trainingJobService.cancelJob(id);
    if (!job) {
      return res.status(404).json({ error: 'Training job not found' });
    }

    res.json({
      job,
      message: 'Training job cancelled successfully',
    });
  } catch (error) {
    console.error('[TrainingRoutes] Error cancelling job:', error);
    const message = error instanceof Error ? error.message : 'Failed to cancel training job';
    res.status(400).json({ error: message });
  }
});

// ============================================================================
// POST /api/training/jobs/:id/retry - Retry failed job
// ============================================================================

trainingRoutes.post('/jobs/:id/retry', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const job = await trainingJobService.retryJob(id);
    if (!job) {
      return res.status(404).json({ error: 'Training job not found' });
    }

    res.json({
      job,
      message: 'Training job retried successfully',
    });
  } catch (error) {
    console.error('[TrainingRoutes] Error retrying job:', error);
    const message = error instanceof Error ? error.message : 'Failed to retry training job';
    res.status(400).json({ error: message });
  }
});

// ============================================================================
// GET /api/training/queue/stats - Queue statistics
// ============================================================================

trainingRoutes.get('/queue/stats', async (req: Request, res: Response) => {
  try {
    const stats = await trainingJobService.getQueueStats();

    if (!stats) {
      return res.status(503).json({
        error: 'Queue not available',
        message: 'NATS connection not established',
      });
    }

    res.json(stats);
  } catch (error) {
    console.error('[TrainingRoutes] Error getting queue stats:', error);
    res.status(500).json({ error: 'Failed to get queue statistics' });
  }
});

// ============================================================================
// GET /api/training/jobs/active - Get active jobs
// ============================================================================

trainingRoutes.get('/active', async (req: Request, res: Response) => {
  try {
    const jobs = await trainingJobService.getActiveJobs();

    res.json({
      jobs,
      count: jobs.length,
    });
  } catch (error) {
    console.error('[TrainingRoutes] Error getting active jobs:', error);
    res.status(500).json({ error: 'Failed to get active jobs' });
  }
});

// ============================================================================
// WORKER CALLBACK ENDPOINTS
// ============================================================================

import { trainingOrchestrator } from '../services/TrainingOrchestrator.js';
import type {
  WorkerHeartbeatRequest,
  WorkerHeartbeatResponse,
  WorkerProgressRequest,
  WorkerProgressResponse,
  WorkerCompleteRequest,
  WorkerCompleteResponse,
  WorkerFailedRequest,
  WorkerFailedResponse,
  WorkerCheckpointRequest,
  WorkerCheckpointResponse,
} from '../types/training.types.js';

// ============================================================================
// POST /api/training/workers/heartbeat - Worker alive check
// ============================================================================

trainingRoutes.post('/workers/heartbeat', async (req: Request, res: Response) => {
  try {
    const { jobId, gpuUtil, memoryUtil } = req.body as WorkerHeartbeatRequest;

    if (!jobId) {
      return res.status(400).json({ error: 'jobId is required' });
    }

    const status = await trainingOrchestrator.checkHeartbeat(jobId);

    console.log(
      `[TrainingRoutes] Heartbeat: job=${jobId}, gpu=${gpuUtil}%, mem=${memoryUtil}%, status=${status}`
    );

    const response: WorkerHeartbeatResponse = {
      status,
      message: status === 'stop' ? 'Job has been cancelled' : undefined,
    };

    res.json(response);
  } catch (error) {
    console.error('[TrainingRoutes] Error processing heartbeat:', error);
    res.status(500).json({ error: 'Failed to process heartbeat' });
  }
});

// ============================================================================
// POST /api/training/workers/progress - Progress update
// ============================================================================

trainingRoutes.post('/workers/progress', async (req: Request, res: Response) => {
  try {
    const request = req.body as WorkerProgressRequest;

    if (!request.jobId) {
      return res.status(400).json({ error: 'jobId is required' });
    }

    const result = await trainingOrchestrator.updateProgress(request);

    const response: WorkerProgressResponse = {
      status: result.cancel ? 'cancel' : 'ok',
      eta: result.eta || undefined,
    };

    res.json(response);
  } catch (error) {
    console.error('[TrainingRoutes] Error processing progress:', error);
    res.status(500).json({ error: 'Failed to process progress update' });
  }
});

// ============================================================================
// POST /api/training/workers/complete - Training complete
// ============================================================================

trainingRoutes.post('/workers/complete', async (req: Request, res: Response) => {
  try {
    const request = req.body as WorkerCompleteRequest;

    if (!request.jobId) {
      return res.status(400).json({ error: 'jobId is required' });
    }
    if (!request.artifactUri) {
      return res.status(400).json({ error: 'artifactUri is required' });
    }
    if (!request.finalMetrics) {
      return res.status(400).json({ error: 'finalMetrics is required' });
    }

    const result = await trainingOrchestrator.completeJob(request);

    const response: WorkerCompleteResponse = {
      status: 'ok',
      modelVersionId: result.modelVersionId || undefined,
    };

    res.json(response);
  } catch (error) {
    console.error('[TrainingRoutes] Error processing completion:', error);
    res.status(500).json({ error: 'Failed to process completion' });
  }
});

// ============================================================================
// POST /api/training/workers/failed - Training failed
// ============================================================================

trainingRoutes.post('/workers/failed', async (req: Request, res: Response) => {
  try {
    const request = req.body as WorkerFailedRequest;

    if (!request.jobId) {
      return res.status(400).json({ error: 'jobId is required' });
    }
    if (!request.error) {
      return res.status(400).json({ error: 'error message is required' });
    }

    await trainingOrchestrator.failJob(request);

    const response: WorkerFailedResponse = {
      status: 'ok',
    };

    res.json(response);
  } catch (error) {
    console.error('[TrainingRoutes] Error processing failure:', error);
    res.status(500).json({ error: 'Failed to process failure' });
  }
});

// ============================================================================
// POST /api/training/workers/checkpoint - Checkpoint saved
// ============================================================================

trainingRoutes.post('/workers/checkpoint', async (req: Request, res: Response) => {
  try {
    const request = req.body as WorkerCheckpointRequest;

    if (!request.jobId) {
      return res.status(400).json({ error: 'jobId is required' });
    }
    if (request.epoch === undefined) {
      return res.status(400).json({ error: 'epoch is required' });
    }
    if (!request.checkpointUri) {
      return res.status(400).json({ error: 'checkpointUri is required' });
    }

    await trainingOrchestrator.recordCheckpoint(request);

    const response: WorkerCheckpointResponse = {
      status: 'ok',
    };

    res.json(response);
  } catch (error) {
    console.error('[TrainingRoutes] Error processing checkpoint:', error);
    res.status(500).json({ error: 'Failed to process checkpoint' });
  }
});

// ============================================================================
// GET /api/training/gpu/availability - GPU availability (stubbed)
// ============================================================================

trainingRoutes.get('/gpu/availability', async (req: Request, res: Response) => {
  try {
    const availability = await trainingOrchestrator.getGpuAvailability();
    res.json(availability);
  } catch (error) {
    console.error('[TrainingRoutes] Error getting GPU availability:', error);
    res.status(500).json({ error: 'Failed to get GPU availability' });
  }
});

// ============================================================================
// GET /api/training/jobs/:id/estimate - Training duration estimate
// ============================================================================

trainingRoutes.get('/jobs/:id/estimate', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const job = await trainingJobService.getJob(id);
    if (!job) {
      return res.status(404).json({ error: 'Training job not found' });
    }

    const estimate = await trainingOrchestrator.estimateTrainingDuration(
      job.datasetId,
      job.hyperparameters
    );

    res.json(estimate);
  } catch (error) {
    console.error('[TrainingRoutes] Error estimating duration:', error);
    const message = error instanceof Error ? error.message : 'Failed to estimate duration';
    res.status(400).json({ error: message });
  }
});
