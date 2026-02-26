/**
 * @file SimulationService.ts
 * @description Async simulation job lifecycle for MuJoCo/Isaac Lab policy testing
 * @feature simulation
 */

import { EventEmitter } from 'events';
import { v4 as uuid } from 'uuid';

// ============================================================================
// TYPES
// ============================================================================

export interface SimMetrics {
  successRate: number;
  avgStepsToCompletion: number;
  collisionCount: number;
  avgEpisodeDuration: number;
  simToRealGap?: number;
}

export interface SimJob {
  jobId: string;
  modelId: string;
  environment: string;
  rolloutCount: number;
  backend: 'mujoco' | 'isaac';
  status: 'queued' | 'running' | 'completed' | 'failed';
  progress: number;
  metrics?: SimMetrics;
  createdAt: Date;
  updatedAt: Date;
}

export interface SimEnvironment {
  id: string;
  name: string;
  description: string;
  backend: 'mujoco' | 'isaac';
  imageUrl?: string;
}

export interface SimToRealComparison {
  modelId: string;
  simSuccessRate: number;
  realSuccessRate: number;
  gap: number;
}

export interface SimJobFilter {
  modelId?: string;
  environment?: string;
  status?: SimJob['status'];
}

// ============================================================================
// AVAILABLE ENVIRONMENTS
// ============================================================================

const AVAILABLE_ENVIRONMENTS: SimEnvironment[] = [
  {
    id: 'so101_tabletop',
    name: 'SO-101 Tabletop',
    description: 'Tabletop manipulation environment for SO-101 robot arm with common objects',
    backend: 'mujoco',
  },
  {
    id: 'so101_sorting',
    name: 'SO-101 Sorting',
    description: 'Object sorting task environment for SO-101 with color-coded bins',
    backend: 'mujoco',
  },
  {
    id: 'isaac_manipulation',
    name: 'Isaac Manipulation',
    description: 'NVIDIA Isaac Lab manipulation environment with domain randomization',
    backend: 'isaac',
  },
  {
    id: 'isaac_pick_place',
    name: 'Isaac Pick & Place',
    description: 'High-fidelity pick-and-place environment with physics randomization',
    backend: 'isaac',
  },
];

// ============================================================================
// SERVICE
// ============================================================================

export class SimulationService extends EventEmitter {
  private static instance: SimulationService;
  private jobs: Map<string, SimJob> = new Map();
  private timers: Map<string, ReturnType<typeof setInterval>> = new Map();

  private constructor() {
    super();
  }

  static getInstance(): SimulationService {
    if (!SimulationService.instance) {
      SimulationService.instance = new SimulationService();
    }
    return SimulationService.instance;
  }

  // ==========================================================================
  // JOB LIFECYCLE
  // ==========================================================================

  /**
   * Submit a new simulation job
   */
  submitJob(
    modelId: string,
    environment: string,
    rolloutCount: number,
    backend: 'mujoco' | 'isaac'
  ): SimJob {
    if (!modelId) {
      throw new Error('modelId is required');
    }
    if (!environment) {
      throw new Error('environment is required');
    }
    if (rolloutCount < 1 || rolloutCount > 10000) {
      throw new Error('rolloutCount must be between 1 and 10000');
    }
    if (backend !== 'mujoco' && backend !== 'isaac') {
      throw new Error('backend must be "mujoco" or "isaac"');
    }

    const env = AVAILABLE_ENVIRONMENTS.find((e) => e.id === environment);
    if (!env) {
      throw new Error(`Unknown environment: ${environment}`);
    }

    const now = new Date();
    const job: SimJob = {
      jobId: uuid(),
      modelId,
      environment,
      rolloutCount,
      backend,
      status: 'queued',
      progress: 0,
      createdAt: now,
      updatedAt: now,
    };

    this.jobs.set(job.jobId, job);
    console.log(`[SimulationService] Job queued: ${job.jobId} (model=${modelId}, env=${environment})`);

    this.emit('job:created', job);

    // Start async progression: queued → running → completed
    this.startJobProgression(job.jobId);

    return job;
  }

  /**
   * Get a single job by ID
   */
  getJob(jobId: string): SimJob | undefined {
    return this.jobs.get(jobId);
  }

