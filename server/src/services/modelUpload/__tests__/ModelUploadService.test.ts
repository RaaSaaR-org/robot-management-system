/**
 * @file ModelUploadService.test.ts
 * @description A direct model checkpoint upload from start to the registry
 *   (TASK-498), against a real directory and an in-memory object store: what
 *   is refused before a byte is sent, that an unfinished upload registers
 *   nothing, that finishing registers exactly one ModelVersion pointing at the
 *   stored prefix, that the stored files can be read back by range, and that
 *   cancel, expiry and deleting the model leave nothing in the store.
 * @feature deployment
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync } from 'fs';
import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Readable } from 'stream';

const mocks = vi.hoisted(() => ({ root: '' }));

vi.mock('../../../database/index.js', () => ({ prisma: {} }));
vi.mock('../../../repositories/index.js', () => ({ datasetRepository: {}, modelVersionRepository: {} }));
vi.mock('../../../repositories/ModelUploadRepository.js', () => ({ modelUploadRepository: {} }));
vi.mock('../../ModelRegistryService.js', () => ({ modelRegistryService: {} }));
vi.mock('../../buildAudit.js', () => ({ auditBuildAct: vi.fn(async () => undefined) }));
vi.mock('../../DatasetService.js', () => ({ datasetStorageRoot: () => mocks.root }));
vi.mock('../../HuggingFaceImportService.js', () => ({ selectRepoFiles: <T>(tree: T[]) => tree }));
vi.mock('../../../storage/rustfs-client.js', () => ({
  getRustFSClient: () => { throw new Error('not used: the sink is given a store'); },
  getRustFSStatus: () => ({ state: 'unconfigured' }),
  isRustFSConfigured: () => false,
  isRustFSInitialized: () => false,
}));

import { ModelUploadService, type StartModelUploadResponse } from '../ModelUploadService.js';
import type {
  ModelUploadSession,
  ModelUploadStore,
  NewModelUpload,
} from '../../../repositories/ModelUploadRepository.js';
import type { CreateModelVersionInput, ModelVersion } from '../../../types/vla.types.js';
import { LocalUploadSink, RustFsUploadSink, type UploadSink } from '../../datasetUpload/UploadSink.js';
import type { UploadLimits } from '../../datasetUpload/uploadManifest.js';
import type { UploadState } from '../../datasetUpload/uploadSession.js';
import { FakeObjectStore } from '../../datasetUpload/__tests__/fakeObjectStore.js';
import {
  brokenStream, CHUNK, manifestOf, MIB, partOf, sha256, streamOf, until,
} from '../../datasetUpload/__tests__/uploadTestSupport.js';

const BUCKET = 'production-models';

function bytes(length: number, seed: number): Buffer {
  const out = Buffer.alloc(length);
  for (let i = 0; i < length; i++) out[i] = (i * 13 + seed * 29 + (i >> 9)) & 0xff;
  return out;
}

const SHARD = 'model-00001-of-00002.safetensors';

/** A checkpoint in miniature: a 12 MiB shard (three parts), small files, a nested one, an empty one. */
const TREE: Record<string, Buffer> = {
  'config.json': Buffer.from('{"model_type":"Gr00tN1d7"}'),
  [SHARD]: bytes(12 * MIB, 1),
  'model-00002-of-00002.safetensors': bytes(3 * MIB, 2),
  'processor/processor_config.json': bytes(900, 3),
  'experiment_cfg/empty.yaml': Buffer.alloc(0),
};

const LIMITS: UploadLimits = {
  chunkBytes: CHUNK,
  maxTotalBytes: 100 * MIB,
  maxFiles: 50,
  idleMs: 60 * 60_000,
  maxConcurrentParts: 4,
  storeCapacityBytes: null,
};

class MemoryModelUploads implements ModelUploadStore {
  readonly rows = new Map<string, ModelUploadSession>();
  now: () => Date = () => new Date();

  async create(session: NewModelUpload): Promise<ModelUploadSession> {
    const row: ModelUploadSession = {
      ...session, error: null, modelVersionId: null, filesRemovedAt: null, tenantId: null,
      lastActivityAt: this.now(), createdAt: this.now(),
    };
    this.rows.set(session.id, row);
    return { ...row };
  }

