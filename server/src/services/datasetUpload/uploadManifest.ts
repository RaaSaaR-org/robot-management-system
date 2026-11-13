/**
 * @file uploadManifest.ts
 * @description What a direct dataset upload may contain: limits from the
 *              environment, and the up-front check of the file manifest a
 *              client declares before it sends a byte (TASK-480).
 * @feature datasets
 *
 * Everything here is pure, on purpose. The manifest is client input and it
 * decides what ends up under a dataset's storage prefix, so the rules — which
 * paths are safe, which files a LeRobot tree needs, how a file splits into
 * parts — are checked once at start and are testable without a store.
 */

import { posix } from 'path';
import { AppError } from '../../utils/errors.js';
import type { LeRobotInfoV3 } from '../../types/dataset.types.js';
import { selectRepoFiles } from '../HuggingFaceImportService.js';

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

/** S3 refuses a multipart part under 5 MiB unless it is the last one. */
export const MIN_CHUNK_BYTES = 5 * MIB;
/** No configuration raises a part above this: the gateway caps a body at 100 MB. */
export const HARD_MAX_CHUNK_BYTES = 64 * MIB;
export const DEFAULT_CHUNK_BYTES = 32 * MIB;
export const DEFAULT_MAX_TOTAL_BYTES = 10 * GIB;
export const DEFAULT_MAX_FILES = 20_000;
export const DEFAULT_MODEL_MAX_TOTAL_BYTES = 64 * GIB;
export const DEFAULT_MODEL_MAX_FILES = 2_000;
export const DEFAULT_IDLE_MINUTES = 360;
export const DEFAULT_MAX_CONCURRENT_PARTS = 4;
/** S3's own ceiling on the parts of one multipart upload. */
export const MAX_PARTS_PER_FILE = 10_000;
export const MAX_PATH_LENGTH = 1024;

/** A refusal the client can act on: an HTTP status, a stable code, and context. */
export class DatasetUploadError extends AppError {
  constructor(code: string, message: string, status = 400, context?: Record<string, unknown>) {
    super(message, status, code, context);
  }
}

export interface UploadLimits {
  /** Bytes per part when the client does not ask for a smaller one; also the server's maximum. */
  chunkBytes: number;
  /** The most one upload may declare in total. */
  maxTotalBytes: number;
  maxFiles: number;
  /** An upload nothing was sent to for this long is reaped. */
  idleMs: number;
  /** Part requests the server streams at once; more answer 503 `UPLOAD_BUSY`. */
  maxConcurrentParts: number;
  /**
   * What the object store can hold in all, when the operator says
   * (`DATASET_UPLOAD_STORE_CAPACITY_BYTES`, read by every kind of upload). S3
   * reports no free space, so without it an upload into RustFS is checked
   * against `maxTotalBytes` only.
   */
  storeCapacityBytes: number | null;
}

function positiveNumber(name: string, fallback: number, env: NodeJS.ProcessEnv): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (Number.isFinite(value) && value > 0) return value;
  console.warn(`[Upload] ${name}=${raw} is not a positive number; using ${fallback}`);
  return fallback;
}

/** What differs between the kinds of upload: the variable prefix and two defaults. */
interface LimitDefaults {
  prefix: string;
  maxTotalBytes: number;
  maxFiles: number;
}

function readLimits(env: NodeJS.ProcessEnv, defaults: LimitDefaults): UploadLimits {
  const name = (suffix: string): string => `${defaults.prefix}_${suffix}`;
  const chunk = Math.floor(positiveNumber(name('CHUNK_BYTES'), DEFAULT_CHUNK_BYTES, env));
  // One object store, one capacity: every kind of upload reads the same variable.
  const capacity = env.DATASET_UPLOAD_STORE_CAPACITY_BYTES?.trim()
    ? positiveNumber('DATASET_UPLOAD_STORE_CAPACITY_BYTES', 0, env)
    : 0;
  return {
    chunkBytes: Math.min(HARD_MAX_CHUNK_BYTES, Math.max(MIN_CHUNK_BYTES, chunk)),
    maxTotalBytes: Math.floor(positiveNumber(name('MAX_BYTES'), defaults.maxTotalBytes, env)),
    maxFiles: Math.floor(positiveNumber(name('MAX_FILES'), defaults.maxFiles, env)),
    idleMs: positiveNumber(name('IDLE_MINUTES'), DEFAULT_IDLE_MINUTES, env) * 60_000,
    maxConcurrentParts: Math.max(1, Math.floor(
      positiveNumber(name('MAX_CONCURRENT_PARTS'), DEFAULT_MAX_CONCURRENT_PARTS, env),
    )),
    storeCapacityBytes: capacity > 0 ? Math.floor(capacity) : null,
  };
}

