/**
 * @file rustfs-client.test.ts
 * @description Unit tests for the RustFS S3-compatible storage client. The AWS
 *   SDK boundaries (@aws-sdk/client-s3 command classes + S3Client.send,
 *   @aws-sdk/lib-storage Upload, @aws-sdk/s3-request-presigner getSignedUrl)
 *   are mocked; all the client's own pure logic (input building, defaults,
 *   stream-to-buffer conversion, pagination, copy+delete, env parsing,
 *   singleton lifecycle) runs for real.
 * @feature storage
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mock state shared across the AWS SDK module mocks.
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => {
  // A single send() fn the test controls per-case.
  const send = vi.fn();
  // S3Client constructor capturing the config it was built with.
  // NOTE: vitest 4 only treats `function`-keyword implementations as
  // constructable via `new`, so all constructor mocks use that form.
  const s3ClientCtor = vi.fn().mockImplementation(function (this: Record<string, unknown>, cfg: unknown) {
    this.__config = cfg;
    this.send = send;
  });

  // Upload mock: capture params, an `on` registry, and a `done` resolver.
  const uploadInstances: Array<{
    params: unknown;
    handlers: Record<string, (arg: unknown) => void>;
    done: ReturnType<typeof vi.fn>;
  }> = [];
  const uploadCtor = vi.fn().mockImplementation(function (
    this: Record<string, unknown>,
    args: { params: unknown }
  ) {
    const handlers: Record<string, (arg: unknown) => void> = {};
    this.params = args.params;
    this.handlers = handlers;
    this.on = vi.fn((event: string, cb: (arg: unknown) => void) => {
      handlers[event] = cb;
    });
    this.done = vi.fn().mockResolvedValue(undefined);
    uploadInstances.push(this as never);
  });

  const getSignedUrl = vi.fn();

  // Command constructors simply record their input so we can assert on it.
  const mkCmd = (name: string) =>
    vi.fn().mockImplementation(function (this: Record<string, unknown>, input: unknown) {
      this.__cmd = name;
      this.input = input;
    });

  return { send, s3ClientCtor, uploadCtor, uploadInstances, getSignedUrl, mkCmd };
});

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: h.s3ClientCtor,
  PutObjectCommand: h.mkCmd('PutObject'),
  GetObjectCommand: h.mkCmd('GetObject'),
  DeleteObjectCommand: h.mkCmd('DeleteObject'),
  HeadObjectCommand: h.mkCmd('HeadObject'),
  ListObjectsV2Command: h.mkCmd('ListObjectsV2'),
  CopyObjectCommand: h.mkCmd('CopyObject'),
  ListBucketsCommand: h.mkCmd('ListBuckets'),
}));

vi.mock('@aws-sdk/lib-storage', () => ({
  Upload: h.uploadCtor,
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: h.getSignedUrl,
}));

import {
  RustFSClient,
  getRustFSClient,
  isRustFSInitialized,
  initializeRustFSClient,
  type RustFSConfig,
} from '../rustfs-client.js';
import {
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  CopyObjectCommand,
  ListBucketsCommand,
} from '@aws-sdk/client-s3';

// Retyped command mocks so `.mock.calls` typecheck cleanly.
const PutCmd = vi.mocked(PutObjectCommand);
const GetCmd = vi.mocked(GetObjectCommand);
const DeleteCmd = vi.mocked(DeleteObjectCommand);
const HeadCmd = vi.mocked(HeadObjectCommand);
const ListCmd = vi.mocked(ListObjectsV2Command);
const CopyCmd = vi.mocked(CopyObjectCommand);
const ListBucketsCmd = vi.mocked(ListBucketsCommand);

const cfg: RustFSConfig = {
  endpoint: 'http://localhost:9000',
  accessKeyId: 'AK',
  secretAccessKey: 'SK',
};

/** Build an async-iterable Readable-like stream from byte chunks. */
function fakeStream(chunks: Uint8Array[]): AsyncIterable<Uint8Array> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const c of chunks) yield c;
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.uploadInstances.length = 0;
});

