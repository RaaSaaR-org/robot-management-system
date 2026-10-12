/**
 * @file HuggingFaceImportService.cancel.test.ts
 * @description Cancelling a Hub import (TASK-371): a running download stops
 *              cooperatively, its partial files are removed and the row is
 *              marked cancelled; an orphan of a restart is ended directly;
 *              an import past its download, or one that is not running, is
 *              refused.
 * @feature datasets
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { existsSync } from 'fs';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

vi.mock('../../repositories/index.js', () => ({
  datasetRepository: {
    create: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
    findById: vi.fn().mockResolvedValue(null),
  },
  robotTypeRepository: {
    findById: vi.fn(),
    findAll: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
  },
}));

vi.mock('../../storage/rustfs-client.js', () => ({
  isRustFSInitialized: vi.fn().mockReturnValue(false),
  isRustFSConfigured: vi.fn().mockReturnValue(false),
  getRustFSStatus: vi.fn(() => ({ configured: false, state: 'disabled', attempts: 0 })),
  getRustFSClient: vi.fn(() => {
    throw new Error('RustFS must not be reached when it is not initialised');
  }),
}));

vi.mock('../../storage/model-storage.js', () => ({
  BUCKETS: { TRAINING_DATASETS: 'training-datasets' },
}));

vi.mock('../../messaging/index.js', () => ({
  natsClient: {
    isConnected: vi.fn().mockReturnValue(false),
    getJetStream: vi.fn().mockReturnValue(null),
  },
}));

vi.mock('../DatasetService.js', () => ({
  datasetService: {
    emit: vi.fn(),
    validateAndUpdateDataset: vi.fn().mockResolvedValue('ready'),
    claimForImport: vi.fn().mockResolvedValue(true),
  },
  datasetStorageRoot: () => process.env.__TEST_DATASET_ROOT!,
}));

vi.mock('uuid', () => ({ v4: vi.fn(() => 'storage-id-cancel') }));

import {
  CANCELLED_IMPORT_ERROR,
  HuggingFaceImportError,
  HuggingFaceImportService,
} from '../HuggingFaceImportService.js';
import { importActivityLog } from '../ImportActivityLog.js';
import { datasetRepository, robotTypeRepository } from '../../repositories/index.js';
import { datasetService } from '../DatasetService.js';
import { isRustFSInitialized } from '../../storage/rustfs-client.js';
import type { DatasetEvent, LeRobotInfoV3 } from '../../types/dataset.types.js';

const DATASET_ID = 'dataset-cancel';
const REPO = 'unitreerobotics/G1_Dex3_ObjectPlacement_Dataset';
const SHA = 'abcdef0123456789abcdef0123456789abcdef01';
const HANGING = 'data/chunk-000/file-001.parquet';

const INFO: LeRobotInfoV3 = {
  codebase_version: 'v3.0',
  robot_type: 'unitree_g1',
  fps: 30,
  features: {
    'observation.state': { dtype: 'float32', shape: [6] },
    action: { dtype: 'float32', shape: [6] },
  },
  total_episodes: 2,
  total_frames: 60,
  total_chunks: 1,
  chunks_size: 1000,
};

const BODIES: Record<string, string> = {
  'meta/info.json': JSON.stringify(INFO),
  'meta/episodes/chunk-000/file-000.parquet': 'e'.repeat(200),
  'data/chunk-000/file-000.parquet': 'd'.repeat(300),
  [HANGING]: 'd'.repeat(400),
};

let root: string;
/** Set once the hanging transfer has started, so a test can cancel mid-body. */
let hangingStarted: Promise<void>;
let markHangingStarted: () => void;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** Half a body, then nothing — until the request is aborted. */
function hangingBody(text: string, signal: AbortSignal | undefined): Response {
  const bytes = new TextEncoder().encode(text);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes.slice(0, bytes.length / 2));
      signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')));
    },
  });
  return new Response(stream, { status: 200 });
}

