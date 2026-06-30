/**
 * @file CosmosSyntheticService.ts
 * @description Generate action-conditioned synthetic episodes via NVIDIA Cosmos 3
 *   (forward dynamics) and register the result as a real, training-ready Dataset.
 *
 *   Runs the TASK-175 pipeline `server/curation/cosmos3_synth.py`:
 *     1. `generate` — roll out N action-conditioned clips on the HF ZeroGPU Space.
 *     2. `convert`  — export a LeRobot v2.1 on-disk dataset.
 *     3. register   — create a `ready` Dataset row pointing at the local dataset
 *                     dir, tagged synthetic via `infoJson._synthetic`.
 *
 *   Jobs are tracked in-memory (one at a time — ZeroGPU quota is the bottleneck)
 *   with streamed progress parsed from the script's stdout. (TASK-178)
 * @feature training
 */

import { EventEmitter } from 'events';
import { spawn, type ChildProcess } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { readFile, rm } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { datasetRepository, robotTypeRepository } from '../repositories/index.js';
import type { CreateDatasetInput, LeRobotInfo, LeRobotStats } from '../types/vla.types.js';

// ============================================================================
// PATHS & CONSTANTS
// ============================================================================

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CURATION_DIR = path.resolve(__dirname, '../../curation');
const REPO_ROOT = path.resolve(__dirname, '../../..');
const SCRIPT_PATH = path.join(CURATION_DIR, 'cosmos3_synth.py');
const DATASET_SUBDIR = 'lerobot_cosmos_bridge'; // matches cosmos3_synth.py DATASET_DIR

const MAX_EPISODES = 8; // ZeroGPU PRO ~40 GPU-min/day; ~10-35s each
const MAX_PROMPT_LEN = 2000; // bound the user string that flows into subprocess argv
const LOG_TAIL = 80;
const EMBODIMENT = 'widowx_bridge';

const ACTIVE_STATUSES = ['queued', 'generating', 'converting', 'registering'] as const;
// Registration writes the Dataset row from local disk and is fast; once it
// begins, cancelling would orphan a half-written row, so it is non-cancellable.
const CANCELLABLE_STATUSES = ['queued', 'generating', 'converting'] as const;

/** Keep terminal jobs this long for UI history, then evict to bound memory. */
const JOB_TTL_MS = 6 * 60 * 60 * 1000;
/** Watchdog: kill a child that hasn't finished a phase in this long. */
const EXEC_TIMEOUT_MS = Number(process.env.COSMOS_SYNTH_TIMEOUT_MS) || 30 * 60 * 1000;
/** Grace before escalating SIGTERM → SIGKILL. */
const KILL_GRACE_MS = 5000;
/** Combined stdout+stderr ring buffer used for failure tails. */
const TAIL_BUFFER = 60;

// ============================================================================
// TYPES
// ============================================================================

