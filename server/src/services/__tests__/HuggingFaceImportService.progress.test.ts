/**
 * @file HuggingFaceImportService.progress.test.ts
 * @description What an import reports while it runs (#370): byte-based
 *              download progress with a file-count fallback, metadata-only
 *              versus full imports, a failure that stops the bar where it was,
 *              and a dropped connection that is retried instead of failing the
 *              whole import with undici's bare `terminated`.
 * @feature datasets
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
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
  },
  datasetStorageRoot: () => process.env.__TEST_DATASET_ROOT!,
}));

vi.mock('uuid', () => ({ v4: vi.fn(() => 'storage-id-progress') }));

import {
  HuggingFaceImportService,
  MAX_FILE_DOWNLOAD_ATTEMPTS,
  isTransientDownloadError,
} from '../HuggingFaceImportService.js';
import { importActivityLog } from '../ImportActivityLog.js';
import { datasetRepository, robotTypeRepository } from '../../repositories/index.js';
import { datasetService } from '../DatasetService.js';
import type { DatasetEvent, HuggingFaceImportProgress, LeRobotInfoV3 } from '../../types/dataset.types.js';

const DATASET_ID = 'dataset-progress';
const REPO = 'unitreerobotics/G1_Dex3_ObjectPlacement_Dataset';
const SHA = 'abcdef0123456789abcdef0123456789abcdef01';

const INFO: LeRobotInfoV3 = {
  codebase_version: 'v3.0',
  robot_type: 'unitree_g1',
  fps: 30,
  features: {
    'observation.state': { dtype: 'float32', shape: [6] },
    action: { dtype: 'float32', shape: [6] },
    'observation.images.cam': { dtype: 'video', shape: [480, 640, 3] },
  },
  total_episodes: 2,
  total_frames: 60,
  total_chunks: 1,
  chunks_size: 1000,
};

/** Body of each file: its size in the tree is the real byte count. */
const BODIES: Record<string, string> = {
  'meta/info.json': JSON.stringify(INFO),
  'meta/episodes/chunk-000/file-000.parquet': 'e'.repeat(200),
  'data/chunk-000/file-000.parquet': 'd'.repeat(300),
  'data/chunk-000/file-001.parquet': 'd'.repeat(400),
  'videos/observation.images.cam/chunk-000/file-000.mp4': 'v'.repeat(5000),
};

let root: string;
let unsized: Set<string>;
/** path → how many attempts drop the connection mid-body before one works */
let drops: Map<string, number>;
let statuses: Map<string, number>;
let requests: string[];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** A body that sends half its bytes and then dies the way undici does. */
function droppedBody(text: string): Response {
  const bytes = new TextEncoder().encode(text);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes.slice(0, Math.floor(bytes.length / 2)));
      setTimeout(() => controller.error(new TypeError('terminated')), 5);
    },
  });
  return new Response(stream, { status: 200 });
}

function installFakeHub(): void {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes('/revision/')) return json({ sha: SHA, cardData: { license: 'apache-2.0' } });
    if (url.includes('/tree/')) {
      return json(Object.entries(BODIES).map(([path, body]) => ({
        type: 'file',
        path,
        size: unsized.has(path) ? 0 : body.length,
      })));
    }
    const resolved = /\/resolve\/([^/]+)\/(.+)$/.exec(url);
    if (resolved) {
      const path = resolved[2]!;
      requests.push(path);
      const status = statuses.get(path);
      if (status) return new Response('nope', { status, statusText: 'Nope' });
      const body = BODIES[path];
      if (body === undefined) return new Response('missing', { status: 404, statusText: 'Not Found' });
      const left = drops.get(path) ?? 0;
      if (left > 0) {
        drops.set(path, left - 1);
        return droppedBody(body);
      }
      return new Response(body, { status: 200 });
    }
    throw new Error(`unexpected request ${url}`);
  });
}

function events(): DatasetEvent[] {
  return vi.mocked(datasetService.emit).mock.calls.map((call) => call[1] as DatasetEvent);
}

function frames(): HuggingFaceImportProgress[] {
  return events().filter((e) => e.type === 'dataset:import:progress').map((e) => e.importProgress!);
}

