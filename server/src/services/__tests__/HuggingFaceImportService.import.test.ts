/**
 * @file HuggingFaceImportService.import.test.ts
 * @description The five things that made a Hub import unusable here (TASK-220),
 *              one test each, against a fake Hub and a real temp directory.
 * @feature datasets
 *
 * The Hub is faked at `fetch`, not at some seam inside the service, because
 * three of the five defects ARE the URLs the service builds: the import used to
 * address `main` rather than a commit, so a test that stubs out the fetching
 * cannot see the bug it is meant to pin. Every request is recorded and asserted
 * on.
 *
 * The sink is NOT faked. `isRustFSInitialized` returns false — the normal dev
 * condition, and the one under which every import on this machine died — and
 * the assertion is that a LeRobot tree exists on disk afterwards.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, stat } from 'fs/promises';
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
  // The condition this whole file exists for: no object store.
  isRustFSInitialized: vi.fn().mockReturnValue(false),
  // Not configured either: the dev server with no object store, which is the
  // only one allowed to fall back to local disk.
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
  // Read from the environment rather than closed over, because `vi.mock`
  // factories are hoisted above every `let` in this file.
  datasetStorageRoot: () => process.env.__TEST_DATASET_ROOT!,
}));

vi.mock('uuid', () => ({ v4: vi.fn(() => STORAGE_ID) }));

import {
  HuggingFaceImportService,
  HuggingFaceImportError,
  matchRobotType,
  selectRepoFiles,
} from '../HuggingFaceImportService.js';
import { datasetRepository, robotTypeRepository } from '../../repositories/index.js';
import { natsClient } from '../../messaging/index.js';
import { getRustFSClient, isRustFSInitialized } from '../../storage/rustfs-client.js';
import { v4 as uuidv4 } from 'uuid';
import { datasetService } from '../DatasetService.js';
import type { LeRobotInfoV3 } from '../../types/dataset.types.js';
import type { RobotType } from '../../types/vla.types.js';

// ============================================================================
// THE FAKE HUB
// ============================================================================

const STORAGE_ID = 'storage-id-fixed';
const DATASET_ID = 'dataset-id-fixed';
const REPO = 'nvidia/GR00T-N1.7-AppleToPlate';
const SHA = '0123456789abcdef0123456789abcdef01234567';

/** 43-wide state AND action, one video key — the repo the task is about. */
const INFO: LeRobotInfoV3 = {
  codebase_version: 'v2.1',
  robot_type: 'unitree_g1',
  fps: 30,
  features: {
    'observation.images.ego_view': { dtype: 'video', shape: [480, 640, 3] },
    'observation.state': { dtype: 'float32', shape: [43] },
    action: { dtype: 'float32', shape: [43] },
  },
  total_episodes: 2,
  total_frames: 60,
  total_chunks: 1,
  chunks_size: 1000,
};

const TREE = [
  { type: 'file', path: '.gitattributes', size: 2419 },
  { type: 'file', path: 'README.md', size: 3538 },
  { type: 'file', path: 'meta/info.json', size: 2261 },
  { type: 'file', path: 'meta/stats.json', size: 4371 },
  { type: 'file', path: 'meta/episodes/chunk-000/file-000.parquet', size: 106584 },
  { type: 'file', path: 'data/chunk-000/file-000.parquet', size: 674393 },
  { type: 'file', path: 'videos/observation.images.ego_view/chunk-000/file-000.mp4', size: 6890970 },
];

let root: string;
let requested: string[];
/** Paths whose download should answer with this status instead of 200. */
let brokenPaths: Map<string, number>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function installFakeHub(
  options: { info?: LeRobotInfoV3; revisionStatus?: number; tree?: typeof TREE } = {},
): void {
  const info = options.info ?? INFO;
  const tree = options.tree ?? TREE;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    requested.push(url);

    if (url.includes('/api/datasets/') && url.includes('/revision/')) {
      if (options.revisionStatus) return json({ error: 'nope' }, options.revisionStatus);
      return json({ sha: SHA, cardData: { license: 'cc-by-4.0' } });
    }
    if (url.includes('/api/datasets/') && url.includes('/tree/')) {
      return json(tree);
    }
    const resolved = /\/resolve\/([^/]+)\/(.+)$/.exec(url);
    if (resolved) {
      const path = resolved[2]!;
      const broken = brokenPaths.get(path);
      if (broken) return new Response('nope', { status: broken, statusText: 'Server Error' });
      if (path === 'meta/info.json') return json(info);
      return new Response(`bytes of ${path}`, { status: 200 });
    }
    throw new Error(`the fake Hub was asked for something it does not serve: ${url}`);
  });
}

