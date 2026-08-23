/**
 * @file validateDataset.ts
 * @description Structural validation for a LeRobot dataset that opens the files
 *              `info.json` names instead of spell-checking the manifest.
 * @feature training
 *
 * WHAT THIS REPLACES. The previous check confirmed that `meta/info.json` existed
 * in the RustFS bucket and that four of its fields were present. That was all of
 * it. It did not confirm that a single file named in `info.json` was there, did
 * not compare episode counts against the episode metadata, did not look at the
 * state and action widths, and did not run at all for a dataset on local disk —
 * those were registered `status: 'ready'` without being checked. A dataset with
 * no camera at all scored well and then failed hours later inside a training
 * job with "All image features are missing from the batch".
 *
 * The rule this file follows: if `info.json` names a parquet, read its footer.
 * If it names a video, stat it. Anything less is a spell-check on a manifest.
 *
 * VERSIONS. v2.1 and v3.0 differ only in aggregation — v2.1 stores one parquet
 * and one mp4 per episode, v3.0 stores many episodes per file and addresses
 * them by row range and time window. Both are read here, because both are on
 * disk in this deployment today; nothing is silently upgraded.
 */

import type { DatasetTree } from './DatasetTree.js';
import type { DatasetImportMode } from '../../types/vla.types.js';

/** How a dataset's files are laid out, derived from `codebase_version`. */
export type LeRobotLayout = 'v2' | 'v3';

export interface ValidationFinding {
  /** Stable identifier, so the UI can decide what to show without parsing prose. */
  code: string;
  message: string;
}

export interface DatasetStructureReport {
  valid: boolean;
  layout: LeRobotLayout | 'unknown';
  lerobotVersion: string;
  errors: ValidationFinding[];
  warnings: ValidationFinding[];
  fps: number;
  episodeCount: number;
  totalFrames: number;
  totalDuration: number;
  /** Camera features declared in `info.json`. Empty is a warning, not an error. */
  imageKeys: string[];
  /** Widths read out of the data parquet, not out of `info.json`. */
  observedStateWidth: number | null;
  observedActionWidth: number | null;
  /** Every file the manifest named, with the size found on the store. */
  files: { path: string; size: number; kind: 'meta' | 'data' | 'video' }[];
  info?: Record<string, unknown>;
  stats?: Record<string, unknown>;
}

/** What the robot type says the dataset's vectors should be, when it is known. */
export interface ExpectedDimensions {
  proprioceptionDim?: number | null;
  actionDim?: number | null;
}

/**
 * What the caller knows about this dataset that its files cannot say.
 *
 * Only `importMode` so far, and it is here rather than read from the database
 * inside this file on purpose: the validator opens a tree and reports on it,
 * and a validator that also queries Prisma cannot be run against a fixture.
 */
export interface ValidationContext {
  /** See {@link DatasetImportMode}. Absent means "assume everything was fetched". */
  importMode?: DatasetImportMode | null;
}

const MAX_DATA_FILES_READ = 8;

function pad3(n: number): string {
  return String(n).padStart(3, '0');
}

function pad6(n: number): string {
  return String(n).padStart(6, '0');
}

/** Row count and column names from a parquet, without loading its rows. */
async function readParquetShape(
  buffer: Buffer,
): Promise<{ rows: number; columns: string[] } | null> {
  try {
    const { ParquetReader } = await import('@dsnp/parquetjs');
    const reader = await ParquetReader.openBuffer(buffer);
    const rows = Number(reader.getRowCount());
    const columns = Object.keys(reader.getSchema().fields ?? {});
    await reader.close();
    return { rows, columns };
  } catch {
    return null;
  }
}

/** The first row of a parquet, for the width checks. */
async function readFirstRow(buffer: Buffer): Promise<Record<string, unknown> | null> {
  try {
    const { ParquetReader } = await import('@dsnp/parquetjs');
    const reader = await ParquetReader.openBuffer(buffer);
    const cursor = reader.getCursor();
    const row = (await cursor.next()) as Record<string, unknown> | null;
    await reader.close();
    return row;
  } catch {
    return null;
  }
}

/**
 * Every row of a parquet, for `meta/episodes/**` only.
 *
 * Safe here because that file holds one row per episode with a handful of
 * scalar columns — it is the manifest, not the data. `cap` is a backstop so a
 * malformed file cannot pull an unbounded number of rows into memory.
 */
