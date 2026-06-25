/**
 * @file model-storage.test.ts
 * @description Unit tests for ModelStorageClient — the high-level storage layer
 *   for datasets, checkpoints, production models and robot logs. The RustFS
 *   client (the S3/network boundary) is mocked via '../rustfs-client.js'; all
 *   pure logic (key building, prefix/date filtering, sorting, metadata
 *   stringification, size-limit validation) runs for real.
 * @feature storage
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ObjectInfo } from '../rustfs-client.js';

// ---------------------------------------------------------------------------
// Mock the RustFS client boundary. getRustFSClient returns our fake client;
// isRustFSInitialized is a vi.fn we can flip per-test.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const client = {
    upload: vi.fn(),
    getStream: vi.fn(),
    getPresignedDownloadUrl: vi.fn(),
    getPresignedUploadUrl: vi.fn(),
    listAll: vi.fn(),
    delete: vi.fn(),
    exists: vi.fn(),
  };
  return {
    client,
    getRustFSClient: vi.fn(() => client),
    isRustFSInitialized: vi.fn(() => true),
  };
});

vi.mock('../rustfs-client.js', () => ({
  getRustFSClient: mocks.getRustFSClient,
  isRustFSInitialized: mocks.isRustFSInitialized,
}));

import {
  ModelStorageClient,
  modelStorage,
  BUCKETS,
  SIZE_LIMITS,
  URL_EXPIRY,
} from '../model-storage.js';

const client = mocks.client;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeObj(overrides: Partial<ObjectInfo> = {}): ObjectInfo {
  return {
    key: 'some/key',
    size: 100,
    lastModified: new Date('2026-06-22T00:00:00.000Z'),
    ...overrides,
  };
}

/** Wrap an array of ObjectInfo as an async generator (what listAll returns). */
function asyncGen(items: ObjectInfo[]) {
  return (async function* () {
    for (const item of items) {
      yield item;
    }
  })();
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getRustFSClient.mockReturnValue(client);
  mocks.isRustFSInitialized.mockReturnValue(true);
});

describe('constants', () => {
  it('exposes the bucket names', () => {
    expect(BUCKETS).toEqual({
      TRAINING_DATASETS: 'training-datasets',
      MODEL_CHECKPOINTS: 'model-checkpoints',
      PRODUCTION_MODELS: 'production-models',
      ROBOT_LOGS: 'robot-logs',
      SENSOR_SCANS: 'sensor-scans',
      DIGITAL_TWINS: 'digital-twins',
    });
  });

  it('exposes size limits in bytes', () => {
    expect(SIZE_LIMITS.DATASET).toBe(50 * 1024 * 1024 * 1024);
    expect(SIZE_LIMITS.MODEL).toBe(10 * 1024 * 1024 * 1024);
    expect(SIZE_LIMITS.CHECKPOINT).toBe(5 * 1024 * 1024 * 1024);
    expect(SIZE_LIMITS.LOG).toBe(1 * 1024 * 1024 * 1024);
    expect(SIZE_LIMITS.SCAN).toBe(2 * 1024 * 1024 * 1024);
  });

  it('exposes URL expiry defaults', () => {
    expect(URL_EXPIRY.UPLOAD).toBe(3600);
    expect(URL_EXPIRY.DOWNLOAD).toBe(3600);
  });
});

describe('isAvailable', () => {
  it('returns true when RustFS is initialized', () => {
    mocks.isRustFSInitialized.mockReturnValue(true);
    expect(new ModelStorageClient().isAvailable()).toBe(true);
  });

  it('returns false when RustFS is not initialized', () => {
    mocks.isRustFSInitialized.mockReturnValue(false);
    expect(new ModelStorageClient().isAvailable()).toBe(false);
  });
});

describe('singleton export', () => {
  it('modelStorage is a ModelStorageClient instance', () => {
    expect(modelStorage).toBeInstanceOf(ModelStorageClient);
  });
});

// ---------------------------------------------------------------------------
// Dataset operations
// ---------------------------------------------------------------------------