/** Poll until `check` stops throwing — the import runs detached by design. */
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

function exists(...parts: string[]): Promise<boolean> {
  return stat(join(root, STORAGE_ID, ...parts)).then(() => true, () => false);
}

const service = HuggingFaceImportService.getInstance();

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'hf-import-'));
  process.env.__TEST_DATASET_ROOT = root;
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
  delete process.env.__TEST_DATASET_ROOT;
});

beforeEach(async () => {
  vi.clearAllMocks();
  vi.spyOn(service as unknown as { sleep(ms: number): Promise<void> }, 'sleep').mockResolvedValue();
  vi.mocked(isRustFSInitialized).mockReturnValue(false);
  vi.mocked(natsClient.isConnected).mockReturnValue(false);
  vi.mocked(natsClient.getJetStream).mockReturnValue(null as never);
  requested = [];
  brokenPaths = new Map();
  await rm(join(root, STORAGE_ID), { recursive: true, force: true });
  vi.mocked(datasetRepository.create).mockResolvedValue({ id: DATASET_ID } as never);
  vi.mocked(datasetRepository.update).mockResolvedValue({} as never);
  vi.mocked(robotTypeRepository.findAll).mockResolvedValue([]);
  vi.mocked(robotTypeRepository.create).mockResolvedValue({ id: 'rt-new' } as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ============================================================================
// 1 — THE IMPORT CANNOT WRITE ANYWHERE BUT RUSTFS
// ============================================================================

describe('with no object store', () => {
  it('writes a LeRobot tree to disk instead of failing 300 ms in', async () => {
    installFakeHub();

    const id = await service.importDataset({ repoId: REPO });
    expect(id).toBe(DATASET_ID);

    // The row points at the directory, absolutely — which is the test
    // `isLocalDataset` and `openDatasetTree` both already apply, so validation,
    // the episodes route and the frames route light up with no further work.
    const created = vi.mocked(datasetRepository.create).mock.calls[0]![0];
    expect(created.storagePath).toBe(`${join(root, STORAGE_ID)}/`);

    await settle(() => {
      expect(datasetRepository.update).toHaveBeenCalledWith(
        DATASET_ID, expect.objectContaining({ status: 'validating' }),
      );
    });

    // At their repo-relative paths, so what is on disk IS a LeRobot dataset.
    expect(await exists('meta', 'info.json')).toBe(true);
    expect(await exists('meta', 'episodes', 'chunk-000', 'file-000.parquet')).toBe(true);
    expect(await exists('data', 'chunk-000', 'file-000.parquet')).toBe(true);
    expect(JSON.parse(await readFile(join(root, STORAGE_ID, 'meta', 'info.json'), 'utf8')))
      .toMatchObject({ robot_type: 'unitree_g1' });

    // Never marked failed, and validation was pointed at the tree.
    expect(datasetRepository.update).not.toHaveBeenCalledWith(
      DATASET_ID, expect.objectContaining({ status: 'failed' }),
    );
    expect(datasetService.validateAndUpdateDataset)
      .toHaveBeenCalledWith(DATASET_ID, `${join(root, STORAGE_ID)}/`);
  });

  it('takes no video for the default metadata-only import, and does for a full one', async () => {
    installFakeHub();
    await service.importDataset({ repoId: REPO });
    await settle(() => {
      expect(datasetRepository.update).toHaveBeenCalledWith(
        DATASET_ID, expect.objectContaining({ status: 'validating' }),
      );
    });
    expect(vi.mocked(datasetRepository.create).mock.calls[0]![0].importMode).toBe('metadata');
    expect(await exists('videos')).toBe(false);

    vi.clearAllMocks();
    vi.mocked(datasetRepository.create).mockResolvedValue({ id: DATASET_ID } as never);
    vi.mocked(robotTypeRepository.findAll).mockResolvedValue([]);
    vi.mocked(robotTypeRepository.create).mockResolvedValue({ id: 'rt-new' } as never);
    await service.importDataset({ repoId: REPO, includeVideos: true });
    await settle(() => {
      expect(datasetRepository.update).toHaveBeenCalledWith(
        DATASET_ID, expect.objectContaining({ status: 'validating' }),
      );
    });
    expect(vi.mocked(datasetRepository.create).mock.calls[0]![0].importMode).toBe('full');
    expect(await exists('videos', 'observation.images.ego_view', 'chunk-000', 'file-000.mp4'))
      .toBe(true);
  });
});

// ============================================================================
// 3 — THE FAILURE REASON IS UNRECOVERABLE
// ============================================================================

describe('when an import fails', () => {
  it('writes the reason on the row, not only into a broadcast nobody heard', async () => {
    installFakeHub();
    brokenPaths.set('data/chunk-000/file-000.parquet', 500);

    await service.importDataset({ repoId: REPO });

    await settle(() => {
      expect(datasetRepository.update).toHaveBeenCalledWith(
        DATASET_ID,
        expect.objectContaining({
          status: 'failed',
          importError: expect.objectContaining({
            phase: 'downloading',
            repoId: REPO,
            error: expect.stringContaining('500'),
          }),
        }),
      );
    });

    const failure = vi.mocked(datasetRepository.update).mock.calls
      .map(([, input]) => (input as { importError?: { failedAt?: string } }).importError)
      .find(Boolean)!;
    expect(new Date(failure.failedAt!).toString()).not.toBe('Invalid Date');
  });
});

describe('whole-file transfer retries', () => {
  const path = 'data/chunk-000/file-000.parquet';

  function failFileOnce(first: () => Response | Promise<Response>): void {
    installFakeHub();
    const fetchSpy = vi.mocked(globalThis.fetch);
    const hub = fetchSpy.getMockImplementation()!;
    let failed = false;
    fetchSpy.mockImplementation(async (input, init) => {
      if (String(input).endsWith(path) && !failed) {
        failed = true;
        return first();
      }
      return hub(input, init);
    });
  }

  async function importSuccessfully(): Promise<void> {
    await service.importDataset({ repoId: REPO });
    await settle(() => expect(datasetService.validateAndUpdateDataset).toHaveBeenCalled());
    expect(datasetRepository.update).not.toHaveBeenCalledWith(
      DATASET_ID, expect.objectContaining({ status: 'failed' }),
    );
    expect(await readFile(join(root, STORAGE_ID, path), 'utf8')).toBe(`bytes of ${path}`);
  }

  it('refetches after a download connection reset', async () => {
    failFileOnce(() => { throw new TypeError('fetch failed', { cause: Object.assign(new Error(), { code: 'ECONNRESET' }) }); });
    await importSuccessfully();
  });

  it('replaces a partially written file after an interrupted body', async () => {
    failFileOnce(() => new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode('partial')); },
      pull(controller) { controller.error(Object.assign(new Error('terminated'), { code: 'UND_ERR_SOCKET' })); },
    })));
    await importSuccessfully();
    const { readdir } = await import('fs/promises');
    expect((await readdir(join(root, STORAGE_ID, 'data/chunk-000'))).some((p) => p.endsWith('.partial'))).toBe(false);
  });

  it('retries a 503 with a fresh response body', async () => {
    failFileOnce(() => new Response('unavailable', { status: 503, headers: { 'retry-after': '0' } }));
    await importSuccessfully();
  });

  it('refetches the same object after a transient RustFS write failure', async () => {
    installFakeHub();
    vi.mocked(isRustFSInitialized).mockReturnValue(true);
    const writes: { key: string; body: string }[] = [];
    let failed = false;
    vi.mocked(getRustFSClient).mockReturnValue({ upload: vi.fn(async (_bucket, key, stream) => {
      let body = '';
      for await (const chunk of stream) body += chunk.toString();
      writes.push({ key, body });
      if (key.endsWith(path) && !failed) {
        failed = true;
        throw Object.assign(new Error('secret access key must not escape'), { name: 'ServiceUnavailable', $metadata: { httpStatusCode: 503 } });
      }
    }) } as never);
    await service.importDataset({ repoId: REPO });
    await settle(() => expect(datasetService.validateAndUpdateDataset).toHaveBeenCalled());
    const attempts = writes.filter((w) => w.key.endsWith(path));
    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toEqual(attempts[1]);
    expect(datasetRepository.update).not.toHaveBeenCalledWith(DATASET_ID, expect.objectContaining({ status: 'failed' }));
  });

  it.each([403, 404])('does not retry permanent HTTP %s errors', async (status) => {
    installFakeHub();
    brokenPaths.set(path, status);
    await service.importDataset({ repoId: REPO });
    await settle(() => expect(datasetRepository.update).toHaveBeenCalledWith(DATASET_ID, expect.objectContaining({
      status: 'failed', importError: expect.objectContaining({ file: path, transferStage: 'fetch', attempts: 1, httpStatus: status }),
    })));
    expect(requested.filter((u) => u.endsWith(path))).toHaveLength(1);
  });

  it('records filename, sink, stage and nested cause after bounded retries', async () => {
    installFakeHub();
    const fetchSpy = vi.mocked(globalThis.fetch);
    const hub = fetchSpy.getMockImplementation()!;
    let attempts = 0;
    fetchSpy.mockImplementation(async (input, init) => {
      if (String(input).endsWith(path)) {
        attempts++;
        throw new TypeError('fetch failed', { cause: Object.assign(new Error('private signed URL'), { code: 'ECONNRESET' }) });
      }
      return hub(input, init);
    });
    await service.importDataset({ repoId: REPO });
    await settle(() => expect(datasetRepository.update).toHaveBeenCalledWith(DATASET_ID, expect.objectContaining({
      status: 'failed', importError: expect.objectContaining({
        file: path, transferStage: 'fetch', sink: 'local', attempts: 6, cause: 'TypeError <- Error/ECONNRESET',
      }),
    })));
    expect(attempts).toBe(6);
    expect(JSON.stringify(vi.mocked(datasetRepository.update).mock.calls)).not.toContain('private signed URL');
  });
});

