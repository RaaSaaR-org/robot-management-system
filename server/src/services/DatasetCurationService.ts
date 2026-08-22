/**
 * @file DatasetCurationService.ts
 * @description Dataset-level orchestration for episode curation (TASK-168).
 *   Given a dataset id it resolves the on-disk source (local-disk dataset or
 *   RustFS download-to-tempdir), runs `curate.py` via EpisodeCurationService
 *   with the right backend for the dataset's LeRobot version, and registers the
 *   result as a NEW Dataset revision row (`<name> (curated)`) — the original
 *   dataset row and files are never touched. Lineage is persisted in
 *   `infoJson._curation` ({parentDatasetId, operation, params, timestamp, tool}).
 *
 *   Also exposes the Phase-2 "video-use" suggestion pass: motion heuristics
 *   from `curate.py suggest`, optionally enriched by a Gemini VLM pass when
 *   CURATION_VLM=gemini and GOOGLE_API_KEY are configured.
 * @feature datasets
 *
 * WHAT A v3.0 DATASET GETS, AND WHY (TASK-217). `curate.py` reads v2.1 — one
 * parquet and one mp4 per episode — so trim and suggest used to refuse a v3.0
 * dataset outright with `V3_TRIM_UNSUPPORTED` and `V3_SUGGEST_UNSUPPORTED`.
 * Since every dataset this platform writes is v3.0, the datasets it produced
 * were the ones it could not curate.
 *
 * The source is now resolved through `resolveLocalView`, which converts a v3.0
 * tree into a v2.1 view once and caches it. That makes the decision the task
 * asked to be made explicit:
 *
 *   A CURATED REVISION OF A v3.0 DATASET IS WRITTEN AS v2.1, and the original
 *   v3.0 dataset is untouched.
 *
 * Not because v2.1 is preferred — decision 1 of TASK-217 is that v3.0 is the
 * format we WRITE — but because the alternative is a v3.0-native trimmer, and
 * `curate.py` is the tested tool that exists. The revision is a new Dataset row
 * either way, so nothing is downgraded in place; what a v3.0 dataset gains is
 * that trimming it is possible at all. Re-aggregating a curated revision back
 * to v3.0 is its own task.
 */

import { existsSync } from 'fs';
import { resolveLlmProvider, type LlmProvider } from './llm/index.js';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'fs/promises';
import { execFile } from 'child_process';
import os from 'os';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { datasetRepository } from '../repositories/index.js';
import { getRustFSClient, isRustFSInitialized } from '../storage/rustfs-client.js';
import { BUCKETS } from '../storage/model-storage.js';
import { datasetService } from './DatasetService.js';
import { resolveLocalView } from './lerobot/LocalDatasetView.js';
import {
  episodeCurationService,
  type CurationBackend,
  type CurationResultSummary,
  type CurationSuggestion,
  type SuggestResultSummary,
} from './EpisodeCurationService.js';
import type { Dataset, LeRobotInfo, LeRobotStats } from '../types/vla.types.js';

// ============================================================================
// TYPES
// ============================================================================

export type CurationOperation =
  | { type: 'delete'; episodes: number[] }
  | { type: 'trim'; episode: number; start: number; end: number | null };

export interface DatasetCurationResult extends CurationResultSummary {
  datasetId: string;
  /** Set when the edit was registered as a new dataset revision row. */
  newDatasetId?: string;
  newDatasetName?: string;
}

export interface DatasetSuggestResult extends SuggestResultSummary {
  datasetId: string;
  /** True when the Gemini VLM pass refined the heuristic suggestions. */
  vlmEnriched?: boolean;
}

/** Curation failure with a machine-readable code (mapped to HTTP 400 by the routes). */
export class CurationError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'CurationError';
    this.code = code;
  }
}

