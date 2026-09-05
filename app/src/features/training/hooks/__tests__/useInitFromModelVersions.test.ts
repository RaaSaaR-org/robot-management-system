/**
 * @file useInitFromModelVersions.test.ts
 * @description Which registered models a run may start from — the registry
 *              listing alone cannot say, so the hook asks per model. (TASK-239)
 * @feature training
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { ModelVersion } from '@/features/deployment/types';
import { useInitFromModelVersions } from '../useInitFromModelVersions';

const listed = vi.fn<() => ModelVersion[]>(() => []);
const fetchModelVersions = vi.fn().mockResolvedValue(undefined);
const getModelVersion = vi.fn();

vi.mock('@/features/deployment/hooks/useModelVersions', () => ({
  useModelVersions: () => ({
    modelVersions: listed(),
    versions: listed(),
    stagingVersions: [],
    productionVersions: [],
    isLoading: false,
    fetchModelVersions,
    fetchVersions: fetchModelVersions,
  }),
}));

vi.mock('@/features/deployment/api', () => ({
  deploymentApi: {
    getModelVersion: (id: string) => getModelVersion(id),
  },
}));

function version(id: string, overrides: Partial<ModelVersion> = {}): ModelVersion {
  return {
    id,
    skillId: 'skill-1',
    trainingJobId: `job-${id}`,
    name: `Model ${id}`,
    sourceKind: 'training',
    parentModelVersionId: null,
    version: '1.0.0',
    artifactUri: `s3://models/${id}`,
    trainingMetrics: {},
    validationMetrics: {},
    deploymentStatus: 'staging',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useInitFromModelVersions', () => {
  it('keeps the models of this architecture and counts the rest as hidden', async () => {
    // `GET /api/models/versions` carries no baseModel at all — the architecture
    // lives on each model's training job, which only the detail endpoint sends.
    listed.mockReturnValue([version('a-groot'), version('a-pi0')]);
    getModelVersion.mockImplementation(async (id: string) => ({
      ...version(id),
      trainingJob: { baseModel: id === 'a-groot' ? 'groot_n1_7' : 'pi0' },
      checkpoints: [],
    }));

    const { result } = renderHook(() => useInitFromModelVersions('groot_n1_7'));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.candidates.map((c) => c.version.id)).toEqual(['a-groot']);
    // Said out loud rather than silently: a picker holding one of the two
    // registered models is otherwise indistinguishable from a half-failed load.
    expect(result.current.hiddenCount).toBe(1);
  });

  it('offers an imported model, which records no architecture of its own', async () => {
    // The hand-registered GR00T checkpoint case: no TrainingJob row here, so
    // there is nothing to compare — and the server accepts it rather than
    // refusing what it cannot check.
    listed.mockReturnValue([version('b-imported', { trainingJobId: null, sourceKind: 'imported' })]);
    getModelVersion.mockImplementation(async (id: string) => ({ ...version(id), checkpoints: [] }));

    const { result } = renderHook(() => useInitFromModelVersions('smolvla'));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.candidates.map((c) => c.version.id)).toEqual(['b-imported']);
    expect(result.current.candidates[0].baseModel).toBeNull();
  });

  it('carries the checkpoints the model wrote, so the epoch list needs no second request', async () => {
    listed.mockReturnValue([version('c-groot')]);
    getModelVersion.mockImplementation(async (id: string) => ({
      ...version(id),
      trainingJob: { baseModel: 'groot_n1_7' },
      checkpoints: [
        {
          id: 'cp-14',
          modelVersionId: id,
          trainingJobId: `job-${id}`,
          epoch: 14,
          uri: 's3://checkpoints/cp-14',
          metrics: { loss: 0.081 },
          createdAt: '2026-09-01T00:00:00.000Z',
        },
      ],
    }));

    const { result } = renderHook(() => useInitFromModelVersions('groot_n1_7'));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.candidates[0].checkpoints.map((c) => c.epoch)).toEqual([14]);
  });
});
