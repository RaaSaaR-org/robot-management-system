/**
 * @file HuggingFaceImportService.ts
 * @description Import a LeRobot dataset off the HuggingFace Hub — pinned to a
 *              commit, into whichever store this deployment actually has.
 * @feature datasets
 *
 * WHY THIS WAS REWORKED (TASK-220). Four things made the import unusable on a
 * machine that is not the production cluster, and one made it quietly wrong
 * everywhere.
 *
 * THE STORE. `downloadFiles` opened with `if (!isRustFSInitialized()) throw`.
 * RustFS is optional — it is down on every dev machine in this repo — so every
 * import died about 300 ms in and flipped the row to `failed`. The dataset
 * layer has known how to read a LeRobot directory on local disk since TASK-178
 * and how to validate one since TASK-217; only the importer insisted on the
 * bucket. It now writes through a sink: the bucket when there is one, a
 * directory under {@link datasetStorageRoot} when there is not, with the files
 * at their repo-relative paths so the tree on disk IS a LeRobot dataset.
 *
 * THE COMMIT. `revision` defaulted to `main` and was recorded only inside the
 * description STRING. `main` is not a revision, it is a pointer, and a training
 * run that cites its data as `main` cites nothing. The branch is resolved to a
 * commit SHA before anything is fetched, and every URL — info.json included —
 * addresses that SHA, so one import cannot straddle two commits.
 *
 * THE REASON IT FAILED. The catch wrote `status: 'failed'` and emitted ONE
 * WebSocket broadcast carrying the message. For a failure that takes 300 ms
 * that fires before the browser has opened its socket, and nothing was
 * persisted: the card said "Failed" and nothing else, forever. It is written to
 * the row now.
 *
 * THE ROBOT TYPE. The matcher tested /g1|dex3|unitree/ and then looked up the
 * literal display name 'Unitree G1 + Dex3', which is not what this database
 * calls it ('Unitree G1 EDU (Dex3-1)'). The lookup missed and the fallback
 * minted a RobotType with actionDim 0 and proprioceptionDim 0 — and because
 * both are zero the width check in `validateDataset` is inert, so a 43-wide
 * dataset attached to a 0-DOF robot read as validated. Matching is on a
 * normalised model/name slug, and a type that must be created takes its dims
 * from the info.json this service has already parsed.
 */

import { createWriteStream } from 'fs';
import { mkdir } from 'fs/promises';
import { dirname, join, resolve as resolvePath, sep } from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { v4 as uuidv4 } from 'uuid';
import {
  datasetRepository,
  robotTypeRepository,
} from '../repositories/index.js';
import { getRustFSClient, isRustFSInitialized } from '../storage/rustfs-client.js';
import { BUCKETS } from '../storage/model-storage.js';
import { natsClient } from '../messaging/index.js';
import { datasetService, datasetStorageRoot } from './DatasetService.js';
import type {
  CreateDatasetInput,
  DatasetImportMode,
  RobotType,
} from '../types/vla.types.js';
import type {
  HuggingFaceImportRequest,
  HuggingFaceImportProgress,
  HuggingFacePreview,
  LeRobotInfoV3,
} from '../types/dataset.types.js';

// ============================================================================
// CONSTANTS
// ============================================================================

const HF_BASE_URL = 'https://huggingface.co/datasets';
const HF_API_BASE_URL = 'https://huggingface.co/api/datasets';
const DATASET_VALIDATION_SUBJECT = 'jobs.dataset.validate';
const MAX_CONCURRENT_DOWNLOADS = 5;
const MAX_RETRY_DELAY_MS = 30_000;
const INITIAL_RETRY_DELAY_MS = 1_000;

/** A git object id, which needs no resolving. */
const SHA_RE = /^[0-9a-f]{40}$/;

/**
 * An import failure the caller can act on, as opposed to a stack trace.
 *
 * It carries the HTTP status because the route used to derive one by testing
 * `error.message.includes('info.json')` against English prose, which made "no
 * such repo" and "an import is already running" the same 400 to a client. The
 * decision belongs where the failure is raised.
 */
export class HuggingFaceImportError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number = 400,
  ) {
    super(message);
    this.name = 'HuggingFaceImportError';
  }
}

// ============================================================================
// WHERE THE BYTES GO
// ============================================================================

/** One file of a repo tree, with the size the tree API reported for it. */
export interface RepoFile {
  path: string;
  size: number;
}

/**
 * Somewhere an import can put a file.
 *
 * The interface is two methods and a string on purpose: the only thing the
 * download loop needs to know is where to put a path, and the only thing the
 * dataset row needs is the `storagePath` that will make every reader find it
 * again — an absolute directory for local, an object-key prefix for RustFS.
 * `isLocalStoragePath` in DatasetTree.ts is what tells them apart, and it keys
 * off exactly that difference.
 */
interface ImportSink {
  readonly kind: 'local' | 'rustfs';
  readonly storagePath: string;
  /** Called once before the first write. */
  prepare(): Promise<void>;
  write(path: string, response: Response): Promise<void>;
}

/**
 * A repo path is remote input, so it is checked rather than trusted.
 *
 * The Hub does not serve a file called `../../etc/anything` today; the reason
 * this exists is that "the remote refuses it" is a claim about the remote, and
 * the same argument `extractArchive` makes about `tar`.
 */