// ============================================================================
// One failure stops all five downloaders
//
// `Promise.all` REJECTS on the first throw, but it does not cancel the other
// four workers — they went on shifting files off the shared queue and writing
// them into a dataset `runImport` had already marked `failed`, and went on
// broadcasting `status: 'importing'`, which flipped the operator's card back
// from Failed to Importing mid-failure. The observable that pins it is how many
// files the Hub is asked for after the first one fails.
// ============================================================================

describe('a failed download', () => {
  /** 60 parquet files, so a queue that keeps draining is unmistakable. */
  const BIG_TREE = [
    { type: 'file', path: 'meta/info.json', size: 2261 },
    ...Array.from({ length: 60 }, (_, i) => ({
      type: 'file',
      path: `data/chunk-000/file-${String(i).padStart(3, '0')}.parquet`,
      size: 1000,
    })),
  ];

  it('stops the other four workers instead of filling a failed dataset', async () => {
    installFakeHub({ tree: BIG_TREE });
    // The first file off the queue fails; 59 remain behind it.
    brokenPaths.set('data/chunk-000/file-000.parquet', 500);

    await service.importDataset({ repoId: REPO });

    await settle(() => {
      expect(datasetRepository.update).toHaveBeenCalledWith(
        DATASET_ID,
        expect.objectContaining({ status: 'failed' }),
      );
    });

    // Give any worker that ignored the failure time to keep going.
    await new Promise((r) => setTimeout(r, 150));

    const downloaded = requested.filter((u) => /\/resolve\/.*\.parquet$/.test(u));
    // Four workers are in flight when the fifth fails, so a handful of files
    // beyond the failing one is expected. Draining all 60 is not.
    expect(downloaded.length).toBeLessThan(15);
  });

  it('reports the download failure rather than swallowing it', async () => {
    installFakeHub({ tree: BIG_TREE });
    brokenPaths.set('data/chunk-000/file-000.parquet', 500);

    await service.importDataset({ repoId: REPO });

    // The error is recorded on a flag now rather than thrown out of a worker,
    // so the thing to prove is that it still reaches the row.
    await settle(() => {
      expect(datasetRepository.update).toHaveBeenCalledWith(
        DATASET_ID,
        expect.objectContaining({
          status: 'failed',
          importError: expect.objectContaining({ error: expect.stringContaining('500') }),
        }),
      );
    });
  });
});

