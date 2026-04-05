/**
 * @file SimulationService.ts
 * @description Async simulation job lifecycle for MuJoCo/Isaac Lab policy testing.
 *
 * When SIMULATION_BACKEND=real (and the Python evaluator is available), jobs are
 * executed via a real MuJoCo closed-loop evaluation subprocess. Otherwise, falls
 * back to mock metric generation for development without Python/MuJoCo installed.
 * @feature simulation
 */

import { EventEmitter } from 'events';
import { v4 as uuid } from 'uuid';
import { spawn, type ChildProcess } from 'child_process';
import { existsSync, mkdirSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createInterface } from 'readline';
import { simulationJobRepository } from '../repositories/SimulationJobRepository.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

export interface SimFrame {
  episode: number;
  step: number;
  file: string;
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
  frames?: SimFrame[];
  framesDir?: string;
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
// PATHS
// ============================================================================

// Resolve relative to project root (one level up from server/)
const PROJECT_ROOT = path.resolve(process.cwd(), '..');
const EVALUATOR_SCRIPT = path.join(
  PROJECT_ROOT,
  'robot-agent/hardware/sim_evaluator/evaluate_vla.py'
);

const VLA_SERVER_URL = process.env.VLA_SERVER_URL || 'http://localhost:8000';

// Stable on-disk location for simulation artifacts (survives reboots).
// Layout: <PROJECT_ROOT>/data/sim_runs/<jobId>/{frames/,results.json}
const SIM_RUNS_DIR = path.join(PROJECT_ROOT, 'data', 'sim_runs');

function jobFramesDir(jobId: string): string {
  return path.join(SIM_RUNS_DIR, jobId, 'frames');
}
function jobResultsPath(jobId: string): string {
  return path.join(SIM_RUNS_DIR, jobId, 'results.json');
}

// ============================================================================
// SERVICE
// ============================================================================

export class SimulationService extends EventEmitter {
  private static instance: SimulationService;
  private jobs: Map<string, SimJob> = new Map();
  private timers: Map<string, ReturnType<typeof setInterval>> = new Map();
  private processes: Map<string, ChildProcess> = new Map();

  private constructor() {
    super();
    // Fire-and-forget: load historical jobs from DB and mark any
    // queued/running entries as failed (their processes died with the
    // previous server). Any requests that arrive before this finishes
    // will still work — they just query the DB directly on cache miss.
    void this.loadFromDatabase();
  }

  static getInstance(): SimulationService {
    if (!SimulationService.instance) {
      SimulationService.instance = new SimulationService();
    }
    return SimulationService.instance;
  }

  private async loadFromDatabase(): Promise<void> {
    try {
      const failed = await simulationJobRepository.markFailedOnBoot();
      if (failed > 0) {
        console.log(`[SimulationService] Marked ${failed} orphaned job(s) as failed (server restart)`);
      }
      const jobs = await simulationJobRepository.findAll();
      for (const job of jobs) {
        this.jobs.set(job.jobId, job);
      }
      console.log(`[SimulationService] Loaded ${jobs.length} job(s) from database`);
    } catch (err) {
      console.error('[SimulationService] Failed to load jobs from database:', err);
    }
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

    // Persist to DB — fire-and-forget; the in-memory copy is authoritative
    // for live progress, the DB is updated on state transitions.
    void simulationJobRepository.create(job).catch((err) => {
      console.error(`[SimulationService] Failed to persist job ${job.jobId}:`, err);
    });

    this.emit('job:created', job);

    // Choose real or mock execution
    if (this.canRunReal()) {
      this.startRealJobProgression(job.jobId);
    } else {
      this.startMockJobProgression(job.jobId);
    }

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

    // Clear any running timer (mock mode)
    const timer = this.timers.get(jobId);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(jobId);
    }

    // Kill subprocess (real mode)
    const proc = this.processes.get(jobId);
    if (proc) {
      proc.kill('SIGTERM');
      this.processes.delete(jobId);
    }

