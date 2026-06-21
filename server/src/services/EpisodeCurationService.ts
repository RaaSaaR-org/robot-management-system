/**
 * @file EpisodeCurationService.ts
 * @description Interactive episode-level dataset curation (trim / delete) for the
 *   curation GUI. Shells out to the dependency-light Python tool
 *   `server/curation/curate.py`, which edits LeRobot v2.1 datasets non-destructively
 *   (always writes a new revision directory, never mutates the source).
 * @feature datasets
 */

import { execFile } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const CURATE_PY = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../curation/curate.py',
);
const PYTHON = process.env.CURATION_PYTHON ?? 'python3';

export interface CurationResultSummary {
  ok: boolean;
  operation: string;
  output: string;
  total_episodes: number;
  total_frames: number;
  stats_recompute_required: boolean;
  error?: string;
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
  ): Promise<CurationResultSummary> {
    if (episodeIndices.length === 0) {
      throw new Error('episodeIndices must not be empty');
    }
    return this.run([
      'delete',
      '--dataset', datasetPath,
      '--output', outputPath,
      '--episodes', episodeIndices.join(','),
    ]);
  }

  /** Trim a single episode to the frame range [start, end), new revision at `outputPath`. */
  async trimEpisode(
    datasetPath: string,
    outputPath: string,
    episodeIndex: number,
    start: number,
    end: number | null,
  ): Promise<CurationResultSummary> {
    const args = [
      'trim',
      '--dataset', datasetPath,
      '--output', outputPath,
      '--episode', String(episodeIndex),
      '--start', String(start),
    ];
    if (end != null) args.push('--end', String(end));
    return this.run(args);
  }

  private run(args: string[]): Promise<CurationResultSummary> {
    return new Promise((resolve, reject) => {
      execFile(PYTHON, [CURATE_PY, ...args], { maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
        const text = (stdout || '').trim();
        let parsed: CurationResultSummary | null = null;
        if (text) {
          try {
            parsed = JSON.parse(text.split('\n').pop() as string);
          } catch {
            /* fall through to error handling */
          }
        }
        if (err) {
          const message = parsed?.error ?? stderr ?? err.message;
          return reject(new Error(`curate.py failed: ${message}`));
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