// ============================================================================
// The validation job a retry queues must not be deduplicated away
//
// JetStream drops a publish whose `msgID` it has already seen inside the dedup
// window — silently, with an ack. `validate-${datasetId}` is the same string on
// every attempt, so the SECOND validation ever queued for a dataset vanished:
// no error here, no consumer there, and the row sits at `validating` for ever.
// `retryImport` then refuses a `validating` row with IN_PROGRESS, so the
// dataset is wedged with no way out through the UI.
// ============================================================================

describe('the queued validation job', () => {
  it('carries a fresh msgID per attempt, so a retry is not swallowed as a duplicate', async () => {
    const publish = vi.fn().mockResolvedValue(undefined);
    vi.mocked(natsClient.isConnected).mockReturnValue(true);
    vi.mocked(natsClient.getJetStream).mockReturnValue({ publish } as never);
    installFakeHub();

    // The module-wide uuid mock is a constant (it fixes the storage directory
    // for every other test here). For this one it has to actually vary, because
    // what is under test is that two attempts produce two ids.
    let n = 0;
    vi.mocked(uuidv4).mockImplementation((() => `uuid-${++n}`) as never);

    await service.importDataset({ repoId: REPO });
    await settle(() => expect(publish).toHaveBeenCalledTimes(1));

    // Second attempt at the same dataset — the case the dedup window ate.
    await service.importDataset({ repoId: REPO });
    await settle(() => expect(publish).toHaveBeenCalledTimes(2));

    vi.mocked(uuidv4).mockImplementation((() => STORAGE_ID) as never);

    const ids = publish.mock.calls.map(([, , opts]) => (opts as { msgID: string }).msgID);
    expect(ids[0]).not.toBe(ids[1]);
    expect(ids[0]).toContain(DATASET_ID);
  });
});

