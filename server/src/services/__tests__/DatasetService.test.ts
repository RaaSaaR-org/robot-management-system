/**
 * @file DatasetService.test.ts
 * @description Unit tests for DatasetService — VLA dataset CRUD, upload workflow,
 *              LeRobot v3 structure validation, quality scoring, and stats jobs.
 * @feature datasets
 */

import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { Readable } from 'stream';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import type { DatasetValidationResult } from '../../types/dataset.types.js';
import type { DatasetStructureReport } from '../lerobot/validateDataset.js';

// ---------------------------------------------------------------------------
// Mocks for external boundaries (DB repos, storage, NATS/messaging, KV)
// ---------------------------------------------------------------------------

const {
  getDatasetUploadUrl,
  deleteDatasetFromStorage,
  rustfsExists,
  rustfsDownload,
  rustfsList,
  jsPublish,
} = vi.hoisted(() => ({
  getDatasetUploadUrl: vi.fn(),
  deleteDatasetFromStorage: vi.fn(),
  rustfsExists: vi.fn(),
  rustfsDownload: vi.fn(),
  rustfsList: vi.fn(async (_prefix: string) => [] as string[]),
  jsPublish: vi.fn(),
}));

vi.mock('../../repositories/index.js', () => ({
  datasetRepository: {
    create: vi.fn(),
    findById: vi.fn(),
    findAll: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  robotTypeRepository: {
    findById: vi.fn(),
  },
  skillDefinitionRepository: {
    findById: vi.fn(),
  },
}));

vi.mock('../../storage/model-storage.js', () => ({
  BUCKETS: {
    TRAINING_DATASETS: 'training-datasets',
    MODEL_CHECKPOINTS: 'model-checkpoints',
    PRODUCTION_MODELS: 'production-models',
    ROBOT_LOGS: 'robot-logs',
  },
  modelStorage: {
    getDatasetUploadUrl,
    deleteDataset: deleteDatasetFromStorage,
    // The upload is streamed to the scratch file rather than buffered whole:
    // a multi-GB dataset tarball was materialised twice in the API process
    // before a byte reached disk.
    getDatasetStream: async (id: string, version: string) => {
      const buffer = await rustfsDownload('training-datasets', `${id}/${version}/data.bin`);
      return Readable.from([buffer]);
    },
  },
}));

vi.mock('../../storage/rustfs-client.js', () => ({
  isRustFSInitialized: vi.fn(),
  getRustFSClient: vi.fn(() => ({
    exists: rustfsExists,
    download: rustfsDownload,
    // `RustFsDatasetTree` asks for a size, not a boolean: validation now cares
    // that a file is non-empty, not only that it is listed.
    getMetadata: async (_bucket: string, key: string) => {
      if (!(await rustfsExists(_bucket, key))) {
        // Shaped like the AWS SDK's HeadObject 404, because that is what the
        // tree branches on: anything that is NOT a 404 is now a store outage,
        // and an outage must not be recorded as a broken dataset.
        const err = new Error('NotFound');
        err.name = 'NotFound';
        throw err;
      }
      return { contentLength: 1024 };
    },
    listAll: async function* (_bucket: string, prefix: string) {
      for (const key of await rustfsList(prefix)) {
        yield { key, size: 1024, lastModified: new Date() };
      }
    },
  })),
}));

vi.mock('../../messaging/index.js', () => ({
  natsClient: {
    isConnected: vi.fn(),
    getKV: vi.fn(),
    getJetStream: vi.fn(() => ({ publish: jsPublish })),
  },
}));

vi.mock('../../messaging/kv-stores.js', () => ({
  KV_STORE_NAMES: {
    JOB_PROGRESS: 'JOB_PROGRESS',
    MODEL_REGISTRY: 'MODEL_REGISTRY',
    FLEET_CONFIG: 'FLEET_CONFIG',
  },
  kvGet: vi.fn(),
  kvPut: vi.fn(),
}));

vi.mock('uuid', () => ({
  v4: vi.fn(() => 'generated-uuid'),
}));

import { datasetService, DatasetService } from '../DatasetService.js';
import {
  datasetRepository,
  robotTypeRepository,
  skillDefinitionRepository,
} from '../../repositories/index.js';
import { isRustFSInitialized } from '../../storage/rustfs-client.js';
import { natsClient } from '../../messaging/index.js';
import { kvGet } from '../../messaging/kv-stores.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * A real .tar.gz holding a minimal dataset, built once.
 *
 * A real archive rather than a stub, because the thing under test is that
 * `completeUpload` UNPACKS what was uploaded — a mocked extractor would only
 * prove the call was made.
 */
let tarballCache: Buffer | null = null;
async function tarballFixture(): Promise<Buffer> {
  if (tarballCache) return tarballCache;
  const { execFile } = await import('child_process');
  const { promisify } = await import('util');
  const { mkdtemp, mkdir, readFile, writeFile } = await import('fs/promises');
  const { join } = await import('path');
  const { tmpdir } = await import('os');
  const dir = await mkdtemp(join(tmpdir(), 'dataset-tarball-'));
  await mkdir(join(dir, 'src', 'meta'), { recursive: true });
  await writeFile(
    join(dir, 'src', 'meta', 'info.json'),
    JSON.stringify({ codebase_version: 'v2.1', robot_type: 'so101', fps: 30, features: {} }),
  );
  const archive = join(dir, 'ds.tar.gz');
  await promisify(execFile)('tar', ['-czf', archive, '-C', join(dir, 'src'), 'meta']);
  tarballCache = await readFile(archive);
  return tarballCache;
}

function makeDataset(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ds1',
    name: 'My Dataset',
    description: 'desc',
    robotTypeId: 'rt1',
    skillId: null,
    storagePath: 'ds1/',
    lerobotVersion: 'v3.0',
    fps: 30,
    totalFrames: 0,
    totalDuration: 0,
    demonstrationCount: 0,
    qualityScore: 0,
    infoJson: null,
    statsJson: null,
    status: 'uploading',
    huggingFaceRepoId: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    ...overrides,
  } as never;
}