  async find(id: string): Promise<ModelUploadSession | null> {
    const row = this.rows.get(id);
    return row ? { ...row } : null;
  }

  async findByModelVersion(modelVersionId: string): Promise<ModelUploadSession | null> {
    const row = [...this.rows.values()].find((r) => r.modelVersionId === modelVersionId);
    return row ? { ...row } : null;
  }

  async transition(
    id: string, from: UploadState[], to: UploadState,
    patch: { error?: string | null; modelVersionId?: string } = {},
  ): Promise<boolean> {
    const row = this.rows.get(id);
    if (!row || !from.includes(row.state)) return false;
    Object.assign(row, patch, { state: to, lastActivityAt: this.now() });
    return true;
  }

  async touch(id: string, at: Date): Promise<void> {
    const row = this.rows.get(id);
    if (row) row.lastActivityAt = at;
  }

  async markFilesRemoved(id: string, at: Date): Promise<void> {
    const row = this.rows.get(id);
    if (row) row.filesRemovedAt = at;
  }

  async delete(id: string): Promise<void> {
    this.rows.delete(id);
  }

  async list(states: UploadState[], before?: Date): Promise<ModelUploadSession[]> {
    return [...this.rows.values()]
      .filter((row) => states.includes(row.state) && (!before || row.lastActivityAt < before))
      .map((row) => ({ ...row }));
  }
}

let sessions: MemoryModelUploads;
let limits: UploadLimits;
let now: number;
let store: FakeObjectStore;
let service: ModelUploadService;
let registered: Map<string, ModelVersion>;
let datasets: Set<string>;
let registerCalls: CreateModelVersionInput[];

function deps(sinks: {
  createSink: (uploadId: string) => UploadSink;
  openSink: (kind: 'local' | 'rustfs', storagePath: string) => UploadSink;
}) {
  return {
    sessions,
    limits: () => limits,
    now: () => now,
    ...sinks,
    datasetExists: async (id: string) => datasets.has(id),
    versionTaken: async (name: string, version: string) =>
      [...registered.values()].some((m) => m.name === name && m.version === version && m.deploymentStatus !== 'archived'),
    findModelVersion: async (id: string) => registered.get(id) ?? null,
    register: async (input: CreateModelVersionInput) => {
      registerCalls.push(input);
      const model = { ...input, id: input.id!, deploymentStatus: 'staging' } as unknown as ModelVersion;
      registered.set(model.id, model);
      return model;
    },
  };
}

function rustfsService(): ModelUploadService {
  const open = (prefix: string): UploadSink => new RustFsUploadSink(prefix, () => store, BUCKET);
  return new ModelUploadService(deps({
    createSink: (uploadId) => open(`uploads/${uploadId}/`),
    openSink: (_kind, storagePath) => open(storagePath),
  }));
}

function localService(): ModelUploadService {
  return new ModelUploadService(deps({
    createSink: (uploadId) => new LocalUploadSink(join(mocks.root, uploadId)),
    openSink: (_kind, storagePath) => new LocalUploadSink(storagePath),
  }));
}

function startBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'GR00T N1.7 AppleToPlate',
    version: 'g11-step-5000',
    baseModel: 'groot_n1_7',
    datasetId: 'ds-apple',
    trainingMetrics: { final_loss: 0.0264 },
    validationMetrics: { success_rate: 0.52 },
    notes: '5000 steps, lr 1e-4',
    files: manifestOf(TREE),
    ...overrides,
  };
}

async function sendPart(upload: StartModelUploadResponse, path: string, partNumber: number, options: {
  data?: Buffer; source?: Readable; sha256?: string;
} = {}) {
  const file = upload.files.find((f) => f.path === path)!;
  const data = options.data ?? partOf(TREE[path], partNumber);
  return service.receivePart(upload.uploadId, file.id, partNumber, options.source ?? streamOf(data), {
    contentLength: data.length,
    sha256: options.sha256 ?? sha256(data),
  });
}

async function sendAll(upload: StartModelUploadResponse, skip: (path: string, part: number) => boolean = () => false) {
  for (const file of upload.files) {
    for (let part = 1; part <= file.partCount; part++) {
      if (!skip(file.path, part)) await sendPart(upload, file.path, part);
    }
  }
}

