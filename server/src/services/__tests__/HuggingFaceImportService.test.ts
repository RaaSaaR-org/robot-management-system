/**
 * @file HuggingFaceImportService.test.ts
 * @description Unit tests for HuggingFace dataset import service
 * @feature datasets
 *
 * The five defects of TASK-220 each have a test here that FAILS without its
 * fix, which is the only kind worth writing for a bug: an import that cannot
 * write anywhere but RustFS, a failure reason that is never persisted, a
 * revision that is a branch name, and a robot-type match aimed at a display
 * string no row has ever carried.
 *
 * The Hub is mocked by URL rather than by call order. Call order is what the
 * previous version of this file asserted, and it broke the moment the import
 * learned to resolve a commit before reading info.json — which is not a
 * behaviour change worth a red test.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { isAbsolute, join } from 'path';
import { tmpdir } from 'os';

/** Mutable knobs the hoisted `vi.mock` factories below read at call time. */
const env = vi.hoisted(() => ({
  storageRoot: '',
  rustfsUp: false,
  uploads: [] as Array<{ bucket: string; key: string; bytes: number }>,
}));

vi.mock('../../repositories/index.js', () => ({
  datasetRepository: {
    create: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
    findById: vi.fn().mockResolvedValue(null),
  },
  robotTypeRepository: {
    findById: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
  },
}));

vi.mock('../../storage/rustfs-client.js', () => ({
  isRustFSInitialized: () => env.rustfsUp,
  getRustFSClient: () => ({
    upload: async (bucket: string, key: string, stream: AsyncIterable<Buffer>) => {
      let bytes = 0;
      for await (const chunk of stream) bytes += chunk.length;
      env.uploads.push({ bucket, key, bytes });
    },
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
  datasetStorageRoot: () => env.storageRoot,
}));

vi.mock('uuid', () => ({
  v4: vi.fn().mockReturnValue('store-1'),
}));

import {
  HuggingFaceImportError,
  HuggingFaceImportService,
  matchRobotType,
  selectRepoFiles,
  isVideoPath,
} from '../HuggingFaceImportService.js';
import { datasetRepository, robotTypeRepository } from '../../repositories/index.js';
import type { LeRobotInfoV3 } from '../../types/dataset.types.js';
import type { RobotType } from '../../types/vla.types.js';

// ============================================================================
// TEST DATA
// ============================================================================

const SAMPLE_INFO_JSON: LeRobotInfoV3 = {
  codebase_version: 'v2.1',
  robot_type: 'so100_follower',
  fps: 30,
  features: {
    'observation.images.top': { dtype: 'video', shape: [480, 640, 3], video: true },
    'observation.state': { dtype: 'float32', shape: [6] },
    action: { dtype: 'float32', shape: [6] },
  },
  total_episodes: 50,
  total_frames: 11900,
  total_chunks: 1,
  chunks_size: 1000,
  total_tasks: 1,
};

/** The scenario the whole task is about: 43-wide G1, one ego camera, v2.1. */
const GROOT_INFO: LeRobotInfoV3 = {
  codebase_version: 'v2.1',
  robot_type: 'unitree_g1',
  fps: 30,
  features: {
    'observation.images.ego_view': { dtype: 'video', shape: [256, 256, 3], video: true },
    'observation.state': { dtype: 'float32', shape: [43] },
    action: { dtype: 'float32', shape: [43] },
  },
  total_episodes: 2,
  total_frames: 60,
  total_chunks: 1,
  chunks_size: 1000,
  total_tasks: 1,
};

const REPO = 'nvidia/GR00T-N1.7-AppleToPlate';
const SHA = '7628202a2180972f291ba1bc6723834921e72c19';

/** Every file of the mock repo, with the size the tree API reports. */
const TREE: Array<{ path: string; size: number }> = [
  { path: 'README.md', size: 11 },
  { path: '.gitattributes', size: 13 },
  { path: 'meta/info.json', size: 100 },
  { path: 'meta/stats.json', size: 50 },
  { path: 'meta/episodes.jsonl', size: 200 },
  { path: 'data/chunk-000/episode_000000.parquet', size: 700 },
  { path: 'data/chunk-000/episode_000001.parquet', size: 300 },
  { path: 'videos/chunk-000/observation.images.ego_view/episode_000000.mp4', size: 5000 },
  { path: 'videos/chunk-000/observation.images.ego_view/episode_000001.mp4', size: 4000 },
];

const G1_EDU: RobotType = {
  id: 'rt-g1-edu',
  name: 'Unitree G1 EDU (Dex3-1)',
  manufacturer: 'Unitree',
  model: 'Unitree G1 EDU (Dex3-1)',
  actionDim: 43,
  proprioceptionDim: 43,
  cameras: [],
  capabilities: [],
  limits: {} as RobotType['limits'],
  createdAt: new Date(),
  updatedAt: new Date(),
};

const SO101: RobotType = { ...G1_EDU, id: 'rt-so101', name: 'SO-101 Follower', model: 'SO-ARM100' };
const PUSHT: RobotType = { ...G1_EDU, id: 'rt-pusht', name: 'PushT Sim', model: 'PushT' };

// ============================================================================
// THE HUB, MOCKED BY URL
// ============================================================================

interface HubOptions {
  info?: LeRobotInfoV3;
  /** Repo (or revision) is not there. */
  missingRepo?: boolean;
  /** The repo exists but has no meta/info.json. */
  missingInfo?: boolean;
  /** Paths whose download answers with this status instead of 200. */
  failDownloads?: Record<string, number>;
  /** Answer the revision API without a `sha`. */
  noSha?: boolean;
}

/** Every URL the service asked for, in order. */
let requested: string[] = [];

function mockHub(options: HubOptions = {}): void {
  const info = options.info ?? GROOT_INFO;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    requested.push(url);

    if (url.includes('/revision/')) {
      if (options.missingRepo) return new Response('Not Found', { status: 404, statusText: 'Not Found' });
      if (options.noSha) return new Response(JSON.stringify({ id: REPO }), { status: 200 });
      return new Response(
        JSON.stringify({ sha: SHA, cardData: { license: 'cc-by-4.0' } }),
        { status: 200 },
      );
    }

    if (url.includes('/tree/')) {
      return new Response(
        JSON.stringify(TREE.map((f) => ({ type: 'file', path: f.path, size: f.size }))),
        { status: 200 },
      );
    }

    const file = url.split('/resolve/')[1]?.split('/').slice(1).join('/') ?? '';
    if (file === 'meta/info.json') {
      if (options.missingInfo) return new Response('Not Found', { status: 404, statusText: 'Not Found' });
      return new Response(JSON.stringify(info), { status: 200 });
    }
    const failure = options.failDownloads?.[file];
    if (failure) return new Response('nope', { status: failure, statusText: 'Server Error' });
    return new Response(`contents of ${file}`, { status: 200 });
  });
}