function safeJoin(root: string, path: string): string {
  const full = resolvePath(root, path);
  if (full !== root && !full.startsWith(root + sep)) {
    throw new HuggingFaceImportError(
      'UNSAFE_PATH',
      `repo file would land outside the dataset root: ${path}`,
    );
  }
  return full;
}

function webStream(response: Response, url: string): Readable {
  if (!response.body) {
    throw new HuggingFaceImportError('EMPTY_BODY', `Empty response body for ${url}`);
  }
  return Readable.fromWeb(response.body as import('stream/web').ReadableStream);
}

/** A LeRobot directory tree on this machine. */
class LocalImportSink implements ImportSink {
  readonly kind = 'local' as const;
  readonly storagePath: string;

  constructor(private readonly root: string) {
    // Trailing slash by the same convention `unpackUploadedArchive` uses;
    // `LocalDatasetTree` resolves it away and every reader agrees.
    this.storagePath = `${root}/`;
  }

  async prepare(): Promise<void> {
    // Before the row is written, so `isLocalStoragePath` — which is an
    // `existsSync` — is true from the moment the dataset exists rather than
    // from the moment the first file lands.
    await mkdir(this.root, { recursive: true });
  }

  async write(path: string, response: Response): Promise<void> {
    const full = safeJoin(this.root, path);
    await mkdir(dirname(full), { recursive: true });
    await pipeline(webStream(response, path), createWriteStream(full));
  }
}

/** A prefix in the RustFS training-datasets bucket. */
class RustFsImportSink implements ImportSink {
  readonly kind = 'rustfs' as const;
  readonly storagePath: string;

  constructor(prefix: string) {
    this.storagePath = prefix.endsWith('/') ? prefix : `${prefix}/`;
  }

  async prepare(): Promise<void> {
    // An object store has no directories to make.
  }

  async write(path: string, response: Response): Promise<void> {
    const contentType = response.headers.get('content-type') ?? 'application/octet-stream';
    await getRustFSClient().upload(
      BUCKETS.TRAINING_DATASETS,
      `${this.storagePath}${path}`,
      webStream(response, path),
      { contentType },
    );
  }
}

/**
 * The sink this deployment can actually write to, decided once per import.
 *
 * Once, and before the row is created, because a decision taken per file could
 * put half a dataset in a bucket and half on a disk if RustFS came up midway.
 */
function createSink(storageId: string): ImportSink {
  if (isRustFSInitialized()) return new RustFsImportSink(`${storageId}/`);
  return new LocalImportSink(join(datasetStorageRoot(), storageId));
}

/** The id inside an existing `storagePath`, so a retry reuses its directory. */
function storageIdOf(storagePath: string): string {
  const last = storagePath.replace(/[\\/]+$/, '').split(/[\\/]/).pop();
  return last && last.length > 0 ? last : uuidv4();
}

// ============================================================================
// ROBOT TYPE MATCHING
// ============================================================================

/** Comparable form of a robot name: 'Unitree G1 EDU (Dex3-1)' → 'unitreeg1edudex31'. */
function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Hub `robot_type` values that name a machine this database knows under a
 * different string, in order of preference.
 *
 * The slugs are matched against RobotType.model AND RobotType.name, not against
 * a display string — the version of this table that shipped named
 * 'Unitree G1 + Dex3', which no row has ever been called, so the branch it
 * guarded never fired once.
 */
const ROBOT_TYPE_ALIASES: Array<{ pattern: RegExp; slugs: string[] }> = [
  { pattern: /so10[01]|soarm/, slugs: ['so101follower', 'soarm101', 'soarm100', 'so101', 'so100'] },
  { pattern: /aloha/, slugs: ['aloha'] },
  { pattern: /pusht/, slugs: ['pushtsim', 'pusht'] },
  { pattern: /g1|dex3|unitree/, slugs: ['unitreeg1edudex31', 'unitreeg1edu', 'unitreeg1', 'g1'] },
];

/** The width `info.json` declares for a feature, or 0 when it declares none. */
export function declaredFeatureWidth(info: LeRobotInfoV3, key: string): number {
  const shape = info.features?.[key]?.shape;
  return Array.isArray(shape) && typeof shape[0] === 'number' ? shape[0] : 0;
}

// ============================================================================
// HUGGINGFACE IMPORT SERVICE
// ============================================================================

/**
 * Service for importing datasets from HuggingFace Hub
 */
export class HuggingFaceImportService {
  private static instance: HuggingFaceImportService;

  private constructor() {}

  static getInstance(): HuggingFaceImportService {
    if (!HuggingFaceImportService.instance) {
      HuggingFaceImportService.instance = new HuggingFaceImportService();
    }
    return HuggingFaceImportService.instance;
  }

