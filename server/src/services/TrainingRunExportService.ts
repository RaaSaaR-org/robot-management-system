/**
 * @file TrainingRunExportService.ts
 * @description Turn a training job into a document a cluster elsewhere can run.
 * @feature training
 *
 * WHY. A training job on this server is a row plus a `datasetId`, and a worker
 * learns the rest by asking this server over HTTP. That works for the GPU box
 * on the same LAN and for nothing else. An EU cluster, a partner's hardware, a
 * job somebody wants to reproduce in a year — none of them can call
 * `/api/training/workers/claim`, so the run has to be writable down.
 *
 * THE PART THAT ACTUALLY MATTERS IS THE URI. `Dataset.storagePath` is an
 * untyped mixed namespace: today most rows in this database hold an absolute
 * path on the laptop that imported them (`/Users/…/robot-agent/data/…`) while
 * the code that hands `storagePath` to a worker asserts in a comment that it is
 * a RustFS prefix. Both kinds are the same shape of string, so nothing catches
 * the difference — the worker downloads nothing, or worse, finds a same-named
 * directory of its own. Every URI here is therefore scheme-tagged, and a
 * `file://` member is marked `portable: false` and named in `warnings` in plain
 * language. That warning is the most useful line in the document and it is not
 * softened anywhere.
 *
 * WHAT IS DELIBERATELY NOT IN HERE. No credential of any kind: no
 * WORKER_API_TOKEN, no presigned URL (which IS a credential — it carries a
 * signature that grants read access to anyone holding the link), no Hugging
 * Face token. The manifest is meant to be attached to a ticket.
 *
 * AND NO INVENTED IMAGE TAG. `runtime.image` comes from TRAINER_IMAGE. When
 * that is unset the field holds an obvious placeholder and a warning says so,
 * because a plausible-looking wrong tag ("neodem/trainer:latest") is worse than
 * a hole: the hole gets fixed, the plausible tag gets deployed.
 */

import { isAbsolute } from 'path';
import { prisma } from '../database/index.js';
import { trainingJobRepository } from '../repositories/index.js';
import {
  analyzeCompatibility,
  declaredWidth,
  type CompatibilityDatasetInput,
} from './lerobot/datasetCompatibility.js';
import { datasetViewService, isDatasetView } from './DatasetViewService.js';
import { BUCKETS } from '../storage/model-storage.js';
import {
  TRAINING_RUN_SCHEMA_VERSION,
  type TrainingRunManifest,
  type TrainingRunManifestDataset,
  type TrainingRunManifestSelection,
} from '../types/mixture.types.js';
import type { DatasetSelection } from '../types/dataset-view.types.js';

/** A `Dataset` row as this service reads it, plus its mixture weight/position. */
interface MixtureRow {
  weight: number;
  position: number;
  dataset: {
    id: string;
    name: string;
    status: string;
    fps: number;
    lerobotVersion: string;
    robotTypeId: string;
    storagePath: string;
    huggingFaceRepoId: string | null;
    sourceRevision: string | null;
    sourceLicense: string | null;
    infoJson: string;
    validationJson: string | null;
    totalFrames: number;
    demonstrationCount: number;
    // The view columns (TASK-240). A member may be a selection over another
    // dataset rather than a dataset with bytes of its own, and a manifest that
    // could not say so would send a cluster to train on the wrong episodes.
    kind: string;
    parentDatasetId: string | null;
    selectionJson: string | null;
    frozenAt: Date | null;
  };
}

/**
 * The stand-in for an image nobody has configured.
 *
 * Shaped so it cannot be mistaken for a tag: no registry, no colon-version, and
 * it names the variable that fixes it.
 */
export const TRAINER_IMAGE_PLACEHOLDER = '<UNSET — set TRAINER_IMAGE on the NeoDEM server>';

function parseJson(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === 'object') return value as Record<string, unknown>;
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

interface ResolvedUri {
  uri: string;
  portable: boolean;
  /** Written into `warnings` verbatim; empty when there is nothing to say. */
  warning: string | null;
}

/**
 * Where this dataset really is, said in a way a stranger can act on.
 *
 * Hugging Face wins whenever it is available, because `hf://repo@sha` is the
 * one locator a cluster outside this building can resolve without asking this
 * server for anything — no VPN, no bucket credentials, no shared filesystem.
 */
