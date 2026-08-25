/**
 * @file DatasetTree.ts
 * @description One way to read a LeRobot dataset, whether it is a directory on
 *              this disk or a prefix in the RustFS bucket.
 * @feature training
 *
 * WHY THIS EXISTS. `validateStructure` only ever knew how to look in RustFS, so
 * a dataset registered from a local directory — which is every synthetic
 * dataset, every Cosmos conversion and everything the robot agent records —
 * skipped validation entirely and was written straight to the database as
 * `status: 'ready'`. The datasets nobody had checked were the ones this
 * platform produced itself.
 *
 * The interface is deliberately five methods wide. A validator that opens files
 * needs to know a file is there, how big it is, and what is inside it; anything
 * more would be an object-store API leaking into a format check.
 *
 * `readRange` is the fifth, added by TASK-219. A parquet's row count and column
 * names live in its footer, and `read()` is the only way to reach a footer if
 * all you have is "the whole file" — which is how validation came to pull 100 MB
 * through the API process to learn two numbers.
 */

import { createReadStream, existsSync } from 'fs';
import { open, readFile, readdir, stat } from 'fs/promises';
import { isAbsolute, join, posix, relative, resolve, sep } from 'path';
import type { Readable } from 'stream';
import { getRustFSClient, isRustFSInitialized } from '../../storage/rustfs-client.js';
import { BUCKETS } from '../../storage/model-storage.js';

/** What a dataset tree can answer about one file. */
export interface TreeEntry {
  /** Path relative to the dataset root, always with forward slashes. */
  path: string;
  size: number;
}

/**
 * The store could not answer — not "the file is not there".
 *
 * The two were the same answer before TASK-217's review: `stat` caught every
 * exception and returned null, so a RustFS timeout read as a missing parquet
 * and `validateAndUpdateDataset` wrote `status: 'failed'` on a dataset whose
 * files were all present. A validator is allowed to say a dataset is broken;
 * it is not allowed to say so because it could not look.
 */