  /**
   * Import a dataset from HuggingFace Hub
   * Returns the dataset ID immediately; import runs in background.
   */
  async importDataset(request: HuggingFaceImportRequest): Promise<string> {
    const { repoId, revision = 'main', robotTypeId, includeVideos = false } = request;
    const importMode: DatasetImportMode = includeVideos ? 'full' : 'metadata';

    // Phase 1: pin the commit, THEN read the metadata at it. The other order
    // reads info.json off a branch that can move before the download starts.
    const { sha, license } = await this.resolveSource(repoId, revision);
    const info = await this.fetchInfoJson(repoId, sha);

    const resolvedRobotTypeId = await this.resolveRobotTypeId(robotTypeId, info);

    const sink = createSink(uuidv4());
    await sink.prepare();
    const datasetName = repoId.includes('/') ? repoId.split('/').pop()! : repoId;

    const input: CreateDatasetInput = {
      name: datasetName,
      description: `Imported from HuggingFace: ${repoId} (${revision} → ${sha})`,
      robotTypeId: resolvedRobotTypeId,
      storagePath: sink.storagePath,
      lerobotVersion: info.codebase_version ?? 'unknown',
      fps: info.fps ?? 0,
      totalFrames: info.total_frames ?? 0,
      totalDuration: info.fps > 0 ? (info.total_frames ?? 0) / info.fps : 0,
      demonstrationCount: info.total_episodes ?? 0,
      status: 'importing',
      huggingFaceRepoId: repoId,
      sourceRevision: sha,
      sourceLicense: license,
      importMode,
    };

    const created = await datasetRepository.create(input);
    const datasetId = created.id;

    // Emit import started event
    this.emitProgress(datasetId, {
      datasetId,
      status: 'importing',
      phase: 'metadata',
      progress: 5,
      totalFiles: 0,
      completedFiles: 0,
    });

    // Run download in background (don't await)
    this.runImport(datasetId, repoId, sha, sink, info, includeVideos).catch(
      (error) => {
        console.error(`[HFImport] Background import failed for ${datasetId}:`, error);
      }
    );

    return datasetId;
  }

  /**
   * Run the import again for a row that already carries a repo id.
   *
   * The pinned SHA is reused rather than re-resolved: a retry is meant to
   * finish the import that was asked for, and quietly picking up whatever the
   * branch points at now would make the second attempt a different dataset from
   * the first. A row that never got as far as resolving falls back to `main`.
   */
  async retryImport(
    datasetId: string,
    options: { includeVideos?: boolean } = {},
  ): Promise<{ datasetId: string; status: 'importing' }> {
    const existing = await datasetRepository.findById(datasetId);
    if (!existing) {
      throw new HuggingFaceImportError('NOT_FOUND', `Dataset not found: ${datasetId}`, 404);
    }
    const repoId = existing.huggingFaceRepoId;
    if (!repoId) {
      throw new HuggingFaceImportError(
        'NOT_AN_IMPORT',
        `Dataset ${datasetId} was not imported from HuggingFace; there is nothing to retry`,
        400,
      );
    }
    if (existing.status === 'importing' || existing.status === 'validating') {
      throw new HuggingFaceImportError(
        'IN_PROGRESS',
        `Dataset ${datasetId} is already ${existing.status}`,
        409,
      );
    }

    // A retry is also the door for "I imported the metadata, now fetch the
    // video": the caller may say so, and otherwise the row's own mode stands.
    const importMode: DatasetImportMode = options.includeVideos === undefined
      ? (existing.importMode ?? 'metadata')
      : (options.includeVideos ? 'full' : 'metadata');

    // Claimed BEFORE the two round-trips to the Hub below. Measured against the
    // running server: a second retry fired 150 ms after the first passed the
    // IN_PROGRESS guard, because the row was still `failed` while the first was
    // resolving the commit — and both then downloaded into the same directory.
    // The previous failure goes at the same time; it is not evidence about this
    // attempt.
    await datasetRepository.update(datasetId, { status: 'importing', importError: null });

    let sha: string;
    let license: string | null = null;
    let info: LeRobotInfoV3;
    let sink: ImportSink;
    try {
      const source = await this.resolveSource(repoId, existing.sourceRevision ?? 'main');
      sha = source.sha;
      license = source.license;
      // A row pinned to a sha resolves without a card request, so `license`
      // comes back null and the row would keep whatever it had — which for
      // every dataset imported before the licence was recorded is nothing.
      // Ask once, at the pinned commit, so a retry is how those rows catch up.
      if (license === null && !existing.sourceLicense) {
        license = (await this.fetchRepoInfo(repoId, sha)).license;
      }
      info = await this.fetchInfoJson(repoId, sha);
      sink = createSink(storageIdOf(existing.storagePath));
      await sink.prepare();
    } catch (error) {
      // The claim has to be released, or a repo that has been deleted leaves
      // the row `importing` for ever with nothing running.
      await this.recordFailure(datasetId, 'metadata', repoId, error);
      throw error;
    }

    await datasetRepository.update(datasetId, {
      status: 'importing',
      storagePath: sink.storagePath,
      sourceRevision: sha,
      // Only when this attempt actually learned one. A retry against a pinned
      // sha makes no card request, and `null` there means "did not ask", so
      // writing it would erase a licence the first import recorded.
      ...(license === null ? {} : { sourceLicense: license }),
      importMode,
    });

    this.emitProgress(datasetId, {
      datasetId,
      status: 'importing',
      phase: 'metadata',
      progress: 5,
      totalFiles: 0,
      completedFiles: 0,
    });

    this.runImport(datasetId, repoId, sha, sink, info, importMode === 'full').catch((error) => {
      console.error(`[HFImport] Background retry failed for ${datasetId}:`, error);
    });

    return { datasetId, status: 'importing' };
  }

