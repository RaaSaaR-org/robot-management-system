/**
 * @file training-orchestrator-complete.test.ts
 * @description Unit tests for TrainingOrchestrator.completeJob branches —
 *   supervised (creates ModelVersion) vs the TASK-179 auxiliary kinds
 *   reward_model (upserts EpisodeReward rows) and annotate (stores
 *   annotations on the dataset). Repositories, messaging, and the job
 *   service (the I/O boundaries) are mocked; the orchestrator runs for real.
 * @feature vla
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockTrainingJobRepository,
  mockModelVersionRepository,
  mockDatasetRepository,
  mockEpisodeRewardRepository,
  mockTrainingJobService,
} = vi.hoisted(() => ({
  mockTrainingJobRepository: {
    findById: vi.fn(),
    findAll: vi.fn(),
    update: vi.fn(),
  },
  mockModelVersionRepository: {
    create: vi.fn(),
  },
  mockDatasetRepository: {
    findById: vi.fn(),
    update: vi.fn(),
  },
  mockEpisodeRewardRepository: {
    upsertMany: vi.fn(),
  },
  mockTrainingJobService: {
    updateJobStatus: vi.fn(),
    emitProgressEvent: vi.fn(),
  },
}));

vi.mock('../repositories/index.js', () => ({
  trainingJobRepository: mockTrainingJobRepository,
  modelVersionRepository: mockModelVersionRepository,
  datasetRepository: mockDatasetRepository,
  episodeRewardRepository: mockEpisodeRewardRepository,
}));

vi.mock('../messaging/index.js', () => ({
  getJobQueue: vi.fn(() => {
    throw new Error('NATS not available in tests');
  }),
  natsClient: { isConnected: vi.fn().mockReturnValue(false) },
}));

vi.mock('../services/TrainingJobService.js', () => ({
  trainingJobService: mockTrainingJobService,
}));

import { trainingOrchestrator } from '../services/TrainingOrchestrator.js';

const REWARDS = [
  { episodeIndex: 0, score: 0.9, success: true, curve: [0.1, 0.5, 0.9], fps: 30 },
  { episodeIndex: 1, score: 0.2, success: false, curve: [0.05, 0.2], fps: null },
];

const ANNOTATIONS = [
  {
    episodeIndex: 0,
    subtasks: [{ startS: 0, endS: 2.5, text: 'reach for the cube' }],
    vqa: [{ question: 'What object is grasped?', answer: 'a red cube' }],
  },
];

describe('TrainingOrchestrator.completeJob (TASK-179 job kinds)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTrainingJobService.updateJobStatus.mockImplementation(
      async (jobId: string, status: string, updates: Record<string, unknown>) => ({
        id: jobId,
        status,
        ...updates,
      })
    );
  });

  // --------------------------------------------------------------------------
  // reward_model
  // --------------------------------------------------------------------------

  it('reward_model: upserts EpisodeReward rows and creates NO ModelVersion', async () => {
    mockTrainingJobRepository.findById.mockResolvedValue({
      id: 'job-rm-1',
      kind: 'reward_model',
      datasetId: 'ds-1',
      baseModel: 'robometer',
      metrics: {},
    });
    mockEpisodeRewardRepository.upsertMany.mockResolvedValue([]);

    const result = await trainingOrchestrator.completeJob({
      jobId: 'job-rm-1',
      artifactUri: 's3://artifacts/rewards.json',
      finalMetrics: { kind: 'reward_model', rewardType: 'robometer', rewards: REWARDS },
    });

    expect(mockEpisodeRewardRepository.upsertMany).toHaveBeenCalledWith([
      {
        datasetId: 'ds-1',
        episodeIndex: 0,
        rewardType: 'robometer',
        score: 0.9,
        success: true,
        curve: [0.1, 0.5, 0.9],
        fps: 30,
        jobId: 'job-rm-1',
      },
      {
        datasetId: 'ds-1',
        episodeIndex: 1,
        rewardType: 'robometer',
        score: 0.2,
        success: false,
        curve: [0.05, 0.2],
        fps: null,
        jobId: 'job-rm-1',
      },
    ]);
    expect(mockModelVersionRepository.create).not.toHaveBeenCalled();
    expect(mockTrainingJobService.updateJobStatus).toHaveBeenCalledWith(
      'job-rm-1',
      'completed',
      expect.objectContaining({ progress: 100 })
    );
    expect(result.modelVersionId).toBeNull();
    expect(result.job?.status).toBe('completed');
  });

  it('reward_model: falls back to the job baseModel when rewardType is absent', async () => {
    mockTrainingJobRepository.findById.mockResolvedValue({
      id: 'job-rm-2',
      kind: 'reward_model',
      datasetId: 'ds-1',
      baseModel: 'topreward',
      metrics: {},
    });
    mockEpisodeRewardRepository.upsertMany.mockResolvedValue([]);

    await trainingOrchestrator.completeJob({
      jobId: 'job-rm-2',
      artifactUri: 's3://artifacts/rewards.json',
      finalMetrics: { rewards: [REWARDS[0]] },
    });

    expect(mockEpisodeRewardRepository.upsertMany).toHaveBeenCalledWith([
      expect.objectContaining({ rewardType: 'topreward' }),
    ]);
  });

  // --------------------------------------------------------------------------
  // annotate
  // --------------------------------------------------------------------------

  it('annotate: stores annotations on the dataset and creates NO ModelVersion', async () => {
    mockTrainingJobRepository.findById.mockResolvedValue({
      id: 'job-an-1',
      kind: 'annotate',
      datasetId: 'ds-1',
      baseModel: 'lerobot-annotate',
      metrics: {},
    });
    mockDatasetRepository.update.mockResolvedValue({ id: 'ds-1' });

    const result = await trainingOrchestrator.completeJob({
      jobId: 'job-an-1',
      artifactUri: 's3://artifacts/annotations.json',
      finalMetrics: { kind: 'annotate', annotations: ANNOTATIONS },
    });

    expect(mockDatasetRepository.update).toHaveBeenCalledWith('ds-1', {
      annotations: ANNOTATIONS,
    });
    expect(mockModelVersionRepository.create).not.toHaveBeenCalled();
    expect(mockEpisodeRewardRepository.upsertMany).not.toHaveBeenCalled();
    expect(result.modelVersionId).toBeNull();
    expect(result.job?.status).toBe('completed');
  });

  it('annotate: tolerates a missing annotations array (stores [])', async () => {
    mockTrainingJobRepository.findById.mockResolvedValue({
      id: 'job-an-2',
      kind: 'annotate',
      datasetId: 'ds-1',
      baseModel: 'lerobot-annotate',
      metrics: {},
    });
    mockDatasetRepository.update.mockResolvedValue({ id: 'ds-1' });

    await trainingOrchestrator.completeJob({
      jobId: 'job-an-2',
      artifactUri: 's3://artifacts/annotations.json',
      finalMetrics: {},
    });

    expect(mockDatasetRepository.update).toHaveBeenCalledWith('ds-1', { annotations: [] });
  });

  // --------------------------------------------------------------------------
  // supervised (regression)
  // --------------------------------------------------------------------------

  it('supervised: still creates a ModelVersion', async () => {
    mockTrainingJobRepository.findById.mockResolvedValue({
      id: 'job-sup-1',
      kind: 'supervised',
      datasetId: 'ds-1',
      baseModel: 'smolvla',
      metrics: {},
    });
    mockDatasetRepository.findById.mockResolvedValue({ id: 'ds-1', skillId: 'skill-1' });
    mockModelVersionRepository.create.mockResolvedValue({ id: 'mv-1' });

    const result = await trainingOrchestrator.completeJob({
      jobId: 'job-sup-1',
      artifactUri: 's3://artifacts/model',
      finalMetrics: { finalLoss: 0.12, trainingTimeSeconds: 42, bestEpoch: 3 },
    });

    expect(mockModelVersionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        trainingJobId: 'job-sup-1',
        modelType: 'vla',
        artifactUri: 's3://artifacts/model',
      })
    );
    expect(mockEpisodeRewardRepository.upsertMany).not.toHaveBeenCalled();
    expect(mockDatasetRepository.update).not.toHaveBeenCalled();
    expect(result.modelVersionId).toBe('mv-1');
  });

  it('returns nulls when the job does not exist', async () => {
    mockTrainingJobRepository.findById.mockResolvedValue(null);

    const result = await trainingOrchestrator.completeJob({
      jobId: 'missing',
      artifactUri: 's3://x',
      finalMetrics: {},
    });

    expect(result).toEqual({ job: null, modelVersionId: null });
  });
});