// ---------------------------------------------------------------------------
// constructor / getClient
// ---------------------------------------------------------------------------

describe('RustFSClient constructor', () => {
  it('builds an S3Client with path-style, default region, and credentials', () => {
    new RustFSClient(cfg);

    expect(h.s3ClientCtor).toHaveBeenCalledTimes(1);
    expect(h.s3ClientCtor.mock.calls[0][0]).toEqual({
      endpoint: 'http://localhost:9000',
      credentials: { accessKeyId: 'AK', secretAccessKey: 'SK' },
      region: 'us-east-1',
      forcePathStyle: true,
    });
  });

  it('honours an explicit region', () => {
    new RustFSClient({ ...cfg, region: 'eu-central-1' });
    expect(h.s3ClientCtor.mock.calls[0][0]).toMatchObject({ region: 'eu-central-1' });
  });

  it('getClient returns the underlying S3 client instance', () => {
    const c = new RustFSClient(cfg);
    expect(c.getClient()).toBe(h.s3ClientCtor.mock.results[0].value);
  });
});

// ---------------------------------------------------------------------------
// upload (multipart via Upload)
// ---------------------------------------------------------------------------

describe('RustFSClient.upload', () => {
  it('constructs an Upload with defaults and awaits done()', async () => {
    const c = new RustFSClient(cfg);
    await c.upload('b', 'k', Buffer.from('data'));

    expect(h.uploadCtor).toHaveBeenCalledTimes(1);
    const inst = h.uploadInstances[0];
    expect(inst.params).toMatchObject({
      Bucket: 'b',
      Key: 'k',
      ContentType: 'application/octet-stream',
      Metadata: undefined,
    });
    expect(inst.done).toHaveBeenCalledTimes(1);
  });

  it('passes through contentType and metadata', async () => {
    const c = new RustFSClient(cfg);
    await c.upload('b', 'k', 'body', {
      contentType: 'image/png',
      metadata: { owner: 'x' },
    });

    expect(h.uploadInstances[0].params).toMatchObject({
      ContentType: 'image/png',
      Metadata: { owner: 'x' },
    });
  });

  it('registers a progress handler and computes a rounded percentage', async () => {
    const c = new RustFSClient(cfg);
    const onProgress = vi.fn();
    await c.upload('b', 'k', 'body', { onProgress });

    const inst = h.uploadInstances[0];
    expect(inst.handlers.httpUploadProgress).toBeTypeOf('function');

    inst.handlers.httpUploadProgress({ loaded: 50, total: 200 });
    expect(onProgress).toHaveBeenCalledWith({ loaded: 50, total: 200, percentage: 25 });
  });

  it('reports loaded=0 and undefined percentage when total is missing', async () => {
    const c = new RustFSClient(cfg);
    const onProgress = vi.fn();
    await c.upload('b', 'k', 'body', { onProgress });

    h.uploadInstances[0].handlers.httpUploadProgress({});
    expect(onProgress).toHaveBeenCalledWith({ loaded: 0, total: undefined, percentage: undefined });
  });
});

// ---------------------------------------------------------------------------
// putObject
// ---------------------------------------------------------------------------

describe('RustFSClient.putObject', () => {
  it('sends a PutObjectCommand with defaults', async () => {
    h.send.mockResolvedValue({});
    const c = new RustFSClient(cfg);

    await c.putObject('bk', 'key', Buffer.from('hi'));

    expect(PutCmd).toHaveBeenCalledTimes(1);
    expect(PutCmd.mock.calls[0][0]).toMatchObject({
      Bucket: 'bk',
      Key: 'key',
      ContentType: 'application/octet-stream',
      Metadata: undefined,
    });
    expect(h.send).toHaveBeenCalledWith({ __cmd: 'PutObject', input: expect.any(Object) });
  });

  it('forwards explicit contentType and metadata', async () => {
    h.send.mockResolvedValue({});
    const c = new RustFSClient(cfg);

    await c.putObject('bk', 'key', 'body', {
      contentType: 'text/plain',
      metadata: { a: '1' },
    });

    expect(PutCmd.mock.calls[0][0]).toMatchObject({
      ContentType: 'text/plain',
      Metadata: { a: '1' },
    });
  });
});

