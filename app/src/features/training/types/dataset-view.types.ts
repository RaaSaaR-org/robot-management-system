/**
 * @file dataset-view.types.ts
 * @description Client-side shape of a dataset view — a named episode selection
 *   over a parent dataset that copies no bytes (TASK-240).
 * @feature training
 *
 * Mirrors `server/src/types/dataset-view.types.ts`. A view is a `Dataset` row
 * with `kind = 'view'`, a `parentDatasetId` and a resolved selection, so the
 * whole UI keeps rendering it with the components it already has — a view is
 * a dataset that happens to know which episodes of another one it means.
 */

/** One episode of the parent, optionally trimmed. */
export interface SelectedEpisode {
  /** Index in the PARENT. */
  episodeIndex: number;
  /** Inclusive frame, default 0. Relative to the parent episode's own frame 0. */
  start?: number;
  /** Exclusive frame, default the episode length. */
  end?: number;
}

/**
 * How a selection was arrived at — for humans and the audit trail, never for
 * re-running. `episodes` is the truth; this only records the rule.
 */
export type DatasetSelectionOrigin =
  | { kind: 'manual'; note?: string }
  | { kind: 'flags'; decision: 'keep' | 'remove' }
  | { kind: 'reward'; rewardType: 'robometer' | 'topreward'; minScore: number }
  | { kind: 'agent'; actorId: string; rationale: string };

/**
 * What a view selects out of its parent.
 *
 * The list is stored RESOLVED, never as a live query: a view built from
 * "reward >= 0.7" must not change meaning when a later reward job rewrites the
 * scores. Which is why this page builds the episode list from the evidence
 * currently on screen and sends it, rather than sending the threshold.
 */
export interface DatasetSelection {
  episodes: SelectedEpisode[];
  origin: DatasetSelectionOrigin;
}

/** The `kind` discriminator on a `Dataset` row. */
export type DatasetKind = 'materialized' | 'view';

/**
 * The parent facts a view's card needs to say "142 of 400 episodes".
 *
 * Optional on purpose: the grid already holds the parent row, and the detail
 * page fetches it, but a view rendered on its own can only say how many
 * episodes it selects — and says exactly that rather than inventing a total.
 */
export interface DatasetParentSummary {
  id: string;
  name: string;
  demonstrationCount?: number;
}

/**
 * A view as the views API returns it.
 *
 * Deliberately NOT a `Dataset`: the fields a view is interesting for — what it
 * was forked from, what it selects, whether a run has pinned it — do not exist
 * on a dataset, and the count a card renders ("142 of 400 episodes") needs the
 * parent's total beside the view's own. Mirrors the server's
 * `DatasetViewSummary`, with the two dates as the strings JSON makes of them.
 */
export interface DatasetViewSummary {
  id: string;
  name: string;
  description: string | null;
  kind: DatasetKind;
  status: string;
  fps: number;
  /** The row this view selects from — one hop, which may itself be a view. */
  parentDatasetId: string;
  parentName: string;
  /** How many episodes the parent has, so a card can say "142 of 400". */
  parentDemonstrationCount: number;
  /** The materialized dataset the bytes are in, at the end of the chain. */
  rootDatasetId: string;
  demonstrationCount: number;
  totalFrames: number;
  totalDuration: number;
  /** As stored: episode indices in the PARENT, plus how they were chosen. */
  selection: DatasetSelection;
  /** The same thing in the ROOT's episode indices, ranges composed. */
  resolvedEpisodes: SelectedEpisode[];
  /** Set once a training job cited this view; edits are refused after that. */
  frozenAt: string | null;
  /** Set only if `materialize` has ever written these episodes to disk. */
  materializedPath: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Body of `POST /api/datasets/:id/views`. */
export interface CreateDatasetViewInput {
  name: string;
  description?: string;
  selection: DatasetSelection;
}

/**
 * Is this row a view? Reads `kind` and nothing else.
 *
 * A `parentDatasetId` on a materialized row means provenance (it was
 * materialized out of a view), not containment, so viewness is never inferred
 * from the parent link — the same rule the server's `isDatasetView` follows.
 */
export function isDatasetView(dataset: { kind?: DatasetKind | string | null }): boolean {
  return dataset.kind === 'view';
}

/**
 * Build a manual selection from the episode indices a human ticked.
 *
 * Sorted and de-duplicated so two identical selections made in a different
 * click order produce the same stored JSON. No frame ranges: ticking a row in
 * the episode list means the whole episode.
 */
export function selectionFromEpisodeIndices(
  episodeIndices: readonly number[],
  note?: string,
): DatasetSelection {
  const unique = [...new Set(episodeIndices)].sort((a, b) => a - b);
  return {
    episodes: unique.map((episodeIndex) => ({ episodeIndex })),
    origin: note ? { kind: 'manual', note } : { kind: 'manual' },
  };
}

/**
 * Build a selection from the operator flags visible on the episode list.
 *
 * `flaggedIndices` is what an operator marked as bad, so keeping everything
 * else is "everything not marked remove" — recorded as `decision: 'remove'`
 * because that is the flag decision the rule was applied to.
 */
export function selectionFromFlags(
  allIndices: readonly number[],
  flaggedIndices: ReadonlySet<number>,
): DatasetSelection {
  const kept = allIndices.filter((index) => !flaggedIndices.has(index));
  return {
    episodes: [...kept].sort((a, b) => a - b).map((episodeIndex) => ({ episodeIndex })),
    origin: { kind: 'flags', decision: 'remove' },
  };
}

/**
 * Build a selection from reward-model scores at the threshold shown.
 *
 * Episodes with no score are left out: a view that silently included the
 * unscored ones would not be the arm its name claims.
 */
export function selectionFromRewards(
  scores: ReadonlyArray<{ episodeIndex: number; score: number; rewardType: string }>,
  minScore: number,
): DatasetSelection {
  const above = scores.filter((row) => row.score >= minScore);
  const rewardType = above[0]?.rewardType === 'topreward' ? 'topreward' : 'robometer';
  return {
    episodes: above
      .map((row) => row.episodeIndex)
      .sort((a, b) => a - b)
      .map((episodeIndex) => ({ episodeIndex })),
    origin: { kind: 'reward', rewardType, minScore },
  };
}

/** One-line English for a selection's origin, for a card or a list row. */
export function describeSelectionOrigin(origin: DatasetSelectionOrigin): string {
  switch (origin.kind) {
    case 'manual':
      return origin.note ? `Picked by hand — ${origin.note}` : 'Picked by hand';
    case 'flags':
      return origin.decision === 'keep'
        ? 'Episodes an operator marked keep'
        : 'Everything an operator did not flag';
    case 'reward':
      return `${origin.rewardType} score ≥ ${origin.minScore}`;
    case 'agent':
      return `Chosen by ${origin.actorId} — ${origin.rationale}`;
  }
}
