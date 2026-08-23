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

function installFakeHub(options: { info?: LeRobotInfoV3; revisionStatus?: number } = {}): void {
  const info = options.info ?? INFO;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    requested.push(url);

    if (url.includes('/api/datasets/') && url.includes('/revision/')) {
      if (options.revisionStatus) return json({ error: 'nope' }, options.revisionStatus);
      return json({ sha: SHA, cardData: { license: 'cc-by-4.0' } });
    }
    if (url.includes('/api/datasets/') && url.includes('/tree/')) {
      return json(TREE);
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

  it('re-runs at the commit the row already pinned and clears the old failure', async () => {
    installFakeHub();
    vi.mocked(datasetRepository.findById).mockResolvedValue(failedRow as never);

    await expect(service.retryImport(DATASET_ID))
      .resolves.toEqual({ datasetId: DATASET_ID, status: 'importing' });

    expect(datasetRepository.update).toHaveBeenCalledWith(
      DATASET_ID,
      expect.objectContaining({
        status: 'importing',
        sourceRevision: SHA,
        // A stale reason on a row that is trying again is a lie about the
        // row's current state.
        importError: null,
      }),
    );
    // A SHA needs no resolving, so a retry cannot drift onto a newer commit.
    expect(requested.some((u) => u.includes('/revision/'))).toBe(false);
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
});