describe('uploadDataset', () => {
  const svc = new ModelStorageClient();

  it('uploads to the datasets bucket with the canonical key and metadata', async () => {
    client.upload.mockResolvedValue(undefined);
    const data = Buffer.from('payload');

    const key = await svc.uploadDataset('cubes', 'v1', data, {
      robotType: 'so101',
      episodeCount: 12,
    });

    expect(key).toBe('cubes/v1/data.bin');
    expect(client.upload).toHaveBeenCalledTimes(1);
    const [bucket, usedKey, body, opts] = client.upload.mock.calls[0];
    expect(bucket).toBe(BUCKETS.TRAINING_DATASETS);
    expect(usedKey).toBe('cubes/v1/data.bin');
    expect(body).toBe(data);
    expect(opts.contentType).toBe('application/octet-stream');
    // name/version always present; non-string values JSON-stringified
    expect(opts.metadata).toEqual({
      name: 'cubes',
      version: 'v1',
      robotType: 'so101',
      episodeCount: '12',
    });
  });

  it('omits undefined/null metadata values', async () => {
    client.upload.mockResolvedValue(undefined);
    await svc.uploadDataset('d', 'v', Buffer.from('x'), {
      robotType: undefined,
      taskType: 'pick',
    });
    const opts = client.upload.mock.calls[0][3];
    expect(opts.metadata).toEqual({ name: 'd', version: 'v', taskType: 'pick' });
  });

  it('works with no metadata argument', async () => {
    client.upload.mockResolvedValue(undefined);
    await svc.uploadDataset('d', 'v', Buffer.from('x'));
    expect(client.upload.mock.calls[0][3].metadata).toEqual({ name: 'd', version: 'v' });
  });
});

describe('getDatasetStream', () => {
  it('delegates to client.getStream with the dataset key', async () => {
    const fakeStream = {} as never;
    client.getStream.mockResolvedValue(fakeStream);
    const result = await new ModelStorageClient().getDatasetStream('d', 'v');
    expect(result).toBe(fakeStream);
    expect(client.getStream).toHaveBeenCalledWith(BUCKETS.TRAINING_DATASETS, 'd/v/data.bin');
  });
});

describe('getDatasetDownloadUrl', () => {
  it('uses default expiry', async () => {
    client.getPresignedDownloadUrl.mockResolvedValue('https://dl');
    const url = await new ModelStorageClient().getDatasetDownloadUrl('d', 'v');
    expect(url).toBe('https://dl');
    expect(client.getPresignedDownloadUrl).toHaveBeenCalledWith(
      BUCKETS.TRAINING_DATASETS,
      'd/v/data.bin',
      URL_EXPIRY.DOWNLOAD
    );
  });

  it('forwards an explicitly passed expiry', async () => {
    client.getPresignedDownloadUrl.mockResolvedValue('https://dl');
    await new ModelStorageClient().getDatasetDownloadUrl('d', 'v', URL_EXPIRY.DOWNLOAD);
    expect(client.getPresignedDownloadUrl).toHaveBeenCalledWith(
      BUCKETS.TRAINING_DATASETS,
      'd/v/data.bin',
      URL_EXPIRY.DOWNLOAD
    );
  });
});

describe('getDatasetUploadUrl', () => {
  it('passes default content type and expiry', async () => {
    client.getPresignedUploadUrl.mockResolvedValue('https://up');
    const url = await new ModelStorageClient().getDatasetUploadUrl('d', 'v');
    expect(url).toBe('https://up');
    expect(client.getPresignedUploadUrl).toHaveBeenCalledWith(
      BUCKETS.TRAINING_DATASETS,
      'd/v/data.bin',
      URL_EXPIRY.UPLOAD,
      'application/octet-stream'
    );
  });

  it('forwards an explicit content type and expiry', async () => {
    client.getPresignedUploadUrl.mockResolvedValue('https://up');
    await new ModelStorageClient().getDatasetUploadUrl(
      'd',
      'v',
      'application/zip',
      URL_EXPIRY.UPLOAD
    );
    expect(client.getPresignedUploadUrl).toHaveBeenCalledWith(
      BUCKETS.TRAINING_DATASETS,
      'd/v/data.bin',
      URL_EXPIRY.UPLOAD,
      'application/zip'
    );
  });
});

