/**
 * @file DatasetService.ts
 * @description Service for managing VLA training datasets with LeRobot v3 format support
 * @feature datasets
 */

import { createWriteStream, existsSync } from 'fs';
import { mkdtemp, rm, stat } from 'fs/promises';
import { pipeline } from 'stream/promises';
import { tmpdir } from 'os';
import { dirname, isAbsolute, join, resolve as resolvePath, sep } from 'path';
import { fileURLToPath } from 'url';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import {
  datasetRepository,
  robotTypeRepository,
  skillDefinitionRepository,
} from '../repositories/index.js';
// From the concrete module rather than the repository barrel: the barrel is a
// large surface and this is one repository. (`datasets.routes.ts` reads the
// episode-flag repository the same way.)
import { episodeRewardRepository } from '../repositories/EpisodeRewardRepository.js';
import { modelStorage, BUCKETS } from '../storage/model-storage.js';
import { getRustFSClient, isRustFSInitialized } from '../storage/rustfs-client.js';
import { DatasetStoreError, openDatasetTree } from './lerobot/DatasetTree.js';

/**
 * What a validation run concluded (TASK-217 review).
 *
 * `unavailable` is the one the caller must not turn into `status: 'failed'` —
 * the store could not be reached, so the dataset was never looked at.
 */
export type ValidationOutcome = 'ready' | 'failed' | 'unavailable';

/**
 * What {@link DatasetService.requestValidation} did with a request to validate.
 *
 * Deliberately not the validation's own verdict: as of TASK-219 the caller does
 * not wait for one. `POST /:id/validate` used to run the whole pass inside the
 * request — seconds to minutes of blocked event loop on a real dataset, during
 * which the server answered nothing else, health checks included.
 */
export type ValidationRequestState =
  /** Published to `jobs.dataset.validate`; the worker picks it up. */
  | 'queued'
  /** No NATS on this deployment — running in this process, off the request. */
  | 'started'
  /** One is already running for this dataset. Nothing new was started. */
  | 'in-flight'
  /** Nothing to open: neither backing store can be reached. Nothing started. */
  | 'store-unavailable';
import { ExtractError, extractDatasetArchive } from './lerobot/extractArchive.js';
import { validateDatasetStructure } from './lerobot/validateDataset.js';
import type {
  DatasetStructureReport,
  ExpectedDimensions,
  ValidationContext,
} from './lerobot/validateDataset.js';
import { prisma } from '../database/index.js';
import { ConflictError, NotFoundError } from '../utils/errors.js';
import {
  datasetViewService,
  DatasetViewError,
  isDatasetView,
} from './DatasetViewService.js';
import type {
  DatasetKind,
  DatasetSelection,
  ParentEpisodeMetadata,
  SelectedEpisode,
} from '../types/dataset-view.types.js';
import { natsClient } from '../messaging/index.js';
import { kvPut, kvGet, KV_STORE_NAMES } from '../messaging/kv-stores.js';
import type { KV } from 'nats';
import type {
  Dataset,
  DatasetStatus,
  CreateDatasetInput,
  UpdateDatasetInput,
  DatasetQueryParams,
  PaginatedResult,
  LeRobotInfo,
  LeRobotStats,
  EpisodeAnnotation,
} from '../types/vla.types.js';
import type {
  CreateDatasetDto,
  UpdateDatasetDto,
  DatasetListQuery,
  DatasetResponse,
  DatasetListResponse,
  QualityScoreBreakdown,
  DatasetValidationResult,
  DatasetValidationProgress,
  InitiateUploadResponse,
  DatasetStatsResponse,
  DatasetEvent,
  DatasetEventCallback,
  LeRobotInfoV3,
  LeRobotStatsV3,
} from '../types/dataset.types.js';
import { QUALITY_THRESHOLDS } from '../types/dataset.types.js';

// ============================================================================
// CONSTANTS
// ============================================================================

const DATASET_VALIDATION_SUBJECT = 'jobs.dataset.validate';
const DATASET_STATS_SUBJECT = 'jobs.dataset.compute-stats';
const DATASET_PROGRESS_KV_PREFIX = 'dataset.progress.';

/**
 * How long a started validation is assumed to still be running.
 *
 * The marker is cleared when `validateAndUpdateDataset` returns, which covers
 * every path this deployment runs — the in-process worker included. The lease
 * is the backstop for the one it does not cover: a job consumed by a worker in
 * another process, whose completion this process never sees. Without it a
 * crashed worker would make a dataset permanently unvalidatable.
 */
const VALIDATION_LEASE_MS = 15 * 60 * 1000;

/**
 * How many datasets' progress records this process keeps in memory.
 *
 * The in-memory copy exists for deployments with no NATS KV to write progress
 * into — every dev box. Bounded because it is keyed by dataset id and a
 * long-lived process would otherwise accumulate one entry per dataset it ever
 * validated; the oldest written is dropped first.
 */
const LOCAL_PROGRESS_MAX = 200;

/**
 * The object version an upload is presigned against, and the key it lands on.
 *
 * `modelStorage.getDatasetKey` builds `<name>/<version>/data.bin`, so this is
 * the ONE place that string is decided. It used to be decided in three.
 */
const UPLOAD_VERSION = 'upload';
function uploadObjectKey(id: string): string {
  return `${id}/${UPLOAD_VERSION}/data.bin`;
}

/**
 * The extension handed to `tar`, which dispatches on it.
 *
 * `.tar.gz` covers the modal's `.tar.gz` and `.tgz`; a plain `.tar` and a
 * `.zip` are both read by bsdtar regardless of the name, and gzip detection is
 * by magic number, so this is a hint rather than a contract.
 */
function uploadExtension(_id: string): string {
  return '.tar.gz';
}

/**
 * Where a dataset this server holds itself lives on disk.
 *
 * A volume, in a real deployment. Exported as of TASK-220 because the
 * HuggingFace import needs the same root when RustFS is not configured — and
 * RustFS being optional (it is down on every dev machine) is exactly why that
 * import used to die 300 ms in. Two conventions for "where datasets go" is how
 * a tree gets written to one place and looked for in another.
 */
export function datasetStorageRoot(): string {
  const configured = process.env.DATASET_UPLOAD_DIR;
  if (configured) return resolvePath(configured);
  return resolvePath(dirname(fileURLToPath(import.meta.url)), '../../data/uploaded-datasets');
}

// Quality scoring thresholds. Re-exported from the types module rather than
// declared twice: the same four numbers used to live here AND in
// `dataset.types.ts`, and nothing kept them equal.
const QUALITY = QUALITY_THRESHOLDS;

// ============================================================================
// DATASET VIEWS (TASK-240)
// ============================================================================

/**
 * The view-side columns of a `Dataset` row.
 *
 * A separate shape from the domain `Dataset` on purpose: a view is a Dataset
 * ROW so that every foreign key keeps working, but the columns that make it one
 * are plumbing, and only the handful of call sites that care about views read
 * them.
 */
export interface DatasetViewColumns {
  id: string;
  kind: string;
  parentDatasetId: string | null;
  selectionJson: string | null;
  frozenAt: Date | null;
  materializedPath: string | null;
}

/** What creating a view needs beyond the parent it is created from. */
export interface CreateDatasetViewInput {
  name: string;
  description?: string;
  selection: DatasetSelection;
}

/**
 * A view as the views API returns it.
 *
 * Deliberately NOT a `DatasetResponse`: the fields a view is interesting for —
 * what it was forked from, what it selects, whether it is pinned — do not
 * exist on a dataset, and the list a card renders ("142 of 400 episodes") needs
 * the parent's count beside the view's own.
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
  createdAt: Date;
  updatedAt: Date;
}

/** Frames per episode, and whether they were read or estimated. */
export interface EpisodeLengthReadout extends ParentEpisodeMetadata {
  /**
   * True when the lengths came from the dataset's own episode metadata.
   *
   * False means they were divided out of `totalFrames` because that metadata
   * could not be read, so they are a mean and not a measurement — which is
   * enough to size a card and NOT enough to validate a frame range against.
   */
  exact: boolean;
}

/**
 * The `Dataset` columns a view operation reads. Narrow on purpose: a view is
 * decided by six columns and nothing here wants the stats blobs.
 */
const VIEW_PARENT_SELECT = {
  id: true,
  name: true,
  kind: true,
  status: true,
  fps: true,
  robotTypeId: true,
  skillId: true,
  lerobotVersion: true,
  storagePath: true,
  demonstrationCount: true,
  totalFrames: true,
  totalDuration: true,
  parentDatasetId: true,
  selectionJson: true,
  frozenAt: true,
  materializedPath: true,
  description: true,
  createdAt: true,
  updatedAt: true,
} as const;

interface ViewParentRow {
  id: string;
  name: string;
  kind: string;
  status: string;
  fps: number;
  robotTypeId: string;
  skillId: string | null;
  lerobotVersion: string;
  storagePath: string;
  demonstrationCount: number;
  totalFrames: number;
  totalDuration: number;
  parentDatasetId: string | null;
  selectionJson: string | null;
  frozenAt: Date | null;
  materializedPath: string | null;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * The stored validation blob, parsed. `undefined` for null AND for unparseable,
 * because both mean the same to a reader: there is no report to show.
 */
function parseValidationJson(
  value: string | null | undefined,
): { breakdown?: QualityScoreBreakdown; report?: DatasetStructureReport; validatedAt?: string }
  | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as {
      breakdown?: QualityScoreBreakdown;
      report?: DatasetStructureReport;
      validatedAt?: string;
    };
  } catch {
    return undefined;
  }
}


/** The stored selection, or null for an absent or unparseable one. */
function parseSelectionJson(value: string | null): DatasetSelection | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as DatasetSelection;
  } catch {
    return null;
  }
}