/** The limits this process runs with, read from the environment on every call. */
export function uploadLimits(env: NodeJS.ProcessEnv = process.env): UploadLimits {
  return readLimits(env, {
    prefix: 'DATASET_UPLOAD',
    maxTotalBytes: DEFAULT_MAX_TOTAL_BYTES,
    maxFiles: DEFAULT_MAX_FILES,
  });
}

/**
 * The limits of a model checkpoint upload (TASK-498): the same knobs under
 * `MODEL_UPLOAD_*`. A checkpoint is few files and many bytes — a GR00T N1.7
 * finetune is 6.5 GiB in a dozen files — so the size cap is higher and the
 * file cap lower than a dataset's.
 */
export function modelUploadLimits(env: NodeJS.ProcessEnv = process.env): UploadLimits {
  return readLimits(env, {
    prefix: 'MODEL_UPLOAD',
    maxTotalBytes: DEFAULT_MODEL_MAX_TOTAL_BYTES,
    maxFiles: DEFAULT_MODEL_MAX_FILES,
  });
}

/**
 * The part size one upload uses: the server's, or a smaller one the client
 * asked for. Never under S3's 5 MiB floor, never over the server's maximum.
 */
export function resolveChunkSize(requested: unknown, limits: UploadLimits): number {
  if (requested === undefined || requested === null) return limits.chunkBytes;
  if (typeof requested !== 'number' || !Number.isInteger(requested)) {
    throw new DatasetUploadError('INVALID_CHUNK_SIZE', 'chunkSize must be an integer number of bytes');
  }
  if (requested < MIN_CHUNK_BYTES || requested > limits.chunkBytes) {
    throw new DatasetUploadError(
      'INVALID_CHUNK_SIZE',
      `chunkSize must be between ${MIN_CHUNK_BYTES} and ${limits.chunkBytes} bytes; got ${requested}. `
        + 'Omit it to use the server default.',
      400,
      { minChunkSize: MIN_CHUNK_BYTES, maxChunkSize: limits.chunkBytes },
    );
  }
  return requested;
}

/** One file of an upload, as the session stores it. `id` is its index in the accepted list. */
export interface UploadFileEntry {
  id: number;
  path: string;
  size: number;
  /** Lower-case hex, when the client declared one; verified after the upload is finished. */
  sha256?: string;
  partCount: number;
  /** The open S3 multipart upload, for a file of more than one part stored in RustFS. */
  uploadId?: string;
}

export interface IgnoredFile {
  path: string;
  reason: string;
}

export interface ManifestCheck {
  files: UploadFileEntry[];
  /** Declared files that are safe but not part of a LeRobot tree; they are not uploaded. */
  ignored: IgnoredFile[];
  totalBytes: number;
  /** `full` when camera files are in the manifest, `metadata` when it is tables only. */
  importMode: 'full' | 'metadata';
}

/** How many parts a file of `size` bytes has. An empty file is one empty part. */
export function partCountOf(size: number, chunkSize: number): number {
  return Math.max(1, Math.ceil(size / chunkSize));
}

/** The exact length of part `partNumber` (1-based) of `file`. */
export function partSizeOf(file: Pick<UploadFileEntry, 'size' | 'partCount'>, partNumber: number, chunkSize: number): number {
  return partNumber < file.partCount ? chunkSize : file.size - (file.partCount - 1) * chunkSize;
}

const SHA256_RE = /^[0-9a-f]{64}$/;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/**
 * Why `path` cannot name a file under a dataset prefix, or null when it can.
 *
 * A relative POSIX path of plain segments and nothing else: no leading slash,
 * no backslash, no `.` or `..`, no empty segment, no control character. The
 * object key is `<prefix>/<path>` and the local file is `<root>/<path>`, so a
 * path that passes cannot leave either.
 */
export function unsafePathReason(path: unknown): string | null {
  if (typeof path !== 'string' || path.length === 0) return 'path must be a non-empty string';
  if (path.length > MAX_PATH_LENGTH) return `path is longer than ${MAX_PATH_LENGTH} characters`;
  if (CONTROL_CHARS.test(path)) return 'path contains a control character';
  if (path.includes('\\')) return 'path contains a backslash; use forward slashes';
  if (path.startsWith('/')) return 'path is absolute; it must be relative to the dataset root';
  if (/^[A-Za-z]:/.test(path)) return 'path names a drive; it must be relative to the dataset root';
  const segments = path.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    return 'path has an empty, "." or ".." segment';
  }
  if (posix.normalize(path) !== path) return 'path is not in normal form';
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The `info` a client sends at start — the contents of its `meta/info.json` —
 * checked for the fields the dataset row and the robot-type match are built
 * from. The stored file is what validation reads later; this copy only has to
 * be enough to refuse a directory that is not a LeRobot dataset before any
 * byte of it is sent.
 */