async function completed(upload: StartModelUploadResponse): Promise<void> {
  await until(async () => (await sessions.find(upload.uploadId))?.state !== 'processing');
}

async function read(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

beforeEach(async () => {
  mocks.root = await mkdtemp(join(tmpdir(), 'model-upload-'));
  sessions = new MemoryModelUploads();
  limits = { ...LIMITS };
  now = Date.parse('2026-11-13T10:00:00Z');
  sessions.now = () => new Date(now);
  store = new FakeObjectStore();
  registered = new Map();
  datasets = new Set(['ds-apple']);
  registerCalls = [];
  service = rustfsService();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(mocks.root, { recursive: true, force: true });
});

describe('start', () => {
  it('opens the upload under the models bucket and registers nothing', async () => {
    const upload = await service.start(startBody());
    expect(upload.state).toBe('uploading');
    expect(upload.storage).toBe('rustfs');
    expect(upload.totalBytes).toBe(Object.values(TREE).reduce((sum, b) => sum + b.length, 0));
    expect(upload.files.map((f) => f.path)).toEqual(Object.keys(TREE));
    expect(upload.files.find((f) => f.path === SHARD)!.partCount).toBe(3);
    // An empty file is one empty part, like a dataset's.
    expect(upload.files.find((f) => f.path === 'experiment_cfg/empty.yaml')!.partCount).toBe(1);
    expect((await sessions.find(upload.uploadId))!.storagePath).toBe(`uploads/${upload.uploadId}/`);
    expect(registered.size).toBe(0);
  });

  it('accepts every file of the directory — a checkpoint has no fixed layout', async () => {
    const upload = await service.start(startBody({
      files: [{ path: 'train_202492.log', size: 10 }, { path: 'wandb_config.json', size: 5 }, { path: 'training_args.bin', size: 7 }],
    }));
    expect(upload.files).toHaveLength(3);
  });

  it.each([
    ['no name', { name: ' ' }, 'INVALID_NAME'],
    ['no version', { version: undefined }, 'INVALID_VERSION'],
    ['an unknown model type', { modelType: 'llm' }, 'INVALID_MODEL_TYPE'],
    ['an unknown base model', { baseModel: 'gr00t-n1.7' }, 'INVALID_BASE_MODEL'],
    ['metrics that are not an object', { trainingMetrics: [1, 2] }, 'INVALID_METRICS'],
    ['notes that are not text', { notes: 5 }, 'INVALID_REQUEST'],
    ['no files', { files: [] }, 'INVALID_MANIFEST'],
    ['a path that leaves the model', { files: [{ path: '../evil.bin', size: 1 }] }, 'INVALID_PATH'],
    ['the same path twice', { files: [{ path: 'a.bin', size: 1 }, { path: 'a.bin', size: 1 }] }, 'DUPLICATE_PATH'],
    ['a file that is also a directory', { files: [{ path: 'a', size: 1 }, { path: 'a/b', size: 1 }] }, 'INVALID_PATH'],
  ])('refuses %s', async (_what, overrides, code) => {
    await expect(service.start(startBody(overrides))).rejects.toMatchObject({ code });
    expect(sessions.rows.size).toBe(0);
    expect(store.uploads.size).toBe(0);
  });

  it('can state GR00T N1.7 as the base model, and every other trainable one', async () => {
    const upload = await service.start(startBody());
    expect((await sessions.find(upload.uploadId))!.metadata.baseModel).toBe('groot_n1_7');
    const none = await service.start(startBody({ version: 'other', baseModel: undefined }));
    expect((await sessions.find(none.uploadId))!.metadata.baseModel).toBeNull();
  });

  it('refuses a dataset this instance does not have', async () => {
    await expect(service.start(startBody({ datasetId: 'nope' }))).rejects.toMatchObject({ code: 'DATASET_NOT_FOUND', statusCode: 404 });
  });

  it('refuses a name and version that are already registered', async () => {
    const upload = await service.start(startBody());
    await sendAll(upload);
    await service.finish(upload.uploadId);
    await completed(upload);
    await expect(service.start(startBody())).rejects.toMatchObject({ code: 'MODEL_VERSION_EXISTS', statusCode: 409 });
  });

  it('refuses a second start of a model that is already on its way, naming the open upload', async () => {
    const upload = await service.start(startBody());
    await expect(service.start(startBody())).rejects.toMatchObject({
      code: 'UPLOAD_IN_PROGRESS', statusCode: 409, context: { uploadId: upload.uploadId, state: 'uploading' },
    });
    expect(sessions.rows.size).toBe(1);
    // Another version of the same model is its own upload; a cancelled one is out of the way.
    await service.start(startBody({ version: 'g11-step-2500' }));
    await service.cancel(upload.uploadId);
    await service.start(startBody());
  });

  it('refuses more than the size cap, naming the model variable', async () => {
    limits.maxTotalBytes = 10 * MIB;
    await expect(service.start(startBody())).rejects.toMatchObject({
      code: 'UPLOAD_TOO_LARGE', statusCode: 413, message: expect.stringContaining('MODEL_UPLOAD_MAX_BYTES'),
    });
  });

  it('answers 507 when the store has no room, and opens nothing', async () => {
    limits.storeCapacityBytes = 20 * MIB;
    store.objects.set('training-datasets/x/big.bin', Buffer.alloc(10 * MIB));
    await expect(service.start(startBody())).rejects.toMatchObject({
      code: 'INSUFFICIENT_STORAGE', statusCode: 507, context: { freeBytes: 10 * MIB },
    });
    expect(sessions.rows.size).toBe(0);
    expect(store.uploads.size).toBe(0);
  });

  it('fits a 4.99 GB shard in 149 parts of the default size, far under the part ceiling', async () => {
    limits = { ...LIMITS, chunkBytes: 32 * MIB, maxTotalBytes: 64 * 1024 * MIB };
    const upload = await service.start(startBody({
      files: [{ path: SHARD, size: 4_990_519_232 }, { path: 'model-00002-of-00002.safetensors', size: 1_919_980_184 }],
    }));
    expect(upload.files.map((f) => f.partCount)).toEqual([149, 58]);
  });
});

describe('parts and status', () => {
  it('reports what the store holds, so a client resumes with only what is missing', async () => {
    const upload = await service.start(startBody());
    await sendPart(upload, 'config.json', 1);
    await sendPart(upload, SHARD, 2);

    // A different process: nothing is remembered but the row and the store.
    service = rustfsService();
    const status = await service.status(upload.uploadId);
    expect(status.state).toBe('uploading');
    expect(status.readyToFinish).toBe(false);
    expect(status.files.find((f) => f.path === SHARD)!.receivedParts).toEqual([2]);
    expect(status.files.find((f) => f.path === 'config.json')!.complete).toBe(true);
    expect(status.receivedBytes).toBe(TREE['config.json'].length + CHUNK);
    expect(status.modelVersionId).toBeNull();
  });

  it('keeps nothing of a part whose bytes do not match its checksum', async () => {
    const upload = await service.start(startBody());
    await expect(sendPart(upload, SHARD, 1, { sha256: 'a'.repeat(64) })).rejects.toMatchObject({ code: 'CHECKSUM_MISMATCH', statusCode: 422 });
    expect((await service.status(upload.uploadId)).files.find((f) => f.path === SHARD)!.receivedParts).toEqual([]);
  });

  it('keeps nothing of a part the client abandoned', async () => {
    const upload = await service.start(startBody());
    const data = partOf(TREE[SHARD], 1);
    await expect(sendPart(upload, SHARD, 1, { source: brokenStream(data.subarray(0, 1000)), sha256: sha256(data) }))
      .rejects.toMatchObject({ code: 'PART_INTERRUPTED' });
    expect((await service.status(upload.uploadId)).receivedBytes).toBe(0);
  });

  it('answers 503 UPLOAD_BUSY beyond the concurrency limit', async () => {
    limits.maxConcurrentParts = 1;
    const upload = await service.start(startBody());
    const stalled = new (await import('stream')).Readable({ read() {} });
    const first = service.receivePart(upload.uploadId, 1, 1, stalled, { contentLength: CHUNK });
    await new Promise((resolve) => setTimeout(resolve, 10));
    await expect(sendPart(upload, 'config.json', 1)).rejects.toMatchObject({ code: 'UPLOAD_BUSY', statusCode: 503 });
    stalled.destroy();
    await expect(first).rejects.toMatchObject({ code: 'PART_INTERRUPTED' });
  });

  it('lists an open upload, and a 404 for one that does not exist', async () => {
    const upload = await service.start(startBody());
    expect((await service.listOpen()).map((u) => u.uploadId)).toEqual([upload.uploadId]);
    await expect(service.status('missing')).rejects.toMatchObject({ code: 'NOT_FOUND', statusCode: 404 });
  });
});

describe('finish', () => {
  it('refuses while a part is missing and says which, registering nothing', async () => {
    const upload = await service.start(startBody());
    await sendAll(upload, (path, part) => path === SHARD && part === 3);
    await expect(service.finish(upload.uploadId)).rejects.toMatchObject({
      code: 'UPLOAD_INCOMPLETE',
      statusCode: 409,
      context: { missingFiles: 1, missing: [{ path: SHARD, missingParts: [3] }] },
    });
    expect((await sessions.find(upload.uploadId))!.state).toBe('uploading');
    expect(registered.size).toBe(0);
  });

  it('assembles, verifies and registers one ModelVersion pointing at the stored prefix', async () => {
    const upload = await service.start(startBody({ files: manifestOf(TREE, true) }));
    await sendAll(upload);
    const accepted = await service.finish(upload.uploadId, 'user-1');
    expect(accepted).toMatchObject({ state: 'processing', modelVersionId: null });
    await completed(upload);

    const session = (await sessions.find(upload.uploadId))!;
    expect(session.state).toBe('completed');
    expect(session.modelVersionId).toBe(upload.uploadId);
    expect(registerCalls).toHaveLength(1);
    expect(registerCalls[0]).toMatchObject({
      id: upload.uploadId,
      name: 'GR00T N1.7 AppleToPlate',
      version: 'g11-step-5000',
      sourceKind: 'uploaded',
      modelType: 'vla',
      baseModel: 'groot_n1_7',
      datasetId: 'ds-apple',
      trainingMetrics: { final_loss: 0.0264 },
      validationMetrics: { success_rate: 0.52 },
      notes: '5000 steps, lr 1e-4',
      artifactUri: `s3://${BUCKET}/uploads/${upload.uploadId}/`,
      artifactSizeBytes: upload.totalBytes,
      artifactFileCount: 5,
    });
    // The tree is in the store as the client sent it, and nothing is left open.
    expect(store.keys(BUCKET)).toEqual(Object.keys(TREE).map((p) => `uploads/${upload.uploadId}/${p}`).sort());
    expect(store.objects.get(`${BUCKET}/uploads/${upload.uploadId}/${SHARD}`)!.equals(TREE[SHARD])).toBe(true);
    expect(store.uploads.size).toBe(0);
    // No longer an open upload.
    expect(await service.listOpen()).toEqual([]);
    expect(await service.finish(upload.uploadId)).toMatchObject({ state: 'completed', modelVersionId: upload.uploadId });
  });

  it('fails the upload, and registers nothing, when a stored file does not match its declared sha256', async () => {
    const files = manifestOf(TREE, true).map((f) => (f.path === 'config.json' ? { ...f, sha256: 'b'.repeat(64) } : f));
    const upload = await service.start(startBody({ files }));
    await sendAll(upload);
    await service.finish(upload.uploadId);
    await completed(upload);

    const status = await service.status(upload.uploadId);
    expect(status.state).toBe('failed');
    expect(status.error).toContain('Checksum mismatch for config.json');
    expect(registered.size).toBe(0);
    // A failed upload is still listed, and can be cancelled away.
    expect((await service.listOpen())[0].state).toBe('failed');
    await service.cancel(upload.uploadId);
    expect(store.keys(BUCKET)).toEqual([]);
  });

  it('registers the model when the store joined a file but its answer was lost', async () => {
    const upload = await service.start(startBody());
    await sendAll(upload);
    // The store completes the multipart upload, then the call fails — a
    // timeout on a multi-gigabyte join, or a retry that finds the upload gone.
    const complete = store.completeMultipartUpload.bind(store);
    vi.spyOn(store, 'completeMultipartUpload').mockImplementation(async (...args) => {
      await complete(...args);
      throw Object.assign(new Error('The specified multipart upload does not exist.'), { name: 'NoSuchUpload' });
    });
    await service.finish(upload.uploadId);
    await completed(upload);
    expect((await sessions.find(upload.uploadId))!.state).toBe('completed');
    expect(registerCalls).toHaveLength(1);
  });

  it('fails the upload when the store could not join a file', async () => {
    const upload = await service.start(startBody());
    await sendAll(upload);
    vi.spyOn(store, 'completeMultipartUpload').mockRejectedValue(new Error('InternalError'));
    await service.finish(upload.uploadId);
    await completed(upload);
    const status = await service.status(upload.uploadId);
    expect(status.state).toBe('failed');
    expect(status.error).toBe('InternalError');
    expect(registered.size).toBe(0);
  });

  it('takes up an upload a restart cut off after finish, without registering twice', async () => {
    const upload = await service.start(startBody());
    await sendAll(upload);
    await sessions.transition(upload.uploadId, ['uploading'], 'processing');

    service = rustfsService();
    expect(await service.resumeInterrupted()).toEqual([upload.uploadId]);
    await completed(upload);
    expect((await sessions.find(upload.uploadId))!.state).toBe('completed');

    // Cut off again between the registry write and the state change.
    await sessions.transition(upload.uploadId, ['completed'], 'processing');
    await service.resumeInterrupted();
    await completed(upload);
    expect(registerCalls).toHaveLength(1);
  });

  it('works on local disk too, with a file:// artifactUri', async () => {
    service = localService();
    const upload = await service.start(startBody());
    expect(upload.storage).toBe('local');
    await sendAll(upload);
    await service.finish(upload.uploadId);
    await completed(upload);
    const root = join(mocks.root, upload.uploadId);
    expect(registerCalls[0].artifactUri).toBe(`file://${root}/`);
    expect((await readFile(join(root, SHARD))).equals(TREE[SHARD])).toBe(true);
    expect((await readFile(join(root, 'experiment_cfg/empty.yaml'))).length).toBe(0);
  });
});

describe('cancel and expiry', () => {
  it('removes parts, objects, open multipart uploads and the row', async () => {
    const upload = await service.start(startBody());
    await sendPart(upload, 'config.json', 1);
    await sendPart(upload, SHARD, 1);
    expect(store.uploads.size).toBeGreaterThan(0);

    expect(await service.cancel(upload.uploadId)).toMatchObject({ status: 'cancelled' });
    expect(store.keys(BUCKET)).toEqual([]);
    expect(store.uploads.size).toBe(0);
    expect(await sessions.find(upload.uploadId)).toBeNull();
    await expect(sendPart(upload, SHARD, 2)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(registered.size).toBe(0);
  });

  it('refuses to cancel a registered upload, pointing at the model delete', async () => {
    const upload = await service.start(startBody());
    await sendAll(upload);
    await service.finish(upload.uploadId);
    await completed(upload);
    await expect(service.cancel(upload.uploadId)).rejects.toMatchObject({
      code: 'UPLOAD_COMPLETED', statusCode: 409, context: { modelVersionId: upload.uploadId },
    });
  });

  it('reaps an upload nothing was sent to for the idle time, and leaves an active one', async () => {
    const idle = await service.start(startBody());
    await sendPart(idle, SHARD, 1);
    now += 30 * 60_000;
    const fresh = await service.start(startBody({ version: 'fresh' }));
    now += 45 * 60_000;

    expect(await service.reapIdle()).toEqual([idle.uploadId]);
    expect(await sessions.find(idle.uploadId)).toBeNull();
    expect(await sessions.find(fresh.uploadId)).not.toBeNull();
    expect(store.keys(BUCKET).filter((k) => k.includes(idle.uploadId))).toEqual([]);
  });

  it('never reaps a completed upload — its files are the model', async () => {
    const upload = await service.start(startBody());
    await sendAll(upload);
    await service.finish(upload.uploadId);
    await completed(upload);
    now += 24 * 60 * 60_000;
    expect(await service.reapIdle()).toEqual([]);
    expect(store.keys(BUCKET)).toHaveLength(5);
  });

  it('names the prefixes of running uploads for the multipart sweep', async () => {
    const upload = await service.start(startBody());
    expect(await service.openPrefixes()).toEqual([`uploads/${upload.uploadId}/`]);
  });
});

describe('the stored model', () => {
  async function uploaded(): Promise<StartModelUploadResponse> {
    const upload = await service.start(startBody({ files: manifestOf(TREE, true) }));
    await sendAll(upload);
    await service.finish(upload.uploadId);
    await completed(upload);
    return upload;
  }

  it('lists its files with sizes and checksums', async () => {
    const upload = await uploaded();
    const manifest = await service.manifest(upload.uploadId);
    expect(manifest).toMatchObject({
      modelVersionId: upload.uploadId,
      artifactUri: `s3://${BUCKET}/uploads/${upload.uploadId}/`,
      totalBytes: upload.totalBytes,
      fileCount: 5,
    });
    expect(manifest.files.find((f) => f.path === SHARD)).toEqual({ path: SHARD, size: 12 * MIB, sha256: sha256(TREE[SHARD]) });
    expect(manifest.nextCursor).toBeNull();
  });

  it('pages its file list in byte order of path, each file exactly once', async () => {
    const upload = await uploaded();
    const sorted = Object.keys(TREE).sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
    const seen: string[] = [];
    let after: string | undefined;
    for (let pages = 0; pages < 10; pages++) {
      const page = await service.manifest(upload.uploadId, { after, limit: 2 });
      expect(page.fileCount).toBe(5);
      expect(page.totalBytes).toBe(upload.totalBytes);
      seen.push(...page.files.map((f) => f.path));
      if (page.nextCursor === null) break;
      after = page.nextCursor;
    }
    expect(seen).toEqual(sorted);
  });

  it('reads a file back whole and by range', async () => {
    const upload = await uploaded();
    const { entry, open } = await service.file(upload.uploadId, SHARD);
    expect(entry.size).toBe(12 * MIB);
    expect((await read(await open())).equals(TREE[SHARD])).toBe(true);
    expect((await read(await open({ range: { start: 100, end: 299 } }))).equals(TREE[SHARD].subarray(100, 300))).toBe(true);
  });

  it('only ever serves a path the manifest lists', async () => {
    const upload = await uploaded();
    store.objects.set(`${BUCKET}/uploads/other/secret.bin`, Buffer.from('x'));
    await expect(service.file(upload.uploadId, '../other/secret.bin')).rejects.toMatchObject({ code: 'FILE_NOT_FOUND', statusCode: 404 });
    await expect(service.file(upload.uploadId, 'nope.bin')).rejects.toMatchObject({ code: 'FILE_NOT_FOUND' });
  });

  it('has no manifest for a model that was not uploaded here, or not yet', async () => {
    await expect(service.manifest('registered-elsewhere')).rejects.toMatchObject({ code: 'NO_STORED_FILES', statusCode: 404 });
    const open = await service.start(startBody());
    await expect(service.manifest(open.uploadId)).rejects.toMatchObject({ code: 'NO_STORED_FILES' });
    expect(await service.storageOf('registered-elsewhere')).toBeNull();
  });

  it('removes the stored files when the model is deleted, once, and says so afterwards', async () => {
    const upload = await uploaded();
    store.objects.set(`${BUCKET}/uploads/other/keep.bin`, Buffer.from('x'));

    expect(await service.removeStoredFiles(upload.uploadId)).toEqual({ removed: true, freedBytes: upload.totalBytes });
    expect(store.keys(BUCKET)).toEqual(['uploads/other/keep.bin']);
    expect(await service.removeStoredFiles(upload.uploadId)).toEqual({ removed: false, freedBytes: 0 });
    await expect(service.manifest(upload.uploadId)).rejects.toMatchObject({ code: 'ARTIFACT_REMOVED', statusCode: 410 });
    expect((await service.storageOf(upload.uploadId))!.filesRemovedAt).not.toBeNull();
    // A model that was never uploaded here has nothing to remove.
    expect(await service.removeStoredFiles('registered-elsewhere')).toEqual({ removed: false, freedBytes: 0 });
  });

  it('removes a local model directory too', async () => {
    service = localService();
    const upload = await uploaded();
    const root = join(mocks.root, upload.uploadId);
    expect(existsSync(root)).toBe(true);
    await service.removeStoredFiles(upload.uploadId);
    expect(existsSync(root)).toBe(false);
  });
});