  /**
   * What a repo holds, without importing a byte of it.
   *
   * This is what lets the modal say "1.0 GB, 402 episodes, 43-wide" before the
   * operator commits to a gigabyte. The tree API reports a size per file and
   * the import path used to throw every one of them away.
   */
  async previewRepo(repoId: string, revision = 'main'): Promise<HuggingFacePreview> {
    const repo = await this.fetchRepoInfo(repoId, revision);
    const info = await this.fetchInfoJson(repoId, repo.sha);
    const tree = await this.listRepoFiles(repoId, repo.sha);
    const selected = selectRepoFiles(tree, true);

    let dataBytes = 0;
    let videoBytes = 0;
    for (const file of selected) {
      if (isVideoPath(file.path)) videoBytes += file.size;
      else dataBytes += file.size;
    }

    const features = info.features ?? {};
    return {
      repoId,
      revision,
      resolvedRevision: repo.sha,
      lerobotVersion: info.codebase_version ?? 'unknown',
      robotType: info.robot_type ?? 'unknown',
      fps: info.fps ?? 0,
      totalEpisodes: info.total_episodes ?? 0,
      totalFrames: info.total_frames ?? 0,
      stateWidth: declaredFeatureWidth(info, 'observation.state') || null,
      actionWidth: declaredFeatureWidth(info, 'action') || null,
      cameraKeys: Object.entries(features)
        .filter(([, f]) => f?.dtype === 'video' || f?.dtype === 'image' || f?.video === true)
        .map(([key]) => key),
      // Counted and summed over the files an import would FETCH, not over the
      // whole repo: a README and a .gitattributes in the total would make the
      // number the modal shows disagree with the download it is warning about.
      fileCount: selected.length,
      dataBytes,
      videoBytes,
      license: repo.license,
    };
  }

  // ============================================================================
  // ROBOT TYPE RESOLUTION
  // ============================================================================

  /**
   * Resolve a robotTypeId from an explicit override or the HF info.json
   * robot_type field, creating a type only when nothing registered fits.
   */
  private async resolveRobotTypeId(
    requestedId: string | undefined,
    info: LeRobotInfoV3,
  ): Promise<string> {
    // Explicit override wins
    if (requestedId) {
      const rt = await robotTypeRepository.findById(requestedId);
      if (!rt) throw new Error(`Robot type not found: ${requestedId}`);
      return rt.id;
    }

    const hfRobotType = info.robot_type;
    const all = await robotTypeRepository.findAll();
    const matched = matchRobotType(all, hfRobotType);
    if (matched) return matched.id;

    // The dims come out of the manifest this service has already parsed.
    // Writing zeros here is what made the width check inert: `validateDataset`
    // treats 0 and "unknown" the same, so a 43-wide dataset on a 0-DOF robot
    // type reported no mismatch and read as validated.
    const actionDim = declaredFeatureWidth(info, 'action');
    const proprioceptionDim = declaredFeatureWidth(info, 'observation.state');
    if (actionDim === 0 || proprioceptionDim === 0) {
      throw new HuggingFaceImportError(
        'UNKNOWN_ROBOT_DIMS',
        `No registered robot type matches "${hfRobotType}", and info.json declares no `
        + `${actionDim === 0 ? 'action' : 'observation.state'} width to create one from. `
        + 'Pass robotTypeId to import this dataset against an existing robot type.',
      );
    }

    const created = await robotTypeRepository.create({
      name: hfRobotType,
      manufacturer: 'Unknown',
      model: hfRobotType,
      actionDim,
      proprioceptionDim,
    });
    console.log(
      `[HFImport] Created RobotType for "${hfRobotType}": ${created.id} `
      + `(action ${actionDim}, state ${proprioceptionDim})`,
    );
    return created.id;
  }

  // ============================================================================
  // INTERNAL: IMPORT PIPELINE
  // ============================================================================

