/**
 * @file DatasetViewService.ts
 * @description The one place a dataset view is resolved. A view is a `Dataset`
 *   row with `kind = 'view'`, a `parentDatasetId` and a resolved episode
 *   selection — zero bytes copied. Walking that parent chain, composing the
 *   selections and turning the result into real files all happen here and
 *   nowhere else.
 * @feature datasets
 */

import { readFile, rm, writeFile } from 'fs/promises';
import path from 'path';
import { prisma } from '../database/index.js';
import { AppError, NotFoundError } from '../utils/errors.js';
import { episodeCurationService } from './EpisodeCurationService.js';
import type { CurationBackend } from './EpisodeCurationService.js';
import type {
  DatasetSelection,
  DerivedDatasetCounts,
  ParentEpisodeMetadata,
  ResolvedDatasetSelection,
  SelectedEpisode,
} from '../types/dataset-view.types.js';

/**
 * How many `parentDatasetId` hops `resolve` will walk before refusing.
 *
 * Not a performance limit — each hop is one indexed primary-key read. It is
 * the thing that turns a chain corrupted by a bad restore into an error
 * naming the dataset instead of a request that never answers. Sixteen nested
 * forks is already far past any real experiment tree; the cycle guard below
 * catches the loops, this catches the merely absurd.
 */
export const MAX_VIEW_DEPTH = 16;

/** Machine-readable reasons a view cannot be resolved or materialized. */
export type DatasetViewErrorCode =
  /** `parentDatasetId` leads back to a dataset already on the path. */
  | 'VIEW_CYCLE'
  /** The chain is longer than {@link MAX_VIEW_DEPTH}. */
  | 'VIEW_TOO_DEEP'
  /** `kind = 'view'` but `parentDatasetId` or `selectionJson` is missing. */
  | 'VIEW_MALFORMED'
  /** A selection entry names an episode its parent does not have. */
  | 'VIEW_EPISODE_OUT_OF_RANGE'
  /** A view that selects nothing is not a dataset. */
  | 'VIEW_EMPTY_SELECTION'
  /** A child frame range that does not overlap its parent's window. */
  | 'VIEW_EMPTY_RANGE'
  /** The operation only means something for a view, and this row is not one. */
  | 'VIEW_NOT_A_VIEW'
  /** Materializing this view would produce a byte-for-byte copy of its root. */
  | 'VIEW_IS_WHOLE_PARENT'
  /** The selection lists one parent episode more than once. */
  | 'VIEW_DUPLICATE_EPISODE'
  /** The root's `demonstrationCount` column disagrees with its `meta/info.json`. */
  | 'VIEW_ROOT_COUNT_STALE';

/** A view could not be resolved. 400: it describes a selection, not a server fault. */
export class DatasetViewError extends AppError {
  constructor(message: string, code: DatasetViewErrorCode, context?: Record<string, unknown>) {
    super(message, 400, code, context);
  }
}

/** The `Dataset` columns the resolver reads. Deliberately narrow. */
interface DatasetViewRow {
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

const VIEW_ROW_SELECT = {
  id: true,
  name: true,
  kind: true,
  parentDatasetId: true,
  selectionJson: true,
  frozenAt: true,
  storagePath: true,
  materializedPath: true,
  demonstrationCount: true,
} as const;

/** The chain a walk found: the views it passed through, and where it stopped. */
interface DatasetViewChain {
  /** The materialized dataset the bytes live in. */
  root: DatasetViewRow;
  /** Views from the requested row up to (not including) the root, child-most first. */
  views: DatasetViewRow[];
}

/** Options for {@link DatasetViewService.materialize}. */
export interface MaterializeOptions {
  /** Which `curate.py` backend reads the root directory. Default `native`. */
  backend?: CurationBackend;
}

/**
 * Is this row a view?
 *
 * `kind` is the authority, not the presence of a parent: a materialized
 * dataset may legitimately record what it was derived from (a curated
 * revision does) without its contents being an index into that parent.
 */
export function isDatasetView(row: { kind?: string | null }): boolean {
  return row.kind === 'view';
}

export class DatasetViewService {
  private static instance: DatasetViewService;