export function resolveDatasetUri(dataset: MixtureRow['dataset']): ResolvedUri {
  if (dataset.huggingFaceRepoId && dataset.sourceRevision) {
    return {
      uri: `hf://${dataset.huggingFaceRepoId}@${dataset.sourceRevision}`,
      portable: true,
      warning: null,
    };
  }
  if (dataset.huggingFaceRepoId) {
    // A repo without a resolved commit is still resolvable — it is just not
    // pinned, and "not pinned" is a statement about reproducibility, not about
    // reachability. Naming a branch here would be worse: a branch is not a
    // revision and pretending otherwise is what this column exists to end.
    return {
      uri: `hf://${dataset.huggingFaceRepoId}`,
      portable: true,
      warning:
        `"${dataset.name}" cites the Hugging Face repo ${dataset.huggingFaceRepoId} with no resolved `
        + 'commit, so this run does not pin which version of that data it trained on — re-import the '
        + 'dataset to record the commit if the result has to be reproducible.',
    };
  }

  const path = dataset.storagePath ?? '';
  if (isAbsolute(path) || path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path)) {
    return {
      uri: `file://${path}`,
      portable: false,
      warning:
        `"${dataset.name}" exists only as a directory on the machine that runs this NeoDEM server `
        + `(${path}). A cluster anywhere else CANNOT read it: the path will either not exist or, worse, `
        + 'will exist and hold something different. Push the dataset to Hugging Face or to shared object '
        + 'storage and export again, or copy the directory to the cluster and edit this URI by hand.',
    };
  }
  // Reachable, but not from the address alone. `s3://training-datasets/…` with
  // no endpoint resolves against public AWS, where this bucket is not — and
  // `training-datasets` is a generic enough name that somebody else's bucket
  // may well answer. So the URI stays (it is the correct key inside the store)
  // and the warning carries the part the URI cannot: which store.
  return {
    uri: `s3://${BUCKETS.TRAINING_DATASETS}/${path}`,
    portable: true,
    warning:
      `"${dataset.name}" lives in this deployment's own S3-compatible object store (RustFS), not in `
      + `AWS S3. \`s3://${BUCKETS.TRAINING_DATASETS}/…\` carries no endpoint, so a cluster that reads `
      + 'it with default credentials will reach the wrong bucket or none at all. Supply the store '
      + "endpoint and credentials to the cluster out of band, or push the dataset to Hugging Face if "
      + 'it is meant to travel on its own.',
  };
}

/**
 * The dataset's license, from whatever recorded one. Never inferred.
 *
 * `sourceLicense` first: that is the string the source repo's own card
 * declared, captured at import. Only then the manifest's own keys, which is
 * where a locally recorded or uploaded dataset can carry one. A repo that
 * declares nothing stays 'unknown' — guessing which license was meant is how a
 * wrong license claim reaches a technical file.
 */
function readLicense(sourceLicense: string | null, infoJson: string | null): string {
  if (typeof sourceLicense === 'string' && sourceLicense.trim()) return sourceLicense.trim();
  const info = parseJson(infoJson);
  for (const key of ['license', 'licence', '_license']) {
    const value = info?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return 'unknown';
}

/**
 * State and action width — measured if this dataset has been validated, and
 * otherwise as `info.json` declares it.
 *
 * The fallback matters because the `compatibility` block in this same document
 * already falls back (`readWidth` in `datasetCompatibility.ts`, which labels a
 * fallen-back number "43 (declared)"). Reading only the measured value left one
 * manifest asserting `"stateWidth": null` two hundred lines above an axis that
 * said the widths were 43 and 28 and did not match. A document that contradicts
 * itself is worse than one that admits it never measured.
 */
function readWidths(
  validationJson: string | null,
  infoJson: string | null,
): { state: number | null; action: number | null } {
  const outer = parseJson(validationJson);
  const report = parseJson(outer?.report) ?? outer;
  const state = report?.observedStateWidth;
  const action = report?.observedActionWidth;
  const info = parseJson(infoJson);
  return {
    state: typeof state === 'number' ? state : declaredWidth(info, 'observation.state'),
    action: typeof action === 'number' ? action : declaredWidth(info, 'action'),
  };
}

function readCameraKeys(row: MixtureRow['dataset']): string[] {
  const outer = parseJson(row.validationJson);
  const report = parseJson(outer?.report) ?? outer;
  if (Array.isArray(report?.imageKeys)) return report.imageKeys.map(String);
  const features = parseJson(parseJson(row.infoJson)?.features);
  if (!features) return [];
  return Object.entries(features)
    .filter(([, spec]) => {
      const dtype = parseJson(spec)?.dtype;
      return dtype === 'video' || dtype === 'image';
    })
    .map(([key]) => key);
}

function toCompatibilityInput(row: MixtureRow['dataset']): CompatibilityDatasetInput {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    fps: row.fps,
    lerobotVersion: row.lerobotVersion,
    robotTypeId: row.robotTypeId,
    infoJson: row.infoJson,
    validationJson: row.validationJson,
  };
}