interface ResolvedSource {
  /** Local directory holding the dataset (either the real dir or a temp download). */
  dir: string;
  mode: 'local' | 'rustfs';
  /** Temp root for rustfs mode (output dir lives next to the download). */
  tmpRoot?: string;
  cleanup: () => Promise<void>;
  /** Which curate.py backend can read `dir`, decided by what is IN `dir`. */
  backend: CurationBackend;
  /** What the dataset declared before the view was resolved. */
  sourceVersion: string;
  /** True when `dir` is a converted view rather than the dataset itself. */
  converted: boolean;
}

const NOOP_CLEANUP = async (): Promise<void> => {};
const VLM_MAX_SUGGESTIONS = 8;
const VLM_FRAMES_PER_EPISODE = 3;

// ============================================================================
// SERVICE
// ============================================================================

export class DatasetCurationService {
  private static instance: DatasetCurationService;

  static getInstance(): DatasetCurationService {
    if (!DatasetCurationService.instance) {
      DatasetCurationService.instance = new DatasetCurationService();
    }
    return DatasetCurationService.instance;
  }

  // --------------------------------------------------------------------------
  // Public API (used by curation.routes)
  // --------------------------------------------------------------------------

  async deleteEpisodes(
    datasetId: string,
    episodes: number[],
    explicitPath?: string,
  ): Promise<DatasetCurationResult> {
    return this.curate(datasetId, { type: 'delete', episodes }, explicitPath);
  }

  async trimEpisode(
    datasetId: string,
    episode: number,
    start: number,
    end: number | null,
    explicitPath?: string,
  ): Promise<DatasetCurationResult> {
    return this.curate(datasetId, { type: 'trim', episode, start, end }, explicitPath);
  }

  /**
   * Run the curation edit for a dataset id and register the result as a new
   * dataset revision. When no Dataset row exists (legacy/dev path-mode calls),
   * the edit still runs against the resolved path but no row is created.
   */
  async curate(
    datasetId: string,
    op: CurationOperation,
    explicitPath?: string,
  ): Promise<DatasetCurationResult> {
    const dataset = await this.findDataset(datasetId);
    const source = await this.resolveSource(datasetId, dataset, explicitPath);
    // From what is ON DISK after the view is resolved, not from the row: a
    // v3.0 dataset resolves to a v2.1 view, and asking the row would send it to
    // a backend that cannot read the directory it was handed.
    const backend = source.backend;
    try {
      const label = op.type === 'delete' ? 'del' : 'trim';
      const outDir =
        source.mode === 'local'
          ? `${source.dir}__${label}-${Date.now()}`
          : path.join(source.tmpRoot as string, 'out');

      let summary: CurationResultSummary;
      try {
        summary =
          op.type === 'delete'
            ? await episodeCurationService.deleteEpisodes(source.dir, outDir, op.episodes, { backend })
            : await episodeCurationService.trimEpisode(source.dir, outDir, op.episode, op.start, op.end, {
                backend,
              });
      } catch (error) {
        throw this.asCurationError(error);
      }

      if (!dataset) {
        // No DB row to derive a revision from — plain path-mode edit.
        return { datasetId, ...summary };
      }

      const revision = await this.registerRevision(dataset, op, outDir, source.mode, summary);
      return { datasetId, ...summary, ...revision };
    } finally {
      await source.cleanup();
    }
  }

  /**
   * Heuristic (optionally VLM-enriched) trim/delete suggestions for a dataset.
   * Read-only: never modifies anything. RustFS datasets only download parquet +
   * meta (videos are skipped — the heuristics don't need them).
   */
  async suggest(
    datasetId: string,
    opts?: { episode?: number; datasetPath?: string },
  ): Promise<DatasetSuggestResult> {
    const dataset = await this.findDataset(datasetId);

    const source = await this.resolveSource(datasetId, dataset, opts?.datasetPath, {
      skipVideos: true,
    });
    try {
      let result: SuggestResultSummary;
      try {
        result = await episodeCurationService.suggest(source.dir, opts?.episode);
      } catch (error) {
        throw this.asCurationError(error);
      }
      let suggestions = result.suggestions;
      let vlmEnriched = false;
      const vlm = suggestions.length > 0 ? this.vlmProvider() : null;
      if (vlm) {
        try {
          suggestions = await this.enrichWithVlm(suggestions, source.dir, vlm);
          vlmEnriched = true;
        } catch (error) {
          console.warn('[DatasetCuration] VLM enrichment failed, using heuristics only:', error);
        }
      }
      return { datasetId, ...result, suggestions, vlmEnriched };
    } finally {
      await source.cleanup();
    }
  }