export function checkInfo(info: unknown): LeRobotInfoV3 {
  if (!isRecord(info)) {
    throw new DatasetUploadError(
      'INVALID_INFO',
      'info is required: send the parsed contents of the dataset\'s meta/info.json',
    );
  }
  const version = typeof info.codebase_version === 'string' ? info.codebase_version : '';
  if (!/^v[23]\./.test(version)) {
    throw new DatasetUploadError(
      'UNSUPPORTED_VERSION',
      `info.codebase_version is ${version ? `"${version}"` : 'missing'}; this server reads LeRobot v2.x and v3.0 datasets`,
    );
  }
  if (typeof info.robot_type !== 'string' || info.robot_type.trim() === '') {
    throw new DatasetUploadError('INVALID_INFO', 'info.robot_type is missing');
  }
  const fps = Number(info.fps);
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new DatasetUploadError('INVALID_INFO', 'info.fps is missing or not a positive number');
  }
  if (!isRecord(info.features) || Object.keys(info.features).length === 0) {
    throw new DatasetUploadError('INVALID_INFO', 'info.features is missing or empty');
  }
  return info as unknown as LeRobotInfoV3;
}

/** One declared file that passed the path, size and checksum checks. */
export interface DeclaredFile {
  path: string;
  size: number;
  sha256?: string;
}

/** What an upload is called in a refusal, and which variable raises its size cap. */
export interface ManifestNouns {
  /** "dataset" / "model" */
  thing: string;
  maxBytesVariable: string;
}

/**
 * Read the declared `files` of a start request: every entry a safe relative
 * path, a size and an optional sha256, no path twice.
 *
 * An unsafe path refuses the whole request — a client that sends `../x` is
 * wrong in a way worth stopping for.
 */
export function parseDeclaredFiles(declared: unknown, limits: UploadLimits, nouns: ManifestNouns): DeclaredFile[] {
  if (!Array.isArray(declared) || declared.length === 0) {
    throw new DatasetUploadError('INVALID_MANIFEST', `files is required: an array of { path, size } for every file of the ${nouns.thing}`);
  }
  if (declared.length > limits.maxFiles) {
    throw new DatasetUploadError(
      'TOO_MANY_FILES',
      `The manifest declares ${declared.length} files; this server accepts at most ${limits.maxFiles} per upload.`,
      413,
      { maxFiles: limits.maxFiles },
    );
  }

  const seen = new Set<string>();
  const out: DeclaredFile[] = [];
  for (const [index, raw] of declared.entries()) {
    if (!isRecord(raw)) {
      throw new DatasetUploadError('INVALID_MANIFEST', `files[${index}] must be an object with path and size`);
    }
    const reason = unsafePathReason(raw.path);
    if (reason) {
      throw new DatasetUploadError('INVALID_PATH', `files[${index}]: ${reason}`, 400, {
        index,
        ...(typeof raw.path === 'string' ? { path: raw.path.slice(0, 200) } : {}),
      });
    }
    const path = raw.path as string;
    if (seen.has(path)) {
      throw new DatasetUploadError('DUPLICATE_PATH', `files[${index}]: ${path} is declared twice`, 400, { path });
    }
    seen.add(path);
    if (typeof raw.size !== 'number' || !Number.isSafeInteger(raw.size) || raw.size < 0) {
      throw new DatasetUploadError('INVALID_MANIFEST', `files[${index}] (${path}): size must be a non-negative integer number of bytes`, 400, { path });
    }
    let sha256: string | undefined;
    if (raw.sha256 !== undefined && raw.sha256 !== null) {
      sha256 = typeof raw.sha256 === 'string' ? raw.sha256.toLowerCase() : '';
      if (!SHA256_RE.test(sha256)) {
        throw new DatasetUploadError('INVALID_MANIFEST', `files[${index}] (${path}): sha256 must be 64 hex characters`, 400, { path });
      }
    }
    out.push({ path, size: raw.size, ...(sha256 ? { sha256 } : {}) });
  }
  return out;
}

/**
 * Turn the files that will be uploaded into session entries: an id, a part
 * count, and the checks that need the whole list — no path that is both a file
 * and a directory, no file over S3's part ceiling, and the total under the cap.
 *
 * `declaredPaths` is every path the client declared, the ones left out
 * included: a file the upload skips still cannot be a directory of one it takes.
 */