export class TrainingRunExportService {
  private static instance: TrainingRunExportService;

  static getInstance(): TrainingRunExportService {
    if (!TrainingRunExportService.instance) {
      TrainingRunExportService.instance = new TrainingRunExportService();
    }
    return TrainingRunExportService.instance;
  }

  /**
   * The job's mixture, in position order.
   *
   * A job written before mixtures existed — and every single-dataset job today —
   * has no `TrainingJobDataset` rows, so its one dataset is read directly.
   * Callers get the same shape either way.
   */
  private async loadMixture(jobId: string, datasetId: string | null): Promise<MixtureRow[]> {
    const rows = await prisma.trainingJobDataset.findMany({
      where: { trainingJobId: jobId },
      orderBy: { position: 'asc' },
      include: { dataset: true },
    });
    if (rows.length > 0) {
      return rows as unknown as MixtureRow[];
    }
    if (!datasetId) return [];
    const dataset = await prisma.dataset.findUnique({ where: { id: datasetId } });
    if (!dataset) return [];
    return [{ weight: 1, position: 0, dataset: dataset as unknown as MixtureRow['dataset'] }];
  }

  /**
   * The selection a member is, plus the dataset its bytes are in — or null when
   * the member is an ordinary dataset (TASK-240).
   *
   * `kind` is the authority on whether this is a view; `resolve` is the only
   * thing that walks the chain, and it is asked for the ROOT rather than the
   * immediate parent, because a view of a view still resolves to exactly one
   * directory of files and one list of episode indices into it.
   *
   * Returns null rather than throwing when the chain cannot be resolved: an
   * export that refuses is an export nobody can read to find out why, and the
   * `warnings` list carries the reason instead.
   */
  private async readSelection(row: MixtureRow['dataset']): Promise<{
    root: MixtureRow['dataset'];
    manifest: TrainingRunManifestSelection;
  } | null> {
    if (!isDatasetView(row)) return null;
    try {
      const resolved = await datasetViewService.resolve(row.id);
      const root = (await prisma.dataset.findUnique({
        where: { id: resolved.rootDatasetId },
      })) as unknown as MixtureRow['dataset'] | null;
      if (!root) return null;
      const stored = row.selectionJson
        ? (JSON.parse(row.selectionJson) as { origin?: DatasetSelection['origin'] })
        : null;
      return {
        root,
        manifest: {
          viewDatasetId: row.id,
          rootDatasetId: resolved.rootDatasetId,
          episodes: resolved.episodes,
          origin: stored?.origin ?? null,
          frozenAt: row.frozenAt ? row.frozenAt.toISOString() : null,
        },
      };
    } catch (error) {
      console.warn(`[TrainingRunExportService] Could not resolve view ${row.id}:`, error);
      return null;
    }
  }

