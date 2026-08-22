/**
 * @file LocalDatasetView.ts
 * @description The v2.1 directory the episode/frame/video readers can serve,
 *              for a dataset on local disk that may be either version.
 * @feature training
 *
 * THE PROBLEM. Everything this platform writes is v3.0 and everything it reads
 * is v2.1, so the datasets it produces are the ones it handles worst: the
 * episode viewer shows nothing, `/episodes/:i/frames` 404s, the player stays
 * black, curation refuses with `V3_TRIM_UNSUPPORTED`, and
 * `register-local-dataset.ts` would not even let one be registered. The
 * conversion step that closes the gap was a script in an external checkout that
 * the docs called mandatory.
 *
 * THE CHOICE. Teach the three readers v3.0, or convert once and keep the
 * readers. Converting wins on the thing that matters here: the v2.1 readers are
 * the paths that work today and are already tested, and a second implementation
 * of "where is episode 7" is a second place for it to be wrong. So a v3.0
 * dataset gets a v2.1 VIEW built on first read.
 *
 * THE VIEW IS A CACHE. It is regenerable from the v3.0 tree and safe to delete;
 * nothing points a `Dataset` row at it. It is keyed by the source path AND the
 * source's newest mtime, so re-recording into the same directory invalidates it
 * rather than serving yesterday's episodes.
 */

import { spawn } from 'child_process';
import { createHash } from 'crypto';
import { existsSync } from 'fs';
import { mkdir, readFile, readdir, rm, stat } from 'fs/promises';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

/** Where views are built. Configurable because a deployment may want a volume. */
function cacheRoot(): string {
  const configured = process.env.DATASET_VIEW_CACHE_DIR;
  if (configured) return resolve(configured);
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '../../../data/dataset-views');
}

/**
 * The interpreter that has pyarrow. Same convention as the sim's `SIM_PYTHON`.
 *
 * Falls back to `server/curation/.venv/bin/python` before bare `python3`,
 * because that venv is what `server/curation/README.md` tells you to create and
 * what `test-all.sh` looks for. Requiring an env var as well would mean the
 * viewer is dark on a machine that has everything it needs.
 */
function converterPython(): string {
  const configured = process.env.CURATION_PYTHON || process.env.PYTHON_BIN;
  if (configured) return configured;
  const here = dirname(fileURLToPath(import.meta.url));
  const venv = resolve(here, '../../../curation/.venv/bin/python');
  if (existsSync(venv)) return venv;
  return 'python3';
}

function converterScript(): string {
  // Overridable for the same reason `CURATION_PYTHON` is: a deployment may put
  // the curation tree somewhere else, and a test needs a converter it controls.
  const configured = process.env.DATASET_VIEW_CONVERTER;
  if (configured) return configured;
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '../../../curation/lerobot_v3_to_v2.py');
}

export interface ViewResult {
  /** The directory to read from — the source itself when it is already v2.1. */
  root: string;
  /** What the source declared. */
  sourceVersion: string;
  /** True when `root` is a generated view rather than the dataset itself. */
  converted: boolean;
}

export class DatasetViewError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'DatasetViewError';
  }
}

/**
 * A stamp that changes when the dataset does.
 *
 * Only `meta/` is walked. The first version walked the WHOLE tree with a
 * 4000-file budget, which is wrong twice over: on a dataset with more than 4000
 * files the walk stops early, so re-recording into the same directory can leave
 * the stamp unchanged and a stale view is served forever with no way to
 * invalidate it; and on every dataset it re-stats up to 4000 files on every
 * request, cache hit included.
 *
 * `meta/` is the right scope because it is what defines the dataset: `info.json`
 * carries the counts and the feature schema and `meta/episodes/**` carries every
 * row range and video window. Nothing can be added to `data/` or `videos/` that
 * an episode points at without `meta/episodes/**` being rewritten — that is the
 * v3.0 format, not an assumption about this writer. The file count and the total
 * size go in as well, so two writes in the same millisecond cannot collide.
 */