// ---------------------------------------------------------------------------
// download
// ---------------------------------------------------------------------------

describe('RustFSClient.download', () => {
  it('concatenates stream chunks into a single Buffer', async () => {
    h.send.mockResolvedValue({
      Body: fakeStream([Uint8Array.from([104, 105]), Uint8Array.from([33])]),
    });
    const c = new RustFSClient(cfg);

    const buf = await c.download('b', 'k');

    expect(GetCmd.mock.calls[0][0]).toEqual({ Bucket: 'b', Key: 'k' });
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.toString()).toBe('hi!');
  });

  it('throws when the response has no Body', async () => {
    h.send.mockResolvedValue({});
    const c = new RustFSClient(cfg);

    await expect(c.download('b', 'k')).rejects.toThrow('Empty response body for b/k');
  });
});

// ---------------------------------------------------------------------------
// getStream
// ---------------------------------------------------------------------------

describe('RustFSClient.getStream', () => {
  it('returns the raw response Body', async () => {
    const body = fakeStream([Uint8Array.from([1])]);
    h.send.mockResolvedValue({ Body: body });
    const c = new RustFSClient(cfg);

    const result = await c.getStream('b', 'k');

    expect(result).toBe(body);
  });

  it('throws when the response has no Body', async () => {
    h.send.mockResolvedValue({});
    const c = new RustFSClient(cfg);

    await expect(c.getStream('b', 'k')).rejects.toThrow('Empty response body for b/k');
  });
});

// ---------------------------------------------------------------------------
// delete
// ---------------------------------------------------------------------------

describe('RustFSClient.delete', () => {
  it('sends a DeleteObjectCommand', async () => {
    h.send.mockResolvedValue({});
    const c = new RustFSClient(cfg);

    await c.delete('b', 'k');

    expect(DeleteCmd.mock.calls[0][0]).toEqual({ Bucket: 'b', Key: 'k' });
    expect(h.send).toHaveBeenCalledWith({ __cmd: 'DeleteObject', input: { Bucket: 'b', Key: 'k' } });
  });
});

// ---------------------------------------------------------------------------
// exists
// ---------------------------------------------------------------------------

describe('RustFSClient.exists', () => {
  it('returns true when HeadObject succeeds', async () => {
    h.send.mockResolvedValue({});
    const c = new RustFSClient(cfg);

    expect(await c.exists('b', 'k')).toBe(true);
    expect(HeadCmd.mock.calls[0][0]).toEqual({ Bucket: 'b', Key: 'k' });
  });

  it('returns false when the error name is NotFound', async () => {
    h.send.mockRejectedValue(Object.assign(new Error('nope'), { name: 'NotFound' }));
    const c = new RustFSClient(cfg);

    expect(await c.exists('b', 'k')).toBe(false);
  });

  it('rethrows non-NotFound errors', async () => {
    h.send.mockRejectedValue(Object.assign(new Error('boom'), { name: 'AccessDenied' }));
    const c = new RustFSClient(cfg);

    await expect(c.exists('b', 'k')).rejects.toThrow('boom');
  });
});

// ---------------------------------------------------------------------------
// getMetadata
// ---------------------------------------------------------------------------

describe('RustFSClient.getMetadata', () => {
  it('maps HeadObject response fields onto ObjectMetadata', async () => {
    const lastModified = new Date('2026-06-22T00:00:00.000Z');
    h.send.mockResolvedValue({
      ContentType: 'application/json',
      ContentLength: 42,
      LastModified: lastModified,
      ETag: '"abc"',
      Metadata: { k: 'v' },
    });
    const c = new RustFSClient(cfg);

    const meta = await c.getMetadata('b', 'k');

    expect(meta).toEqual({
      contentType: 'application/json',
      contentLength: 42,
      lastModified,
      etag: '"abc"',
      metadata: { k: 'v' },
    });
  });
});

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

