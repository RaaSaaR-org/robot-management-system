/**
 * @file RemoteDatasetReader.ts
 * @description Reads episodes and frames of a LeRobot dataset kept in object storage
 * @feature datasets
 *
 * The episodes and frames routes used to read exactly one file each
 * (`meta/episodes/chunk-000/file-000.parquet`, `data/chunk-NNN/file-000.parquet`)
 * and, when that file was absent, answered 200 with episodes of an averaged
 * length and sine-wave joint values. Every LeRobot v2.1 dataset — including the
 * production demo dataset — and every v3.0 chunk split into several files got
 * that treatment (TASK-354).
 *
 * This module reads the layout the dataset actually has and throws a
 * {@link DatasetReadError} naming the file whenever it cannot. It never
 * invents data. Storage access sits behind {@link DatasetObjectStore} so the
 * readers are testable without RustFS.
 */

import type { EpisodeMeta, EpisodeVideoWindow, FrameData } from '../../types/dataset.types.js';
import { bufferSource, readParquetRows, type ByteSource, type ReadRowsOptions } from './parquetEpisodeRows.js';
import { ReadCache } from './ReadCache.js';

/** Object access scoped to one dataset's root; every path is relative to it. */
export interface DatasetObjectStore {
  /** The object's bytes, or null when no such object exists. Throws on storage failure. */
  read(path: string): Promise<Buffer | null>;
  /** Every object path under `prefix`, relative to the dataset root. */
  list(prefix: string): Promise<string[]>;
  /**
   * The object's size, or null when it does not exist. Optional: with it and
   * {@link readRange} a parquet file is read in byte ranges instead of whole
   * (TASK-355) — a v3.0 data file can be far larger than the server's heap.
   */
  stat?(path: string): Promise<{ size: number } | null>;
  /** `length` bytes of the object starting at `offset`. Used together with {@link stat}. */
  readRange?(path: string, offset: number, length: number): Promise<Buffer>;
}

/** A dataset that cannot be read as stored; `status` is the HTTP answer. */
export class DatasetReadError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly file?: string,
    /** Extra context for the client, e.g. why an episode was not found. */
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'DatasetReadError';
  }
}

/** The fields of `meta/info.json` the readers depend on. */
export interface LeRobotInfo {
  codebase_version?: string;
  fps?: number;
  chunks_size?: number;
  data_path?: string;
  total_episodes?: number;
  total_frames?: number;
}

export type LeRobotLayout = 'v2' | 'v3';

const DEFAULT_CHUNKS_SIZE = 1000;
const V2_DATA_PATH = 'data/chunk-{episode_chunk:03d}/episode_{episode_index:06d}.parquet';
const V3_DATA_PATH = 'data/chunk-{chunk_index:03d}/file-{file_index:03d}.parquet';
const PARQUET_FILE_RE = /\/chunk-\d+\/file-\d+\.parquet$/;

/**
 * Which reader serves the dataset: `info.codebase_version` first, the
 * dataset record's own version second. Anything else is refused rather than
 * guessed at.
 */
export function layoutOf(info: LeRobotInfo | null | undefined, recordVersion?: string | null): LeRobotLayout {
  const version = String(info?.codebase_version ?? recordVersion ?? '').toLowerCase();
  if (version.startsWith('v2')) return 'v2';
  if (version.startsWith('v3')) return 'v3';
  throw new DatasetReadError(
    422,
    version
      ? `Unsupported LeRobot version "${version}" — only v2.x and v3.x datasets can be browsed`
      : 'The dataset has no LeRobot codebase_version in meta/info.json, so its layout is unknown',
  );
}

/**
 * Expand a LeRobot path template such as
 * `data/chunk-{episode_chunk:03d}/episode_{episode_index:06d}.parquet`.
 */
export function formatPathTemplate(template: string, vars: Record<string, number>): string {
  return template.replace(/\{(\w+)(?::0?(\d+)d)?\}/g, (whole, name: string, width?: string) => {
    if (!(name in vars)) return whole;
    const value = String(vars[name]);
    return width ? value.padStart(Number(width), '0') : value;
  });
}

/**
 * Episode records from `meta/episodes.jsonl` (JSON Lines, LeRobot v2.1) or a
 * `meta/episodes.json` array (Cosmos converter). Shared with the local reader.
 */