async function metaStamp(dir: string): Promise<string> {
  let newest = 0;
  let files = 0;
  let bytes = 0;
  const walk = async (at: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(at, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(at, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      try {
        const info = await stat(full);
        files++;
        bytes += info.size;
        if (info.mtimeMs > newest) newest = info.mtimeMs;
      } catch {
        /* a file that vanished mid-walk is not a reason to fail a read */
      }
    }
  };
  await walk(join(dir, 'meta'));
  return `${Math.round(newest)}:${files}:${bytes}`;
}

/**
 * The converter's own identity, so fixing the converter invalidates the views
 * it built. Without this a wrong view stays wrong until someone deletes it by
 * hand — which is precisely the bug this task fixed in the video cut.
 */
let converterStampCache: string | null = null;
async function converterStamp(): Promise<string> {
  if (converterStampCache !== null) return converterStampCache;
  try {
    const info = await stat(converterScript());
    converterStampCache = `${Math.round(info.mtimeMs)}:${info.size}`;
  } catch {
    converterStampCache = 'unknown';
  }
  return converterStampCache;
}

async function readVersion(root: string): Promise<string | null> {
  try {
    const info = JSON.parse(await readFile(join(root, 'meta', 'info.json'), 'utf8')) as {
      codebase_version?: string;
    };
    return String(info.codebase_version ?? '');
  } catch {
    return null;
  }
}

/**
 * In-flight conversions, keyed by view directory.
 *
 * Without this, the viewer's three parallel opening requests — episodes,
 * frames, video — each start their own ffmpeg run over the same recording.
 */
const inFlight = new Map<string, Promise<void>>();

/** How long one conversion may run, and how much of its chatter is kept. */
const CONVERT_TIMEOUT_MS = Number(process.env.DATASET_VIEW_CONVERT_TIMEOUT_MS ?? 15 * 60_000);
const MAX_CONVERTER_OUTPUT = 64 * 1024;

/** How long a failed conversion is remembered before it is attempted again. */
const FAILURE_COOLDOWN_MS = Number(process.env.DATASET_VIEW_FAILURE_COOLDOWN_MS ?? 30_000);

/** The last failure per view directory, so a broken dataset is not retried hot. */
const failures = new Map<string, { code: string; detail: string; at: number }>();

function runConverter(source: string, out: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    // Bounded. A wedged ffmpeg held every request for that dataset open until
    // the server was restarted, and an ffmpeg that decided to talk filled the
    // API process's heap one `stderr` chunk at a time.
    const child = spawn(converterPython(), [converterScript(), source, out, '--force'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: CONVERT_TIMEOUT_MS,
      killSignal: 'SIGKILL',
    });
    let stdout = '';
    let stderr = '';
    const cap = (current: string, chunk: Buffer): string => (
      current.length > MAX_CONVERTER_OUTPUT ? current : current + chunk.toString()
    );
    child.stdout.on('data', (d: Buffer) => { stdout = cap(stdout, d); });
    child.stderr.on('data', (d: Buffer) => { stderr = cap(stderr, d); });
    child.on('error', (err) => {
      reject(new DatasetViewError('CONVERTER_UNAVAILABLE',
        `Could not run ${converterPython()}: ${err.message}. Set CURATION_PYTHON to an interpreter with pyarrow.`));
    });
    child.on('close', (code, signal) => {
      if (code === 0) return resolvePromise();
      if (signal === 'SIGKILL') {
        return reject(new DatasetViewError('CONVERT_TIMEOUT',
          `the converter did not finish within ${CONVERT_TIMEOUT_MS} ms for ${source}`));
      }
      // The converter reports structured codes on stdout precisely so this
      // does not have to guess from a stack trace.
      let parsed: { error?: string; detail?: string } = {};
      try {
        parsed = JSON.parse(stdout.trim().split('\n').pop() ?? '{}') as typeof parsed;
      } catch {
        /* fall through to the raw stderr */
      }
      reject(new DatasetViewError(
        parsed.error ?? 'CONVERT_FAILED',
        parsed.detail ?? (stderr.trim().slice(0, 400) || `converter exited ${code}`),
      ));
    });
  });
}