  /**
   * Build the manifest for a job, or null when there is no such job.
   *
   * Never throws for a job whose data is incomplete: an export that refuses is
   * an export nobody can use to find out WHY it refused, and the incomplete
   * parts are exactly what the `warnings` list is for.
   */
  async buildManifest(jobId: string): Promise<TrainingRunManifest | null> {
    const job = await trainingJobRepository.findById(jobId);
    if (!job) return null;

    const members = await this.loadMixture(jobId, job.datasetId);
    const warnings: string[] = [];
    const notes: string[] = [];

    const rawTotal = members.reduce((sum, m) => sum + (Number.isFinite(m.weight) ? m.weight : 0), 0);
    // Weights that sum to nothing cannot be normalised, and silently handing a
    // sampler NaN is how a run trains on one dataset without saying so.
    const usableTotal = rawTotal > 0;
    if (members.length > 0 && !usableTotal) {
      warnings.push(
        'The mixture weights sum to zero, so no sampling ratio could be derived; every member is '
        + 'exported with an equal share instead. Set the weights before running this.',
      );
    }

    const datasets: TrainingRunManifestDataset[] = await Promise.all(
      members.map(async (member) => {
        const row = member.dataset;
        // A view has no files, no fps and no widths of its own — every one of
        // those belongs to the dataset its episodes are indices into. So the
        // LOCATOR half of this entry is the root's, and the selection below
        // carries the rest. Anything else would hand a cluster a `file://`
        // path of "" and a state width of null (TASK-240).
        const selection = await this.readSelection(row);
        const located = resolveDatasetUri(selection?.root ?? row);
        if (located.warning) warnings.push(located.warning);
        const axes = selection?.root ?? row;
        const widths = readWidths(axes.validationJson, axes.infoJson);
        const info = parseJson(axes.infoJson);
        const robotType = typeof info?.robot_type === 'string' && info.robot_type.trim()
          ? info.robot_type.trim()
          : axes.robotTypeId;

        if (!selection && isDatasetView(row)) {
          // A view whose chain could not be resolved. Said out loud: the entry
          // below describes a dataset with no bytes, and a reader who is not
          // told that will read `totalEpisodes` as data they can fetch.
          warnings.push(
            `"${row.name}" is a view — an episode selection over another dataset — and this server `
            + 'could not resolve which dataset or which episodes. The entry below therefore locates '
            + 'nothing loadable. Repair the view on the source server and export again.',
          );
        }
        if (selection) {
          // The most consequential line this document can carry for such a
          // run: a reader that loads `uri` and ignores `selection` trains on a
          // superset of the data and reports it as this arm.
          warnings.push(
            `"${row.name}" is a VIEW of "${selection.root.name}": it holds no data of its own and `
            + `selects ${selection.manifest.episodes.length} of that dataset's `
            + `${selection.root.demonstrationCount} episodes. The uri above locates the WHOLE parent `
            + '— apply datasets[].selection.episodes before training, or this run will not be the '
            + 'run this manifest describes.',
          );
        }

        return {
          datasetId: row.id,
          name: row.name,
          uri: located.uri,
          revision: axes.sourceRevision ?? null,
          license: readLicense(axes.sourceLicense ?? null, axes.infoJson),
          weight: member.weight,
          normalizedWeight: usableTotal ? member.weight / rawTotal : 1 / members.length,
          lerobotVersion: axes.lerobotVersion,
          robotType,
          fps: axes.fps,
          stateWidth: widths.state,
          actionWidth: widths.action,
          cameraKeys: readCameraKeys(axes),
          // The view's OWN counts: what the run trained on, not what the
          // parent holds. `selection.episodes` says which they are.
          totalEpisodes: row.demonstrationCount,
          totalFrames: row.totalFrames,
          portable: located.portable,
          selection: selection?.manifest ?? null,
        };
      }),
    );

    // A job with no members is one of two quite different things, and saying
    // the wrong one is a lie in a document meant to be trusted. A `sim_rl` job
    // never had a dataset — it trains in a simulated scene — so telling its
    // reader that "the dataset was deleted" invents a loss that never happened.
    const simulated = job.kind === 'sim_rl';
    const compatibility = members.length
      ? analyzeCompatibility(members.map((m) => toCompatibilityInput(m.dataset)))
      : {
          datasetIds: [],
          verdict: 'incompatible' as const,
          headline: simulated
            ? 'This is a sim_rl run: it trains in a simulated scene, so there are no datasets to compare.'
            : 'This job names no dataset that still exists, so there is nothing to train on.',
          recommendation: simulated
            ? 'Nothing to reconcile here — a sim_rl run carries a scene, not recorded data. This '
              + 'manifest does not yet describe that scene, so it cannot be run from this document alone.'
            : 'The dataset this job was created from has been deleted. Create a new job against a '
              + 'dataset that is still registered.',
          axes: [],
        };
    if (!members.length) {
      warnings.push(
        simulated
          ? 'This is a sim_rl run, which trains in a simulated scene rather than on recorded data. '
            + 'The scene is not part of this manifest, so a cluster cannot reproduce the run from '
            + 'this document alone.'
          : 'This run names no dataset — the dataset the job was created from no longer exists. '
            + 'Nothing here tells a cluster what to load.',
      );
    }
    if (compatibility.verdict === 'incompatible' && members.length) {
      warnings.push(`Compatibility: ${compatibility.headline}`);
    }

    // What this run started from, resolved to the artifact it names (TASK-239).
    // The job service owns that resolution and is loaded lazily, in the branch
    // that needs it: an export of an ordinary run — one that starts from a
    // foundation model, which is most of them — has nothing to resolve and no
    // reason to construct the job service and its messaging dependencies.
    let initFrom: TrainingRunManifest['job']['initFrom'] = null;
    if (job.initFromModelVersionId || job.initFromCheckpointId) {
      const { trainingJobService } = await import('./TrainingJobService.js');
      initFrom = await trainingJobService.resolveInitFrom(job);
      if (!initFrom) {
        warnings.push(
          'This run was started from another model or checkpoint, but that row no longer exists, '
          + 'so its weights cannot be located from this document. The run is not reproducible as '
          + 'written.',
        );
      }
    }

    const image = process.env.TRAINER_IMAGE?.trim();
    if (!image) {
      warnings.push(
        `runtime.image is the placeholder "${TRAINER_IMAGE_PLACEHOLDER}" because this server has no `
        + 'TRAINER_IMAGE configured. No image tag has been guessed for you — fill it in with the '
        + 'trainer image your cluster actually runs before submitting this run.',
      );
    }

    const licenses = datasets.map((d) => d.license);
    if (licenses.some((l) => l === 'unknown')) {
      notes.push(
        'At least one dataset has no license on record. A model trained on data of unknown license '
        + 'cannot be shown to be redistributable, which is a question that gets asked after the '
        + 'model ships rather than before.',
      );
    }
    // Checked before writing this: no table, column or config in this codebase
    // records where a dataset's data was collected or is stored. Emitting a
    // cheerful "EU" here would put an unfounded residency claim into a document
    // that reads like a compliance record.
    notes.push(
      'residency is null: nothing in this platform records the geographic origin or storage region '
      + 'of a dataset, so no residency claim can be made from this export. Establish it from the '
      + 'dataset licenses and your storage configuration instead.',
    );
    notes.push(
      'This manifest carries no credentials by construction — no worker token, no presigned URL, no '
      + 'Hugging Face token. Private datasets need the cluster to hold its own credentials.',
    );

    return {
      schemaVersion: TRAINING_RUN_SCHEMA_VERSION,
      runId: job.id,
      createdAt: new Date().toISOString(),
      sourceServer: process.env.PUBLIC_BASE_URL ?? 'unknown',
      job: {
        kind: job.kind ?? 'supervised',
        baseModel: job.baseModel ?? null,
        fineTuneMethod: job.fineTuneMethod ?? null,
        status: job.status,
        initFrom,
      },
      datasets,
      compatibility,
      hyperparameters: (job.hyperparameters ?? {}) as unknown as Record<string, unknown>,
      gpu: {
        count: job.gpuRequirements?.count ?? 1,
        memory: job.gpuRequirements?.memory ?? 0,
        type: job.gpuRequirements?.type ?? null,
      },
      runtime: {
        image: image ?? TRAINER_IMAGE_PLACEHOLDER,
        // The only trainer entrypoint this repository documents is the polling
        // worker of the separate training-worker repo (`python worker.py`, see
        // docs/training-pipeline-testing.md). That repo is not checked out
        // beside this one, so nothing here invents flags it might accept — the
        // note below says what the reader has to supply.
        entrypoint: 'python',
        command: ['worker.py'],
      },
      compliance: {
        datasetLicenses: licenses,
        residency: null,
        notes: [
          'runtime.command is the NeoDEM training-worker, which normally CLAIMS work from '
          + `${process.env.PUBLIC_BASE_URL ?? 'this server'} over HTTP. A cluster that cannot reach it `
          + 'must be given the datasets, hyperparameters and GPU requirements above directly; this '
          + 'manifest carries all of them.',
          ...notes,
        ],
      },
      warnings,
    };
  }
}

export const trainingRunExportService = TrainingRunExportService.getInstance();
