/**
 * @file uploadTestSupport.ts
 * @description Shared fixtures for the direct-upload suites (TASK-480): a
 *   Map-backed session store, the importer's file filter without the importer,
 *   and a small v3.0 tree with one file large enough to need several parts.
 * @feature datasets
 */

import { createHash } from 'crypto';
import { Readable } from 'stream';
import type {
  DatasetUploadSession,
  DatasetUploadState,
  DatasetUploadStore,
} from '../../../repositories/DatasetUploadRepository.js';

/** The rules of `selectRepoFiles`, for suites that mock the importer module away. */
export function selectLeRobotFiles<T extends { path: string }>(tree: T[], includeVideos: boolean): T[] {
  return tree.filter(({ path }) => {
    if (path.startsWith('meta/')) return true;
    if (path.startsWith('data/') && path.endsWith('.parquet')) return true;
    if (path.startsWith('videos/')) return includeVideos && path.endsWith('.mp4');
    if (path.startsWith('images/')) return includeVideos;
    return false;
  });
}

export class MemoryUploadStore implements DatasetUploadStore {
  readonly rows = new Map<string, DatasetUploadSession>();
  now: () => Date = () => new Date();

  async create(session: Omit<DatasetUploadSession, 'lastActivityAt' | 'createdAt'>): Promise<DatasetUploadSession> {
    const row = { ...session, lastActivityAt: this.now(), createdAt: this.now() };
    this.rows.set(session.datasetId, row);
    return { ...row };
  }

  async find(datasetId: string): Promise<DatasetUploadSession | null> {
    const row = this.rows.get(datasetId);
    return row ? { ...row } : null;
  }

  async transition(datasetId: string, from: DatasetUploadState[], to: DatasetUploadState): Promise<boolean> {
    const row = this.rows.get(datasetId);
    if (!row || !from.includes(row.state)) return false;
    row.state = to;
    row.lastActivityAt = this.now();
    return true;
  }

  async touch(datasetId: string, at: Date): Promise<void> {
    const row = this.rows.get(datasetId);
    if (row) row.lastActivityAt = at;
  }

  async delete(datasetId: string): Promise<void> {
    this.rows.delete(datasetId);
  }

  async list(states: DatasetUploadState[], before?: Date): Promise<DatasetUploadSession[]> {
    return [...this.rows.values()]
      .filter((row) => states.includes(row.state) && (!before || row.lastActivityAt < before))
      .map((row) => ({ ...row }));
  }
}

export const MIB = 1024 * 1024;
/** The smallest part size the API allows; the fixture's video is 2.4 of them. */
export const CHUNK = 5 * MIB;

export function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Deterministic bytes, different for every file, so a swapped part is noticed. */
function bytes(length: number, seed: number): Buffer {
  const out = Buffer.alloc(length);
  for (let i = 0; i < length; i++) out[i] = (i * 31 + seed * 17 + (i >> 8)) & 0xff;
  return out;
}

export const INFO = {
  codebase_version: 'v3.0',
  robot_type: 'unitree_g1_dex3',
  fps: 30,
  total_episodes: 80,
  total_frames: 55695,
  features: {
    action: { dtype: 'float32', shape: [31] },
    'observation.state': { dtype: 'float32', shape: [31] },
    'observation.images.head': { dtype: 'video', shape: [480, 640, 3] },
  },
};

/** A v3.0 tree: four small files and one 12 MiB video (three parts of 5 MiB). */
export const TREE: Record<string, Buffer> = {
  'meta/info.json': Buffer.from(JSON.stringify(INFO)),
  'meta/tasks.parquet': bytes(300, 1),
  'meta/episodes/chunk-000/file-000.parquet': bytes(4000, 2),
  'data/chunk-000/file-000.parquet': bytes(70_000, 3),
  'videos/observation.images.head/chunk-000/file-000.mp4': bytes(12 * MIB, 4),
};

export const VIDEO = 'videos/observation.images.head/chunk-000/file-000.mp4';

export function manifestOf(tree: Record<string, Buffer>, withSha = false): Array<{ path: string; size: number; sha256?: string }> {
  return Object.entries(tree).map(([path, data]) => ({
    path,
    size: data.length,
    ...(withSha ? { sha256: sha256(data) } : {}),
  }));
}

/** The bytes of part `partNumber` of `data`. */
export function partOf(data: Buffer, partNumber: number, chunkSize = CHUNK): Buffer {
  return data.subarray((partNumber - 1) * chunkSize, partNumber * chunkSize);
}

/** A request-like stream: several chunks, then end. */
export function streamOf(data: Buffer, pieces = 4): Readable {
  const step = Math.max(1, Math.ceil(data.length / pieces));
  const chunks: Buffer[] = [];
  for (let offset = 0; offset < data.length; offset += step) chunks.push(data.subarray(offset, offset + step));
  return Readable.from(chunks, { objectMode: false });
}

/** A stream that delivers `data` and then closes without ending — a client that went away. */
export function brokenStream(data: Buffer): Readable {
  const stream = new Readable({ read() {} });
  stream.push(data);
  setTimeout(() => stream.destroy(), 20);
  return stream;
}

export async function until(check: () => boolean | Promise<boolean>, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!await check()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for the condition');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