function makeRobotType(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rt1',
    name: 'SO-101',
    manufacturer: 'TheRobotStudio',
    model: 'so101',
    ...overrides,
  } as never;
}

function makeValidation(overrides: Partial<DatasetValidationResult> = {}): DatasetValidationResult {
  return {
    valid: true,
    errors: [],
    warnings: [],
    episodeCount: 0,
    totalFrames: 0,
    totalDuration: 0,
    lerobotVersion: 'v3.0',
    fps: 30,
    ...overrides,
  };
}

/**
 * Where the upload test unpacks.
 *
 * It used to unpack into `server/data/uploaded-datasets` — inside the
 * developer's checkout — and leave the tree there. Gitignored, so it never
 * showed up in a commit, which is exactly why it went unnoticed.
 */
let uploadDir: string;

beforeAll(async () => {
  uploadDir = await mkdtemp(join(tmpdir(), 'dataset-upload-test-'));
  process.env.DATASET_UPLOAD_DIR = uploadDir;
});

afterAll(async () => {
  delete process.env.DATASET_UPLOAD_DIR;
  await rm(uploadDir, { recursive: true, force: true });
});

beforeEach(() => {
  vi.clearAllMocks();
  // Default: storage and NATS unavailable unless a test opts in.
  vi.mocked(isRustFSInitialized).mockReturnValue(false);
  vi.mocked(natsClient.isConnected).mockReturnValue(false);
});

// ===========================================================================
// create
// ===========================================================================

describe('create', () => {
  it('throws when robotTypeId is missing', async () => {
    await expect(datasetService.create({ name: 'x' } as never)).rejects.toThrow(
      'robotTypeId is required'
    );
    expect(datasetRepository.create).not.toHaveBeenCalled();
  });

  it('throws when robot type does not exist', async () => {
    vi.mocked(robotTypeRepository.findById).mockResolvedValue(null as never);
    await expect(
      datasetService.create({ name: 'x', robotTypeId: 'nope' } as never)
    ).rejects.toThrow('Robot type not found: nope');
  });

  it('throws when a provided skillId does not exist', async () => {
    vi.mocked(robotTypeRepository.findById).mockResolvedValue(makeRobotType());
    vi.mocked(skillDefinitionRepository.findById).mockResolvedValue(null as never);
    await expect(
      datasetService.create({ name: 'x', robotTypeId: 'rt1', skillId: 'bad' } as never)
    ).rejects.toThrow('Skill not found: bad');
  });

  it('creates the dataset with uploading status and generated storage path, and emits an event', async () => {
    vi.mocked(robotTypeRepository.findById).mockResolvedValue(makeRobotType());
    const created = makeDataset({ id: 'newds' });
    vi.mocked(datasetRepository.create).mockResolvedValue(created);

    const events: unknown[] = [];
    const unsub = datasetService.onDatasetEvent((e) => events.push(e));

    const result = await datasetService.create({
      name: 'My Dataset',
      description: 'desc',
      robotTypeId: 'rt1',
    } as never);

    expect(datasetRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'My Dataset',
        robotTypeId: 'rt1',
        status: 'uploading',
        lerobotVersion: 'v3.0',
        storagePath: 'generated-uuid/',
      })
    );
    expect(result.id).toBe('newds');
    expect(events).toHaveLength(1);
    expect((events[0] as { type: string }).type).toBe('dataset:created');
    unsub();
  });
});

// ===========================================================================
// get
// ===========================================================================

describe('get', () => {
  it('returns null when the dataset does not exist', async () => {
    vi.mocked(datasetRepository.findById).mockResolvedValue(null as never);
    expect(await datasetService.get('missing')).toBeNull();
  });

  it('returns a response with robot type relation populated', async () => {
    vi.mocked(datasetRepository.findById).mockResolvedValue(makeDataset());
    vi.mocked(robotTypeRepository.findById).mockResolvedValue(makeRobotType());

    const result = await datasetService.get('ds1');
    expect(result?.id).toBe('ds1');
    expect(result?.robotType).toEqual({
      id: 'rt1',
      name: 'SO-101',
      manufacturer: 'TheRobotStudio',
      model: 'so101',
    });
  });
});

// ===========================================================================
// list
// ===========================================================================

describe('list', () => {
  it('maps query params and pagination, resolving each row to a response', async () => {
    vi.mocked(datasetRepository.findAll).mockResolvedValue({
      data: [makeDataset({ id: 'a' }), makeDataset({ id: 'b' })],
      pagination: { page: 2, pageSize: 5, total: 12, totalPages: 3 },
    } as never);
    vi.mocked(robotTypeRepository.findById).mockResolvedValue(makeRobotType());

    const result = await datasetService.list({ page: 2, limit: 5, status: 'ready' } as never);

    expect(datasetRepository.findAll).toHaveBeenCalledWith(
      expect.objectContaining({ page: 2, pageSize: 5, status: 'ready' })
    );
    expect(result.data.map((d) => d.id)).toEqual(['a', 'b']);
    expect(result.pagination).toEqual({ page: 2, limit: 5, total: 12, totalPages: 3 });
  });

  it('applies default page=1 and limit=20 when omitted', async () => {
    vi.mocked(datasetRepository.findAll).mockResolvedValue({
      data: [],
      pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
    } as never);

    await datasetService.list({} as never);
    expect(datasetRepository.findAll).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, pageSize: 20 })
    );
  });
});

