/**
 * @file DatasetCurationService.test.ts
 * @description Unit tests for DatasetCurationService — local vs RustFS source
 *   resolution, revision-row registration, backend selection per LeRobot
 *   version, suggest wiring (videos skipped on download), and error paths.
 *   RustFS and curate.py are mocked; file plumbing uses real temp dirs.
 * @feature datasets
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs';
import os from 'os';
import path from 'path';

const { mockRepo, mockCuration, mockClient, mockDatasetService, rustfsState } = vi.hoisted(() => ({
  mockRepo: {
    findById: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
  },
  mockCuration: {
    deleteEpisodes: vi.fn(),
    trimEpisode: vi.fn(),
    suggest: vi.fn(),
  },
  mockClient: {
    listAll: vi.fn(),
    download: vi.fn(),
    putObject: vi.fn(),
  },
  mockDatasetService: {
    validateAndUpdateDataset: vi.fn(),
  },
  rustfsState: { initialized: true },
}));

vi.mock('../../repositories/index.js', () => ({
  datasetRepository: mockRepo,
}));

vi.mock('../../storage/rustfs-client.js', () => ({
  getRustFSClient: () => mockClient,
  isRustFSInitialized: () => rustfsState.initialized,
}));

vi.mock('../DatasetService.js', () => ({
  datasetService: mockDatasetService,
}));

vi.mock('../EpisodeCurationService.js', () => ({
  episodeCurationService: mockCuration,
}));

import { DatasetCurationService, CurationError } from '../DatasetCurationService.js';

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

const SUMMARY = {
  ok: true,
  operation: 'delete episodes [1]',
  output: '',
  total_episodes: 2,
  total_frames: 40,
  stats_recompute_required: false,
};

const BASE_INFO = {
  codebase_version: 'v2.1',
  fps: 30,
  total_episodes: 2,
  total_frames: 40,
  features: { action: { dtype: 'float32', shape: [6], names: null } },
};

function makeDataset(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ds1',
    name: 'My DS',
    robotTypeId: 'rt1',
    skillId: undefined,
    storagePath: 'ds1/',
    lerobotVersion: 'v2.1',
    fps: 30,
    totalFrames: 86,
    totalDuration: 2.9,
    demonstrationCount: 4,
    infoJson: {},
    statsJson: {},
    status: 'ready',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/** Make the curation mock actually produce an output dataset dir when invoked. */
function stubCurationWritesOutput(fn: ReturnType<typeof vi.fn>, summary = SUMMARY): void {
  fn.mockImplementation(async (_src: string, out: string) => {
    mkdirSync(path.join(out, 'meta'), { recursive: true });
    writeFileSync(path.join(out, 'meta', 'info.json'), JSON.stringify(BASE_INFO));
    writeFileSync(
      path.join(out, 'meta', 'stats.json'),
      JSON.stringify({ action: { mean: [0], std: [1], min: [-1], max: [1] } }),
    );
    return { ...summary, output: out };
  });
}

function stubListAll(keys: string[]): void {
  mockClient.listAll.mockImplementation(async function* () {
    for (const key of keys) {
      yield { key, size: 10, lastModified: new Date() };
    }
  });
}

let tmpRoot: string;
let service: DatasetCurationService;