  /**
   * curate.py failures carry a machine-readable `code` (FFMPEG_MISSING,
   * INVALID_EPISODES, EMPTY_SLICE, ...) that EpisodeCurationService attaches to
   * a plain Error. Re-wrap those as CurationError so the routes map them to
   * HTTP 400 with the code instead of an opaque 500.
   */
  private asCurationError(error: unknown): unknown {
    if (error instanceof Error && !(error instanceof CurationError)) {
      const code = (error as { code?: unknown }).code;
      if (typeof code === 'string' && code.length > 0) {
        return new CurationError(error.message, code);
      }
    }
    return error;
  }

  // --------------------------------------------------------------------------
  // Source resolution
  // --------------------------------------------------------------------------

  private async findDataset(datasetId: string): Promise<Dataset | null> {
    try {
      return await datasetRepository.findById(datasetId);
    } catch {
      return null; // no DB in some dev/test setups — legacy path-mode still works
    }
  }

  private backendFor(dataset: Dataset | null): CurationBackend {
    return dataset?.lerobotVersion?.startsWith('v3') ? 'lerobot' : 'native';
  }

  /** Local on-disk dataset convention (see datasets.routes.ts): absolute path that exists. */
  private isLocalDir(storagePath: string): boolean {
    if (!storagePath) return false;
    const normalized = storagePath.replace(/[\\/]+$/, '');
    return (
      (path.isAbsolute(normalized) || normalized.startsWith('/')) && existsSync(normalized)
    );
  }

  private async resolveSource(
    datasetId: string,
    dataset: Dataset | null,
    explicitPath?: string,
    opts?: { skipVideos?: boolean },
  ): Promise<ResolvedSource> {
    /**
     * Put the v2.1 view in front of whatever directory we ended up with.
     *
     * `curate.py` reads v2.1. A v3.0 directory is converted once and cached;
     * an already-v2.1 one is returned untouched, so nothing changes for the
     * datasets that worked before.
     */
    const viewOf = async (dir: string, rest: Omit<ResolvedSource, 'dir' | 'backend' | 'sourceVersion' | 'converted'>)
      : Promise<ResolvedSource> => {
      try {
        const view = await resolveLocalView(dir);
        return {
          ...rest,
          dir: view.root,
          backend: 'native',
          sourceVersion: view.sourceVersion,
          converted: view.converted,
        };
      } catch {
        // A directory with no readable `meta/info.json` is not something to
        // fail resolution over: `curate.py` will report what is wrong with it
        // far more usefully than a view resolver can.
        return { ...rest, dir, backend: 'native', sourceVersion: 'unknown', converted: false };
      }
    };

    if (explicitPath) {
      return viewOf(explicitPath, { mode: 'local', cleanup: NOOP_CLEANUP });
    }

    if (dataset) {
      const storagePath = dataset.storagePath ?? '';
      if (this.isLocalDir(storagePath)) {
        return viewOf(storagePath.replace(/[\\/]+$/, ''), { mode: 'local', cleanup: NOOP_CLEANUP });
      }
      if (!isRustFSInitialized()) {
        throw new Error(
          `dataset ${dataset.id} lives in object storage (prefix "${storagePath}") but RustFS is not available`,
        );
      }
      const tmpRoot = await mkdtemp(path.join(os.tmpdir(), 'neodem-curation-'));
      const dir = path.join(tmpRoot, 'src');
      await this.downloadPrefix(storagePath, dir, opts?.skipVideos ?? false);
      return viewOf(dir, {
        mode: 'rustfs',
        tmpRoot,
        cleanup: () => rm(tmpRoot, { recursive: true, force: true }),
      });
    }

    // Legacy/dev fallback: datasets living under CURATION_DATASETS_ROOT/:id.
    const root = process.env.CURATION_DATASETS_ROOT ?? '/tmp/neodem-datasets';
    return viewOf(path.join(root, datasetId), { mode: 'local', cleanup: NOOP_CLEANUP });
  }