export function toUploadEntries(
  accepted: DeclaredFile[],
  declaredPaths: ReadonlySet<string>,
  chunkSize: number,
  limits: UploadLimits,
  nouns: ManifestNouns,
): { files: UploadFileEntry[]; totalBytes: number } {
  // `a/b` as a file and `a/b/c` under it cannot both exist on a disk.
  for (const { path } of accepted) {
    let slash = path.indexOf('/');
    while (slash !== -1) {
      const parent = path.slice(0, slash);
      if (declaredPaths.has(parent)) {
        throw new DatasetUploadError('INVALID_PATH', `${parent} is declared as a file and as a directory of ${path}`, 400, { path });
      }
      slash = path.indexOf('/', slash + 1);
    }
  }

  const files: UploadFileEntry[] = accepted.map((file, id) => ({
    id,
    ...file,
    partCount: partCountOf(file.size, chunkSize),
  }));
  const tooManyParts = files.find((f) => f.partCount > MAX_PARTS_PER_FILE);
  if (tooManyParts) {
    throw new DatasetUploadError(
      'FILE_TOO_LARGE',
      `${tooManyParts.path} would need ${tooManyParts.partCount} parts of ${chunkSize} bytes; the limit is ${MAX_PARTS_PER_FILE}.`,
      413,
      { path: tooManyParts.path },
    );
  }

  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
  if (totalBytes > limits.maxTotalBytes) {
    throw new DatasetUploadError(
      'UPLOAD_TOO_LARGE',
      `The ${nouns.thing} is ${totalBytes} bytes; this server accepts at most ${limits.maxTotalBytes} bytes per upload `
        + `(${nouns.maxBytesVariable}).`,
      413,
      { totalBytes, maxTotalBytes: limits.maxTotalBytes },
    );
  }
  return { files, totalBytes };
}

const DATASET_NOUNS: ManifestNouns = { thing: 'dataset', maxBytesVariable: 'DATASET_UPLOAD_MAX_BYTES' };

/**
 * Check the declared files and split them into what will be uploaded and what
 * is left out.
 *
 * A safe path that a LeRobot tree does not need (a README, a `.gitattributes`)
 * is only listed as ignored, so a client can declare a directory as it is.
 * Which files a tree needs is the importer's `selectRepoFiles`, so both ways
 * in accept exactly the same tree.
 */
export function checkManifest(
  declared: unknown,
  info: LeRobotInfoV3,
  chunkSize: number,
  limits: UploadLimits,
): ManifestCheck {
  const all = parseDeclaredFiles(declared, limits, DATASET_NOUNS);
  const accepted: DeclaredFile[] = [];
  const ignored: IgnoredFile[] = [];
  for (const file of all) {
    if (selectRepoFiles([{ path: file.path, size: file.size }], true).length === 0) {
      ignored.push({
        path: file.path,
        reason: 'not part of a LeRobot dataset tree (meta/**, data/**/*.parquet, videos/**/*.mp4, images/**)',
      });
      continue;
    }
    accepted.push(file);
  }

  const has = (test: (path: string) => boolean): boolean => accepted.some((f) => test(f.path));
  const missing: string[] = [];
  const infoFile = accepted.find((f) => f.path === 'meta/info.json');
  if (!infoFile || infoFile.size === 0) missing.push('meta/info.json');
  if (!has((p) => p.startsWith('data/') && p.endsWith('.parquet'))) missing.push('data/**/*.parquet (the episode tables)');
  if (String(info.codebase_version).startsWith('v3')) {
    if (!has((p) => p.startsWith('meta/episodes/') && p.endsWith('.parquet'))) {
      missing.push('meta/episodes/**/*.parquet (v3.0 episode rows)');
    }
  } else if (!has((p) => p === 'meta/episodes.jsonl' || p === 'meta/episodes.json')) {
    missing.push('meta/episodes.jsonl (v2.x episode rows)');
  }
  if (missing.length > 0) {
    throw new DatasetUploadError(
      'NOT_A_LEROBOT_DATASET',
      `The manifest is not a LeRobot ${info.codebase_version} dataset tree — missing: ${missing.join('; ')}. `
        + 'Paths must be relative to the dataset root (the directory that holds meta/ and data/).',
      400,
      { missing },
    );
  }

  const { files, totalBytes } = toUploadEntries(
    accepted, new Set(all.map((f) => f.path)), chunkSize, limits, DATASET_NOUNS,
  );

  const importMode = has((p) => p.startsWith('videos/') || p.startsWith('images/')) ? 'full' : 'metadata';
  return { files, ignored, totalBytes, importMode };
}
