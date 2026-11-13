/**
 * @file DatasetFilesService.ts
 * @description The files a dataset is stored as: a paginated manifest of them, and each one as a byte stream (TASK-496)
 * @feature datasets
 *
 * What a client needs to take a dataset back out of the instance exactly as it
 * went in — `meta/`, `data/`, `videos/` at the same relative paths, the same
 * bytes — whichever way it arrived. A direct upload and a Hugging Face import
 * both end as `<storagePath><relative path>`: objects under a prefix of the
 * `training-datasets` bucket (or the legacy `datasets` one), or files under a
 * directory on this server's disk. Both are read here as they are stored; a
 * local v3.0 dataset's converted v2.1 *view* is a cache elsewhere on disk and
 * is never what this serves.
 *
 * `storagePath` is a column a member can fill in, so a local one is not
 * trusted: its realpath must sit under a directory this server keeps datasets
 * in (`confineToRoots`, the rule publishing to the Hub goes by), symlinks are
 * neither listed nor followed, and a requested path is checked twice — as a
 * string, then by where it resolves to.
 */

import { createReadStream } from 'fs';
import { lstat, readdir, realpath } from 'fs/promises';
import { join, sep } from 'path';
import type { Readable } from 'stream';
import { AppError } from '../utils/errors.js';
import { BUCKETS } from '../storage/model-storage.js';
import { isLocalStoragePath } from './lerobot/DatasetTree.js';
import { unsafePathReason } from './datasetUpload/uploadManifest.js';
import { confineToRoots, defaultDatasetRoots } from './HuggingFacePublishService.js';
import { datasetUploadRepository } from '../repositories/DatasetUploadRepository.js';

/** A refusal of a files request: status, stable `code`, a sentence a person can act on. */
export class DatasetFilesError extends AppError {
  constructor(code: string, message: string, status = 400, context?: Record<string, unknown>) {
    super(message, status, code, context);
  }
}

/** The dataset fields the files API goes by. */
export interface FilesDataset {
  id: string;
  storagePath?: string | null;
  status?: string | null;
  kind?: string | null;
}

/** Where a dataset's files are. */
export type DatasetFilesLocation =
  | { storage: 'local'; root: string }
  | { storage: 'rustfs'; bucket: string; base: string };

export interface DatasetFileEntry {
  /** Relative to the dataset root, forward slashes. */
  path: string;
  size: number;
  /** The object store's ETag without its quotes. Opaque: an MD5 only for an object stored in one piece. */
  etag?: string;
  /** Lower-case hex of the whole file, when the dataset arrived by a direct upload that declared one. */
  sha256?: string;
}

export interface DatasetFilesPage {
  files: DatasetFileEntry[];
  /** Pass as `after` for the next page; null on the last one. */
  nextCursor: string | null;
}

export const DEFAULT_FILES_PAGE = 1000;
export const MAX_FILES_PAGE = 1000;

/** Buckets a dataset prefix may be in: where everything is written today, then the legacy one. */
const DATASET_BUCKETS = [BUCKETS.TRAINING_DATASETS, 'datasets'];

/** S3's answer for an object or bucket that is not there. */
function isMissing(error: unknown): boolean {
  const name = (error as { name?: string } | null)?.name;
  return name === 'NoSuchKey' || name === 'NotFound' || name === 'NoSuchBucket';
}

