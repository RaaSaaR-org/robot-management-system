/**
 * @file EpisodeRewardRepository.test.ts
 * @description Unit tests for the EpisodeReward data-access repository
 *   (TASK-179). Prisma is mocked; the real db→domain mapper runs so the
 *   tests exercise JSON curve parsing and upsert payload serialization.
 * @feature evaluation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  episodeReward: {
    upsert: vi.fn(),
    findMany: vi.fn(),
  },
}));

vi.mock('../../database/index.js', () => ({
  prisma: prismaMock,
}));

import { episodeRewardRepository } from '../EpisodeRewardRepository.js';

const FIXED_DATE = new Date('2026-07-07T10:00:00.000Z');

function makeDbReward(overrides: Record<string, unknown> = {}) {
  return {
    id: 'er-1',
    tenantId: null,
    datasetId: 'ds-1',
    episodeIndex: 0,
    rewardType: 'robometer',
    score: 0.87,
    success: true,
    curve: '[0.1,0.4,0.87]',
    fps: 30,
    jobId: 'job-1',
    createdAt: FIXED_DATE,
    ...overrides,
  };
}

describe('EpisodeRewardRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('upsert keys on (datasetId, episodeIndex, rewardType) and serializes the curve', async () => {
    prismaMock.episodeReward.upsert.mockResolvedValue(makeDbReward());

    const result = await episodeRewardRepository.upsert({
      datasetId: 'ds-1',
      episodeIndex: 0,
      rewardType: 'robometer',
      score: 0.87,
      success: true,
      curve: [0.1, 0.4, 0.87],
      fps: 30,
      jobId: 'job-1',
    });

    expect(prismaMock.episodeReward.upsert).toHaveBeenCalledWith({
      where: {
        datasetId_episodeIndex_rewardType: {
          datasetId: 'ds-1',
          episodeIndex: 0,
          rewardType: 'robometer',
        },
      },
      create: expect.objectContaining({
        datasetId: 'ds-1',
        episodeIndex: 0,
        rewardType: 'robometer',
        score: 0.87,
        curve: '[0.1,0.4,0.87]',
      }),
      update: expect.objectContaining({
        score: 0.87,
        curve: '[0.1,0.4,0.87]',
        jobId: 'job-1',
      }),
    });
    // The mapper parses the stored JSON string back to number[].
    expect(result.curve).toEqual([0.1, 0.4, 0.87]);
  });

  it('upsertMany upserts every row in order', async () => {
    prismaMock.episodeReward.upsert
      .mockResolvedValueOnce(makeDbReward({ episodeIndex: 0 }))
      .mockResolvedValueOnce(makeDbReward({ id: 'er-2', episodeIndex: 1 }));

    const results = await episodeRewardRepository.upsertMany([
      { datasetId: 'ds-1', episodeIndex: 0, rewardType: 'robometer', score: 0.9 },
      { datasetId: 'ds-1', episodeIndex: 1, rewardType: 'robometer', score: 0.4 },
    ]);

    expect(prismaMock.episodeReward.upsert).toHaveBeenCalledTimes(2);
    expect(results).toHaveLength(2);
    expect(results[1].episodeIndex).toBe(1);
  });

  it('findByDataset parses curves to number[] and tolerates invalid JSON', async () => {
    prismaMock.episodeReward.findMany.mockResolvedValue([
      makeDbReward(),
      makeDbReward({ id: 'er-2', episodeIndex: 1, curve: 'not-json', success: null, fps: null }),
    ]);

    const rewards = await episodeRewardRepository.findByDataset('ds-1');

    expect(prismaMock.episodeReward.findMany).toHaveBeenCalledWith({
      where: { datasetId: 'ds-1' },
      orderBy: [{ episodeIndex: 'asc' }, { rewardType: 'asc' }],
    });
    expect(rewards[0].curve).toEqual([0.1, 0.4, 0.87]);
    expect(rewards[1].curve).toEqual([]); // invalid JSON → []
    expect(rewards[1].success).toBeNull();
  });

  it('findByDataset filters by rewardType when provided', async () => {
    prismaMock.episodeReward.findMany.mockResolvedValue([]);

    await episodeRewardRepository.findByDataset('ds-1', 'topreward');

    expect(prismaMock.episodeReward.findMany).toHaveBeenCalledWith({
      where: { datasetId: 'ds-1', rewardType: 'topreward' },
      orderBy: [{ episodeIndex: 'asc' }, { rewardType: 'asc' }],
    });
  });

  it('findByJob returns the rewards of one job', async () => {
    prismaMock.episodeReward.findMany.mockResolvedValue([makeDbReward()]);

    const rewards = await episodeRewardRepository.findByJob('job-1');

    expect(prismaMock.episodeReward.findMany).toHaveBeenCalledWith({
      where: { jobId: 'job-1' },
      orderBy: { episodeIndex: 'asc' },
    });
    expect(rewards[0].jobId).toBe('job-1');
  });
});