// ============================================================================
// 4 — THE REVISION IS A MOVING POINTER
// ============================================================================

describe('the source commit', () => {
  it('is resolved once and used for every request, info.json included', async () => {
    installFakeHub();
    await service.importDataset({ repoId: REPO });
    await settle(() => {
      expect(datasetRepository.update).toHaveBeenCalledWith(
        DATASET_ID, expect.objectContaining({ status: 'validating' }),
      );
    });

    expect(vi.mocked(datasetRepository.create).mock.calls[0]![0].sourceRevision).toBe(SHA);

    // The point: not one file, and not the manifest, was fetched off the
    // branch. An import that reads info.json at `main` and the parquets at a
    // SHA is an import that can straddle two commits and say nothing.
    const resolves = requested.filter((u) => u.includes('/resolve/'));
    expect(resolves.length).toBeGreaterThan(0);
    expect(resolves.every((u) => u.includes(`/resolve/${SHA}/`))).toBe(true);
    expect(requested.some((u) => u.includes('/resolve/main/'))).toBe(false);
    expect(requested.some((u) => u.includes(`/tree/${SHA}`))).toBe(true);
  });

  it('refuses the import rather than silently recording a branch name', async () => {
    installFakeHub({ revisionStatus: 500 });
    await expect(service.importDataset({ repoId: REPO })).rejects.toThrow(HuggingFaceImportError);
    expect(datasetRepository.create).not.toHaveBeenCalled();
  });

  it('reports a repo that is not there as not there', async () => {
    installFakeHub({ revisionStatus: 404 });
    await expect(service.importDataset({ repoId: 'nobody/nothing' }))
      .rejects.toMatchObject({ code: 'REPO_NOT_FOUND', status: 404 });
  });

  it('reads the Hub\'s 401 for a repo that does not exist as 404, not as our fault', async () => {
    // Measured live: `GET /api/datasets/nobody/definitely-not-a-repo/revision/main`
    // answers 401, not 404 — the Hub will not confirm the existence of
    // something you cannot read. Reported as REPO_UNREACHABLE/502 that blamed
    // this server for the operator's typo, and broke the contract's "404 when
    // the repo is absent".
    for (const status of [401, 403]) {
      installFakeHub({ revisionStatus: status });
      await expect(service.previewRepo('nobody/nothing'))
        .rejects.toMatchObject({ code: 'REPO_NOT_FOUND', status: 404 });
      vi.restoreAllMocks();
    }
  });
});

