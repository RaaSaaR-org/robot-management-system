/**
 * @file SyntheticDataWorker.test.ts
 * @description Unit tests for SyntheticDataWorker and synthetic-jobs routes
 * @feature Synthetic Data
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ============================================================================
// MOCKS
// ============================================================================

// Mock NATS client
const mockConsume = vi.fn();
const mockStop = vi.fn();
const mockConsumer = {
  consume: vi.fn().mockResolvedValue({
    stop: mockStop,
    [Symbol.asyncIterator]: () => ({
      next: vi.fn().mockResolvedValue({ done: true }),
    }),
  }),
};

const mockNatsClient = {
  isConnected: vi.fn().mockReturnValue(false),
  getJetStream: vi.fn().mockReturnValue({
    consumers: {
      get: vi.fn().mockResolvedValue(mockConsumer),
    },
  }),
  getJetStreamManager: vi.fn().mockReturnValue({
    streams: {
      info: vi.fn().mockResolvedValue({}),
    },
  }),
  jetPublish: vi.fn().mockResolvedValue({ seq: 1, duplicate: false }),
};

vi.mock('../messaging/index.js', () => ({
  natsClient: mockNatsClient,
  SUBJECTS: {
    SYNTHETIC_GENERATE: 'synthetic.jobs.generate',
  },
}));

vi.mock('../messaging/streams.js', () => ({
  STREAM_NAMES: {
    SYNTHETIC_DATA: 'SYNTHETIC_DATA',
  },
  CONSUMER_NAMES: {
    SYNTHETIC_WORKERS: 'synthetic-workers',
  },
  SUBJECTS: {
    SYNTHETIC_GENERATE: 'synthetic.jobs.generate',
  },
}));

vi.mock('uuid', () => ({
  v4: vi.fn().mockReturnValue('test-uuid-1234'),
}));

// Import after mocking
const {
  syntheticDataWorker,
  startSyntheticDataWorker,
  stopSyntheticDataWorker,
  getStats,
  resetStats,
  resetJobStore,
  getJobStore,
} = await import('../workers/SyntheticDataWorker.js');

const { syntheticJobsRoutes } = await import('../routes/synthetic-jobs.routes.js');

// ============================================================================
// TEST APP SETUP
// ============================================================================

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/synthetic-jobs', syntheticJobsRoutes);
  return app;
}

// ============================================================================
// WORKER TESTS
// ============================================================================

describe('SyntheticDataWorker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStats();
    resetJobStore();
    mockNatsClient.isConnected.mockReturnValue(false);
  });

  afterEach(async () => {
    await stopSyntheticDataWorker();
  });

  // --------------------------------------------------------------------------
  // Worker Lifecycle
  // --------------------------------------------------------------------------

  describe('Worker Lifecycle', () => {
    it('should not start when NATS is not connected', async () => {
      mockNatsClient.isConnected.mockReturnValue(false);

      await startSyntheticDataWorker();

      expect(syntheticDataWorker.isRunning()).toBe(false);
    });

    it('should not start when JetStream is not available', async () => {
      mockNatsClient.isConnected.mockReturnValue(true);
      mockNatsClient.getJetStream.mockReturnValue(null);

      await startSyntheticDataWorker();

      expect(syntheticDataWorker.isRunning()).toBe(false);
    });

    it('should not start when JetStreamManager is not available', async () => {
      mockNatsClient.isConnected.mockReturnValue(true);
      mockNatsClient.getJetStream.mockReturnValue({});
      mockNatsClient.getJetStreamManager.mockReturnValue(null);

      await startSyntheticDataWorker();

      expect(syntheticDataWorker.isRunning()).toBe(false);
    });

    it('should not start when stream does not exist', async () => {
      mockNatsClient.isConnected.mockReturnValue(true);
      mockNatsClient.getJetStream.mockReturnValue({
        consumers: { get: vi.fn() },
      });
      mockNatsClient.getJetStreamManager.mockReturnValue({
        streams: {
          info: vi.fn().mockRejectedValue(new Error('stream not found')),
        },
      });

      await startSyntheticDataWorker();

      expect(syntheticDataWorker.isRunning()).toBe(false);
    });

    it('should start when NATS, JetStream, and stream are available', async () => {
      mockNatsClient.isConnected.mockReturnValue(true);
      mockNatsClient.getJetStream.mockReturnValue({
        consumers: {
          get: vi.fn().mockResolvedValue(mockConsumer),
        },
      });
      mockNatsClient.getJetStreamManager.mockReturnValue({
        streams: {
          info: vi.fn().mockResolvedValue({}),
        },
      });

      await startSyntheticDataWorker();

      expect(syntheticDataWorker.isRunning()).toBe(true);
    });

    it('should not start twice', async () => {
      mockNatsClient.isConnected.mockReturnValue(true);
      mockNatsClient.getJetStream.mockReturnValue({
        consumers: {
          get: vi.fn().mockResolvedValue(mockConsumer),
        },
      });
      mockNatsClient.getJetStreamManager.mockReturnValue({
        streams: {
          info: vi.fn().mockResolvedValue({}),
        },
      });

      await startSyntheticDataWorker();
      expect(syntheticDataWorker.isRunning()).toBe(true);

      // Second start should be a no-op
      await startSyntheticDataWorker();
      expect(syntheticDataWorker.isRunning()).toBe(true);
    });

    it('should stop gracefully', async () => {
      mockNatsClient.isConnected.mockReturnValue(true);
      mockNatsClient.getJetStream.mockReturnValue({
        consumers: {
          get: vi.fn().mockResolvedValue(mockConsumer),
        },
      });
      mockNatsClient.getJetStreamManager.mockReturnValue({
        streams: {
          info: vi.fn().mockResolvedValue({}),
        },
      });

      await startSyntheticDataWorker();
      expect(syntheticDataWorker.isRunning()).toBe(true);

      await stopSyntheticDataWorker();
      expect(syntheticDataWorker.isRunning()).toBe(false);
    });

    it('should be safe to stop when not running', async () => {
      expect(syntheticDataWorker.isRunning()).toBe(false);
      await stopSyntheticDataWorker(); // Should not throw
      expect(syntheticDataWorker.isRunning()).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // Stats
  // --------------------------------------------------------------------------

  describe('Stats', () => {
    it('should return initial stats as zeros', () => {
      const stats = getStats();

      expect(stats).toEqual({
        processed: 0,
        failed: 0,
        inFlight: 0,
      });
    });

    it('should reset stats correctly', () => {
      resetStats();
      const stats = getStats();

      expect(stats.processed).toBe(0);
      expect(stats.failed).toBe(0);
      expect(stats.inFlight).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // Job Store
  // --------------------------------------------------------------------------

  describe('Job Store', () => {
    it('should return empty store initially', () => {
      const store = getJobStore();
      expect(store.size).toBe(0);
    });

    it('should store and retrieve jobs', () => {
      const store = getJobStore();
      store.set('job-1', {
        jobId: 'job-1',
        datasetId: 'ds-1',
        config: { count: 10, modalities: ['rgb'], augmentations: [] },
        status: 'queued',
        retries: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      expect(store.size).toBe(1);
      expect(store.get('job-1')?.status).toBe('queued');
    });

    it('should clear store on reset', () => {
      const store = getJobStore();
      store.set('job-1', {
        jobId: 'job-1',
        datasetId: 'ds-1',
        config: { count: 10, modalities: ['rgb'], augmentations: [] },
        status: 'queued',
        retries: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      resetJobStore();
      expect(getJobStore().size).toBe(0);
    });
  });
});

// ============================================================================
// ROUTE TESTS
// ============================================================================

describe('Synthetic Jobs Routes', () => {
  const app = createTestApp();

  beforeEach(() => {
    vi.clearAllMocks();
    resetStats();
    resetJobStore();
    mockNatsClient.isConnected.mockReturnValue(true);
    mockNatsClient.jetPublish.mockResolvedValue({ seq: 1, duplicate: false });
  });

  // --------------------------------------------------------------------------
  // POST /api/synthetic-jobs
  // --------------------------------------------------------------------------

  describe('POST /api/synthetic-jobs', () => {
    const validPayload = {
      datasetId: 'ds-001',
      config: {
        count: 100,
        modalities: ['rgb', 'depth'],
        augmentations: ['flip', 'rotate'],
      },
    };

    it('should enqueue a job successfully', async () => {
      const res = await request(app)
        .post('/api/synthetic-jobs')
        .send(validPayload);

      expect(res.status).toBe(201);
      expect(res.body.jobId).toBe('test-uuid-1234');
      expect(res.body.datasetId).toBe('ds-001');
      expect(res.body.status).toBe('queued');
      expect(res.body.seq).toBe(1);
    });

    it('should store the job in the job store', async () => {
      await request(app)
        .post('/api/synthetic-jobs')
        .send(validPayload);

      const store = getJobStore();
      expect(store.size).toBe(1);
      const job = store.get('test-uuid-1234');
      expect(job?.status).toBe('queued');
      expect(job?.datasetId).toBe('ds-001');
    });

    it('should reject when datasetId is missing', async () => {
      const res = await request(app)
        .post('/api/synthetic-jobs')
        .send({ config: validPayload.config });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('datasetId');
    });

    it('should reject when config is missing', async () => {
      const res = await request(app)
        .post('/api/synthetic-jobs')
        .send({ datasetId: 'ds-001' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('config');
    });

    it('should reject when config.count is invalid', async () => {
      const res = await request(app)
        .post('/api/synthetic-jobs')
        .send({
          datasetId: 'ds-001',
          config: { count: 0, modalities: ['rgb'], augmentations: [] },
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('count');
    });

    it('should reject when config.modalities is empty', async () => {
      const res = await request(app)
        .post('/api/synthetic-jobs')
        .send({
          datasetId: 'ds-001',
          config: { count: 10, modalities: [], augmentations: [] },
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('modalities');
    });

    it('should reject when config.augmentations is not an array', async () => {
      const res = await request(app)
        .post('/api/synthetic-jobs')
        .send({
          datasetId: 'ds-001',
          config: { count: 10, modalities: ['rgb'], augmentations: 'flip' },
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('augmentations');
    });

    it('should return 503 when NATS is not connected', async () => {
      mockNatsClient.isConnected.mockReturnValue(false);

      const res = await request(app)
        .post('/api/synthetic-jobs')
        .send(validPayload);

      expect(res.status).toBe(503);
      expect(res.body.error).toContain('NATS');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/synthetic-jobs
  // --------------------------------------------------------------------------

  describe('GET /api/synthetic-jobs', () => {
    it('should return empty list when no jobs', async () => {
      const res = await request(app).get('/api/synthetic-jobs');

      expect(res.status).toBe(200);
      expect(res.body.jobs).toEqual([]);
      expect(res.body.total).toBe(0);
    });

    it('should return list of jobs sorted by creation date', async () => {
      const store = getJobStore();
      const oldDate = new Date('2025-01-01');
      const newDate = new Date('2025-06-01');

      store.set('job-old', {
        jobId: 'job-old',
        datasetId: 'ds-1',
        config: { count: 5, modalities: ['rgb'], augmentations: [] },
        status: 'completed',
        retries: 0,
        createdAt: oldDate,
        updatedAt: oldDate,
      });

      store.set('job-new', {
        jobId: 'job-new',
        datasetId: 'ds-2',
        config: { count: 10, modalities: ['depth'], augmentations: ['flip'] },
        status: 'queued',
        retries: 0,
        createdAt: newDate,
        updatedAt: newDate,
      });

      const res = await request(app).get('/api/synthetic-jobs');

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(2);
      expect(res.body.jobs[0].jobId).toBe('job-new');
      expect(res.body.jobs[1].jobId).toBe('job-old');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/synthetic-jobs/worker/stats
  // --------------------------------------------------------------------------

  describe('GET /api/synthetic-jobs/worker/stats', () => {
    it('should return worker stats', async () => {
      const res = await request(app).get('/api/synthetic-jobs/worker/stats');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        processed: 0,
        failed: 0,
        inFlight: 0,
      });
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/synthetic-jobs/:id
  // --------------------------------------------------------------------------

  describe('GET /api/synthetic-jobs/:id', () => {
    it('should return 404 for non-existent job', async () => {
      const res = await request(app).get('/api/synthetic-jobs/nonexistent');

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('not found');
    });

    it('should return a specific job by ID', async () => {
      const store = getJobStore();
      store.set('job-abc', {
        jobId: 'job-abc',
        datasetId: 'ds-1',
        config: { count: 50, modalities: ['rgb', 'depth'], augmentations: ['flip'] },
        status: 'processing',
        retries: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await request(app).get('/api/synthetic-jobs/job-abc');

      expect(res.status).toBe(200);
      expect(res.body.jobId).toBe('job-abc');
      expect(res.body.status).toBe('processing');
      expect(res.body.config.count).toBe(50);
    });
  });
});