/**
 * The directory to read this dataset from.
 *
 * v2.1 in, the same directory out — no copy, no conversion, nothing changes for
 * every dataset that works today. v3.0 in, a converted view, built once.
 */
export async function resolveLocalView(
  storagePath: string,
  options: { into?: string } = {},
): Promise<ViewResult> {
  const source = resolve(storagePath);
  const version = await readVersion(source);
  if (version === null) {
    throw new DatasetViewError('NOT_A_DATASET', `no meta/info.json under ${source}`);
  }
  if (!version.startsWith('v3')) {
    return { root: source, sourceVersion: version || 'unknown', converted: false };
  }

  // `into` is for a caller that owns the view's lifetime — a curation run over
  // a dataset it just downloaded to a temp directory. Keying the persistent
  // cache on a temp path that will never recur means every such run leaves a
  // full extra copy behind that nothing will ever hit or sweep.
  if (options.into) {
    await mkdir(dirname(options.into), { recursive: true });
    await runConverter(source, options.into);
    return { root: options.into, sourceVersion: version, converted: true };
  }

  // The stamp is in the key, not checked against the view: a stale view for an
  // older recording keeps working while the new one builds, and neither is ever
  // half-written (the converter stages and renames).
  const stamp = await metaStamp(source);
  const key = createHash('sha256')
    .update(`${source}\0${stamp}\0${await converterStamp()}`)
    .digest('hex').slice(0, 16);
  const view = join(cacheRoot(), key);

  if (existsSync(join(view, 'meta', 'info.json'))) {
    return { root: view, sourceVersion: version, converted: true };
  }

  // A conversion that failed is remembered for a cooldown. Without this the
  // viewer's three parallel requests each re-spawned the whole converter, and
  // then did it again on every reload — for a dataset whose video is missing,
  // that is an ffmpeg run per second forever.
  const failed = failures.get(view);
  if (failed && Date.now() - failed.at < FAILURE_COOLDOWN_MS) {
    throw new DatasetViewError(failed.code, failed.detail);
  }

  let pending = inFlight.get(view);
  if (!pending) {
    pending = (async () => {
      await mkdir(cacheRoot(), { recursive: true });
      await runConverter(source, view);
      failures.delete(view);
      await sweepSupersededViews(source, key);
    })()
      .catch((err: unknown) => {
        if (err instanceof DatasetViewError) {
          failures.set(view, { code: err.code, detail: err.message, at: Date.now() });
        }
        throw err;
      })
      .finally(() => inFlight.delete(view));
    inFlight.set(view, pending);
  }
  await pending;
  return { root: view, sourceVersion: version, converted: true };
}

/**
 * Delete the views built from this same source under an older stamp.
 *
 * The cache is keyed by source AND content, so every re-recording into the same
 * directory left a complete extra copy of the dataset behind and nothing ever
 * removed any of them. Ten sessions into a directory is ten full copies on the
 * pod's disk. The converter writes `_neodem_converted_from.path` into each
 * view's `info.json` for exactly this.
 */
async function sweepSupersededViews(source: string, keep: string): Promise<void> {
  let entries;
  try {
    entries = await readdir(cacheRoot(), { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === keep) continue;
    const dir = join(cacheRoot(), entry.name);
    try {
      const info = JSON.parse(await readFile(join(dir, 'meta', 'info.json'), 'utf8')) as {
        _neodem_converted_from?: { path?: string };
      };
      if (info._neodem_converted_from?.path !== source) continue;
      await rm(dir, { recursive: true, force: true });
    } catch {
      /* a view we cannot read is one we must not delete */
    }
  }
}

/** For tests, so one case's cache does not decide the next case's result. */
export function clearViewCacheState(): void {
  inFlight.clear();
  failures.clear();
  converterStampCache = null;
}