export function parseEpisodeRecords(raw: string): Array<{ episode_index?: number; length?: number }> {
  const trimmed = raw.trim();
  if (trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) return parsed as Array<{ episode_index?: number; length?: number }>;
  }
  return trimmed
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as { episode_index?: number; length?: number });
}

/** EpisodeMeta from parsed records; `flagged` is the caller's to fill in. */
export function toEpisodeMeta(
  records: Array<{ episode_index?: number; length?: number }>,
  fps: number,
): EpisodeMeta[] {
  return records.map((e, i) => {
    const frameCount = Number(e.length ?? 0);
    return {
      index: Number(e.episode_index ?? i),
      frameCount,
      durationSeconds: fps > 0 ? parseFloat((frameCount / fps).toFixed(2)) : 0,
      flagged: false,
    };
  });
}

/** pyarrow list<float32> may surface as a plain array or parquetjs `{list:[{element}]}`. */
export function toNumberArray(value: unknown): number[] {
  if (Array.isArray(value)) {
    return value.map((x) => Number((x as { element?: number })?.element ?? x));
  }
  const list = (value as { list?: Array<{ element?: number }> })?.list;
  if (Array.isArray(list)) return list.map((it) => Number(it?.element ?? 0));
  return [];
}

type Row = Record<string, unknown>;

/** Fetch one object, turning a storage failure into a 502 that names it. */
async function fetchObject(store: DatasetObjectStore, path: string): Promise<Buffer | null> {
  try {
    return await store.read(path);
  } catch (error) {
    throw new DatasetReadError(502, `Could not read ${path} from object storage: ${messageOf(error)}`, path);
  }
}

