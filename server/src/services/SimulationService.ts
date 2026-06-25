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
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  createWriteStream,
  rmSync,
} from 'fs';
import { tmpdir } from 'os';
import { pipeline } from 'stream/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { createInterface } from 'readline';
import { simulationJobRepository } from '../repositories/SimulationJobRepository.js';
import {
  simSceneRepository,
  digitalTwinRepository,
  twinZoneRepository,
  type SimSceneRecord,
} from '../repositories/index.js';
import { modelStorage } from '../storage/model-storage.js';
import {
  simToRealValidationService,
  type SimToRealComparisonRow,
} from './SimToRealValidationService.js';

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
  /** SimScene registry id (TASK-171); null for legacy `environment`-only jobs. */
  sceneId?: string;
  /** Robot embodiment to roll out (e.g. 'g1' | 'so101'); drives env selection. */
  embodiment?: string;
  /** Resolved local MJCF path passed to the evaluator as `--scene-file`. */
  sceneFile?: string;
  rolloutCount: number;
  backend: 'mujoco' | 'isaac';
  status: 'queued' | 'running' | 'completed' | 'failed';
  progress: number;
  /** Human-readable reason a job ended in `failed` (e.g. evaluator stderr tail). */
  failureReason?: string;
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
// Canonical real-to-sim converter. The server spawns its `generate` subcommand
// so the single world->MJCF transform stays defined only in Python (TASK-171).
const SCENE_BUILDER_SCRIPT = path.join(
  PROJECT_ROOT,
  'robot-agent/hardware/sim_evaluator/scene_builder.py'
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

/**
 * Turn an evaluator's stderr tail into a one-line, user-facing failure reason.
 * Prefers the most specific error line (exception/connection refused/missing
 * module) over a bare "exit N", so the Jobs tab can tell operators *why* a run
 * died (e.g. "VLA server unreachable") instead of an opaque exit code.
 */
function summarizeStderr(lines: string[], code: number | null): string {
  const base = `evaluator exit ${code ?? '?'}`;
  if (lines.length === 0) return base;
  // Walk from the end for the first line that looks like a real error.
  const signal = /(Error|Exception|Traceback|refused|Cannot reach|No module|Errno|Failed|Timeout)/i;
  const hit = [...lines].reverse().find((l) => signal.test(l)) ?? lines[lines.length - 1];
  const detail = hit.length > 240 ? `${hit.slice(0, 237)}…` : hit;
  return `${base}: ${detail}`;
}

/** Wall-clock cap on scene generation. CoACD convex decomposition (TASK-173)
 *  now runs inside this subprocess; it is bounded to seconds in practice
 *  (preprocess_resolution=40, max_convex_hull=64), so a minute is a generous
 *  kill-switch against a wedged native call rather than a normal limit. */
const SCENE_BUILDER_TIMEOUT_MS = 120_000;

/**
 * Spawn `uv run python scene_builder.py generate …` and resolve when it exits 0,
 * rejecting with a one-line reason (from its stderr tail) otherwise. Used by
 * generateSceneFromTwin to build a scene MJCF off the canonical converter.
 * Bounded by SCENE_BUILDER_TIMEOUT_MS so a wedged subprocess can't hold the
 * HTTP request (and the child) open indefinitely.
 */
function runSceneBuilder(
  args: string[],
  cwd: string,
  timeoutMs = SCENE_BUILDER_TIMEOUT_MS
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('uv', args, { cwd, stdio: ['ignore', 'ignore', 'pipe'] });
    const stderrTail: string[] = [];
    if (proc.stderr) {
      const rl = createInterface({ input: proc.stderr });
      rl.on('line', (line) => {
        const trimmed = line.trim();
        if (trimmed) {
          stderrTail.push(trimmed);
          if (stderrTail.length > 30) stderrTail.shift();
        }
      });
    }

    let timedOut = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGTERM');
      // Escalate to SIGKILL if it ignores the term signal.
      killTimer = setTimeout(() => proc.kill('SIGKILL'), 5_000);
    }, timeoutMs);
    const clearTimers = () => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
    };

    proc.on('error', (err) => {
      clearTimers();
      reject(new Error(`scene_builder spawn error: ${err.message}`));
    });
    proc.on('close', (code) => {
      clearTimers();
      if (timedOut) {
        reject(new Error(`scene_builder timed out after ${Math.round(timeoutMs / 1000)}s`));
      } else if (code === 0) {
        resolve();
      } else {
        reject(new Error(summarizeStderr(stderrTail, code)));
      }
    });
  });
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
    // Seed the built-in scenes into the SimScene registry (idempotent).
    void this.seedBuiltinScenes();
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
   * Submit a new simulation job against a built-in environment string (legacy).
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
    this.assertRolloutCount(rolloutCount);
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
      embodiment: environment.startsWith('so101') ? 'so101' : undefined,
      rolloutCount,
      backend,
      status: 'queued',
      progress: 0,
      createdAt: now,
      updatedAt: now,
    };

    return this.enqueueJob(job);
  }

  /**
   * Submit a job targeting a registered SimScene (built-in or twin-derived).
   * Resolves the scene's backend/embodiment and — for twin scenes — the MJCF
   * file the evaluator should load (TASK-171 Phase 2).
   */
  async submitJobForScene(modelId: string, sceneId: string, rolloutCount: number): Promise<SimJob> {
    if (!modelId) {
      throw new Error('modelId is required');
    }
    this.assertRolloutCount(rolloutCount);

    const scene = await simSceneRepository.findById(sceneId);
    if (!scene) {
      throw new Error(`Unknown scene: ${sceneId}`);
    }

    const now = new Date();
    const job: SimJob = {
      jobId: uuid(),
      modelId,
      // Keep a human-readable `environment` for back-compat: built-in scenes
      // use their stable env id, twin scenes a `twin:<id>` label.
      environment: scene.builtinEnvId ?? `twin:${scene.twinId}`,
      sceneId: scene.id,
      embodiment: scene.embodimentTag,
      rolloutCount,
      backend: scene.backend,
      status: 'queued',
      progress: 0,
      createdAt: now,
      updatedAt: now,
    };

    return this.enqueueJob(job);
  }

  private assertRolloutCount(rolloutCount: number): void {
    if (rolloutCount < 1 || rolloutCount > 10000) {
      throw new Error('rolloutCount must be between 1 and 10000');
    }
  }

  /** Register a built job, persist it, and kick off real/mock progression. */
  private enqueueJob(job: SimJob): SimJob {
    this.jobs.set(job.jobId, job);
    console.log(
      `[SimulationService] Job queued: ${job.jobId} (model=${job.modelId}, env=${job.environment}` +
        `${job.sceneId ? `, scene=${job.sceneId}` : ''})`,
    );

    // Persist to DB — fire-and-forget; the in-memory copy is authoritative
    // for live progress, the DB is updated on state transitions.
    void simulationJobRepository.create(job).catch((err) => {
      console.error(`[SimulationService] Failed to persist job ${job.jobId}:`, err);
    });

    this.emit('job:created', job);

    // Choose real or mock execution
    if (this.canRunReal()) {
      void this.startRealJobProgression(job.jobId);
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
   * Get all available simulation environments (legacy built-in list).
   */
  getAvailableEnvironments(): SimEnvironment[] {
    return [...AVAILABLE_ENVIRONMENTS];
  }

  /**
   * Get all registered simulation scenes — built-ins AND ready twin-derived
   * rooms (TASK-171). Replaces `getAvailableEnvironments` for the picker.
   */
  async getAvailableScenes(): Promise<SimSceneRecord[]> {
    return simSceneRepository.listAll();
  }

  /**
   * Idempotently seed the built-in scenes into the SimScene registry so the
   * picker has a stable baseline even before any twin is scanned.
   */
  private async seedBuiltinScenes(): Promise<void> {
    try {
      for (const env of AVAILABLE_ENVIRONMENTS) {
        await simSceneRepository.upsertBuiltin({
          builtinEnvId: env.id,
          name: env.name,
          description: env.description,
          embodimentTag: env.id.startsWith('so101') ? 'so101' : 'generic',
          backend: env.backend,
        });
      }
    } catch (err) {
      console.error('[SimulationService] Failed to seed built-in scenes:', err);
    }
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
   * Get sim-to-real comparison data for a model — the REAL measured gap from
   * persisted SimToRealValidation rows (TASK-171 Phase 3). An empty array means
   * the model has not been validated against a real robot yet.
   *
   * The previous `sim * random(0.7..0.9)` approximation has been removed: the
   * gap is now `simSuccessRate − realSuccessRate` measured by running the same
   * policy in the twin scene and on the real robot in that physical room.
   */
  async getSimToRealComparison(modelId: string): Promise<SimToRealComparisonRow[]> {
    return simToRealValidationService.getComparisonForModel(modelId);
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
  private async startRealJobProgression(jobId: string): Promise<void> {
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

    // For twin-derived scenes, download the MJCF into the evaluator's mjcf/
    // dir (so its relative <include> resolves) and pass it via --scene-file.
    if (job.sceneId) {
      try {
        job.sceneFile = await this.materializeSceneFile(job.sceneId, jobId);
      } catch (err) {
        console.error(`[SimulationService] Failed to materialize scene for ${jobId}:`, err);
      }
    }

    const isG1 = job.embodiment === 'g1' || job.embodiment === 'unitree_g1';
    const task = isG1
      ? 'Walk to the goal zone while avoiding keep-out areas.'
      : 'Pick up the red cube and place it on the target.';

    const args = [
      'run', 'python',
      EVALUATOR_SCRIPT,
      '--vla-server', VLA_SERVER_URL,
      '--environment', job.environment,
      '--episodes', String(job.rolloutCount),
      '--max-steps', '200',
      '--task', task,
      '--output', outputPath,
      '--frames-dir', framesDir,
    ];
    if (job.embodiment) {
      args.push('--embodiment', job.embodiment);
    }
    if (job.sceneFile) {
      args.push('--scene-file', job.sceneFile);
    }

    const proc = spawn('uv', args, {
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

    // Log stderr and keep a short tail so a failed job can report *why*.
    const stderrTail: string[] = [];
    if (proc.stderr) {
      const rl = createInterface({ input: proc.stderr });
      rl.on('line', (line) => {
        console.log(`[SimEval:${jobId.slice(0, 8)}] ${line}`);
        const trimmed = line.trim();
        if (trimmed) {
          stderrTail.push(trimmed);
          if (stderrTail.length > 30) stderrTail.shift();
        }
      });
    }

    // Handle process exit
    proc.on('close', (code) => {
      this.processes.delete(jobId);
      this.cleanupSceneFile(job.sceneFile);
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
        const reason = summarizeStderr(stderrTail, code);
        current.failureReason = reason;
        console.error(`[SimulationService] Evaluator exited with code ${code} for ${jobId}: ${reason}`);
        void simulationJobRepository
          .update(jobId, { status: 'failed', failureReason: reason })
          .catch((err) => console.error(`[SimulationService] Failed to persist exit-fail for ${jobId}:`, err));
        this.emit('job:failed', current);
      }
    });

    proc.on('error', (err) => {
      this.processes.delete(jobId);
      this.cleanupSceneFile(job.sceneFile);
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

  /**
   * Generate (or refresh) a MuJoCo scene for an existing twin on demand,
   * threading the twin's REAL occupancy floor-plan + semantic zones through the
   * canonical scene_builder so the room walls follow the scan (not just the
   * AABB box). Uploads `scene.mjcf.xml` as a twin artifact, records it on the
   * twin, and (up)registers the SimScene. Works even for twins built without
   * `ENABLE_SIM_SCENE` in the twin-builder. (TASK-171 fidelity follow-up.)
   */
  async generateSceneFromTwin(twinId: string): Promise<SimSceneRecord> {
    if (!twinId) {
      throw new Error('twinId is required');
    }
    const twin = await digitalTwinRepository.findById(twinId);
    if (!twin) {
      throw new Error(`Unknown twin: ${twinId}`);
    }
    const bounds = {
      minX: twin.minX, minY: twin.minY, minZ: twin.minZ,
      maxX: twin.maxX, maxY: twin.maxY, maxZ: twin.maxZ,
    };
    if (!(bounds.maxX > bounds.minX && bounds.maxY > bounds.minY)) {
      throw new Error(`Twin ${twinId} has no usable bounds (scan not complete?)`);
    }

    const workDir = mkdtempSync(path.join(tmpdir(), `twinscene-${twinId}-`));
    const outPath = path.join(workDir, 'scene.mjcf.xml');
    try {
      // Materialize the scanned room mesh (GLB) when present, so the builder can
      // convert + CoACD-decompose it into true convex collision geometry
      // (TASK-173). Degenerate/solid meshes are auto-rejected by the converter,
      // which then falls back to the occupancy floor-plan below — so we always
      // pass the occupancy too. Decomposed pieces are written to a host-local dir
      // (not workDir, which is deleted in finally) and the MJCF references them by
      // ABSOLUTE path. NOTE: only the MJCF is uploaded to durable storage, not the
      // OBJ pieces — so the generated scene resolves its mesh assets only on this
      // same host while twin_meshes/ persists. A job on another host (or after a
      // git-clean of the gitignored dir) fails fast in materializeSceneFile with a
      // "regenerate the scene" error rather than an opaque MuJoCo load failure.
      // Multi-host durability (uploading the OBJs as twin artifacts) is tracked in
      // TASK-172; today the real backend only runs on the single sim host.
      let meshPath: string | undefined;
      let meshOutDir: string | undefined;
      if (twin.meshKey) {
        meshPath = path.join(workDir, 'mesh.glb');
        await pipeline(
          await modelStorage.getTwinArtifactStream(twin.meshKey),
          createWriteStream(meshPath)
        );
        meshOutDir = path.join(
          path.dirname(SCENE_BUILDER_SCRIPT), 'mjcf', 'twin_meshes', twinId
        );
      }

      // Materialize the occupancy floor-plan locally when the twin has one, so
      // the builder extrudes real walls instead of falling back to the AABB box.
      let pgmPath: string | undefined;
      let yamlPath: string | undefined;
      if (twin.occupancyPgmKey) {
        pgmPath = path.join(workDir, 'occupancy.pgm');
        await pipeline(
          await modelStorage.getTwinArtifactStream(twin.occupancyPgmKey),
          createWriteStream(pgmPath)
        );
        if (twin.occupancyYamlKey) {
          yamlPath = path.join(workDir, 'occupancy.yaml');
          await pipeline(
            await modelStorage.getTwinArtifactStream(twin.occupancyYamlKey),
            createWriteStream(yamlPath)
          );
        }
      }

      // Semantic zones (charging→spawn, workcell→goal, keepout→penalty).
      const zones = await twinZoneRepository.listByTwin(twinId);
      const zonesPath = path.join(workDir, 'zones.json');
      writeFileSync(
        zonesPath,
        JSON.stringify(
          zones.map((z) => ({
            name: z.name,
            type: z.type,
            points: z.points.map((p) => [p.x, p.y]),
            minZ: z.minZ,
            maxZ: z.maxZ,
          }))
        )
      );

      const args = [
        'run', 'python', SCENE_BUILDER_SCRIPT, 'generate',
        '--aabb',
        String(bounds.minX), String(bounds.minY), String(bounds.minZ),
        String(bounds.maxX), String(bounds.maxY), String(bounds.maxZ),
        '--out', outPath,
        '--resolution', String(twin.resolution ?? 0.05),
        '--zones-json', zonesPath,
        '--embodiment', 'g1',
      ];
      if (meshPath) {
        args.push('--mesh', meshPath);
        if (meshOutDir) args.push('--mesh-out-dir', meshOutDir);
      }
      if (pgmPath) {
        args.push('--occupancy-pgm', pgmPath);
        if (yamlPath) args.push('--occupancy-yaml', yamlPath);
      }

      await runSceneBuilder(args, path.dirname(SCENE_BUILDER_SCRIPT));

      const mjcf = readFileSync(outPath);
      const mjcfKey = await modelStorage.uploadTwinArtifact(twinId, 'scene.mjcf.xml', mjcf);

      // Record on the twin so its DTO reports a sim scene, and register it.
      await digitalTwinRepository.update(twinId, {
        simSceneKey: mjcfKey,
        simSceneBackend: 'mujoco',
      });
      const scene = await simSceneRepository.upsertForTwin({
        twinId,
        name: `${twin.name} (scanned room)`,
        description: 'Twin-derived MuJoCo scene — Unitree G1 in the scanned room',
        embodimentTag: 'g1',
        backend: 'mujoco',
        mjcfKey,
        bounds,
        status: 'ready',
      });
      console.log(
        `[SimulationService] Generated SimScene for twin ${twinId}` +
          (pgmPath ? ' (occupancy floor-plan)' : ' (AABB perimeter fallback)')
      );
      return scene;
    } finally {
      try {
        rmSync(workDir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    }
  }

  /**
   * Download a twin scene's MJCF into the evaluator's mjcf/ directory so its
   * relative `<include file="g1/…">` resolves, returning the local path. The
   * file is unique per job and removed once the evaluator exits.
   */
  private async materializeSceneFile(sceneId: string, jobId: string): Promise<string | undefined> {
    const scene = await simSceneRepository.findById(sceneId);
    if (!scene || !scene.mjcfKey) return undefined;

    const mjcfDir = path.join(path.dirname(EVALUATOR_SCRIPT), 'mjcf');
    const dest = path.join(mjcfDir, `.twinscene_${jobId}.xml`);
    mkdirSync(mjcfDir, { recursive: true });
    const stream = await modelStorage.getTwinArtifactStream(scene.mjcfKey);
    await pipeline(stream, createWriteStream(dest));

    // The MJCF references decomposed room meshes (TASK-173) by ABSOLUTE path into
    // a host-local dir that is not uploaded to durable storage. Verify they exist
    // up front so a cross-host / git-cleaned scene fails with an actionable reason
    // instead of an opaque MuJoCo "file not found". (Relative `<include>` paths —
    // the G1 model + its meshes — resolve against mjcfDir and are not checked.)
    const mjcfText = readFileSync(dest, 'utf8');
    const missing = [...mjcfText.matchAll(/file="([^"]+)"/g)]
      .map((m) => m[1])
      .filter((f) => path.isAbsolute(f) && !existsSync(f));
    if (missing.length > 0) {
      this.cleanupSceneFile(dest);
      throw new Error(
        `Scene ${sceneId} references ${missing.length} missing mesh asset(s) ` +
          `(e.g. ${path.basename(missing[0])}); regenerate the scene for this twin.`
      );
    }

    console.log(`[SimulationService] Materialized scene ${sceneId} → ${dest}`);
    return dest;
  }

  /** Remove a per-job materialized scene file (best-effort). */
  private cleanupSceneFile(sceneFile?: string): void {
    if (!sceneFile) return;
    try {
      rmSync(sceneFile, { force: true });
    } catch {
      // best-effort cleanup
    }
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
