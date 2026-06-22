/**
 * @file EpisodeCurationService.test.ts
 * @description Unit tests for EpisodeCurationService — argument construction,
 *   output parsing, and error handling around the curate.py subprocess.
 * @feature datasets
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock child_process.execFile so no real Python is spawned.
vi.mock('child_process', () => ({
  execFile: vi.fn(),
}));

import { execFile } from 'child_process';
import {
  EpisodeCurationService,
  episodeCurationService,
  type CurationResultSummary,
} from '../EpisodeCurationService.js';

type ExecCb = (
  err: Error | null,
  stdout: string,
  stderr: string,
) => void;

const mockedExecFile = vi.mocked(execFile);

/** Configure the mocked execFile to invoke its callback with the given values. */
function stubExec(err: Error | null, stdout: string, stderr = ''): void {
  mockedExecFile.mockImplementation(((..._args: unknown[]) => {
    const cb = _args[_args.length - 1] as ExecCb;
    cb(err, stdout, stderr);
    return undefined as never;
  }) as never);
}

/** Extract the args array passed to curate.py from the last execFile call. */
function lastArgs(): string[] {
  const call = mockedExecFile.mock.calls[mockedExecFile.mock.calls.length - 1];
  // execFile(file, args, options, cb) — args is index 1.
  return call[1] as string[];
}

const SUMMARY: CurationResultSummary = {
  ok: true,
  operation: 'delete',
  output: '/out/rev',
  total_episodes: 3,
  total_frames: 120,
  stats_recompute_required: true,
};

describe('EpisodeCurationService', () => {
  let service: EpisodeCurationService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = EpisodeCurationService.getInstance();
  });

  describe('getInstance', () => {
    it('returns a singleton', () => {
      expect(EpisodeCurationService.getInstance()).toBe(
        EpisodeCurationService.getInstance(),
      );
      expect(episodeCurationService).toBe(EpisodeCurationService.getInstance());
    });
  });

  describe('deleteEpisodes', () => {
    it('rejects an empty episode list without spawning the process', async () => {
      await expect(
        service.deleteEpisodes('/ds', '/out', []),
      ).rejects.toThrow('episodeIndices must not be empty');
      expect(mockedExecFile).not.toHaveBeenCalled();
    });

    it('builds delete args with comma-joined episode indices and parses output', async () => {
      stubExec(null, JSON.stringify(SUMMARY));

      const result = await service.deleteEpisodes('/ds', '/out', [0, 2, 5]);

      expect(result).toEqual(SUMMARY);
      const args = lastArgs();
      // First entry is the curate.py path; the rest are the CLI args.
      expect(args.slice(1)).toEqual([
        'delete',
        '--dataset', '/ds',
        '--output', '/out',
        '--episodes', '0,2,5',
      ]);
    });

    it('parses only the last line of multi-line stdout', async () => {
      stubExec(null, `progress log line\n${JSON.stringify(SUMMARY)}`);
      const result = await service.deleteEpisodes('/ds', '/out', [1]);
      expect(result.total_frames).toBe(120);
    });
  });

  describe('trimEpisode', () => {
    it('omits --end when end is null', async () => {
      stubExec(null, JSON.stringify({ ...SUMMARY, operation: 'trim' }));

      await service.trimEpisode('/ds', '/out', 4, 10, null);

      const args = lastArgs();
      expect(args.slice(1)).toEqual([
        'trim',
        '--dataset', '/ds',
        '--output', '/out',
        '--episode', '4',
        '--start', '10',
      ]);
      expect(args).not.toContain('--end');
    });

    it('includes --end when end is provided', async () => {
      stubExec(null, JSON.stringify({ ...SUMMARY, operation: 'trim' }));

      await service.trimEpisode('/ds', '/out', 4, 10, 50);

      const args = lastArgs();
      expect(args.slice(1)).toEqual([
        'trim',
        '--dataset', '/ds',
        '--output', '/out',
        '--episode', '4',
        '--start', '10',
        '--end', '50',
      ]);
    });

    it('includes --end when end is 0 (falsy but not null)', async () => {
      stubExec(null, JSON.stringify({ ...SUMMARY, operation: 'trim' }));

      await service.trimEpisode('/ds', '/out', 0, 0, 0);

      const args = lastArgs();
      expect(args).toContain('--end');
      expect(args[args.indexOf('--end') + 1]).toBe('0');
    });
  });

  describe('error handling', () => {
    it('rejects with parsed error message when the process fails', async () => {
      const failSummary = {
        ...SUMMARY,
        ok: false,
        error: 'bad dataset revision',
      };
      stubExec(new Error('exit 1'), JSON.stringify(failSummary));

      await expect(service.deleteEpisodes('/ds', '/out', [1])).rejects.toThrow(
        'curate.py failed: bad dataset revision',
      );
    });

    it('falls back to stderr when failure output is not parseable', async () => {
      stubExec(new Error('exit 1'), 'not json', 'python traceback here');

      await expect(service.deleteEpisodes('/ds', '/out', [1])).rejects.toThrow(
        'curate.py failed: python traceback here',
      );
    });

    it('rejects when there is no parseable output and no error', async () => {
      stubExec(null, 'not-json-at-all', 'stderr detail');

      await expect(service.deleteEpisodes('/ds', '/out', [1])).rejects.toThrow(
        'curate.py produced no parseable output: stderr detail',
      );
    });
  });
});