beforeEach(() => {
  vi.clearAllMocks();
  rustfsState.initialized = true;
  delete process.env.CURATION_VLM;
  tmpRoot = mkdtempSync(path.join(os.tmpdir(), 'curation-svc-test-'));
  service = DatasetCurationService.getInstance();
  mockRepo.findAll.mockResolvedValue({
    data: [],
    pagination: { page: 1, pageSize: 500, total: 0, totalPages: 0 },
  });
  mockRepo.create.mockImplementation(async (input: Record<string, unknown>) => ({
    id: 'new-row-1',
    ...input,
  }));
  mockDatasetService.validateAndUpdateDataset.mockResolvedValue(undefined);
  mockClient.download.mockResolvedValue(Buffer.from(JSON.stringify(BASE_INFO)));
  mockClient.putObject.mockResolvedValue(undefined);
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

function makeLocalSourceDir(): string {
  const src = path.join(tmpRoot, 'local-ds');
  mkdirSync(path.join(src, 'meta'), { recursive: true });
  writeFileSync(path.join(src, 'meta', 'info.json'), JSON.stringify(BASE_INFO));
  return src;
}

// ----------------------------------------------------------------------------
// Local mode
// ----------------------------------------------------------------------------

describe('DatasetCurationService — local mode', () => {
  it('curates from the local dir and registers a ready revision row', async () => {
    const src = makeLocalSourceDir();
    mockRepo.findById.mockResolvedValue(makeDataset({ storagePath: src }));
    stubCurationWritesOutput(mockCuration.deleteEpisodes);

    const result = await service.deleteEpisodes('ds1', [1]);

    expect(mockCuration.deleteEpisodes).toHaveBeenCalledTimes(1);
    const [calledSrc, calledOut, episodes, opts] = mockCuration.deleteEpisodes.mock.calls[0];
    expect(calledSrc).toBe(src);
    expect(calledOut).toContain('__del-');
    expect(episodes).toEqual([1]);
    expect(opts).toEqual({ backend: 'native' });

    // new revision row
    expect(mockRepo.create).toHaveBeenCalledTimes(1);
    const created = mockRepo.create.mock.calls[0][0];
    expect(created.name).toBe('My DS (curated)');
    expect(created.status).toBe('ready');
    expect(created.storagePath).toBe(calledOut);
    expect(created.robotTypeId).toBe('rt1');
    expect(created.demonstrationCount).toBe(2);
    expect(created.totalFrames).toBe(40);
    expect(created.infoJson._curation.parentDatasetId).toBe('ds1');
    expect(created.infoJson._curation.operation).toBe('delete');
    expect(created.infoJson._curation.tool).toBe('curate.py');
    expect(created.statsJson.action).toBeDefined();

    // lineage also persisted in the output info.json on disk
    const outInfo = JSON.parse(readFileSync(path.join(calledOut, 'meta', 'info.json'), 'utf8'));
    expect(outInfo._curation.parentDatasetId).toBe('ds1');

    // RustFS validation path untouched in local mode
    expect(mockDatasetService.validateAndUpdateDataset).not.toHaveBeenCalled();

    expect(result.newDatasetId).toBe('new-row-1');
    expect(result.newDatasetName).toBe('My DS (curated)');
    expect(result.datasetId).toBe('ds1');
    expect(result.total_frames).toBe(40);
  });

  it('appends a counter when the curated name already exists', async () => {
    const src = makeLocalSourceDir();
    mockRepo.findById.mockResolvedValue(makeDataset({ storagePath: src }));
    mockRepo.findAll.mockResolvedValue({
      data: [{ name: 'My DS (curated)' }, { name: 'My DS (curated 2)' }],
      pagination: { page: 1, pageSize: 500, total: 2, totalPages: 1 },
    });
    stubCurationWritesOutput(mockCuration.deleteEpisodes);

    const result = await service.deleteEpisodes('ds1', [0]);
    expect(result.newDatasetName).toBe('My DS (curated 3)');
  });

  it('trims with start/end and records trim params in the lineage', async () => {
    const src = makeLocalSourceDir();
    mockRepo.findById.mockResolvedValue(makeDataset({ storagePath: src }));
    stubCurationWritesOutput(mockCuration.trimEpisode, {
      ...SUMMARY,
      operation: 'trim episode 1 to [5, 15)',
    });

    await service.trimEpisode('ds1', 1, 5, 15);

    const [, , episode, start, end, opts] = mockCuration.trimEpisode.mock.calls[0];
    expect([episode, start, end]).toEqual([1, 5, 15]);
    expect(opts).toEqual({ backend: 'native' });

    const created = mockRepo.create.mock.calls[0][0];
    expect(created.infoJson._curation.params).toEqual({ episode: 1, start: 5, end: 15 });
  });
});

// ----------------------------------------------------------------------------
// RustFS mode
// ----------------------------------------------------------------------------

describe('DatasetCurationService — RustFS mode', () => {
  it('downloads the prefix, curates, uploads a new prefix, and re-validates', async () => {
    mockRepo.findById.mockResolvedValue(makeDataset({ storagePath: 'ds1/' }));
    stubListAll([
      'ds1/meta/info.json',
      'ds1/data/chunk-000/episode_000000.parquet',
      'ds1/videos/chunk-000/observation.images.top/episode_000000.mp4',
    ]);

    let sawVideoInSrc = false;
    mockCuration.deleteEpisodes.mockImplementation(async (src: string, out: string) => {
      // the full tree (incl. videos) must be present for an edit
      expect(existsSync(path.join(src, 'meta', 'info.json'))).toBe(true);
      expect(existsSync(path.join(src, 'data', 'chunk-000', 'episode_000000.parquet'))).toBe(true);
      sawVideoInSrc = existsSync(
        path.join(src, 'videos', 'chunk-000', 'observation.images.top', 'episode_000000.mp4'),
      );
      mkdirSync(path.join(out, 'meta'), { recursive: true });
      writeFileSync(path.join(out, 'meta', 'info.json'), JSON.stringify(BASE_INFO));
      return { ...SUMMARY, output: out };
    });

    const result = await service.deleteEpisodes('ds1', [1]);

    expect(sawVideoInSrc).toBe(true);

    // uploaded under a fresh uuid prefix
    expect(mockClient.putObject).toHaveBeenCalled();
    const uploadedKeys = mockClient.putObject.mock.calls.map((c) => c[1] as string);
    const prefix = uploadedKeys[0].split('/')[0] + '/';
    expect(prefix).toMatch(/^[0-9a-f-]{36}\/$/);
    expect(uploadedKeys).toContain(`${prefix}meta/info.json`);

    // row registered as validating with the new prefix, then re-validated
    const created = mockRepo.create.mock.calls[0][0];
    expect(created.status).toBe('validating');
    expect(created.storagePath).toBe(prefix);
    expect(mockDatasetService.validateAndUpdateDataset).toHaveBeenCalledWith('new-row-1', prefix);

    expect(result.newDatasetId).toBe('new-row-1');

    // temp working dir is cleaned up
    const src = mockCuration.deleteEpisodes.mock.calls[0][0] as string;
    expect(existsSync(src)).toBe(false);
  });

  it('fails clearly when RustFS is not initialized', async () => {
    rustfsState.initialized = false;
    mockRepo.findById.mockResolvedValue(makeDataset({ storagePath: 'ds1/' }));

    await expect(service.deleteEpisodes('ds1', [0])).rejects.toThrow(/RustFS is not available/);
    expect(mockCuration.deleteEpisodes).not.toHaveBeenCalled();
  });

  it('fails when the prefix has no objects', async () => {
    mockRepo.findById.mockResolvedValue(makeDataset({ storagePath: 'empty/' }));
    stubListAll([]);

    await expect(service.deleteEpisodes('ds1', [0])).rejects.toThrow(/no objects found under prefix/);
  });
});

// ----------------------------------------------------------------------------
// Backend selection (v3.0 via lerobot)
// ----------------------------------------------------------------------------

describe('DatasetCurationService — backend selection', () => {
  it('uses the lerobot backend for v3.0 datasets on delete', async () => {
    const src = makeLocalSourceDir();
    mockRepo.findById.mockResolvedValue(makeDataset({ storagePath: src, lerobotVersion: 'v3.0' }));
    stubCurationWritesOutput(mockCuration.deleteEpisodes);

    await service.deleteEpisodes('ds1', [1]);

    const opts = mockCuration.deleteEpisodes.mock.calls[0][3];
    expect(opts).toEqual({ backend: 'lerobot' });
  });

  it('rejects trim for v3.0 datasets with V3_TRIM_UNSUPPORTED', async () => {
    mockRepo.findById.mockResolvedValue(makeDataset({ lerobotVersion: 'v3.0' }));

    await expect(service.trimEpisode('ds1', 0, 0, 10)).rejects.toMatchObject({
      code: 'V3_TRIM_UNSUPPORTED',
    });
    expect(mockCuration.trimEpisode).not.toHaveBeenCalled();
  });

  it('rejects suggest for v3.0 datasets with V3_SUGGEST_UNSUPPORTED', async () => {
    mockRepo.findById.mockResolvedValue(makeDataset({ lerobotVersion: 'v3.0' }));

    await expect(service.suggest('ds1')).rejects.toBeInstanceOf(CurationError);
    await expect(service.suggest('ds1')).rejects.toMatchObject({
      code: 'V3_SUGGEST_UNSUPPORTED',
    });
  });
});

// ----------------------------------------------------------------------------
// Suggest
// ----------------------------------------------------------------------------

describe('DatasetCurationService — suggest', () => {
  it('skips downloading videos for RustFS datasets', async () => {
    mockRepo.findById.mockResolvedValue(makeDataset({ storagePath: 'ds1/' }));
    stubListAll([
      'ds1/meta/info.json',
      'ds1/data/chunk-000/episode_000000.parquet',
      'ds1/videos/chunk-000/observation.images.top/episode_000000.mp4',
    ]);

    let sawVideoInSrc = true;
    mockCuration.suggest.mockImplementation(async (src: string) => {
      expect(existsSync(path.join(src, 'meta', 'info.json'))).toBe(true);
      sawVideoInSrc = existsSync(path.join(src, 'videos'));
      return {
        ok: true,
        operation: 'suggest',
        suggestions: [{ episode: 0, kind: 'trim', start: 3, end: 18, reason: 'idle', confidence: 0.8 }],
      };
    });

    const result = await service.suggest('ds1');

    expect(sawVideoInSrc).toBe(false);
    expect(result.suggestions).toHaveLength(1);
    expect(result.datasetId).toBe('ds1');
    expect(result.vlmEnriched).toBe(false);
  });

  it('passes the episode filter through for local datasets', async () => {
    const src = makeLocalSourceDir();
    mockRepo.findById.mockResolvedValue(makeDataset({ storagePath: src }));
    mockCuration.suggest.mockResolvedValue({ ok: true, operation: 'suggest', suggestions: [] });

    await service.suggest('ds1', { episode: 2 });

    expect(mockCuration.suggest).toHaveBeenCalledWith(src, 2);
  });
});

// ----------------------------------------------------------------------------
// Legacy path-mode (no Dataset row)
// ----------------------------------------------------------------------------

describe('DatasetCurationService — legacy path mode', () => {
  it('curates an explicit datasetPath without registering a row', async () => {
    mockRepo.findById.mockResolvedValue(null);
    const src = makeLocalSourceDir();
    stubCurationWritesOutput(mockCuration.deleteEpisodes);

    const result = await service.deleteEpisodes('unknown-ds', [0], src);

    expect(mockCuration.deleteEpisodes.mock.calls[0][0]).toBe(src);
    expect(mockRepo.create).not.toHaveBeenCalled();
    expect(result.newDatasetId).toBeUndefined();
    expect(result.datasetId).toBe('unknown-ds');
    expect(result.ok).toBe(true);
  });
});

// ----------------------------------------------------------------------------
// Structured error propagation (curate.py codes -> CurationError -> HTTP 400)
// ----------------------------------------------------------------------------

describe('DatasetCurationService — error propagation', () => {
  it('re-wraps coded curate.py failures as CurationError (curate)', async () => {
    const src = makeLocalSourceDir();
    mockRepo.findById.mockResolvedValue(makeDataset({ storagePath: src }));
    const failure = new Error(
      'curate.py failed: dataset has videos but no ffmpeg is available',
    ) as Error & { code?: string };
    failure.code = 'FFMPEG_MISSING';
    mockCuration.trimEpisode.mockRejectedValue(failure);

    const promise = service.trimEpisode('ds1', 0, 2, 8);
    await expect(promise).rejects.toBeInstanceOf(CurationError);
    await expect(service.trimEpisode('ds1', 0, 2, 8)).rejects.toMatchObject({
      code: 'FFMPEG_MISSING',
    });
    expect(mockRepo.create).not.toHaveBeenCalled();
  });

  it('re-wraps coded curate.py failures as CurationError (suggest)', async () => {
    const src = makeLocalSourceDir();
    mockRepo.findById.mockResolvedValue(makeDataset({ storagePath: src }));
    const failure = new Error('curate.py failed: episode 7 out of range') as Error & {
      code?: string;
    };
    failure.code = 'INVALID_EPISODES';
    mockCuration.suggest.mockRejectedValue(failure);

    await expect(service.suggest('ds1', { episode: 7 })).rejects.toMatchObject({
      name: 'CurationError',
      code: 'INVALID_EPISODES',
    });
  });

  it('leaves uncoded failures untouched (still a plain 500-path Error)', async () => {
    const src = makeLocalSourceDir();
    mockRepo.findById.mockResolvedValue(makeDataset({ storagePath: src }));
    mockCuration.deleteEpisodes.mockRejectedValue(new Error('disk full'));

    const promise = service.deleteEpisodes('ds1', [0]);
    await expect(promise).rejects.toThrow('disk full');
    await expect(service.deleteEpisodes('ds1', [0])).rejects.not.toBeInstanceOf(CurationError);
  });
});

// ----------------------------------------------------------------------------
// RustFS prefix normalization
// ----------------------------------------------------------------------------

describe('DatasetCurationService — RustFS prefix normalization', () => {
  it('lists with a directory-style prefix when storagePath has no trailing slash', async () => {
    mockRepo.findById.mockResolvedValue(makeDataset({ storagePath: 'ds1' }));
    stubListAll(['ds1/meta/info.json', 'ds1/data/chunk-000/episode_000000.parquet']);
    mockCuration.deleteEpisodes.mockImplementation(async (src: string, out: string) => {
      // relative paths must not carry a leading slash / stray prefix remainder
      expect(existsSync(path.join(src, 'meta', 'info.json'))).toBe(true);
      mkdirSync(path.join(out, 'meta'), { recursive: true });
      writeFileSync(path.join(out, 'meta', 'info.json'), JSON.stringify(BASE_INFO));
      return { ...SUMMARY, output: out };
    });

    await service.deleteEpisodes('ds1', [1]);

    expect(mockClient.listAll).toHaveBeenCalledWith(expect.any(String), 'ds1/');
  });
});
