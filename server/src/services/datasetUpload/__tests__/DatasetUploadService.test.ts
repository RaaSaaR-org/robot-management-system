/**
 * @file DatasetUploadService.test.ts
 * @description A direct dataset upload from start to verdict (TASK-480),
 *   against a real directory and against an in-memory object store: what is
 *   refused before a byte is sent, that parts are idempotent and resumable,
 *   that finish assembles and verifies before validation, and that cancel,
 *   delete and expiry leave nothing behind.
 * @feature datasets
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync } from 'fs';
import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Readable } from 'stream';

const mocks = vi.hoisted(() => {
  const rows = new Map<string, Record<string, unknown>>();
  return {
    root: '',
    rows,
    nextId: 1,
    events: [] as Array<Record<string, unknown>>,
    resolveRobotTypeId: vi.fn(async (_requested: string | undefined, _info: unknown) => 'rt-31'),
    validateStoredDataset: vi.fn(async (_id: string, _path: string, _count: number, _hooks: unknown) => 'ready'),
    deleteDataset: vi.fn(async (id: string) => rows.delete(id)),
  };
});

vi.mock('../../../repositories/index.js', () => ({
  datasetRepository: {
    create: vi.fn(async (input: Record<string, unknown>) => {
      const id = `ds-${mocks.nextId++}`;
      mocks.rows.set(id, { id, ...input });
      return { id, ...input };
    }),
    findById: vi.fn(async (id: string) => mocks.rows.get(id) ?? null),
    update: vi.fn(async (id: string, patch: Record<string, unknown>) => {
      const row = mocks.rows.get(id);
      if (row) Object.assign(row, patch);
      return row ?? null;
    }),
    delete: vi.fn(async (id: string) => mocks.rows.delete(id)),
  },
}));

vi.mock('../../../repositories/DatasetUploadRepository.js', () => ({ datasetUploadRepository: {} }));

vi.mock('../../DatasetService.js', () => ({
  datasetStorageRoot: () => mocks.root,
  datasetService: {
    emit: vi.fn((_channel: string, event: Record<string, unknown>) => { mocks.events.push(event); return true; }),
    get: vi.fn(async (id: string) => mocks.rows.get(id) ?? null),
    delete: mocks.deleteDataset,
  },
}));

vi.mock('../../HuggingFaceImportService.js', async () => {
  const support = await import('./uploadTestSupport.js');
  class HuggingFaceImportError extends Error {
    constructor(readonly code: string, message: string, readonly status = 400) {
      super(message);
    }
  }
  return {
    HuggingFaceImportError,
    selectRepoFiles: support.selectLeRobotFiles,
    formatBytes: (bytes: number) => `${bytes} B`,
    huggingFaceImportService: { resolveRobotTypeId: mocks.resolveRobotTypeId },
    validateStoredDataset: mocks.validateStoredDataset,
  };
});

vi.mock('../../../storage/rustfs-client.js', () => ({
  getRustFSClient: () => { throw new Error('not used: the sink is given a store'); },
  getRustFSStatus: () => ({ state: 'unconfigured' }),
  isRustFSConfigured: () => false,
  isRustFSInitialized: () => false,
}));

import { DatasetUploadService, type StartUploadResponse } from '../DatasetUploadService.js';
import { HuggingFaceImportError } from '../../HuggingFaceImportService.js';
import { importActivityLog } from '../../ImportActivityLog.js';
import { LocalUploadSink, localStagingDir, RustFsUploadSink, type UploadSink } from '../UploadSink.js';
import type { UploadLimits } from '../uploadManifest.js';
import { FakeObjectStore } from './fakeObjectStore.js';
import {
  brokenStream, CHUNK, INFO, manifestOf, MemoryUploadStore, MIB, partOf, sha256, streamOf, TREE, until, VIDEO,
} from './uploadTestSupport.js';

const BUCKET = 'training-datasets';

const LIMITS: UploadLimits = {
  chunkBytes: CHUNK,
  maxTotalBytes: 100 * MIB,
  maxFiles: 50,
  idleMs: 60 * 60_000,
  maxConcurrentParts: 4,
  storeCapacityBytes: null,
};

let sessions: MemoryUploadStore;
let limits: UploadLimits;
let now: number;
let service: DatasetUploadService;
let store: FakeObjectStore;

function localService(): DatasetUploadService {
  return new DatasetUploadService({
    sessions,
    limits: () => limits,
    now: () => now,
    createSink: (storageId) => new LocalUploadSink(join(mocks.root, storageId)),
    openSink: (_kind, storagePath) => new LocalUploadSink(storagePath),
  });
}

function rustfsService(): DatasetUploadService {
  const open = (prefix: string): UploadSink => new RustFsUploadSink(prefix, () => store, BUCKET);
  return new DatasetUploadService({
    sessions,
    limits: () => limits,
    now: () => now,
    createSink: (storageId) => open(`${storageId}/`),
    openSink: (_kind, storagePath) => open(storagePath),
  });
}

function startBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { name: 'bottle-sorting', info: INFO, files: manifestOf(TREE), ...overrides };
}

async function sendPart(upload: StartUploadResponse, path: string, partNumber: number, options: {
  data?: Buffer; source?: Readable; sha256?: string; contentLength?: number | null;
} = {}) {
  const file = upload.files.find((f) => f.path === path)!;
  const data = options.data ?? partOf(TREE[path], partNumber);
  return service.receivePart(upload.datasetId, file.id, partNumber, options.source ?? streamOf(data), {
    contentLength: options.contentLength === undefined ? data.length : options.contentLength,
    sha256: options.sha256,
  });
}

async function sendAll(upload: StartUploadResponse, skip: (path: string, partNumber: number) => boolean = () => false) {
  for (const file of upload.files) {
    for (let n = 1; n <= file.partCount; n++) {
      if (!skip(file.path, n)) await sendPart(upload, file.path, n);
    }
  }
}

function row(datasetId: string): Record<string, unknown> | undefined {
  return mocks.rows.get(datasetId);
}

beforeEach(async () => {
  mocks.root = await mkdtemp(join(tmpdir(), 'upload-service-'));
  // Ids keep counting across cases: detached work from one case must never
  // find a row of the next under the same id.
  mocks.rows.clear();
  mocks.events.length = 0;
  mocks.resolveRobotTypeId.mockReset().mockResolvedValue('rt-31');
  mocks.validateStoredDataset.mockReset().mockImplementation(async (id: string) => {
    Object.assign(mocks.rows.get(id) ?? {}, { status: 'ready' });
    return 'ready';
  });
  mocks.deleteDataset.mockClear();
  sessions = new MemoryUploadStore();
  limits = { ...LIMITS };
  now = Date.parse('2026-11-13T10:00:00Z');
  sessions.now = () => new Date(now);
  store = new FakeObjectStore();
  service = localService();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(mocks.root, { recursive: true, force: true });
});

describe('start', () => {
  it('creates the dataset as uploading, with the importer\'s robot type and the numbers from info.json', async () => {
    const upload = await service.start(startBody({ description: 'From the lab PC' }));

    expect(mocks.resolveRobotTypeId).toHaveBeenCalledWith(undefined, INFO);
    expect(row(upload.datasetId)).toMatchObject({
      name: 'bottle-sorting',
      description: 'From the lab PC',
      robotTypeId: 'rt-31',
      status: 'uploading',
      lerobotVersion: 'v3.0',
      fps: 30,
      totalFrames: 55695,
      demonstrationCount: 80,
      importMode: 'full',
      storagePath: upload.files.length > 0 ? expect.stringMatching(/\/$/) : '',
    });
    expect(upload).toMatchObject({
      status: 'uploading',
      state: 'uploading',
      storage: 'local',
      chunkSize: CHUNK,
      totalBytes: Object.values(TREE).reduce((sum, data) => sum + data.length, 0),
      idleTimeoutSeconds: 3600,
      expiresAt: '2026-11-13T11:00:00.000Z',
      ignored: [],
    });
    expect(upload.files.map((f) => [f.id, f.path, f.partCount])).toEqual([
      [0, 'meta/info.json', 1],
      [1, 'meta/tasks.parquet', 1],
      [2, 'meta/episodes/chunk-000/file-000.parquet', 1],
      [3, 'data/chunk-000/file-000.parquet', 1],
      [4, VIDEO, 3],
    ]);
    expect(mocks.events.map((e) => e.type)).toContain('dataset:created');
  });

  it('passes an explicit robot type through and reports the files it leaves out', async () => {
    const upload = await service.start(startBody({
      robotTypeId: 'rt-explicit',
      files: [...manifestOf(TREE), { path: 'README.md', size: 11479 }],
    }));

    expect(mocks.resolveRobotTypeId).toHaveBeenCalledWith('rt-explicit', INFO);
    expect(upload.ignored.map((i) => i.path)).toEqual(['README.md']);
    expect(upload.files).toHaveLength(5);
  });

  it('uses a smaller part size when the client asks for one', async () => {
    limits.chunkBytes = 32 * MIB;
    const upload = await service.start(startBody({ chunkSize: 6 * MIB }));
    expect(upload.chunkSize).toBe(6 * MIB);
    expect(upload.files.find((f) => f.path === VIDEO)?.partCount).toBe(2);
  });

  it.each([
    ['no name', { name: '  ' }, 'INVALID_NAME'],
    ['no info', { info: undefined }, 'INVALID_INFO'],
    ['an unsupported version', { info: { ...INFO, codebase_version: 'v1.6' } }, 'UNSUPPORTED_VERSION'],
    ['a traversing path', { files: [...manifestOf(TREE), { path: 'meta/../../x', size: 1 }] }, 'INVALID_PATH'],
    ['a tree that is not LeRobot', { files: [{ path: 'meta/info.json', size: 10 }] }, 'NOT_A_LEROBOT_DATASET'],
    ['a part size over the server maximum', { chunkSize: 6 * MIB }, 'INVALID_CHUNK_SIZE'],
  ])('refuses %s and creates nothing', async (_what, overrides, code) => {
    await expect(service.start(startBody(overrides))).rejects.toMatchObject({ code });

    expect(mocks.rows.size).toBe(0);
    expect(sessions.rows.size).toBe(0);
    expect(mocks.resolveRobotTypeId).not.toHaveBeenCalled();
  });

  it('refuses a dataset over the size cap before touching storage', async () => {
    limits.maxTotalBytes = 1 * MIB;
    await expect(service.start(startBody())).rejects.toMatchObject({ code: 'UPLOAD_TOO_LARGE', statusCode: 413 });
    expect(mocks.rows.size).toBe(0);
  });

  it('refuses with 507 when the store has less room than the dataset needs', async () => {
    limits.storeCapacityBytes = 13 * MIB;
    store.objects.set(`${BUCKET}/someone-else/videos/a.mp4`, Buffer.alloc(2 * MIB));
    service = rustfsService();

    await expect(service.start(startBody())).rejects.toMatchObject({
      code: 'INSUFFICIENT_STORAGE',
      statusCode: 507,
      context: { freeBytes: 11 * MIB },
    });
    expect(store.uploads.size).toBe(0);
    expect(mocks.resolveRobotTypeId).not.toHaveBeenCalled();
  });

  it('answers a robot-type refusal with the importer\'s code and leaves nothing behind', async () => {
    mocks.resolveRobotTypeId.mockRejectedValue(
      new HuggingFaceImportError('ROBOT_DIMENSION_MISMATCH', 'Robot type rt-43 expects action/state 43/43; dataset declares 31/31.'),
    );
    service = rustfsService();

    await expect(service.start(startBody({ robotTypeId: 'rt-43' }))).rejects.toMatchObject({
      code: 'ROBOT_DIMENSION_MISMATCH',
      statusCode: 400,
    });
    expect(mocks.rows.size).toBe(0);
    expect(store.uploads.size).toBe(0);
  });

  it('answers an unknown robot type id with 404', async () => {
    mocks.resolveRobotTypeId.mockRejectedValue(new Error('Robot type not found: nope'));
    await expect(service.start(startBody({ robotTypeId: 'nope' }))).rejects.toMatchObject({ code: 'ROBOT_TYPE_NOT_FOUND', statusCode: 404 });
  });

  it('aborts the multipart uploads it opened when the dataset row cannot be written', async () => {
    service = rustfsService();
    const { datasetRepository } = await import('../../../repositories/index.js');
    vi.mocked(datasetRepository.create).mockRejectedValueOnce(new Error('database timeout'));

    await expect(service.start(startBody())).rejects.toThrow('database timeout');

    expect(store.uploads.size).toBe(0);
    expect(sessions.rows.size).toBe(0);
  });
});

describe('parts', () => {
  let upload: StartUploadResponse;

  beforeEach(async () => {
    upload = await service.start(startBody());
  });

  it('stores a part, answers with its size and sha256, and says when the file is whole', async () => {
    const info = await sendPart(upload, 'meta/info.json', 1);
    expect(info).toEqual({
      datasetId: upload.datasetId,
      fileId: 0,
      partNumber: 1,
      size: TREE['meta/info.json'].length,
      sha256: sha256(TREE['meta/info.json']),
      fileComplete: true,
    });

    const first = await sendPart(upload, VIDEO, 1);
    expect(first.fileComplete).toBe(false);
    expect(first.size).toBe(CHUNK);
  });

  it('accepts the same part twice and still holds exactly one copy of it', async () => {
    await sendPart(upload, VIDEO, 2);
    await sendPart(upload, VIDEO, 2);

    const status = await service.status(upload.datasetId);
    expect(status.files.find((f) => f.path === VIDEO)?.receivedParts).toEqual([2]);
    expect(status.receivedBytes).toBe(CHUNK);
  });

  it('accepts parts in any order', async () => {
    for (const n of [3, 1, 2]) await sendPart(upload, VIDEO, n);
    expect((await service.status(upload.datasetId)).files.find((f) => f.path === VIDEO)?.complete).toBe(false);
    expect((await service.status(upload.datasetId)).files.find((f) => f.path === VIDEO)?.receivedParts).toEqual([1, 2, 3]);
  });

  it('keeps a part whose X-Chunk-Sha256 matches and rejects one that does not', async () => {
    const data = partOf(TREE[VIDEO], 1);
    await expect(sendPart(upload, VIDEO, 1, { sha256: sha256(data).toUpperCase() })).resolves.toMatchObject({ partNumber: 1 });

    const corrupt = Buffer.from(partOf(TREE[VIDEO], 2));
    corrupt[100] ^= 0xff;
    await expect(sendPart(upload, VIDEO, 2, { data: corrupt, sha256: sha256(partOf(TREE[VIDEO], 2)) }))
      .rejects.toMatchObject({ code: 'CHECKSUM_MISMATCH', statusCode: 422 });

    expect((await service.status(upload.datasetId)).files.find((f) => f.path === VIDEO)?.receivedParts).toEqual([1]);
  });

  it('does not keep a corrupt part of a multipart upload in the object store either', async () => {
    service = rustfsService();
    upload = await service.start(startBody());
    const corrupt = Buffer.from(partOf(TREE[VIDEO], 2));
    corrupt[7] ^= 0xff;

    await expect(sendPart(upload, VIDEO, 2, { data: corrupt, sha256: sha256(partOf(TREE[VIDEO], 2)) }))
      .rejects.toMatchObject({ code: 'CHECKSUM_MISMATCH' });
    await expect(sendPart(upload, 'meta/info.json', 1, { data: Buffer.from(TREE['meta/info.json']).fill(1), sha256: sha256(TREE['meta/info.json']) }))
      .rejects.toMatchObject({ code: 'CHECKSUM_MISMATCH' });

    const status = await service.status(upload.datasetId);
    expect(status.receivedBytes).toBe(0);
    expect(store.keys(BUCKET)).toEqual([]);
  });

  it.each([
    ['a malformed checksum header', { sha256: 'xyz' }, 'INVALID_CHECKSUM', 400],
    ['a request without Content-Length', { contentLength: null }, 'LENGTH_REQUIRED', 411],
    ['a body of the wrong length', { contentLength: CHUNK - 1 }, 'PART_SIZE_MISMATCH', 400],
    ['a body larger than any part may be', { contentLength: 65 * MIB }, 'PART_SIZE_MISMATCH', 413],
  ])('refuses %s before reading the body', async (_what, options, code, status) => {
    const source = streamOf(partOf(TREE[VIDEO], 1));
    await expect(sendPart(upload, VIDEO, 1, { ...options, source })).rejects.toMatchObject({ code, statusCode: status });
    expect(source.readableFlowing).not.toBe(true);
    expect((await service.status(upload.datasetId)).receivedBytes).toBe(0);
  });

  it('answers 404 for a file or part the manifest does not have', async () => {
    const data = Buffer.alloc(1);
    await expect(service.receivePart(upload.datasetId, 99, 1, streamOf(data), { contentLength: 1 }))
      .rejects.toMatchObject({ code: 'UNKNOWN_FILE', statusCode: 404 });
    await expect(service.receivePart(upload.datasetId, 4, 4, streamOf(data), { contentLength: 1 }))
      .rejects.toMatchObject({ code: 'UNKNOWN_PART', statusCode: 404 });
    await expect(service.receivePart(upload.datasetId, 4, 0, streamOf(data), { contentLength: 1 }))
      .rejects.toMatchObject({ code: 'UNKNOWN_PART' });
  });

  it('answers 404 for a dataset that does not exist, and for one that has no direct upload', async () => {
    await expect(service.receivePart('nope', 0, 1, streamOf(Buffer.alloc(1)), { contentLength: 1 }))
      .rejects.toMatchObject({ code: 'NOT_FOUND', statusCode: 404 });
    mocks.rows.set('imported', { id: 'imported', status: 'ready' });
    await expect(service.status('imported')).rejects.toMatchObject({ code: 'NO_UPLOAD', statusCode: 404 });
  });

  it('does not keep a part whose request ended early', async () => {
    const half = partOf(TREE[VIDEO], 1).subarray(0, 1000);
    await expect(sendPart(upload, VIDEO, 1, { source: brokenStream(half), contentLength: CHUNK }))
      .rejects.toMatchObject({ code: 'PART_INTERRUPTED' });

    expect((await service.status(upload.datasetId)).receivedBytes).toBe(0);
    await expect(sendPart(upload, VIDEO, 1)).resolves.toMatchObject({ partNumber: 1 });
  });

  it('answers 503 UPLOAD_BUSY with a retry hint beyond the concurrency limit', async () => {
    limits.maxConcurrentParts = 1;
    const slow = brokenStream(Buffer.alloc(10));
    const first = sendPart(upload, VIDEO, 1, { source: slow, contentLength: CHUNK }).catch((error: unknown) => error);
    await new Promise((resolve) => setImmediate(resolve));

    await expect(sendPart(upload, VIDEO, 2)).rejects.toMatchObject({
      code: 'UPLOAD_BUSY',
      statusCode: 503,
      context: { retryAfterSeconds: 2 },
    });

    await first;
    await expect(sendPart(upload, VIDEO, 2)).resolves.toMatchObject({ partNumber: 2 });
  });

  it('says where the upload is on the import log and the event stream', async () => {
    await sendPart(upload, 'meta/info.json', 1);

    const activity = importActivityLog.get(upload.datasetId);
    expect(activity?.lines.map((l) => l.message)).toEqual(expect.arrayContaining([
      expect.stringContaining('Upload of "bottle-sorting" started: 5 files'),
      expect.stringContaining('info.json: LeRobot v3.0, robot unitree_g1_dex3, 80 episodes'),
      expect.stringContaining('Received meta/info.json'),
    ]));
    expect(activity?.progress).toMatchObject({ status: 'uploading', phase: 'uploading', totalFiles: 5, completedFiles: 1 });
    expect(mocks.events.map((e) => e.type)).toEqual(expect.arrayContaining(['dataset:import:progress', 'dataset:import:log']));
  });
});

describe('status and resume', () => {
  it('reports what is held, what is missing and when the upload expires', async () => {
    const upload = await service.start(startBody());
    await sendPart(upload, 'meta/info.json', 1);
    await sendPart(upload, VIDEO, 2);

    const status = await service.status(upload.datasetId);

    expect(status).toMatchObject({
      state: 'uploading',
      status: 'uploading',
      storage: 'local',
      chunkSize: CHUNK,
      totalFiles: 5,
      completedFiles: 1,
      readyToFinish: false,
      receivedBytes: TREE['meta/info.json'].length + CHUNK,
      expiresAt: '2026-11-13T11:00:00.000Z',
      importError: null,
    });
    expect(status.files.map((f) => f.receivedParts)).toEqual([[1], [], [], [], [2]]);
  });

  it.each([
    ['the local disk', () => localService()],
    ['the object store', () => rustfsService()],
  ])('continues in a new server process from what %s holds', async (_what, make) => {
    service = make();
    const upload = await service.start(startBody());
    await sendPart(upload, 'meta/info.json', 1);
    await sendPart(upload, VIDEO, 1);

    // A restart: nothing in memory survives, only the session row and the store.
    service = make();
    const status = await service.status(upload.datasetId);
    expect(status.files.map((f) => f.receivedParts)).toEqual([[1], [], [], [], [1]]);

    await sendAll(upload, (path, n) => status.files.find((f) => f.path === path)!.receivedParts.includes(n));
    expect((await service.status(upload.datasetId)).readyToFinish).toBe(true);
    await expect(service.finish(upload.datasetId)).resolves.toMatchObject({ state: 'processing' });
    await until(() => row(upload.datasetId)?.status === 'ready');
  });
});

describe('finish', () => {
  it('refuses with 409 and the exact missing parts while anything is missing', async () => {
    const upload = await service.start(startBody());
    await sendAll(upload, (path, n) => (path === VIDEO && n === 2) || path === 'meta/tasks.parquet');

    const error = await service.finish(upload.datasetId).catch((e: unknown) => e);

    expect(error).toMatchObject({
      code: 'UPLOAD_INCOMPLETE',
      statusCode: 409,
      context: {
        missingFiles: 2,
        missingBytes: TREE['meta/tasks.parquet'].length + CHUNK,
        missing: [
          { fileId: 1, path: 'meta/tasks.parquet', missingParts: [1] },
          { fileId: 4, path: VIDEO, missingParts: [2] },
        ],
      },
    });
    expect((await sessions.find(upload.datasetId))?.state).toBe('uploading');
    expect(mocks.validateStoredDataset).not.toHaveBeenCalled();
  });

  it('answers at once, then assembles the files and hands the dataset to validation', async () => {
    const upload = await service.start(startBody());
    await sendAll(upload);

    await expect(service.finish(upload.datasetId)).resolves.toMatchObject({ state: 'processing', status: 'uploading' });
    await until(() => row(upload.datasetId)?.status === 'ready');

    const root = String(row(upload.datasetId)?.storagePath);
    for (const [path, data] of Object.entries(TREE)) {
      expect((await readFile(join(root, path))).equals(data)).toBe(true);
    }
    expect(existsSync(localStagingDir(root))).toBe(false);
    expect(mocks.validateStoredDataset).toHaveBeenCalledWith(upload.datasetId, root, 5, expect.objectContaining({ what: 'Upload' }));
    expect((await service.status(upload.datasetId))).toMatchObject({ state: 'completed', status: 'ready', readyToFinish: true, expiresAt: null });
  });

  it('ends in the object store as the tree an import writes: one object per file, no open multipart upload', async () => {
    service = rustfsService();
    const upload = await service.start(startBody());
    await sendAll(upload);

    await service.finish(upload.datasetId);
    await until(() => row(upload.datasetId)?.status === 'ready');

    const prefix = String(row(upload.datasetId)?.storagePath);
    expect(prefix).toMatch(/^[0-9a-f-]{36}\/$/);
    expect(store.keys(BUCKET)).toEqual(Object.keys(TREE).map((path) => `${prefix}${path}`).sort());
    expect(store.objects.get(`${BUCKET}/${prefix}${VIDEO}`)?.equals(TREE[VIDEO])).toBe(true);
    expect(store.uploads.size).toBe(0);
  });

  it('is idempotent: a second finish reports where the upload is instead of failing', async () => {
    const upload = await service.start(startBody());
    await sendAll(upload);
    await service.finish(upload.datasetId);

    await expect(service.finish(upload.datasetId)).resolves.toMatchObject({ state: expect.stringMatching(/processing|completed/) });
    await until(() => row(upload.datasetId)?.status === 'ready');
    await expect(service.finish(upload.datasetId)).resolves.toMatchObject({ state: 'completed', status: 'ready' });
    expect(mocks.validateStoredDataset).toHaveBeenCalledTimes(1);
  });

  it('takes no more parts once finish was accepted', async () => {
    const upload = await service.start(startBody());
    await sendAll(upload);
    await service.finish(upload.datasetId);

    await expect(sendPart(upload, 'meta/info.json', 1)).rejects.toMatchObject({ code: 'UPLOAD_NOT_ACCEPTING', statusCode: 409 });
  });

  it('verifies a declared sha256 and passes a tree that matches', async () => {
    const upload = await service.start(startBody({ files: manifestOf(TREE, true) }));
    await sendAll(upload);
    await service.finish(upload.datasetId);
    await until(() => row(upload.datasetId)?.status === 'ready');

    expect(importActivityLog.get(upload.datasetId)?.lines.map((l) => l.message)).toContain('Verified the sha256 of 5 file(s)');
  });

  it('fails the dataset with a readable reason when a stored file does not match its declared sha256', async () => {
    const files = manifestOf(TREE, true).map((f) => (f.path === VIDEO ? { ...f, sha256: 'a'.repeat(64) } : f));
    const upload = await service.start(startBody({ files }));
    await sendAll(upload);
    await service.finish(upload.datasetId);
    await until(() => row(upload.datasetId)?.status === 'failed');

    expect(row(upload.datasetId)?.importError).toMatchObject({
      phase: 'storing',
      error: expect.stringContaining(`Checksum mismatch for ${VIDEO}`),
      sink: 'local',
    });
    expect((await sessions.find(upload.datasetId))?.state).toBe('failed');
    expect(mocks.validateStoredDataset).not.toHaveBeenCalled();
    expect(mocks.events).toContainEqual(expect.objectContaining({ type: 'dataset:import:failed', datasetId: upload.datasetId }));
  });

  it('finishes an upload a restart cut off after finish was accepted', async () => {
    service = rustfsService();
    const upload = await service.start(startBody());
    await sendAll(upload);
    // The process died right after the state change: nothing was assembled.
    await sessions.transition(upload.datasetId, ['uploading'], 'processing');

    service = rustfsService();
    await expect(service.resumeInterrupted()).resolves.toEqual([upload.datasetId]);
    await until(() => row(upload.datasetId)?.status === 'ready');

    expect(store.uploads.size).toBe(0);
    expect((await sessions.find(upload.datasetId))?.state).toBe('completed');
  });
});

describe('cancel, delete and expiry', () => {
  it('cancel removes the files, the staging parts, the session and the dataset row', async () => {
    const upload = await service.start(startBody());
    await sendPart(upload, 'meta/info.json', 1);
    await sendPart(upload, VIDEO, 1);
    const root = String(row(upload.datasetId)?.storagePath);

    await expect(service.cancel(upload.datasetId)).resolves.toMatchObject({ status: 'cancelled' });

    expect(existsSync(root)).toBe(false);
    expect(existsSync(localStagingDir(root))).toBe(false);
    expect(mocks.deleteDataset).toHaveBeenCalledWith(upload.datasetId);
    expect(sessions.rows.size).toBe(0);
    await expect(service.status(upload.datasetId)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('cancel leaves no object and no open multipart upload in the object store', async () => {
    service = rustfsService();
    const upload = await service.start(startBody());
    await sendPart(upload, 'meta/info.json', 1);
    await sendPart(upload, VIDEO, 1);
    store.objects.set(`${BUCKET}/another-dataset/meta/info.json`, Buffer.from('{}'));
    expect(store.uploads.size).toBe(1);

    await service.cancel(upload.datasetId);

    expect(store.uploads.size).toBe(0);
    expect(store.keys(BUCKET)).toEqual(['another-dataset/meta/info.json']);
  });

  it('cancel stops a part that is being received and does not keep it', async () => {
    service = rustfsService();
    const upload = await service.start(startBody());
    const stalled = brokenStream(Buffer.alloc(100));
    stalled.destroy = () => stalled; // the client is still connected; only the cancel may stop it
    const inFlight = sendPart(upload, VIDEO, 1, { source: stalled, contentLength: CHUNK }).catch((error: unknown) => error);
    await new Promise((resolve) => setImmediate(resolve));

    await service.cancel(upload.datasetId);

    expect(await inFlight).toMatchObject({ code: 'PART_INTERRUPTED' });
    expect(store.uploads.size).toBe(0);
    expect(store.keys(BUCKET)).toEqual([]);
  });

  it('refuses to cancel once the upload is being finished or is finished', async () => {
    const upload = await service.start(startBody());
    await sendAll(upload);
    await sessions.transition(upload.datasetId, ['uploading'], 'processing');
    await expect(service.cancel(upload.datasetId)).rejects.toMatchObject({ code: 'UPLOAD_PROCESSING', statusCode: 409 });

    await sessions.transition(upload.datasetId, ['processing'], 'completed');
    await expect(service.cancel(upload.datasetId)).rejects.toMatchObject({ code: 'UPLOAD_COMPLETED', statusCode: 409 });
    expect(mocks.deleteDataset).not.toHaveBeenCalled();
  });

  it('deletes nothing when a finish wins the race against a cancel', async () => {
    service = rustfsService();
    const upload = await service.start(startBody());
    await sendAll(upload);
    // The cancel has read the session as `uploading`; the finish lands before it acts.
    const find = sessions.find.bind(sessions);
    let raced = false;
    sessions.find = async (id: string) => {
      const session = await find(id);
      if (!raced && session) {
        raced = true;
        await sessions.transition(id, ['uploading'], 'processing');
      }
      return session;
    };

    await expect(service.cancel(upload.datasetId)).rejects.toMatchObject({ code: 'UPLOAD_PROCESSING', statusCode: 409 });

    expect(store.uploads.size).toBe(1);
    expect(store.keys(BUCKET)).toHaveLength(4);
    expect(mocks.deleteDataset).not.toHaveBeenCalled();
  });

  it('releases an open upload before its dataset is deleted, and leaves a finished one alone', async () => {
    service = rustfsService();
    const open = await service.start(startBody());
    await sendPart(open, VIDEO, 1);
    await service.releaseForDelete(open.datasetId);
    expect(store.uploads.size).toBe(0);
    expect((await sessions.find(open.datasetId))?.state).toBe('cancelling');

    const done = await service.start(startBody({ name: 'second' }));
    await sendAll(done);
    await service.finish(done.datasetId);
    await until(() => row(done.datasetId)?.status === 'ready');
    const before = store.keys(BUCKET);
    await service.releaseForDelete(done.datasetId);
    expect(store.keys(BUCKET)).toEqual(before);

    await expect(service.releaseForDelete('not-an-upload')).resolves.toBeUndefined();
  });

  it('refuses the delete of a dataset whose upload is being finished', async () => {
    const upload = await service.start(startBody());
    await sessions.transition(upload.datasetId, ['uploading'], 'processing');
    await expect(service.releaseForDelete(upload.datasetId)).rejects.toMatchObject({ code: 'UPLOAD_PROCESSING', statusCode: 409 });
  });

  it('reaps an upload idle past the limit and keeps one that is still being sent to', async () => {
    service = rustfsService();
    const idle = await service.start(startBody({ name: 'idle' }));
    await sendPart(idle, VIDEO, 1);
    now += 50 * 60_000;
    const fresh = await service.start(startBody({ name: 'fresh' }));
    await sendPart(fresh, VIDEO, 1);
    now += 20 * 60_000; // idle: 70 min, fresh: 20 min; the limit is 60

    await expect(service.reapIdle()).resolves.toEqual([idle.datasetId]);

    expect(mocks.rows.has(idle.datasetId)).toBe(false);
    expect(mocks.rows.has(fresh.datasetId)).toBe(true);
    expect([...store.uploads.values()].map((u) => u.key)).toEqual([`${BUCKET}/${String(row(fresh.datasetId)?.storagePath)}${VIDEO}`]);
    expect(store.keys(BUCKET)).toEqual([]);
  });

  it('counts a part as activity, so an upload that is being sent to is not reaped', async () => {
    const upload = await service.start(startBody());
    now += 59 * 60_000;
    await sendPart(upload, 'meta/info.json', 1);
    await until(async () => (await sessions.find(upload.datasetId))?.lastActivityAt.getTime() === now);
    now += 30 * 60_000;

    await expect(service.reapIdle()).resolves.toEqual([]);
    expect((await service.status(upload.datasetId)).expiresAt).toBe(new Date(now + 30 * 60_000).toISOString());
  });

  it('never reaps an upload that is being finished or is finished', async () => {
    const upload = await service.start(startBody());
    await sendAll(upload);
    await service.finish(upload.datasetId);
    await until(() => row(upload.datasetId)?.status === 'ready');
    now += 48 * 60 * 60_000;

    await expect(service.reapIdle()).resolves.toEqual([]);
    expect(mocks.rows.has(upload.datasetId)).toBe(true);
  });

  it('completes a cancel that died halfway on the next reap', async () => {
    service = rustfsService();
    const upload = await service.start(startBody());
    await sendPart(upload, VIDEO, 1);
    await sessions.transition(upload.datasetId, ['uploading'], 'cancelling');

    await expect(sendPart(upload, VIDEO, 2)).rejects.toMatchObject({ code: 'UPLOAD_NOT_ACCEPTING' });
    await expect(service.reapIdle()).resolves.toEqual([upload.datasetId]);
    expect(store.uploads.size).toBe(0);
    expect(mocks.rows.has(upload.datasetId)).toBe(false);
  });

  it('names the object-store prefixes of running uploads for the stale-multipart sweep', async () => {
    service = rustfsService();
    const running = await service.start(startBody());
    const done = await service.start(startBody({ name: 'done' }));
    await sendAll(done);
    await service.finish(done.datasetId);
    await until(() => row(done.datasetId)?.status === 'ready');

    await expect(service.openPrefixes()).resolves.toEqual([row(running.datasetId)?.storagePath]);
  });

  it('reports an open upload until it is completed', async () => {
    const upload = await service.start(startBody());
    await expect(service.hasOpenUpload(upload.datasetId)).resolves.toBe(true);
    await expect(service.hasOpenUpload('something-else')).resolves.toBe(false);
    await sendAll(upload);
    await service.finish(upload.datasetId);
    await until(() => row(upload.datasetId)?.status === 'ready');
    await expect(service.hasOpenUpload(upload.datasetId)).resolves.toBe(false);
  });
});