    job.status = 'failed';
    job.updatedAt = new Date();
    console.log(`[SimulationService] Job cancelled: ${jobId}`);
    void simulationJobRepository
      .update(jobId, { status: 'failed', failureReason: 'cancelled' })
      .catch((err) => console.error(`[SimulationService] Failed to persist cancel for ${jobId}:`, err));
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

  /**
   * Get the frames directory path for a job
   */
  getFramesDir(jobId: string): string | null {
    const job = this.jobs.get(jobId);
    return job?.framesDir ?? null;
  }

  /**
   * Get (or generate) an environment preview image path.
   * Returns null if the preview script is not available.
   */
  async getEnvironmentPreview(envId: string): Promise<string | null> {
    const previewPath = `/tmp/sim_preview_${envId}.jpg`;

    if (existsSync(previewPath)) {
      return previewPath;
    }

    // Generate preview via Python script
    const previewScript = path.resolve(
      path.dirname(EVALUATOR_SCRIPT),
      'render_preview.py'
    );
    if (!existsSync(previewScript)) {
      return null;
    }

    return new Promise((resolve) => {
      const proc = spawn('uv', ['run', 'python',
        previewScript,
        '--output', previewPath,
      ], {
        cwd: path.dirname(previewScript),
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      proc.stderr?.on('data', (data: Buffer) => {
        console.log(`[SimPreview] ${data.toString().trim()}`);
      });

      proc.on('close', (code) => {
        if (code === 0 && existsSync(previewPath)) {
          resolve(previewPath);
        } else {
          console.error(`[SimPreview] Preview generation failed with code ${code}`);
          resolve(null);
        }
      });

      proc.on('error', (err) => {
        console.error(`[SimPreview] Spawn error:`, err);
        resolve(null);
      });
    });
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
  // INTERNAL: REAL JOB EXECUTION (MuJoCo subprocess)
  // ==========================================================================

  /**
   * Check if real MuJoCo evaluation is available
   */
  private canRunReal(): boolean {
    if (process.env.SIMULATION_BACKEND === 'mock') {
      return false;
    }
    return existsSync(EVALUATOR_SCRIPT);
  }

  /**
   * Run a real MuJoCo evaluation via Python subprocess
   */
  private startRealJobProgression(jobId: string): void {
    const job = this.jobs.get(jobId);
    if (!job) return;

    const outputPath = jobResultsPath(jobId);
    const framesDir = jobFramesDir(jobId);

    // Ensure the run directory exists for the Python subprocess to write into.
    try {
      mkdirSync(framesDir, { recursive: true });
    } catch (err) {
      console.error(`[SimulationService] Failed to create frames dir ${framesDir}:`, err);
    }

    // Transition to running
    job.status = 'running';
    job.framesDir = framesDir;
    job.updatedAt = new Date();
    console.log(`[SimulationService] Job running (real): ${jobId}`);
    void simulationJobRepository
      .update(jobId, { status: 'running', framesDir })
      .catch((err) => console.error(`[SimulationService] Failed to persist running for ${jobId}:`, err));
    this.emit('job:running', job);

    const proc = spawn('uv', ['run', 'python',
      EVALUATOR_SCRIPT,
      '--vla-server', VLA_SERVER_URL,
      '--environment', job.environment,
      '--episodes', String(job.rolloutCount),
      '--max-steps', '200',
      '--task', 'Pick up the red cube and place it on the target.',
      '--output', outputPath,
      '--frames-dir', framesDir,
    ], {
      cwd: path.dirname(EVALUATOR_SCRIPT),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this.processes.set(jobId, proc);

    // Parse stdout JSON lines for progress updates
    if (proc.stdout) {
      const rl = createInterface({ input: proc.stdout });
      rl.on('line', (line) => {
        try {
          const msg = JSON.parse(line);
          const current = this.jobs.get(jobId);
          if (!current || current.status !== 'running') return;

          if (msg.type === 'progress') {
            current.progress = msg.percent;
            current.updatedAt = new Date();
          }
        } catch {
          // Non-JSON output (log lines from Python), ignore
        }
      });
    }

    // Log stderr
    if (proc.stderr) {
      const rl = createInterface({ input: proc.stderr });
      rl.on('line', (line) => {
        console.log(`[SimEval:${jobId.slice(0, 8)}] ${line}`);
      });
    }

    // Handle process exit
    proc.on('close', (code) => {
      this.processes.delete(jobId);
      const current = this.jobs.get(jobId);
      if (!current || current.status !== 'running') return;

      if (code === 0 && existsSync(outputPath)) {
        try {
          const raw = readFileSync(outputPath, 'utf-8');
          const parsed = JSON.parse(raw);
          // Extract frames from output, rest is metrics
          const { frames, ...metrics } = parsed;
          current.metrics = metrics as SimMetrics;
          current.frames = frames as SimFrame[] | undefined;
          current.status = 'completed';
          current.progress = 100;
          current.updatedAt = new Date();
          console.log(`[SimulationService] Job completed (real): ${jobId}, frames=${frames?.length ?? 0}`);
          void simulationJobRepository
            .update(jobId, { status: 'completed', progress: 100, metrics: current.metrics })
            .then(() =>
              current.frames && current.frames.length > 0
                ? simulationJobRepository.createFrames(jobId, current.frames)
                : undefined
            )
            .catch((err) =>
              console.error(`[SimulationService] Failed to persist completion for ${jobId}:`, err)
            );
          this.emit('job:completed', current);
        } catch (err) {
          current.status = 'failed';
          current.updatedAt = new Date();
          console.error(`[SimulationService] Failed to parse results for ${jobId}:`, err);
          void simulationJobRepository
            .update(jobId, { status: 'failed', failureReason: 'parse error' })
            .catch((e) => console.error(`[SimulationService] Failed to persist parse-fail for ${jobId}:`, e));
          this.emit('job:failed', current);
        }
      } else {
        current.status = 'failed';
        current.updatedAt = new Date();
        console.error(`[SimulationService] Evaluator exited with code ${code} for ${jobId}`);
        void simulationJobRepository
          .update(jobId, { status: 'failed', failureReason: `evaluator exit ${code}` })
          .catch((err) => console.error(`[SimulationService] Failed to persist exit-fail for ${jobId}:`, err));
        this.emit('job:failed', current);
      }
    });

    proc.on('error', (err) => {
      this.processes.delete(jobId);
      const current = this.jobs.get(jobId);
      if (current) {
        current.status = 'failed';
        current.updatedAt = new Date();
        console.error(`[SimulationService] Evaluator spawn error for ${jobId}:`, err);
        void simulationJobRepository
          .update(jobId, { status: 'failed', failureReason: `spawn error: ${err.message}` })
          .catch((e) => console.error(`[SimulationService] Failed to persist spawn-fail for ${jobId}:`, e));
        this.emit('job:failed', current);
      }
    });
  }

  // ==========================================================================
  // INTERNAL: MOCK JOB PROGRESSION (fallback)
  // ==========================================================================

  private startMockJobProgression(jobId: string): void {
    const job = this.jobs.get(jobId);
    if (!job) return;

    console.log(`[SimulationService] Job running (mock): ${jobId}`);

    // Transition to running after 1s
    setTimeout(() => {
      const j = this.jobs.get(jobId);
      if (!j || j.status !== 'queued') return;

      j.status = 'running';
      j.updatedAt = new Date();
      void simulationJobRepository
        .update(jobId, { status: 'running' })
        .catch((err) => console.error(`[SimulationService] Failed to persist running (mock) for ${jobId}:`, err));
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
          current.updatedAt = new Date();
          console.log(`[SimulationService] Job completed (mock): ${jobId}`);
          void simulationJobRepository
            .update(jobId, { status: 'completed', progress: 100, metrics: current.metrics })
            .catch((err) =>
              console.error(`[SimulationService] Failed to persist mock completion for ${jobId}:`, err)
            );
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
   * Stop all running timers and processes (for graceful shutdown / tests)
   */
  cleanup(): void {
    for (const [, timer] of this.timers) {
      clearInterval(timer);
    }
    this.timers.clear();

    for (const [, proc] of this.processes) {
      proc.kill('SIGTERM');
    }
    this.processes.clear();

    this.jobs.clear();
  }
}

export const simulationService = SimulationService.getInstance();