async function readAllRows(
  buffer: Buffer,
  cap = 200_000,
): Promise<Record<string, unknown>[] | null> {
  try {
    const { ParquetReader } = await import('@dsnp/parquetjs');
    const reader = await ParquetReader.openBuffer(buffer);
    const cursor = reader.getCursor();
    const rows: Record<string, unknown>[] = [];
    let row: Record<string, unknown> | null;
    while (rows.length < cap && (row = (await cursor.next()) as Record<string, unknown> | null)) {
      rows.push(row);
    }
    await reader.close();
    return rows;
  } catch {
    return null;
  }
}

/** pyarrow `list<float32>` surfaces either as an array or as parquetjs's `{list}`. */
function vectorWidth(value: unknown): number | null {
  if (Array.isArray(value)) return value.length;
  const list = (value as { list?: unknown[] })?.list;
  if (Array.isArray(list)) return list.length;
  return null;
}

/**
 * The data and video files `info.json` claims exist.
 *
 * Derived from the templates in `info.json` rather than by listing the store:
 * the question this answers is "is everything the manifest promised actually
 * there", and a listing can only ever say what happens to be present.
 */
interface V3FileRefs {
  /** Distinct `data/chunk-CCC/file-FFF.parquet` the episode rows point at. */
  data: string[];
  /** Per video key, the distinct `videos/KEY/chunk-CCC/file-FFF.mp4`. */
  video: Record<string, string[]>;
}

function expectedFiles(
  info: Record<string, unknown>,
  layout: LeRobotLayout,
  episodeCount: number,
  videoKeys: string[],
  refs: V3FileRefs | null,
): { data: string[]; video: string[] } {
  const chunkSize = Number(info.chunks_size ?? 1000) || 1000;
  const data: string[] = [];
  const video: string[] = [];

  if (layout === 'v3') {
    // v3.0 does not name its files in `info.json` — it names a template and
    // then addresses each episode by (chunk_index, file_index) in the episode
    // metadata. `refs` is that set, read out of the metadata this validator has
    // already opened.
    //
    // The first cut guessed `file-000` in every chunk from `total_chunks`,
    // which is wrong in both directions: a chunk split across `file-000` and
    // `file-001` (what `data_files_size_in_mb` produces on any real recording
    // session) had its second file never checked, and a dataset that keeps
    // everything in chunk-000 while declaring more chunks was reported
    // MISSING_DATA_FILE for files it never claimed to have.
    // The manifest's own guess, used only where the metadata could not answer:
    // a v3.0 tree with no readable `meta/episodes/**` still has to be told its
    // data files are missing, and a recording written before the video columns
    // existed still has to have its mp4s checked.
    const chunks = Math.max(1, Number(info.total_chunks ?? 1) || 1);
    const guess = (key?: string): string[] => Array.from({ length: chunks }, (_, c) => (
      key === undefined
        ? `data/chunk-${pad3(c)}/file-000.parquet`
        : `videos/${key}/chunk-${pad3(c)}/file-000.mp4`
    ));

    for (const ref of refs?.data?.length ? refs.data : guess()) data.push(ref);
    for (const key of videoKeys) {
      const named = refs?.video[key];
      for (const path of named?.length ? named : guess(key)) video.push(path);
    }
    return { data, video };
  }

  for (let ep = 0; ep < episodeCount; ep++) {
    const chunk = Math.floor(ep / chunkSize);
    data.push(`data/chunk-${pad3(chunk)}/episode_${pad6(ep)}.parquet`);
    for (const key of videoKeys) {
      // Both orderings are in this repo's own trees: `make_synthetic_dataset.py`
      // writes chunk-first and the Cosmos converter writes key-first, and
      // `streamLocalVideo` has always accepted either. Validation has to accept
      // whichever is present rather than pick a winner.
      video.push(`videos/chunk-${pad3(chunk)}/${key}/episode_${pad6(ep)}.mp4`);
    }
  }
  return { data, video };
}

