/**
 * @file mixture.types.ts
 * @description The vocabulary for training on more than one dataset: what makes
 *              two datasets mixable, and what a run looks like once it leaves
 *              this machine.
 * @feature training
 *
 * WHY THIS FILE EXISTS SEPARATELY. A training job used to name exactly one
 * dataset, so "can these train together" was not a question anyone could ask.
 * It is the central question of a GR00T-style mixture, and the answer is not a
 * boolean: two datasets with different action widths are not broken, they are a
 * multi-embodiment run — while two datasets recorded at 25 and 30 fps really
 * are unmixable until somebody resamples one of them. `CompatibilityVerdict`
 * carries that distinction so the UI, the job submission guard and the export
 * manifest all read it the same way instead of each inventing a rule.
 *
 * The types below are a contract shared with the dataset-import work and the
 * frontend; the shapes are fixed even where a narrower one would do.
 */

// Type-only, and therefore erased: no runtime import exists in either
// direction, so the pair of files does not form a module cycle. The manifest
// states what a run started from in exactly the shape the worker payload
// carries, rather than a second copy of it that can drift.
import type { TrainingInitFrom } from './vla.types.js';
// Same reasoning as above, for the dataset side: a run may cite a VIEW — a
// named episode selection over another dataset, holding no bytes of its own
// (TASK-240) — and the manifest has to state the selection in the one shape
// the server stores it in.
import type { DatasetSelection, SelectedEpisode } from './dataset-view.types.js';

/**
 * How a set of datasets relates to each other.
 *
 * `multi_embodiment` is the one that carries real information: it means the
 * data is trainable together but NOT concatenable — the run needs one
 * projector per embodiment, which is exactly what a GR00T embodiment tag is
 * for. Collapsing it into `incompatible` would refuse a run that works.
 */
export type CompatibilityVerdict =
  | 'identical'
  | 'compatible'
  | 'multi_embodiment'
  | 'incompatible';

/**
 * One axis's outcome. `differs` costs the operator a decision; `blocking` means
 * no decision they can make at submission time saves the run.
 */
export type AxisVerdict = 'match' | 'differs' | 'blocking';

export interface CompatibilityAxis {
  axis:
    | 'lerobotVersion'
    | 'robotType'
    | 'fps'
    | 'stateWidth'
    | 'actionWidth'
    | 'cameraKeys'
    | 'status';
  /** Human label, e.g. "Action width". */
  label: string;
  verdict: AxisVerdict;
  values: Array<{ datasetId: string; datasetName: string; value: string }>;
  /** One sentence: what this difference means for a training run. */
  note: string;
}

export interface CompatibilityReport {
  datasetIds: string[];
  verdict: CompatibilityVerdict;
  /** The one sentence a person reads first — and the one a 400 quotes back. */
  headline: string;
  recommendation: string;
  axes: CompatibilityAxis[];
}

/** One member of a mixture as the caller submits it. */
export interface MixtureMemberInput {
  datasetId: string;
  weight?: number;
}

/**
 * A mixture member as it comes back on a job.
 *
 * Always present on a job response, including the single-dataset jobs that
 * predate mixtures — those synthesise one entry from `TrainingJob.datasetId`
 * rather than making every reader handle two shapes.
 */
export interface TrainingJobDatasetRef {
  datasetId: string;
  name: string;
  weight: number;
  position: number;
}

/**
 * One dataset inside an exported run.
 *
 * `uri` is scheme-tagged (`hf://`, `s3://`, `file://`) because `storagePath`
 * alone is not: the same column holds RustFS key prefixes and absolute paths on
 * whichever laptop imported the dataset, and a worker on another continent
 * handed the second kind fails in a way nobody can debug. `portable` states
 * which of those this is, in one boolean, so a reader does not have to parse
 * the URI to find out.
 */