  static getInstance(): DatasetViewService {
    if (!DatasetViewService.instance) {
      DatasetViewService.instance = new DatasetViewService();
    }
    return DatasetViewService.instance;
  }

  // -------------------------------------------------------------------------
  // Resolution — the single walker
  // -------------------------------------------------------------------------

  /**
   * What this dataset actually means: which materialized dataset holds the
   * bytes, and which of its episodes (with frame ranges composed through every
   * intermediate view) belong to it.
   *
   * For a materialized dataset the answer is itself, `isView: false` and an
   * empty episode list — which means *the whole dataset*, never "a view that
   * selects nothing": an empty selection is refused here rather than quietly
   * resolving to zero episodes that a trainer would only discover at load time.
   *
   * Every consumer that reads dataset files goes through this. Nothing else in
   * the codebase walks `parentDatasetId` — three call sites that each learned
   * to do it would drift, and the drift would show up as a training run whose
   * data is not the data its report names.
   */
  async resolve(datasetId: string): Promise<ResolvedDatasetSelection> {
    const { root, views } = await this.walk(datasetId);

    if (views.length === 0) {
      return { rootDatasetId: root.id, episodes: [], isView: false, depth: 0, viewChain: [] };
    }

    // Compose nearest-to-root first: each view's indices are positions in the
    // list its PARENT resolves to, so the parent's list has to exist already.
    let episodes: SelectedEpisode[] = [];
    for (let i = views.length - 1; i >= 0; i -= 1) {
      const view = views[i]!;
      const selection = this.parseSelection(view);
      if (selection.episodes.length === 0) {
        throw new DatasetViewError(
          `View "${view.name}" (${view.id}) selects no episodes`,
          'VIEW_EMPTY_SELECTION',
          { datasetId: view.id },
        );
      }

      // Parent order, not the order the selection happens to list its picks
      // in — see `composeEpisode` for why that is the only order that survives
      // materialization.
      const entries = [...selection.episodes].sort((a, b) => a.episodeIndex - b.episodeIndex);

      if (i === views.length - 1) {
        // Innermost view: its indices are already the root's own episode indices.
        episodes = entries.map((ep) => normalizeEpisode(ep));
        continue;
      }
      const parentEpisodes = episodes;
      episodes = entries.map((child) => this.composeEpisode(view, child, parentEpisodes));
    }

    return {
      rootDatasetId: root.id,
      episodes,
      isView: true,
      depth: views.length,
      viewChain: views.map((v) => v.id),
    };
  }