// ============================================================================
// 5 — THE ROBOT TYPE MATCH AND THE 0-DOF ROW
// ============================================================================

function robotType(name: string, model: string, dims = 0): RobotType {
  return {
    id: `rt-${name}`, name, manufacturer: 'Unitree', model,
    actionDim: dims, proprioceptionDim: dims,
    cameras: [], capabilities: [], limits: {} as never,
    createdAt: new Date(), updatedAt: new Date(),
  } as unknown as RobotType;
}

describe('matching a Hub robot_type to a registered robot type', () => {
  it('finds the G1 row this database actually holds', () => {
    // The old table looked up the literal display name 'Unitree G1 + Dex3',
    // which has never been in this database — so every G1 dataset missed and
    // minted a junk type instead.
    const rows = [robotType('Unitree G1 EDU (Dex3-1)', 'Unitree G1 EDU (Dex3-1)', 43)];
    expect(matchRobotType(rows, 'unitree_g1')?.id).toBe('rt-Unitree G1 EDU (Dex3-1)');
    expect(matchRobotType(rows, 'Unitree_G1')?.id).toBe('rt-Unitree G1 EDU (Dex3-1)');
    expect(matchRobotType(rows, 'g1_dex3')?.id).toBe('rt-Unitree G1 EDU (Dex3-1)');
  });

  it('matches on the model column too, so a renamed row still resolves', () => {
    const rows = [robotType('Lab arm #3', 'SO-ARM100', 6)];
    expect(matchRobotType(rows, 'so100_follower')?.id).toBe('rt-Lab arm #3');
  });

  it('does not match a robot it has no row for', () => {
    expect(matchRobotType([robotType('ALOHA', 'ALOHA', 14)], 'stretch3')).toBeNull();
  });
});

describe('minting a robot type', () => {
  it('keeps the compatible 28-wide Unitree type', async () => {
    const info = { ...INFO, features: { ...INFO.features,
      action: { dtype: 'float32', shape: [28] },
      'observation.state': { dtype: 'float32', shape: [28] },
    } };
    installFakeHub({ info });
    const shared = robotType('Unitree_G1', 'Unitree_G1', 28);
    vi.mocked(robotTypeRepository.findAll).mockResolvedValue([shared]);
    await service.importDataset({ repoId: REPO });
    expect(datasetRepository.create).toHaveBeenCalledWith(expect.objectContaining({ robotTypeId: shared.id }));
    expect(robotTypeRepository.create).not.toHaveBeenCalled();
    await settle(() => expect(datasetService.validateAndUpdateDataset).toHaveBeenCalled());
  });
  it('creates a separate 43-wide type when the shared G1 type is 28-wide', async () => {
    installFakeHub();
    vi.mocked(robotTypeRepository.findAll).mockResolvedValue([robotType('Unitree_G1', 'Unitree_G1', 28)]);
    await service.importDataset({ repoId: REPO });
    expect(robotTypeRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      name: 'unitree_g1 (action 43, state 43)', actionDim: 43, proprioceptionDim: 43,
    }));
    await settle(() => expect(datasetService.validateAndUpdateDataset).toHaveBeenCalled());
  });

  it('refuses an explicit robot override with incompatible widths', async () => {
    installFakeHub();
    vi.mocked(robotTypeRepository.findById).mockResolvedValue(robotType('Unitree_G1', 'Unitree_G1', 28));
    await expect(service.importDataset({ repoId: REPO, robotTypeId: 'rt-28' }))
      .rejects.toMatchObject({ code: 'ROBOT_DIMENSION_MISMATCH' });
    expect(datasetRepository.create).not.toHaveBeenCalled();
  });
  it('takes the widths from info.json rather than writing zeros', async () => {
    installFakeHub();
    await service.importDataset({ repoId: REPO });

    // Both dims zero is what made the width check in validateDataset inert:
    // a 43-wide dataset on a 0-DOF robot type reported no mismatch at all.
    expect(robotTypeRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'unitree_g1', actionDim: 43, proprioceptionDim: 43 }),
    );
  });

  it('refuses rather than inventing a 0-DOF robot when info.json has no shapes', async () => {
    const shapeless: LeRobotInfoV3 = {
      ...INFO,
      features: { 'observation.images.ego_view': { dtype: 'video', shape: [480, 640, 3] } },
    };
    installFakeHub({ info: shapeless });

    await expect(service.importDataset({ repoId: REPO }))
      .rejects.toMatchObject({ code: 'UNKNOWN_ROBOT_DIMS' });
    expect(robotTypeRepository.create).not.toHaveBeenCalled();
    expect(datasetRepository.create).not.toHaveBeenCalled();
    // Storage is prepared before the robot type is resolved; a refusal there
    // takes the empty directory back out rather than leaving it behind.
    expect(await exists()).toBe(false);
  });
});

