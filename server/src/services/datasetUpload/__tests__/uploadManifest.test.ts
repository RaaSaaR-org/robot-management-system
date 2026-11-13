/**
 * @file uploadManifest.test.ts
 * @description The up-front check of a direct upload (TASK-480): which paths
 *   are safe, which files a LeRobot tree needs, how a file splits into parts,
 *   and the limits read from the environment.
 * @feature datasets
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../../HuggingFaceImportService.js', async () => {
  // Only the pure file filter is wanted; the real module pulls in the database.
  return {
    selectRepoFiles: (tree: Array<{ path: string; size: number }>, includeVideos: boolean) =>
      tree.filter(({ path }) => {
        if (path.startsWith('meta/')) return true;
        if (path.startsWith('data/') && path.endsWith('.parquet')) return true;
        if (path.startsWith('videos/')) return includeVideos && path.endsWith('.mp4');
        if (path.startsWith('images/')) return includeVideos;
        return false;
      }),
  };
});

import {
  checkInfo,
  checkManifest,
  DatasetUploadError,
  DEFAULT_CHUNK_BYTES,
  HARD_MAX_CHUNK_BYTES,
  MIN_CHUNK_BYTES,
  partCountOf,
  partSizeOf,
  resolveChunkSize,
  unsafePathReason,
  uploadLimits,
  type UploadLimits,
} from '../uploadManifest.js';
import type { LeRobotInfoV3 } from '../../../types/dataset.types.js';

const MIB = 1024 * 1024;

const LIMITS: UploadLimits = {
  chunkBytes: 32 * MIB,
  maxTotalBytes: 1024 * MIB,
  maxFiles: 100,
  idleMs: 60_000,
  maxConcurrentParts: 4,
  storeCapacityBytes: null,
};

const INFO_V3 = {
  codebase_version: 'v3.0',
  robot_type: 'unitree_g1_dex3',
  fps: 30,
  features: { action: { dtype: 'float32', shape: [31] } },
} as unknown as LeRobotInfoV3;

const INFO_V2 = { ...INFO_V3, codebase_version: 'v2.1' } as LeRobotInfoV3;

const V3_TREE = [
  { path: 'meta/info.json', size: 100 },
  { path: 'meta/stats.json', size: 50 },
  { path: 'meta/tasks.parquet', size: 20 },
  { path: 'meta/episodes/chunk-000/file-000.parquet', size: 200 },
  { path: 'data/chunk-000/file-000.parquet', size: 1000 },
  { path: 'videos/observation.images.head/chunk-000/file-000.mp4', size: 70 * MIB },
];

function refusal(run: () => unknown): DatasetUploadError {
  try {
    run();
  } catch (error) {
    if (error instanceof DatasetUploadError) return error;
    throw error;
  }
  throw new Error('expected a DatasetUploadError');
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('unsafePathReason', () => {
  it.each([
    'meta/info.json',
    'videos/observation.images.head/chunk-000/file-000.mp4',
    'data/chunk-000/episode_000001.parquet',
    'images/observation.images.top/episode 1/frame (2).png',
  ])('accepts %s', (path) => {
    expect(unsafePathReason(path)).toBeNull();
  });

  it.each([
    ['../meta/info.json', '".."'],
    ['meta/../../etc/passwd', '".."'],
    ['meta/./info.json', '"."'],
    ['/etc/passwd', 'absolute'],
    ['meta//info.json', 'empty'],
    ['meta/info.json/', 'empty'],
    ['meta\\info.json', 'backslash'],
    ['C:/data/x.parquet', 'drive'],
    ['meta/in\u0000fo.json', 'control character'],
    ['', 'non-empty'],
  ])('refuses %j', (path, why) => {
    expect(unsafePathReason(path)).toContain(why);
  });

  it('refuses a path longer than 1024 characters', () => {
    expect(unsafePathReason(`meta/${'a'.repeat(1020)}`)).toContain('longer');
  });

  it('refuses anything that is not a string', () => {
    expect(unsafePathReason(7)).toContain('non-empty string');
    expect(unsafePathReason(undefined)).toContain('non-empty string');
  });
});

describe('part arithmetic', () => {
  it('splits a file into parts of the chunk size with a shorter last one', () => {
    const file = { size: 70 * MIB, partCount: partCountOf(70 * MIB, 32 * MIB) };
    expect(file.partCount).toBe(3);
    expect(partSizeOf(file, 1, 32 * MIB)).toBe(32 * MIB);
    expect(partSizeOf(file, 2, 32 * MIB)).toBe(32 * MIB);
    expect(partSizeOf(file, 3, 32 * MIB)).toBe(6 * MIB);
  });

  it('keeps a file of exactly one chunk, and an empty file, as one part', () => {
    expect(partCountOf(32 * MIB, 32 * MIB)).toBe(1);
    expect(partCountOf(0, 32 * MIB)).toBe(1);
    expect(partSizeOf({ size: 0, partCount: 1 }, 1, 32 * MIB)).toBe(0);
  });
});

describe('uploadLimits', () => {
  it('defaults to 32 MiB parts and never goes above 64 MiB or below 5 MiB', () => {
    expect(uploadLimits({}).chunkBytes).toBe(DEFAULT_CHUNK_BYTES);
    expect(uploadLimits({ DATASET_UPLOAD_CHUNK_BYTES: String(500 * MIB) }).chunkBytes).toBe(HARD_MAX_CHUNK_BYTES);
    expect(uploadLimits({ DATASET_UPLOAD_CHUNK_BYTES: '1024' }).chunkBytes).toBe(MIN_CHUNK_BYTES);
  });

  it('reads the caps, the idle time and the declared store capacity', () => {
    const limits = uploadLimits({
      DATASET_UPLOAD_MAX_BYTES: '1000',
      DATASET_UPLOAD_MAX_FILES: '12',
      DATASET_UPLOAD_IDLE_MINUTES: '30',
      DATASET_UPLOAD_MAX_CONCURRENT_PARTS: '2',
      DATASET_UPLOAD_STORE_CAPACITY_BYTES: '5000',
    });
    expect(limits).toMatchObject({
      maxTotalBytes: 1000, maxFiles: 12, idleMs: 30 * 60_000, maxConcurrentParts: 2, storeCapacityBytes: 5000,
    });
    expect(uploadLimits({}).storeCapacityBytes).toBeNull();
  });

  it('falls back to the default, with a warning, for a value that is not a positive number', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(uploadLimits({ DATASET_UPLOAD_MAX_FILES: 'many' }).maxFiles).toBe(20_000);
    expect(warn).toHaveBeenCalledOnce();
  });
});

describe('resolveChunkSize', () => {
  it('uses the server size unless the client asks for a smaller one', () => {
    expect(resolveChunkSize(undefined, LIMITS)).toBe(32 * MIB);
    expect(resolveChunkSize(8 * MIB, LIMITS)).toBe(8 * MIB);
  });

  it.each([4 * MIB, 33 * MIB, 8 * MIB + 0.5, '8388608'])('refuses %j', (requested) => {
    expect(refusal(() => resolveChunkSize(requested, LIMITS)).code).toBe('INVALID_CHUNK_SIZE');
  });
});

describe('checkInfo', () => {
  it('accepts a v3.0 and a v2.1 info', () => {
    expect(checkInfo(INFO_V3)).toBe(INFO_V3);
    expect(checkInfo(INFO_V2)).toBe(INFO_V2);
  });

  it.each([
    [undefined, 'INVALID_INFO'],
    [{ ...INFO_V3, codebase_version: 'v1.6' }, 'UNSUPPORTED_VERSION'],
    [{ ...INFO_V3, codebase_version: undefined }, 'UNSUPPORTED_VERSION'],
    [{ ...INFO_V3, robot_type: '' }, 'INVALID_INFO'],
    [{ ...INFO_V3, fps: 0 }, 'INVALID_INFO'],
    [{ ...INFO_V3, features: {} }, 'INVALID_INFO'],
  ])('refuses %j as %s', (info, code) => {
    expect(refusal(() => checkInfo(info)).code).toBe(code);
  });
});

describe('checkManifest', () => {
  it('numbers the accepted files, counts their parts and totals their bytes', () => {
    const result = checkManifest(V3_TREE, INFO_V3, 32 * MIB, LIMITS);

    expect(result.files.map((f) => [f.id, f.path, f.partCount])).toEqual([
      [0, 'meta/info.json', 1],
      [1, 'meta/stats.json', 1],
      [2, 'meta/tasks.parquet', 1],
      [3, 'meta/episodes/chunk-000/file-000.parquet', 1],
      [4, 'data/chunk-000/file-000.parquet', 1],
      [5, 'videos/observation.images.head/chunk-000/file-000.mp4', 3],
    ]);
    expect(result.totalBytes).toBe(1370 + 70 * MIB);
    expect(result.importMode).toBe('full');
    expect(result.ignored).toEqual([]);
  });

  it('stores every safe file of the directory, not only the LeRobot tree', () => {
    const extras = [
      { path: 'README.md', size: 10 },
      { path: '.gitattributes', size: 5 },
      { path: 'videos/cam/notes.txt', size: 1 },
      { path: 'notes/empty.txt', size: 0 },
      { path: 'docs/übersicht — späte Schicht.md', size: 7 },
    ];
    const result = checkManifest([...V3_TREE, ...extras], INFO_V3, 32 * MIB, LIMITS);

    expect(result.files.map((f) => f.path)).toEqual([...V3_TREE, ...extras].map((f) => f.path));
    expect(result.files.find((f) => f.path === 'notes/empty.txt')).toMatchObject({ size: 0, partCount: 1 });
    expect(result.ignored).toEqual([]);
    expect(result.totalBytes).toBe(1370 + 70 * MIB + 23);
    expect(result.importMode).toBe('full');
  });

  it('still needs the LeRobot tree itself, whatever else is declared', () => {
    const noTables = [...V3_TREE.filter((f) => !f.path.startsWith('data/')), { path: 'README.md', size: 10 }];
    const error = refusal(() => checkManifest(noTables, INFO_V3, 32 * MIB, LIMITS));
    expect(error.code).toBe('NOT_A_LEROBOT_DATASET');
  });

  it('refuses an unsafe path among the extra files, and one that is a file and a directory', () => {
    expect(refusal(() => checkManifest([...V3_TREE, { path: '../README.md', size: 10 }], INFO_V3, 32 * MIB, LIMITS)).code)
      .toBe('INVALID_PATH');
    const both = [...V3_TREE, { path: 'notes', size: 3 }, { path: 'notes/a.txt', size: 3 }];
    expect(refusal(() => checkManifest(both, INFO_V3, 32 * MIB, LIMITS)).code).toBe('INVALID_PATH');
  });

  it('does not call a dataset with a stray top-level file a camera upload', () => {
    const tables = [...V3_TREE.filter((f) => !f.path.startsWith('videos/')), { path: 'preview.mp4', size: 9 }];
    expect(checkManifest(tables, INFO_V3, 32 * MIB, LIMITS).importMode).toBe('metadata');
  });

  it('does not call a note under videos/ a camera file', () => {
    const tables = [...V3_TREE.filter((f) => !f.path.startsWith('videos/')), { path: 'videos/cam/notes.txt', size: 9 }];
    expect(checkManifest(tables, INFO_V3, 32 * MIB, LIMITS).importMode).toBe('metadata');
  });

  it('calls a manifest without camera files a metadata upload', () => {
    const tables = V3_TREE.filter((f) => !f.path.startsWith('videos/'));
    expect(checkManifest(tables, INFO_V3, 32 * MIB, LIMITS).importMode).toBe('metadata');
  });

  it('keeps a declared sha256, lower-cased', () => {
    const sha = 'AB'.repeat(32);
    const tree = V3_TREE.map((f) => (f.path === 'meta/info.json' ? { ...f, sha256: sha } : f));
    expect(checkManifest(tree, INFO_V3, 32 * MIB, LIMITS).files[0].sha256).toBe(sha.toLowerCase());
  });

  it('refuses the whole manifest for one unsafe path, even among files it would ignore', () => {
    const error = refusal(() => checkManifest([...V3_TREE, { path: '../secrets.txt', size: 1 }], INFO_V3, 32 * MIB, LIMITS));
    expect(error.code).toBe('INVALID_PATH');
    expect(error.statusCode).toBe(400);
    expect(error.context).toMatchObject({ index: V3_TREE.length, path: '../secrets.txt' });
  });

  it.each([
    ['a duplicate path', [...V3_TREE, V3_TREE[0]], 'DUPLICATE_PATH'],
    ['a negative size', [...V3_TREE, { path: 'meta/x.json', size: -1 }], 'INVALID_MANIFEST'],
    ['a fractional size', [...V3_TREE, { path: 'meta/x.json', size: 1.5 }], 'INVALID_MANIFEST'],
    ['a malformed sha256', [...V3_TREE, { path: 'meta/x.json', size: 1, sha256: 'abc' }], 'INVALID_MANIFEST'],
    ['an entry that is not an object', [...V3_TREE, 'meta/x.json'], 'INVALID_MANIFEST'],
    ['a file that is also a directory', [...V3_TREE, { path: 'meta/episodes', size: 1 }], 'INVALID_PATH'],
    ['no files at all', [], 'INVALID_MANIFEST'],
  ])('refuses %s', (_what, files, code) => {
    expect(refusal(() => checkManifest(files, INFO_V3, 32 * MIB, LIMITS)).code).toBe(code);
  });

  it('names every required file that is missing from a v3.0 tree', () => {
    const error = refusal(() => checkManifest([{ path: 'meta/stats.json', size: 5 }], INFO_V3, 32 * MIB, LIMITS));
    expect(error.code).toBe('NOT_A_LEROBOT_DATASET');
    expect(error.context?.missing).toEqual([
      'meta/info.json',
      'data/**/*.parquet (the episode tables)',
      'meta/episodes/**/*.parquet (v3.0 episode rows)',
    ]);
  });

  it('asks a v2.1 tree for meta/episodes.jsonl instead of the v3.0 episode shards', () => {
    const v2 = [
      { path: 'meta/info.json', size: 100 },
      { path: 'data/chunk-000/episode_000000.parquet', size: 10 },
    ];
    expect(refusal(() => checkManifest(v2, INFO_V2, 32 * MIB, LIMITS)).context?.missing)
      .toEqual(['meta/episodes.jsonl (v2.x episode rows)']);
    expect(checkManifest([...v2, { path: 'meta/episodes.jsonl', size: 9 }], INFO_V2, 32 * MIB, LIMITS).files).toHaveLength(3);
  });

  it('refuses an empty meta/info.json as missing', () => {
    const tree = V3_TREE.map((f) => (f.path === 'meta/info.json' ? { ...f, size: 0 } : f));
    expect(refusal(() => checkManifest(tree, INFO_V3, 32 * MIB, LIMITS)).context?.missing).toEqual(['meta/info.json']);
  });

  it('refuses a dataset over the size cap with both numbers, as 413', () => {
    const error = refusal(() => checkManifest(V3_TREE, INFO_V3, 32 * MIB, { ...LIMITS, maxTotalBytes: 10 * MIB }));
    expect(error.code).toBe('UPLOAD_TOO_LARGE');
    expect(error.statusCode).toBe(413);
    expect(error.context).toEqual({ totalBytes: 1370 + 70 * MIB, maxTotalBytes: 10 * MIB });
  });

  it('counts the files beside the tree against the size cap — they are stored too', () => {
    const tree = [...V3_TREE.filter((f) => !f.path.startsWith('videos/')), { path: 'raw/recording.bag', size: 5000 * MIB }];
    const error = refusal(() => checkManifest(tree, INFO_V3, 32 * MIB, { ...LIMITS, maxTotalBytes: 100 * MIB }));
    expect(error.code).toBe('UPLOAD_TOO_LARGE');
    expect(error.context).toEqual({ totalBytes: 1370 + 5000 * MIB, maxTotalBytes: 100 * MIB });
  });

  it('refuses more files than the cap, and a file of more than 10,000 parts', () => {
    expect(refusal(() => checkManifest(V3_TREE, INFO_V3, 32 * MIB, { ...LIMITS, maxFiles: 3 })).code).toBe('TOO_MANY_FILES');
    const huge = [...V3_TREE, { path: 'videos/cam/huge.mp4', size: 5 * MIB * 10_001 }];
    expect(refusal(() => checkManifest(huge, INFO_V3, 5 * MIB, { ...LIMITS, maxTotalBytes: Number.MAX_SAFE_INTEGER })).code)
      .toBe('FILE_TOO_LARGE');
  });
});