export class DatasetStoreError extends Error {
  constructor(readonly path: string, readonly cause: unknown) {
    super(`could not reach the object store for ${path}: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = 'DatasetStoreError';
  }
}

/** A 404 from the object store, as opposed to any other reason it said no. */
function isNotFound(err: unknown): boolean {
  const e = err as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === 'NotFound' || e?.name === 'NoSuchKey' || e?.Code === 'NoSuchKey'
    || e?.$metadata?.httpStatusCode === 404;
}

/**
 * A LeRobot dataset tree, addressed by paths relative to its root.
 *
 * Every path is POSIX-style and relative — `meta/info.json`, never an absolute
 * path and never an object key. The implementations own the difference.
 */
export interface DatasetTree {
  /** `local` or `rustfs`, for messages that need to say where they looked. */
  readonly kind: 'local' | 'rustfs';
  /** The root, for logs. An absolute directory, or an object-key prefix. */
  readonly root: string;
  /** The entry, or null when there is nothing at that path. */
  stat(path: string): Promise<TreeEntry | null>;
  /** The whole file. Callers are expected to know it is small enough. */
  read(path: string): Promise<Buffer>;
  /**
   * `length` bytes from `offset`, for a caller that wants a slice of a file it
   * has no business holding whole. Short at the end of the file, empty past it.
   */
  readRange(path: string, offset: number, length: number): Promise<Buffer>;
  /** Everything under a prefix, recursively. Empty when the prefix is absent. */
  list(prefix: string): Promise<TreeEntry[]>;
}

/** A dataset that lives in a directory on this machine. */
export class LocalDatasetTree implements DatasetTree {
  readonly kind = 'local' as const;
  readonly root: string;

  constructor(root: string) {
    // The registered `storagePath` carries a trailing slash by convention;
    // `resolve` drops it, and every later `join` depends on that.
    this.root = resolve(root);
  }

  private absolute(path: string): string | null {
    const full = resolve(this.root, path);
    // A relative path is a caller's, not a user's, but validation reports
    // include the path it looked at and a `..` there would be a confusing lie
    // as well as a traversal.
    if (full !== this.root && !full.startsWith(this.root + sep)) return null;
    return full;
  }

  async stat(path: string): Promise<TreeEntry | null> {
    const full = this.absolute(path);
    if (!full) return null;
    try {
      const info = await stat(full);
      if (!info.isFile()) return null;
      return { path, size: info.size };
    } catch {
      return null;
    }
  }

  async read(path: string): Promise<Buffer> {
    const full = this.absolute(path);
    if (!full) throw new Error(`Path escapes the dataset root: ${path}`);
    return readFile(full);
  }

  async readRange(path: string, offset: number, length: number): Promise<Buffer> {
    const full = this.absolute(path);
    if (!full) throw new Error(`Path escapes the dataset root: ${path}`);
    if (length <= 0) return Buffer.alloc(0);
    const handle = await open(full, 'r');
    try {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, offset);
      return bytesRead === length ? buffer : buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  }

  async list(prefix: string): Promise<TreeEntry[]> {
    const base = this.absolute(prefix);
    if (!base || !existsSync(base)) return [];
    const out: TreeEntry[] = [];
    const walk = async (dir: string): Promise<void> => {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
        } else if (entry.isFile()) {
          const info = await stat(full);
          out.push({ path: relative(this.root, full).split(sep).join('/'), size: info.size });
        }
      }
    };
    const info = await stat(base);
    if (info.isFile()) {
      return [{ path: relative(this.root, base).split(sep).join('/'), size: info.size }];
    }
    await walk(base);
    out.sort((a, b) => a.path.localeCompare(b.path));
    return out;
  }

  /** For the video route, which streams rather than buffering. */
  openStream(path: string, start?: number, end?: number): Readable | null {
    const full = this.absolute(path);
    if (!full || !existsSync(full)) return null;
    return createReadStream(full, start === undefined ? undefined : { start, end });
  }
}

/** A dataset that lives under an object-key prefix in the RustFS bucket. */
export class RustFsDatasetTree implements DatasetTree {
  readonly kind = 'rustfs' as const;
  readonly root: string;

  constructor(prefix: string, private readonly bucket: string = BUCKETS.TRAINING_DATASETS) {
    // Exactly one trailing slash, because every key is `${root}${path}` and
    // the registered prefixes are inconsistent about it.
    this.root = prefix.endsWith('/') ? prefix : `${prefix}/`;
  }

  private key(path: string): string {
    return posix.join(this.root, path);
  }

  async stat(path: string): Promise<TreeEntry | null> {
    try {
      const meta = await getRustFSClient().getMetadata(this.bucket, this.key(path));
      return { path, size: meta.contentLength ?? 0 };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw new DatasetStoreError(path, err);
    }
  }

  async read(path: string): Promise<Buffer> {
    try {
      return await getRustFSClient().download(this.bucket, this.key(path));
    } catch (err) {
      if (isNotFound(err)) throw err;
      throw new DatasetStoreError(path, err);
    }
  }

  async readRange(path: string, offset: number, length: number): Promise<Buffer> {
    if (length <= 0) return Buffer.alloc(0);
    try {
      return await getRustFSClient().downloadRange(this.bucket, this.key(path), offset, length);
    } catch (err) {
      if (isNotFound(err)) throw err;
      // Same rule as `read`: anything that is not a 404 is the store failing to
      // answer, and the caller must not record that as a broken dataset. The
      // offsets come out of the file's own footer, so a range this store
      // rejects is a store that did not answer, not a file that is wrong.
      throw new DatasetStoreError(path, err);
    }
  }

  async list(prefix: string): Promise<TreeEntry[]> {
    const out: TreeEntry[] = [];
    try {
      for await (const obj of getRustFSClient().listAll(this.bucket, this.key(prefix))) {
        if (obj.key.endsWith('/')) continue;
        out.push({ path: obj.key.slice(this.root.length), size: obj.size });
      }
    } catch (err) {
      if (isNotFound(err)) return [];
      throw new DatasetStoreError(prefix, err);
    }
    out.sort((a, b) => a.path.localeCompare(b.path));
    return out;
  }
}

/**
 * Absolute path that exists → a directory on this disk; anything else → RustFS.
 *
 * The same test `datasets.routes.ts` has used since TASK-178, kept identical on
 * purpose: two different answers to "is this dataset local" is how a dataset
 * ends up served from one place and validated from another.
 */
export function isLocalStoragePath(storagePath: string): boolean {
  return (isAbsolute(storagePath) || storagePath.startsWith('/')) && existsSync(storagePath);
}

/**
 * The tree for a dataset's `storagePath`, or null when neither backing store
 * can be reached — which is a different answer from "the dataset is broken".
 */
export function openDatasetTree(storagePath: string): DatasetTree | null {
  if (isLocalStoragePath(storagePath)) return new LocalDatasetTree(storagePath);
  if (!isRustFSInitialized()) return null;
  return new RustFsDatasetTree(storagePath);
}