// ============================================================================
// PREVIEW — what the modal shows before anyone commits to a gigabyte
// ============================================================================

describe('previewRepo', () => {
  it('reports the repo, its size split by kind, and the commit — importing nothing', async () => {
    installFakeHub();
    const preview = await service.previewRepo(REPO, 'main');

    expect(preview).toMatchObject({
      repoId: REPO,
      revision: 'main',
      resolvedRevision: SHA,
      lerobotVersion: 'v2.1',
      robotType: 'unitree_g1',
      fps: 30,
      totalEpisodes: 2,
      totalFrames: 60,
      stateWidth: 43,
      actionWidth: 43,
      cameraKeys: ['observation.images.ego_view'],
      license: 'cc-by-4.0',
    });

    // The sizes the import used to parse and throw away. Repo furniture
    // (README, .gitattributes) is excluded from all three numbers so they
    // describe the same set of files — the ones a download would cost.
    expect(preview.videoBytes).toBe(6_890_970);
    expect(preview.dataBytes).toBe(2261 + 4371 + 106_584 + 674_393);
    expect(preview.fileCount).toBe(5);

    // Nothing was written anywhere.
    expect(datasetRepository.create).not.toHaveBeenCalled();
    expect(await exists('meta', 'info.json')).toBe(false);
  });

  it('is a 404-shaped refusal for a repo with no info.json', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/revision/')) return json({ sha: SHA });
      return new Response('Not Found', { status: 404, statusText: 'Not Found' });
    });
    await expect(service.previewRepo('someone/not-lerobot'))
      .rejects.toMatchObject({ code: 'INFO_NOT_FOUND' });
  });
});

describe('selectRepoFiles', () => {
  it('takes the dataset and leaves the repo furniture', () => {
    expect(selectRepoFiles(TREE as never, false).map((f) => f.path)).toEqual([
      'meta/info.json',
      'meta/stats.json',
      'meta/episodes/chunk-000/file-000.parquet',
      'data/chunk-000/file-000.parquet',
    ]);
  });
});

// ============================================================================
// RETRY
// ============================================================================