  /**
   * List all jobs with optional filtering
   */
  listJobs(filter?: SimJobFilter): SimJob[] {
    let jobs = Array.from(this.jobs.values());

    if (filter?.modelId) {
      jobs = jobs.filter((j) => j.modelId === filter.modelId);
    }
    if (filter?.environment) {
      jobs = jobs.filter((j) => j.environment === filter.environment);
    }
    if (filter?.status) {
      jobs = jobs.filter((j) => j.status === filter.status);
    }

    return jobs.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /**
   * Cancel a job (only if queued or running)
   */
  cancelJob(jobId: string): SimJob {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }
    if (job.status !== 'queued' && job.status !== 'running') {
      throw new Error(`Cannot cancel job in status: ${job.status}`);
    }

    // Clear any running timer
    const timer = this.timers.get(jobId);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(jobId);
    }

    job.status = 'failed';
    job.updatedAt = new Date();
    console.log(`[SimulationService] Job cancelled: ${jobId}`);
    this.emit('job:cancelled', job);

    return job;
  }

  // ==========================================================================
  // ENVIRONMENTS
  // ==========================================================================

  /**
   * Get all available simulation environments
   */
  getAvailableEnvironments(): SimEnvironment[] {
    return [...AVAILABLE_ENVIRONMENTS];
  }

  // ==========================================================================
  // SIM-TO-REAL COMPARISON
  // ==========================================================================

  /**
   * Get sim-to-real comparison data for a model
   */
  getSimToRealComparison(modelId: string): SimToRealComparison[] {
    const completedJobs = this.listJobs({ modelId, status: 'completed' });

    if (completedJobs.length === 0) {
      return [];
    }

    // Group by environment and compute averages
    const envGroups = new Map<string, SimMetrics[]>();
    for (const job of completedJobs) {
      if (job.metrics) {
        const group = envGroups.get(job.environment) ?? [];
        group.push(job.metrics);
        envGroups.set(job.environment, group);
      }
    }

    const comparisons: SimToRealComparison[] = [];
    for (const [, metrics] of envGroups) {
      const avgSimSuccess =
        metrics.reduce((sum, m) => sum + m.successRate, 0) / metrics.length;
      // Approximate real success rate as sim * (0.7-0.9) offset
      const realOffset = 0.7 + Math.random() * 0.2;
      const realSuccessRate = Math.min(1, avgSimSuccess * realOffset);
      const gap = avgSimSuccess - realSuccessRate;

      comparisons.push({
        modelId,
        simSuccessRate: Math.round(avgSimSuccess * 1000) / 1000,
        realSuccessRate: Math.round(realSuccessRate * 1000) / 1000,
        gap: Math.round(gap * 1000) / 1000,
      });
    }

    return comparisons;
  }

  // ==========================================================================
  // INTERNAL: ASYNC JOB PROGRESSION
  // ==========================================================================

  private startJobProgression(jobId: string): void {
    const job = this.jobs.get(jobId);
    if (!job) return;

    // Transition to running after 1s
    setTimeout(() => {
      const j = this.jobs.get(jobId);
      if (!j || j.status !== 'queued') return;

      j.status = 'running';
      j.updatedAt = new Date();
      console.log(`[SimulationService] Job running: ${jobId}`);
      this.emit('job:running', j);

      // Progress increment every 500ms
      const progressStep = Math.max(1, Math.floor(100 / (job.rolloutCount / 5)));
      const timer = setInterval(() => {
        const current = this.jobs.get(jobId);
        if (!current || current.status !== 'running') {
          clearInterval(timer);
          this.timers.delete(jobId);
          return;
        }

        current.progress = Math.min(100, current.progress + progressStep);
        current.updatedAt = new Date();

        if (current.progress >= 100) {
          clearInterval(timer);
          this.timers.delete(jobId);
          current.status = 'completed';
          current.metrics = this.generateMockMetrics();
          console.log(`[SimulationService] Job completed: ${jobId}`);
          this.emit('job:completed', current);
        }
      }, 500);

      this.timers.set(jobId, timer);
    }, 1000);
  }

  /**
   * Generate realistic mock metrics for a completed simulation
   */
  private generateMockMetrics(): SimMetrics {
    return {
      successRate: Math.round((0.6 + Math.random() * 0.35) * 1000) / 1000,
      avgStepsToCompletion: Math.floor(15 + Math.random() * 35),
      collisionCount: Math.floor(Math.random() * 6),
      avgEpisodeDuration: Math.round((5 + Math.random() * 25) * 100) / 100,
    };
  }

  // ==========================================================================
  // CLEANUP
  // ==========================================================================

  /**
   * Stop all running timers (for graceful shutdown / tests)
   */
  cleanup(): void {
    for (const [, timer] of this.timers) {
      clearInterval(timer);
    }
    this.timers.clear();
    this.jobs.clear();
  }
}

export const simulationService = SimulationService.getInstance();
