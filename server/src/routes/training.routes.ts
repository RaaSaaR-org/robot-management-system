/**
 * @file training.routes.ts
 * @description REST API endpoints for training job management
 * @feature vla
 */

import { Router, Request, Response } from 'express';
import {
  trainingJobService,
  type SubmitTrainingJobWithMixture,
} from '../services/TrainingJobService.js';
import { trainingRunExportService } from '../services/TrainingRunExportService.js';
import {
  MixtureIncompatibleError,
  UnknownDatasetError,
} from '../services/lerobot/datasetCompatibility.js';
import type {
  SubmitSimRlJobRequest,
  ListTrainingJobsQuery,
} from '../types/training.types.js';
import type { TrainingJob, TrainingJobStatus, BaseModel, FineTuneMethod } from '../types/vla.types.js';

export const trainingRoutes = Router();

// ============================================================================
// POST /api/training/jobs - Submit new training job
// ============================================================================

trainingRoutes.post('/jobs', async (req: Request, res: Response) => {
  try {
    // sim_rl jobs (TASK-172.C) carry a sceneId instead of dataset/baseModel.
    if ((req.body as { kind?: string }).kind === 'sim_rl') {
      const simRequest = req.body as SubmitSimRlJobRequest;
      if (!simRequest.sceneId) {
        return res.status(400).json({ error: 'sceneId is required for a sim_rl job' });
      }
      if (simRequest.hyperparameters) {
        try {
          const { trainingOrchestrator } = await import('../services/TrainingOrchestrator.js');
          // sim_rl has no fineTuneMethod — validate as a generic ('full') set.
          simRequest.hyperparameters = trainingOrchestrator.validateHyperparameters(
            simRequest.hyperparameters,
            'full'
          );
        } catch (validationError) {
          const message =
            validationError instanceof Error ? validationError.message : 'Invalid hyperparameters';
          return res.status(400).json({ error: message });
        }
      }
      const simJob = await trainingJobService.submitSimRlJob(simRequest);
      return res.status(201).json({
        job: simJob,
        message: 'Sim-RL training job submitted successfully',
      });
    }

    const request = req.body as SubmitTrainingJobWithMixture;

    // Validate required fields. A mixture names its datasets in `mixture` /
    // `datasetIds` instead; every other caller still has to send `datasetId`
    // and still gets the same message when it forgets.
    const hasMixture = Boolean(request.mixture?.length || request.datasetIds?.length);
    if (!hasMixture && !request.datasetId) {
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
    const datasets = await trainingJobService.getJobDatasets(job.id, job.datasetId);

    res.status(201).json({
      job: { ...job, datasets },
      datasets,
      message: 'Training job submitted successfully',
    });
  } catch (error) {
    // A refused mixture is not a malformed request — the caller gets the whole
    // report so the UI can show WHICH axis blocked instead of one sentence.
    if (error instanceof MixtureIncompatibleError) {
      return res.status(400).json({
        error: `This mixture cannot be trained: ${error.report.headline}`,
        compatibility: error.report,
      });
    }
    if (error instanceof UnknownDatasetError) {
      return res.status(400).json({ error: error.message, datasetIds: error.datasetIds });
    }
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
    // One query for the whole page, not one per job.
    const mixtures = await trainingJobService.getJobDatasetsForJobs(result.data);

    res.json({
      jobs: result.data.map((job: TrainingJob) => ({
        ...job,
        datasets: mixtures.get(job.id) ?? [],
      })),
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
    // Mirrored onto the envelope as well as the job: the contract puts
    // `datasets` on the response, and a caller holding only `job` still needs
    // it. Same array, so the two cannot disagree.
    const datasets = await trainingJobService.getJobDatasets(id, result.job.datasetId);

    res.json({
      job: { ...result.job, datasets },
      datasets,
      progress: result.progress,
    });
  } catch (error) {
    console.error('[TrainingRoutes] Error getting job:', error);
    res.status(500).json({ error: 'Failed to get training job' });
  }
});

// ============================================================================
// GET /api/training/jobs/:id/export - Portable run manifest
// ============================================================================
// Everything a cluster that cannot reach this server needs in order to run
// this job: scheme-tagged dataset URIs, normalised mixture weights, the
// compatibility verdict, and — loudly — what about this run is not portable.
// ============================================================================

trainingRoutes.get('/jobs/:id/export', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const manifest = await trainingRunExportService.buildManifest(id);
    if (!manifest) {
      return res.status(404).json({ error: 'Training job not found' });
    }

    // The id reaches a response header, so it is reduced to characters that
    // cannot end the filename or the header early.
    const safeId = id.replace(/[^A-Za-z0-9._-]/g, '');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="neodem-run-${safeId}.json"`);
    // Indented: this document is read by people deciding whether to trust a
    // run, not only by the machine that executes it.
    res.send(JSON.stringify(manifest, null, 2));
  } catch (error) {
    console.error('[TrainingRoutes] Error exporting run:', error);
    res.status(500).json({ error: 'Failed to export training run' });
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
import { datasetRepository, simSceneRepository } from '../repositories/index.js';
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
// POST /api/training/workers/claim - Worker claims the next pending job
// ============================================================================
// A remote worker (e.g. Python GPU host) POSTs here to atomically claim
// the next waiting training job. Returns the full job with hyperparameters
// + dataset reference so the worker can start training immediately.
// Returns 204 No Content when no jobs are waiting.
// ============================================================================

trainingRoutes.post('/workers/claim', async (req: Request, res: Response) => {
  try {
    const { workerId, device, kinds, features } = req.body as {
      workerId?: string;
      device?: string;
      kinds?: string[];
      /** Opt-ins. `'mixture'` = this worker can train on `datasets[]`. */
      features?: string[];
    };
    if (!workerId) {
      return res.status(400).json({ error: 'workerId is required' });
    }
    // `kinds` lets the sim-trainer claim only sim_rl jobs and the classic
    // training-worker only supervised jobs (defaults to ['supervised']).
    // TASK-179: workers may also claim 'reward_model' / 'annotate' jobs —
    // those carry a datasetId, so they take the supervised response shape
    // ({ job (incl. kind), dataset }) below.
    const claimKinds =
      Array.isArray(kinds) && kinds.length > 0 ? kinds : ['supervised'];
    const workerFeatures = Array.isArray(features) ? features : [];
    const job = await trainingOrchestrator.claimNextPendingJob(
      workerId,
      device,
      claimKinds,
      workerFeatures
    );
    if (!job) {
      return res.status(204).send();
    }

    // sim_rl jobs carry a SimScene (the RL env) instead of a dataset. The
    // worker needs the scene + its MJCF key; the goal is baked into the MJCF.
    if (job.kind === 'sim_rl') {
      const scene = job.sceneId ? await simSceneRepository.findById(job.sceneId) : null;
      return res.json({
        job,
        dataset: null,
        scene: scene
          ? {
              id: scene.id,
              mjcfKey: scene.mjcfKey,
              twinId: scene.twinId,
              embodimentTag: scene.embodimentTag,
              backend: scene.backend,
              bounds: scene.bounds,
            }
          : null,
      });
    }

    // Supervised: return the job plus its dataset reference so the worker has
    // everything it needs in one round-trip. The `dataset.storagePath`
    // is the RustFS prefix the worker should download from — it is a
    // separate UUID from `job.datasetId` for HF-imported datasets.
    const dataset = job.datasetId ? await datasetRepository.findById(job.datasetId) : null;

    // `datasets` is every member of the mixture, with the sampling weight and
    // the same storagePath/version fields `dataset` carries. `dataset` stays
    // exactly as it was — member 0 — so a worker that has never heard of
    // mixtures is unaffected; the orchestrator has already made sure such a
    // worker is never handed a job where the difference would matter.
    const members = await trainingJobService.getJobDatasets(job.id, job.datasetId ?? null);
    const rows = await Promise.all(
      members.map(async (member) => {
        const row = member.datasetId === dataset?.id
          ? dataset
          : await datasetRepository.findById(member.datasetId);
        return row
          ? {
              id: row.id,
              storagePath: row.storagePath,
              lerobotVersion: row.lerobotVersion,
              weight: member.weight,
              position: member.position,
            }
          : null;
      })
    );

    res.json({
      job,
      dataset: dataset
        ? {
            id: dataset.id,
            storagePath: dataset.storagePath,
            lerobotVersion: dataset.lerobotVersion,
          }
        : null,
      datasets: rows.filter((row): row is NonNullable<typeof row> => row !== null),
    });
  } catch (error) {
    console.error('[TrainingRoutes] Error claiming job:', error);
    res.status(500).json({ error: 'Failed to claim job' });
  }
});

// ============================================================================
// POST /api/training/workers/heartbeat - Worker alive check
// ============================================================================

trainingRoutes.post('/workers/heartbeat', async (req: Request, res: Response) => {
  try {
    const body = req.body as WorkerHeartbeatRequest;
    const { jobId, gpuUtil, memoryUtil, workerId, device } = body;

    if (!jobId) {
      return res.status(400).json({ error: 'jobId is required' });
    }

    const status = await trainingOrchestrator.recordHeartbeat({
      jobId,
      gpuUtil,
      memoryUtil,
      workerId,
      device,
    });

    console.log(
      `[TrainingRoutes] Heartbeat: worker=${workerId ?? '?'} device=${device ?? '?'} job=${jobId} gpu=${gpuUtil}% mem=${memoryUtil}% status=${status}`
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
// GET /api/training/workers - Active training workers + queue summary
// ============================================================================

trainingRoutes.get('/workers', async (_req: Request, res: Response) => {
  try {
    const workers = await trainingOrchestrator.listWorkers();
    res.json(workers);
  } catch (error) {
    console.error('[TrainingRoutes] Error listing workers:', error);
    res.status(500).json({ error: 'Failed to list workers' });
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
    // Duration estimate is dataset-frame based; sim_rl jobs have no dataset.
    if (!job.datasetId) {
      return res
        .status(400)
        .json({ error: 'Duration estimate is not available for sim_rl jobs' });
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