describe('retryImport', () => {
  const failedRow = {
    id: DATASET_ID,
    status: 'failed',
    huggingFaceRepoId: REPO,
    sourceRevision: SHA,
    importMode: 'metadata',
    storagePath: `${join(tmpdir(), 'ignored', STORAGE_ID)}/`,
  };

  it('repairs an old 28-wide association without changing the shared type', async () => {
    installFakeHub();
    const shared = robotType('Unitree_G1', 'Unitree_G1', 28);
    const compatible = robotType('Unitree G1 43', 'Unitree_G1', 43);
    vi.mocked(datasetRepository.findById).mockResolvedValue({ ...failedRow, robotTypeId: shared.id } as never);
    vi.mocked(robotTypeRepository.findById).mockResolvedValue(shared);
    vi.mocked(robotTypeRepository.findAll).mockResolvedValue([shared, compatible]);
    await service.retryImport(DATASET_ID);
    expect(datasetRepository.update).toHaveBeenCalledWith(DATASET_ID, expect.objectContaining({ robotTypeId: compatible.id, sourceRevision: SHA }));
    expect(shared.actionDim).toBe(28);
    expect(robotTypeRepository.create).not.toHaveBeenCalled();
    await settle(() => expect(datasetService.validateAndUpdateDataset).toHaveBeenCalled());
  });

  it('re-runs at the commit the row already pinned and clears the old failure', async () => {
    installFakeHub();
    vi.mocked(datasetRepository.findById).mockResolvedValue(failedRow as never);

    await expect(service.retryImport(DATASET_ID))
      .resolves.toEqual({ datasetId: DATASET_ID, status: 'importing' });

    // Two writes, in this order and for a reason: the row is CLAIMED
    // (`importing`, old reason cleared) before the Hub round-trips, so a second
    // retry arriving inside that window is refused; the commit and the
    // directory are written once they are known.
    expect(datasetRepository.update).toHaveBeenNthCalledWith(
      1,
      DATASET_ID,
      expect.objectContaining({
        status: 'importing',
        // A stale reason on a row that is trying again is a lie about the
        // row's current state.
        importError: null,
      }),
    );
    expect(datasetRepository.update).toHaveBeenCalledWith(
      DATASET_ID,
      expect.objectContaining({ status: 'importing', sourceRevision: SHA }),
    );
    // A retry cannot drift onto a newer commit. It may still ask the Hub about
    // the pinned commit — a row imported before `sourceLicense` existed has no
    // licence, and a retry is the only route it has to acquire one — but every
    // such request names the SHA, never a branch. That is the invariant; "no
    // request at all" was only ever a proxy for it.
    const revisionCalls = requested.filter((u) => u.includes('/revision/'));
    expect(revisionCalls.every((u) => u.includes(SHA))).toBe(true);
    expect(requested.some((u) => u.includes('/revision/main'))).toBe(false);

    // `retryImport` resolves once the row is CLAIMED and lets the download run
    // detached. Leaving here without waiting for it leaves that download writing
    // into the shared storage directory that the next test's `beforeEach`
    // deletes — an `ENOTEMPTY` from `rm` that lands on whichever test happened
    // to be next (TASK-218). `validating` is written after the last file.
    await settle(() =>
      expect(datasetRepository.update).toHaveBeenCalledWith(
        DATASET_ID,
        expect.objectContaining({ status: 'validating' }),
      ),
    );
  });

  it('refuses a dataset that did not come from the Hub, and one already running', async () => {
    vi.mocked(datasetRepository.findById).mockResolvedValue({
      ...failedRow, huggingFaceRepoId: undefined,
    } as never);
    await expect(service.retryImport(DATASET_ID)).rejects.toMatchObject({ code: 'NOT_AN_IMPORT' });

    vi.mocked(datasetRepository.findById).mockResolvedValue({
      ...failedRow, status: 'importing',
    } as never);
    await expect(service.retryImport(DATASET_ID)).rejects.toMatchObject({ code: 'IN_PROGRESS' });

    vi.mocked(datasetRepository.findById).mockResolvedValue(null);
    await expect(service.retryImport(DATASET_ID)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it("records the phase as 'metadata' when a retry cannot read the repo", async () => {
    // The phase is what tells the operator WHERE it broke, and 'downloading'
    // was the only value any test had ever seen. A retry that fails before a
    // byte is fetched must not claim it died downloading — and it must release
    // the claim it took, or the row is stuck at `importing` for ever with
    // nothing running.
    installFakeHub({ revisionStatus: 404 });
    vi.mocked(datasetRepository.findById).mockResolvedValue(failedRow as never);

    await expect(service.retryImport(DATASET_ID)).rejects.toThrow();

    expect(datasetRepository.update).toHaveBeenCalledWith(
      DATASET_ID,
      expect.objectContaining({
        status: 'failed',
        importError: expect.objectContaining({ phase: 'metadata', repoId: REPO }),
      }),
    );
  });
});