/**
 * The episode selection a member is, when the member is a view (TASK-240).
 *
 * A view holds no bytes: `uri` on the member beside this points at the ROOT
 * dataset, and this block is the rest of the answer — which of that root's
 * episodes the run actually trained on. Without it a cluster reading the
 * manifest would load the whole root and train a DIFFERENT arm of the
 * experiment while reporting this one, which is the exact failure the view
 * feature exists to make cheap and this field exists to keep honest.
 *
 * `episodes` is stated resolved, in the root's own episode indices, so the
 * reader needs nothing from this server to apply it.
 */
export interface TrainingRunManifestSelection {
  /** The view row on the source server — the id the job actually cites. */
  viewDatasetId: string;
  /** The dataset the indices below are indices INTO. Same row `uri` locates. */
  rootDatasetId: string;
  /** Episode indices in the root, with any frame ranges already composed. */
  episodes: SelectedEpisode[];
  /** How the selection was arrived at, for a human. Null if it was not recorded. */
  origin: DatasetSelection['origin'] | null;
  /** When the selection was pinned by a citing job. ISO-8601, or null. */
  frozenAt: string | null;
}

export interface TrainingRunManifestDataset {
  datasetId: string;
  name: string;
  uri: string;
  /** The commit this actually is, when one was resolved. Never a branch name. */
  revision: string | null;
  license: string;
  /** What the operator typed, unchanged. */
  weight: number;
  /** The same weights scaled to sum to 1, so a sampler can use them directly. */
  normalizedWeight: number;
  lerobotVersion: string;
  robotType: string;
  fps: number;
  stateWidth: number | null;
  actionWidth: number | null;
  cameraKeys: string[];
  totalEpisodes: number;
  totalFrames: number;
  /**
   * Whether `uri` alone locates the data from somewhere else.
   *
   * A view inherits this from its root and cannot improve on it: a selection
   * over a `file://` directory is still a `file://` directory.
   */
  portable: boolean;
  /**
   * The episode selection this member is, or null when it is a whole dataset.
   *
   * Always present as a key so a reader can tell "the whole dataset" from an
   * older manifest that predates views and could not have said either.
   */
  selection: TrainingRunManifestSelection | null;
}

/** The runtime the run expects. Never a guessed image tag — see the service. */
export interface TrainingRunManifestRuntime {
  image: string;
  command: string[];
  entrypoint: string;
}

export interface TrainingRunManifestCompliance {
  /** One entry per dataset, in mixture order; 'unknown' when nothing recorded it. */
  datasetLicenses: string[];
  /** Null unless something in the platform actually records where data lives. */
  residency: string | null;
  notes: string[];
}

/**
 * A training run, complete enough for a cluster that cannot reach this server.
 *
 * Contains no credential of any kind: no worker token, no presigned URL, no
 * Hugging Face token. The document is meant to be attached to a ticket and
 * mailed around, and anything secret in it would leak the first time it was.
 */
export interface TrainingRunManifest {
  schemaVersion: 'neodem.training.run/v1';
  runId: string;
  createdAt: string;
  sourceServer: string;
  job: {
    kind: string;
    baseModel: string | null;
    fineTuneMethod: string | null;
    status: string;
    /**
     * The weights the run started from, or null for a run that started from
     * `baseModel` itself. (TASK-239)
     *
     * A manifest that says only "groot_n1_7" for a run that actually resumed a
     * 14k-step fine-tune does not describe a reproducible run — it describes a
     * different one. This is the same failure `datasets[].revision` exists to
     * close, one level up: the starting weights are an input like the data is.
     */
    initFrom: TrainingInitFrom | null;
  };
  datasets: TrainingRunManifestDataset[];
  compatibility: CompatibilityReport;
  hyperparameters: Record<string, unknown>;
  gpu: { count: number; memory: number; type: string | null };
  runtime: TrainingRunManifestRuntime;
  compliance: TrainingRunManifestCompliance;
  /** Everything that would otherwise be discovered at 3am on the cluster. */
  warnings: string[];
}

/** The manifest's schema tag, so producers and readers agree on one literal. */
export const TRAINING_RUN_SCHEMA_VERSION = 'neodem.training.run/v1' as const;