/**
 * Frames per episode, read out of a dataset's own episode metadata.
 *
 * Three layouts, because this platform has all three on disk: the LeRobot v2.1
 * `meta/episodes.jsonl`, the Cosmos converter's `meta/episodes.json` array, and
 * v3.0's `meta/episodes/**` parquet shards. Returns null when none of them can
 * be read — an answer, not a failure: the caller falls back to a mean and stops
 * validating frame ranges it cannot check.
 *
 * Goes through `openDatasetTree`, so a dataset in RustFS answers as readily as
 * one on this disk.
 */
async function readEpisodeLengths(storagePath: string): Promise<number[] | null> {
  if (!storagePath) return null;
  let tree;
  try {
    tree = openDatasetTree(storagePath);
  } catch {
    return null;
  }
  if (!tree) return null;

  const fromRows = (rows: Array<{ episode_index?: unknown; length?: unknown }>): number[] => {
    // Indexed by episode_index rather than by position: the file is not
    // promised to be in order, and an off-by-one here silently trims the wrong
    // episode.
    const lengths: number[] = [];
    rows.forEach((row, i) => {
      const index = Number(row.episode_index ?? i);
      const length = Number(row.length ?? 0);
      if (Number.isFinite(index) && index >= 0) {
        lengths[index] = Number.isFinite(length) ? length : 0;
      }
    });
    for (let i = 0; i < lengths.length; i += 1) {
      if (lengths[i] === undefined) lengths[i] = 0;
    }
    return lengths;
  };

  try {
    for (const name of ['meta/episodes.json', 'meta/episodes.jsonl']) {
      const entry = await tree.stat(name);
      if (!entry) continue;
      const raw = (await tree.read(name)).toString('utf8');
      const rows = name.endsWith('.jsonl')
        ? raw
            .split('\n')
            .filter((line) => line.trim().length > 0)
            .map((line) => JSON.parse(line) as { episode_index?: unknown; length?: unknown })
        : (JSON.parse(raw) as Array<{ episode_index?: unknown; length?: unknown }>);
      if (Array.isArray(rows) && rows.length > 0) return fromRows(rows);
    }

    const shards = (await tree.list('meta/episodes')).filter((f) => f.path.endsWith('.parquet'));
    if (shards.length === 0) return null;
    const { ParquetReader } = await import('@dsnp/parquetjs');
    const rows: Array<{ episode_index?: unknown; length?: unknown }> = [];
    for (const shard of shards) {
      // Read whole: this is the manifest — one row of scalars per episode —
      // not the data. The data parquets are the ones read by footer.
      const reader = await ParquetReader.openBuffer(await tree.read(shard.path));
      try {
        const cursor = reader.getCursor();
        let row: Record<string, unknown> | null;
        while ((row = (await cursor.next()) as Record<string, unknown> | null)) {
          rows.push(row as { episode_index?: unknown; length?: unknown });
        }
      } finally {
        await reader.close().catch(() => undefined);
      }
    }
    return rows.length > 0 ? fromRows(rows) : null;
  } catch (error) {
    console.warn(`[DatasetService] Could not read episode lengths from ${storagePath}:`, error);
    return null;
  }
}

/** The mean episode length, repeated. A stand-in, never a measurement. */
function evenlySplitFrames(totalFrames: number, episodes: number): number[] {
  if (episodes <= 0) return [];
  const each = Math.max(0, Math.floor(totalFrames / episodes));
  return new Array(episodes).fill(each) as number[];
}

/**
 * A selection off the wire, checked into shape.
 *
 * Shape only — whether the episodes EXIST is a question about the parent and is
 * asked in `validateAgainstParent`. Both refuse rather than coerce: a client
 * that sent `episodeIndex: "3"` has a bug, and quietly accepting it puts a
 * different arm of an experiment in the database than the one it asked for.
 */
function normalizeSelection(raw: DatasetSelection | undefined): DatasetSelection {
  if (!raw || !Array.isArray(raw.episodes)) {
    throw new DatasetViewError(
      'selection must be an object with an `episodes` array',
      'VIEW_MALFORMED',
    );
  }
  if (raw.episodes.length === 0) {
    throw new DatasetViewError(
      'A view that selects no episodes is not a dataset',
      'VIEW_EMPTY_SELECTION',
    );
  }

  const episodes: SelectedEpisode[] = raw.episodes.map((ep, i) => {
    if (!ep || !Number.isInteger(ep.episodeIndex) || ep.episodeIndex < 0) {
      throw new DatasetViewError(
        `selection.episodes[${i}].episodeIndex must be a non-negative integer`,
        'VIEW_MALFORMED',
        { position: i },
      );
    }
    const out: SelectedEpisode = { episodeIndex: ep.episodeIndex };
    if (ep.start !== undefined && ep.start !== null) {
      if (!Number.isInteger(ep.start) || ep.start < 0) {
        throw new DatasetViewError(
          `selection.episodes[${i}].start must be a non-negative integer frame`,
          'VIEW_MALFORMED',
          { position: i },
        );
      }
      if (ep.start > 0) out.start = ep.start;
    }
    if (ep.end !== undefined && ep.end !== null) {
      if (!Number.isInteger(ep.end) || ep.end < 0) {
        throw new DatasetViewError(
          `selection.episodes[${i}].end must be a non-negative integer frame`,
          'VIEW_MALFORMED',
          { position: i },
        );
      }
      out.end = ep.end;
    }
    if (out.end !== undefined && out.end <= (out.start ?? 0)) {
      throw new DatasetViewError(
        `selection.episodes[${i}] trims episode ${ep.episodeIndex} to [${out.start ?? 0}, ${out.end}), `
        + 'which contains no frames',
        'VIEW_EMPTY_RANGE',
        { position: i, episodeIndex: ep.episodeIndex },
      );
    }
    return out;
  });

  const seen = new Set<number>();
  for (const ep of episodes) {
    if (seen.has(ep.episodeIndex)) {
      throw new DatasetViewError(
        `Episode ${ep.episodeIndex} appears more than once in the selection`,
        'VIEW_DUPLICATE_EPISODE',
        { episodeIndex: ep.episodeIndex },
      );
    }
    seen.add(ep.episodeIndex);
  }

  return { episodes, origin: normalizeOrigin(raw.origin) };
}

/** The origin, or `manual` — a selection with no recorded rule is a hand-made one. */
function normalizeOrigin(origin: DatasetSelection['origin'] | undefined): DatasetSelection['origin'] {
  if (!origin || typeof origin !== 'object') return { kind: 'manual' };
  switch (origin.kind) {
    case 'manual':
    case 'flags':
    case 'reward':
    case 'agent':
      return origin;
    default:
      return { kind: 'manual' };
  }
}

/**
 * Does the parent actually have what this selection names?
 *
 * The episode index is always checkable — the parent's `demonstrationCount` is
 * a column. A frame range is only checkable when the episode lengths were
 * really read; against a mean it would pass ranges that do not exist and fail
 * ones that do, so an unreadable parent refuses trims outright instead. That
 * refusal is recoverable (materialize the parent, or select whole episodes);
 * a view that claims frames nobody has is not.
 */
function validateAgainstParent(
  parent: { id: string; name: string; demonstrationCount: number },
  selection: DatasetSelection,
  metadata: EpisodeLengthReadout,
): void {
  for (const ep of selection.episodes) {
    if (ep.episodeIndex >= parent.demonstrationCount) {
      throw new DatasetViewError(
        `"${parent.name}" has ${parent.demonstrationCount} episode(s), so episode `
        + `${ep.episodeIndex} cannot be selected`,
        'VIEW_EPISODE_OUT_OF_RANGE',
        {
          parentDatasetId: parent.id,
          episodeIndex: ep.episodeIndex,
          parentCount: parent.demonstrationCount,
        },
      );
    }
    const trimmed = (ep.start ?? 0) > 0 || ep.end !== undefined;
    if (!trimmed) continue;
    if (!metadata.exact) {
      throw new DatasetViewError(
        `Episode lengths for "${parent.name}" could not be read, so a frame range cannot be checked `
        + 'against them. Select whole episodes, or materialize the parent first.',
        'VIEW_MALFORMED',
        { parentDatasetId: parent.id, episodeIndex: ep.episodeIndex },
      );
    }
    const length = metadata.episodeLengths[ep.episodeIndex] ?? 0;
    if ((ep.start ?? 0) >= length || (ep.end ?? length) > length) {
      throw new DatasetViewError(
        `Episode ${ep.episodeIndex} of "${parent.name}" is ${length} frames long, so `
        + `[${ep.start ?? 0}, ${ep.end ?? length}) is not inside it`,
        'VIEW_EPISODE_OUT_OF_RANGE',
        { parentDatasetId: parent.id, episodeIndex: ep.episodeIndex, episodeLength: length },
      );
    }
  }
}

// ============================================================================
// DATASET SERVICE
// ============================================================================

/**
 * Service for managing VLA training datasets
 */
export class DatasetService extends EventEmitter {
  private static instance: DatasetService;
  private initialized = false;
  private progressKV: KV | null = null;
  /** Dataset id → when its validation started. See {@link VALIDATION_LEASE_MS}. */
  private readonly validationsInFlight = new Map<string, number>();
  /**
   * Dataset id → the last progress record written for it, in this process.
   *
   * The KV store is the shared channel, and there isn't one unless NATS is
   * connected. See {@link getUploadProgress} for what depends on this.
   */
  private readonly localProgress = new Map<string, DatasetValidationProgress>();

  private constructor() {
    super();
  }

  /**
   * Get singleton instance
   */
  static getInstance(): DatasetService {
    if (!DatasetService.instance) {
      DatasetService.instance = new DatasetService();
    }
    return DatasetService.instance;
  }