// ===========================================================================
// update
// ===========================================================================

describe('update', () => {
  it('returns null when the dataset does not exist', async () => {
    vi.mocked(datasetRepository.findById).mockResolvedValue(null as never);
    expect(await datasetService.update('missing', { name: 'new' } as never)).toBeNull();
    expect(datasetRepository.update).not.toHaveBeenCalled();
  });

  it('throws when a provided skillId does not exist', async () => {
    vi.mocked(datasetRepository.findById).mockResolvedValue(makeDataset());
    vi.mocked(skillDefinitionRepository.findById).mockResolvedValue(null as never);
    await expect(
      datasetService.update('ds1', { skillId: 'bad' } as never)
    ).rejects.toThrow('Skill not found: bad');
  });

  it('updates and emits dataset:updated', async () => {
    vi.mocked(datasetRepository.findById).mockResolvedValue(makeDataset());
    vi.mocked(datasetRepository.update).mockResolvedValue(
      makeDataset({ name: 'Renamed' })
    );
    vi.mocked(robotTypeRepository.findById).mockResolvedValue(makeRobotType());

    const events: { type: string }[] = [];
    const unsub = datasetService.onDatasetEvent((e) => events.push(e as { type: string }));

    const result = await datasetService.update('ds1', { name: 'Renamed' } as never);
    expect(result?.name).toBe('Renamed');
    expect(datasetRepository.update).toHaveBeenCalledWith(
      'ds1',
      expect.objectContaining({ name: 'Renamed' })
    );
    expect(events.some((e) => e.type === 'dataset:updated')).toBe(true);
    unsub();
  });

  it('returns null when the repository update yields nothing', async () => {
    vi.mocked(datasetRepository.findById).mockResolvedValue(makeDataset());
    vi.mocked(datasetRepository.update).mockResolvedValue(null as never);
    expect(await datasetService.update('ds1', { name: 'x' } as never)).toBeNull();
  });
});

// ===========================================================================
// delete
// ===========================================================================

describe('delete', () => {
  it('returns false when the dataset does not exist', async () => {
    vi.mocked(datasetRepository.findById).mockResolvedValue(null as never);
    expect(await datasetService.delete('missing')).toBe(false);
    expect(datasetRepository.delete).not.toHaveBeenCalled();
  });

  it('deletes the db record and emits dataset:deleted (no storage when RustFS off)', async () => {
    vi.mocked(datasetRepository.findById).mockResolvedValue(makeDataset());
    vi.mocked(datasetRepository.delete).mockResolvedValue(true as never);

    const events: { type: string }[] = [];
    const unsub = datasetService.onDatasetEvent((e) => events.push(e as { type: string }));

    const result = await datasetService.delete('ds1');
    expect(result).toBe(true);
    expect(deleteDatasetFromStorage).not.toHaveBeenCalled();
    expect(events.some((e) => e.type === 'dataset:deleted')).toBe(true);
    unsub();
  });

  it('attempts storage deletion when RustFS is initialized', async () => {
    vi.mocked(isRustFSInitialized).mockReturnValue(true);
    vi.mocked(datasetRepository.findById).mockResolvedValue(makeDataset());
    vi.mocked(datasetRepository.delete).mockResolvedValue(true as never);
    deleteDatasetFromStorage.mockResolvedValue(undefined);

    await datasetService.delete('ds1');
    expect(deleteDatasetFromStorage).toHaveBeenCalledWith('ds1', 'latest');
  });

  it('still deletes the db record when storage deletion throws', async () => {
    vi.mocked(isRustFSInitialized).mockReturnValue(true);
    vi.mocked(datasetRepository.findById).mockResolvedValue(makeDataset());
    deleteDatasetFromStorage.mockRejectedValue(new Error('storage down'));
    vi.mocked(datasetRepository.delete).mockResolvedValue(true as never);

    const result = await datasetService.delete('ds1');
    expect(result).toBe(true);
    expect(datasetRepository.delete).toHaveBeenCalledWith('ds1');
  });

  it('does not emit when the db delete reports failure', async () => {
    vi.mocked(datasetRepository.findById).mockResolvedValue(makeDataset());
    vi.mocked(datasetRepository.delete).mockResolvedValue(false as never);

    const events: { type: string }[] = [];
    const unsub = datasetService.onDatasetEvent((e) => events.push(e as { type: string }));

    const result = await datasetService.delete('ds1');
    expect(result).toBe(false);
    expect(events.some((e) => e.type === 'dataset:deleted')).toBe(false);
    unsub();
  });
});

// ===========================================================================
// initiateUpload
// ===========================================================================