describe('RustFSClient.list', () => {
  it('applies default MaxKeys=1000 and maps Contents', async () => {
    const lm = new Date('2026-06-22T00:00:00.000Z');
    h.send.mockResolvedValue({
      Contents: [{ Key: 'a', Size: 10, LastModified: lm, ETag: '"e"' }],
      IsTruncated: true,
      NextContinuationToken: 'tok',
      CommonPrefixes: [{ Prefix: 'pre/' }],
    });
    const c = new RustFSClient(cfg);

    const result = await c.list('b', { prefix: 'p', delimiter: '/' });

    expect(ListCmd.mock.calls[0][0]).toEqual({
      Bucket: 'b',
      Prefix: 'p',
      MaxKeys: 1000,
      ContinuationToken: undefined,
      Delimiter: '/',
    });
    expect(result).toEqual({
      objects: [{ key: 'a', size: 10, lastModified: lm, etag: '"e"' }],
      isTruncated: true,
      continuationToken: 'tok',
      commonPrefixes: ['pre/'],
    });
  });

  it('honours custom maxKeys and continuationToken', async () => {
    h.send.mockResolvedValue({ Contents: [] });
    const c = new RustFSClient(cfg);

    await c.list('b', { maxKeys: 5, continuationToken: 'next' });

    expect(ListCmd.mock.calls[0][0]).toMatchObject({ MaxKeys: 5, ContinuationToken: 'next' });
  });

  it('defaults missing object fields and empty Contents', async () => {
    h.send.mockResolvedValue({});
    const c = new RustFSClient(cfg);

    const result = await c.list('b');

    expect(result.objects).toEqual([]);
    expect(result.isTruncated).toBe(false);
    expect(result.continuationToken).toBeUndefined();
    expect(result.commonPrefixes).toBeUndefined();
  });

  it('fills defaults (empty key, zero size, fresh date) for partial Contents entries', async () => {
    h.send.mockResolvedValue({ Contents: [{}] });
    const c = new RustFSClient(cfg);

    const result = await c.list('b');

    expect(result.objects[0].key).toBe('');
    expect(result.objects[0].size).toBe(0);
    expect(result.objects[0].lastModified).toBeInstanceOf(Date);
    expect(result.objects[0].etag).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// listAll (async generator, pagination loop)
// ---------------------------------------------------------------------------

describe('RustFSClient.listAll', () => {
  it('iterates across pages until continuationToken is exhausted', async () => {
    h.send
      .mockResolvedValueOnce({
        Contents: [{ Key: 'a', Size: 1, LastModified: new Date() }],
        IsTruncated: true,
        NextContinuationToken: 'p2',
      })
      .mockResolvedValueOnce({
        Contents: [{ Key: 'b', Size: 2, LastModified: new Date() }],
        IsTruncated: false,
      });
    const c = new RustFSClient(cfg);

    const keys: string[] = [];
    for await (const obj of c.listAll('bucket', 'prefix/')) {
      keys.push(obj.key);
    }

    expect(keys).toEqual(['a', 'b']);
    expect(h.send).toHaveBeenCalledTimes(2);
    // First page forwards prefix and undefined token.
    expect(ListCmd.mock.calls[0][0]).toMatchObject({ Prefix: 'prefix/', ContinuationToken: undefined });
    // Second page forwards the token returned by the first.
    expect(ListCmd.mock.calls[1][0]).toMatchObject({ ContinuationToken: 'p2' });
  });

  it('yields nothing for an empty single page', async () => {
    h.send.mockResolvedValue({ Contents: [] });
    const c = new RustFSClient(cfg);

    const out = [];
    for await (const o of c.listAll('b')) out.push(o);

    expect(out).toEqual([]);
    expect(h.send).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// presigned URLs
// ---------------------------------------------------------------------------

describe('RustFSClient.getPresignedDownloadUrl', () => {
  it('signs a GetObjectCommand with default expiry', async () => {
    h.getSignedUrl.mockResolvedValue('https://signed/get');
    const c = new RustFSClient(cfg);

    const url = await c.getPresignedDownloadUrl('b', 'k');

    expect(GetCmd.mock.calls[0][0]).toEqual({ Bucket: 'b', Key: 'k' });
    expect(h.getSignedUrl).toHaveBeenCalledWith(
      c.getClient(),
      { __cmd: 'GetObject', input: { Bucket: 'b', Key: 'k' } },
      { expiresIn: 3600 }
    );
    expect(url).toBe('https://signed/get');
  });

  it('honours a custom expiry', async () => {
    h.getSignedUrl.mockResolvedValue('u');
    const c = new RustFSClient(cfg);

    await c.getPresignedDownloadUrl('b', 'k', 60);

    expect(h.getSignedUrl.mock.calls[0][2]).toEqual({ expiresIn: 60 });
  });
});

describe('RustFSClient.getPresignedUploadUrl', () => {
  it('signs a PutObjectCommand with default content type and expiry', async () => {
    h.getSignedUrl.mockResolvedValue('https://signed/put');
    const c = new RustFSClient(cfg);

    const url = await c.getPresignedUploadUrl('b', 'k');

    expect(PutCmd.mock.calls[0][0]).toEqual({
      Bucket: 'b',
      Key: 'k',
      ContentType: 'application/octet-stream',
    });
    expect(h.getSignedUrl.mock.calls[0][2]).toEqual({ expiresIn: 3600 });
    expect(url).toBe('https://signed/put');
  });

  it('uses the provided content type and expiry', async () => {
    h.getSignedUrl.mockResolvedValue('u');
    const c = new RustFSClient(cfg);

    await c.getPresignedUploadUrl('b', 'k', 120, 'image/jpeg');

    expect(PutCmd.mock.calls[0][0]).toMatchObject({ ContentType: 'image/jpeg' });
    expect(h.getSignedUrl.mock.calls[0][2]).toEqual({ expiresIn: 120 });
  });
});

// ---------------------------------------------------------------------------
// copy / move
// ---------------------------------------------------------------------------

describe('RustFSClient.copy', () => {
  it('sends a CopyObjectCommand with a joined CopySource', async () => {
    h.send.mockResolvedValue({});
    const c = new RustFSClient(cfg);

    await c.copy('src', 'a/1', 'dst', 'b/2');

    expect(CopyCmd.mock.calls[0][0]).toEqual({
      Bucket: 'dst',
      Key: 'b/2',
      CopySource: 'src/a/1',
    });
  });
});

describe('RustFSClient.move', () => {
  it('copies then deletes the source', async () => {
    h.send.mockResolvedValue({});
    const c = new RustFSClient(cfg);

    await c.move('src', 'k1', 'dst', 'k2');

    expect(CopyCmd).toHaveBeenCalledTimes(1);
    expect(DeleteCmd).toHaveBeenCalledTimes(1);
    expect(CopyCmd.mock.calls[0][0]).toMatchObject({ CopySource: 'src/k1', Bucket: 'dst', Key: 'k2' });
    expect(DeleteCmd.mock.calls[0][0]).toEqual({ Bucket: 'src', Key: 'k1' });
  });

  it('does not delete when the copy fails', async () => {
    h.send.mockRejectedValueOnce(new Error('copy failed'));
    const c = new RustFSClient(cfg);

    await expect(c.move('src', 'k1', 'dst', 'k2')).rejects.toThrow('copy failed');
    expect(DeleteCmd).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// validateConnection
// ---------------------------------------------------------------------------

describe('RustFSClient.validateConnection', () => {
  it('returns true when ListBuckets succeeds', async () => {
    h.send.mockResolvedValue({ Buckets: [] });
    const c = new RustFSClient(cfg);

    expect(await c.validateConnection()).toBe(true);
    expect(ListBucketsCmd).toHaveBeenCalledWith({});
  });

  it('returns false when ListBuckets throws', async () => {
    h.send.mockRejectedValue(new Error('unreachable'));
    const c = new RustFSClient(cfg);

    expect(await c.validateConnection()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Singleton lifecycle: getRustFSClient / isRustFSInitialized / initialize
// ---------------------------------------------------------------------------

describe('RustFS singleton lifecycle', () => {
  const savedEnv = { ...process.env };
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    // Reset the module-level singleton so tests don't leak state between cases.
    vi.resetModules();
    process.env = { ...savedEnv };
    logSpy.mockRestore();
  });

  it('getRustFSClient throws before initialization', async () => {
    vi.resetModules();
    const mod = await import('../rustfs-client.js');
    expect(mod.isRustFSInitialized()).toBe(false);
    expect(() => mod.getRustFSClient()).toThrow('RustFS client not initialized');
  });

  it('initializeRustFSClient validates the connection and exposes the singleton', async () => {
    h.send.mockResolvedValue({ Buckets: [] });
    vi.resetModules();
    const mod = await import('../rustfs-client.js');

    const client = await mod.initializeRustFSClient(cfg);

    expect(client).toBeInstanceOf(mod.RustFSClient);
    expect(mod.isRustFSInitialized()).toBe(true);
    expect(mod.getRustFSClient()).toBe(client);
  });

  it('returns the existing singleton on a second initialize call (idempotent)', async () => {
    h.send.mockResolvedValue({ Buckets: [] });
    vi.resetModules();
    const mod = await import('../rustfs-client.js');

    const first = await mod.initializeRustFSClient(cfg);
    const second = await mod.initializeRustFSClient({ ...cfg, endpoint: 'http://other' });

    expect(second).toBe(first);
  });

  it('throws and clears the singleton when the connection fails to validate', async () => {
    h.send.mockRejectedValue(new Error('down'));
    vi.resetModules();
    const mod = await import('../rustfs-client.js');

    await expect(mod.initializeRustFSClient(cfg)).rejects.toThrow(
      'Failed to connect to RustFS at http://localhost:9000'
    );
    expect(mod.isRustFSInitialized()).toBe(false);
  });

  it('reads config from environment when none is passed', async () => {
    h.send.mockResolvedValue({ Buckets: [] });
    process.env.RUSTFS_ENDPOINT = 'http://env-endpoint';
    process.env.RUSTFS_ACCESS_KEY = 'envAK';
    process.env.RUSTFS_SECRET_KEY = 'envSK';
    process.env.RUSTFS_REGION = 'eu-west-1';
    vi.resetModules();
    const mod = await import('../rustfs-client.js');

    await mod.initializeRustFSClient();

    expect(h.s3ClientCtor.mock.calls.at(-1)?.[0]).toMatchObject({
      endpoint: 'http://env-endpoint',
      credentials: { accessKeyId: 'envAK', secretAccessKey: 'envSK' },
      region: 'eu-west-1',
    });
  });

  it('throws a clear error when required env vars are missing', async () => {
    delete process.env.RUSTFS_ENDPOINT;
    delete process.env.RUSTFS_ACCESS_KEY;
    delete process.env.RUSTFS_SECRET_KEY;
    vi.resetModules();
    const mod = await import('../rustfs-client.js');

    await expect(mod.initializeRustFSClient()).rejects.toThrow('Missing RustFS configuration');
  });
});

// Reference the statically imported singleton helpers so the import is used
// (lifecycle assertions above use a freshly re-imported module instance).
describe('static singleton exports', () => {
  it('exposes the expected functions', () => {
    expect(typeof getRustFSClient).toBe('function');
    expect(typeof isRustFSInitialized).toBe('function');
    expect(typeof initializeRustFSClient).toBe('function');
  });
});