  /**
   * Initialize the service
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Get progress KV store if NATS is connected
    if (natsClient.isConnected()) {
      try {
        this.progressKV = await natsClient.getKV(KV_STORE_NAMES.JOB_PROGRESS);
      } catch (error) {
        console.warn('[DatasetService] Could not get progress KV store:', error);
      }
    }

    this.initialized = true;
    console.log('[DatasetService] Initialized');
  }

  /**
   * Check if service is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  // ============================================================================
  // CRUD OPERATIONS
  // ============================================================================

  /**
   * Create a new dataset record
   */
  async create(dto: CreateDatasetDto): Promise<DatasetResponse> {
    // robotTypeId is required
    if (!dto.robotTypeId) {
      throw new Error('robotTypeId is required');
    }

    // Validate robotTypeId exists
    const robotType = await robotTypeRepository.findById(dto.robotTypeId);
    if (!robotType) {
      throw new Error(`Robot type not found: ${dto.robotTypeId}`);
    }

    // Validate skillId if provided
    if (dto.skillId) {
      const skill = await skillDefinitionRepository.findById(dto.skillId);
      if (!skill) {
        throw new Error(`Skill not found: ${dto.skillId}`);
      }
    }

    // Two very different things share this door.
    //
    // Without `storagePath`: mint an empty dataset and a prefix to upload into.
    // Everything is zero because nothing has been uploaded yet, and `uploading`
    // is the honest status.
    //
    // With `storagePath`: something already produced a dataset — the robot's
    // own episode recorder (TASK-215), a curation run, a converter — and this
    // is a registration, not a reservation. Zeroing fps and frame counts here
    // would throw away numbers the caller measured, and calling it `uploading`
    // would leave a finished dataset waiting forever for an upload that is not
    // coming.
    const registering = typeof dto.storagePath === 'string' && dto.storagePath.trim().length > 0;
    const storagePath = registering ? dto.storagePath!.trim() : `${uuidv4()}/`;

    // A registration says "there is already a dataset here". Take the claim
    // seriously for a LOCAL path, which this server can check: a row marked
    // `ready` pointing at an empty or missing directory is a dataset that
    // appears in the list, offers itself for training, and fails hours later
    // inside a job. A RustFS prefix is not checkable from here and is taken on
    // trust, exactly as `exportToLeRobot` already does.
    if (registering && isAbsolute(storagePath)) {
      if (!existsSync(storagePath)) {
        throw new Error(`storagePath does not exist: ${storagePath}`);
      }
      if (!existsSync(join(storagePath, 'meta', 'info.json'))) {
        throw new Error(
          `storagePath is not a LeRobot dataset — no meta/info.json under ${storagePath}`
        );
      }
    }

    const input: CreateDatasetInput = {
      name: dto.name,
      description: dto.description,
      robotTypeId: dto.robotTypeId,
      skillId: dto.skillId,
      storagePath,
      lerobotVersion: dto.lerobotVersion ?? 'v3.0',
      fps: registering ? (dto.fps ?? 0) : 0,
      totalFrames: registering ? (dto.totalFrames ?? 0) : 0,
      totalDuration: registering ? (dto.totalDuration ?? 0) : 0,
      demonstrationCount: registering ? (dto.demonstrationCount ?? 0) : 0,
      status: registering ? 'ready' : 'uploading',
      ...(registering && dto.infoJson
        ? { infoJson: dto.infoJson as unknown as CreateDatasetInput['infoJson'] }
        : {}),
    };

    const dataset = await datasetRepository.create(input);
    const response = await this.toResponse(dataset);

    // Emit event
    this.emitEvent({
      type: 'dataset:created',
      datasetId: dataset.id,
      dataset: response,
      timestamp: new Date().toISOString(),
    });

    console.log(`[DatasetService] Dataset created: ${dataset.id}`);
    return response;
  }

  /**
   * Get a dataset by ID
   */
  async get(id: string): Promise<DatasetResponse | null> {
    const dataset = await datasetRepository.findById(id);
    if (!dataset) {
      return null;
    }
    const views = await this.loadViewColumns([id]);
    return this.toResponse(dataset, views.get(id));
  }

  /**
   * Get the VLM annotations of a dataset (lerobot-annotate, TASK-179 §4).
   * Returns null when the dataset does not exist.
   */
  async getAnnotations(id: string): Promise<EpisodeAnnotation[] | null> {
    const dataset = await datasetRepository.findById(id);
    if (!dataset) {
      return null;
    }
    return dataset.annotations ?? [];
  }

  /**
   * List datasets with filtering and pagination
   */
  async list(query: DatasetListQuery): Promise<DatasetListResponse> {
    const params: DatasetQueryParams = {
      robotTypeId: query.robotTypeId,
      skillId: query.skillId,
      status: query.status,
      minQualityScore: query.minQuality,
      page: query.page ?? 1,
      pageSize: query.limit ?? 20,
    };

    const result = await datasetRepository.findAll(params);

    const views = await this.loadViewColumns(result.data.map((d) => d.id));
    const data = await Promise.all(result.data.map((d) => this.toResponse(d, views.get(d.id))));

    return {
      data,
      pagination: {
        page: result.pagination.page,
        limit: result.pagination.pageSize,
        total: result.pagination.total,
        totalPages: result.pagination.totalPages,
      },
    };
  }

  /**
   * Update dataset metadata
   */
  async update(id: string, dto: UpdateDatasetDto): Promise<DatasetResponse | null> {
    const existing = await datasetRepository.findById(id);
    if (!existing) {
      return null;
    }

    // Validate skillId if provided
    if (dto.skillId) {
      const skill = await skillDefinitionRepository.findById(dto.skillId);
      if (!skill) {
        throw new Error(`Skill not found: ${dto.skillId}`);
      }
    }

    const updateInput: UpdateDatasetInput = {
      name: dto.name,
      description: dto.description,
      skillId: dto.skillId,
      huggingFaceRepoId: dto.huggingFaceRepoId,
    };

    const updated = await datasetRepository.update(id, updateInput);
    if (!updated) {
      return null;
    }

    const views = await this.loadViewColumns([id]);
    const response = await this.toResponse(updated, views.get(id));

    // Emit event
    this.emitEvent({
      type: 'dataset:updated',
      datasetId: id,
      dataset: response,
      timestamp: new Date().toISOString(),
    });

    return response;
  }