describe('initiateUpload', () => {
  it('throws when the dataset is not found', async () => {
    vi.mocked(datasetRepository.findById).mockResolvedValue(null as never);
    await expect(datasetService.initiateUpload('missing')).rejects.toThrow(
      'Dataset not found: missing'
    );
  });

  it('throws when the dataset is not in uploading state', async () => {
    vi.mocked(datasetRepository.findById).mockResolvedValue(
      makeDataset({ status: 'ready' })
    );
    await expect(datasetService.initiateUpload('ds1')).rejects.toThrow(
      'Dataset upload already completed or in progress: ds1'
    );
  });

  it('throws when storage is unavailable', async () => {
    vi.mocked(datasetRepository.findById).mockResolvedValue(makeDataset());
    vi.mocked(isRustFSInitialized).mockReturnValue(false);
    await expect(datasetService.initiateUpload('ds1')).rejects.toThrow(
      'Storage service not available'
    );
  });

  it('returns a presigned upload URL and emits upload:initiated', async () => {
    vi.mocked(datasetRepository.findById).mockResolvedValue(makeDataset());
    vi.mocked(isRustFSInitialized).mockReturnValue(true);
    getDatasetUploadUrl.mockResolvedValue('https://signed-url');

    const events: { type: string }[] = [];
    const unsub = datasetService.onDatasetEvent((e) => events.push(e as { type: string }));

    const result = await datasetService.initiateUpload('ds1', 'application/x-tar', 123);
    // ONE key, named once. The response used to say `<id>/data.tar.gz` while
    // the presigned URL wrote `<id>/latest/data.bin` and validation looked for
    // `<id>/meta/info.json` — three strings for one object.
    expect(result).toEqual({
      uploadUrl: 'https://signed-url',
      expiresIn: 3600,
      storagePath: 'ds1/upload/data.bin',
    });
    // And the key the URL is signed against is the key the response names.
    expect(getDatasetUploadUrl).toHaveBeenCalledWith('ds1', 'upload', 'application/x-tar');
    expect(events.some((e) => e.type === 'dataset:upload:initiated')).toBe(true);
    unsub();
  });
});

// ===========================================================================
// completeUpload
// ===========================================================================

describe('completeUpload', () => {
  it('throws when the dataset is not found', async () => {
    vi.mocked(datasetRepository.findById).mockResolvedValue(null as never);
    await expect(datasetService.completeUpload('missing')).rejects.toThrow(
      'Dataset not found: missing'
    );
  });

  it('throws when not in uploading state', async () => {
    vi.mocked(datasetRepository.findById).mockResolvedValue(
      makeDataset({ status: 'ready' })
    );
    await expect(datasetService.completeUpload('ds1')).rejects.toThrow(
      'Dataset not in uploading state: ds1 (status: ready)'
    );
  });

  it('unpacks the uploaded archive, then queues validation against the tree', async () => {
    // The step that was missing entirely. `completeUpload` used to go straight
    // to validation against a `storagePath` that pointed at an object nothing
    // had unpacked, so the modal's only outcome was `failed`.
    vi.mocked(datasetRepository.findById).mockResolvedValue(makeDataset());
    vi.mocked(datasetRepository.update).mockResolvedValue(makeDataset() as never);
    vi.mocked(natsClient.isConnected).mockReturnValue(true);
    vi.mocked(isRustFSInitialized).mockReturnValue(true);
    rustfsDownload.mockResolvedValue(await tarballFixture());

    await datasetService.completeUpload('ds1');

    expect(datasetRepository.update).toHaveBeenCalledWith('ds1', { status: 'validating' });
    // The row now points at the unpacked tree, not at the archive.
    const moved = vi.mocked(datasetRepository.update).mock.calls
      .map((c) => c[1] as { storagePath?: string })
      .find((input) => typeof input.storagePath === 'string');
    expect(moved?.storagePath?.startsWith(uploadDir)).toBe(true);
    expect(jsPublish).toHaveBeenCalledWith(
      'jobs.dataset.validate',
      expect.any(Uint8Array),
      expect.objectContaining({ msgID: 'validate-ds1' })
    );
  });

  it('marks the dataset failed, with the reason, when the archive will not unpack', async () => {
    vi.mocked(datasetRepository.findById).mockResolvedValue(makeDataset());
    vi.mocked(datasetRepository.update).mockResolvedValue(makeDataset() as never);
    vi.mocked(natsClient.isConnected).mockReturnValue(true);
    vi.mocked(isRustFSInitialized).mockReturnValue(true);
    rustfsDownload.mockResolvedValue(Buffer.from(''));

    await datasetService.completeUpload('ds1');

    expect(datasetRepository.update).toHaveBeenCalledWith('ds1', { status: 'failed' });
    expect(jsPublish).not.toHaveBeenCalled();
  });

  it('runs validation synchronously when NATS is unavailable', async () => {
    // First findById = uploading; subsequent calls inside validateAndUpdateDataset.
    vi.mocked(datasetRepository.findById)
      .mockResolvedValueOnce(makeDataset())
      .mockResolvedValue(makeDataset({ status: 'ready' }));
    vi.mocked(datasetRepository.update).mockResolvedValue(makeDataset() as never);
    vi.mocked(robotTypeRepository.findById).mockResolvedValue(makeRobotType());
    // Storage off => validateStructure pushes an error, marks dataset failed.
    vi.mocked(isRustFSInitialized).mockReturnValue(false);

    await datasetService.completeUpload('ds1');

    expect(jsPublish).not.toHaveBeenCalled();
    // Synchronous validation path marks dataset failed (storage unavailable).
    expect(datasetRepository.update).toHaveBeenCalledWith('ds1', { status: 'failed' });
  });
});

// ===========================================================================
// getUploadProgress
// ===========================================================================