describe('listDatasets', () => {
  it('maps name/version from key parts and forwards the prefix', async () => {
    client.listAll.mockReturnValue(
      asyncGen([
        makeObj({ key: 'cubes/v1/data.bin', size: 10 }),
        makeObj({ key: 'cubes/v2/data.bin', size: 20 }),
      ])
    );
    const result = await new ModelStorageClient().listDatasets('cubes/');
    expect(client.listAll).toHaveBeenCalledWith(BUCKETS.TRAINING_DATASETS, 'cubes/');
    expect(result).toEqual([
      {
        name: 'cubes',
        version: 'v1',
        key: 'cubes/v1/data.bin',
        size: 10,
        lastModified: new Date('2026-06-22T00:00:00.000Z'),
      },
      {
        name: 'cubes',
        version: 'v2',
        key: 'cubes/v2/data.bin',
        size: 20,
        lastModified: new Date('2026-06-22T00:00:00.000Z'),
      },
    ]);
  });

  it('skips keys with fewer than 2 parts', async () => {
    client.listAll.mockReturnValue(
      asyncGen([makeObj({ key: 'toplevel' }), makeObj({ key: 'a/b/c' })])
    );
    const result = await new ModelStorageClient().listDatasets();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('a');
    expect(result[0].version).toBe('b');
  });
});

describe('deleteDataset', () => {
  it('deletes the canonical dataset key', async () => {
    client.delete.mockResolvedValue(undefined);
    await new ModelStorageClient().deleteDataset('d', 'v');
    expect(client.delete).toHaveBeenCalledWith(BUCKETS.TRAINING_DATASETS, 'd/v/data.bin');
  });
});

describe('datasetExists', () => {
  it('forwards the exists result', async () => {
    client.exists.mockResolvedValue(true);
    const exists = await new ModelStorageClient().datasetExists('d', 'v');
    expect(exists).toBe(true);
    expect(client.exists).toHaveBeenCalledWith(BUCKETS.TRAINING_DATASETS, 'd/v/data.bin');
  });
});

// ---------------------------------------------------------------------------
// Checkpoint operations
// ---------------------------------------------------------------------------

describe('uploadCheckpoint', () => {
  const svc = new ModelStorageClient();

  it('uploads with epoch key and JSON-stringified metrics', async () => {
    client.upload.mockResolvedValue(undefined);
    const key = await svc.uploadCheckpoint('job-1', 3, Buffer.from('w'), { loss: 0.1 });
    expect(key).toBe('job-1/epoch-3/model.safetensors');
    const [bucket, usedKey, , opts] = client.upload.mock.calls[0];
    expect(bucket).toBe(BUCKETS.MODEL_CHECKPOINTS);
    expect(usedKey).toBe('job-1/epoch-3/model.safetensors');
    expect(opts.metadata).toEqual({
      jobId: 'job-1',
      epoch: '3',
      metrics: JSON.stringify({ loss: 0.1 }),
    });
  });

  it('omits metrics field when none provided', async () => {
    client.upload.mockResolvedValue(undefined);
    await svc.uploadCheckpoint('job-1', 0, Buffer.from('w'));
    expect(client.upload.mock.calls[0][3].metadata).toEqual({ jobId: 'job-1', epoch: '0' });
  });
});

describe('listCheckpoints', () => {
  it('parses epoch numbers, filters non-matching keys, and sorts ascending', async () => {
    client.listAll.mockReturnValue(
      asyncGen([
        makeObj({ key: 'job-1/epoch-5/model.safetensors', size: 5 }),
        makeObj({ key: 'job-1/epoch-2/model.safetensors', size: 2 }),
        makeObj({ key: 'job-1/notes.txt', size: 1 }),
      ])
    );
    const result = await new ModelStorageClient().listCheckpoints('job-1');
    expect(client.listAll).toHaveBeenCalledWith(BUCKETS.MODEL_CHECKPOINTS, 'job-1/epoch-');
    expect(result.map((c) => c.epoch)).toEqual([2, 5]);
    expect(result[0].jobId).toBe('job-1');
  });
});

