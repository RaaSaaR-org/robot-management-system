/**
 * @file SimulationService.test.ts
 * @description Unit tests for SimulationService — job submission/validation, lifecycle
 *   (queued → running → completed) via mock progression, listing/filtering, cancellation,
 *   environments, and sim-to-real comparison aggregation. All I/O boundaries
 *   (SimulationJobRepository/Prisma, uuid, fs, child_process) are mocked; aggregation
 *   math runs for real with deterministic inputs.
 * @feature simulation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Force mock execution path: canRunReal() returns false when SIMULATION_BACKEND
// is 'mock', so submitJob() drives the deterministic timer-based progression
// instead of spawning a real Python subprocess. Must be set before the module
// (and its singleton) is imported.
// ---------------------------------------------------------------------------
process.env.SIMULATION_BACKEND = 'mock';

// ---------------------------------------------------------------------------
// Mocks for external boundaries
// ---------------------------------------------------------------------------

// Deterministic UUIDs so we can address created jobs by id.
let uuidCounter = 0;
vi.mock('uuid', () => ({
  v4: () => `job-${++uuidCounter}`,
}));

// Repository touches Prisma/DB — mock every method the service calls.
vi.mock('../../repositories/SimulationJobRepository.js', () => ({
  simulationJobRepository: {
    markFailedOnBoot: vi.fn(),
    findAll: vi.fn(),
    findById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    createFrames: vi.fn(),
  },
}));

// Filesystem + child_process are only touched on the real path / preview;
// stub them so nothing escapes to disk or spawns processes.
vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(() => '{}'),
}));

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

import { SimulationService, simulationService } from '../SimulationService.js';
import { simulationJobRepository as _simRepo } from '../../repositories/SimulationJobRepository.js';
import { existsSync as _existsSync } from 'fs';
import { spawn as _spawn } from 'child_process';

const simRepo = vi.mocked(_simRepo, true);
const existsSync = vi.mocked(_existsSync);
const spawn = vi.mocked(_spawn);

const VALID_ENV = 'so101_tabletop';

beforeEach(() => {
  vi.clearAllMocks();
  // Sensible async defaults so fire-and-forget persistence never rejects unhandled.
  simRepo.markFailedOnBoot.mockResolvedValue(0 as never);
  simRepo.findAll.mockResolvedValue([] as never);
  simRepo.findById.mockResolvedValue(null as never);
  simRepo.create.mockResolvedValue(undefined as never);
  simRepo.update.mockResolvedValue(undefined as never);
  simRepo.createFrames.mockResolvedValue(undefined as never);
  existsSync.mockReturnValue(false);
  // Reset the shared singleton's in-memory state between tests.
  simulationService.cleanup();
});

afterEach(() => {
  // Tear down any timers left running by mock progression so the file exits.
  simulationService.cleanup();
  vi.useRealTimers();
});

// ===========================================================================
// submitJob — validation
// ===========================================================================

describe('submitJob (validation)', () => {
  it('throws when modelId is missing', () => {
    expect(() => simulationService.submitJob('', VALID_ENV, 10, 'mujoco')).toThrow(
      'modelId is required'
    );
    expect(simRepo.create).not.toHaveBeenCalled();
  });

  it('throws when environment is missing', () => {
    expect(() => simulationService.submitJob('m1', '', 10, 'mujoco')).toThrow(
      'environment is required'
    );
  });

  it('throws when rolloutCount is below 1', () => {
    expect(() => simulationService.submitJob('m1', VALID_ENV, 0, 'mujoco')).toThrow(
      'rolloutCount must be between 1 and 10000'
    );
  });

  it('throws when rolloutCount exceeds 10000', () => {
    expect(() => simulationService.submitJob('m1', VALID_ENV, 10001, 'mujoco')).toThrow(
      'rolloutCount must be between 1 and 10000'
    );
  });

  it('throws on an invalid backend', () => {
    expect(() =>
      // @ts-expect-error — exercising runtime validation of an invalid backend
      simulationService.submitJob('m1', VALID_ENV, 10, 'gazebo')
    ).toThrow('backend must be "mujoco" or "isaac"');
  });

  it('throws on an unknown environment id', () => {
    expect(() => simulationService.submitJob('m1', 'no_such_env', 10, 'mujoco')).toThrow(
      'Unknown environment: no_such_env'
    );
  });
});

// ===========================================================================
// submitJob — success path
// ===========================================================================

describe('submitJob (success)', () => {
  it('creates a queued job, persists it, and emits job:created', () => {
    const created = vi.fn();
    simulationService.on('job:created', created);

    const job = simulationService.submitJob('m1', VALID_ENV, 50, 'mujoco');

    expect(job.status).toBe('queued');
    expect(job.progress).toBe(0);
    expect(job.modelId).toBe('m1');
    expect(job.environment).toBe(VALID_ENV);
    expect(job.rolloutCount).toBe(50);
    expect(job.backend).toBe('mujoco');
    expect(typeof job.jobId).toBe('string');
    expect(job.createdAt).toBeInstanceOf(Date);

    // Persisted to DB (fire-and-forget) and retrievable from memory.
    expect(simRepo.create).toHaveBeenCalledOnce();
    expect(simulationService.getJob(job.jobId)).toBe(job);

    // Emitted with the job payload.
    expect(created).toHaveBeenCalledOnce();
    expect(created.mock.calls[0][0]).toBe(job);

    simulationService.off('job:created', created);
  });

  it('does not spawn a subprocess on the mock backend', () => {
    simulationService.submitJob('m1', VALID_ENV, 50, 'mujoco');
    expect(spawn).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// mock job progression (lifecycle)
// ===========================================================================

describe('mock job progression', () => {
  it('transitions queued → running → completed and sets metrics', () => {
    vi.useFakeTimers();
    const running = vi.fn();
    const completed = vi.fn();
    simulationService.on('job:running', running);
    simulationService.on('job:completed', completed);

    // rolloutCount=5 → progressStep = floor(100 / (5/5)) = 100, so one tick completes it.
    const job = simulationService.submitJob('m1', VALID_ENV, 5, 'mujoco');
    expect(job.status).toBe('queued');

    // After 1s the job transitions to running.
    vi.advanceTimersByTime(1000);
    expect(simulationService.getJob(job.jobId)!.status).toBe('running');
    expect(running).toHaveBeenCalledOnce();

    // After the first 500ms progress tick it reaches 100 and completes.
    vi.advanceTimersByTime(500);
    const done = simulationService.getJob(job.jobId)!;
    expect(done.status).toBe('completed');
    expect(done.progress).toBe(100);
    expect(done.metrics).toBeDefined();
    expect(done.metrics!.successRate).toBeGreaterThanOrEqual(0);
    expect(done.metrics!.successRate).toBeLessThanOrEqual(1);
    expect(completed).toHaveBeenCalledOnce();

    // Completion persisted with terminal status.
    const updateCalls = simRepo.update.mock.calls;
    const completionCall = updateCalls.find((c) => c[1].status === 'completed');
    expect(completionCall).toBeDefined();
    expect(completionCall![1].progress).toBe(100);

    simulationService.off('job:running', running);
    simulationService.off('job:completed', completed);
  });

  it('increments progress over multiple ticks for a larger rollout count', () => {
    vi.useFakeTimers();
    // rolloutCount=100 → progressStep = floor(100 / (100/5)) = floor(5) = 5.
    const job = simulationService.submitJob('m1', VALID_ENV, 100, 'mujoco');

    vi.advanceTimersByTime(1000); // → running
    vi.advanceTimersByTime(500); // one tick
    const j1 = simulationService.getJob(job.jobId)!;
    expect(j1.status).toBe('running');
    expect(j1.progress).toBe(5);

    vi.advanceTimersByTime(500); // second tick
    expect(simulationService.getJob(job.jobId)!.progress).toBe(10);
  });
});

// ===========================================================================
// getJob
// ===========================================================================

describe('getJob', () => {
  it('returns the job when it exists', () => {
    const job = simulationService.submitJob('m1', VALID_ENV, 10, 'mujoco');
    expect(simulationService.getJob(job.jobId)).toBe(job);
  });

  it('returns undefined for an unknown id', () => {
    expect(simulationService.getJob('nope')).toBeUndefined();
  });
});

// ===========================================================================
// listJobs (filtering + ordering)
// ===========================================================================

describe('listJobs', () => {
  it('returns all jobs sorted by createdAt descending', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const first = simulationService.submitJob('mA', VALID_ENV, 10, 'mujoco');
    vi.setSystemTime(new Date('2026-01-01T00:01:00Z'));
    const second = simulationService.submitJob('mB', VALID_ENV, 10, 'mujoco');

    const list = simulationService.listJobs();
    expect(list).toHaveLength(2);
    // newest first
    expect(list[0].jobId).toBe(second.jobId);
    expect(list[1].jobId).toBe(first.jobId);
  });

  it('filters by modelId', () => {
    simulationService.submitJob('mA', VALID_ENV, 10, 'mujoco');
    simulationService.submitJob('mB', VALID_ENV, 10, 'mujoco');

    const list = simulationService.listJobs({ modelId: 'mA' });
    expect(list).toHaveLength(1);
    expect(list[0].modelId).toBe('mA');
  });

  it('filters by environment', () => {
    simulationService.submitJob('mA', 'so101_tabletop', 10, 'mujoco');
    simulationService.submitJob('mA', 'so101_sorting', 10, 'mujoco');

    const list = simulationService.listJobs({ environment: 'so101_sorting' });
    expect(list).toHaveLength(1);
    expect(list[0].environment).toBe('so101_sorting');
  });

  it('filters by status', () => {
    simulationService.submitJob('mA', VALID_ENV, 10, 'mujoco');
    const list = simulationService.listJobs({ status: 'queued' });
    expect(list.every((j) => j.status === 'queued')).toBe(true);
    expect(simulationService.listJobs({ status: 'completed' })).toHaveLength(0);
  });

  it('returns an empty array when no jobs exist', () => {
    expect(simulationService.listJobs()).toEqual([]);
  });
});

// ===========================================================================
// cancelJob
// ===========================================================================

describe('cancelJob', () => {
  it('throws when the job is not found', () => {
    expect(() => simulationService.cancelJob('ghost')).toThrow('Job not found: ghost');
  });

  it('cancels a queued job, marks it failed, and emits job:cancelled', () => {
    const cancelled = vi.fn();
    simulationService.on('job:cancelled', cancelled);

    const job = simulationService.submitJob('m1', VALID_ENV, 10, 'mujoco');
    const result = simulationService.cancelJob(job.jobId);

    expect(result.status).toBe('failed');
    expect(simulationService.getJob(job.jobId)!.status).toBe('failed');
    expect(cancelled).toHaveBeenCalledOnce();
    expect(simRepo.update).toHaveBeenCalledWith(
      job.jobId,
      expect.objectContaining({ status: 'failed', failureReason: 'cancelled' })
    );

    simulationService.off('job:cancelled', cancelled);
  });

  it('clears the running timer when cancelling a running job', () => {
    vi.useFakeTimers();
    const job = simulationService.submitJob('m1', VALID_ENV, 100, 'mujoco');
    vi.advanceTimersByTime(1000); // → running, timer registered
    expect(simulationService.getJob(job.jobId)!.status).toBe('running');

    simulationService.cancelJob(job.jobId);
    expect(simulationService.getJob(job.jobId)!.status).toBe('failed');

    // Advancing further must NOT resurrect/complete the cancelled job.
    vi.advanceTimersByTime(5000);
    expect(simulationService.getJob(job.jobId)!.status).toBe('failed');
  });

  it('throws when trying to cancel an already-completed job', () => {
    vi.useFakeTimers();
    const job = simulationService.submitJob('m1', VALID_ENV, 5, 'mujoco');
    vi.advanceTimersByTime(1500); // run to completion
    expect(simulationService.getJob(job.jobId)!.status).toBe('completed');

    expect(() => simulationService.cancelJob(job.jobId)).toThrow(
      'Cannot cancel job in status: completed'
    );
  });
});

// ===========================================================================
// getAvailableEnvironments
// ===========================================================================

describe('getAvailableEnvironments', () => {
  it('returns all environments as a defensive copy', () => {
    const envs = simulationService.getAvailableEnvironments();
    expect(envs.length).toBeGreaterThan(0);
    const ids = envs.map((e) => e.id);
    expect(ids).toContain('so101_tabletop');
    expect(ids).toContain('isaac_manipulation');

    // Mutating the returned array must not affect internal state.
    envs.pop();
    expect(simulationService.getAvailableEnvironments().length).toBe(envs.length + 1);
  });
});

// ===========================================================================
// getFramesDir
// ===========================================================================

describe('getFramesDir', () => {
  it('returns null when the job has no frames directory', () => {
    const job = simulationService.submitJob('m1', VALID_ENV, 10, 'mujoco');
    expect(simulationService.getFramesDir(job.jobId)).toBeNull();
  });

  it('returns null for an unknown job', () => {
    expect(simulationService.getFramesDir('nope')).toBeNull();
  });
});

// ===========================================================================
// getSimToRealComparison (aggregation math)
// ===========================================================================

describe('getSimToRealComparison', () => {
  it('returns an empty array when there are no completed jobs', () => {
    simulationService.submitJob('m1', VALID_ENV, 10, 'mujoco'); // queued, not completed
    expect(simulationService.getSimToRealComparison('m1')).toEqual([]);
  });

  it('averages success rate per environment and derives a non-negative gap', () => {
    // Run two jobs to completion with deterministic metrics so we can assert
    // the aggregation math exactly. Stub Math.random:
    //  - generateMockMetrics(): successRate = round((0.6 + r*0.35)*1000)/1000
    //    with r=0 → 0.6
    //  - getSimToRealComparison(): realOffset = 0.7 + r*0.2, with r=0 → 0.7
    vi.useFakeTimers();
    const randSpy = vi.spyOn(Math, 'random').mockReturnValue(0);

    const j1 = simulationService.submitJob('mX', VALID_ENV, 5, 'mujoco');
    vi.advanceTimersByTime(1500);
    const j2 = simulationService.submitJob('mX', VALID_ENV, 5, 'mujoco');
    vi.advanceTimersByTime(1500);

    expect(simulationService.getJob(j1.jobId)!.status).toBe('completed');
    expect(simulationService.getJob(j2.jobId)!.status).toBe('completed');

    const comparisons = simulationService.getSimToRealComparison('mX');
    expect(comparisons).toHaveLength(1); // one environment group
    const c = comparisons[0];
    expect(c.modelId).toBe('mX');
    // avg sim success = 0.6 ; real = 0.6 * 0.7 = 0.42 ; gap = 0.18
    expect(c.simSuccessRate).toBe(0.6);
    expect(c.realSuccessRate).toBe(0.42);
    expect(c.gap).toBeCloseTo(0.18, 3);

    randSpy.mockRestore();
  });

  it('groups completed jobs by environment into separate comparisons', () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const a = simulationService.submitJob('mY', 'so101_tabletop', 5, 'mujoco');
    vi.advanceTimersByTime(1500);
    const b = simulationService.submitJob('mY', 'so101_sorting', 5, 'mujoco');
    vi.advanceTimersByTime(1500);

    expect(simulationService.getJob(a.jobId)!.status).toBe('completed');
    expect(simulationService.getJob(b.jobId)!.status).toBe('completed');

    const comparisons = simulationService.getSimToRealComparison('mY');
    expect(comparisons).toHaveLength(2);
    expect(comparisons.every((c) => c.gap >= 0)).toBe(true);
  });
});

// ===========================================================================
// getEnvironmentPreview (I/O guard)
// ===========================================================================

describe('getEnvironmentPreview', () => {
  it('returns the cached path when the preview file already exists', async () => {
    // First existsSync (cache check) → true short-circuits before spawning.
    existsSync.mockReturnValueOnce(true);
    const result = await simulationService.getEnvironmentPreview('so101_tabletop');
    expect(result).toBe('/tmp/sim_preview_so101_tabletop.jpg');
    expect(spawn).not.toHaveBeenCalled();
  });

  it('returns null when neither the cache nor the preview script exists', async () => {
    existsSync.mockReturnValue(false); // both cache check and script check false
    const result = await simulationService.getEnvironmentPreview('so101_sorting');
    expect(result).toBeNull();
    expect(spawn).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// class export sanity
// ===========================================================================

describe('SimulationService singleton', () => {
  it('exposes a singleton that is an instance of the class', () => {
    expect(simulationService).toBeInstanceOf(SimulationService);
    expect(SimulationService.getInstance()).toBe(simulationService);
  });
});