  /**
   * Delete a dataset (DB record + storage)
   *
   * ORDER IS THE WHOLE POINT HERE. This method removes the bytes first and the
   * row second, and `datasetRepository.delete` swallows its error and returns
   * `false`. That was survivable while every foreign key pointing at `Dataset`
   * was `ON DELETE SET NULL` — `TrainingJob.datasetId` still is. It stopped
   * being survivable when `TrainingJobDataset.datasetId` arrived as `ON DELETE
   * RESTRICT`: deleting a dataset that a mixture names would `rm -rf` the tree
   * and empty the bucket, then fail to delete the row, then answer 404. The
   * dataset stays listed as `ready`, pointing at a directory that is gone.
   *
   * So membership is asked BEFORE anything is destroyed. Refusing is also the
   * honest answer on its own terms: an exported run manifest cites these
   * datasets by id, and a job whose members can evaporate cannot be reproduced.
   */
  async delete(id: string): Promise<boolean> {
    const dataset = await datasetRepository.findById(id);
    if (!dataset) {
      return false;
    }

    // A frozen view is one a run trained on, and this is the door every
    // delete comes through — the ordinary `DELETE /api/datasets/:id` as well
    // as the views endpoint — so the refusal lives here rather than in one of
    // them (TASK-240).
    const own = (await this.loadViewColumns([id])).get(id);
    if (own && isDatasetView(own) && own.frozenAt) {
      throw await this.frozenViewConflict(id, dataset.name, own.frozenAt);
    }

    // Forks first (TASK-240). A view's every episode is an index INTO this
    // dataset, so a view whose parent is gone is not a dataset at all — the
    // foreign key is `ON DELETE RESTRICT` for exactly that reason. Asked here
    // so the operator is told WHICH views hold it, rather than meeting a raw
    // constraint violation after the bytes have already been removed below.
    const derived = await prisma.dataset.findMany({
      where: { parentDatasetId: id },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    if (derived.length > 0) {
      const shown = derived.slice(0, 5).map((v) => `"${v.name}"`).join(', ');
      const rest = derived.length > 5 ? ` and ${derived.length - 5} more` : '';
      throw new ConflictError(
        `"${dataset.name}" has ${derived.length} view${derived.length === 1 ? '' : 's'} forked from `
        + `it (${shown}${rest}). Those views hold no data of their own — every episode they name is `
        + 'an episode of this dataset — so deleting it would leave them unresolvable. Delete the '
        + 'views first, or keep the dataset.',
        { derivedDatasetIds: derived.map((v) => v.id) },
      );
    }

    const heldBy = await prisma.trainingJobDataset.findMany({
      where: { datasetId: id },
      select: { trainingJobId: true },
      orderBy: { trainingJobId: 'asc' },
    });
    if (heldBy.length > 0) {
      const jobIds = [...new Set(heldBy.map((row) => row.trainingJobId))];
      const shown = jobIds.slice(0, 5).join(', ');
      const rest = jobIds.length > 5 ? ` and ${jobIds.length - 5} more` : '';
      throw new ConflictError(
        `"${dataset.name}" is a member of ${jobIds.length} training `
        + `${jobIds.length === 1 ? 'job' : 'jobs'} (${shown}${rest}), so deleting it would leave `
        + 'those runs citing data that no longer exists. Delete the training jobs first, or keep '
        + 'the dataset.',
      );
    }

    // Delete from storage if RustFS is available.
    //
    // Both versions, because an uploaded dataset's archive lives under
    // `<id>/upload/data.bin` since TASK-217 and the delete still asked for
    // `<id>/latest/data.bin` — so every uploaded dataset ever deleted left its
    // full archive in the bucket, paid for forever.
    if (isRustFSInitialized() && dataset.storagePath) {
      for (const version of ['latest', UPLOAD_VERSION]) {
        try {
          await modelStorage.deleteDataset(id, version);
        } catch (error) {
          console.warn(`[DatasetService] Failed to delete ${version} storage for ${id}:`, error);
        }
      }
    }

    // And the trees on local disk, which nothing else ever removes.
    //
    // TWO conventions, because there are two writers. `unpackUploadedArchive`
    // names its directory after the dataset id. The Hub importer does not: it
    // mints a fresh uuid for the storage prefix (`createSink(uuidv4())`), so a
    // 960 MB GR00T import lives under a directory whose name appears nowhere
    // except `storagePath`. Deleting only `<id>/` left every imported dataset's
    // bytes on disk for ever, and the bigger the dataset the more it cost.
    //
    // `storagePath` is a database column, so it is not joined blindly: a path
    // outside the dataset root is ignored rather than removed. `rm -rf` on an
    // unvalidated column is how a bug becomes a catastrophe.
    const root = datasetStorageRoot();
    const targets = new Set<string>([join(root, id)]);
    const stored = (dataset.storagePath ?? '').replace(/[\\/]+$/, '');
    if (stored) {
      const resolved = resolvePath(isAbsolute(stored) ? stored : join(root, stored));
      if (resolved !== root && resolved.startsWith(root + sep)) {
        targets.add(resolved);
      }
    }
    try {
      for (const target of targets) {
        await rm(target, { recursive: true, force: true });
      }
    } catch (error) {
      console.warn(`[DatasetService] Failed to remove the unpacked upload for ${id}:`, error);
    }

    // Delete from database
    const deleted = await datasetRepository.delete(id);

    if (deleted) {
      // Emit event
      this.emitEvent({
        type: 'dataset:deleted',
        datasetId: id,
        timestamp: new Date().toISOString(),
      });

      console.log(`[DatasetService] Dataset deleted: ${id}`);
    }

    return deleted;
  }

  // ============================================================================
  // UPLOAD WORKFLOW
  // ============================================================================

  /**
   * Initiate dataset upload - get presigned URL
   */
  async initiateUpload(
    id: string,
    contentType = 'application/octet-stream',
    size?: number
  ): Promise<InitiateUploadResponse> {
    const dataset = await datasetRepository.findById(id);
    if (!dataset) {
      throw new Error(`Dataset not found: ${id}`);
    }

    if (dataset.status !== 'uploading') {
      throw new Error(`Dataset upload already completed or in progress: ${id}`);
    }

    if (!isRustFSInitialized()) {
      throw new Error('Storage service not available');
    }

    // ONE key, named once. These were three different strings: the presigned
    // URL wrote `<id>/latest/data.bin` (`modelStorage.getDatasetKey`), the
    // response told the caller the object was `<id>/data.tar.gz`, and
    // `validateStructure` then looked for `<id>/meta/info.json` — an unpacked
    // tree nothing ever unpacked. The modal's only possible outcome was
    // `failed`. `completeUpload` now extracts what was actually uploaded.
    const uploadUrl = await modelStorage.getDatasetUploadUrl(id, UPLOAD_VERSION, contentType);

    // Emit event
    this.emitEvent({
      type: 'dataset:upload:initiated',
      datasetId: id,
      timestamp: new Date().toISOString(),
    });

    return {
      uploadUrl,
      expiresIn: 3600, // 1 hour
      storagePath: uploadObjectKey(id),
    };
  }

  /**
   * Complete dataset upload - trigger validation
   */
  async completeUpload(id: string): Promise<void> {
    const dataset = await datasetRepository.findById(id);
    if (!dataset) {
      throw new Error(`Dataset not found: ${id}`);
    }

    if (dataset.status !== 'uploading') {
      throw new Error(`Dataset not in uploading state: ${id} (status: ${dataset.status})`);
    }

    // Update status to validating
    await datasetRepository.update(id, { status: 'validating' });

    // Emit upload completed event
    this.emitEvent({
      type: 'dataset:upload:completed',
      datasetId: id,
      timestamp: new Date().toISOString(),
    });

    // Unpack what was uploaded, before anything tries to read it as a tree.
    let storagePath = dataset.storagePath;
    try {
      storagePath = await this.unpackUploadedArchive(id);
    } catch (error) {
      const code = error instanceof ExtractError ? error.code : 'UNPACK_FAILED';
      const detail = error instanceof Error ? error.message : String(error);
      console.error(`[DatasetService] Unpacking upload for ${id} failed: ${code}: ${detail}`);
      await datasetRepository.update(id, { status: 'failed' });
      await this.updateValidationProgress(id, {
        datasetId: id,
        status: 'failed',
        progress: 100,
        message: 'Could not unpack the uploaded archive',
        errors: [`${code}: ${detail}`],
      });
      this.emitEvent({
        type: 'dataset:validation:failed',
        datasetId: id,
        error: `${code}: ${detail}`,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Queue validation job if NATS is available
    if (natsClient.isConnected()) {
      await this.queueValidationJob(id, storagePath);
    } else {
      // If NATS not available, run validation synchronously (for development)
      console.log(`[DatasetService] NATS not available, running validation synchronously for ${id}`);
      await this.validateAndUpdateDataset(id, storagePath);
    }
  }

  /**
   * Download the uploaded archive, unpack it, and put the tree where the
   * readers look.
   *
   * Returns the `storagePath` the dataset should now carry. Unpacking to a
   * LOCAL directory rather than back into the bucket, because the local tree is
   * what every reader in this repo can already serve — including a v3.0 tree,
   * through `resolveLocalView`. `DATASET_UPLOAD_DIR` points it at a volume in a
   * deployment where the pod's own disk is ephemeral.
   */
  private async unpackUploadedArchive(id: string): Promise<string> {
    if (!isRustFSInitialized()) {
      throw new ExtractError('STORAGE_UNAVAILABLE', 'Storage service not available');
    }
    const key = uploadObjectKey(id);

    const scratch = await mkdtemp(join(tmpdir(), `dataset-upload-${id}-`));
    // The name carries the extension `tar` dispatches on, so a `.zip` upload
    // reaches bsdtar as a zip rather than as an unknown blob.
    const archive = join(scratch, `upload${uploadExtension(id)}`);
    try {
      // Streamed, not buffered. `download()` accumulates the whole object in
      // chunks and then `Buffer.concat`s it, so a 10 GB dataset tarball — an
      // ordinary size for the multi-camera recordings this feature exists to
      // accept — was materialised twice in the API process before a byte
      // reached disk, taking every other request down with it.
      const source = await modelStorage.getDatasetStream(id, UPLOAD_VERSION);
      await pipeline(source, createWriteStream(archive));
      const written = await stat(archive);
      if (written.size === 0) {
        throw new ExtractError('EMPTY_UPLOAD', `${key} is zero bytes — nothing was uploaded`);
      }
      const target = join(datasetStorageRoot(), id);
      await rm(target, { recursive: true, force: true });
      const { datasetRoot, symlinksRemoved } = await extractDatasetArchive(archive, target);
      if (symlinksRemoved > 0) {
        console.warn(`[DatasetService] ${id}: removed ${symlinksRemoved} symlink(s) from the upload`);
      }
      const storagePath = `${datasetRoot}/`;
      await datasetRepository.update(id, { storagePath });
      return storagePath;
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  }

  /**
   * The progress of the validation pass running for this dataset, if any.
   *
   * KV first — it is the only channel that can carry a worker in ANOTHER
   * process — and this process's own copy when there is nothing in it.
   *
   * That fallback is not a nicety. `POST /:id/validate` answers 202 and tells
   * the caller to poll `GET /:id/progress` for the verdict, and on a deployment
   * with no NATS (every dev box) there is no KV, so this returned null and the
   * route fell back to the dataset ROW — which still holds the previous pass's
   * status at 100%. A validation that had not begun was then indistinguishable
   * from one that had finished and passed.
   */
  async getUploadProgress(id: string): Promise<DatasetValidationProgress | null> {
    if (this.progressKV) {
      const key = `${DATASET_PROGRESS_KV_PREFIX}${id}`;
      const shared = await kvGet<DatasetValidationProgress>(this.progressKV, key);
      if (shared) return shared;
    }

    const local = this.localProgress.get(id);
    if (!local) return null;
    // An unfinished record for a pass this process is no longer running — a job
    // consumed by a worker elsewhere, whose completion it cannot hear without a
    // KV — would otherwise read "validating" forever. Past the lease, the row
    // is the better answer. Same backstop {@link isValidating} uses.
    if (local.progress < 100 && !this.isValidating(id)) {
      this.localProgress.delete(id);
      return null;
    }
    return local;
  }

  // ============================================================================
  // VALIDATION
  // ============================================================================

  /**
   * Queue validation job via NATS
   */
  private async queueValidationJob(datasetId: string, storagePath: string): Promise<void> {
    const js = natsClient.getJetStream();
    if (!js) {
      throw new Error('JetStream not available');
    }

    const payload = JSON.stringify({
      datasetId,
      storagePath,
    });

    // The msgID is per ATTEMPT, not per dataset.
    //
    // `validate-${datasetId}` sat inside the DATASET_VALIDATION stream's
    // 5-minute `duplicate_window` (see `messaging/streams.ts`), so the SECOND
    // validation queued for a dataset inside that window was discarded by the
    // server: acked as a duplicate, no error here, no message on the stream and
    // no consumer ever delivered it. With `POST /:id/validate` on this path
    // that is a dataset an operator cannot re-check — the request is answered
    // 202, nothing runs, and the in-flight marker below then refuses every
    // further attempt for the whole lease. `HuggingFaceImportService` hit this
    // exact bug and fixed it the same way; so did `computeStats`. Dedup is
    // worth having for a publish that is genuinely repeated (a retried write of
    // the same message); a new request is new work and must queue its own.
    const ack = await js.publish(DATASET_VALIDATION_SUBJECT, new TextEncoder().encode(payload), {
      msgID: `validate-${datasetId}-${uuidv4()}`,
    });

    // Cannot happen with a per-attempt id, and it is checked anyway because the
    // failure it would cause is silent: a duplicate ack means the job is NOT on
    // the stream, so claiming it is queued and marking the dataset in flight
    // would lock it out of validation for the lease over work nobody will do.
    if (ack?.duplicate) {
      throw new Error(
        `JetStream discarded the validation job for ${datasetId} as a duplicate — nothing was queued`,
      );
    }

    this.markValidationStarted(datasetId);
    console.log(`[DatasetService] Queued validation job for dataset: ${datasetId}`);

    // Emit validation started event
    this.emitEvent({
      type: 'dataset:validation:started',
      datasetId,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Start a validation for this dataset WITHOUT waiting for its verdict.
   *
   * The whole point of TASK-219. `POST /:id/validate` awaited
   * `validateAndUpdateDataset`, which opens every file the manifest names — so
   * one click held the request, and the event loop with it, for as long as that
   * took. It now returns as soon as the work is accepted, and the answer is
   * read from the row or from `GET /:id/progress`, the channel the upload flow
   * already polls.
   *
   * Where the work runs depends on what this deployment has:
   *
   * - NATS connected → published to `jobs.dataset.validate`, run by
   *   `dataset-validation.worker`, exactly as `completeUpload` has always done.
   * - No NATS (every dev box, and NATS is optional by design) → run in THIS
   *   process, detached from the request. That is a smaller promise than a
   *   worker thread and it is stated plainly: the parquet decoding still
   *   happens here, interleaved with other requests. What it no longer does is
   *   hold a request open for it, and after the footer-read change the CPU it
   *   costs is milliseconds per file rather than seconds.
   *
   * Re-entry is refused rather than queued behind the running pass: two clicks
   * used to start two full passes over the same files, writing the same row.
   */
  async requestValidation(datasetId: string, storagePath: string): Promise<ValidationRequestState> {
    if (this.isValidating(datasetId)) return 'in-flight';

    // Cheap, and it keeps the 503 the route has always answered: a dataset
    // whose store cannot be reached is not "queued", it is "nothing to open".
    if (!openDatasetTree(storagePath)) return 'store-unavailable';

    const viaQueue = natsClient.isConnected();

    // Marked BEFORE anything is awaited, on BOTH paths, so a second request
    // landing in the same tick is refused rather than starting a second pass.
    // The check above and this line have to be one synchronous step: when the
    // mark waited for the JetStream publish, two clicks both passed the check
    // and both published, and the guard the whole endpoint depends on was doing
    // nothing — the JetStream dedup was, by discarding the second job (which is
    // its own bug, see `queueValidationJob`).
    this.markValidationStarted(datasetId);
    try {
      // The caller is told to poll `GET /:id/progress` for the verdict, so that
      // channel must stop reporting the PREVIOUS pass's the moment this one is
      // accepted. Without this the first poll after a 202 answered with the old
      // status at 100% — a pass that had not started, reported as one that had
      // finished and passed.
      //
      // The dataset ROW is deliberately left where it is. A `ready` dataset
      // being re-checked is still usable, and a row flipped to `validating` by
      // a pass that then dies with its process is a row nothing clears — the
      // wedge `HuggingFaceImportService.retryImport` already has to work around.
      await this.updateValidationProgress(datasetId, {
        datasetId,
        status: 'validating',
        progress: 0,
        message: viaQueue ? 'Queued for validation' : 'Validation started',
      });

      if (viaQueue) {
        await this.queueValidationJob(datasetId, storagePath);
        return 'queued';
      }

      this.emitEvent({
        type: 'dataset:validation:started',
        datasetId,
        timestamp: new Date().toISOString(),
      });
      setImmediate(() => {
        void this.validateAndUpdateDataset(datasetId, storagePath).catch((error: unknown) => {
          // `validateAndUpdateDataset` records its own failures; this catch is
          // for the ones it cannot, so a detached run can never take the process
          // down with an unhandled rejection.
          console.error(`[DatasetService] Detached validation for ${datasetId} threw:`, error);
        });
      });
      return 'started';
    } catch (error) {
      // Nothing was started, so nothing may hold the marker: leaving it set
      // would refuse every retry until the lease expired.
      this.validationsInFlight.delete(datasetId);
      this.localProgress.delete(datasetId);
      throw error;
    }
  }

  /** Whether a validation for this dataset is running (or recently started). */
  isValidating(datasetId: string): boolean {
    const startedAt = this.validationsInFlight.get(datasetId);
    if (startedAt === undefined) return false;
    if (Date.now() - startedAt > VALIDATION_LEASE_MS) {
      this.validationsInFlight.delete(datasetId);
      return false;
    }
    return true;
  }

  private markValidationStarted(datasetId: string): void {
    this.validationsInFlight.set(datasetId, Date.now());
  }

  /**
   * Open a dataset and say whether it is structurally sound.
   *
   * Delegates to {@link validateDatasetStructure}, which reads the files
   * `info.json` names rather than checking that `info.json` itself is there.
   * The version of this that shipped until TASK-217 confirmed four fields were
   * present in one JSON file and called it validated — it never opened a
   * parquet, never confirmed a video existed, and did not run at all for a
   * dataset on local disk, which is every dataset this platform produces.
   *
   * `robotTypeId` is optional because a caller that has it gets the width check
   * against the robot's declared `proprioceptionDim`/`actionDim`, and one that
   * does not still gets everything else.
   */
  async validateStructure(
    storagePath: string,
    robotTypeId?: string,
    context: ValidationContext = {},
  ): Promise<DatasetValidationResult> {
    const result: DatasetValidationResult = {
      valid: false,
      errors: [],
      warnings: [],
      episodeCount: 0,
      totalFrames: 0,
      totalDuration: 0,
      lerobotVersion: 'unknown',
      fps: 0,
    };

    const tree = openDatasetTree(storagePath);
    if (!tree) {
      // Not "this dataset is broken" — nowhere to look. Recording it as a
      // validation failure would mark a perfectly good dataset failed because
      // an object store was down.
      result.errors.push('Storage service not available');
      result.storeUnavailable = true;
      return result;
    }

    let expected: ExpectedDimensions = {};
    if (robotTypeId) {
      try {
        const robotType = await robotTypeRepository.findById(robotTypeId);
        if (robotType) {
          expected = {
            proprioceptionDim: robotType.proprioceptionDim,
            actionDim: robotType.actionDim,
          };
        }
      } catch {
        // A robot type we cannot read costs the width check, not the run.
      }
    }

    let report: DatasetStructureReport;
    try {
      report = await validateDatasetStructure(tree, expected, context);
    } catch (error) {
      // A store that could not answer is not a dataset that is wrong. Marking
      // it `failed` here is what the guard above exists to prevent, and it was
      // reachable through this catch until the TASK-217 review found it.
      if (error instanceof DatasetStoreError) {
        result.errors.push(error.message);
        result.storeUnavailable = true;
        return result;
      }
      result.errors.push(`Validation error: ${error instanceof Error ? error.message : String(error)}`);
      return result;
    }

    result.valid = report.valid;
    result.errors = report.errors.map((f) => f.message);
    result.warnings = report.warnings.map((f) => f.message);
    result.episodeCount = report.episodeCount;
    result.totalFrames = report.totalFrames;
    result.totalDuration = report.totalDuration;
    result.lerobotVersion = report.lerobotVersion;
    result.fps = report.fps;
    result.info = report.info as LeRobotInfoV3 | undefined;
    result.stats = report.stats as LeRobotStatsV3 | undefined;
    result.report = report;
    return result;
  }

  /**
   * Validate and update dataset (called by worker or synchronously)
   *
   * Marks the dataset as being validated for as long as this runs, whichever
   * caller it came from — the worker, `completeUpload`, or a detached run — so
   * `requestValidation` can refuse to start a second pass over the same files.
   */
  async validateAndUpdateDataset(datasetId: string, storagePath: string): Promise<ValidationOutcome> {
    this.markValidationStarted(datasetId);
    try {
      // Update progress
      await this.updateValidationProgress(datasetId, {
        datasetId,
        status: 'validating',
        progress: 10,
        message: 'Validating dataset structure...',
      });

      // Validate structure. The robot type comes from the row so the vector
      // widths are checked against what this robot actually has — a 28-wide
      // state vector on a 43-DOF G1 EDU is a dataset that cannot train it, and
      // the error it produces at training time names neither number.
      const existing = await datasetRepository.findById(datasetId);
      // `importMode` travels with the row because the files cannot say it: a
      // metadata-only import is missing every mp4 its info.json declares, and
      // without this the validator reported one MISSING_VIDEO_FILE error per
      // declared video and marked the dataset failed for arriving as ordered.
      const validation = await this.validateStructure(storagePath, existing?.robotTypeId, {
        importMode: existing?.importMode,
      });

      await this.updateValidationProgress(datasetId, {
        datasetId,
        status: 'validating',
        progress: 50,
        message: 'Computing quality score...',
      });

      if (validation.storeUnavailable) {
        // Nothing was opened, so nothing is known. Leaving `status` alone is
        // the whole point: a dataset that was `ready` stays `ready` while the
        // store is down, and the caller is told to try again rather than shown
        // a red badge it cannot act on.
        await this.updateValidationProgress(datasetId, {
          datasetId,
          status: 'failed',
          progress: 100,
          message: 'Storage unavailable — nothing was validated',
          errors: validation.errors,
        });
        return 'unavailable';
      }

      if (!validation.valid) {
        // The report goes with the failure. A dataset marked `failed` with no
        // record of what was wrong sends whoever finds it back to the logs, and
        // the logs are on a machine they may not have.
        await datasetRepository.update(datasetId, {
          status: 'failed',
          validation: validation.report
            ? { validatedAt: new Date().toISOString(), report: validation.report }
            : undefined,
        });

        await this.updateValidationProgress(datasetId, {
          datasetId,
          status: 'failed',
          progress: 100,
          message: 'Validation failed',
          errors: validation.errors,
        });

        this.emitEvent({
          type: 'dataset:validation:failed',
          datasetId,
          error: validation.errors.join('; '),
          timestamp: new Date().toISOString(),
        });

        return 'failed';
      }

      // Compute quality score
      const qualityScore = this.computeQualityScore(validation);

      // Update dataset with validation results.
      //
      // The four measured numbers are written back now. They used to be
      // computed here and dropped, with a comment saying the repository could
      // not take them, so the row kept whatever the creating caller had read
      // out of `info.json` — which is exactly the number that is wrong when
      // the manifest and the files disagree, the case validation exists to
      // find. `UpdateDatasetInput` takes them as of TASK-217.
      const updateInput: UpdateDatasetInput = {
        status: 'ready',
        qualityScore: qualityScore.total,
        infoJson: validation.info as LeRobotInfo,
        statsJson: validation.stats as LeRobotStats,
        // Not rounded. `totalDuration` is derived from this number, so an Int
        // here made the row contradict itself for every recording whose rate
        // is not a whole number — which is most of them.
        fps: validation.fps || undefined,
        totalFrames: validation.totalFrames,
        totalDuration: parseFloat(validation.totalDuration.toFixed(3)),
        demonstrationCount: validation.episodeCount,
        lerobotVersion: validation.lerobotVersion !== 'unknown' ? validation.lerobotVersion : undefined,
        validation: validation.report
          ? { validatedAt: new Date().toISOString(), breakdown: qualityScore, report: validation.report }
          : undefined,
      };

      await datasetRepository.update(datasetId, updateInput);

      await this.updateValidationProgress(datasetId, {
        datasetId,
        status: 'ready',
        progress: 100,
        message: 'Validation completed successfully',
      });

      const response = await this.get(datasetId);

      this.emitEvent({
        type: 'dataset:validation:completed',
        datasetId,
        dataset: response ?? undefined,
        timestamp: new Date().toISOString(),
      });

      console.log(`[DatasetService] Dataset validated: ${datasetId} (score: ${qualityScore.total})`);
      return 'ready';

    } catch (error) {
      console.error(`[DatasetService] Validation error for ${datasetId}:`, error);

      await datasetRepository.update(datasetId, { status: 'failed' });

      await this.updateValidationProgress(datasetId, {
        datasetId,
        status: 'failed',
        progress: 100,
        message: 'Validation error',
        errors: [error instanceof Error ? error.message : String(error)],
      });

      this.emitEvent({
        type: 'dataset:validation:failed',
        datasetId,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      });
      return 'failed';
    } finally {
      this.validationsInFlight.delete(datasetId);
    }
  }

  /**
   * Record how far along a dataset's validation is.
   *
   * In the KV store when there is one — the only place a worker in another
   * process can be heard through — and always in this process's own map, which
   * is what `GET /:id/progress` reads on a deployment with no NATS.
   */
  private async updateValidationProgress(
    datasetId: string,
    progress: DatasetValidationProgress
  ): Promise<void> {
    this.rememberProgress(datasetId, progress);

    if (this.progressKV) {
      const key = `${DATASET_PROGRESS_KV_PREFIX}${datasetId}`;
      await kvPut(this.progressKV, key, progress);
    }

    // Emit progress event
    this.emitEvent({
      type: 'dataset:validation:progress',
      datasetId,
      progress,
      timestamp: new Date().toISOString(),
    });
  }

  /** Keep the newest progress record for this dataset, bounded. */
  private rememberProgress(datasetId: string, progress: DatasetValidationProgress): void {
    // Deleted before it is set, so the Map's insertion order stays a
    // least-recently-written order and the cap drops the stalest entry.
    this.localProgress.delete(datasetId);
    this.localProgress.set(datasetId, progress);
    while (this.localProgress.size > LOCAL_PROGRESS_MAX) {
      const stalest = this.localProgress.keys().next().value;
      if (stalest === undefined) break;
      this.localProgress.delete(stalest);
    }
  }

  // ============================================================================
  // QUALITY SCORING
  // ============================================================================

  /**
   * Compute quality score for a dataset
   */
  computeQualityScore(validation: DatasetValidationResult): QualityScoreBreakdown {
    // Demonstration count score (0-40 points)
    const demoScore = Math.min(validation.episodeCount / QUALITY.DEMO_COUNT_MAX, 1) * QUALITY.POINTS.DEMO_COUNT;

    // Duration score (0-30 points)
    const durationScore = Math.min(validation.totalDuration / QUALITY.DURATION_MAX, 1) * QUALITY.POINTS.DURATION;

    // Coverage score (0-20 points).
    //
    // This slot used to hold `episodeCount > 10 ? 16 : 8` under the name
    // "diversity", with a comment admitting it analysed nothing. A component
    // that takes one of two values and measures nothing is worse than a
    // missing one: it moves the total, so it looks like information.
    //
    // What replaced it is the thing that actually determines whether a dataset
    // can train a policy — does it carry pixels, and did the recorder keep the
    // frames it meant to. Both come from the report, which has now opened the
    // files. Sensor coverage is the larger half because a state-only dataset
    // cannot train a VLA at all.
    const report = validation.report;
    const imageKeys = report?.imageKeys.length ?? 0;
    const sensorScore = imageKeys === 0 ? 0 : Math.min(imageKeys / QUALITY.CAMERAS_FOR_FULL, 1)
      * QUALITY.POINTS.COVERAGE * 0.7;
    // The remaining 30% is integrity: every file the manifest promised is
    // present and non-empty. `valid` already implies it, so this only ever
    // differs while a dataset is being scored for information rather than
    // gated on.
    const integrityScore = report && report.errors.length === 0
      ? QUALITY.POINTS.COVERAGE * 0.3
      : 0;
    const coverageScore = sensorScore + integrityScore;

    // Format compliance score (0-10 points)
    let complianceScore = 0;
    if (validation.info) complianceScore += 4; // info.json present and valid
    if (validation.stats) complianceScore += 3; // stats.json present
    if (validation.valid) complianceScore += 3; // Overall valid

    const total = Math.round(demoScore + durationScore + coverageScore + complianceScore);

    return {
      demonstrationCount: Math.round(demoScore),
      duration: Math.round(durationScore),
      diversity: Math.round(coverageScore),
      formatCompliance: Math.round(complianceScore),
      total: Math.min(total, 100),
    };
  }

  // ============================================================================
  // STATS COMPUTATION
  // ============================================================================

  /**
   * Get normalization stats for a dataset
   */
  async getStats(id: string): Promise<DatasetStatsResponse> {
    const dataset = await datasetRepository.findById(id);
    if (!dataset) {
      throw new Error(`Dataset not found: ${id}`);
    }

    const hasStats = dataset.statsJson && Object.keys(dataset.statsJson).length > 0;

    return {
      datasetId: id,
      hasStats,
      stats: hasStats ? dataset.statsJson as LeRobotStatsV3 : undefined,
      computedAt: hasStats ? dataset.updatedAt.toISOString() : undefined,
    };
  }

  /**
   * Queue stats computation job via NATS JetStream.
   * Consumed by the Python stats worker (stats_worker.py in the training-worker repo).
   */
  async computeStats(id: string, force = false): Promise<void> {
    const dataset = await datasetRepository.findById(id);
    if (!dataset) {
      throw new Error(`Dataset not found: ${id}`);
    }

    if (dataset.status !== 'ready') {
      throw new Error(`Dataset not ready for stats computation: ${id}`);
    }

    // Check if stats already exist
    const hasStats = dataset.statsJson && Object.keys(dataset.statsJson).length > 0;
    if (hasStats && !force) {
      throw new Error(`Dataset already has stats. Use force=true to recompute.`);
    }

    // Queue stats computation job if NATS is available
    if (natsClient.isConnected()) {
      const js = natsClient.getJetStream();
      if (js) {
        const payload = JSON.stringify({
          datasetId: id,
          storagePath: dataset.storagePath,
          force,
        });

        await js.publish(DATASET_STATS_SUBJECT, new TextEncoder().encode(payload), {
          msgID: `stats-${id}-${Date.now()}`,
        });

        console.log(`[DatasetService] Queued stats computation for dataset: ${id}`);
      }
    } else {
      // Stats computation requires Python worker, just log for now
      console.log(`[DatasetService] Stats computation requested for ${id} but worker not available`);
      throw new Error('Stats computation worker not available. This feature requires the Python worker.');
    }
  }

  // ============================================================================
  // HELPERS
  // ============================================================================

  /**
   * Convert Dataset to DatasetResponse with relations
   */
  /**
   * The view-side columns for a set of datasets, in ONE query.
   *
   * They are read here rather than off the domain object because
   * `dbDatasetToDomain` does not carry them: `Dataset` is the shape every
   * existing caller compiles against, and widening it to hold a view's
   * plumbing would put five fields into hundreds of call sites that have no
   * use for them. One indexed `in` query per listing is the cost — not one per
   * row, which is what a naive `isView(id)` check inside `toResponse` would
   * have been.
   */
  private async loadViewColumns(ids: string[]): Promise<Map<string, DatasetViewColumns>> {
    const found = new Map<string, DatasetViewColumns>();
    if (ids.length === 0) return found;
    const rows = (await prisma.dataset.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        kind: true,
        parentDatasetId: true,
        selectionJson: true,
        frozenAt: true,
        materializedPath: true,
      },
    })) as DatasetViewColumns[];
    for (const row of rows) found.set(row.id, row);
    return found;
  }

  /**
   * @param view the row's view columns, when the caller has loaded them. A
   *   dataset whose columns were not loaded is answered as materialized, which
   *   is what every row was before TASK-240 and what almost every row is now.
   */
  private async toResponse(
    dataset: Dataset,
    view?: DatasetViewColumns | null,
  ): Promise<DatasetResponse> {
    const response: DatasetResponse = {
      id: dataset.id,
      name: dataset.name,
      description: dataset.description,
      robotTypeId: dataset.robotTypeId,
      skillId: dataset.skillId,
      storagePath: dataset.storagePath,
      lerobotVersion: dataset.lerobotVersion,
      fps: dataset.fps,
      totalFrames: dataset.totalFrames,
      totalDuration: dataset.totalDuration,
      demonstrationCount: dataset.demonstrationCount,
      qualityScore: dataset.qualityScore,
      infoJson: dataset.infoJson,
      statsJson: dataset.statsJson,
      status: dataset.status,
      huggingFaceRepoId: dataset.huggingFaceRepoId,
      // Always present, `null` rather than absent: the UI has to distinguish
      // "this import failed and here is why" from "this row predates TASK-220",
      // and an omitted key cannot say either.
      sourceRevision: dataset.sourceRevision ?? null,
      sourceLicense: dataset.sourceLicense ?? null,
      importMode: dataset.importMode ?? null,
      importError: dataset.importError ?? null,
      createdAt: dataset.createdAt,
      updatedAt: dataset.updatedAt,
    };

    // Fetch robot type if available
    if (dataset.robotTypeId) {
      const robotType = await robotTypeRepository.findById(dataset.robotTypeId);
      if (robotType) {
        response.robotType = {
          id: robotType.id,
          name: robotType.name,
          manufacturer: robotType.manufacturer,
          model: robotType.model,
        };
      }
    }

    // Fetch skill if available
    if (dataset.skillId) {
      const skill = await skillDefinitionRepository.findById(dataset.skillId);
      if (skill) {
        response.skill = {
          id: skill.id,
          name: skill.name,
          version: skill.version,
        };
      }
    }

    // What validation actually found, when something has validated this.
    //
    // This used to reconstruct the score breakdown from the row's own numbers —
    // 70% of the diversity points as a literal, and "assume compliant if
    // ready" — so it agreed with itself whatever the files said. The stored
    // report is the real one, and its ABSENCE is information too: it means
    // nothing has ever opened this dataset, which is the state every locally
    // registered dataset is in.
    // A VIEW has never been validated and never can be: it has no files of its
    // own, so nothing has ever opened them. What it can honestly show is the
    // report for the dataset its episodes are indices into — the same bytes, a
    // subset of the same episodes — so the root's report is borrowed rather
    // than left blank (which would read as "nobody has checked this data",
    // when somebody has) and rather than a report of its own (which would be a
    // claim no run could support). Counts stay the view's own: those ARE
    // derived, and were computed against the parent when the view was created.
    let stored = dataset.validation as
      | { breakdown?: QualityScoreBreakdown; report?: DatasetStructureReport; validatedAt?: string }
      | undefined;
    if (view) {
      response.kind = (view.kind === 'view' ? 'view' : 'materialized') as DatasetKind;
    }
    if (view && isDatasetView(view)) {
      // `resolve` is the one walker — this never follows `parentDatasetId`.
      const { rootDatasetId } = await datasetViewService.resolve(dataset.id);
      const root = (await prisma.dataset.findUnique({
        where: { id: rootDatasetId },
        select: { validationJson: true },
      })) as { validationJson: string | null } | null;
      stored = parseValidationJson(root?.validationJson);

      // The rest of what makes a view a view, so a card can render "142 of 400
      // episodes" and a lock without a second request. The parent is one hop —
      // read, not walked; `rootDatasetId` above is the end of the chain and
      // came from the resolver.
      response.parentDatasetId = view.parentDatasetId;
      response.frozenAt = view.frozenAt ? view.frozenAt.toISOString() : null;
      response.materializedPath = view.materializedPath;
      // Tolerant, unlike `resolve`: a row whose selection blob got mangled is
      // still a row the list endpoint has to return, and the refusal that
      // matters happens where the episodes are actually read.
      response.selection = parseSelectionJson(view.selectionJson);
      if (view.parentDatasetId) {
        const parent = (await prisma.dataset.findUnique({
          where: { id: view.parentDatasetId },
          select: { id: true, name: true, demonstrationCount: true },
        })) as { id: string; name: string; demonstrationCount: number } | null;
        response.parent = parent;
      }
    }
    if (stored?.breakdown) {
      response.qualityBreakdown = stored.breakdown;
    }
    if (stored?.report) {
      response.validation = {
        validatedAt: stored.validatedAt,
        valid: stored.report.valid,
        lerobotVersion: stored.report.lerobotVersion,
        errors: stored.report.errors,
        warnings: stored.report.warnings,
        imageKeys: stored.report.imageKeys,
        fileCount: stored.report.files.length,
      };
    }

    return response;
  }


  // ============================================================================
  // VIEWS — a fork is a selection over a parent, not a copy of its bytes
  // (TASK-240)
  // ============================================================================

  /**
   * How long each of this dataset's episodes is, in frames.
   *
   * Needed twice over: to refuse a frame range that runs off the end of an
   * episode, and to tell a view's card how many frames it actually holds
   * without opening a single data file.
   *
   * Read through `resolve`, so asking a VIEW answers about the episodes THAT
   * VIEW has — index 0 is its first selected episode, already trimmed — which
   * is what a view of a view has to be validated against.
   */
  async episodeLengthsFor(datasetId: string): Promise<EpisodeLengthReadout> {
    const row = await this.loadViewRow(datasetId);
    const resolved = await datasetViewService.resolve(datasetId);
    const root = resolved.isView ? await this.loadViewRow(resolved.rootDatasetId) : row;

    const measured = await readEpisodeLengths(root.storagePath);
    const exact = measured !== null;
    // A dataset whose episode metadata cannot be read still has to size a
    // card, and `totalFrames / demonstrationCount` is the only number left. It
    // is a mean, not a measurement, so `exact` says so and the caller refuses
    // frame ranges rather than validating them against an average.
    const rootLengths =
      measured
      ?? evenlySplitFrames(root.totalFrames, root.demonstrationCount);

    if (!resolved.isView) {
      return { episodeLengths: rootLengths, fps: row.fps, exact };
    }
    const own = resolved.episodes.map((ep) => {
      const length = rootLengths[ep.episodeIndex] ?? 0;
      const start = Math.max(0, ep.start ?? 0);
      const end = Math.min(ep.end ?? length, length);
      return Math.max(0, end - start);
    });
    return { episodeLengths: own, fps: row.fps, exact };
  }

  /**
   * Fork a dataset: a named selection of its episodes, zero bytes written.
   *
   * The selection is validated against the parent HERE and stored resolved —
   * `resolve` maps indices, it does not check them, and a selection that named
   * an episode its parent does not have would otherwise only fail much later,
   * inside a training run, as a missing file.
   */
  async createView(
    parentDatasetId: string,
    input: CreateDatasetViewInput,
  ): Promise<DatasetViewSummary> {
    const parent = await this.loadViewRow(parentDatasetId);
    const name = input.name?.trim();
    if (!name) {
      throw new DatasetViewError('A view needs a name', 'VIEW_MALFORMED', { parentDatasetId });
    }

    const selection = normalizeSelection(input.selection);
    const metadata = await this.episodeLengthsFor(parentDatasetId);
    validateAgainstParent(parent, selection, metadata);
    const counts = datasetViewService.derivedCounts(selection, metadata);

    const created = (await prisma.dataset.create({
      data: {
        name,
        description: input.description?.trim() || null,
        robotTypeId: parent.robotTypeId,
        skillId: parent.skillId,
        // Empty, and the point of the whole feature: a view owns no bytes.
        storagePath: '',
        lerobotVersion: parent.lerobotVersion,
        fps: parent.fps,
        totalFrames: counts.totalFrames,
        totalDuration: counts.totalDuration,
        demonstrationCount: counts.demonstrationCount,
        // Inherited, not assumed: a view of a dataset that failed validation
        // is not a dataset anybody should be able to train on either.
        status: parent.status,
        kind: 'view',
        parentDatasetId: parent.id,
        selectionJson: JSON.stringify(selection),
      },
      select: VIEW_PARENT_SELECT,
    })) as ViewParentRow;

    const summary = await this.toViewSummary(created, parent);

    // The same event an ordinary dataset emits, because a view IS a dataset
    // row — the lists and the WebSocket feed must not have to learn a second
    // kind of "a dataset appeared".
    const dataset = await datasetRepository.findById(created.id);
    if (dataset) {
      this.emitEvent({
        type: 'dataset:created',
        datasetId: created.id,
        dataset: await this.toResponse(dataset, created),
        timestamp: new Date().toISOString(),
      });
    }
    console.log(
      `[DatasetService] View created: ${created.id} (${counts.demonstrationCount} of `
      + `${parent.demonstrationCount} episodes of ${parent.id})`,
    );
    return summary;
  }

  /** The views forked directly from this dataset, newest first. */
  async listViews(parentDatasetId: string): Promise<DatasetViewSummary[]> {
    const parent = await this.loadViewRow(parentDatasetId);
    const rows = (await prisma.dataset.findMany({
      where: { parentDatasetId, kind: 'view' },
      select: VIEW_PARENT_SELECT,
      orderBy: { createdAt: 'desc' },
    })) as ViewParentRow[];
    return Promise.all(rows.map((row) => this.toViewSummary(row, parent)));
  }

  /** One view, or a 404 for a row that is not one. */
  async getView(viewId: string): Promise<DatasetViewSummary> {
    const row = await this.loadViewRow(viewId);
    this.assertView(row);
    const parent = await this.loadViewRow(row.parentDatasetId!);
    return this.toViewSummary(row, parent);
  }

  /**
   * Delete a view.
   *
   * Refused while it is frozen: a frozen view is one a training job cites, and
   * the run's report names data that would then no longer exist. The answer
   * offered instead is to duplicate the selection into a new view, which costs
   * nothing — that is what makes copy-on-write at the metadata level bearable.
   */
  async deleteView(viewId: string): Promise<boolean> {
    const row = await this.loadViewRow(viewId);
    this.assertView(row);

    // The frozen refusal itself lives in `delete`, which this delegates to
    // below, so that the ordinary dataset delete endpoint cannot walk past it.
    if (row.frozenAt) {
      throw await this.frozenViewConflict(viewId, row.name, row.frozenAt);
    }

    // Anything `materialize` wrote is this view's alone, so it goes with it —
    // but only when it is inside the dataset root. `materializedPath` is a
    // database column, and `rm -rf` on an unvalidated column is how a bug
    // becomes a catastrophe.
    if (row.materializedPath) {
      const storageRoot = datasetStorageRoot();
      const target = resolvePath(row.materializedPath);
      if (target !== storageRoot && target.startsWith(storageRoot + sep)) {
        await rm(target, { recursive: true, force: true }).catch((error: unknown) => {
          console.warn(`[DatasetService] Failed to remove materialized view ${viewId}:`, error);
        });
      }
    }

    // Everything else a delete has to refuse for — mixture membership, views
    // forked from THIS view — is already `delete`'s job, and a view is a
    // dataset row like any other.
    return this.delete(viewId);
  }

  /**
   * Write a view's episodes to real files, for the consumer that cannot take an
   * episode filter. Idempotent: the second call returns the first one's path.
   */
  async materializeView(viewId: string, backend?: 'native' | 'lerobot'): Promise<string> {
    const row = await this.loadViewRow(viewId);
    this.assertView(row);
    const outputPath = join(datasetStorageRoot(), `view-${viewId}`);
    return datasetViewService.materialize(viewId, outputPath, backend ? { backend } : undefined);
  }

  /**
   * A selection built from what operators decided about individual episodes.
   *
   * `keep` takes only the episodes somebody explicitly kept. `remove` takes
   * everything NOT explicitly removed, which is the other question people
   * actually ask — "drop the bad ones" — and answers it including every
   * episode nobody has looked at yet.
   *
   * Resolved at this moment and stored as a list, never as the rule: a later
   * review must not silently change what a finished run trained on.
   */
  async selectionFromFlags(
    parentDatasetId: string,
    decision: 'keep' | 'remove',
  ): Promise<DatasetSelection> {
    const parent = await this.loadViewRow(parentDatasetId);
    const flags = (await prisma.datasetEpisodeFlag.findMany({
      where: { datasetId: parentDatasetId },
      select: { episodeIndex: true, reviewDecision: true },
      orderBy: { episodeIndex: 'asc' },
    })) as Array<{ episodeIndex: number; reviewDecision: string | null }>;

    let indices: number[];
    if (decision === 'keep') {
      indices = flags
        .filter((f) => f.reviewDecision === 'keep')
        .map((f) => f.episodeIndex)
        .filter((i) => i >= 0 && i < parent.demonstrationCount);
    } else {
      const removed = new Set(
        flags.filter((f) => f.reviewDecision === 'remove').map((f) => f.episodeIndex),
      );
      indices = [];
      for (let i = 0; i < parent.demonstrationCount; i += 1) {
        if (!removed.has(i)) indices.push(i);
      }
    }

    return {
      episodes: [...new Set(indices)].sort((a, b) => a - b).map((episodeIndex) => ({ episodeIndex })),
      origin: { kind: 'flags', decision },
    };
  }

  /**
   * A selection of the episodes a reward model scored at or above a threshold.
   *
   * The scores are read ONCE, here, and written out as a list of episodes. A
   * later reward job that rewrites them does not change this view — that is
   * the whole difference between an experiment arm somebody can reproduce and
   * a result nobody can explain a month later. `origin` keeps the rule for a
   * human to read; the episode list is the truth.
   */
  async selectionFromRewards(
    parentDatasetId: string,
    rewardType: 'robometer' | 'topreward',
    minScore: number,
  ): Promise<DatasetSelection> {
    const parent = await this.loadViewRow(parentDatasetId);
    if (!Number.isFinite(minScore)) {
      throw new DatasetViewError(
        'minScore must be a finite number',
        'VIEW_MALFORMED',
        { parentDatasetId, minScore },
      );
    }
    const rewards = await episodeRewardRepository.findByDataset(parentDatasetId, rewardType);
    const indices = rewards
      .filter((r) => r.score >= minScore)
      .map((r) => r.episodeIndex)
      .filter((i) => i >= 0 && i < parent.demonstrationCount);

    return {
      episodes: [...new Set(indices)].sort((a, b) => a - b).map((episodeIndex) => ({ episodeIndex })),
      origin: { kind: 'reward', rewardType, minScore },
    };
  }

  /**
   * The 409 a frozen view answers an edit with.
   *
   * It names the citing job, because "this is frozen" is not actionable and
   * "job-4f2 trained on it" is: the operator can look at that run, and the UI
   * can offer to duplicate the selection instead. Freezing walks the ancestor
   * chain, so a view can also be frozen because a view derived FROM it was
   * cited — saying "job unknown" would read as a bug, so that case says what
   * actually happened.
   */
  private async frozenViewConflict(
    datasetId: string,
    name: string,
    frozenAt: Date,
  ): Promise<ConflictError> {
    const jobs = await this.citingJobIds(datasetId);
    const cited = jobs.length
      ? `training ${jobs.length === 1 ? 'job' : 'jobs'} ${jobs.slice(0, 5).join(', ')}`
      : 'a training job that cites a view derived from it';
    return new ConflictError(
      `"${name}" was frozen on ${frozenAt.toISOString()} because ${cited} cites it, so its episode `
      + 'selection is now part of what those runs trained on and cannot be taken away. Duplicate '
      + 'it as a new view if you need a different selection.',
      { datasetId, frozenAt: frozenAt.toISOString(), trainingJobIds: jobs },
    );
  }

  /** The training jobs that name this dataset — directly or as a mixture member. */
  private async citingJobIds(datasetId: string): Promise<string[]> {
    const [direct, mixed] = await Promise.all([
      prisma.trainingJob.findMany({
        where: { datasetId },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
      }) as Promise<Array<{ id: string }>>,
      prisma.trainingJobDataset.findMany({
        where: { datasetId },
        select: { trainingJobId: true },
        orderBy: { trainingJobId: 'asc' },
      }) as Promise<Array<{ trainingJobId: string }>>,
    ]);
    return [...new Set([...direct.map((j) => j.id), ...mixed.map((m) => m.trainingJobId)])];
  }

  private assertView(row: ViewParentRow): void {
    if (!isDatasetView(row) || !row.parentDatasetId) {
      throw new DatasetViewError(
        `Dataset ${row.id} is not a view`,
        'VIEW_NOT_A_VIEW',
        { datasetId: row.id },
      );
    }
  }

  private async loadViewRow(datasetId: string): Promise<ViewParentRow> {
    const row = (await prisma.dataset.findUnique({
      where: { id: datasetId },
      select: VIEW_PARENT_SELECT,
    })) as ViewParentRow | null;
    if (!row) throw new NotFoundError('Dataset', datasetId);
    return row;
  }

  private async toViewSummary(row: ViewParentRow, parent: ViewParentRow): Promise<DatasetViewSummary> {
    const resolved = await datasetViewService.resolve(row.id);
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      kind: 'view',
      status: row.status,
      fps: row.fps,
      parentDatasetId: parent.id,
      parentName: parent.name,
      parentDemonstrationCount: parent.demonstrationCount,
      rootDatasetId: resolved.rootDatasetId,
      demonstrationCount: row.demonstrationCount,
      totalFrames: row.totalFrames,
      totalDuration: row.totalDuration,
      selection: JSON.parse(row.selectionJson ?? '{"episodes":[],"origin":{"kind":"manual"}}') as DatasetSelection,
      resolvedEpisodes: resolved.episodes,
      frozenAt: row.frozenAt ? row.frozenAt.toISOString() : null,
      materializedPath: row.materializedPath,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  // ============================================================================
  // EVENT HANDLING
  // ============================================================================

  /**
   * Subscribe to dataset events
   */
  onDatasetEvent(handler: DatasetEventCallback): () => void {
    this.on('dataset:event', handler);
    return () => this.off('dataset:event', handler);
  }

  /**
   * Emit a dataset event
   */
  private emitEvent(event: DatasetEvent): void {
    this.emit('dataset:event', event);
    this.emit(event.type, event);
  }
}

// ============================================================================
// SINGLETON EXPORT
// ============================================================================

export const datasetService = DatasetService.getInstance();