function alternateVideoPath(path: string): string | null {
  // `videos/chunk-000/<key>/episode_N.mp4` <-> `videos/<key>/chunk-000/episode_N.mp4`
  const chunkFirst = /^videos\/(chunk-\d{3})\/(.+)\/(episode_\d{6}\.mp4)$/.exec(path);
  if (chunkFirst) return `videos/${chunkFirst[2]}/${chunkFirst[1]}/${chunkFirst[3]}`;
  const keyFirst = /^videos\/(.+)\/(chunk-\d{3})\/(episode_\d{6}\.mp4)$/.exec(path);
  if (keyFirst) return `videos/${keyFirst[2]}/${keyFirst[1]}/${keyFirst[3]}`;
  return null;
}

/**
 * Open a dataset and say what is wrong with it.
 *
 * Never throws for a broken dataset — a broken dataset is the answer, not an
 * exception. It throws only if the store itself is unreachable partway through,
 * which is a different thing and must not be recorded as "this dataset failed".
 */
export async function validateDatasetStructure(
  tree: DatasetTree,
  expected: ExpectedDimensions = {},
  context: ValidationContext = {},
): Promise<DatasetStructureReport> {
  const report: DatasetStructureReport = {
    valid: false,
    layout: 'unknown',
    lerobotVersion: 'unknown',
    errors: [],
    warnings: [],
    fps: 0,
    episodeCount: 0,
    totalFrames: 0,
    totalDuration: 0,
    imageKeys: [],
    observedStateWidth: null,
    observedActionWidth: null,
    files: [],
  };
  const error = (code: string, message: string) => report.errors.push({ code, message });
  const warn = (code: string, message: string) => report.warnings.push({ code, message });

  // ---- meta/info.json ------------------------------------------------------
  const infoEntry = await tree.stat('meta/info.json');
  if (!infoEntry) {
    error('MISSING_INFO', `Missing required file: meta/info.json (looked in ${tree.kind} ${tree.root})`);
    return report;
  }
  let info: Record<string, unknown>;
  try {
    info = JSON.parse((await tree.read('meta/info.json')).toString()) as Record<string, unknown>;
  } catch (err) {
    error('BAD_INFO', `meta/info.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
    return report;
  }
  report.info = info;
  report.files.push({ path: 'meta/info.json', size: infoEntry.size, kind: 'meta' });

  const version = String(info.codebase_version ?? '');
  report.lerobotVersion = version || 'unknown';
  if (!version) error('MISSING_VERSION', 'info.json missing required field: codebase_version');
  if (!info.robot_type) error('MISSING_ROBOT_TYPE', 'info.json missing required field: robot_type');
  const fps = Number(info.fps);
  if (!Number.isFinite(fps) || fps <= 0) {
    error('MISSING_FPS', 'info.json missing or invalid field: fps');
  } else {
    report.fps = fps;
  }
  const features = (info.features ?? {}) as Record<string, { dtype?: string; shape?: number[] }>;
  if (Object.keys(features).length === 0) {
    error('MISSING_FEATURES', 'info.json missing required field: features');
  }
  if (report.errors.length > 0) return report;

  report.layout = version.startsWith('v3') ? 'v3' : 'v2';
  report.imageKeys = Object.entries(features)
    .filter(([, f]) => f?.dtype === 'video' || f?.dtype === 'image')
    .map(([key]) => key);

  // Only a `video` feature is backed by an mp4. A `dtype: 'image'` feature is
  // PNG frames under `images/<key>/`, and demanding a video for it failed
  // every image-mode dataset — which is most of what comes off the Hub —
  // with MISSING_VIDEO_FILE for a file the format never says exists.
  const videoKeys = info.video_path === null
    ? []
    : Object.entries(features).filter(([, f]) => f?.dtype === 'video').map(([key]) => key);
  const stillKeys = Object.entries(features)
    .filter(([, f]) => f?.dtype === 'image')
    .map(([key]) => key);

  // THE warning. A state-only dataset validates perfectly and then dies inside
  // a training job hours later with "All image features are missing from the
  // batch" — the one failure this whole file exists to move earlier.
  if (report.imageKeys.length === 0) {
    warn(
      'NO_IMAGE_FEATURES',
      'No camera features (observation.images.*). A vision-language-action policy cannot train on this — '
      + 'training fails with "All image features are missing from the batch".',
    );
  }

  report.episodeCount = Number(info.total_episodes ?? 0) || 0;
  report.totalFrames = Number(info.total_frames ?? 0) || 0;

  // ---- episode metadata ----------------------------------------------------
  const declaredEpisodes = report.episodeCount;
  let metaEpisodes: number | null = null;
  let metaFrames: number | null = null;
  let v3Refs: V3FileRefs | null = null;

  if (report.layout === 'v3') {
    const shards = (await tree.list('meta/episodes')).filter((f) => f.path.endsWith('.parquet'));
    if (shards.length === 0) {
      error('MISSING_EPISODE_META', 'v3.0 stores episode rows in meta/episodes/chunk-000/file-000.parquet and there is none');
    } else {
      let rows = 0;
      let frames = 0;
      let sawLength = true;
      const dataRefs = new Set<string>();
      const videoRefs: Record<string, Set<string>> = {};

      for (const shard of shards) {
        report.files.push({ path: shard.path, size: shard.size, kind: 'meta' });
        if (shard.size === 0) {
          error('EMPTY_FILE', `${shard.path} is zero bytes`);
          continue;
        }
        const buffer = await tree.read(shard.path);
        const shape = await readParquetShape(buffer);
        if (!shape) {
          error('UNREADABLE_PARQUET', `${shard.path} could not be opened as a parquet file`);
          continue;
        }
        rows += shape.rows;
        for (const required of ['episode_index', 'length']) {
          if (!shape.columns.includes(required)) {
            error('EPISODE_META_INCOMPLETE', `${shard.path} has no ${required} column`);
            if (required === 'length') sawLength = false;
          }
        }

        // The rows themselves, because v3.0's file list lives in them: which
        // parquet an episode's frames are in, and which mp4 its video window
        // cuts out of. Without this the validator was guessing.
        const metaRows = await readAllRows(buffer);
        if (metaRows === null) {
          error('BAD_EPISODE_META', `${shard.path} opened but its rows could not be read`);
          continue;
        }
        for (const row of metaRows) {
          frames += Number(row['length'] ?? 0) || 0;
          const chunk = Number(row['data/chunk_index'] ?? 0) || 0;
          const file = Number(row['data/file_index'] ?? 0) || 0;
          dataRefs.add(`data/chunk-${pad3(chunk)}/file-${pad3(file)}.parquet`);
          for (const column of Object.keys(row)) {
            const m = /^videos\/(.+)\/chunk_index$/.exec(column);
            if (!m) continue;
            const key = m[1]!;
            const vChunk = Number(row[column] ?? 0) || 0;
            const vFile = Number(row[`videos/${key}/file_index`] ?? 0) || 0;
            (videoRefs[key] ??= new Set()).add(
              `videos/${key}/chunk-${pad3(vChunk)}/file-${pad3(vFile)}.mp4`,
            );
          }
        }
      }
      metaEpisodes = rows;
      // v3.0 had no metadata-side frame check at all: `metaFrames` stayed null
      // and the only cross-check was against the data parquets, which is the
      // half that gets skipped on a large dataset.
      if (sawLength && frames > 0) metaFrames = frames;
      if (dataRefs.size > 0) {
        v3Refs = {
          data: [...dataRefs].sort(),
          video: Object.fromEntries(
            Object.entries(videoRefs).map(([key, set]) => [key, [...set].sort()]),
          ),
        };
      }
    }
  } else {
    const jsonl = await tree.stat('meta/episodes.jsonl');
    const jsonArray = await tree.stat('meta/episodes.json');
    const source = jsonl ?? jsonArray;
    if (!source) {
      error('MISSING_EPISODE_META', 'Missing meta/episodes.jsonl (or meta/episodes.json) — episode boundaries are not recorded');
    } else {
      report.files.push({ path: source.path, size: source.size, kind: 'meta' });
      try {
        const text = (await tree.read(source.path)).toString();
        const rows: { length?: number }[] = source.path.endsWith('.jsonl')
          ? text.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as { length?: number })
          : (JSON.parse(text) as { length?: number }[]);
        metaEpisodes = rows.length;
        metaFrames = rows.reduce((sum, r) => sum + (Number(r.length) || 0), 0);
      } catch (err) {
        error('BAD_EPISODE_META', `${source.path} could not be parsed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  if (metaEpisodes !== null && declaredEpisodes > 0 && metaEpisodes !== declaredEpisodes) {
    error(
      'EPISODE_COUNT_MISMATCH',
      `info.json declares ${declaredEpisodes} episodes and the episode metadata holds ${metaEpisodes}`,
    );
  }
  if (metaEpisodes !== null && declaredEpisodes === 0) report.episodeCount = metaEpisodes;
  if (metaFrames !== null && report.totalFrames > 0 && metaFrames !== report.totalFrames) {
    error(
      'FRAME_COUNT_MISMATCH',
      `info.json declares ${report.totalFrames} frames and the episode metadata sums to ${metaFrames}`,
    );
  }

  // ---- the files the manifest promised ------------------------------------
  const metadataOnly = context.importMode === 'metadata';
  const expectedPaths = expectedFiles(info, report.layout, report.episodeCount, videoKeys, v3Refs);
  const presentData: string[] = [];

  for (const path of expectedPaths.data) {
    const entry = await tree.stat(path);
    if (!entry) {
      error('MISSING_DATA_FILE', `info.json names ${path} and it is not there`);
      continue;
    }
    if (entry.size === 0) {
      error('EMPTY_FILE', `${path} is zero bytes`);
      continue;
    }
    report.files.push({ path, size: entry.size, kind: 'data' });
    presentData.push(path);
  }

  for (const path of expectedPaths.video) {
    let entry = await tree.stat(path);
    let found = path;
    if (!entry) {
      const alt = alternateVideoPath(path);
      if (alt) {
        entry = await tree.stat(alt);
        found = alt;
      }
    }
    if (!entry) {
      // A metadata-only import did not ask for the mp4s, so their absence is
      // the operator's decision rather than a broken dataset. Recorded as a
      // warning that NAMES the mode, because the same missing file in a `full`
      // import is a real failure and the two must stay distinguishable.
      if (metadataOnly) {
        warn(
          'VIDEO_NOT_IMPORTED',
          `${path} was not fetched: this dataset was imported with importMode 'metadata', which `
          + 'takes meta/ and data/ and no video. Re-import with includeVideos to train a vision policy on it.',
        );
      } else {
        error('MISSING_VIDEO_FILE', `info.json declares a camera feature and ${path} is not there`);
      }
      continue;
    }
    if (entry.size === 0) {
      error('EMPTY_FILE', `${found} is zero bytes`);
      continue;
    }
    report.files.push({ path: found, size: entry.size, kind: 'video' });
  }

  // A `dtype: 'image'` feature stores PNG frames, so the check is that the
  // prefix has something in it — the format does not fix a filename we could
  // stat, and an empty prefix is the failure that matters.
  for (const key of stillKeys) {
    const entries = await tree.list(`images/${key}`);
    if (entries.length === 0) {
      error(
        'MISSING_IMAGE_FILES',
        `info.json declares ${key} as a dtype:'image' feature and images/${key}/ is empty`,
      );
      continue;
    }
    for (const entry of entries.slice(0, 4)) {
      report.files.push({ path: entry.path, size: entry.size, kind: 'video' });
    }
  }

  // ---- open the data ------------------------------------------------------
  // Bounded: a dataset with 500 chunks does not need 500 downloads to answer
  // "does the schema match". What is NOT bounded is the existence check above,
  // which is the cheap half and the half that catches a missing file.
  let rowsRead = 0;
  let readAll = true;
  const toRead = presentData.slice(0, MAX_DATA_FILES_READ);
  if (presentData.length > toRead.length) {
    readAll = false;
    warn(
      'PARTIAL_ROW_COUNT',
      `Row counts were read from the first ${toRead.length} of ${presentData.length} data files; `
      + 'the frame total was not cross-checked against every file.',
    );
  }

  for (const path of toRead) {
    const buffer = await tree.read(path);
    const shape = await readParquetShape(buffer);
    if (!shape) {
      error('UNREADABLE_PARQUET', `${path} could not be opened as a parquet file`);
      continue;
    }
    rowsRead += shape.rows;
    for (const required of ['observation.state', 'action']) {
      if (!shape.columns.includes(required)) {
        error('MISSING_COLUMN', `${path} has no ${required} column`);
      }
    }
    // A column the parquet carries and `features` does not declare is what
    // makes lerobot itself raise a CastError on load — the failure that made
    // every dataset TASK-215 produced unopenable while its own tests passed.
    for (const column of shape.columns) {
      if (!(column in features)) {
        error(
          'UNDECLARED_COLUMN',
          `${path} carries a ${column} column that info.json features does not declare — `
          + 'lerobot casts the data parquet against features and raises on an extra column',
        );
      }
    }
    if (report.observedStateWidth === null) {
      const row = await readFirstRow(buffer);
      if (row) {
        report.observedStateWidth = vectorWidth(row['observation.state']);
        report.observedActionWidth = vectorWidth(row['action']);
      }
    }
  }

  if (readAll && rowsRead > 0 && report.totalFrames > 0 && rowsRead !== report.totalFrames) {
    error(
      'FRAME_COUNT_MISMATCH',
      `info.json declares ${report.totalFrames} frames and the data parquet holds ${rowsRead}`,
    );
  }
  // Only when every data file was opened. Backfilling a partial count made the
  // first 8 files' row total the dataset's recorded `totalFrames`, which is
  // then what the training split and the UI both believe.
  if (readAll && report.totalFrames === 0 && rowsRead > 0) report.totalFrames = rowsRead;
  if (!readAll && report.totalFrames === 0 && metaFrames !== null) report.totalFrames = metaFrames;

  // ---- widths against the robot type --------------------------------------
  // An error, not a warning. A dataset whose state vector is the wrong width
  // for the robot it claims cannot train that robot, and the message it
  // produces at training time names neither number.
  const declaredState = (features['observation.state']?.shape ?? [])[0];
  const declaredAction = (features['action']?.shape ?? [])[0];
  if (report.observedStateWidth !== null && declaredState !== undefined
      && report.observedStateWidth !== declaredState) {
    error(
      'STATE_WIDTH_MISMATCH',
      `info.json declares observation.state of width ${declaredState} and the parquet holds ${report.observedStateWidth}`,
    );
  }
  if (report.observedActionWidth !== null && declaredAction !== undefined
      && report.observedActionWidth !== declaredAction) {
    error(
      'ACTION_WIDTH_MISMATCH',
      `info.json declares action of width ${declaredAction} and the parquet holds ${report.observedActionWidth}`,
    );
  }
  const seenState = report.observedStateWidth ?? declaredState;
  const seenAction = report.observedActionWidth ?? declaredAction;
  // `expected.proprioceptionDim && …` treats 0 and null identically, and every
  // RobotType in this database carries 0 — so the check that exists to catch a
  // 28-wide state vector on a 43-DOF G1 EDU silently does nothing, and the
  // report reads as though it passed. Say that it was skipped.
  if (!expected.proprioceptionDim && !expected.actionDim) {
    warn(
      'ROBOT_DIMS_UNKNOWN',
      'The robot type declares no proprioceptionDim or actionDim, so the vector widths were '
      + 'not checked against the robot. A dataset of the wrong width for its robot will not be '
      + 'caught until training.',
    );
  }
  if (expected.proprioceptionDim && seenState !== undefined && seenState !== expected.proprioceptionDim) {
    error(
      'ROBOT_STATE_DIM_MISMATCH',
      `observation.state is ${seenState} wide and this robot type declares proprioceptionDim ${expected.proprioceptionDim}`,
    );
  }
  if (expected.actionDim && seenAction !== undefined && seenAction !== expected.actionDim) {
    error(
      'ROBOT_ACTION_DIM_MISMATCH',
      `action is ${seenAction} wide and this robot type declares actionDim ${expected.actionDim}`,
    );
  }

  // ---- stats.json, still optional -----------------------------------------
  const statsEntry = await tree.stat('meta/stats.json');
  if (statsEntry) {
    report.files.push({ path: 'meta/stats.json', size: statsEntry.size, kind: 'meta' });
    try {
      report.stats = JSON.parse((await tree.read('meta/stats.json')).toString()) as Record<string, unknown>;
    } catch {
      warn('BAD_STATS', 'stats.json exists but could not be parsed');
    }
  } else {
    warn('MISSING_STATS', 'Missing stats.json — normalization statistics are not available');
  }

  report.totalDuration = report.fps > 0 ? report.totalFrames / report.fps : 0;
  report.valid = report.errors.length === 0;
  return report;
}
