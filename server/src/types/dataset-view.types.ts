/**
 * @file dataset-view.types.ts
 * @description The shape of a dataset view — a named, frozen episode selection
 *   over a parent dataset. A view is a `Dataset` row (`kind = 'view'`), not a
 *   separate model, so every existing foreign key keeps working; these types
 *   describe what lives in its `selectionJson` and what resolving it yields.
 * @feature datasets
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
 * What a view selects out of its parent.
 *
 * The list is stored RESOLVED, never as a live query. A view built from
 * "reward >= 0.7" must not change meaning when a later reward job rewrites the
 * scores — that is the difference between an experiment arm somebody can
 * reproduce and a result nobody can explain a month later. `origin` records the
 * rule for humans and for the audit trail; `episodes` is the truth.
 */
export interface DatasetSelection {
  /** Explicit list, resolved against the parent at creation time. */
  episodes: SelectedEpisode[];
  /** How this selection was arrived at — for the UI and the audit trail. */
  origin:
    | { kind: 'manual'; note?: string }
    | { kind: 'flags'; decision: 'keep' | 'remove' }
    | { kind: 'reward'; rewardType: 'robometer' | 'topreward'; minScore: number }
    | { kind: 'agent'; actorId: string; rationale: string };
}

/**
 * What `DatasetViewService.resolve` answers: which real dataset the bytes live
 * in, and which of its episodes (and frame ranges) this row actually means.
 *
 * `isView` is how a consumer asks "do I have to filter?". For a materialized
 * dataset it is `false` and `episodes` is empty, which means *the whole
 * dataset* — an empty list is never a view selecting nothing, because a view
 * that selects nothing is refused at resolve time.
 */
export interface ResolvedDatasetSelection {
  /** The materialized dataset at the top of the `parentDatasetId` chain. */
  rootDatasetId: string;
  /** Episode indices in the ROOT, with frame ranges composed through the chain. */
  episodes: SelectedEpisode[];
  /** False when the dataset resolves to itself — nothing to filter. */
  isView: boolean;
  /** How many `parentDatasetId` hops were walked. 0 for a materialized dataset. */
  depth: number;
  /** The chain that was walked, child-most first, excluding the root. */
  viewChain: string[];
}

/**
 * The parent-side numbers `derivedCounts` needs, so it can stay a pure
 * function and be exercised without a database or a dataset on disk.
 */
export interface ParentEpisodeMetadata {
  /** Frames per episode, indexed by episode index in the parent. */
  episodeLengths: number[];
  /** Frames per second — how `totalDuration` is derived from `totalFrames`. */
  fps: number;
}

/** What a view's card shows without opening a single dataset file. */
export interface DerivedDatasetCounts {
  demonstrationCount: number;
  totalFrames: number;
  /** Seconds. */
  totalDuration: number;
}

/** The `kind` discriminator on a `Dataset` row. */
export type DatasetKind = 'materialized' | 'view';