  /**
   * Map one entry of a child view through its parent's resolved list.
   *
   * `episodeIndex` is a POSITION in that list, not the parent's own episode
   * index — a view's episodes are renumbered 0..n-1, exactly as materializing
   * it would renumber them, so "episode 3 of this view" means the fourth
   * episode of the list its parent resolves to.
   *
   * That list is in PARENT order, which is why `resolve` sorts each level's
   * entries before composing them and a selection's own order is not preserved
   * anywhere. `materialize` drives `curate.py delete`, which keeps the
   * survivors in ascending source order; a resolver that numbered a view by
   * the order somebody clicked its episodes in would hand index 0 to a
   * different episode than the directory a training run reads. One numbering
   * or the other had to give, and `curate.py`'s is the one written to disk.
   *
   * Frame ranges compose the same way: the child's `[start, end)` is relative
   * to the parent's already-trimmed episode, so it is shifted into the
   * parent's window and then clipped to it. An intersection that comes out
   * EMPTY is refused rather than kept as a zero-frame episode: a selection
   * whose episode contributes no frames still claims to be an episode, so
   * `derivedCounts` would report data that does not exist and a trainer would
   * fail somewhere far from the view that caused it. It can only happen when
   * the child was validated against a different parent than the one it now
   * has, which is worth an error naming both.
   */
  private composeEpisode(
    view: DatasetViewRow,
    child: SelectedEpisode,
    parentEpisodes: SelectedEpisode[],
  ): SelectedEpisode {
    const base = parentEpisodes[child.episodeIndex];
    if (!base) {
      throw new DatasetViewError(
        `View "${view.name}" (${view.id}) selects episode ${child.episodeIndex}, but its parent resolves to ${parentEpisodes.length} episode(s)`,
        'VIEW_EPISODE_OUT_OF_RANGE',
        { datasetId: view.id, episodeIndex: child.episodeIndex, parentCount: parentEpisodes.length },
      );
    }

    const parentStart = base.start ?? 0;
    const parentEnd = base.end;
    const childStart = child.start ?? 0;
    const start = parentStart + childStart;

    let end: number | undefined;
    if (child.end === undefined) {
      end = parentEnd;
    } else if (parentEnd === undefined) {
      end = start + (child.end - childStart);
    } else {
      end = Math.min(parentEnd, parentStart + child.end);
    }

    if ((parentEnd !== undefined && start >= parentEnd) || (end !== undefined && start >= end)) {
      throw new DatasetViewError(
        `View "${view.name}" (${view.id}) trims episode ${child.episodeIndex} to [${childStart}, ${child.end ?? '∞'}), which does not overlap its parent's window [${parentStart}, ${parentEnd ?? '∞'})`,
        'VIEW_EMPTY_RANGE',
        { datasetId: view.id, episodeIndex: child.episodeIndex, parentStart, parentEnd },
      );
    }

    return normalizeEpisode({ episodeIndex: base.episodeIndex, start, end });
  }

  /**
   * Walk `parentDatasetId` to the materialized root.
   *
   * The ONE walker. `resolve`, `freeze` and `materialize` all come through
   * here; nothing outside this file follows the edge.
   */
  private async walk(datasetId: string): Promise<DatasetViewChain> {
    const views: DatasetViewRow[] = [];
    // Seeded with the starting id so a row that is its own parent is a cycle
    // and not a one-step chain back to itself.
    const seen = new Set<string>([datasetId]);

    let current = await this.load(datasetId);
    while (isDatasetView(current)) {
      if (views.length >= MAX_VIEW_DEPTH) {
        throw new DatasetViewError(
          `Dataset ${datasetId} is nested more than ${MAX_VIEW_DEPTH} views deep`,
          'VIEW_TOO_DEEP',
          { datasetId, maxDepth: MAX_VIEW_DEPTH },
        );
      }
      const parentId = current.parentDatasetId;
      if (!parentId || !current.selectionJson) {
        throw new DatasetViewError(
          `Dataset ${current.id} is marked as a view but has no ${!parentId ? 'parent' : 'selection'}`,
          'VIEW_MALFORMED',
          { datasetId: current.id },
        );
      }
      if (seen.has(parentId)) {
        throw new DatasetViewError(
          `Dataset ${current.id} has a cyclic parent chain (${parentId} appears twice)`,
          'VIEW_CYCLE',
          { datasetId: current.id, parentDatasetId: parentId },
        );
      }
      seen.add(parentId);
      views.push(current);
      current = await this.load(parentId);
    }

    return { root: current, views };
  }

  private async load(datasetId: string): Promise<DatasetViewRow> {
    const row = (await prisma.dataset.findUnique({
      where: { id: datasetId },
      select: VIEW_ROW_SELECT,
    })) as DatasetViewRow | null;
    if (!row) throw new NotFoundError('Dataset', datasetId);
    return row;
  }

