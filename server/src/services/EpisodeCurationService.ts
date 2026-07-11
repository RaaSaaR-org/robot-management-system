/**
 * @file EpisodeCurationService.ts
 * @description Interactive episode-level dataset curation (trim / delete / suggest)
 *   for the curation GUI. Shells out to the Python tool `server/curation/curate.py`,
 *   which edits LeRobot datasets non-destructively (always writes a new revision
 *   directory, never mutates the source).
 *
 *   Two backends: `native` (dependency-light pyarrow/pandas path for the
 *   one-parquet-per-episode v2.1 layout, interpreter from CURATION_PYTHON) and
 *   `lerobot` (v3.0 chunked/concatenated-video datasets via lerobot's own
 *   `dataset_tools.delete_episodes`, interpreter from CURATION_LEROBOT_PYTHON).
 * @feature datasets
 */

import { execFile } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const CURATE_PY = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../curation/curate.py',
);

export type CurationBackend = 'native' | 'lerobot';

export interface CurationResultSummary {
  ok: boolean;
  operation: string;
  output: string;
  total_episodes: number;
  total_frames: number;
  stats_recompute_required: boolean;
  backend?: CurationBackend;
  error?: string;
  code?: string;
}

/** One heuristic (or VLM-refined) curation suggestion for an episode. */
export interface CurationSuggestion {
  episode: number;
  kind: 'trim' | 'delete';
  start?: number;
  end?: number;
  reason: string;
  confidence: number;
  /** Set when a VLM pass refined this suggestion (CURATION_VLM=gemini). */
  vlm?: boolean;
}

export interface SuggestResultSummary {
  ok: boolean;
  operation: string;
  suggestions: CurationSuggestion[];
  params?: Record<string, number>;
  error?: string;
  code?: string;
}

export interface CurationRunOptions {
  backend?: CurationBackend;
}

/** Resolve the Python interpreter for a curation backend (read at call time so tests/env changes apply). */
function pythonFor(backend: CurationBackend): string {
  if (backend === 'lerobot') {
    const py = process.env.CURATION_LEROBOT_PYTHON;
    if (!py) {
      throw new Error(
        'v3.0 datasets are curated via the lerobot backend, but CURATION_LEROBOT_PYTHON is not set. ' +
          'Point it at a Python interpreter with lerobot>=0.6 installed.',
      );
    }
    return py;
  }
  return process.env.CURATION_PYTHON ?? 'python3';
}

export class EpisodeCurationService {
  private static instance: EpisodeCurationService;

  static getInstance(): EpisodeCurationService {
    if (!EpisodeCurationService.instance) {
      EpisodeCurationService.instance = new EpisodeCurationService();
    }
    return EpisodeCurationService.instance;
  }

  /** Delete whole episodes, producing a new dataset revision at `outputPath`. */
  async deleteEpisodes(
    datasetPath: string,
    outputPath: string,
    episodeIndices: number[],
    options?: CurationRunOptions,
  ): Promise<CurationResultSummary> {
    if (episodeIndices.length === 0) {
      throw new Error('episodeIndices must not be empty');
    }
    const backend = options?.backend ?? 'native';
    const args = [
      'delete',
      '--dataset', datasetPath,
      '--output', outputPath,
      '--episodes', episodeIndices.join(','),
    ];
    if (backend === 'lerobot') args.push('--backend', 'lerobot');
    return this.run<CurationResultSummary>(args, backend);
  }

  /** Trim a single episode to the frame range [start, end), new revision at `outputPath`. */
  async trimEpisode(
    datasetPath: string,
    outputPath: string,
    episodeIndex: number,
    start: number,
    end: number | null,
    options?: CurationRunOptions,
  ): Promise<CurationResultSummary> {
    const backend = options?.backend ?? 'native';
    const args = [
      'trim',
      '--dataset', datasetPath,
      '--output', outputPath,
      '--episode', String(episodeIndex),
      '--start', String(start),
    ];
    if (end != null) args.push('--end', String(end));
    if (backend === 'lerobot') args.push('--backend', 'lerobot');
    return this.run<CurationResultSummary>(args, backend);
  }

  /** Heuristic trim/delete suggestions for a dataset (or a single episode). Read-only. */
  async suggest(datasetPath: string, episodeIndex?: number): Promise<SuggestResultSummary> {
    const args = ['suggest', '--dataset', datasetPath];
    if (episodeIndex != null) args.push('--episode', String(episodeIndex));
    return this.run<SuggestResultSummary>(args, 'native');
  }

  private run<T extends { ok: boolean; error?: string }>(
    args: string[],
    backend: CurationBackend,
  ): Promise<T> {
    const python = pythonFor(backend);
    return new Promise((resolve, reject) => {
      execFile(python, [CURATE_PY, ...args], { maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
        const text = (stdout || '').trim();
        let parsed: T | null = null;
        if (text) {
          try {
            parsed = JSON.parse(text.split('\n').pop() as string);
          } catch {
            /* fall through to error handling */
          }
        }
        if (err) {
          const message = parsed?.error ?? stderr ?? err.message;
          const failure = new Error(`curate.py failed: ${message}`) as Error & { code?: string };
          const parsedCode = (parsed as { code?: string } | null)?.code;
          if (parsedCode) failure.code = parsedCode;
          return reject(failure);
        }
        if (!parsed) {
          return reject(new Error(`curate.py produced no parseable output: ${stderr || text}`));
        }
        resolve(parsed);
      });
    });
  }
}

export const episodeCurationService = EpisodeCurationService.getInstance();
