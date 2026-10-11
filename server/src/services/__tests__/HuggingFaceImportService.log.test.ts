/**
 * @file HuggingFaceImportService.log.test.ts
 * @description An import tells the browser what it is doing (TASK-352): the
 *              activity log through a success, a download failure and a
 *              validation failure, against a fake Hub and a real temp dir.
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

vi.mock('uuid', () => ({ v4: vi.fn(() => 'storage-id-log') }));

import { HuggingFaceImportService } from '../HuggingFaceImportService.js';
import { importActivityLog } from '../ImportActivityLog.js';
import { datasetRepository, robotTypeRepository } from '../../repositories/index.js';
import { datasetService } from '../DatasetService.js';
import type { DatasetEvent, LeRobotInfoV3 } from '../../types/dataset.types.js';

const DATASET_ID = 'dataset-log';
const REPO = 'lerobot/svla_so101_pickplace';
const SHA = 'abcdef0123456789abcdef0123456789abcdef01';

const INFO: LeRobotInfoV3 = {
  codebase_version: 'v3.0',
  robot_type: 'so101',
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

const TREE = [
  { type: 'file', path: 'meta/info.json', size: 100 },
  { type: 'file', path: 'meta/episodes/chunk-000/file-000.parquet', size: 100 },
  { type: 'file', path: 'data/chunk-000/file-000.parquet', size: 100 },
];

let root: string;
let brokenPaths: Map<string, number>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function installFakeHub(): void {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes('/revision/')) return json({ sha: SHA, cardData: { license: 'apache-2.0' } });
    if (url.includes('/tree/')) return json(TREE);
    const resolved = /\/resolve\/([^/]+)\/(.+)$/.exec(url);
    if (resolved) {
      const path = resolved[2]!;
      const broken = brokenPaths.get(path);
      if (broken) return new Response('nope', { status: broken, statusText: 'Server Error' });
      if (path === 'meta/info.json') return json(INFO);
      return new Response(`bytes of ${path}`, { status: 200 });
    }
    throw new Error(`unexpected request ${url}`);
  });
}

/** Every event the service put on the wire, in order. */
function events(): DatasetEvent[] {
  return vi.mocked(datasetService.emit).mock.calls.map((call) => call[1] as DatasetEvent);
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

const service = HuggingFaceImportService.getInstance();

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'hf-import-log-'));
  process.env.__TEST_DATASET_ROOT = root;
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
  delete process.env.__TEST_DATASET_ROOT;
});

beforeEach(() => {
  vi.clearAllMocks();
  brokenPaths = new Map();
  importActivityLog.forget(DATASET_ID);
  vi.mocked(datasetRepository.create).mockResolvedValue({ id: DATASET_ID } as never);
  vi.mocked(datasetRepository.update).mockResolvedValue({} as never);
  vi.mocked(robotTypeRepository.findAll).mockResolvedValue([]);
  vi.mocked(robotTypeRepository.create).mockResolvedValue({ id: 'rt-new' } as never);
  vi.mocked(datasetService.validateAndUpdateDataset).mockResolvedValue('ready');
  // A transient download failure is retried with backoff (#370); not in real time here.
  vi.spyOn(service as unknown as { sleep: (ms: number) => Promise<void> }, 'sleep').mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the import activity log', () => {
  it('narrates a successful import from start to finish, and ends on completed', async () => {
    installFakeHub();
    await service.importDataset({ repoId: REPO });

    await settle(() => {
      expect(events().some((e) => e.type === 'dataset:import:completed')).toBe(true);
    });

    const lines = messages();
    expect(lines[0]).toBe(`Import of ${REPO} started (metadata only)`);
    expect(lines).toContain(`Pinned main to commit ${SHA.slice(0, 12)}`);
    expect(lines.some((l) => l.startsWith('info.json: LeRobot v3.0, robot so101, 2 episodes'))).toBe(true);
    expect(lines.some((l) => l.startsWith('Storage: local disk at '))).toBe(true);
    expect(lines).toContain('Downloading 3 files from the Hub (300 B)');
    expect(lines.filter((l) => l.startsWith('Downloaded '))).toHaveLength(3);
    expect(lines.slice(-2)).toEqual(['Validation passed', 'Import finished']);

    // Every line also went out on the wire, so a page that is watching sees it live.
    const wired = events().filter((e) => e.type === 'dataset:import:log').map((e) => e.log!.message);
    expect(wired).toEqual(lines);
    // ...and the last of them before "completed", after which a browser stops listening.
    const types = events().map((e) => e.type);
    expect(types.lastIndexOf('dataset:import:log')).toBeLessThan(types.indexOf('dataset:import:completed'));

    // The last progress frame is kept for a page that attaches late.
    expect(importActivityLog.get(DATASET_ID)!.progress).toMatchObject({ progress: 95, phase: 'validating' });
  });

  it('ends a failed download on the phase and the reason, and says failed', async () => {
    installFakeHub();
    brokenPaths.set('data/chunk-000/file-000.parquet', 500);
    await service.importDataset({ repoId: REPO });

    await settle(() => {
      expect(events().some((e) => e.type === 'dataset:import:failed')).toBe(true);
    });

    const last = importActivityLog.get(DATASET_ID)!.lines.at(-1)!;
    expect(last.level).toBe('error');
    expect(last.message).toMatch(/^Failed during downloading: Failed to download .*500/);
    const failed = events().find((e) => e.type === 'dataset:import:failed')!;
    expect(failed.error).toMatch(/500/);
    expect(events().some((e) => e.type === 'dataset:import:completed')).toBe(false);
  });

  it('reports a dataset that fails validation as a failed import, not a completed one', async () => {
    installFakeHub();
    vi.mocked(datasetService.validateAndUpdateDataset).mockResolvedValue('failed');
    await service.importDataset({ repoId: REPO });

    await settle(() => {
      expect(events().some((e) => e.type === 'dataset:import:failed')).toBe(true);
    });

    expect(events().some((e) => e.type === 'dataset:import:completed')).toBe(false);
    expect(messages().at(-1)).toMatch(/^Validation failed/);
  });

  it('starts no log for an import refused before its row exists', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ error: 'nope' }, 404));

    await expect(service.importDataset({ repoId: REPO })).rejects.toThrow();
    expect(importActivityLog.get(DATASET_ID)).toBeNull();
    expect(datasetRepository.create).not.toHaveBeenCalled();
  });

  it('starts a retry on a fresh log', async () => {
    installFakeHub();
    importActivityLog.append(DATASET_ID, 'error', 'Failed during downloading: an older attempt');
    vi.mocked(datasetRepository.findById).mockResolvedValue({
      id: DATASET_ID,
      status: 'failed',
      huggingFaceRepoId: REPO,
      sourceRevision: SHA,
      sourceLicense: 'apache-2.0',
      storagePath: `${root}/storage-id-log/`,
      importMode: 'metadata',
    } as never);

    await service.retryImport(DATASET_ID);
    await settle(() => {
      expect(events().some((e) => e.type === 'dataset:import:completed')).toBe(true);
    });

    expect(messages()[0]).toBe(`Retry of ${REPO} started (metadata only)`);
    expect(messages().some((l) => l.includes('an older attempt'))).toBe(false);
  });
});