  private parseSelection(row: DatasetViewRow): DatasetSelection {
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.selectionJson ?? '');
    } catch {
      throw new DatasetViewError(
        `View ${row.id} has an unparseable selection`,
        'VIEW_MALFORMED',
        { datasetId: row.id },
      );
    }
    const selection = parsed as Partial<DatasetSelection> | null;
    if (!selection || !Array.isArray(selection.episodes)) {
      throw new DatasetViewError(
        `View ${row.id} has a selection without an episode list`,
        'VIEW_MALFORMED',
        { datasetId: row.id },
      );
    }
    return selection as DatasetSelection;
  }

  // -------------------------------------------------------------------------
  // Counts
  // -------------------------------------------------------------------------

  /**
   * What a view's card shows: its own episode, frame and second counts, from
   * the parent's episode metadata rather than by opening a dataset file.
   *
   * Pure on purpose — it takes the parent's numbers instead of fetching them,
   * so the arithmetic that decides what an experiment arm claims to contain
   * can be exercised without a database or a dataset on disk.
   */
  derivedCounts(selection: DatasetSelection, parent: ParentEpisodeMetadata): DerivedDatasetCounts {
    let totalFrames = 0;
    for (const ep of selection.episodes) {
      const length = parent.episodeLengths[ep.episodeIndex];
      if (length === undefined) {
        throw new DatasetViewError(
          `Selection names episode ${ep.episodeIndex}, but the parent has ${parent.episodeLengths.length} episode(s)`,
          'VIEW_EPISODE_OUT_OF_RANGE',
          { episodeIndex: ep.episodeIndex, parentCount: parent.episodeLengths.length },
        );
      }
      // Clamped to the real episode, not trusted: an `end` past the last frame
      // would otherwise inflate the count of a dataset nobody has opened.
      const start = Math.max(0, ep.start ?? 0);
      const end = Math.min(ep.end ?? length, length);
      totalFrames += Math.max(0, end - start);
    }
    return {
      demonstrationCount: selection.episodes.length,
      totalFrames,
      // Rounded to milliseconds: fps is a Float (10.12 fps is a real
      // recording), so the raw division ends in digits nobody wants on a card.
      totalDuration: parent.fps > 0 ? Number((totalFrames / parent.fps).toFixed(3)) : 0,
    };
  }

  // -------------------------------------------------------------------------
  // Freeze
  // -------------------------------------------------------------------------

  /**
   * Pin a view's contents, idempotently. Called for every view a training job
   * cites, at submission: after this, edits are refused and the caller
   * duplicates instead — copy-on-write at the metadata level.
   *
   * Freezes the whole ancestor chain, not just the row asked about. Editing
   * the PARENT of a cited view changes what the cited view resolves to just as
   * surely as editing the view itself, so a freeze that stopped at one row
   * would leave the run's data editable through the back door.
   *
   * @returns the view's `frozenAt` — the same value on every later call — or
   *   `null` when the dataset is not a view, because a materialized dataset's
   *   episode set is its bytes and nothing here can edit those.
   */
  async freeze(datasetId: string): Promise<Date | null> {
    const { views } = await this.walk(datasetId);
    if (views.length === 0) return null;

    const frozenAt = new Date();
    let result: Date | null = null;
    for (const view of views) {
      const existing = view.frozenAt;
      if (existing) {
        if (view.id === datasetId) result = existing;
        continue;
      }
      await prisma.dataset.update({ where: { id: view.id }, data: { frozenAt } });
      if (view.id === datasetId) result = frozenAt;
    }
    return result;
  }

  // -------------------------------------------------------------------------
  // Materialize — the escape hatch
  // -------------------------------------------------------------------------

  /**
   * Write a view's episodes to real files, for the consumer that genuinely
   * cannot take an episode filter (LeRobot itself, today).
   *
   * Drives the existing `curate.py`: one `delete` pass for everything the view
   * leaves out, then one `trim` pass per trimmed episode. Each pass rebuilds
   * the whole dataset directory — that is the cost this feature exists to
   * avoid, which is why it runs once per USED view and never once per created
   * one, and why the resulting path is cached on the row.
   *
   * The plan is built against the root dataset ON DISK, not against the row
   * that describes it — see {@link DatasetViewService.rootEpisodeCount}.
   *
   * @returns the directory that now holds the view's bytes.
   */
  async materialize(
    datasetId: string,
    outputPath: string,
    options?: MaterializeOptions,
  ): Promise<string> {
    const { root, views } = await this.walk(datasetId);
    if (views.length === 0) {
      throw new DatasetViewError(
        `Dataset ${datasetId} is not a view — its files already exist`,
        'VIEW_NOT_A_VIEW',
        { datasetId },
      );
    }
    const view = views[0]!;
    // Idempotent by design: a second run would write a byte-identical copy of
    // a directory that is already on disk. A caller that wants it elsewhere
    // clears `materializedPath` first.
    if (view.materializedPath) return view.materializedPath;

    const { episodes } = await this.resolve(datasetId);
    const backend: CurationBackend = options?.backend ?? 'native';

    const total = await this.rootEpisodeCount(root);
    const selected: number[] = [];
    for (const ep of episodes) {
      if (ep.episodeIndex < 0 || ep.episodeIndex >= total) {
        throw new DatasetViewError(
          `View ${view.id} selects episode ${ep.episodeIndex} of ${root.name}, which has ${total} episode(s)`,
          'VIEW_EPISODE_OUT_OF_RANGE',
          { datasetId: view.id, episodeIndex: ep.episodeIndex, parentCount: total },
        );
      }
      if (selected.includes(ep.episodeIndex)) {
        // curate.py cannot express "this episode twice", and neither can a
        // LeRobot dataset: episode_index is a key in its own metadata.
        throw new DatasetViewError(
          `View ${view.id} selects root episode ${ep.episodeIndex} more than once`,
          'VIEW_DUPLICATE_EPISODE',
          { datasetId: view.id, episodeIndex: ep.episodeIndex },
        );
      }
      selected.push(ep.episodeIndex);
    }

    const ascending = [...selected].sort((a, b) => a - b);
    const toDelete: number[] = [];
    for (let i = 0; i < total; i += 1) {
      if (!ascending.includes(i)) toDelete.push(i);
    }

    // A range that covers the whole episode is not a trim. `end` set to the
    // episode's own length is what a UI sends when nobody moved the handle,
    // and honouring it costs a full directory rebuild plus an ffmpeg re-encode
    // to produce the frames that were already there. Only dropped when the
    // length is actually known: an unreadable `meta/episodes.jsonl` leaves the
    // trim in the plan, which is slow rather than wrong.
    const rootLengths = episodes.some((ep) => (ep.start ?? 0) > 0 || ep.end !== undefined)
      ? await readDatasetEpisodeLengths(root.storagePath, total)
      : null;

    // `curate.py delete` renumbers what survives in ascending order, so an
    // episode's position AFTER the delete is its rank among the kept indices —
    // which is what `trim --episode` has to be given.
    const trims = episodes
      .filter((ep) => !coversWholeEpisode(ep, rootLengths?.[ep.episodeIndex]))
      .map((ep) => ({
        position: ascending.indexOf(ep.episodeIndex),
        start: ep.start ?? 0,
        end: ep.end ?? null,
      }));

    if (toDelete.length === 0 && trims.length === 0) {
      throw new DatasetViewError(
        `View ${view.id} selects every episode of ${root.name} untrimmed — materializing it would copy the dataset for nothing`,
        'VIEW_IS_WHOLE_PARENT',
        { datasetId: view.id },
      );
    }
    if (trims.length > 0 && backend === 'lerobot') {
      throw new DatasetViewError(
        `View ${view.id} trims ${trims.length} episode(s), which the lerobot backend cannot do yet (curate.py V3_TRIM_UNSUPPORTED)`,
        'VIEW_MALFORMED',
        { datasetId: view.id },
      );
    }

    type Step = (src: string, dst: string) => Promise<unknown>;
    const steps: Step[] = [];
    // Worded the way `curate.py` words its own `_curation.note`, because that
    // is what these lines replace when there is more than one of them.
    const passes: string[] = [];
    if (toDelete.length > 0) {
      steps.push((src, dst) =>
        episodeCurationService.deleteEpisodes(src, dst, toDelete, { backend }),
      );
      passes.push(`delete episodes [${toDelete.join(', ')}]`);
    }
    for (const trim of trims) {
      steps.push((src, dst) =>
        episodeCurationService.trimEpisode(src, dst, trim.position, trim.start, trim.end, {
          backend,
        }),
      );
      passes.push(
        `trim episode ${trim.position} to [${trim.start}, ${trim.end ?? 'end'})`,
      );
    }

    // Every pass writes a whole new directory, so all but the last go to a
    // scratch sibling of the output and are removed afterwards.
    const scratch: string[] = [];
    let src = root.storagePath;
    try {
      for (let i = 0; i < steps.length; i += 1) {
        const last = i === steps.length - 1;
        const dst = last ? outputPath : `${outputPath}.step-${i}`;
        if (!last) scratch.push(dst);
        await steps[i]!(src, dst);
        src = dst;
      }
    } finally {
      for (const dir of scratch) {
        await rm(dir, { recursive: true, force: true }).catch(() => undefined);
      }
    }

    // Every pass overwrites `meta/info.json._curation`, so a plan with a trim
    // ships an output whose recorded provenance is that last trim and nothing
    // else — the delete of the complement, which is the whole point of the
    // view, leaves no trace on disk at all. Restate the plan once the last
    // pass has written the output. A single-pass plan is left exactly as
    // `curate.py` wrote it: its note already names the delete, and that output
    // is byte-for-byte the one a bare `curate.py delete` produces, which is a
    // property the curation suite pins.
    if (passes.length > 1) {
      await this.recordPlanInInfo(outputPath, view, root, passes);
    }

    await prisma.dataset.update({
      where: { id: view.id },
      data: { materializedPath: outputPath },
    });
    return outputPath;
  }

  /**
   * How many episodes the root dataset REALLY has.
   *
   * `demonstrationCount` is a column, and a column goes stale — a dataset
   * re-recorded, re-imported or repaired in place leaves the row behind.
   * Everything `materialize` plans is built out of this number: it deletes
   * `0..total-1` minus the selection, so a `total` that is too small does not
   * fail, it silently KEEPS every episode past it. `curate.py` cannot catch
   * that — it validates the indices it is told to delete against the dataset's
   * own metadata and has no way to know what was meant to be kept — so a
   * frozen experiment arm ends up holding episodes nobody selected.
   *
   * The dataset's own `meta/info.json` therefore decides, and a disagreement
   * is an error naming both numbers rather than a quiet preference for either:
   * whichever of the two is right, a selection resolved against a row that
   * does not describe the files on disk was validated against nothing.
   *
   * An info.json that cannot be read at all is not a disagreement, and not a
   * silent failure either: `curate.py` opens that exact file on the next line
   * and refuses the dataset if it is missing.
   */
  private async rootEpisodeCount(root: DatasetViewRow): Promise<number> {
    const info = await readDatasetInfo(root.storagePath);
    const onDisk = info === null ? null : asEpisodeCount(info.total_episodes);
    if (onDisk === null) return root.demonstrationCount;
    if (onDisk !== root.demonstrationCount) {
      throw new DatasetViewError(
        `Dataset "${root.name}" (${root.id}) records ${root.demonstrationCount} episode(s), but its meta/info.json has ${onDisk} — the row is stale, so which episodes a view of it selects cannot be established`,
        'VIEW_ROOT_COUNT_STALE',
        {
          datasetId: root.id,
          demonstrationCount: root.demonstrationCount,
          totalEpisodes: onDisk,
        },
      );
    }
    return onDisk;
  }

  /**
   * Record the whole plan in the materialized dataset's `_curation`, so the
   * directory says what it is without the database next to it.
   *
   * Best-effort on purpose: the bytes are correct by the time this runs, and a
   * view that is already on disk is not one to throw away over a provenance
   * note. Merged into whatever the last pass wrote, so `curate.py`'s own
   * `stats_recompute_required` survives.
   */
  private async recordPlanInInfo(
    outputPath: string,
    view: DatasetViewRow,
    root: DatasetViewRow,
    passes: string[],
  ): Promise<void> {
    const infoPath = path.join(outputPath, 'meta', 'info.json');
    try {
      const info = JSON.parse(await readFile(infoPath, 'utf8')) as Record<string, unknown>;
      info._curation = {
        ...((info._curation as Record<string, unknown> | undefined) ?? {}),
        note: `materialize view ${view.id}: ${passes.join('; ')}`,
        passes,
        viewDatasetId: view.id,
        rootDatasetId: root.id,
        tool: 'curate.py',
      };
      await writeFile(infoPath, JSON.stringify(info, null, 2));
    } catch (err) {
      console.warn(
        `[DatasetViewService] materialized ${view.id}, but could not record the plan in ${infoPath}:`,
        err,
      );
    }
  }
}