  /** Download every object under `prefix` in TRAINING_DATASETS to `destDir`. */
  private async downloadPrefix(rawPrefix: string, destDir: string, skipVideos: boolean): Promise<void> {
    const client = getRustFSClient();
    // Normalize to a directory-style prefix so "ds1" cannot bleed into a
    // sibling prefix like "ds1-old/" (S3 listing is plain string-prefix based).
    const prefix = rawPrefix.endsWith('/') ? rawPrefix : `${rawPrefix}/`;
    let count = 0;
    for await (const obj of client.listAll(BUCKETS.TRAINING_DATASETS, prefix)) {
      const rel = obj.key.slice(prefix.length).replace(/^\/+/, '');
      if (!rel || rel.endsWith('/')) continue;
      if (skipVideos && rel.startsWith('videos/')) continue;
      const data = await client.download(BUCKETS.TRAINING_DATASETS, obj.key);
      const dest = path.join(destDir, rel);
      await mkdir(path.dirname(dest), { recursive: true });
      await writeFile(dest, data);
      count += 1;
    }
    if (count === 0) {
      throw new Error(
        `no objects found under prefix "${prefix}" in bucket ${BUCKETS.TRAINING_DATASETS}`,
      );
    }
  }

  // --------------------------------------------------------------------------
  // Revision registration
  // --------------------------------------------------------------------------

  private async registerRevision(
    parent: Dataset,
    op: CurationOperation,
    outDir: string,
    mode: 'local' | 'rustfs',
    summary: CurationResultSummary,
  ): Promise<{ newDatasetId: string; newDatasetName: string }> {
    // Persist lineage in the output info.json so it survives re-validation
    // (validateAndUpdateDataset re-reads infoJson from storage) and travels
    // with the files. This doubles as the audit record of the edit — the
    // ComplianceLog service is robot-session-scoped and doesn't fit datasets.
    const infoPath = path.join(outDir, 'meta', 'info.json');
    const info = JSON.parse(await readFile(infoPath, 'utf8')) as LeRobotInfo &
      Record<string, unknown>;
    info._curation = {
      ...((info._curation as Record<string, unknown> | undefined) ?? {}),
      parentDatasetId: parent.id,
      operation: op.type,
      params:
        op.type === 'delete'
          ? { episodes: op.episodes }
          : { episode: op.episode, start: op.start, end: op.end },
      timestamp: new Date().toISOString(),
      tool: 'curate.py',
    };
    await writeFile(infoPath, JSON.stringify(info, null, 2));

    const name = await this.uniqueCuratedName(parent.name);
    const fps = Number((info as { fps?: unknown }).fps) || parent.fps;
    const totalDuration = fps > 0 ? Number((summary.total_frames / fps).toFixed(3)) : 0;
    const description = `Curated revision of "${parent.name}" (${summary.operation}).`;
    const lerobotVersion =
      ((info as { codebase_version?: string }).codebase_version as string | undefined) ??
      parent.lerobotVersion;

    if (mode === 'local') {
      let statsJson: LeRobotStats = {};
      try {
        statsJson = JSON.parse(
          await readFile(path.join(outDir, 'meta', 'stats.json'), 'utf8'),
        ) as LeRobotStats;
      } catch {
        /* stats optional (e.g. --no-recompute-stats or lerobot backend) */
      }
      const row = await datasetRepository.create({
        name,
        description,
        robotTypeId: parent.robotTypeId,
        skillId: parent.skillId,
        storagePath: outDir,
        lerobotVersion,
        fps,
        totalFrames: summary.total_frames,
        totalDuration,
        demonstrationCount: summary.total_episodes,
        infoJson: info,
        statsJson,
        status: 'ready',
      });
      return { newDatasetId: row.id, newDatasetName: row.name };
    }

    // RustFS mode: upload the output tree under a fresh prefix, register the
    // row as `validating`, then run the standard validation path to fill
    // infoJson/statsJson and flip it to `ready`.
    const prefix = `${uuidv4()}/`;
    await this.uploadDir(outDir, prefix);
    const row = await datasetRepository.create({
      name,
      description,
      robotTypeId: parent.robotTypeId,
      skillId: parent.skillId,
      storagePath: prefix,
      lerobotVersion,
      fps,
      totalFrames: summary.total_frames,
      totalDuration,
      demonstrationCount: summary.total_episodes,
      infoJson: info,
      status: 'validating',
    });
    await datasetService.validateAndUpdateDataset(row.id, prefix);
    return { newDatasetId: row.id, newDatasetName: row.name };
  }

