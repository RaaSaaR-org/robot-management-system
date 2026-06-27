/**
 * @file SimulationService.test.ts
 * @description Tests for SimulationService — async job lifecycle, mock metrics
 * @feature simulation
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SimulationService } from '../services/SimulationService.js';
import type { SimJob, SimMetrics } from '../services/SimulationService.js';
import { simToRealValidationService } from '../services/SimToRealValidationService.js';

describe('SimulationService', () => {
  let service: SimulationService;
  const originalBackend = process.env.SIMULATION_BACKEND;

  beforeEach(() => {
    // Force mock progression so the deterministic fake-timer lifecycle below
    // applies. Without this, canRunReal() finds the Python evaluator script in
    // the repo and runs the real MuJoCo subprocess path (jobs jump straight to
    // 'running'), breaking the queued→running→completed timing assertions.
    process.env.SIMULATION_BACKEND = 'mock';
    // Create a fresh instance for each test (bypass singleton for isolation)
    service = new (SimulationService as unknown as { new (): SimulationService })();
  });

  afterEach(() => {
    service.cleanup();
    if (originalBackend === undefined) {
      delete process.env.SIMULATION_BACKEND;
    } else {
      process.env.SIMULATION_BACKEND = originalBackend;
    }
  });

  // ==========================================================================
  // submitJob
  // ==========================================================================

  describe('submitJob', () => {
    it('creates a job with correct fields', () => {
      const job = service.submitJob('model-1', 'so101_tabletop', 100, 'mujoco');

      expect(job.jobId).toBeDefined();
      expect(job.modelId).toBe('model-1');
      expect(job.environment).toBe('so101_tabletop');
      expect(job.rolloutCount).toBe(100);
      expect(job.backend).toBe('mujoco');
      expect(job.status).toBe('queued');
      expect(job.progress).toBe(0);
      expect(job.metrics).toBeUndefined();
      expect(job.createdAt).toBeInstanceOf(Date);
      expect(job.updatedAt).toBeInstanceOf(Date);
    });

    it('creates job with isaac backend', () => {
      const job = service.submitJob('model-2', 'isaac_manipulation', 50, 'isaac');

      expect(job.backend).toBe('isaac');
      expect(job.environment).toBe('isaac_manipulation');
    });

    it('throws on missing modelId', () => {
      expect(() => service.submitJob('', 'so101_tabletop', 100, 'mujoco')).toThrow(
        'modelId is required'
      );
    });

    it('throws on missing environment', () => {
      expect(() => service.submitJob('model-1', '', 100, 'mujoco')).toThrow(
        'environment is required'
      );
    });

    it('throws on invalid rolloutCount (too low)', () => {
      expect(() => service.submitJob('model-1', 'so101_tabletop', 0, 'mujoco')).toThrow(
        'rolloutCount must be between 1 and 10000'
      );
    });

    it('throws on invalid rolloutCount (too high)', () => {
      expect(() => service.submitJob('model-1', 'so101_tabletop', 20000, 'mujoco')).toThrow(
        'rolloutCount must be between 1 and 10000'
      );
    });

    it('throws on unknown environment', () => {
      expect(() => service.submitJob('model-1', 'unknown_env', 100, 'mujoco')).toThrow(
        'Unknown environment: unknown_env'
      );
    });

    it('throws on invalid backend', () => {
      expect(() =>
        service.submitJob('model-1', 'so101_tabletop', 100, 'invalid' as 'mujoco')
      ).toThrow('backend must be "mujoco" or "isaac"');
    });
  });

  // ==========================================================================
  // getJob
  // ==========================================================================

  describe('getJob', () => {
    it('returns the correct job by ID', () => {
      const created = service.submitJob('model-1', 'so101_tabletop', 100, 'mujoco');
      const retrieved = service.getJob(created.jobId);

      expect(retrieved).toBeDefined();
      expect(retrieved!.jobId).toBe(created.jobId);
      expect(retrieved!.modelId).toBe('model-1');
    });

    it('returns undefined for unknown job ID', () => {
      const result = service.getJob('nonexistent-id');
      expect(result).toBeUndefined();
    });
  });

  // ==========================================================================
  // listJobs
  // ==========================================================================

  describe('listJobs', () => {
    it('returns all jobs when no filter provided', () => {
      service.submitJob('model-1', 'so101_tabletop', 100, 'mujoco');
      service.submitJob('model-2', 'isaac_manipulation', 50, 'isaac');

      const jobs = service.listJobs();
      expect(jobs).toHaveLength(2);
    });

    it('filters by status', () => {
      service.submitJob('model-1', 'so101_tabletop', 100, 'mujoco');
      service.submitJob('model-2', 'isaac_manipulation', 50, 'isaac');

      const queued = service.listJobs({ status: 'queued' });
      expect(queued).toHaveLength(2);

      const running = service.listJobs({ status: 'running' });
      expect(running).toHaveLength(0);
    });

    it('filters by environment', () => {
      service.submitJob('model-1', 'so101_tabletop', 100, 'mujoco');
      service.submitJob('model-2', 'isaac_manipulation', 50, 'isaac');

      const tabletop = service.listJobs({ environment: 'so101_tabletop' });
      expect(tabletop).toHaveLength(1);
      expect(tabletop[0].environment).toBe('so101_tabletop');
    });

    it('filters by modelId', () => {
      service.submitJob('model-1', 'so101_tabletop', 100, 'mujoco');
      service.submitJob('model-2', 'so101_sorting', 50, 'mujoco');

      const model1 = service.listJobs({ modelId: 'model-1' });
      expect(model1).toHaveLength(1);
      expect(model1[0].modelId).toBe('model-1');
    });

    it('returns jobs sorted by createdAt descending', () => {
      vi.useFakeTimers();
      const job1 = service.submitJob('model-1', 'so101_tabletop', 100, 'mujoco');
      vi.advanceTimersByTime(10);
      const job2 = service.submitJob('model-2', 'so101_sorting', 50, 'mujoco');

      const jobs = service.listJobs();
      expect(jobs[0].jobId).toBe(job2.jobId);
      expect(jobs[1].jobId).toBe(job1.jobId);
      vi.useRealTimers();
    });
  });

  // ==========================================================================
  // Job lifecycle: queued → running → completed
  // ==========================================================================

  describe('job lifecycle', () => {
    it('transitions from queued to running after ~1s', async () => {
      vi.useFakeTimers();
      const job = service.submitJob('model-1', 'so101_tabletop', 10, 'mujoco');

      expect(job.status).toBe('queued');

      // Advance past the 1s delay
      vi.advanceTimersByTime(1100);

      const updated = service.getJob(job.jobId);
      expect(updated!.status).toBe('running');

      vi.useRealTimers();
    });

    it('increments progress while running', async () => {
      vi.useFakeTimers();
      const job = service.submitJob('model-1', 'so101_tabletop', 10, 'mujoco');

      // Move to running
      vi.advanceTimersByTime(1100);
      expect(service.getJob(job.jobId)!.status).toBe('running');

      // Advance a few progress ticks
      vi.advanceTimersByTime(1500);
      const current = service.getJob(job.jobId)!;
      expect(current.progress).toBeGreaterThan(0);

      vi.useRealTimers();
    });

    it('completes with metrics when progress reaches 100', async () => {
      vi.useFakeTimers();
      const job = service.submitJob('model-1', 'so101_tabletop', 10, 'mujoco');

      // Advance enough time for full completion (1s start + many 500ms ticks)
      vi.advanceTimersByTime(60000);

      const completed = service.getJob(job.jobId)!;
      expect(completed.status).toBe('completed');
      expect(completed.progress).toBe(100);
      expect(completed.metrics).toBeDefined();
      expect(completed.metrics!.successRate).toBeGreaterThanOrEqual(0.6);
      expect(completed.metrics!.successRate).toBeLessThanOrEqual(0.95);
      expect(completed.metrics!.avgStepsToCompletion).toBeGreaterThanOrEqual(15);
      expect(completed.metrics!.avgStepsToCompletion).toBeLessThanOrEqual(50);
      expect(completed.metrics!.collisionCount).toBeGreaterThanOrEqual(0);
      expect(completed.metrics!.collisionCount).toBeLessThanOrEqual(5);
      expect(completed.metrics!.avgEpisodeDuration).toBeGreaterThan(0);

      vi.useRealTimers();
    });
  });

  // ==========================================================================
  // cancelJob
  // ==========================================================================

  describe('cancelJob', () => {
    it('cancels a queued job', () => {
      const job = service.submitJob('model-1', 'so101_tabletop', 100, 'mujoco');
      const cancelled = service.cancelJob(job.jobId);

      expect(cancelled.status).toBe('failed');
    });

    it('throws when job not found', () => {
      expect(() => service.cancelJob('nonexistent')).toThrow('Job not found: nonexistent');
    });

    it('throws when job is already completed', async () => {
      vi.useFakeTimers();
      const job = service.submitJob('model-1', 'so101_tabletop', 10, 'mujoco');

      vi.advanceTimersByTime(60000);
      expect(service.getJob(job.jobId)!.status).toBe('completed');

      expect(() => service.cancelJob(job.jobId)).toThrow('Cannot cancel job in status: completed');

      vi.useRealTimers();
    });
  });

  // ==========================================================================
  // getAvailableEnvironments
  // ==========================================================================

  describe('getAvailableEnvironments', () => {
    it('returns at least 3 environments', () => {
      const envs = service.getAvailableEnvironments();
      expect(envs.length).toBeGreaterThanOrEqual(3);
    });

    it('each environment has required fields', () => {
      const envs = service.getAvailableEnvironments();
      for (const env of envs) {
        expect(env.id).toBeDefined();
        expect(env.name).toBeDefined();
        expect(env.description).toBeDefined();
        expect(['mujoco', 'isaac']).toContain(env.backend);
      }
    });

    it('includes both mujoco and isaac backends', () => {
      const envs = service.getAvailableEnvironments();
      const backends = new Set(envs.map((e) => e.backend));
      expect(backends.has('mujoco')).toBe(true);
      expect(backends.has('isaac')).toBe(true);
    });
  });

  // ==========================================================================
  // getSimToRealComparison
  // ==========================================================================

  // getSimToRealComparison now returns the REAL measured gap from persisted
  // SimToRealValidation rows (TASK-171). The faked `sim * random()` path is gone.
  describe('getSimToRealComparison', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('returns empty array when the model has no validations', async () => {
      vi.spyOn(simToRealValidationService, 'getComparisonForModel').mockResolvedValue([]);
      const comparisons = await service.getSimToRealComparison('model-1');
      expect(comparisons).toEqual([]);
    });

    it('returns measured validation rows for the model', async () => {
      vi.spyOn(simToRealValidationService, 'getComparisonForModel').mockResolvedValue([
        {
          modelId: 'model-1',
          simSuccessRate: 0.8,
          realSuccessRate: 0.6,
          gap: 0.2,
          twinId: 'twin-1',
          simSceneId: 'scene-1',
          validationDate: '2026-06-25T00:00:00.000Z',
          realTestCount: 5,
        },
      ]);

      const comparisons = await service.getSimToRealComparison('model-1');
      expect(comparisons).toHaveLength(1);
      const c = comparisons[0];
      expect(c.modelId).toBe('model-1');
      expect(c.gap).toBe(0.2);
      expect(c.simSuccessRate).toBe(0.8);
      expect(c.realSuccessRate).toBe(0.6);
    });
  });
});