describe('getCheckpointDownloadUrl', () => {
  it('builds the checkpoint key', async () => {
    client.getPresignedDownloadUrl.mockResolvedValue('https://ckpt');
    await new ModelStorageClient().getCheckpointDownloadUrl('job-1', 7);
    expect(client.getPresignedDownloadUrl).toHaveBeenCalledWith(
      BUCKETS.MODEL_CHECKPOINTS,
      'job-1/epoch-7/model.safetensors',
      URL_EXPIRY.DOWNLOAD
    );
  });
});

describe('deleteJobCheckpoints', () => {
  it('deletes every object under the job prefix and returns the count', async () => {
    client.listAll.mockReturnValue(
      asyncGen([
        makeObj({ key: 'job-1/epoch-0/model.safetensors' }),
        makeObj({ key: 'job-1/epoch-1/model.safetensors' }),
      ])
    );
    client.delete.mockResolvedValue(undefined);
    const count = await new ModelStorageClient().deleteJobCheckpoints('job-1');
    expect(count).toBe(2);
    expect(client.listAll).toHaveBeenCalledWith(BUCKETS.MODEL_CHECKPOINTS, 'job-1/');
    expect(client.delete).toHaveBeenCalledTimes(2);
  });

  it('returns 0 when nothing matches', async () => {
    client.listAll.mockReturnValue(asyncGen([]));
    const count = await new ModelStorageClient().deleteJobCheckpoints('job-1');
    expect(count).toBe(0);
    expect(client.delete).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Production model operations
// ---------------------------------------------------------------------------

describe('uploadProductionModel', () => {
  it('uploads with the onnx key and metadata', async () => {
    client.upload.mockResolvedValue(undefined);
    const key = await new ModelStorageClient().uploadProductionModel(
      'policy',
      'v3',
      Buffer.from('onnx'),
      { accuracy: 0.95 }
    );
    expect(key).toBe('policy/v3.onnx');
    const [bucket, usedKey, , opts] = client.upload.mock.calls[0];
    expect(bucket).toBe(BUCKETS.PRODUCTION_MODELS);
    expect(usedKey).toBe('policy/v3.onnx');
    expect(opts.metadata).toEqual({ name: 'policy', version: 'v3', accuracy: '0.95' });
  });
});

describe('getModelDownloadUrl', () => {
  it('builds the model key', async () => {
    client.getPresignedDownloadUrl.mockResolvedValue('https://m');
    await new ModelStorageClient().getModelDownloadUrl('policy', 'v3');
    expect(client.getPresignedDownloadUrl).toHaveBeenCalledWith(
      BUCKETS.PRODUCTION_MODELS,
      'policy/v3.onnx',
      URL_EXPIRY.DOWNLOAD
    );
  });
});

describe('listModelVersions', () => {
  it('keeps only .onnx keys, strips the suffix, and sorts newest-first', async () => {
    client.listAll.mockReturnValue(
      asyncGen([
        makeObj({ key: 'policy/v1.onnx', lastModified: new Date('2026-01-01T00:00:00Z') }),
        makeObj({ key: 'policy/v2.onnx', lastModified: new Date('2026-03-01T00:00:00Z') }),
        makeObj({ key: 'policy/readme.txt', lastModified: new Date('2026-02-01T00:00:00Z') }),
      ])
    );
    const result = await new ModelStorageClient().listModelVersions('policy');
    expect(client.listAll).toHaveBeenCalledWith(BUCKETS.PRODUCTION_MODELS, 'policy/');
    expect(result.map((v) => v.version)).toEqual(['v2', 'v1']);
    expect(result[0].name).toBe('policy');
  });

  it('skips keys with fewer than 2 parts', async () => {
    client.listAll.mockReturnValue(asyncGen([makeObj({ key: 'flat.onnx' })]));
    const result = await new ModelStorageClient().listModelVersions('policy');
    expect(result).toHaveLength(0);
  });
});

describe('modelExists', () => {
  it('forwards exists with the model key', async () => {
    client.exists.mockResolvedValue(false);
    const exists = await new ModelStorageClient().modelExists('policy', 'v3');
    expect(exists).toBe(false);
    expect(client.exists).toHaveBeenCalledWith(BUCKETS.PRODUCTION_MODELS, 'policy/v3.onnx');
  });
});

// ---------------------------------------------------------------------------
// Robot log operations
// ---------------------------------------------------------------------------

describe('uploadRobotLog', () => {
  it('uploads with the robot log key and metadata', async () => {
    client.upload.mockResolvedValue(undefined);
    const key = await new ModelStorageClient().uploadRobotLog(
      'robot-1',
      '2026-06-22',
      'telemetry',
      Buffer.from('log')
    );
    expect(key).toBe('robot-1/telemetry/2026-06-22.log');
    const [bucket, usedKey, , opts] = client.upload.mock.calls[0];
    expect(bucket).toBe(BUCKETS.ROBOT_LOGS);
    expect(usedKey).toBe('robot-1/telemetry/2026-06-22.log');
    expect(opts.metadata).toEqual({
      robotId: 'robot-1',
      date: '2026-06-22',
      logType: 'telemetry',
    });
  });
});

describe('listRobotLogs', () => {
  it('uses robot-only prefix when no logType, parses parts, sorts date desc', async () => {
    client.listAll.mockReturnValue(
      asyncGen([
        makeObj({ key: 'robot-1/telemetry/2026-06-20.log' }),
        makeObj({ key: 'robot-1/telemetry/2026-06-22.log' }),
      ])
    );
    const result = await new ModelStorageClient().listRobotLogs('robot-1');
    expect(client.listAll).toHaveBeenCalledWith(BUCKETS.ROBOT_LOGS, 'robot-1/');
    expect(result.map((l) => l.date)).toEqual(['2026-06-22', '2026-06-20']);
    expect(result[0].logType).toBe('telemetry');
  });

  it('uses logType-scoped prefix when provided', async () => {
    client.listAll.mockReturnValue(asyncGen([]));
    await new ModelStorageClient().listRobotLogs('robot-1', { logType: 'errors' });
    expect(client.listAll).toHaveBeenCalledWith(BUCKETS.ROBOT_LOGS, 'robot-1/errors/');
  });

  it('filters by startDate and endDate (inclusive bounds excluded outside)', async () => {
    client.listAll.mockReturnValue(
      asyncGen([
        makeObj({ key: 'robot-1/t/2026-06-19.log' }),
        makeObj({ key: 'robot-1/t/2026-06-21.log' }),
        makeObj({ key: 'robot-1/t/2026-06-25.log' }),
      ])
    );
    const result = await new ModelStorageClient().listRobotLogs('robot-1', {
      startDate: '2026-06-20',
      endDate: '2026-06-22',
    });
    expect(result.map((l) => l.date)).toEqual(['2026-06-21']);
  });

  it('caps the result list at maxResults', async () => {
    client.listAll.mockReturnValue(
      asyncGen([
        makeObj({ key: 'robot-1/t/2026-06-01.log' }),
        makeObj({ key: 'robot-1/t/2026-06-02.log' }),
        makeObj({ key: 'robot-1/t/2026-06-03.log' }),
      ])
    );
    const result = await new ModelStorageClient().listRobotLogs('robot-1', { maxResults: 2 });
    expect(result).toHaveLength(2);
  });

  it('skips keys with fewer than 3 parts', async () => {
    client.listAll.mockReturnValue(asyncGen([makeObj({ key: 'robot-1/onlytwo' })]));
    const result = await new ModelStorageClient().listRobotLogs('robot-1');
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Temp upload cleanup
// ---------------------------------------------------------------------------

describe('cleanupTempUploads', () => {
  it('deletes only objects older than the cutoff and tallies size', async () => {
    const now = Date.now();
    const old = new Date(now - 48 * 60 * 60 * 1000); // 48h ago
    const fresh = new Date(now - 1 * 60 * 60 * 1000); // 1h ago
    client.listAll.mockReturnValue(
      asyncGen([
        makeObj({ key: 'temp/a', size: 100, lastModified: old }),
        makeObj({ key: 'temp/b', size: 200, lastModified: fresh }),
      ])
    );
    client.delete.mockResolvedValue(undefined);

    const result = await new ModelStorageClient().cleanupTempUploads(24);

    expect(client.listAll).toHaveBeenCalledWith(BUCKETS.MODEL_CHECKPOINTS, 'temp/');
    expect(client.delete).toHaveBeenCalledTimes(1);
    expect(client.delete).toHaveBeenCalledWith(BUCKETS.MODEL_CHECKPOINTS, 'temp/a');
    expect(result.deletedCount).toBe(1);
    expect(result.deletedSize).toBe(100);
    expect(result.errors).toEqual([]);
  });

  it('records errors when a delete fails but keeps going', async () => {
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
    client.listAll.mockReturnValue(
      asyncGen([
        makeObj({ key: 'temp/a', size: 100, lastModified: old }),
        makeObj({ key: 'temp/b', size: 200, lastModified: old }),
      ])
    );
    client.delete
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(undefined);

    const result = await new ModelStorageClient().cleanupTempUploads(24);

    expect(result.deletedCount).toBe(1);
    expect(result.deletedSize).toBe(200);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('Failed to delete temp/a');
  });
});

// ---------------------------------------------------------------------------
// Storage statistics
// ---------------------------------------------------------------------------

describe('getBucketStats', () => {
  it('sums object count and total size for a bucket', async () => {
    client.listAll.mockReturnValue(
      asyncGen([makeObj({ size: 10 }), makeObj({ size: 25 }), makeObj({ size: 5 })])
    );
    const stats = await new ModelStorageClient().getBucketStats(BUCKETS.ROBOT_LOGS);
    expect(client.listAll).toHaveBeenCalledWith(BUCKETS.ROBOT_LOGS);
    expect(stats).toEqual({ bucket: BUCKETS.ROBOT_LOGS, objectCount: 3, totalSize: 40 });
  });
});

describe('getAllStats', () => {
  it('returns one entry per bucket', async () => {
    client.listAll.mockReturnValue(asyncGen([makeObj({ size: 1 })]));
    const stats = await new ModelStorageClient().getAllStats();
    expect(stats).toHaveLength(Object.values(BUCKETS).length);
    expect(stats.map((s) => s.bucket).sort()).toEqual(Object.values(BUCKETS).sort());
  });

  it('falls back to a zeroed entry when a bucket throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // First bucket throws, the rest succeed with empty listings.
    client.listAll
      .mockImplementationOnce(() => {
        throw new Error('list failed');
      })
      .mockReturnValue(asyncGen([]));

    const stats = await new ModelStorageClient().getAllStats();
    expect(stats).toHaveLength(Object.values(BUCKETS).length);
    const failed = stats[0];
    expect(failed).toEqual({ bucket: Object.values(BUCKETS)[0], objectCount: 0, totalSize: 0 });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Presigned URL helpers with validation
// ---------------------------------------------------------------------------

describe('getPresignedUploadUrl (with size validation)', () => {
  const svc = new ModelStorageClient();

  it('returns url + expiry when size is within the bucket limit', async () => {
    client.getPresignedUploadUrl.mockResolvedValue('https://signed-up');
    const out = await svc.getPresignedUploadUrl(
      BUCKETS.PRODUCTION_MODELS,
      'policy/v1.onnx',
      'application/octet-stream',
      SIZE_LIMITS.MODEL
    );
    expect(out).toEqual({ url: 'https://signed-up', expiresIn: URL_EXPIRY.UPLOAD });
    expect(client.getPresignedUploadUrl).toHaveBeenCalledWith(
      BUCKETS.PRODUCTION_MODELS,
      'policy/v1.onnx',
      URL_EXPIRY.UPLOAD,
      'application/octet-stream'
    );
  });

  it('throws when size exceeds the bucket limit and never signs', async () => {
    await expect(
      svc.getPresignedUploadUrl(
        BUCKETS.ROBOT_LOGS,
        'k',
        'application/octet-stream',
        SIZE_LIMITS.LOG + 1
      )
    ).rejects.toThrow(/exceeds limit/);
    expect(client.getPresignedUploadUrl).not.toHaveBeenCalled();
  });

  it('applies the correct per-bucket limit (dataset is the largest)', async () => {
    client.getPresignedUploadUrl.mockResolvedValue('https://x');
    // A size that exceeds MODEL/CHECKPOINT/LOG but fits DATASET should pass for datasets.
    await expect(
      svc.getPresignedUploadUrl(
        BUCKETS.TRAINING_DATASETS,
        'k',
        'application/octet-stream',
        SIZE_LIMITS.MODEL + 1
      )
    ).resolves.toBeDefined();
  });
});

describe('getPresignedDownloadUrl', () => {
  it('returns url + download expiry', async () => {
    client.getPresignedDownloadUrl.mockResolvedValue('https://signed-dl');
    const out = await new ModelStorageClient().getPresignedDownloadUrl(
      BUCKETS.MODEL_CHECKPOINTS,
      'job/epoch-1/model.safetensors'
    );
    expect(out).toEqual({ url: 'https://signed-dl', expiresIn: URL_EXPIRY.DOWNLOAD });
    expect(client.getPresignedDownloadUrl).toHaveBeenCalledWith(
      BUCKETS.MODEL_CHECKPOINTS,
      'job/epoch-1/model.safetensors',
      URL_EXPIRY.DOWNLOAD
    );
  });
});

describe('digital-twin artifacts (TASK-170)', () => {
  const svc = new ModelStorageClient();

  it('uploads to the DIGITAL_TWINS bucket under <twinId>/<name> when rustfs is up', async () => {
    mocks.isRustFSInitialized.mockReturnValue(true);
    client.upload.mockResolvedValue(undefined);
    const key = await svc.uploadTwinArtifact('twin-1', 'occupancy.pgm', Buffer.from('P5'));
    expect(key).toBe('twin-1/occupancy.pgm');
    expect(client.upload).toHaveBeenCalledWith(
      BUCKETS.DIGITAL_TWINS,
      'twin-1/occupancy.pgm',
      expect.any(Buffer),
      expect.objectContaining({ metadata: { twinId: 'twin-1', name: 'occupancy.pgm' } })
    );
  });

  it('streams a rustfs key from the DIGITAL_TWINS bucket', async () => {
    client.getStream.mockResolvedValue('stream' as never);
    await svc.getTwinArtifactStream('twin-1/cloud.pcd');
    expect(client.getStream).toHaveBeenCalledWith(BUCKETS.DIGITAL_TWINS, 'twin-1/cloud.pcd');
  });

  it('presigns a rustfs key but refuses an absolute (local) path key', async () => {
    client.getPresignedDownloadUrl.mockResolvedValue('https://dl');
    await expect(svc.getTwinArtifactDownloadUrl('twin-1/mesh.glb')).resolves.toBe('https://dl');
    await expect(svc.getTwinArtifactDownloadUrl('/var/data/twins/twin-1/mesh.glb')).rejects.toThrow(
      /local-filesystem/
    );
  });

  it('deletes a rustfs key from the DIGITAL_TWINS bucket', async () => {
    client.delete.mockResolvedValue(undefined);
    await svc.deleteTwinArtifact('twin-1/roadmap.json');
    expect(client.delete).toHaveBeenCalledWith(BUCKETS.DIGITAL_TWINS, 'twin-1/roadmap.json');
  });
});