  /**
   * Run the full import pipeline (called in background)
   */
  private async runImport(
    datasetId: string,
    repoId: string,
    revision: string,
    sink: ImportSink,
    info: LeRobotInfoV3,
    includeVideos: boolean
  ): Promise<void> {
    // Which phase a failure happened in is half of what makes it legible, and
    // the old catch hard-coded 'downloading' for all of them.
    let phase: HuggingFaceImportProgress['phase'] = 'metadata';
    try {
      // Phase 2: Build file list (from the authoritative repo tree)
      const files = await this.resolveFileList(repoId, revision, info, includeVideos);

      phase = 'downloading';
      this.emitProgress(datasetId, {
        datasetId,
        status: 'importing',
        phase,
        progress: 10,
        totalFiles: files.length,
        completedFiles: 0,
      });

      // Phase 3: Download the files into whichever store this deployment has
      await this.downloadFiles(datasetId, repoId, revision, sink, files);

      // Phase 4: Trigger validation via NATS
      phase = 'validating';
      this.emitProgress(datasetId, {
        datasetId,
        status: 'validating',
        phase,
        progress: 90,
        totalFiles: files.length,
        completedFiles: files.length,
      });

      await datasetRepository.update(datasetId, { status: 'validating' });

      if (natsClient.isConnected()) {
        const js = natsClient.getJetStream();
        if (js) {
          const payload = JSON.stringify({ datasetId, storagePath: sink.storagePath });
          // The msgID is per ATTEMPT, not per dataset.
          //
          // `validate-${datasetId}` sat inside JetStream's dedup window, so the
          // SECOND validation ever queued for a dataset was silently discarded
          // by the server — acked as a duplicate, no error here, no consumer
          // there. The row stays at `validating`, and `retryImport` refuses a
          // `validating` row with IN_PROGRESS, so the dataset is wedged for
          // good with no way out through the UI. Dedup is worth having for a
          // publish that is genuinely repeated; a retry is a new attempt and
          // must be allowed to queue its own work.
          await js.publish(DATASET_VALIDATION_SUBJECT, new TextEncoder().encode(payload), {
            msgID: `validate-${datasetId}-${uuidv4()}`,
          });
          console.log(`[HFImport] Queued validation job for ${datasetId}`);
        }
      } else {
        // Run validation synchronously if NATS not available
        await datasetService.validateAndUpdateDataset(datasetId, sink.storagePath);
      }

      // Emit completion
      this.emitProgress(datasetId, {
        datasetId,
        status: 'validating',
        phase: 'validating',
        progress: 95,
        totalFiles: files.length,
        completedFiles: files.length,
      });

      datasetService.emit('dataset:event', {
        type: 'dataset:import:completed',
        datasetId,
        timestamp: new Date().toISOString(),
      });

      console.log(`[HFImport] Import completed for ${datasetId} (${repoId})`);
    } catch (error) {
      console.error(`[HFImport] Import failed for ${datasetId}:`, error);

      await this.recordFailure(datasetId, phase, repoId, error);
    }
  }

  /**
   * Write why an import failed to the row, then say so on the wire.
   *
   * The row first and the broadcast second, deliberately. The broadcast used to
   * be the ONLY record, and for a failure that takes 300 ms it fires before the
   * browser has opened its socket: the card then said "Failed" and nothing
   * else, and no reload could recover the reason.
   */
  private async recordFailure(
    datasetId: string,
    phase: HuggingFaceImportProgress['phase'],
    repoId: string,
    error: unknown,
  ): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : String(error);

    await datasetRepository.update(datasetId, {
      status: 'failed',
      importError: {
        phase,
        error: errorMessage,
        repoId,
        failedAt: new Date().toISOString(),
      },
    });

    this.emitProgress(datasetId, {
      datasetId,
      status: 'failed',
      phase,
      progress: 0,
      error: errorMessage,
    });