  /** Upload a directory tree to TRAINING_DATASETS under `prefix` (POSIX keys). */
  private async uploadDir(dir: string, prefix: string): Promise<void> {
    const client = getRustFSClient();
    const entries = await readdir(dir, { withFileTypes: true, recursive: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const abs = path.join(entry.parentPath ?? (entry as { path?: string }).path ?? dir, entry.name);
      const rel = path.relative(dir, abs).split(path.sep).join('/');
      const contentType = abs.endsWith('.json') || abs.endsWith('.jsonl')
        ? 'application/json'
        : abs.endsWith('.mp4')
          ? 'video/mp4'
          : 'application/octet-stream';
      await client.putObject(BUCKETS.TRAINING_DATASETS, `${prefix}${rel}`, await readFile(abs), {
        contentType,
      });
    }
  }

  /** `<name> (curated)`, with a counter appended when that name already exists. */
  private async uniqueCuratedName(parentName: string): Promise<string> {
    let existing = new Set<string>();
    try {
      const all = await datasetRepository.findAll({ page: 1, pageSize: 500 });
      existing = new Set(all.data.map((d) => d.name));
    } catch {
      /* best effort — DB may be unavailable in dev path-mode */
    }
    const base = `${parentName} (curated)`;
    if (!existing.has(base)) return base;
    for (let i = 2; i < 1000; i += 1) {
      const candidate = `${parentName} (curated ${i})`;
      if (!existing.has(candidate)) return candidate;
    }
    return `${parentName} (curated ${Date.now()})`;
  }

  // --------------------------------------------------------------------------
  // Optional VLM enrichment (CURATION_VLM=gemini|ollama|openrouter)
  // --------------------------------------------------------------------------

  /**
   * The gate stays opt-in via `CURATION_VLM`, but its value now names the
   * provider family rather than being pinned to Gemini. Credentials are checked
   * by the resolver, so a local Ollama needs only `CURATION_VLM=ollama`.
   *
   * Resolved once per curation run and handed to {@link enrichWithVlm}, so the
   * gate and the call that follows it cannot disagree — and the resolver logs
   * its choice once rather than twice.
   */
  private vlmProvider(): LlmProvider | null {
    const configured = process.env.CURATION_VLM?.trim().toLowerCase();
    if (!configured || configured === 'off' || configured === 'false') return null;

    return resolveLlmProvider({
      role: 'vision',
      modelOverride: process.env.CURATION_VLM_MODEL,
      credentialOrder: [configured as 'gemini' | 'ollama' | 'openrouter'],
      label: 'Curation VLM',
    });
  }

  /**
   * Refine heuristic suggestions with a VLM: sampled episode video frames (when
   * the dataset has local videos) + the heuristic verdict go in, a refined
   * reason/confidence comes back. Failures fall back to the pure heuristics.
   */
  private async enrichWithVlm(
    suggestions: CurationSuggestion[],
    datasetDir: string,
    provider: LlmProvider,
  ): Promise<CurationSuggestion[]> {
    let info: Record<string, unknown> = {};
    try {
      info = JSON.parse(await readFile(path.join(datasetDir, 'meta', 'info.json'), 'utf8'));
    } catch {
      /* frames become unavailable; text-only prompt still works */
    }

    const enriched: CurationSuggestion[] = [];
    for (const [i, suggestion] of suggestions.entries()) {
      if (i >= VLM_MAX_SUGGESTIONS) {
        enriched.push(suggestion);
        continue;
      }
      try {
        const frames = await this.sampleEpisodeFrames(datasetDir, info, suggestion.episode);
        const prompt =
          `You review one robot-teleoperation episode for dataset curation. ` +
          `A motion heuristic suggested: ${JSON.stringify(suggestion)}. ` +
          `${frames.length > 0 ? 'Sampled frames of the episode are attached. ' : ''}` +
          `Reply with strict JSON {"kind":"trim"|"delete","start":number?,"end":number?,` +
          `"reason":string,"confidence":number} refining or confirming the suggestion.`;
        const refined = await provider.generateJson<Partial<CurationSuggestion>>({
          prompt,
          images: frames.map((data) => ({ mimeType: 'image/jpeg', base64: data })),
        });
        enriched.push({
          ...suggestion,
          ...(refined.kind === 'trim' || refined.kind === 'delete' ? { kind: refined.kind } : {}),
          ...(typeof refined.start === 'number' ? { start: refined.start } : {}),
          ...(typeof refined.end === 'number' ? { end: refined.end } : {}),
          ...(typeof refined.reason === 'string' ? { reason: refined.reason } : {}),
          ...(typeof refined.confidence === 'number' ? { confidence: refined.confidence } : {}),
          vlm: true,
        });
      } catch {
        enriched.push(suggestion); // per-suggestion fallback to the heuristic
      }
    }
    return enriched;
  }

  /** Extract up to N evenly spaced JPEG frames (base64) from the episode's primary camera video. */
  private async sampleEpisodeFrames(
    datasetDir: string,
    info: Record<string, unknown>,
    episode: number,
  ): Promise<string[]> {
    const template = info.video_path as string | undefined;
    const features = (info.features ?? {}) as Record<string, { dtype?: string }>;
    const videoKey = Object.keys(features)
      .sort()
      .find((k) => features[k]?.dtype === 'video');
    if (!template || !videoKey) return [];

    const rel = template
      .replace('{episode_chunk:03d}', '000')
      .replace('{video_key}', videoKey)
      .replace('{episode_index:06d}', String(episode).padStart(6, '0'));
    const videoPath = path.join(datasetDir, rel);
    if (!existsSync(videoPath)) return [];

    const ffmpeg = process.env.CURATION_FFMPEG ?? 'ffmpeg';
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'neodem-vlm-frames-'));
    try {
      await new Promise<void>((resolve, reject) => {
        execFile(
          ffmpeg,
          [
            '-y', '-loglevel', 'error',
            '-i', videoPath,
            '-vf', `thumbnail,select='not(mod(n\\,10))'`,
            '-frames:v', String(VLM_FRAMES_PER_EPISODE),
            '-vsync', '0',
            path.join(tmp, 'f%02d.jpg'),
          ],
          (err) => (err ? reject(err) : resolve()),
        );
      });
      const files = (await readdir(tmp)).filter((f) => f.endsWith('.jpg')).sort();
      const frames: string[] = [];
      for (const f of files.slice(0, VLM_FRAMES_PER_EPISODE)) {
        frames.push((await readFile(path.join(tmp, f))).toString('base64'));
      }
      return frames;
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  }
}

export const datasetCurationService = DatasetCurationService.getInstance();