function installFakeHub(): void {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.includes('/revision/')) return json({ sha: SHA, cardData: { license: 'apache-2.0' } });
    if (url.includes('/tree/')) {
      return json(Object.entries(BODIES).map(([path, body]) => ({ type: 'file', path, size: body.length })));
    }
    const resolved = /\/resolve\/([^/]+)\/(.+)$/.exec(url);
    if (resolved) {
      const path = resolved[2]!;
      if (path === HANGING) {
        markHangingStarted();
        return hangingBody(BODIES[path]!, init?.signal ?? undefined);
      }
      const body = BODIES[path];
      if (body === undefined) return new Response('missing', { status: 404, statusText: 'Not Found' });
      return new Response(body, { status: 200 });
    }
    throw new Error(`unexpected request ${url}`);
  });
}

function events(): DatasetEvent[] {
  return vi.mocked(datasetService.emit).mock.calls.map((call) => call[1] as DatasetEvent);
}

async function settle(check: () => void, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      check();
      return;
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise((r) => setTimeout(r, 10));
    }
  }
}

const service = HuggingFaceImportService.getInstance();

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'hf-import-cancel-'));
  process.env.__TEST_DATASET_ROOT = root;
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
  delete process.env.__TEST_DATASET_ROOT;
});

beforeEach(() => {
  vi.clearAllMocks();
  hangingStarted = new Promise((resolve) => { markHangingStarted = resolve; });
  importActivityLog.forget(DATASET_ID);
  vi.mocked(datasetRepository.create).mockResolvedValue({ id: DATASET_ID } as never);
  vi.mocked(datasetRepository.update).mockResolvedValue({} as never);
  vi.mocked(datasetRepository.findById).mockResolvedValue({ id: DATASET_ID, status: 'importing' } as never);
  vi.mocked(robotTypeRepository.findAll).mockResolvedValue([]);
  vi.mocked(robotTypeRepository.create).mockResolvedValue({ id: 'rt-new' } as never);
  vi.mocked(datasetService.validateAndUpdateDataset).mockResolvedValue('ready');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('cancelling a running import (TASK-371)', () => {
  it('stops the download, removes the partial files and marks the row cancelled', async () => {
    installFakeHub();
    await service.importDataset({ repoId: REPO });
    await hangingStarted;
    const dir = join(root, 'storage-id-cancel');
    // The small files landed while the big one hangs.
    await settle(() => expect(existsSync(join(dir, 'meta/info.json'))).toBe(true));

    const result = await service.cancelImport(DATASET_ID);

    expect(result).toEqual({ datasetId: DATASET_ID, status: 'cancelled' });
    expect(existsSync(dir)).toBe(false);
    expect(service.isRunning(DATASET_ID)).toBe(false);
    expect(datasetRepository.update).toHaveBeenCalledWith(DATASET_ID, {
      status: 'failed',
      importError: expect.objectContaining({ phase: 'downloading', error: CANCELLED_IMPORT_ERROR, cancelled: true }),
    });
    const failed = events().filter((e) => e.type === 'dataset:import:failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ error: CANCELLED_IMPORT_ERROR, cancelled: true });
    expect(events().at(-2)?.importProgress).toMatchObject({ status: 'failed', cancelled: true });
    // Not a failure, and never validated.
    expect(events().some((e) => e.type === 'dataset:import:completed')).toBe(false);
    expect(datasetService.validateAndUpdateDataset).not.toHaveBeenCalled();
    expect(importActivityLog.get(DATASET_ID)?.lines.map((l) => l.message))
      .toContain('Cancelled during downloading; removing the files stored so far');
  });

  it('refuses once every file is stored and validation has begun', async () => {
    let finishValidation!: (outcome: 'ready') => void;
    vi.mocked(datasetService.validateAndUpdateDataset).mockImplementation(
      () => new Promise((resolve) => { finishValidation = resolve; }),
    );
    // No hanging transfer this time: the big file arrives whole.
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/revision/')) return json({ sha: SHA });
      if (url.includes('/tree/')) {
        return json(Object.entries(BODIES).map(([path, body]) => ({ type: 'file', path, size: body.length })));
      }
      const path = /\/resolve\/[^/]+\/(.+)$/.exec(url)![1]!;
      return new Response(BODIES[path] ?? 'missing', { status: BODIES[path] ? 200 : 404 });
    });
    await service.importDataset({ repoId: REPO });
    await settle(() => expect(datasetService.validateAndUpdateDataset).toHaveBeenCalled());

    await expect(service.cancelImport(DATASET_ID)).rejects.toMatchObject({ code: 'NOT_CANCELLABLE', status: 409 });

    finishValidation('ready');
    await settle(() => expect(service.isRunning(DATASET_ID)).toBe(false));
    expect(events().some((e) => e.type === 'dataset:import:completed')).toBe(true);
  });
});

describe('cancelling an import nothing here runs (TASK-371)', () => {
  it('ends an orphaned `importing` row directly and removes its files', async () => {
    const dir = join(root, 'orphan-storage');
    await mkdir(join(dir, 'meta'), { recursive: true });
    await writeFile(join(dir, 'meta/info.json'), '{}');
    vi.mocked(datasetRepository.findById).mockResolvedValue({
      id: 'orphan', status: 'importing', huggingFaceRepoId: REPO, storagePath: `${dir}/`,
    } as never);

    const result = await service.cancelImport('orphan');

    expect(result).toEqual({ datasetId: 'orphan', status: 'cancelled' });
    expect(existsSync(dir)).toBe(false);
    expect(datasetRepository.update).toHaveBeenCalledWith('orphan', {
      status: 'failed',
      importError: expect.objectContaining({ error: CANCELLED_IMPORT_ERROR, cancelled: true, repoId: REPO }),
    });
    expect(service.isRunning('orphan')).toBe(false);
    expect(await readdir(root)).not.toContain('orphan-storage');
  });

  it('removes a local orphan from the disk even once RustFS is the configured store', async () => {
    const dir = join(root, 'local-orphan');
    await mkdir(join(dir, 'meta'), { recursive: true });
    await writeFile(join(dir, 'meta/info.json'), '{}');
    vi.mocked(isRustFSInitialized).mockReturnValue(true);
    vi.mocked(datasetRepository.findById).mockResolvedValue({
      id: 'orphan', status: 'importing', huggingFaceRepoId: REPO, storagePath: `${dir}/`,
    } as never);

    await service.cancelImport('orphan');

    // `getRustFSClient` throws in this file: reaching it would fail the cancel.
    expect(existsSync(dir)).toBe(false);
    vi.mocked(isRustFSInitialized).mockReturnValue(false);
  });

  it.each(['ready', 'failed', 'validating'])('is a 409 for a %s row', async (status) => {
    vi.mocked(datasetRepository.findById).mockResolvedValue({
      id: 'done', status, huggingFaceRepoId: REPO, storagePath: `${root}/done/`,
    } as never);

    await expect(service.cancelImport('done')).rejects.toMatchObject({ code: 'NOT_RUNNING', status: 409 });
    expect(datasetRepository.update).not.toHaveBeenCalled();
  });

  it('is a 404 for a dataset that does not exist', async () => {
    vi.mocked(datasetRepository.findById).mockResolvedValue(null);

    const error = await service.cancelImport('nope').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HuggingFaceImportError);
    expect(error).toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });
});

