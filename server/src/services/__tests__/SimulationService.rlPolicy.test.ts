/**
 * @file SimulationService.rlPolicy.test.ts
 * @description TASK-172.C Phase 3 — the model-type-aware evaluator branch.
 *   A `rl_policy` ModelVersion is scored by spawning evaluate_policy.py with the
 *   materialized policy.onnx (no VLA server); a supervised `vla` model still
 *   spawns evaluate_vla.py with --vla-server. Runs on the REAL execution path
 *   (SIMULATION_BACKEND unset) with every I/O boundary mocked.
 * @feature simulation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Real execution path: canRunReal() must NOT short-circuit to mock.
delete process.env.SIMULATION_BACKEND;

vi.mock('uuid', () => ({ v4: () => 'simjob-1' }));

vi.mock('../../repositories/SimulationJobRepository.js', () => ({
  simulationJobRepository: {
    markFailedOnBoot: vi.fn().mockResolvedValue(0),
    findAll: vi.fn().mockResolvedValue([]),
    findById: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
    createFrames: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../repositories/index.js', () => ({
  simSceneRepository: {
    // mjcfKey null → materializeSceneFile returns undefined (no scene file).
    findById: vi.fn().mockResolvedValue({
      id: 'scene-1',
      builtinEnvId: 'g1_empty',
      twinId: null,
      embodimentTag: 'g1',
      backend: 'mujoco',
      mjcfKey: null,
      bounds: { minX: 0, minY: 0, minZ: 0, maxX: 2, maxY: 2, maxZ: 2 },
    }),
  },
  digitalTwinRepository: { findById: vi.fn() },
  twinZoneRepository: { findByTwinId: vi.fn() },
  modelVersionRepository: { findById: vi.fn() },
}));

vi.mock('../../storage/model-storage.js', () => ({
  modelStorage: {
    getModelCheckpointStream: vi.fn().mockResolvedValue({}),
    getTwinArtifactStream: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('../SimToRealValidationService.js', () => ({
  simToRealValidationService: { getComparisonForModel: vi.fn().mockResolvedValue([]) },
}));

vi.mock('fs', () => ({
  existsSync: vi.fn(() => true), // evaluator scripts present
  mkdirSync: vi.fn(),
  mkdtempSync: vi.fn(() => '/tmp/sim'),
  readFileSync: vi.fn(() => '{}'),
  writeFileSync: vi.fn(),
  createWriteStream: vi.fn(() => ({})),
  rmSync: vi.fn(),
}));

vi.mock('stream/promises', () => ({ pipeline: vi.fn().mockResolvedValue(undefined) }));

vi.mock('child_process', () => ({
  spawn: vi.fn(() => ({ stdout: null, stderr: null, on: vi.fn(), kill: vi.fn() })),
}));

import { simulationService } from '../SimulationService.js';
import { modelVersionRepository, simSceneRepository } from '../../repositories/index.js';
import { modelStorage } from '../../storage/model-storage.js';
import { spawn as _spawn } from 'child_process';
import { rmSync as _rmSync } from 'fs';

const spawn = vi.mocked(_spawn);
const rmSync = vi.mocked(_rmSync);
const findModel = vi.mocked(modelVersionRepository.findById);
const getCheckpointStream = vi.mocked(modelStorage.getModelCheckpointStream);

const RL_MODEL = {
  id: 'mv-rl',
  trainingJobId: 'tj-rl',
  modelType: 'rl_policy',
  artifactUri: 's3://model-checkpoints/tj-rl/policy.zip',
} as never;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(simSceneRepository.findById).mockResolvedValue({
    id: 'scene-1',
    builtinEnvId: 'g1_empty',
    twinId: null,
    embodimentTag: 'g1',
    backend: 'mujoco',
    mjcfKey: null,
    bounds: { minX: 0, minY: 0, minZ: 0, maxX: 2, maxY: 2, maxZ: 2 },
  } as never);
  getCheckpointStream.mockResolvedValue({} as never);
  spawn.mockReturnValue({ stdout: null, stderr: null, on: vi.fn(), kill: vi.fn() } as never);
  simulationService.cleanup();
});

function lastSpawnArgs(): string[] {
  expect(spawn).toHaveBeenCalled();
  return spawn.mock.calls[spawn.mock.calls.length - 1][1] as string[];
}

describe('SimulationService — rl_policy evaluator branch (Phase 3)', () => {
  it('spawns evaluate_policy.py with --policy-file for a rl_policy model', async () => {
    findModel.mockResolvedValue({
      id: 'mv-rl',
      trainingJobId: 'tj-rl',
      modelType: 'rl_policy',
      artifactUri: 's3://model-checkpoints/tj-rl/policy.zip',
    } as never);

    await simulationService.submitJobForScene('mv-rl', 'scene-1', 3);
    await vi.waitFor(() => expect(spawn).toHaveBeenCalled());

    const args = lastSpawnArgs();
    expect(args.some((a) => a.endsWith('evaluate_policy.py'))).toBe(true);
    expect(args).toContain('--policy-file');
    expect(args).toContain('--manifest-file');
    // RL policy is scored locally — never against a VLA server.
    expect(args).not.toContain('--vla-server');
    // Pulled the policy artifact from the worker's `<trainingJobId>/` prefix.
    expect(getCheckpointStream).toHaveBeenCalledWith('tj-rl/policy.onnx');
  });

  it('spawns evaluate_vla.py with --vla-server for a supervised vla model', async () => {
    findModel.mockResolvedValue({
      id: 'mv-vla',
      trainingJobId: 'tj-vla',
      modelType: 'vla',
      artifactUri: 's3://model-checkpoints/tj-vla/model.safetensors',
    } as never);

    await simulationService.submitJobForScene('mv-vla', 'scene-1', 3);
    await vi.waitFor(() => expect(spawn).toHaveBeenCalled());

    const args = lastSpawnArgs();
    expect(args.some((a) => a.endsWith('evaluate_vla.py'))).toBe(true);
    expect(args).toContain('--vla-server');
    expect(args).not.toContain('--policy-file');
    expect(getCheckpointStream).not.toHaveBeenCalled();
  });

  it('fails the job (no spawn) when the rl_policy artifact cannot be fetched', async () => {
    findModel.mockResolvedValue({
      id: 'mv-rl',
      trainingJobId: 'tj-rl',
      modelType: 'rl_policy',
      artifactUri: 's3://model-checkpoints/tj-rl/policy.zip',
    } as never);
    getCheckpointStream.mockRejectedValue(new Error('storage offline'));

    const failed = vi.fn();
    simulationService.on('job:failed', failed);
    const job = await simulationService.submitJobForScene('mv-rl', 'scene-1', 3);
    await vi.waitFor(() => expect(failed).toHaveBeenCalled());

    expect(spawn).not.toHaveBeenCalled();
    expect(simulationService.getJob(job.jobId)!.status).toBe('failed');
    expect(simulationService.getJob(job.jobId)!.failureReason).toContain('storage offline');
    simulationService.off('job:failed', failed);
  });

  it('cleans up the per-job policy dir when artifact fetch fails (no leak)', async () => {
    findModel.mockResolvedValue(RL_MODEL);
    getCheckpointStream.mockRejectedValue(new Error('storage offline'));

    const failed = vi.fn();
    simulationService.on('job:failed', failed);
    await simulationService.submitJobForScene('mv-rl', 'scene-1', 3);
    await vi.waitFor(() => expect(failed).toHaveBeenCalled());
    simulationService.off('job:failed', failed);

    // No subprocess spawns on this path, so the dir must be removed eagerly.
    const policyDirCleaned = rmSync.mock.calls.some(
      ([p]) => typeof p === 'string' && p.includes('policy')
    );
    expect(policyDirCleaned).toBe(true);
  });

  it('falls back to identity normalization (no --manifest-file) when manifest is absent', async () => {
    findModel.mockResolvedValue(RL_MODEL);
    // policy.onnx resolves; manifest.json is genuinely absent (NoSuchKey).
    getCheckpointStream.mockImplementation(async (key: string) => {
      if (key.endsWith('manifest.json')) {
        const err = new Error('not found') as Error & { name: string };
        err.name = 'NoSuchKey';
        throw err;
      }
      return {} as never;
    });

    await simulationService.submitJobForScene('mv-rl', 'scene-1', 3);
    await vi.waitFor(() => expect(spawn).toHaveBeenCalled());

    const args = lastSpawnArgs();
    expect(args.some((a) => a.endsWith('evaluate_policy.py'))).toBe(true);
    expect(args).toContain('--policy-file');
    // Missing manifest is non-fatal — the gate runs with identity normalization.
    expect(args).not.toContain('--manifest-file');
  });

  it('skips spawning the evaluator when the job is cancelled during artifact download', async () => {
    findModel.mockResolvedValue(RL_MODEL);
    // Cancel the (deterministic uuid) job while the policy.onnx stream is pending.
    getCheckpointStream.mockImplementation(async () => {
      simulationService.cancelJob('simjob-1');
      return {} as never;
    });

    const cancelled = vi.fn();
    simulationService.on('job:cancelled', cancelled);
    const job = await simulationService.submitJobForScene('mv-rl', 'scene-1', 3);
    await vi.waitFor(() => expect(cancelled).toHaveBeenCalled());
    simulationService.off('job:cancelled', cancelled);

    // The re-check before spawn must prevent launching an un-killable evaluator.
    expect(spawn).not.toHaveBeenCalled();
    expect(simulationService.getJob(job.jobId)!.status).toBe('failed');
  });
});