/**
 * Drop the defaults, so an untrimmed episode is `{ episodeIndex }` and only a
 * real trim carries frame numbers — a manifest that shows a range is a
 * manifest where somebody trimmed something.
 */
function normalizeEpisode(ep: SelectedEpisode): SelectedEpisode {
  const out: SelectedEpisode = { episodeIndex: ep.episodeIndex };
  if (ep.start !== undefined && ep.start > 0) out.start = ep.start;
  if (ep.end !== undefined) out.end = ep.end;
  return out;
}

/** A non-negative integer episode count, or null for anything else. */
function asEpisodeCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

/** Does this selection entry keep every frame of its episode? */
function coversWholeEpisode(ep: SelectedEpisode, length: number | undefined): boolean {
  if ((ep.start ?? 0) > 0) return false;
  if (ep.end === undefined) return true;
  return length !== undefined && ep.end >= length;
}

/**
 * A dataset's own `meta/info.json`, or null when it cannot be read.
 *
 * Plain `fs`, deliberately. `materialize` hands `storagePath` straight to
 * `curate.py`, a subprocess that reads this same directory off this same disk,
 * so a root reachable only through the object store cannot be materialized at
 * all and a store-aware reader would only widen the gap between what is
 * checked and what is curated.
 */
async function readDatasetInfo(storagePath: string): Promise<Record<string, unknown> | null> {
  if (!storagePath) return null;
  try {
    const parsed: unknown = JSON.parse(
      await readFile(path.join(storagePath, 'meta', 'info.json'), 'utf8'),
    );
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Frames per episode from `meta/episodes.jsonl`, or null unless the file
 * describes all `total` episodes.
 *
 * All-or-nothing on purpose: the only thing this number can do is REMOVE work
 * (a trim that would keep every frame), so a partially read file that reported
 * a missing episode as length 0 would drop a real trim and ship frames the
 * view excluded. Null means "run every trim the selection asks for".
 */
async function readDatasetEpisodeLengths(
  storagePath: string,
  total: number,
): Promise<number[] | null> {
  if (!storagePath) return null;
  let text: string;
  try {
    text = await readFile(path.join(storagePath, 'meta', 'episodes.jsonl'), 'utf8');
  } catch {
    return null;
  }

  const byIndex = new Map<number, number>();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let row: { episode_index?: unknown; length?: unknown };
    try {
      row = JSON.parse(line) as { episode_index?: unknown; length?: unknown };
    } catch {
      return null;
    }
    const index = asEpisodeCount(row.episode_index);
    const length = asEpisodeCount(row.length);
    if (index === null || length === null || length === 0) return null;
    byIndex.set(index, length);
  }
  if (byIndex.size !== total) return null;

  const lengths: number[] = [];
  for (let i = 0; i < total; i += 1) {
    const length = byIndex.get(i);
    if (length === undefined) return null;
    lengths.push(length);
  }
  return lengths;
}

export const datasetViewService = DatasetViewService.getInstance();