describe('cancelling a retry, which writes into the row\'s existing storage (#395 review)', () => {
  async function seedStoredDataset(name: string): Promise<string> {
    const dir = join(root, name);
    await mkdir(join(dir, 'meta'), { recursive: true });
    await mkdir(join(dir, 'videos'), { recursive: true });
    await writeFile(join(dir, 'meta/info.json'), JSON.stringify(INFO));
    await writeFile(join(dir, 'videos/earlier.mp4'), 'v');
    return dir;
  }

  it('keeps the files of a ready dataset and puts the row back to ready', async () => {
    const dir = await seedStoredDataset('ready-storage');
    vi.mocked(datasetRepository.findById).mockResolvedValue({
      id: DATASET_ID, status: 'ready', huggingFaceRepoId: REPO, storagePath: `${dir}/`,
      sourceRevision: SHA, sourceLicense: 'apache-2.0', importMode: 'metadata',
    } as never);
    installFakeHub();

    await service.retryImport(DATASET_ID, { includeVideos: true });
    await hangingStarted;
    const result = await service.cancelImport(DATASET_ID);

    expect(result).toEqual({ datasetId: DATASET_ID, status: 'cancelled' });
    expect(existsSync(join(dir, 'videos/earlier.mp4'))).toBe(true);
    expect(existsSync(join(dir, 'meta/info.json'))).toBe(true);
    expect(datasetRepository.update).toHaveBeenLastCalledWith(DATASET_ID, {
      status: 'ready', importError: null, importMode: 'metadata',
    });
    expect(datasetRepository.update).not.toHaveBeenCalledWith(DATASET_ID, expect.objectContaining({ status: 'failed' }));
    expect(importActivityLog.get(DATASET_ID)?.lines.map((l) => l.message))
      .toContain('Cancelled during downloading; the files stored before this retry are kept');
  });

  it('keeps the files of a failed dataset and marks the retry cancelled', async () => {
    const dir = await seedStoredDataset('failed-storage');
    vi.mocked(datasetRepository.findById).mockResolvedValue({
      id: DATASET_ID, status: 'failed', huggingFaceRepoId: REPO, storagePath: `${dir}/`,
      sourceRevision: SHA, sourceLicense: 'apache-2.0', importMode: 'full',
    } as never);
    installFakeHub();

    await service.retryImport(DATASET_ID);
    await hangingStarted;
    await service.cancelImport(DATASET_ID);

    expect(existsSync(join(dir, 'videos/earlier.mp4'))).toBe(true);
    expect(datasetRepository.update).toHaveBeenLastCalledWith(DATASET_ID, {
      status: 'failed',
      importError: expect.objectContaining({ error: CANCELLED_IMPORT_ERROR, cancelled: true }),
    });
  });

  it('records a cancel that lands before the retry launches as a cancel, not a failure', async () => {
    const dir = await seedStoredDataset('prelaunch-storage');
    vi.mocked(datasetRepository.findById).mockResolvedValue({
      id: DATASET_ID, status: 'failed', huggingFaceRepoId: REPO, storagePath: `${dir}/`,
      sourceRevision: SHA, sourceLicense: 'apache-2.0', importMode: 'metadata',
    } as never);
    let askedHub!: () => void;
    const asked = new Promise<void>((resolve) => { askedHub = resolve; });
    let failHub!: () => void;
    const hubFails = new Promise<never>((_, reject) => { failHub = () => reject(new Error('socket hang up')); });
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      askedHub();
      return hubFails;
    });

    const retry = service.retryImport(DATASET_ID).catch((e: unknown) => e);
    await asked;
    expect(await service.cancelImport(DATASET_ID)).toEqual({ datasetId: DATASET_ID, status: 'cancelling' });
    failHub();
    await retry;

    expect(datasetRepository.update).toHaveBeenLastCalledWith(DATASET_ID, {
      status: 'failed',
      importError: expect.objectContaining({ error: CANCELLED_IMPORT_ERROR, cancelled: true }),
    });
    expect(existsSync(join(dir, 'videos/earlier.mp4'))).toBe(true);
    expect(service.isRunning(DATASET_ID)).toBe(false);
  });
});