describe('getUploadProgress', () => {
  it('returns null when no progress KV store is available', async () => {
    // The shared singleton has not been initialized with a KV store.
    expect(await datasetService.getUploadProgress('ds1')).toBeNull();
    expect(kvGet).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// validateStructure
// ===========================================================================

/**
 * Real parquet buffers, built once with the library the reader uses.
 *
 * "Not a parquet" would be honestly reported as unreadable, which is right and
 * is not what these cases are about — a dataset whose files are all present and
 * all readable is the baseline the failure cases are measured against.
 */
let parquetCache: { data: Buffer; episodes: Buffer } | null = null;
async function parquetFixtures(): Promise<{ data: Buffer; episodes: Buffer }> {
  if (parquetCache) return parquetCache;
  const { ParquetSchema, ParquetWriter, ParquetFieldBuilder } = await import('@dsnp/parquetjs');
  const { mkdtemp, readFile } = await import('fs/promises');
  const { join } = await import('path');
  const { tmpdir } = await import('os');
  const dir = await mkdtemp(join(tmpdir(), 'dataset-parquet-'));

  const dataPath = join(dir, 'data.parquet');
  const dataWriter = await ParquetWriter.openFile(
    new ParquetSchema({
      'observation.state': ParquetFieldBuilder.createListField('FLOAT', false),
      action: ParquetFieldBuilder.createListField('FLOAT', false),
    }),
    dataPath,
  );
  const asList = (v: number[]) => ({ list: v.map((element) => ({ element })) });
  const vec = [0, 1, 2, 3, 4, 5];
  for (let i = 0; i < 150; i++) {
    await dataWriter.appendRow({ 'observation.state': asList(vec), action: asList(vec) });
  }
  await dataWriter.close();

  const episodesPath = join(dir, 'episodes.parquet');
  const episodesWriter = await ParquetWriter.openFile(
    new ParquetSchema({ episode_index: { type: 'INT64' }, length: { type: 'INT64' } }),
    episodesPath,
  );
  for (let ep = 0; ep < 5; ep++) await episodesWriter.appendRow({ episode_index: ep, length: 30 });
  await episodesWriter.close();

  parquetCache = { data: await readFile(dataPath), episodes: await readFile(episodesPath) };
  return parquetCache;
}

/**
 * A RustFS dataset that is COMPLETE — info.json plus every file it names.
 *
 * Building the whole tree is the point. Until TASK-217 `validateStructure`
 * asked whether `meta/info.json` existed and read four fields out of it, so a
 * manifest with nothing behind it validated clean; these tests describe a check
 * that opens what the manifest names.
 */
async function mockCompleteDataset(options: {
  version?: string;
  cameras?: string[];
  withStats?: boolean;
  omit?: string[];
} = {}): Promise<Record<string, unknown>> {
  const parquets = await parquetFixtures();
  const version = options.version ?? 'v3.0';
  const cameras = options.cameras ?? ['observation.images.cam_high'];
  const omit = new Set(options.omit ?? []);
  const features: Record<string, unknown> = {};
  for (const cam of cameras) features[cam] = { dtype: 'video', shape: [64, 64, 3] };
  features['observation.state'] = { dtype: 'float32', shape: [6] };
  features.action = { dtype: 'float32', shape: [6] };
  // Declared because the fixture parquet carries them and nothing else:
  // a column in the file that `features` does not declare is a hard CastError
  // inside lerobot, so validation reports it.

  const info = {
    codebase_version: version,
    robot_type: 'so101',
    fps: 30,
    total_episodes: 5,
    total_frames: 150,
    total_chunks: 1,
    chunks_size: 1000,
    features,
  };

  const present = new Set<string>(['meta/info.json']);
  present.add('data/chunk-000/file-000.parquet');
  for (const cam of cameras) present.add(`videos/${cam}/chunk-000/file-000.mp4`);
  if (options.withStats) present.add('meta/stats.json');
  const episodeShard = 'meta/episodes/chunk-000/file-000.parquet';

  for (const path of omit) present.delete(path);

  rustfsExists.mockImplementation(async (_bucket: string, key: string) => {
    const rel = key.replace(/^ds1\//, '');
    if (rel === episodeShard) return !omit.has(episodeShard);
    return present.has(rel);
  });
  rustfsList.mockImplementation(async (prefix: string) =>
    prefix.includes('meta/episodes') && !omit.has(episodeShard) ? [`ds1/${episodeShard}`] : [],
  );
  rustfsDownload.mockImplementation(async (_bucket: string, key: string) => {
    if (key.endsWith('info.json')) return Buffer.from(JSON.stringify(info));
    if (key.endsWith('stats.json')) return Buffer.from(JSON.stringify({ mean: [1, 2, 3] }));
    if (key.includes('meta/episodes/')) return parquets.episodes;
    if (key.endsWith('.parquet')) return parquets.data;
    return Buffer.from('mp4-ish');
  });
  return info;
}

describe('validateStructure', () => {
  it('separates "the file is not there" from "the store did not answer"', async () => {
    // `RustFsDatasetTree.stat` caught every exception and returned null, so a
    // timeout, a 500 or an expired credential all read as a missing parquet —
    // and the dataset was written `failed` for files that were all present.
    vi.mocked(isRustFSInitialized).mockReturnValue(true);
    await mockCompleteDataset();
    rustfsExists.mockImplementation(async () => {
      const err = new Error('connection reset by peer');
      err.name = 'TimeoutError';
      throw err;
    });

    const result = await datasetService.validateStructure('ds1/');

    expect(result.storeUnavailable).toBe(true);
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toContain('could not reach the object store');
  });

  it('returns invalid with an error when storage is unavailable', async () => {
    vi.mocked(isRustFSInitialized).mockReturnValue(false);
    const result = await datasetService.validateStructure('ds1/');
    expect(result.valid).toBe(false);
    // NOT "this dataset is broken" — nowhere to look. Recording it as a
    // validation failure would mark a good dataset failed because a store was
    // briefly down.
    expect(result.errors).toContain('Storage service not available');
  });

  it('fails when meta/info.json is missing', async () => {
    vi.mocked(isRustFSInitialized).mockReturnValue(true);
    rustfsExists.mockResolvedValue(false);
    const result = await datasetService.validateStructure('ds1/');
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Missing required file: meta/info.json');
    expect(result.report?.errors.map((e) => e.code)).toEqual(['MISSING_INFO']);
  });

  it('collects errors for missing required info.json fields', async () => {
    vi.mocked(isRustFSInitialized).mockReturnValue(true);
    rustfsExists.mockImplementation(async (_bucket: string, path: string) =>
      path.endsWith('info.json')
    );
    rustfsDownload.mockResolvedValue(Buffer.from(JSON.stringify({})));

    const result = await datasetService.validateStructure('ds1/');
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        'info.json missing required field: codebase_version',
        'info.json missing required field: robot_type',
        'info.json missing or invalid field: fps',
        'info.json missing required field: features',
      ])
    );
  });

  it('FAILS a manifest with nothing behind it — the case that used to pass', async () => {
    // THE regression this task exists for. `info.json` alone, complete and
    // well-formed, naming a parquet and a video that are not there. The old
    // check called this valid and scored it; a training run found out hours
    // later.
    vi.mocked(isRustFSInitialized).mockReturnValue(true);
    await mockCompleteDataset({
      omit: [
        'data/chunk-000/file-000.parquet',
        'videos/observation.images.cam_high/chunk-000/file-000.mp4',
        'meta/episodes/chunk-000/file-000.parquet',
      ],
    });

    const result = await datasetService.validateStructure('ds1/');
    expect(result.valid).toBe(false);
    const codes = result.report!.errors.map((e) => e.code);
    expect(codes).toContain('MISSING_DATA_FILE');
    expect(codes).toContain('MISSING_VIDEO_FILE');
    expect(codes).toContain('MISSING_EPISODE_META');
  });

  it('reports the files it opened, and still warns about a missing stats.json', async () => {
    vi.mocked(isRustFSInitialized).mockReturnValue(true);
    await mockCompleteDataset();

    const result = await datasetService.validateStructure('ds1/');
    expect(result.lerobotVersion).toBe('v3.0');
    expect(result.fps).toBe(30);
    expect(result.report!.files.map((f) => f.path)).toEqual(expect.arrayContaining([
      'meta/info.json',
      'data/chunk-000/file-000.parquet',
      'videos/observation.images.cam_high/chunk-000/file-000.mp4',
    ]));
    expect(result.warnings.join(' ')).toContain('stats.json');
  });

  it('parses stats.json when present', async () => {
    vi.mocked(isRustFSInitialized).mockReturnValue(true);
    await mockCompleteDataset({ withStats: true });

    const result = await datasetService.validateStructure('ds1/');
    expect(result.stats).toEqual({ mean: [1, 2, 3] });
    expect(result.report!.warnings.map((w) => w.code)).not.toContain('MISSING_STATS');
  });

  it('warns when the dataset declares no camera at all', async () => {
    // A warning and not an error — a state-only dataset is a legitimate thing
    // to hold. What it cannot do is train a VLA, and that used to surface only
    // inside the training job as "All image features are missing from the batch".
    vi.mocked(isRustFSInitialized).mockReturnValue(true);
    await mockCompleteDataset({ cameras: [] });

    const result = await datasetService.validateStructure('ds1/');
    expect(result.report!.warnings.map((w) => w.code)).toContain('NO_IMAGE_FEATURES');
    expect(result.report!.imageKeys).toEqual([]);
  });

  it('captures download/parse exceptions as a validation error', async () => {
    vi.mocked(isRustFSInitialized).mockReturnValue(true);
    rustfsExists.mockResolvedValue(true);
    rustfsDownload.mockRejectedValue(new Error('boom'));

    const result = await datasetService.validateStructure('ds1/');
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/boom|not valid JSON/);
  });
});

/** A structural report, for the coverage half of the score. */
function makeReport(over: Partial<DatasetStructureReport> = {}): DatasetStructureReport {
  return {
    valid: true,
    layout: 'v3',
    lerobotVersion: 'v3.0',
    errors: [],
    warnings: [],
    fps: 30,
    episodeCount: 0,
    totalFrames: 0,
    totalDuration: 0,
    imageKeys: [],
    observedStateWidth: null,
    observedActionWidth: null,
    files: [],
    ...over,
  };
}

describe('computeQualityScore', () => {
  it('gives no coverage points to a dataset nothing has opened', () => {
    // The 20-point slot used to be `episodeCount > 10 ? 16 : 8` under the name
    // "diversity", with a comment admitting it analysed nothing. A component
    // that takes one of two values and measures nothing is worse than a missing
    // one, because it moves the total and so reads as information. With no
    // report there is nothing measured, and the slot scores zero.
    const score = datasetService.computeQualityScore(
      makeValidation({ episodeCount: 0, totalDuration: 0, valid: true })
    );
    expect(score.demonstrationCount).toBe(0);
    expect(score.duration).toBe(0);
    expect(score.diversity).toBe(0);
    expect(score.formatCompliance).toBe(3); // valid only
    expect(score.total).toBe(3);
  });

  it('scores sensor coverage from the cameras the files actually declare', () => {
    // Two cameras and a clean structural report is the whole 20: 70% for
    // sensors, 30% for every promised file being present and non-empty.
    const twoCameras = datasetService.computeQualityScore(
      makeValidation({
        episodeCount: 0,
        totalDuration: 0,
        valid: true,
        report: makeReport({ imageKeys: ['observation.images.a', 'observation.images.b'] }),
      })
    );
    expect(twoCameras.diversity).toBe(20);

    const oneCamera = datasetService.computeQualityScore(
      makeValidation({
        episodeCount: 0, totalDuration: 0, valid: true,
        report: makeReport({ imageKeys: ['observation.images.a'] }),
      })
    );
    expect(oneCamera.diversity).toBe(13); // 20*0.7*0.5 + 20*0.3

    // A state-only dataset gets the integrity share and none of the sensor
    // share, because it cannot train a vision-language-action policy at all.
    const noCamera = datasetService.computeQualityScore(
      makeValidation({
        episodeCount: 0, totalDuration: 0, valid: true,
        report: makeReport({ imageKeys: [] }),
      })
    );
    expect(noCamera.diversity).toBe(6); // 20*0.3
  });

  it('withholds the integrity share from a dataset with structural errors', () => {
    const score = datasetService.computeQualityScore(
      makeValidation({
        episodeCount: 0, totalDuration: 0, valid: false,
        report: makeReport({
          valid: false,
          imageKeys: ['observation.images.a', 'observation.images.b'],
          errors: [{ code: 'MISSING_DATA_FILE', message: 'gone' }],
        }),
      })
    );
    expect(score.diversity).toBe(14); // sensors only: 20*0.7
  });

  it('awards full marks at or beyond thresholds and caps total at 100', () => {
    const score = datasetService.computeQualityScore(
      makeValidation({
        episodeCount: 100, // beyond DEMO_COUNT_MAX (50) => capped 40
        totalDuration: 7200, // beyond DURATION_MAX (3600) => capped 30
        valid: true,
        info: { codebase_version: 'v3.0' } as never,
        stats: { mean: [] } as never,
        report: makeReport({ imageKeys: ['observation.images.a', 'observation.images.b'] }),
      })
    );
    expect(score.demonstrationCount).toBe(40);
    expect(score.duration).toBe(30);
    expect(score.diversity).toBe(20);
    expect(score.formatCompliance).toBe(10); // info(4) + stats(3) + valid(3)
    expect(score.total).toBe(100);
    expect(score.total).toBeLessThanOrEqual(100);
  });
});

// ===========================================================================
// getStats
// ===========================================================================

describe('getStats', () => {
  it('throws when the dataset is not found', async () => {
    vi.mocked(datasetRepository.findById).mockResolvedValue(null as never);
    await expect(datasetService.getStats('missing')).rejects.toThrow(
      'Dataset not found: missing'
    );
  });

  it('reports hasStats=false when statsJson is empty', async () => {
    vi.mocked(datasetRepository.findById).mockResolvedValue(
      makeDataset({ statsJson: null })
    );
    const result = await datasetService.getStats('ds1');
    expect(result.datasetId).toBe('ds1');
    expect(result.hasStats).toBeFalsy();
    expect(result.stats).toBeUndefined();
  });

  it('returns stats and computedAt when statsJson is populated', async () => {
    vi.mocked(datasetRepository.findById).mockResolvedValue(
      makeDataset({ statsJson: { mean: [1] } })
    );
    const result = await datasetService.getStats('ds1');
    expect(result.hasStats).toBe(true);
    expect(result.stats).toEqual({ mean: [1] });
    expect(result.computedAt).toBe('2026-01-02T00:00:00.000Z');
  });
});

// ===========================================================================
// computeStats
// ===========================================================================

describe('computeStats', () => {
  it('throws when the dataset is not found', async () => {
    vi.mocked(datasetRepository.findById).mockResolvedValue(null as never);
    await expect(datasetService.computeStats('missing')).rejects.toThrow(
      'Dataset not found: missing'
    );
  });

  it('throws when the dataset is not ready', async () => {
    vi.mocked(datasetRepository.findById).mockResolvedValue(
      makeDataset({ status: 'uploading' })
    );
    await expect(datasetService.computeStats('ds1')).rejects.toThrow(
      'Dataset not ready for stats computation: ds1'
    );
  });

  it('throws when stats already exist and force is false', async () => {
    vi.mocked(datasetRepository.findById).mockResolvedValue(
      makeDataset({ status: 'ready', statsJson: { mean: [1] } })
    );
    await expect(datasetService.computeStats('ds1')).rejects.toThrow(
      'Dataset already has stats'
    );
  });

  it('throws when NATS is unavailable (worker required)', async () => {
    vi.mocked(datasetRepository.findById).mockResolvedValue(
      makeDataset({ status: 'ready', statsJson: null })
    );
    vi.mocked(natsClient.isConnected).mockReturnValue(false);
    await expect(datasetService.computeStats('ds1')).rejects.toThrow(
      'Stats computation worker not available'
    );
  });

  it('publishes a stats job when NATS is connected', async () => {
    vi.mocked(datasetRepository.findById).mockResolvedValue(
      makeDataset({ status: 'ready', statsJson: null })
    );
    vi.mocked(natsClient.isConnected).mockReturnValue(true);

    await datasetService.computeStats('ds1');
    expect(jsPublish).toHaveBeenCalledWith(
      'jobs.dataset.compute-stats',
      expect.any(Uint8Array),
      expect.objectContaining({ msgID: expect.stringContaining('stats-ds1-') })
    );
  });

  it('recomputes existing stats when force=true', async () => {
    vi.mocked(datasetRepository.findById).mockResolvedValue(
      makeDataset({ status: 'ready', statsJson: { mean: [1] } })
    );
    vi.mocked(natsClient.isConnected).mockReturnValue(true);

    await expect(datasetService.computeStats('ds1', true)).resolves.toBeUndefined();
    expect(jsPublish).toHaveBeenCalled();
  });
});

// ===========================================================================
// validateAndUpdateDataset (orchestration)
// ===========================================================================

describe('validateAndUpdateDataset', () => {
  it('marks the dataset failed and emits validation:failed when structure is invalid', async () => {
    // A REACHABLE store holding a manifest with nothing behind it. This used to
    // be written as "turn RustFS off", which is a different thing entirely —
    // see the test below.
    vi.mocked(isRustFSInitialized).mockReturnValue(true);
    await mockCompleteDataset({ omit: ['data/chunk-000/file-000.parquet'] });
    vi.mocked(datasetRepository.update).mockResolvedValue(makeDataset() as never);
    vi.mocked(robotTypeRepository.findById).mockResolvedValue(makeRobotType());

    const events: { type: string }[] = [];
    const unsub = datasetService.onDatasetEvent((e) => events.push(e as { type: string }));

    const outcome = await datasetService.validateAndUpdateDataset('ds1', 'ds1/');

    expect(outcome).toBe('failed');
    expect(datasetRepository.update).toHaveBeenCalledWith('ds1', expect.objectContaining({
      status: 'failed',
    }));
    expect(events.some((e) => e.type === 'dataset:validation:failed')).toBe(true);
    unsub();
  });

  it('leaves the row ALONE when the store cannot be reached', async () => {
    // The comment in `validateStructure` says an unreachable store must not be
    // recorded as a validation failure — and then the caller wrote
    // `status: 'failed'` on exactly that, so one RustFS outage turned every
    // dataset anyone revalidated red. Nothing was opened, so nothing is known.
    vi.mocked(isRustFSInitialized).mockReturnValue(false);
    vi.mocked(datasetRepository.update).mockResolvedValue(makeDataset() as never);

    const outcome = await datasetService.validateAndUpdateDataset('ds1', 'ds1/');

    expect(outcome).toBe('unavailable');
    expect(datasetRepository.update).not.toHaveBeenCalled();
  });

  it('marks the dataset ready with a quality score on a valid structure', async () => {
    vi.mocked(isRustFSInitialized).mockReturnValue(true);
    // A COMPLETE tree, not a lone manifest: a manifest with nothing behind it
    // now fails, which is the point of the task.
    await mockCompleteDataset();
    vi.mocked(datasetRepository.update).mockResolvedValue(makeDataset() as never);
    vi.mocked(datasetRepository.findById).mockResolvedValue(
      makeDataset({ status: 'ready', qualityScore: 50 })
    );
    vi.mocked(robotTypeRepository.findById).mockResolvedValue(makeRobotType());

    const events: { type: string }[] = [];
    const unsub = datasetService.onDatasetEvent((e) => events.push(e as { type: string }));

    await datasetService.validateAndUpdateDataset('ds1', 'ds1/');

    expect(datasetRepository.update).toHaveBeenCalledWith(
      'ds1',
      expect.objectContaining({ status: 'ready', qualityScore: expect.any(Number) })
    );
    expect(events.some((e) => e.type === 'dataset:validation:completed')).toBe(true);
    unsub();
  });

  it('marks the dataset failed when an unexpected error is thrown mid-validation', async () => {
    vi.mocked(isRustFSInitialized).mockReturnValue(true);
    // exists throws synchronously inside validateStructure's try, which is
    // caught there; to hit the outer catch we make update throw on first call.
    rustfsExists.mockImplementation(async (_bucket: string, path: string) =>
      path.endsWith('info.json')
    );
    rustfsDownload.mockResolvedValue(
      Buffer.from(
        JSON.stringify({
          codebase_version: 'v3.0',
          robot_type: 'so101',
          fps: 30,
          features: { x: {} },
          total_episodes: 5,
          total_frames: 150,
        })
      )
    );
    // First update (to 'ready') throws -> outer catch -> second update to 'failed'.
    vi.mocked(datasetRepository.update)
      .mockRejectedValueOnce(new Error('db write failed'))
      .mockResolvedValue(makeDataset() as never);
    vi.mocked(datasetRepository.findById).mockResolvedValue(makeDataset());
    vi.mocked(robotTypeRepository.findById).mockResolvedValue(makeRobotType());

    const events: { type: string }[] = [];
    const unsub = datasetService.onDatasetEvent((e) => events.push(e as { type: string }));

    await datasetService.validateAndUpdateDataset('ds1', 'ds1/');

    expect(datasetRepository.update).toHaveBeenCalledWith('ds1', { status: 'failed' });
    expect(events.some((e) => e.type === 'dataset:validation:failed')).toBe(true);
    unsub();
  });
});

// ===========================================================================
// singleton + initialization
// ===========================================================================

describe('singleton & lifecycle', () => {
  it('getInstance returns the shared singleton', () => {
    expect(DatasetService.getInstance()).toBe(datasetService);
  });

  it('initialize is idempotent and sets isInitialized', async () => {
    await datasetService.initialize();
    expect(datasetService.isInitialized()).toBe(true);
    // second call is a no-op (does not query NATS again)
    vi.mocked(natsClient.isConnected).mockClear();
    await datasetService.initialize();
    expect(natsClient.isConnected).not.toHaveBeenCalled();
  });
});