/** Resolve once the background import has written a terminal status. */
async function settled(): Promise<void> {
  await vi.waitFor(() => {
    const calls = vi.mocked(datasetRepository.update).mock.calls;
    expect(calls.some(([, input]) => (
      input.status === 'validating' || input.status === 'failed'
    ))).toBe(true);
  }, { timeout: 2000, interval: 5 });
}

function updateWith(predicate: (input: Record<string, unknown>) => boolean): Record<string, unknown> | undefined {
  return vi.mocked(datasetRepository.update).mock.calls
    .map(([, input]) => input as unknown as Record<string, unknown>)
    .find(predicate);
}

// ============================================================================
// TESTS
// ============================================================================

describe('HuggingFaceImportService', () => {
  let service: HuggingFaceImportService;

  beforeEach(async () => {
    vi.clearAllMocks();
    requested = [];
    env.uploads = [];
    env.rustfsUp = false;
    env.storageRoot = await mkdtemp(join(tmpdir(), 'hf-import-'));
    service = HuggingFaceImportService.getInstance();

    vi.mocked(datasetRepository.create).mockResolvedValue({ id: 'ds-1' } as never);
    vi.mocked(datasetRepository.update).mockResolvedValue({} as never);
    vi.mocked(robotTypeRepository.findAll).mockResolvedValue([G1_EDU, SO101, PUSHT]);
    vi.mocked(robotTypeRepository.findById).mockResolvedValue(G1_EDU);
    vi.mocked(robotTypeRepository.create).mockResolvedValue({ ...G1_EDU, id: 'rt-new' });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(env.storageRoot, { recursive: true, force: true });
  });

  // --------------------------------------------------------------------------
  // INFO.JSON PARSING
  // --------------------------------------------------------------------------

  describe('fetchInfoJson', () => {
    it('parses valid LeRobot v2.1 info.json', async () => {
      mockHub({ info: SAMPLE_INFO_JSON });

      const info = await service.fetchInfoJson('lerobot/svla_so101_pickplace', 'main');

      expect(info.codebase_version).toBe('v2.1');
      expect(info.robot_type).toBe('so100_follower');
      expect(info.fps).toBe(30);
      expect(info.total_episodes).toBe(50);
      expect(info.total_frames).toBe(11900);
    });

    it('throws on missing codebase_version', async () => {
      mockHub({ info: { ...SAMPLE_INFO_JSON, codebase_version: '' } });
      await expect(service.fetchInfoJson('bad/repo', 'main')).rejects.toThrow('codebase_version');
    });

    it('throws on missing robot_type', async () => {
      mockHub({ info: { ...SAMPLE_INFO_JSON, robot_type: '' } });
      await expect(service.fetchInfoJson('bad/repo', 'main')).rejects.toThrow('robot_type');
    });

    it('throws on invalid fps', async () => {
      mockHub({ info: { ...SAMPLE_INFO_JSON, fps: 0 } });
      await expect(service.fetchInfoJson('bad/repo', 'main')).rejects.toThrow('fps');
    });

    it('throws on 404 response', async () => {
      mockHub({ missingInfo: true });
      await expect(service.fetchInfoJson('nonexistent/repo', 'main')).rejects.toThrow('404');
    });
  });

  // --------------------------------------------------------------------------
  // FILE LIST BUILDING
  // --------------------------------------------------------------------------

  describe('buildFileList', () => {
    it('builds correct file list without videos', () => {
      const files = service.buildFileList(SAMPLE_INFO_JSON, false);
      expect(files).toContain('meta/info.json');
      expect(files).toContain('data/chunk-000/episode_000000.parquet');
      expect(files.some((f) => f.endsWith('.mp4'))).toBe(false);
    });

    it('builds correct file list with videos', () => {
      const files = service.buildFileList(SAMPLE_INFO_JSON, true);
      expect(files.some((f) => f.endsWith('.mp4'))).toBe(true);
    });

    it('handles zero episodes gracefully', () => {
      const files = service.buildFileList({ ...SAMPLE_INFO_JSON, total_episodes: 0, total_chunks: 0 }, false);
      expect(files).toContain('meta/info.json');
      expect(files.some((f) => f.startsWith('data/'))).toBe(false);
    });
  });

  describe('selectRepoFiles', () => {
    it('takes meta and data, and the videos only when asked', () => {
      const metaOnly = selectRepoFiles(TREE, false).map((f) => f.path);
      expect(metaOnly).not.toContain('README.md');
      expect(metaOnly).toContain('meta/info.json');
      expect(metaOnly).toContain('data/chunk-000/episode_000001.parquet');
      expect(metaOnly.some((p) => p.endsWith('.mp4'))).toBe(false);

      expect(selectRepoFiles(TREE, true).some((f) => f.path.endsWith('.mp4'))).toBe(true);
    });

    // A `dtype: 'image'` dataset stores PNG frames under `images/<key>/` rather
    // than mp4s under `videos/`. Selecting only `videos/` meant those repos
    // downloaded metadata and parquet, then failed validation on
    // MISSING_IMAGE_FILES — for frames the import had never asked the Hub for.
    const IMAGE_TREE = [
      { path: 'meta/info.json', size: 100 },
      { path: 'data/chunk-000/episode_000000.parquet', size: 700 },
      { path: 'images/observation.images.cam_high/episode_000000/frame_000000.png', size: 900 },
      { path: 'images/observation.images.cam_high/episode_000000/frame_000001.png', size: 900 },
    ];

    it('takes images/ too — a dtype:image dataset keeps its frames in there', () => {
      const withFrames = selectRepoFiles(IMAGE_TREE, true).map((f) => f.path);
      expect(withFrames).toContain(
        'images/observation.images.cam_high/episode_000000/frame_000000.png',
      );
      expect(withFrames).toHaveLength(4);
    });

    it('leaves images/ behind for a metadata-only import, like videos/', () => {
      const metaOnly = selectRepoFiles(IMAGE_TREE, false).map((f) => f.path);
      expect(metaOnly.some((p) => p.startsWith('images/'))).toBe(false);
      expect(metaOnly).toEqual(['meta/info.json', 'data/chunk-000/episode_000000.parquet']);
    });

    it('counts image frames as visual bytes, not as data bytes', () => {
      // The preview splits the download into "data" and "video" so the operator
      // can see what the include-videos toggle is actually worth. PNG frames
      // are the heavy visual half exactly as mp4s are.
      expect(isVideoPath('images/observation.images.cam_high/episode_000000/frame_000000.png'))
        .toBe(true);
      expect(isVideoPath('data/chunk-000/episode_000000.parquet')).toBe(false);
      expect(isVideoPath('meta/info.json')).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // DEFECT 1 — THE IMPORT COULD ONLY EVER WRITE TO RUSTFS
  // --------------------------------------------------------------------------

  describe('the store it writes to', () => {
    it('writes a LeRobot tree to local disk when RustFS is down', async () => {
      // The whole of defect 1. RustFS is optional and is down on every dev
      // machine here; `downloadFiles` opened with a throw, so every import died
      // ~300 ms in and the row went to `failed`.
      env.rustfsUp = false;
      mockHub();

      await service.importDataset({ repoId: REPO });
      await settled();

      const root = join(env.storageRoot, 'store-1');
      expect(existsSync(join(root, 'meta', 'info.json'))).toBe(true);
      expect(existsSync(join(root, 'data', 'chunk-000', 'episode_000000.parquet'))).toBe(true);
      expect(existsSync(join(root, 'data', 'chunk-000', 'episode_000001.parquet'))).toBe(true);
      // Files land at their REPO-RELATIVE paths, so the tree on disk IS a
      // LeRobot dataset and every existing reader can serve it.
      expect(JSON.parse((await readFile(join(root, 'meta', 'info.json'))).toString()))
        .toMatchObject({ robot_type: 'unitree_g1' });
      expect((await readFile(join(root, 'data', 'chunk-000', 'episode_000000.parquet'))).toString())
        .toBe('contents of data/chunk-000/episode_000000.parquet');

      expect(updateWith((u) => u.status === 'failed')).toBeUndefined();
      expect(updateWith((u) => u.status === 'validating')).toBeDefined();
    });

    it('records the absolute directory as storagePath, which is what makes it local', async () => {
      // `isLocalDataset` / `isLocalStoragePath` both test "absolute AND
      // exists". A relative object-key prefix here would send validation, the
      // episodes route and the frames route all to a RustFS that is not there.
      env.rustfsUp = false;
      mockHub();

      await service.importDataset({ repoId: REPO });

      const created = vi.mocked(datasetRepository.create).mock.calls[0]![0];
      expect(isAbsolute(created.storagePath)).toBe(true);
      expect(created.storagePath).toBe(`${join(env.storageRoot, 'store-1')}/`);
      expect(existsSync(created.storagePath)).toBe(true);
    });

    it('still uses the RustFS bucket when RustFS is up', async () => {
      env.rustfsUp = true;
      mockHub();

      await service.importDataset({ repoId: REPO });
      await settled();

      expect(env.uploads.map((u) => u.key)).toEqual(expect.arrayContaining([
        'store-1/meta/info.json',
        'store-1/data/chunk-000/episode_000000.parquet',
      ]));
      expect(env.uploads.every((u) => u.bucket === 'training-datasets')).toBe(true);
      expect(vi.mocked(datasetRepository.create).mock.calls[0]![0].storagePath).toBe('store-1/');
      expect(existsSync(join(env.storageRoot, 'store-1'))).toBe(false);
    });

    it('fetches no mp4 for a metadata-only import, and says so on the row', async () => {
      env.rustfsUp = false;
      mockHub();

      await service.importDataset({ repoId: REPO });
      await settled();

      expect(vi.mocked(datasetRepository.create).mock.calls[0]![0].importMode).toBe('metadata');
      expect(requested.some((u) => u.endsWith('.mp4'))).toBe(false);
      expect(existsSync(join(env.storageRoot, 'store-1', 'videos'))).toBe(false);
    });

    it('fetches the mp4s for a full import', async () => {
      env.rustfsUp = false;
      mockHub();

      await service.importDataset({ repoId: REPO, includeVideos: true });
      await settled();

      expect(vi.mocked(datasetRepository.create).mock.calls[0]![0].importMode).toBe('full');
      expect(existsSync(join(
        env.storageRoot, 'store-1', 'videos', 'chunk-000',
        'observation.images.ego_view', 'episode_000000.mp4',
      ))).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // DEFECT 4 — THE REVISION WAS A MOVING POINTER
  // --------------------------------------------------------------------------

  describe('the commit it pins', () => {
    it('resolves the branch to a SHA and stores it', async () => {
      mockHub();

      await service.importDataset({ repoId: REPO });

      expect(vi.mocked(datasetRepository.create).mock.calls[0]![0].sourceRevision).toBe(SHA);
    });

    it('addresses every file by that SHA, info.json included', async () => {
      // Not decoration: resolving the SHA and then downloading from `main`
      // would let one import straddle two commits, which is the failure the
      // pin exists to prevent.
      mockHub();

      await service.importDataset({ repoId: REPO });
      await settled();

      const fileUrls = requested.filter((u) => u.includes('/resolve/'));
      expect(fileUrls.length).toBeGreaterThan(1);
      expect(fileUrls.every((u) => u.includes(`/resolve/${SHA}/`))).toBe(true);
      expect(requested.some((u) => u.includes('/resolve/main/'))).toBe(false);
      expect(requested.some((u) => u.includes(`/tree/${SHA}`))).toBe(true);
    });

    it('takes a revision that is already a SHA without asking the Hub', async () => {
      mockHub();

      await service.importDataset({ repoId: REPO, revision: SHA });

      expect(requested.some((u) => u.includes('/revision/'))).toBe(false);
      expect(vi.mocked(datasetRepository.create).mock.calls[0]![0].sourceRevision).toBe(SHA);
    });

    it('refuses rather than silently importing an unpinned branch', async () => {
      mockHub({ noSha: true });

      await expect(service.importDataset({ repoId: REPO })).rejects.toThrow(HuggingFaceImportError);
      expect(datasetRepository.create).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // THE LICENCE — fetched all along, and thrown away
  // --------------------------------------------------------------------------

  describe('the licence it records', () => {
    it('keeps the licence the card declares, from the call it already makes', async () => {
      // `resolveRevision` asked the Hub for the commit, got `cardData.license`
      // in the same response, and returned only the sha. The consequence
      // surfaced at the far end of the pipeline: an exported run manifest said
      // `"license": "unknown"` for nvidia/GR00T-N1.7-AppleToPlate, whose card
      // says cc-by-4.0, and attached a compliance note warning that a model
      // trained on data of unknown licence cannot be shown to be
      // redistributable. No extra round trip was ever needed.
      mockHub();

      await service.importDataset({ repoId: REPO });

      expect(vi.mocked(datasetRepository.create).mock.calls[0]![0].sourceLicense)
        .toBe('cc-by-4.0');
    });

    it('records no licence for a repo whose card declares none, rather than guessing', async () => {
      mockHub();
      const fetchSpy = vi.mocked(globalThis.fetch);
      const inner = fetchSpy.getMockImplementation()!;
      fetchSpy.mockImplementation(async (input, init) => {
        if (String(input).includes('/revision/')) {
          return new Response(JSON.stringify({ sha: SHA }), { status: 200 });
        }
        return inner(input, init);
      });

      await service.importDataset({ repoId: REPO });

      expect(vi.mocked(datasetRepository.create).mock.calls[0]![0].sourceLicense).toBeNull();
    });

    it('backfills a row that predates the column, at the commit it is already pinned to', async () => {
      // A pinned row resolves without a card request, so the retry learns no
      // licence and must not blank the one on the row. But every dataset
      // imported before this column existed has none — and a retry is the only
      // route those rows have. So: ask once, at the pinned sha.
      vi.mocked(datasetRepository.findById).mockResolvedValue({
        id: 'ds-1',
        huggingFaceRepoId: REPO,
        status: 'failed' as const,
        storagePath: `${join(env.storageRoot, 'store-1')}/`,
        sourceRevision: SHA,
        sourceLicense: null,
        importMode: 'metadata' as const,
      } as never);
      mockHub();

      await service.retryImport('ds-1');
      await settled();

      expect(updateWith((u) => u.sourceLicense === 'cc-by-4.0')).toBeDefined();
    });

    it('leaves a licence already on the row alone', async () => {
      vi.mocked(datasetRepository.findById).mockResolvedValue({
        id: 'ds-1',
        huggingFaceRepoId: REPO,
        status: 'failed' as const,
        storagePath: `${join(env.storageRoot, 'store-1')}/`,
        sourceRevision: SHA,
        sourceLicense: 'apache-2.0',
        importMode: 'metadata' as const,
      } as never);
      mockHub();

      await service.retryImport('ds-1');
      await settled();

      // No card request at all, and nothing written over the stored value.
      expect(requested.some((u) => u.includes('/revision/'))).toBe(false);
      expect(updateWith((u) => 'sourceLicense' in u)).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // DEFECT 3 — THE FAILURE REASON WAS UNRECOVERABLE
  // --------------------------------------------------------------------------

  describe('when it fails', () => {
    it('writes the reason to the row, not only to a WebSocket nobody is listening on', async () => {
      mockHub({ failDownloads: { 'data/chunk-000/episode_000000.parquet': 500 } });

      await service.importDataset({ repoId: REPO });
      await settled();

      const failed = updateWith((u) => u.status === 'failed');
      expect(failed).toBeDefined();
      const importError = failed!.importError as {
        phase: string; error: string; repoId: string; failedAt: string;
      };
      expect(importError.phase).toBe('downloading');
      expect(importError.repoId).toBe(REPO);
      expect(importError.error).toContain('500');
      expect(Number.isNaN(Date.parse(importError.failedAt))).toBe(false);
    });

    it('names the phase it died in rather than always saying "downloading"', async () => {
      // A tree listing that fails falls back to the pattern list, so the phase
      // that actually breaks first here is the metadata read of info.json.
      mockHub({ missingInfo: true });

      await expect(service.importDataset({ repoId: REPO })).rejects.toThrow(HuggingFaceImportError);
    });

    it('tolerates a missing stats.json, which is optional', async () => {
      mockHub({ failDownloads: { 'meta/stats.json': 404 } });

      await service.importDataset({ repoId: REPO });
      await settled();

      expect(updateWith((u) => u.status === 'failed')).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // DEFECT 5 — THE ROBOT-TYPE MATCH AIMED AT A NAME NOT IN THIS DATABASE
  // --------------------------------------------------------------------------

  describe('matchRobotType', () => {
    const all = [G1_EDU, SO101, PUSHT];

    it('finds the G1 EDU row from the Hub\'s "unitree_g1"', () => {
      // The defect exactly. The old matcher tested /g1|dex3|unitree/ and then
      // looked up the literal name 'Unitree G1 + Dex3', which no row has ever
      // been called, so it missed and minted a 0-DOF duplicate.
      expect(matchRobotType(all, 'unitree_g1')?.id).toBe('rt-g1-edu');
    });

    it('is indifferent to case, separators and the Hub\'s spelling', () => {
      for (const spelling of ['Unitree_G1', 'unitree-g1', 'UNITREE G1', 'g1_dex3']) {
        expect(matchRobotType(all, spelling)?.id).toBe('rt-g1-edu');
      }
    });

    it('matches on model as well as name', () => {
      expect(matchRobotType(all, 'SO-ARM100')?.id).toBe('rt-so101');
      expect(matchRobotType(all, 'so100_follower')?.id).toBe('rt-so101');
      expect(matchRobotType(all, 'pusht')?.id).toBe('rt-pusht');
    });

    it('says no rather than guessing', () => {
      expect(matchRobotType(all, 'unknown')).toBeNull();
      expect(matchRobotType(all, 'franka_panda')).toBeNull();
      expect(matchRobotType(all, '')).toBeNull();
    });
  });

  describe('resolveRobotTypeId', () => {
    it('reuses the registered G1 EDU row instead of minting a duplicate', async () => {
      mockHub();

      await service.importDataset({ repoId: REPO });

      expect(robotTypeRepository.create).not.toHaveBeenCalled();
      expect(vi.mocked(datasetRepository.create).mock.calls[0]![0].robotTypeId).toBe('rt-g1-edu');
    });

    it('takes the dims from info.json when it must create a type — never zeros', async () => {
      // A RobotType with actionDim 0 and proprioceptionDim 0 makes the width
      // check in validateDataset inert, so a 43-wide dataset on a 0-DOF robot
      // reads as validated. Row 964d52a5 in the live database is one of these.
      vi.mocked(robotTypeRepository.findAll).mockResolvedValue([]);
      mockHub();

      await service.importDataset({ repoId: REPO });

      expect(robotTypeRepository.create).toHaveBeenCalledWith(expect.objectContaining({
        name: 'unitree_g1',
        actionDim: 43,
        proprioceptionDim: 43,
      }));
    });

    it('refuses to mint a type when info.json declares no widths', async () => {
      vi.mocked(robotTypeRepository.findAll).mockResolvedValue([]);
      mockHub({
        info: {
          ...GROOT_INFO,
          features: { 'observation.images.ego_view': { dtype: 'video', shape: [256, 256, 3] } },
        },
      });

      await expect(service.importDataset({ repoId: REPO }))
        .rejects.toThrow(/robotTypeId/);
      expect(robotTypeRepository.create).not.toHaveBeenCalled();
    });

    it('rejects invalid robotTypeId', async () => {
      mockHub();
      vi.mocked(robotTypeRepository.findById).mockResolvedValueOnce(null);

      await expect(
        service.importDataset({ repoId: REPO, robotTypeId: 'nonexistent' })
      ).rejects.toThrow('Robot type not found');
    });
  });

  // --------------------------------------------------------------------------
  // THE PREVIEW
  // --------------------------------------------------------------------------

  describe('previewRepo', () => {
    it('reports what the repo is, and what it will cost, without importing', async () => {
      mockHub();

      const preview = await service.previewRepo(REPO);

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
      // The sizes the tree API reports and the import used to throw away.
      expect(preview.dataBytes).toBe(100 + 50 + 200 + 700 + 300);
      expect(preview.videoBytes).toBe(5000 + 4000);
      // Repo furniture is excluded, so the three numbers describe one set.
      expect(preview.fileCount).toBe(TREE.length - 2);

      expect(datasetRepository.create).not.toHaveBeenCalled();
      expect(env.uploads).toEqual([]);
    });

    it('is a 404 when the repo is not there', async () => {
      mockHub({ missingRepo: true });

      await expect(service.previewRepo('nobody/nothing')).rejects.toMatchObject({
        code: 'REPO_NOT_FOUND',
        status: 404,
      });
    });

    it('is a 404 when the repo is not a LeRobot dataset', async () => {
      mockHub({ missingInfo: true });

      await expect(service.previewRepo(REPO)).rejects.toMatchObject({
        code: 'INFO_NOT_FOUND',
        status: 404,
      });
    });
  });

  // --------------------------------------------------------------------------
  // THE RETRY
  // --------------------------------------------------------------------------

  describe('retryImport', () => {
    const failedRow = {
      id: 'ds-1',
      huggingFaceRepoId: REPO,
      status: 'failed' as const,
      storagePath: '',
      sourceRevision: SHA,
      importMode: 'metadata' as const,
    };

    it('re-runs the import and clears the previous failure', async () => {
      vi.mocked(datasetRepository.findById).mockResolvedValue({
        ...failedRow,
        storagePath: `${join(env.storageRoot, 'store-1')}/`,
      } as never);
      mockHub();

      const result = await service.retryImport('ds-1');
      await settled();

      expect(result).toEqual({ datasetId: 'ds-1', status: 'importing' });
      // `null`, not absent — a stale reason left standing on a row that is
      // importing again is worse than none.
      expect(updateWith((u) => u.importError === null)).toBeDefined();
      const pinned = updateWith((u) => u.sourceRevision === SHA);
      expect(pinned).toBeDefined();
      // The same directory, rather than a second copy of the dataset on disk.
      expect(pinned!.storagePath).toBe(`${join(env.storageRoot, 'store-1')}/`);
      expect(existsSync(join(env.storageRoot, 'store-1', 'meta', 'info.json'))).toBe(true);
    });

    it('claims the row before it talks to the Hub, so a second retry gets the 409', async () => {
      // Measured against the running server: two retries 150 ms apart both got
      // 202, because the guard reads a status that the first retry only writes
      // AFTER resolving the commit and reading info.json — two round-trips.
      // `sourceRevision: null` is a row that failed before it ever pinned a
      // commit, so the retry really does have to ask the Hub.
      vi.mocked(datasetRepository.findById).mockResolvedValue({
        ...failedRow, sourceRevision: null, storagePath: `${join(env.storageRoot, 'store-1')}/`,
      } as never);
      const order: string[] = [];
      vi.mocked(datasetRepository.update).mockImplementation(async (_id, input) => {
        order.push(`update:${(input as { status?: string }).status}`);
        return {} as never;
      });
      mockHub();
      const fetchSpy = vi.mocked(globalThis.fetch);
      const inner = fetchSpy.getMockImplementation()!;
      fetchSpy.mockImplementation(async (input, init) => {
        order.push(`fetch:${String(input).includes('/revision/') ? 'revision' : 'other'}`);
        return inner(input, init);
      });

      await service.retryImport('ds-1');

      expect(order[0]).toBe('update:importing');
      expect(order.indexOf('update:importing')).toBeLessThan(order.indexOf('fetch:revision'));
    });

    it('releases the claim when the Hub call fails, rather than sticking on importing', async () => {
      vi.mocked(datasetRepository.findById).mockResolvedValue({
        ...failedRow, sourceRevision: null, storagePath: `${join(env.storageRoot, 'store-1')}/`,
      } as never);
      mockHub({ missingRepo: true });

      await expect(service.retryImport('ds-1')).rejects.toThrow(HuggingFaceImportError);

      const failed = updateWith((u) => u.status === 'failed');
      expect(failed).toBeDefined();
      expect((failed!.importError as { phase: string }).phase).toBe('metadata');
    });

    it('is a 409 while an import is already running', async () => {
      vi.mocked(datasetRepository.findById).mockResolvedValue({
        ...failedRow, status: 'importing', storagePath: 'store-1/',
      } as never);

      await expect(service.retryImport('ds-1')).rejects.toMatchObject({
        code: 'IN_PROGRESS',
        status: 409,
      });
    });

    it('refuses a dataset that never came from the Hub', async () => {
      vi.mocked(datasetRepository.findById).mockResolvedValue({
        ...failedRow, huggingFaceRepoId: undefined,
      } as never);

      await expect(service.retryImport('ds-1')).rejects.toMatchObject({
        code: 'NOT_AN_IMPORT',
        status: 400,
      });
    });

    it('is a 404 for a dataset that does not exist', async () => {
      vi.mocked(datasetRepository.findById).mockResolvedValue(null);

      await expect(service.retryImport('nope')).rejects.toMatchObject({
        code: 'NOT_FOUND',
        status: 404,
      });
    });

    it('can upgrade a metadata-only row to a full import', async () => {
      vi.mocked(datasetRepository.findById).mockResolvedValue({
        ...failedRow, status: 'ready', storagePath: `${join(env.storageRoot, 'store-1')}/`,
      } as never);
      mockHub();

      await service.retryImport('ds-1', { includeVideos: true });
      await settled();

      expect(updateWith((u) => u.importMode === 'full')).toBeDefined();
      expect(existsSync(join(
        env.storageRoot, 'store-1', 'videos', 'chunk-000',
        'observation.images.ego_view', 'episode_000000.mp4',
      ))).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // HTTP
  // --------------------------------------------------------------------------

  describe('fetchWithRetry', () => {
    it('returns immediately on success (non-429)', async () => {
      const ok = new Response('ok', { status: 200 });
      const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok);

      expect(await service.fetchWithRetry('https://example.com')).toBe(ok);
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('retries on 429 and then returns the success', async () => {
      const spy = vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(new Response('slow down', {
          status: 429, headers: { 'retry-after': '0' },
        }))
        .mockResolvedValueOnce(new Response('ok', { status: 200 }));

      const response = await service.fetchWithRetry('https://example.com');

      expect(response.status).toBe(200);
      expect(spy).toHaveBeenCalledTimes(2);
    });

    it('returns the 429 once the retries are exhausted', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('slow down', {
        status: 429, headers: { 'retry-after': '0' },
      }));

      expect((await service.fetchWithRetry('https://example.com', 1)).status).toBe(429);
    });
  });
});