export type CosmosJobStatus =
  | 'queued'
  | 'generating'
  | 'converting'
  | 'registering'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface CosmosSyntheticJob {
  id: string;
  status: CosmosJobStatus;
  /** Short human-readable phase label for the UI. */
  phase: string;
  /** 0-100. */
  progress: number;
  /** Requested episode count. */
  episodes: number;
  /** Optional task prompt override (else the script cycles its defaults). */
  prompt?: string;
  embodiment: string;
  /** Successfully generated clips so far. */
  generatedCount: number;
  /** Set once the dataset row is created. */
  datasetId?: string;
  datasetName?: string;
  error?: string;
  /** Tail of the script's stdout/stderr for the live console. */
  log: string[];
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface CosmosSyntheticConfig {
  /** Whether the generator can run (script present). */
  available: boolean;
  /** Whether an HF PRO token is configured server-side. */
  hasToken: boolean;
  embodiment: string;
  maxEpisodes: number;
  python: string;
  scriptPath: string;
  outRoot: string;
}

// ============================================================================
// SERVICE
// ============================================================================

class CosmosSyntheticService extends EventEmitter {
  private static instance: CosmosSyntheticService;

  private jobs = new Map<string, CosmosSyntheticJob>();
  private children = new Map<string, ChildProcess>();

  static getInstance(): CosmosSyntheticService {
    if (!CosmosSyntheticService.instance) {
      CosmosSyntheticService.instance = new CosmosSyntheticService();
    }
    return CosmosSyntheticService.instance;
  }

  // -------------------------------------------------------------------------
  // Config / introspection
  // -------------------------------------------------------------------------

  private get pythonBin(): string {
    if (process.env.COSMOS_SYNTH_PYTHON) return process.env.COSMOS_SYNTH_PYTHON;
    const venv = path.join(CURATION_DIR, '.venv', 'bin', 'python');
    return existsSync(venv) ? venv : 'python3';
  }

  private get outRoot(): string {
    return process.env.COSMOS_SYNTH_OUT
      ? path.resolve(process.env.COSMOS_SYNTH_OUT)
      : path.join(CURATION_DIR, 'cosmos3_out');
  }

  /** Resolve an HF PRO token from env or a known .env file. */
  private resolveToken(): string | undefined {
    if (process.env.HF_TOKEN) return process.env.HF_TOKEN;
    const candidates = [
      process.env.COSMOS_SYNTH_ENV,
      path.join(REPO_ROOT, 'scratch', 'cosmos3', '.env'),
      path.join(CURATION_DIR, '.env'),
    ].filter(Boolean) as string[];
    for (const file of candidates) {
      try {
        if (!existsSync(file)) continue;
        for (const raw of readFileSync(file, 'utf8').split('\n')) {
          const line = raw.trim();
          if (!line || line.startsWith('#') || !line.includes('=')) continue;
          const [k, ...rest] = line.split('=');
          if (k.trim() === 'HF_TOKEN') return rest.join('=').trim();
        }
      } catch {
        /* ignore unreadable candidate */
      }
    }
    return undefined;
  }

  getConfig(): CosmosSyntheticConfig {
    return {
      available: existsSync(SCRIPT_PATH),
      hasToken: !!this.resolveToken(),
      embodiment: EMBODIMENT,
      maxEpisodes: MAX_EPISODES,
      python: this.pythonBin,
      scriptPath: SCRIPT_PATH,
      outRoot: this.outRoot,
    };
  }

  getJob(id: string): CosmosSyntheticJob | undefined {
    return this.jobs.get(id);
  }

  listJobs(): CosmosSyntheticJob[] {
    return [...this.jobs.values()].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }

  private hasActiveJob(): boolean {
    return [...this.jobs.values()].some((j) =>
      (ACTIVE_STATUSES as readonly string[]).includes(j.status),
    );
  }

  // -------------------------------------------------------------------------
  // Job lifecycle
  // -------------------------------------------------------------------------

  /**
   * Kick off a generation job. Returns immediately; progress streams via the
   * in-memory job record (poll `getJob`). Throws on bad input / missing token /
   * a job already running (callers map these to 4xx).
   */
  generate(input: { episodes: number; prompt?: string }): CosmosSyntheticJob {
    if (!existsSync(SCRIPT_PATH)) {
      throw new ServiceError('unavailable', 'Cosmos generator script not found');
    }
    const episodes = Math.floor(input.episodes);
    if (!Number.isFinite(episodes) || episodes < 1 || episodes > MAX_EPISODES) {
      throw new ServiceError(
        'invalid',
        `episodes must be between 1 and ${MAX_EPISODES}`,
      );
    }
    const prompt = input.prompt?.trim() || undefined;
    if (prompt && prompt.length > MAX_PROMPT_LEN) {
      throw new ServiceError('invalid', `prompt must be ${MAX_PROMPT_LEN} characters or fewer`);
    }
    if (!this.resolveToken()) {
      throw new ServiceError(
        'no_token',
        'No HF PRO token configured (set HF_TOKEN or scratch/cosmos3/.env)',
      );
    }
    if (this.hasActiveJob()) {
      throw new ServiceError(
        'busy',
        'A synthetic generation job is already running (ZeroGPU quota is serial)',
      );
    }

    this.pruneJobs();
    const now = new Date().toISOString();
    const job: CosmosSyntheticJob = {
      id: uuidv4(),
      status: 'queued',
      phase: 'Queued',
      progress: 0,
      episodes,
      prompt,
      embodiment: EMBODIMENT,
      generatedCount: 0,
      log: [],
      createdAt: now,
      updatedAt: now,
    };
    this.jobs.set(job.id, job);
    this.emit('job', job);

    // Fire-and-forget; errors are captured onto the job record.
    void this.run(job).catch((err) => {
      this.fail(job, err instanceof Error ? err.message : String(err));
    });

    return job;
  }

  cancel(id: string): CosmosSyntheticJob | undefined {
    const job = this.jobs.get(id);
    if (!job) return undefined;
    // Terminal jobs and the (fast, non-cancellable) registering phase are no-ops.
    if (!(CANCELLABLE_STATUSES as readonly string[]).includes(job.status)) return job;
    this.killChild(id);
    this.update(job, { status: 'cancelled', phase: 'Cancelled' });
    // Best-effort: drop the partial output dir once the child is gone.
    setTimeout(() => {
      void rm(path.join(this.outRoot, id), { recursive: true, force: true }).catch(() => {});
    }, KILL_GRACE_MS + 1000).unref();
    return job;
  }

  /** SIGTERM the job's child, escalating to SIGKILL if it lingers. */
  private killChild(id: string): void {
    const child = this.children.get(id);
    if (!child) return;
    try {
      child.kill('SIGTERM');
    } catch {
      /* already gone */
    }
    setTimeout(() => {
      const still = this.children.get(id);
      if (still) {
        try {
          still.kill('SIGKILL');
        } catch {
          /* already gone */
        }
      }
    }, KILL_GRACE_MS).unref();
  }

  /** Evict terminal jobs older than the TTL so the in-memory map stays bounded. */
  private pruneJobs(): void {
    const cutoff = Date.now() - JOB_TTL_MS;
    for (const [id, j] of this.jobs) {
      const terminal = !(ACTIVE_STATUSES as readonly string[]).includes(j.status);
      if (terminal && Date.parse(j.completedAt ?? j.updatedAt) < cutoff) {
        this.jobs.delete(id);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Execution
  // -------------------------------------------------------------------------

  private async run(job: CosmosSyntheticJob): Promise<void> {
    const token = this.resolveToken();
    const jobDir = path.join(this.outRoot, job.id);
    this.update(job, {
      status: 'generating',
      phase: 'Generating frames',
      progress: 2,
      startedAt: new Date().toISOString(),
    });

    // --- 1. generate ---------------------------------------------------------
    const genArgs = ['--out', jobDir, 'generate', '--episodes', String(job.episodes)];
    if (job.prompt) genArgs.push('--prompt', job.prompt);
    let okCount = -1;
    let attempts = 0;
    const gen = await this.exec(job, genArgs, token, (line) => {
      // Attempt-start lines drive the progress bar (earliest feedback)...
      if (/^--\s+task175-bridge-\d+/.test(line)) {
        attempts = Math.min(attempts + 1, job.episodes);
        this.update(job, {
          progress: Math.min(56, 2 + Math.round((attempts / job.episodes) * 53)),
        });
      }
      // ...but generatedCount must reflect *successful* clips only (ok=True).
      if (/\bok=True\b/.test(line)) {
        this.update(job, { generatedCount: Math.min(job.generatedCount + 1, job.episodes) });
      }
      const done = line.match(/generate DONE:\s*(\d+)\s*\/\s*(\d+)/);
      if (done) okCount = parseInt(done[1], 10);
    });
    if ((job.status as string) === 'cancelled') return;
    if (gen.code !== 0) {
      return this.fail(job, `generate failed (exit ${gen.code}): ${gen.tail}`);
    }
    // Reconcile the counter with the authoritative final count from the script.
    if (okCount >= 0) {
      this.update(job, { generatedCount: Math.min(okCount, job.episodes) });
    }
    if (job.generatedCount < 1) {
      return this.fail(job, 'generate produced no successful clips');
    }
    okCount = job.generatedCount;

    // --- 2. convert ----------------------------------------------------------
    this.update(job, { status: 'converting', phase: 'Converting to LeRobot', progress: 60 });
    let converted = 0;
    const conv = await this.exec(job, ['--out', jobDir, 'convert'], token, (line) => {
      if (/^\s*ep\d+:/.test(line)) {
        converted += 1;
        this.update(job, {
          progress: Math.min(88, 60 + Math.round((converted / okCount) * 28)),
        });
      }
    });
    if ((job.status as string) === 'cancelled') return;
    if (conv.code !== 0) {
      return this.fail(job, `convert failed (exit ${conv.code}): ${conv.tail}`);
    }

    // --- 3. register as a Dataset -------------------------------------------
    this.update(job, { status: 'registering', phase: 'Registering dataset', progress: 92 });
    const datasetDir = path.join(jobDir, DATASET_SUBDIR);
    const dataset = await this.registerDataset(job, datasetDir);
    this.update(job, {
      status: 'completed',
      phase: 'Completed',
      progress: 100,
      datasetId: dataset.id,
      datasetName: dataset.name,
      completedAt: new Date().toISOString(),
    });
  }

  /** Spawn the python script, stream lines, resolve with exit code + stderr tail. */
  private exec(
    job: CosmosSyntheticJob,
    args: string[],
    token: string | undefined,
    onLine: (line: string) => void,
  ): Promise<{ code: number | null; tail: string }> {
    return new Promise((resolve) => {
      const child = spawn(this.pythonBin, [SCRIPT_PATH, ...args], {
        cwd: CURATION_DIR,
        env: { ...process.env, ...(token ? { HF_TOKEN: token } : {}) },
      });
      this.children.set(job.id, child);

      // Combined ring buffer across BOTH streams — the python script prints its
      // errors to stdout, so a stderr-only tail would surface an empty message.
      const combined: string[] = [];
      let timedOut = false;
      const handle = (chunk: Buffer) => {
        const text = chunk.toString();
        for (const line of text.split('\n')) {
          const trimmed = line.replace(/\s+$/, '');
          if (!trimmed) continue;
          this.appendLog(job, trimmed);
          combined.push(trimmed);
          if (combined.length > TAIL_BUFFER) combined.shift();
          try {
            onLine(trimmed);
          } catch {
            /* parser must never crash the stream */
          }
        }
      };
      const buildTail = (): string => {
        if (timedOut) return `timed out after ${Math.round(EXEC_TIMEOUT_MS / 1000)}s`;
        const errish = combined.filter((l) => /error|fail|traceback|exception/i.test(l));
        return (errish.length ? errish : combined).slice(-6).join(' | ');
      };

      const timer = setTimeout(() => {
        timedOut = true;
        this.appendLog(job, `phase timed out after ${Math.round(EXEC_TIMEOUT_MS / 1000)}s — killing child`);
        this.killChild(job.id);
      }, EXEC_TIMEOUT_MS);
      timer.unref();

      child.stdout?.on('data', (c: Buffer) => handle(c));
      child.stderr?.on('data', (c: Buffer) => handle(c));
      child.on('error', (err) => {
        clearTimeout(timer);
        this.appendLog(job, `spawn error: ${err.message}`);
        combined.push(err.message);
        this.children.delete(job.id);
        resolve({ code: -1, tail: buildTail() });
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        this.children.delete(job.id);
        resolve({ code: timedOut ? -2 : code, tail: buildTail() });
      });
    });
  }

  private async registerDataset(job: CosmosSyntheticJob, datasetDir: string) {
    const metaDir = path.join(datasetDir, 'meta');
    const info = JSON.parse(await readFile(path.join(metaDir, 'info.json'), 'utf8')) as
      Record<string, unknown> & Partial<LeRobotInfo>;

    let statsJson: LeRobotStats = {};
    try {
      const raw = JSON.parse(await readFile(path.join(metaDir, 'stats.json'), 'utf8'));
      statsJson = {
        observation: raw['observation.state'],
        action: raw['action'],
      };
    } catch {
      /* stats optional */
    }

    // Validate the generated metadata rather than silently registering a broken
    // `ready` dataset (0 frames / no features) on shape drift — fail the job.
    const fps = Number(info.fps);
    const totalFrames = Number(info.total_frames);
    const totalEpisodes = Number(info.total_episodes ?? job.generatedCount);
    if (!Number.isFinite(fps) || fps <= 0 || !Number.isFinite(totalFrames) || totalFrames <= 0) {
      throw new Error(
        `generated dataset metadata invalid (fps=${info.fps}, total_frames=${info.total_frames})`,
      );
    }
    if (!info.features || Object.keys(info.features).length === 0) {
      throw new Error('generated dataset metadata missing feature definitions');
    }
    const robotType = await this.ensureRobotType(info);

    const infoJson: LeRobotInfo = {
      ...info,
      _synthetic: true,
      _generator:
        info._generator ??
        'NVIDIA Cosmos 3 (forward dynamics) via Cosmos3-Action-Viewer',
    };

    const input: CreateDatasetInput = {
      name: this.datasetName(job),
      description:
        `Synthetic ${EMBODIMENT} episodes generated with NVIDIA Cosmos 3 ` +
        `forward dynamics (${totalEpisodes} episodes` +
        (job.prompt ? `, prompt: "${job.prompt}"` : '') +
        ').',
      robotTypeId: robotType.id,
      storagePath: datasetDir.endsWith('/') ? datasetDir : `${datasetDir}/`,
      lerobotVersion: info.codebase_version ?? 'v2.1',
      fps,
      totalFrames,
      totalDuration: fps > 0 ? Number((totalFrames / fps).toFixed(3)) : 0,
      demonstrationCount: totalEpisodes,
      infoJson,
      statsJson,
      status: 'ready',
    };
    return datasetRepository.create(input);
  }

  /** Find-or-create the bridge/WidowX robot type used by the generator. */
  private async ensureRobotType(info: { features?: Record<string, unknown> }) {
    const existing = await robotTypeRepository.findByName(EMBODIMENT);
    if (existing) return existing;
    const features = info.features ?? {};
    const cameras = Object.keys(features)
      .filter((k) => k.startsWith('observation.images.'))
      .map((k) => ({
        name: k.replace('observation.images.', ''),
        resolution: { width: 640, height: 480 },
        fov: 60,
      }));
    return robotTypeRepository.create({
      name: EMBODIMENT,
      manufacturer: 'Trossen Robotics',
      model: 'WidowX 250 (bridge)',
      actionDim: 7,
      proprioceptionDim: 7,
      cameras: cameras.length ? cameras : [{ name: 'image_0', resolution: { width: 640, height: 480 }, fov: 60 }],
      capabilities: ['manipulation', 'synthetic'],
    });
  }

  private datasetName(job: CosmosSyntheticJob): string {
    const stamp = job.createdAt.slice(0, 16).replace('T', ' ');
    return `Cosmos Synthetic — ${EMBODIMENT} (${job.episodes} ep, ${stamp})`;
  }

  // -------------------------------------------------------------------------
  // Job record helpers
  // -------------------------------------------------------------------------

  private update(job: CosmosSyntheticJob, patch: Partial<CosmosSyntheticJob>): void {
    Object.assign(job, patch, { updatedAt: new Date().toISOString() });
    this.emit('job', job);
  }

  private appendLog(job: CosmosSyntheticJob, line: string): void {
    job.log.push(line);
    if (job.log.length > LOG_TAIL) job.log.splice(0, job.log.length - LOG_TAIL);
    job.updatedAt = new Date().toISOString();
  }

  private fail(job: CosmosSyntheticJob, error: string): void {
    this.update(job, { status: 'failed', phase: 'Failed', error });
  }
}

/** Error carrying a machine-readable code so routes can pick the HTTP status. */
export class ServiceError extends Error {
  constructor(
    public code: 'invalid' | 'no_token' | 'busy' | 'unavailable',
    message: string,
  ) {
    super(message);
    this.name = 'ServiceError';
  }
}

export const cosmosSyntheticService = CosmosSyntheticService.getInstance();
