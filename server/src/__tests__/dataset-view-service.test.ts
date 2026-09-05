/**
 * @file dataset-view-service.test.ts
 * @description The resolver a dataset view lives or dies by (TASK-240):
 *   composition over three levels, frame ranges that compose and clip, the
 *   cycle and depth guards that keep a corrupt chain from hanging a request,
 *   freeze idempotency, and the counts a card shows without opening a file.
 * @feature datasets
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

vi.mock('../database/index.js', () => ({
  prisma: {
    dataset: { findUnique: vi.fn(), update: vi.fn() },
  },
}));

vi.mock('../services/EpisodeCurationService.js', () => ({
  episodeCurationService: {
    deleteEpisodes: vi.fn(async () => ({ ok: true })),
    trimEpisode: vi.fn(async () => ({ ok: true })),
  },
}));

import {
  DatasetViewService,
  MAX_VIEW_DEPTH,
  isDatasetView,
} from '../services/DatasetViewService.js';
import type { DatasetSelection, SelectedEpisode } from '../types/dataset-view.types.js';
import { prisma as _prisma } from '../database/index.js';
import { episodeCurationService as _curation } from '../services/EpisodeCurationService.js';

const prisma = _prisma as unknown as {
  dataset: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
};
const curation = _curation as unknown as {
  deleteEpisodes: ReturnType<typeof vi.fn>;
  trimEpisode: ReturnType<typeof vi.fn>;
};

// ---------------------------------------------------------------------------
// A stand-in for the Dataset table
// ---------------------------------------------------------------------------

interface Row {
  id: string;
  name: string;
  kind: string;
  parentDatasetId: string | null;
  selectionJson: string | null;
  frozenAt: Date | null;
  storagePath: string;
  materializedPath: string | null;
  demonstrationCount: number;
}

const rows = new Map<string, Row>();

function root(id: string, demonstrationCount: number, storagePath = `/data/${id}`): Row {
  const row: Row = {
    id,
    name: `dataset ${id}`,
    kind: 'materialized',
    parentDatasetId: null,
    selectionJson: null,
    frozenAt: null,
    storagePath,
    materializedPath: null,
    demonstrationCount,
  };
  rows.set(id, row);
  return row;
}

function selection(episodes: SelectedEpisode[]): DatasetSelection {
  return { episodes, origin: { kind: 'manual' } };
}

function view(id: string, parentDatasetId: string, episodes: SelectedEpisode[]): Row {
  const row: Row = {
    id,
    name: `view ${id}`,
    kind: 'view',
    parentDatasetId,
    selectionJson: JSON.stringify(selection(episodes)),
    frozenAt: null,
    storagePath: '',
    materializedPath: null,
    demonstrationCount: episodes.length,
  };
  rows.set(id, row);
  return row;
}

/**
 * A root whose files really exist: `materialize` cross-checks the row's
 * `demonstrationCount` against the dataset's own `meta/info.json`, and the
 * no-op-trim check reads `meta/episodes.jsonl`, so the tests for both need a
 * directory rather than a path-shaped string.
 */
const tempRoots: string[] = [];

async function rootDir(options: {
  totalEpisodes?: number;
  lengths?: number[];
}): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'dataset-view-root-'));
  tempRoots.push(dir);
  await mkdir(path.join(dir, 'meta'), { recursive: true });
  if (options.totalEpisodes !== undefined) {
    await writeFile(
      path.join(dir, 'meta', 'info.json'),
      JSON.stringify({ codebase_version: 'v2.1', fps: 30, total_episodes: options.totalEpisodes }),
    );
  }
  if (options.lengths) {
    await writeFile(
      path.join(dir, 'meta', 'episodes.jsonl'),
      options.lengths
        .map((length, episode_index) => JSON.stringify({ episode_index, length, tasks: [] }))
        .join('\n') + '\n',
    );
  }
  return dir;
}