function messages(): string[] {
  return importActivityLog.get(DATASET_ID)?.lines.map((l) => l.message) ?? [];
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

const ended = () => events().some((e) => e.type === 'dataset:import:completed' || e.type === 'dataset:import:failed');

const service = HuggingFaceImportService.getInstance();

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'hf-import-progress-'));
  process.env.__TEST_DATASET_ROOT = root;
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
  delete process.env.__TEST_DATASET_ROOT;
});

beforeEach(() => {
  vi.clearAllMocks();
  unsized = new Set();
  drops = new Map();
  statuses = new Map();
  requests = [];
  importActivityLog.forget(DATASET_ID);
  vi.mocked(datasetRepository.create).mockResolvedValue({ id: DATASET_ID } as never);
  vi.mocked(datasetRepository.update).mockResolvedValue({} as never);
  vi.mocked(robotTypeRepository.findAll).mockResolvedValue([]);
  vi.mocked(robotTypeRepository.create).mockResolvedValue({ id: 'rt-new' } as never);
  vi.mocked(datasetService.validateAndUpdateDataset).mockResolvedValue('ready');
  vi.spyOn(service as unknown as { sleep: (ms: number) => Promise<void> }, 'sleep').mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('download progress (#370)', () => {
  it('measures a multi-file metadata-only import in bytes of the selected files', async () => {
    installFakeHub();
    await service.importDataset({ repoId: REPO });
    await settle(() => expect(ended()).toBe(true));

    const downloading = frames().filter((f) => f.phase === 'downloading');
    // No video in a metadata-only import, so the total is the four other files.
    const total = 200 + 300 + 400 + JSON.stringify(INFO).length;
    expect(downloading[0]).toMatchObject({
      progress: 10, downloadedBytes: 0, totalBytes: total, totalFiles: 4, completedFiles: 0, importMode: 'metadata',
    });
    expect(downloading.at(-1)).toMatchObject({
      progress: 90, downloadedBytes: total, totalBytes: total, totalFiles: 4, completedFiles: 4,
    });
    // Never backwards.
    const percents = downloading.map((f) => f.progress);
    expect(percents).toEqual([...percents].sort((a, b) => a - b));
    expect(requests.some((p) => p.endsWith('.mp4'))).toBe(false);
    expect(messages()).toContain(`Downloading 4 files from the Hub (${(total / 1024).toFixed(1)} KB)`);
  });

  it('counts the video in a full import', async () => {
    installFakeHub();
    await service.importDataset({ repoId: REPO, includeVideos: true });
    await settle(() => expect(ended()).toBe(true));

    const last = frames().filter((f) => f.phase === 'downloading').at(-1)!;
    expect(last).toMatchObject({ totalFiles: 5, completedFiles: 5, importMode: 'full' });
    expect(last.totalBytes).toBe(Object.values(BODIES).reduce((s, b) => s + b.length, 0));
    expect(requests).toContain('videos/observation.images.cam/chunk-000/file-000.mp4');
  });

  it('falls back to counting files when the Hub did not size every file', async () => {
    installFakeHub();
    unsized.add('data/chunk-000/file-001.parquet');
    await service.importDataset({ repoId: REPO });
    await settle(() => expect(ended()).toBe(true));

    const downloading = frames().filter((f) => f.phase === 'downloading');
    expect(downloading.every((f) => f.totalBytes === undefined)).toBe(true);
    // Two of four files is half of the 80-point download band.
    const half = downloading.find((f) => f.completedFiles === 2)!;
    expect(half.progress).toBe(50);
  });

  it('keeps the last progress frame for a page that attaches late, with bytes', async () => {
    installFakeHub();
    await service.importDataset({ repoId: REPO });
    await settle(() => expect(ended()).toBe(true));
    expect(importActivityLog.get(DATASET_ID)!.progress).toMatchObject({
      status: 'validating', phase: 'validating', completedFiles: 4, totalFiles: 4,
    });
  });
});

describe('a failure stops the bar (#370)', () => {
  it('fails mid-download where the bar stood, with the reason, not a reset to 0', async () => {
    installFakeHub();
    statuses.set('data/chunk-000/file-001.parquet', 404);
    await service.importDataset({ repoId: REPO });
    await settle(() => expect(ended()).toBe(true));

    const last = frames().at(-1)!;
    expect(last.status).toBe('failed');
    expect(last.phase).toBe('downloading');
    expect(last.error).toMatch(/404/);
    // Where the bar stood when it stopped — the frame before, not 0.
    const before = frames().at(-2)!;
    expect(before.status).toBe('importing');
    expect(last.progress).toBe(before.progress);
    expect(last.progress).toBeGreaterThanOrEqual(10);
    expect(last.totalFiles).toBe(4);
    expect(last.currentFile).toBeUndefined();
    // A 404 is an answer, not a dropped connection: asked once.
    expect(requests.filter((p) => p === 'data/chunk-000/file-001.parquet')).toHaveLength(1);
  });

  it('sends a failed frame before the failed event when validation rejects the files', async () => {
    installFakeHub();
    vi.mocked(datasetService.validateAndUpdateDataset).mockResolvedValue('failed');
    await service.importDataset({ repoId: REPO });
    await settle(() => expect(ended()).toBe(true));

    const types = events().map((e) => e.type);
    const failedFrame = events().findIndex(
      (e) => e.type === 'dataset:import:progress' && e.importProgress?.status === 'failed',
    );
    expect(failedFrame).toBeGreaterThan(-1);
    expect(failedFrame).toBeLessThan(types.indexOf('dataset:import:failed'));
    expect(events()[failedFrame]!.importProgress).toMatchObject({ phase: 'validating', error: expect.stringMatching(/Validation failed/) });
    expect(importActivityLog.get(DATASET_ID)!.progress!.status).toBe('failed');
  });
});

describe('a dropped connection mid-download (#370: `terminated`)', () => {
  it('retries the file and finishes, without counting the lost bytes twice', async () => {
    installFakeHub();
    drops.set('data/chunk-000/file-001.parquet', 2);
    await service.importDataset({ repoId: REPO });
    await settle(() => expect(ended()).toBe(true));

    expect(events().some((e) => e.type === 'dataset:import:completed')).toBe(true);
    expect(requests.filter((p) => p === 'data/chunk-000/file-001.parquet')).toHaveLength(3);
    const retries = messages().filter((m) => m.startsWith('data/chunk-000/file-001.parquet: terminated — retrying'));
    expect(retries).toHaveLength(2);
    const last = frames().filter((f) => f.phase === 'downloading').at(-1)!;
    expect(last.downloadedBytes).toBe(last.totalBytes);
  });

  it(`gives up after ${MAX_FILE_DOWNLOAD_ATTEMPTS} attempts and fails with the reason`, async () => {
    installFakeHub();
    drops.set('data/chunk-000/file-001.parquet', 99);
    await service.importDataset({ repoId: REPO });
    await settle(() => expect(ended()).toBe(true));

    expect(requests.filter((p) => p === 'data/chunk-000/file-001.parquet')).toHaveLength(MAX_FILE_DOWNLOAD_ATTEMPTS);
    const failed = events().find((e) => e.type === 'dataset:import:failed')!;
    expect(failed.error).toBe('terminated');
  });
});

describe('isTransientDownloadError', () => {
  it('retries what a dropped or refused connection throws', () => {
    expect(isTransientDownloadError(new TypeError('terminated'))).toBe(true);
    expect(isTransientDownloadError(new TypeError('fetch failed'))).toBe(true);
    expect(isTransientDownloadError(Object.assign(new Error('read'), { code: 'ECONNRESET' }))).toBe(true);
    const withCause = Object.assign(new Error('x'), { cause: { code: 'UND_ERR_SOCKET' } });
    expect(isTransientDownloadError(withCause)).toBe(true);
  });

  it('does not retry a local write failure or a plain error', () => {
    expect(isTransientDownloadError(Object.assign(new Error('disk'), { code: 'ENOSPC' }))).toBe(false);
    expect(isTransientDownloadError(new Error('unsafe path'))).toBe(false);
    expect(isTransientDownloadError('terminated')).toBe(false);
  });
});