function unquote(etag: string | undefined): string | undefined {
  const value = etag?.replace(/^W\//, '').replace(/^"|"$/g, '');
  return value ? value : undefined;
}

/** Byte order of the UTF-8 form — the order an object store lists keys in. */
function byKeyOrder(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

async function rustfs() {
  const { isRustFSInitialized, getRustFSClient } = await import('../storage/rustfs-client.js');
  if (!isRustFSInitialized()) {
    throw new DatasetFilesError(
      'STORAGE_UNAVAILABLE',
      'Object storage is unavailable, so the dataset\'s files cannot be read',
      503,
      { retryAfterSeconds: 5 },
    );
  }
  return getRustFSClient();
}

/**
 * Where `dataset`'s files are, or a refusal saying why they cannot be handed out.
 */
export async function locateDatasetFiles(dataset: FilesDataset): Promise<DatasetFilesLocation> {
  if (dataset.kind === 'view') {
    throw new DatasetFilesError('DATASET_IS_VIEW', 'This dataset is a view with no files of its own', 409);
  }
  if (dataset.status === 'uploading' || dataset.status === 'importing') {
    throw new DatasetFilesError(
      'DATASET_NOT_READY',
      `The dataset is still ${dataset.status}; its files are not all in place yet`,
      409,
      { status: dataset.status },
    );
  }
  const stored = (dataset.storagePath ?? '').trim();
  if (!stored || /^\/*$/.test(stored)) {
    throw new DatasetFilesError('NO_STORED_FILES', 'This dataset has no stored files', 409);
  }

  if (isLocalStoragePath(stored)) {
    const root = await confineToRoots(stored, defaultDatasetRoots());
    if (!root) {
      throw new DatasetFilesError(
        'DATASET_PATH_NOT_ALLOWED',
        'The dataset\'s directory is not under a directory this server keeps datasets in, so its files are not served',
        403,
      );
    }
    return { storage: 'local', root };
  }
  if (stored.startsWith('/')) {
    // An absolute path that is not on this disk: a directory that is gone, or another machine's.
    throw new DatasetFilesError('NO_STORED_FILES', 'The dataset\'s directory is not on this server', 409);
  }

  const client = await rustfs();
  const base = stored.endsWith('/') ? stored : `${stored}/`;
  let firstError: unknown = null;
  let listedAny = false;
  for (const bucket of DATASET_BUCKETS) {
    try {
      const probe = await client.list(bucket, { prefix: base, maxKeys: 1 });
      listedAny = true;
      if (probe.objects.length > 0) return { storage: 'rustfs', bucket, base };
    } catch (error) {
      // The legacy bucket may not exist at all; only an error on every bucket
      // says storage itself is failing.
      firstError ??= error;
    }
  }
  if (!listedAny) throw firstError;
  throw new DatasetFilesError('NO_STORED_FILES', 'No files for this dataset in object storage', 409);
}

/** Every regular file under `root`, relative, in key order. Symlinks are not followed and not listed. */
async function walkLocal(root: string): Promise<DatasetFileEntry[]> {
  const out: DatasetFileEntry[] = [];
  const pending: string[] = [''];
  while (pending.length > 0) {
    const relDir = pending.pop() as string;
    const entries = await readdir(join(root, relDir), { withFileTypes: true });
    for (const entry of entries) {
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) pending.push(rel);
      else if (entry.isFile()) {
        const stats = await lstat(join(root, rel));
        out.push({ path: rel, size: stats.size });
      }
    }
  }
  return out.sort((a, b) => byKeyOrder(a.path, b.path));
}

/** The whole-file SHA-256s a direct upload declared (and the server verified at finish), by path. */
async function declaredChecksums(datasetId: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  try {
    const session = await datasetUploadRepository.find(datasetId);
    if (session?.state === 'completed') {
      for (const file of session.files) if (file.sha256) out.set(file.path, file.sha256);
    }
  } catch {
    // A checksum is an extra; the manifest is still right without it.
  }
  return out;
}

/**
 * One page of the dataset's files, in key order, after the path `after`.
 */
export async function listDatasetFiles(
  datasetId: string,
  location: DatasetFilesLocation,
  options: { after?: string; limit?: number } = {},
): Promise<DatasetFilesPage> {
  const limit = Math.min(Math.max(options.limit ?? DEFAULT_FILES_PAGE, 1), MAX_FILES_PAGE);
  const after = options.after ?? '';
  let files: DatasetFileEntry[];
  let more: boolean;

  if (location.storage === 'local') {
    const all = await walkLocal(location.root);
    const rest = after ? all.filter((file) => byKeyOrder(file.path, after) > 0) : all;
    files = rest.slice(0, limit);
    more = rest.length > limit;
  } else {
    const client = await rustfs();
    const { bucket, base } = location;
    const page = await client.list(bucket, {
      prefix: base,
      maxKeys: limit,
      ...(after ? { startAfter: `${base}${after}` } : {}),
    });
    files = page.objects
      // A zero-byte "directory" marker is not a file of the dataset.
      .filter((object) => object.key.length > base.length && !object.key.endsWith('/'))
      // A store that does not implement StartAfter repeats what was listed; never hand that out twice.
      .filter((object) => !after || byKeyOrder(object.key.slice(base.length), after) > 0)
      .map((object) => ({ path: object.key.slice(base.length), size: object.size, etag: unquote(object.etag) }));
    more = page.isTruncated && page.objects.length > 0;
    if (more && files.length === 0) {
      // Nothing new on a truncated page: the cursor cannot advance, so say so instead of looping the client.
      throw new DatasetFilesError('STORE_ERROR', 'The object store did not page through the dataset\'s files', 502);
    }
  }

  const checksums = files.length > 0 ? await declaredChecksums(datasetId) : new Map<string, string>();
  for (const file of files) {
    const sha256 = checksums.get(file.path);
    if (sha256) file.sha256 = sha256;
  }
  return { files, nextCursor: more && files.length > 0 ? files[files.length - 1].path : null };
}

/** `path` checked as a string: a relative POSIX path of plain segments. */
export function checkFilePath(path: unknown): string {
  const reason = unsafePathReason(path);
  if (reason) throw new DatasetFilesError('INVALID_PATH', `Invalid file path: ${reason}`, 400);
  return path as string;
}

function notFound(path: string): DatasetFilesError {
  return new DatasetFilesError('FILE_NOT_FOUND', `The dataset has no file ${path}`, 404, { path });
}

/** The absolute path of a local dataset file, or a 404 when it is not a regular file inside the root. */
async function localFile(root: string, path: string): Promise<{ file: string; size: number }> {
  const candidate = join(root, ...path.split('/'));
  let real: string;
  try {
    real = await realpath(candidate);
  } catch {
    throw notFound(path);
  }
  // A symlink anywhere on the way would resolve elsewhere: that is not a file of this dataset.
  if (real !== candidate || !real.startsWith(root + sep)) throw notFound(path);
  const stats = await lstat(real);
  if (!stats.isFile()) throw notFound(path);
  return { file: real, size: stats.size };
}

export interface DatasetFileHandle {
  size: number;
  etag?: string;
  /** Open the file, or only the inclusive byte `range` of it. The caller owns the stream. */
  open(range: { start: number; end: number } | undefined, signal: AbortSignal): Readable | Promise<Readable>;
}

/**
 * One stored file of the dataset: its size, and how to open it. `path` must
 * have passed {@link checkFilePath}.
 */
export async function statDatasetFile(location: DatasetFilesLocation, path: string): Promise<DatasetFileHandle> {
  if (location.storage === 'local') {
    const { file, size } = await localFile(location.root, path);
    return { size, open: (range) => createReadStream(file, range ?? {}) };
  }
  const client = await rustfs();
  const { bucket, base } = location;
  const key = `${base}${path}`;
  let meta;
  try {
    meta = await client.getMetadata(bucket, key);
  } catch (error) {
    if (isMissing(error)) throw notFound(path);
    throw error;
  }
  return {
    size: Number(meta.contentLength ?? 0),
    etag: unquote(meta.etag),
    open: (range, signal) => client.getStream(bucket, key, range, { signal }),
  };
}