/** A fresh service every test — the singleton holds no state, but the store does. */
function service(): DatasetViewService {
  return new DatasetViewService();
}

beforeEach(() => {
  rows.clear();
  vi.clearAllMocks();
  prisma.dataset.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
    const row = rows.get(where.id);
    return row ? { ...row } : null;
  });
  prisma.dataset.update.mockImplementation(
    async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
      const row = rows.get(where.id);
      if (!row) throw new Error(`no such row ${where.id}`);
      Object.assign(row, data);
      return { ...row };
    },
  );
  curation.deleteEpisodes.mockResolvedValue({ ok: true });
  curation.trimEpisode.mockResolvedValue({ ok: true });
});

afterEach(async () => {
  for (const dir of tempRoots.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// resolve
// ---------------------------------------------------------------------------

describe('DatasetViewService.resolve', () => {
  it('resolves a materialized dataset to itself, with no filter', async () => {
    root('ds-root', 10);
    const resolved = await service().resolve('ds-root');
    expect(resolved).toEqual({
      rootDatasetId: 'ds-root',
      episodes: [],
      isView: false,
      depth: 0,
      viewChain: [],
    });
  });

  it('composes three levels of views down to root episode indices', async () => {
    root('ds-root', 10);
    // Child indices are POSITIONS in the parent's list, not parent episode ids.
    view('v1', 'ds-root', [{ episodeIndex: 2 }, { episodeIndex: 4 }, { episodeIndex: 6 }, { episodeIndex: 8 }]);
    view('v2', 'v1', [{ episodeIndex: 1 }, { episodeIndex: 3 }]); // → root 4, 8
    view('v3', 'v2', [{ episodeIndex: 1 }]); // → root 8

    expect((await service().resolve('v1')).episodes).toEqual([
      { episodeIndex: 2 },
      { episodeIndex: 4 },
      { episodeIndex: 6 },
      { episodeIndex: 8 },
    ]);
    expect((await service().resolve('v2')).episodes).toEqual([
      { episodeIndex: 4 },
      { episodeIndex: 8 },
    ]);

    const resolved = await service().resolve('v3');
    expect(resolved).toEqual({
      rootDatasetId: 'ds-root',
      episodes: [{ episodeIndex: 8 }],
      isView: true,
      depth: 3,
      viewChain: ['v3', 'v2', 'v1'],
    });
  });

  it('lists a view\u2019s episodes in parent order, not the order the selection names them', async () => {
    root('ds-root', 6, '/data/root');
    view('v1', 'ds-root', [{ episodeIndex: 5 }, { episodeIndex: 1 }]);

    // `curate.py delete` keeps the survivors in ascending source order, so the
    // materialized view is [root 1, root 5]. A resolver that preserved the
    // click order would present [65, 61] frames for a directory holding
    // [61, 65] and number them the other way round.
    const resolved = await service().resolve('v1');
    expect(resolved.episodes).toEqual([{ episodeIndex: 1 }, { episodeIndex: 5 }]);

    await service().materialize('v1', '/out');
    const deleted = curation.deleteEpisodes.mock.calls[0]![2] as number[];
    const kept = [0, 1, 2, 3, 4, 5].filter((i) => !deleted.includes(i));
    expect(resolved.episodes.map((ep) => ep.episodeIndex)).toEqual(kept);
  });

  it('resolves a child index against the order its parent materializes to', async () => {
    root('ds-root', 6, '/data/root');
    view('v1', 'ds-root', [{ episodeIndex: 5 }, { episodeIndex: 1 }]);
    view('v2', 'v1', [{ episodeIndex: 0 }]);

    // Episode 0 of a materialized v1 is root episode 1 — the ascending first,
    // not the one the parent's selection happens to list first.
    expect((await service().resolve('v2')).episodes).toEqual([{ episodeIndex: 1 }]);
  });

  it('composes a trim through a parent whose selection is out of order', async () => {
    root('ds-root', 6, '/data/root');
    view('v1', 'ds-root', [{ episodeIndex: 4, start: 10 }, { episodeIndex: 2 }]);
    // Positions in the parent's parent-ordered list: 0 is root 2, 1 is root 4.
    view('v2', 'v1', [{ episodeIndex: 1, start: 5, end: 20 }]);

    expect((await service().resolve('v2')).episodes).toEqual([
      { episodeIndex: 4, start: 15, end: 30 },
    ]);
  });

  it('shifts a child frame range into the parent window and clips it', async () => {
    root('ds-root', 3);
    view('v1', 'ds-root', [{ episodeIndex: 1, start: 10, end: 100 }]);
    // Child frames are relative to the parent's already-trimmed episode.
    view('v2', 'v1', [{ episodeIndex: 0, start: 5, end: 20 }]);
    // …and an end past the parent's window is clipped to it, not honoured.
    view('v3', 'v1', [{ episodeIndex: 0, start: 5, end: 500 }]);

    expect((await service().resolve('v2')).episodes).toEqual([
      { episodeIndex: 1, start: 15, end: 30 },
    ]);
    expect((await service().resolve('v3')).episodes).toEqual([
      { episodeIndex: 1, start: 15, end: 100 },
    ]);
  });

  it('carries an open-ended parent range through a child that closes it', async () => {
    root('ds-root', 3);
    view('v1', 'ds-root', [{ episodeIndex: 2, start: 4 }]);
    view('v2', 'v1', [{ episodeIndex: 0, start: 1, end: 6 }]);

    expect((await service().resolve('v2')).episodes).toEqual([
      { episodeIndex: 2, start: 5, end: 10 },
    ]);
  });

  it('refuses a child range that does not overlap its parent window', async () => {
    root('ds-root', 3);
    view('v1', 'ds-root', [{ episodeIndex: 0, start: 10, end: 20 }]);
    view('v2', 'v1', [{ episodeIndex: 0, start: 15, end: 18 }]); // 25 >= 20

    await expect(service().resolve('v2')).rejects.toMatchObject({ code: 'VIEW_EMPTY_RANGE' });
  });

  it('refuses an index the parent list does not have', async () => {
    root('ds-root', 10);
    view('v1', 'ds-root', [{ episodeIndex: 3 }, { episodeIndex: 7 }]);
    view('v2', 'v1', [{ episodeIndex: 2 }]);

    await expect(service().resolve('v2')).rejects.toMatchObject({
      code: 'VIEW_EPISODE_OUT_OF_RANGE',
      statusCode: 400,
    });
  });

  it('refuses a view that selects nothing', async () => {
    root('ds-root', 10);
    view('v1', 'ds-root', []);
    await expect(service().resolve('v1')).rejects.toMatchObject({
      code: 'VIEW_EMPTY_SELECTION',
    });
  });

  it('refuses a view whose parent row is gone', async () => {
    view('v1', 'ds-missing', [{ episodeIndex: 0 }]);
    await expect(service().resolve('v1')).rejects.toMatchObject({ statusCode: 404 });
  });
});

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

describe('DatasetViewService cycle and depth guards', () => {
  it('refuses a two-node cycle instead of walking it forever', async () => {
    view('a', 'b', [{ episodeIndex: 0 }]);
    view('b', 'a', [{ episodeIndex: 0 }]);
    await expect(service().resolve('a')).rejects.toMatchObject({ code: 'VIEW_CYCLE' });
  });

  it('refuses a view that is its own parent', async () => {
    view('a', 'a', [{ episodeIndex: 0 }]);
    await expect(service().resolve('a')).rejects.toMatchObject({ code: 'VIEW_CYCLE' });
  });

  it('refuses a longer cycle that does not include the starting row', async () => {
    view('a', 'b', [{ episodeIndex: 0 }]);
    view('b', 'c', [{ episodeIndex: 0 }]);
    view('c', 'b', [{ episodeIndex: 0 }]);
    await expect(service().resolve('a')).rejects.toMatchObject({ code: 'VIEW_CYCLE' });
  });

  it('resolves a chain exactly at the depth cap and refuses one past it', async () => {
    root('ds-root', 1);
    // deepest → shallowest: v0's parent is the root, vN's parent is vN-1.
    view('v0', 'ds-root', [{ episodeIndex: 0 }]);
    for (let i = 1; i <= MAX_VIEW_DEPTH; i += 1) {
      view(`v${i}`, `v${i - 1}`, [{ episodeIndex: 0 }]);
    }

    const atCap = await service().resolve(`v${MAX_VIEW_DEPTH - 1}`);
    expect(atCap.depth).toBe(MAX_VIEW_DEPTH);
    expect(atCap.episodes).toEqual([{ episodeIndex: 0 }]);

    await expect(service().resolve(`v${MAX_VIEW_DEPTH}`)).rejects.toMatchObject({
      code: 'VIEW_TOO_DEEP',
    });
  });

  it('refuses a row marked as a view with no parent or no selection', async () => {
    const orphan = view('v1', 'ds-root', [{ episodeIndex: 0 }]);
    orphan.parentDatasetId = null;
    await expect(service().resolve('v1')).rejects.toMatchObject({ code: 'VIEW_MALFORMED' });

    root('ds-root', 3);
    const noSelection = view('v2', 'ds-root', [{ episodeIndex: 0 }]);
    noSelection.selectionJson = null;
    await expect(service().resolve('v2')).rejects.toMatchObject({ code: 'VIEW_MALFORMED' });
  });

  it('does not follow a parent link on a materialized row', async () => {
    // A curated revision records where it came from; its bytes are its own.
    root('ds-root', 10);
    const revision = root('ds-rev', 8);
    revision.parentDatasetId = 'ds-root';

    const resolved = await service().resolve('ds-rev');
    expect(resolved.isView).toBe(false);
    expect(resolved.rootDatasetId).toBe('ds-rev');
    expect(isDatasetView(revision)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// derivedCounts
// ---------------------------------------------------------------------------

describe('DatasetViewService.derivedCounts', () => {
  const parent = { episodeLengths: [100, 200, 300, 400], fps: 20 };

  it('counts episodes, frames and seconds against a known parent', () => {
    const counts = service().derivedCounts(
      selection([{ episodeIndex: 1 }, { episodeIndex: 3 }]),
      parent,
    );
    expect(counts).toEqual({ demonstrationCount: 2, totalFrames: 600, totalDuration: 30 });
  });

  it('counts only the frames a trim keeps', () => {
    const counts = service().derivedCounts(
      selection([{ episodeIndex: 0, start: 20, end: 60 }, { episodeIndex: 2, start: 100 }]),
      parent,
    );
    // 40 frames + (300 - 100) = 240 frames at 20 fps.
    expect(counts).toEqual({ demonstrationCount: 2, totalFrames: 240, totalDuration: 12 });
  });

  it('clamps an end past the real episode length instead of inflating the count', () => {
    const counts = service().derivedCounts(selection([{ episodeIndex: 0, end: 9999 }]), parent);
    expect(counts.totalFrames).toBe(100);
  });

  it('reports seconds at a fractional fps without floating-point noise', () => {
    const counts = service().derivedCounts(selection([{ episodeIndex: 0 }]), {
      episodeLengths: [253],
      fps: 10.12,
    });
    expect(counts.totalDuration).toBe(25);
  });

  it('refuses an episode the parent does not have', () => {
    expect(() => service().derivedCounts(selection([{ episodeIndex: 9 }]), parent)).toThrow(
      /parent has 4 episode/,
    );
  });
});

// ---------------------------------------------------------------------------
// freeze
// ---------------------------------------------------------------------------

describe('DatasetViewService.freeze', () => {
  it('is idempotent: the second call returns the first call’s timestamp and writes nothing', async () => {
    root('ds-root', 5);
    view('v1', 'ds-root', [{ episodeIndex: 0 }]);

    const first = await service().freeze('v1');
    expect(first).toBeInstanceOf(Date);
    expect(prisma.dataset.update).toHaveBeenCalledTimes(1);

    const second = await service().freeze('v1');
    expect(second).toEqual(first);
    expect(prisma.dataset.update).toHaveBeenCalledTimes(1);
  });

  it('freezes the ancestor views too — editing the parent would edit the cited view', async () => {
    root('ds-root', 5);
    view('v1', 'ds-root', [{ episodeIndex: 0 }, { episodeIndex: 1 }]);
    view('v2', 'v1', [{ episodeIndex: 0 }]);

    await service().freeze('v2');
    expect(rows.get('v2')!.frozenAt).toBeInstanceOf(Date);
    expect(rows.get('v1')!.frozenAt).toBeInstanceOf(Date);
    expect(rows.get('ds-root')!.frozenAt).toBeNull();
  });

  it('is a no-op for a materialized dataset — its bytes are its episode set', async () => {
    root('ds-root', 5);
    expect(await service().freeze('ds-root')).toBeNull();
    expect(prisma.dataset.update).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// materialize
// ---------------------------------------------------------------------------

describe('DatasetViewService.materialize', () => {
  it('deletes the complement and trims by post-delete position', async () => {
    root('ds-root', 6, '/data/root');
    view('v1', 'ds-root', [
      { episodeIndex: 4, start: 10, end: 50 },
      { episodeIndex: 1 },
      { episodeIndex: 5 },
    ]);

    const out = await service().materialize('v1', '/data/views/v1');

    expect(out).toBe('/data/views/v1');
    expect(curation.deleteEpisodes).toHaveBeenCalledTimes(1);
    const [src, dst, deleted] = curation.deleteEpisodes.mock.calls[0]!;
    expect(src).toBe('/data/root');
    // Not the output: a trim pass follows, and every pass rebuilds the tree.
    expect(dst).toBe('/data/views/v1.step-0');
    expect(deleted).toEqual([0, 2, 3]);

    // curate.py renumbers what survives in ascending order, so root episode 4
    // is the SECOND of the kept [1, 4, 5] — position 1, not the 0 its place in
    // the selection would suggest.
    expect(curation.trimEpisode).toHaveBeenCalledTimes(1);
    const [tsrc, tdst, position, start, end] = curation.trimEpisode.mock.calls[0]!;
    expect(tsrc).toBe('/data/views/v1.step-0');
    expect(tdst).toBe('/data/views/v1');
    expect([position, start, end]).toEqual([1, 10, 50]);

    expect(rows.get('v1')!.materializedPath).toBe('/data/views/v1');
  });

  it('writes straight to the output when nothing is trimmed', async () => {
    root('ds-root', 4, '/data/root');
    view('v1', 'ds-root', [{ episodeIndex: 0 }, { episodeIndex: 3 }]);

    await service().materialize('v1', '/out');
    expect(curation.deleteEpisodes.mock.calls[0]![1]).toBe('/out');
    expect(curation.trimEpisode).not.toHaveBeenCalled();
  });

  it('materializes a view of a view against the root, not the intermediate', async () => {
    root('ds-root', 6, '/data/root');
    view('v1', 'ds-root', [{ episodeIndex: 1 }, { episodeIndex: 3 }, { episodeIndex: 5 }]);
    view('v2', 'v1', [{ episodeIndex: 2 }]);

    await service().materialize('v2', '/out');
    const [src, , deleted] = curation.deleteEpisodes.mock.calls[0]!;
    expect(src).toBe('/data/root');
    expect(deleted).toEqual([0, 1, 2, 3, 4]);
  });

  it('does not run curate.py twice for the same view', async () => {
    root('ds-root', 4, '/data/root');
    view('v1', 'ds-root', [{ episodeIndex: 0 }]);

    await service().materialize('v1', '/out');
    const again = await service().materialize('v1', '/elsewhere');
    expect(again).toBe('/out');
    expect(curation.deleteEpisodes).toHaveBeenCalledTimes(1);
  });

  it('refuses to copy a dataset that the view does not actually narrow', async () => {
    root('ds-root', 2, '/data/root');
    view('v1', 'ds-root', [{ episodeIndex: 0 }, { episodeIndex: 1 }]);
    await expect(service().materialize('v1', '/out')).rejects.toMatchObject({
      code: 'VIEW_IS_WHOLE_PARENT',
    });
  });

  it('refuses a selection that names one root episode twice', async () => {
    root('ds-root', 4, '/data/root');
    view('v1', 'ds-root', [{ episodeIndex: 1 }, { episodeIndex: 1 }]);
    await expect(service().materialize('v1', '/out')).rejects.toMatchObject({
      code: 'VIEW_DUPLICATE_EPISODE',
    });
  });

  it('refuses a plan built on a demonstrationCount the dataset on disk disagrees with', async () => {
    // Six episodes on disk, a row that still says four: the complement of
    // {0, 2} would be planned as [1, 3], and episodes 4 and 5 — which nobody
    // selected — would survive into a frozen experiment arm untouched.
    const dir = await rootDir({ totalEpisodes: 6 });
    root('ds-root', 4, dir);
    view('v1', 'ds-root', [{ episodeIndex: 0 }, { episodeIndex: 2 }]);

    await expect(service().materialize('v1', '/out')).rejects.toMatchObject({
      code: 'VIEW_ROOT_COUNT_STALE',
      statusCode: 400,
      // Both numbers named: neither is trustworthy on its own.
      message: expect.stringContaining('4 episode(s)'),
      context: { demonstrationCount: 4, totalEpisodes: 6 },
    });
    expect(curation.deleteEpisodes).not.toHaveBeenCalled();
  });

  it('plans against the dataset on disk when the row agrees with it', async () => {
    const dir = await rootDir({ totalEpisodes: 6 });
    root('ds-root', 6, dir);
    view('v1', 'ds-root', [{ episodeIndex: 0 }, { episodeIndex: 2 }]);

    await service().materialize('v1', '/out');
    expect(curation.deleteEpisodes.mock.calls[0]![2]).toEqual([1, 3, 4, 5]);
  });

  it('does not rebuild the dataset for a range that keeps the whole episode', async () => {
    const dir = await rootDir({ totalEpisodes: 3, lengths: [60, 61, 62] });
    root('ds-root', 3, dir);
    // `end` at the episode's own length is what a UI sends when nobody moved
    // the handle; trimming it would re-encode every frame to keep every frame.
    view('v1', 'ds-root', [{ episodeIndex: 0, end: 60 }, { episodeIndex: 2, end: 999 }]);

    await service().materialize('v1', '/out');
    expect(curation.trimEpisode).not.toHaveBeenCalled();
    expect(curation.deleteEpisodes.mock.calls[0]![1]).toBe('/out');

    vi.clearAllMocks();
    // …but a range that really removes frames is still a trim.
    view('v2', 'ds-root', [{ episodeIndex: 0, end: 59 }, { episodeIndex: 2 }]);
    await service().materialize('v2', '/out2');
    expect(curation.trimEpisode.mock.calls[0]!.slice(2, 5)).toEqual([0, 0, 59]);
  });

  it('refuses to materialize a dataset that is not a view', async () => {
    root('ds-root', 4);
    await expect(service().materialize('ds-root', '/out')).rejects.toMatchObject({
      code: 'VIEW_NOT_A_VIEW',
    });
  });
});