async function listObjects(store: DatasetObjectStore, prefix: string): Promise<string[]> {
  try {
    return await store.list(prefix);
  } catch (error) {
    throw new DatasetReadError(502, `Could not list ${prefix} in object storage: ${messageOf(error)}`, prefix);
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Read the selected columns (and rows) of a parquet object, page by page.
 * Returns null when the object does not exist; a file that exists but
 * cannot be read or parsed is a 502 naming it.
 */
async function readParquet(
  store: DatasetObjectStore,
  path: string,
  options: ReadRowsOptions,
): Promise<Row[] | null> {
  let source: ByteSource;
  if (store.stat && store.readRange) {
    let stat: { size: number } | null;
    try {
      stat = await store.stat(path);
    } catch (error) {
      throw new DatasetReadError(502, `Could not read ${path} from object storage: ${messageOf(error)}`, path);
    }
    if (!stat) return null;
    const readRange = store.readRange.bind(store);
    source = { size: stat.size, read: (offset, length) => readRange(path, offset, length) };
  } else {
    const buf = await fetchObject(store, path);
    if (!buf) return null;
    source = bufferSource(buf);
  }
  try {
    return (await readParquetRows(source, options)).rows;
  } catch (error) {
    throw new DatasetReadError(502, `Could not read ${path}: ${messageOf(error)}`, path);
  }
}

/** The columns a frame is built from; everything else in a data file is never decoded. */
const FRAME_COLUMNS = ['episode_index', 'frame_index', 'timestamp', 'observation.state', 'action'];

/** `file-*.parquet` under `prefix`, in chunk/file order. */
async function listParquetFiles(store: DatasetObjectStore, prefix: string): Promise<string[]> {
  const paths = await listObjects(store, prefix);
  return paths.filter((p) => PARQUET_FILE_RE.test(p)).sort();
}

function toFrame(row: Row, position: number, fps: number): FrameData {
  return {
    frameIndex: Number(row['frame_index'] ?? position),
    timestamp: Number(row['timestamp'] ?? (fps > 0 ? position / fps : 0)),
    observationState: toNumberArray(row['observation.state']),
    action: toNumberArray(row['action']),
  };
}

/** A v3.0 episode row plus where its frames live, when the row says so. */
interface V3Episode {
  meta: EpisodeMeta;
  dataChunk?: number;
  dataFile?: number;
}

function finiteOrUndefined(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

async function readV3Episodes(store: DatasetObjectStore, fps: number): Promise<V3Episode[]> {
  const files = await listParquetFiles(store, 'meta/episodes/');
  if (files.length === 0) {
    throw new DatasetReadError(
      422,
      'No episode metadata in storage: meta/episodes/chunk-*/file-*.parquet is missing',
      'meta/episodes/',
    );
  }
  const episodes: V3Episode[] = [];
  for (const file of files) {
    // The per-episode `stats/*` columns are most of the file and unused here.
    const rows = await readParquet(store, file, { columns: (names) => names.filter((n) => !n.startsWith('stats/')) });
    for (const row of rows ?? []) {
      const frameCount = Number(row['length'] ?? row['num_frames'] ?? 0);
      const index = Number(row['episode_index'] ?? episodes.length);
      // Per-camera playback window into the chunk's concatenated mp4, keyed by
      // the full camera feature key (`observation.images.top`, pusht's
      // singular `observation.image`).
      const videoWindows: Record<string, EpisodeVideoWindow> = {};
      for (const col of Object.keys(row)) {
        const m = /^videos\/(.+)\/from_timestamp$/.exec(col);
        if (!m) continue;
        const base = `videos/${m[1]}`;
        videoWindows[m[1]] = {
          from: Number(row[col] ?? 0),
          to: Number(row[`${base}/to_timestamp`] ?? 0),
          chunk: Number(row[`${base}/chunk_index`] ?? 0),
          file: Number(row[`${base}/file_index`] ?? 0),
        };
      }
      episodes.push({
        meta: {
          index,
          frameCount,
          durationSeconds: fps > 0 ? parseFloat((frameCount / fps).toFixed(2)) : 0,
          flagged: false,
          ...(Object.keys(videoWindows).length > 0 ? { videoWindows } : {}),
        },
        dataChunk: finiteOrUndefined(row['data/chunk_index']),
        dataFile: finiteOrUndefined(row['data/file_index']),
      });
    }
  }
  return episodes.sort((a, b) => a.meta.index - b.meta.index);
}

async function readV2Episodes(store: DatasetObjectStore, fps: number): Promise<EpisodeMeta[]> {
  for (const path of ['meta/episodes.jsonl', 'meta/episodes.json']) {
    const buf = await fetchObject(store, path);
    if (!buf) continue;
    let records: Array<{ episode_index?: number; length?: number }>;
    try {
      records = parseEpisodeRecords(buf.toString('utf8'));
    } catch (error) {
      throw new DatasetReadError(502, `Could not parse ${path}: ${messageOf(error)}`, path);
    }
    return toEpisodeMeta(records, fps).sort((a, b) => a.index - b.index);
  }
  throw new DatasetReadError(
    422,
    'No episode metadata in storage: meta/episodes.jsonl is missing',
    'meta/episodes.jsonl',
  );
}

/** Every episode of the dataset, read from its own metadata. */
export async function readRemoteEpisodes(
  store: DatasetObjectStore,
  info: LeRobotInfo | null | undefined,
  fps: number,
  recordVersion?: string | null,
): Promise<EpisodeMeta[]> {
  return layoutOf(info, recordVersion) === 'v2'
    ? readV2Episodes(store, fps)
    : (await readV3Episodes(store, fps)).map((e) => e.meta);
}

export interface FramePage {
  frames: FrameData[];
  /** The episode's real frame count, independent of the page. */
  total: number;
  /** The parquet file(s) the frames came from. */
  source: string;
}

function notFound(episodeIndex: number, detail: string): DatasetReadError {
  return new DatasetReadError(404, 'Episode frames not found', undefined, `episode ${episodeIndex}: ${detail}`);
}

async function readV2Frames(
  store: DatasetObjectStore,
  info: LeRobotInfo | null | undefined,
  episodeIndex: number,
  fps: number,
): Promise<{ frames: FrameData[]; source: string }> {
  const totalEpisodes = finiteOrUndefined(info?.total_episodes);
  if (totalEpisodes !== undefined && episodeIndex >= totalEpisodes) {
    throw notFound(episodeIndex, `the dataset has ${totalEpisodes} episodes`);
  }
  const chunksSize = Number(info?.chunks_size) > 0 ? Number(info?.chunks_size) : DEFAULT_CHUNKS_SIZE;
  const path = formatPathTemplate(info?.data_path ?? V2_DATA_PATH, {
    episode_chunk: Math.floor(episodeIndex / chunksSize),
    episode_index: episodeIndex,
  });
  const rows = await readParquet(store, path, { columns: FRAME_COLUMNS });
  if (!rows) {
    if (totalEpisodes === undefined) throw notFound(episodeIndex, `${path} does not exist`);
    throw new DatasetReadError(422, `Episode ${episodeIndex} has no data file: ${path} is missing`, path);
  }
  return { frames: rows.map((row, i) => toFrame(row, i, fps)), source: path };
}

async function readV3Frames(
  store: DatasetObjectStore,
  info: LeRobotInfo | null | undefined,
  episodeIndex: number,
  fps: number,
): Promise<{ frames: FrameData[]; source: string }> {
  const episodes = await readV3Episodes(store, fps);
  const episode = episodes.find((e) => e.meta.index === episodeIndex);
  if (!episode) throw notFound(episodeIndex, `not among the ${episodes.length} episodes in meta/episodes`);

  // The episode row names the one data file holding it; without that, scan
  // the chunk files in order. Episodes are contiguous, so stop once past it.
  let candidates: string[];
  if (episode.dataChunk !== undefined && episode.dataFile !== undefined) {
    const template = info?.data_path && info.data_path.includes('{file_index') ? info.data_path : V3_DATA_PATH;
    candidates = [formatPathTemplate(template, { chunk_index: episode.dataChunk, file_index: episode.dataFile })];
  } else {
    candidates = await listParquetFiles(store, 'data/');
  }
  if (candidates.length === 0) {
    throw new DatasetReadError(422, 'No frame data in storage: data/chunk-*/file-*.parquet is missing', 'data/');
  }

  const frames: FrameData[] = [];
  const read: string[] = [];
  for (const path of candidates) {
    // Only this episode's rows of the five frame columns are decoded; row
    // groups whose episode_index statistics exclude it are not read at all.
    const rows = await readParquet(store, path, {
      columns: FRAME_COLUMNS,
      filter: { column: 'episode_index', equals: episodeIndex },
    });
    if (!rows) {
      if (candidates.length === 1) {
        throw new DatasetReadError(422, `Episode ${episodeIndex}'s data file ${path} is missing`, path);
      }
      continue;
    }
    // Episodes are contiguous: a file without rows after one with rows is past it.
    if (rows.length === 0) {
      if (frames.length > 0) break;
      continue;
    }
    for (const row of rows) frames.push(toFrame(row, frames.length, fps));
    read.push(path);
    if (frames.length >= episode.meta.frameCount) break;
  }
  if (frames.length === 0) {
    throw new DatasetReadError(
      422,
      `Episode ${episodeIndex} has no rows in ${candidates.length === 1 ? candidates[0] : 'data/'}`,
      candidates.length === 1 ? candidates[0] : 'data/',
    );
  }
  return { frames, source: read.join(', ') };
}

/** Every frame of one episode, read from the parquet that holds it. */
export async function readRemoteEpisodeFrames(
  store: DatasetObjectStore,
  info: LeRobotInfo | null | undefined,
  episodeIndex: number,
  fps: number,
  recordVersion?: string | null,
): Promise<{ frames: FrameData[]; source: string }> {
  return layoutOf(info, recordVersion) === 'v2'
    ? readV2Frames(store, info, episodeIndex, fps)
    : readV3Frames(store, info, episodeIndex, fps);
}

/** One page of an episode's frames, read from the parquet that holds them. */
export async function readRemoteFrames(
  store: DatasetObjectStore,
  info: LeRobotInfo | null | undefined,
  episodeIndex: number,
  fps: number,
  page: { offset: number; limit: number },
  recordVersion?: string | null,
): Promise<FramePage> {
  const { frames, source } = await readRemoteEpisodeFrames(store, info, episodeIndex, fps, recordVersion);
  return pageOf({ frames, source }, page);
}

/** A page of a decoded episode; `total` is the episode's length, not the page's. */
export function pageOf(
  episode: { frames: FrameData[]; source: string },
  page: { offset: number; limit: number },
): FramePage {
  return {
    frames: episode.frames.slice(page.offset, page.offset + page.limit),
    total: episode.frames.length,
    source: episode.source,
  };
}

/** Rough heap bytes of a decoded episode, for the cache's budget. */
export function episodeWeight(episode: { frames: FrameData[] }): number {
  let numbers = 0;
  for (const f of episode.frames) numbers += f.observationState.length + f.action.length + 2;
  return numbers * 8 + episode.frames.length * 120;
}

/**
 * Decoded episodes, so paging through one does not re-read its parquet.
 * 64 MB of estimated weight — well inside the server's 384 MB heap — and
 * entries expire after ten minutes in case the stored files change without
 * the dataset record changing.
 */
export const episodeFramesCache = new ReadCache<{ frames: FrameData[]; source: string }>({
  maxWeight: 64 * 1024 * 1024,
  ttlMs: 10 * 60 * 1000,
});