    datasetService.emit('dataset:event', {
      type: 'dataset:import:failed',
      datasetId,
      error: errorMessage,
      timestamp: new Date().toISOString(),
    });
  }

  // ============================================================================
  // PHASE 1: FETCH METADATA
  // ============================================================================

  /**
   * The repo's commit at `revision`, plus the licence its card declares.
   */
  async fetchRepoInfo(
    repoId: string,
    revision: string,
  ): Promise<{ sha: string; license: string | null }> {
    const url = `${HF_API_BASE_URL}/${repoId}/revision/${encodeURIComponent(revision)}`;
    const response = await this.fetchWithRetry(url);

    // 401 and 403, not only 404. The Hub answers a repo that does not exist
    // with `401 Unauthorized`, deliberately — it will not confirm the existence
    // of something you cannot read, so a private repo and a typo look the same
    // from here. Measured live: `nobody/definitely-not-a-repo` comes back 401.
    // Reporting that as a 502 blames this server for the operator's typo.
    if (response.status === 404 || response.status === 401 || response.status === 403) {
      throw new HuggingFaceImportError(
        'REPO_NOT_FOUND',
        `No dataset repo you can read at ${repoId}@${revision} — it does not exist, `
        + 'is private, or is gated.',
        404,
      );
    }
    if (!response.ok) {
      throw new HuggingFaceImportError(
        'REPO_UNREACHABLE',
        `HuggingFace returned ${response.status} ${response.statusText} for ${repoId}@${revision}`,
        502,
      );
    }

    const body = (await response.json()) as {
      sha?: string;
      cardData?: { license?: string | string[] };
    };
    if (!body.sha) {
      throw new HuggingFaceImportError(
        'REVISION_UNRESOLVED',
        `HuggingFace did not report a commit for ${repoId}@${revision}`,
        502,
      );
    }
    const license = body.cardData?.license;
    return {
      sha: body.sha,
      license: Array.isArray(license) ? (license[0] ?? null) : (license ?? null),
    };
  }

  /**
   * A branch or tag turned into the commit it points at right now.
   *
   * A resolution failure is fatal rather than a fallback to the branch name.
   * Falling back would put the import exactly where it was — citing `main`,
   * which is the defect this resolves — and would do it silently.
   */
  async resolveRevision(repoId: string, revision: string): Promise<string> {
    return (await this.resolveSource(repoId, revision)).sha;
  }

  /**
   * The commit AND the declared licence, in one round trip.
   *
   * `resolveRevision` used to be the only caller of {@link fetchRepoInfo}, and
   * it returned the sha and discarded the licence — which is why an exported
   * run manifest reported `"license": "unknown"` for a repo whose card says
   * cc-by-4.0, and then attached a compliance note about the risk of training
   * on data of unknown licence. The information had already been fetched.
   *
   * A revision that is already a 40-hex sha needs no round trip, and there is
   * therefore no licence to report for it — `null` means "not learned here",
   * never "none declared", so a caller must not overwrite a stored licence
   * with it.
   */
  async resolveSource(repoId: string, revision: string): Promise<{ sha: string; license: string | null }> {
    if (SHA_RE.test(revision)) return { sha: revision, license: null };
    return this.fetchRepoInfo(repoId, revision);
  }

  /**
   * Fetch and parse info.json from HuggingFace
   */
  async fetchInfoJson(repoId: string, revision: string): Promise<LeRobotInfoV3> {
    const url = `${HF_BASE_URL}/${repoId}/resolve/${revision}/meta/info.json`;
    const response = await this.fetchWithRetry(url);

    if (response.status === 404) {
      throw new HuggingFaceImportError(
        'INFO_NOT_FOUND',
        `Failed to fetch info.json from ${repoId}: 404 ${response.statusText} — `
        + 'this repo does not look like a LeRobot dataset',
        404,
      );
    }
    if (!response.ok) {
      throw new Error(
        `Failed to fetch info.json from ${repoId}: ${response.status} ${response.statusText}`
      );
    }

    const info = (await response.json()) as LeRobotInfoV3;

    // Validate required fields
    if (!info.codebase_version) {
      throw new Error('info.json missing required field: codebase_version');
    }
    if (!info.robot_type) {
      throw new Error('info.json missing required field: robot_type');
    }
    if (typeof info.fps !== 'number' || info.fps <= 0) {
      throw new Error('info.json missing or invalid field: fps');
    }

    return info;
  }

  // ============================================================================
  // PHASE 2: BUILD FILE LIST
  // ============================================================================

  /**
   * Resolve the exact set of files to download.
   *
   * Prefers the authoritative HuggingFace repo tree, which handles LeRobot v3.0
   * datasets that split a single chunk across multiple files (data/videos named
   * file-000, file-001, …) — a layout the pattern-based {@link buildFileList}
   * cannot enumerate, so it silently dropped every file past file-000 (leaving
   * later episodes with no video). Falls back to the pattern-based list only if
   * the tree API is unavailable.
   */
  private async resolveFileList(
    repoId: string,
    revision: string,
    info: LeRobotInfoV3,
    includeVideos: boolean
  ): Promise<string[]> {
    let tree: RepoFile[] = [];
    try {
      tree = await this.listRepoFiles(repoId, revision);
    } catch (error) {
      console.warn(
        `[HFImport] Repo tree listing failed for ${repoId}; falling back to pattern-based file list:`,
        error
      );
    }

    if (tree.length === 0) {
      return this.buildFileList(info, includeVideos);
    }

    return selectRepoFiles(tree, includeVideos).map((file) => file.path);
  }

  /**
   * Every file path in a HuggingFace dataset repo, with its size, via the tree
   * API, following pagination (the `Link: …; rel="next"` header) for large
   * trees.
   */
  async listRepoFiles(repoId: string, revision: string): Promise<RepoFile[]> {
    const files: RepoFile[] = [];
    let url: string | undefined =
      `${HF_API_BASE_URL}/${repoId}/tree/${encodeURIComponent(revision)}?recursive=true`;

    // Guard against pathological pagination loops.
    for (let page = 0; page < 100 && url; page++) {
      const response = await this.fetchWithRetry(url);
      // Same three statuses as `fetchRepoInfo`: the Hub hides a repo you may
      // not read behind a 401 rather than admitting it is there.
      if ([404, 401, 403].includes(response.status)) {
        throw new HuggingFaceImportError(
          'REPO_NOT_FOUND', `No dataset repo you can read at ${repoId}`, 404,
        );
      }
      if (!response.ok) {
        throw new Error(`Tree API returned ${response.status} for ${repoId}`);
      }

      const entries = (await response.json()) as Array<{
        type: string;
        path: string;
        size?: number;
        lfs?: { size?: number };
      }>;
      for (const entry of entries) {
        if (entry.type !== 'file') continue;
        // An LFS-backed file's `size` is the real one, but the pointer size is
        // what a repo without the LFS metadata reports; take the larger.
        files.push({
          path: entry.path,
          size: Math.max(entry.size ?? 0, entry.lfs?.size ?? 0),
        });
      }

      // HuggingFace paginates large trees with a Link header cursor.
      const link = response.headers.get('link');
      const next = link ? /<([^>]+)>;\s*rel="next"/.exec(link) : null;
      url = next ? next[1] : undefined;
    }

    return files;
  }

  /**
   * Build the list of files to download based on info.json metadata
   */
  buildFileList(info: LeRobotInfoV3, includeVideos: boolean): string[] {
    const files: string[] = [];

    // Always include metadata files
    files.push('meta/info.json');
    files.push('meta/stats.json');

    // Build parquet file paths
    // LeRobot v3.0+: chunks_size = max episodes per chunk folder
    //   → file naming: data/chunk-000/file-000.parquet (one file per chunk)
    // LeRobot v1/v2: one parquet per episode
    //   → file naming: data/chunk-000/episode_000000.parquet
    const totalEpisodes = info.total_episodes ?? 0;
    const chunksSize = info.chunks_size ?? 1000;
    const totalChunks = info.total_chunks ?? Math.ceil(totalEpisodes / chunksSize);
    const isV3Format = (info.codebase_version ?? '').startsWith('v3');

    // v3.0 requires additional meta files that LeRobotDataset loads at init time:
    //   meta/tasks.parquet and meta/episodes/chunk-xxx/file-xxx.parquet
    if (isV3Format) {
      files.push('meta/tasks.parquet');
      for (let chunk = 0; chunk < totalChunks; chunk++) {
        const episodesChunkDir = `meta/episodes/chunk-${String(chunk).padStart(3, '0')}`;
        files.push(`${episodesChunkDir}/file-000.parquet`);
      }
    }

    for (let chunk = 0; chunk < totalChunks; chunk++) {
      const chunkDir = `data/chunk-${String(chunk).padStart(3, '0')}`;
      if (isV3Format) {
        // v3.0: one parquet file per chunk folder named file-000.parquet
        files.push(`${chunkDir}/file-000.parquet`);
      } else {
        // Legacy: one parquet per episode
        const episodesInChunk = Math.min(chunksSize, totalEpisodes - chunk * chunksSize);
        for (let ep = 0; ep < episodesInChunk; ep++) {
          const globalEp = chunk * chunksSize + ep;
          files.push(`${chunkDir}/episode_${String(globalEp).padStart(6, '0')}.parquet`);
        }
      }
    }

    // Include video files if requested
    // v3: one mp4 per chunk per feature — videos/{feature_key}/chunk-{c:03d}/file-{f:03d}.mp4
    // v1/v2: one mp4 per episode — videos/chunk-{c:03d}/{feature_key}/episode_{e:06d}.mp4
    if (includeVideos && info.features) {
      for (const [featureName, feature] of Object.entries(info.features)) {
        const isVideoFeature = feature.video === true || feature.dtype === 'video';
        if (!isVideoFeature) continue;
        for (let chunk = 0; chunk < totalChunks; chunk++) {
          if (isV3Format) {
            files.push(
              `videos/${featureName}/chunk-${String(chunk).padStart(3, '0')}/file-000.mp4`
            );
          } else {
            const chunkDir = `videos/chunk-${String(chunk).padStart(3, '0')}`;
            const episodesInChunk = Math.min(chunksSize, totalEpisodes - chunk * chunksSize);
            for (let ep = 0; ep < episodesInChunk; ep++) {
              const globalEp = chunk * chunksSize + ep;
              files.push(
                `${chunkDir}/${featureName}/episode_${String(globalEp).padStart(6, '0')}.mp4`
              );
            }
          }
        }
      }
    }

    return files;
  }

  // ============================================================================
  // PHASE 3: PARALLEL DOWNLOAD
  // ============================================================================

  /**
   * Download files from HuggingFace into the sink, with a concurrency limit.
   */
  private async downloadFiles(
    datasetId: string,
    repoId: string,
    revision: string,
    sink: ImportSink,
    files: string[]
  ): Promise<void> {
    let completedFiles = 0;
    const totalFiles = files.length;

    // Concurrency-limited parallel download.
    //
    // THE FIRST FAILURE STOPS ALL FIVE. `Promise.all` rejects the moment one
    // worker throws, but rejecting a promise does not cancel anything: the
    // other four went on shifting files off the shared queue and writing them
    // into the sink. `runImport` had already caught the rejection and marked
    // the row `failed`, so for the rest of a 960 MB download those four kept
    // filling a failed dataset's directory and — worse — kept calling
    // `emitProgress` with `status: 'importing'`, which flipped the operator's
    // card from Failed back to Importing and left it there.
    //
    // So the error is recorded rather than thrown, every worker checks the flag
    // before it takes more work, and the join waits for all five to really stop
    // before the failure is re-raised. When the caller marks the row failed,
    // nothing is still writing to it.
    const queue = [...files];
    const workers: Promise<void>[] = [];
    let failure: unknown = null;

    for (let i = 0; i < MAX_CONCURRENT_DOWNLOADS; i++) {
      workers.push(
        (async () => {
          while (queue.length > 0) {
            if (failure) return;
            const file = queue.shift();
            if (!file) break;

            const hfUrl = `${HF_BASE_URL}/${repoId}/resolve/${revision}/${file}`;

            try {
              await this.downloadFileToSink(hfUrl, file, sink);
            } catch (error) {
              // stats.json is optional — 404 is expected
              if (file === 'meta/stats.json' && error instanceof Error && error.message.includes('404')) {
                console.log(`[HFImport] stats.json not found (optional), skipping`);
              } else {
                failure ??= error;
                return;
              }
            }

            // A worker that raced past the check above must not report progress
            // for an import that has already failed.
            if (failure) return;

            completedFiles++;
            const downloadProgress = 10 + Math.round((completedFiles / totalFiles) * 80);

            this.emitProgress(datasetId, {
              datasetId,
              status: 'importing',
              phase: 'downloading',
              progress: downloadProgress,
              currentFile: file,
              totalFiles,
              completedFiles,
            });
          }
        })()
      );
    }

    await Promise.all(workers);
    if (failure) throw failure;
  }

  /**
   * Download a single file from HuggingFace and stream it into the sink.
   */
  private async downloadFileToSink(url: string, path: string, sink: ImportSink): Promise<void> {
    const response = await this.fetchWithRetry(url);

    if (!response.ok) {
      throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
    }

    await sink.write(path, response);
  }

  // ============================================================================
  // HTTP WITH RETRY
  // ============================================================================

  /**
   * Fetch with exponential backoff retry on 429 (rate limit)
   */
  async fetchWithRetry(url: string, maxRetries = 5): Promise<Response> {
    let delay = INITIAL_RETRY_DELAY_MS;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const response = await fetch(url);

      if (response.status !== 429) {
        return response;
      }

      if (attempt === maxRetries) {
        return response;
      }

      // Respect Retry-After header if present
      const retryAfter = response.headers.get('retry-after');
      const waitMs = retryAfter
        ? parseInt(retryAfter, 10) * 1000
        : delay;

      console.log(
        `[HFImport] Rate limited (429) on ${url}, retrying in ${waitMs}ms (attempt ${attempt + 1}/${maxRetries})`
      );

      await this.sleep(Math.min(waitMs, MAX_RETRY_DELAY_MS));
      delay = Math.min(delay * 2, MAX_RETRY_DELAY_MS);
    }

    // Unreachable, but TypeScript needs it
    throw new Error(`Max retries exceeded for ${url}`);
  }

  // ============================================================================
  // HELPERS
  // ============================================================================

  /**
   * Emit import progress via DatasetService events
   */
  private emitProgress(datasetId: string, progress: HuggingFaceImportProgress): void {
    datasetService.emit('dataset:event', {
      type: 'dataset:import:progress',
      datasetId,
      importProgress: progress,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ============================================================================
// FILE SELECTION
// ============================================================================

/**
 * A file that holds camera frames, in either of the two forms LeRobot uses.
 *
 * `videos/…mp4` for a `dtype: 'video'` feature, and `images/<key>/…` PNGs for a
 * `dtype: 'image'` one. They are one category as far as this import is
 * concerned — both are the heavy visual half of a dataset, both are what
 * `includeVideos` decides about, and `validateDataset` already treats a missing
 * one of either as the same class of problem.
 */
export function isVideoPath(path: string): boolean {
  return (path.startsWith('videos/') && path.endsWith('.mp4')) || path.startsWith('images/');
}

/**
 * The LeRobot files in a repo tree: all of `meta/`, every data parquet, and the
 * camera frames when they were asked for.
 *
 * Selecting by prefix and extension rather than by a presumed `file-000` name
 * is what makes a v3.0 chunk that spilled into `file-001` come across whole.
 *
 * `images/` is here because `dtype: 'image'` is not a rare shape — it is what a
 * dataset recorded without video encoding looks like, and plenty of Hub repos
 * are one. Selecting only `videos/` meant those repos downloaded their metadata
 * and parquet, then failed validation on `MISSING_IMAGE_FILES` for frames the
 * import had never asked for: an import that reports failure for doing exactly
 * what it was told.
 */
export function selectRepoFiles(tree: RepoFile[], includeVideos: boolean): RepoFile[] {
  return tree.filter(({ path }) => {
    if (path.startsWith('meta/')) return true;
    if (path.startsWith('data/') && path.endsWith('.parquet')) return true;
    if (path.startsWith('videos/')) return includeVideos && path.endsWith('.mp4');
    if (path.startsWith('images/')) return includeVideos;
    return false;
  });
}

/**
 * The registered robot type that IS this Hub `robot_type`, or null.
 *
 * Exported for the tests, because "does 'unitree_g1' find 'Unitree G1 EDU
 * (Dex3-1)'" is the whole of defect 5 and it should be answerable without an
 * import.
 */
export function matchRobotType(all: RobotType[], hfRobotType: string): RobotType | null {
  const wanted = slug(hfRobotType ?? '');
  if (!wanted) return null;
  const slugsOf = (rt: RobotType): string[] => [slug(rt.model ?? ''), slug(rt.name ?? '')];

  const exact = all.find((rt) => slugsOf(rt).includes(wanted));
  if (exact) return exact;

  for (const { pattern, slugs } of ROBOT_TYPE_ALIASES) {
    if (!pattern.test(wanted)) continue;
    for (const candidate of slugs) {
      const found = all.find((rt) => slugsOf(rt).includes(candidate));
      if (found) return found;
    }
  }

  // 'unitree_g1' against a row called 'Unitree G1 EDU (Dex3-1)': one name is a
  // prefix of the other, which beats minting a second row for the same machine.
  // Four characters minimum, so a `robot_type` of 'g1' does not adopt the first
  // row whose slug happens to start with it.
  return all.find((rt) => slugsOf(rt).some((s) => (
    s.length >= 4 && wanted.length >= 4 && (s.startsWith(wanted) || wanted.startsWith(s))
  ))) ?? null;
}

// ============================================================================
// SINGLETON EXPORT
// ============================================================================

export const huggingFaceImportService = HuggingFaceImportService.getInstance();
