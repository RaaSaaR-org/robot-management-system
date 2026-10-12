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
  HeadBucketCommand: h.mkCmd('HeadBucket'),
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
// downloadRange
// ---------------------------------------------------------------------------

describe('RustFSClient.downloadRange', () => {
  // The read the parquet footer validation runs on: a few KB out of an object
  // that is routinely 100 MB (TASK-219). Two things have to hold — the right
  // `Range` header goes out, and whatever comes back is cut down to the window
  // the caller asked for, because an S3-compatible store is allowed to ignore
  // `Range` entirely and answer with the whole object.
  const OBJECT = Buffer.from('0123456789');

  it('asks for an inclusive byte range', async () => {
    h.send.mockResolvedValue({
      Body: fakeStream([OBJECT.subarray(2, 6)]),
      ContentRange: 'bytes 2-5/10',
      $metadata: { httpStatusCode: 206 },
    });
    const c = new RustFSClient(cfg);

    const buf = await c.downloadRange('b', 'k', 2, 4);

    expect(GetCmd.mock.calls[0][0]).toEqual({ Bucket: 'b', Key: 'k', Range: 'bytes=2-5' });
    expect(buf.toString()).toBe('2345');
  });

  it('cuts the window out itself when the store ignored the Range header', async () => {
    // A 200 with the whole object, which is what a store without range support
    // answers. Trusting it would hand the parquet reader the head of the file
    // where it asked for the footer.
    h.send.mockResolvedValue({ Body: fakeStream([OBJECT]), $metadata: { httpStatusCode: 200 } });
    const c = new RustFSClient(cfg);

    expect((await c.downloadRange('b', 'k', 6, 4)).toString()).toBe('6789');
  });

  it('cuts it out even when the whole object is exactly the requested length', async () => {
    // The case a size comparison cannot see. Asking for 10 bytes at offset 6 of
    // an object that happens to be 10 bytes long, from a store that ignores
    // `Range`: the reply is 10 bytes, the same length as the window, and the
    // guard this replaced ("only slice if it came back BIGGER than asked")
    // returned the head of the file as though it were the tail.
    h.send.mockResolvedValue({ Body: fakeStream([OBJECT]), $metadata: { httpStatusCode: 200 } });
    const c = new RustFSClient(cfg);

    // Past the end is short, not wrong: bytes 6..9 are all there is.
    expect((await c.downloadRange('b', 'k', 6, 10)).toString()).toBe('6789');
  });

  it('keeps a served range verbatim, however long it is', async () => {
    // The mirror image: a store that DID serve the range says so, and its bytes
    // already are the window — slicing them again would move the offset twice.
    h.send.mockResolvedValue({
      Body: fakeStream([OBJECT.subarray(6)]),
      ContentRange: 'bytes 6-9/10',
      $metadata: { httpStatusCode: 206 },
    });
    const c = new RustFSClient(cfg);

    expect((await c.downloadRange('b', 'k', 6, 4)).toString()).toBe('6789');
  });

  it('never asks the store for an empty window', async () => {
    const c = new RustFSClient(cfg);

    expect((await c.downloadRange('b', 'k', 0, 0)).length).toBe(0);
    expect(h.send).not.toHaveBeenCalled();
  });

  it('throws when the response has no Body', async () => {
    h.send.mockResolvedValue({});
    const c = new RustFSClient(cfg);

    await expect(c.downloadRange('b', 'k', 0, 4)).rejects.toThrow('Empty response body for b/k');
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

  it('asks for a byte range and returns the served window', async () => {
    const body = fakeStream([Uint8Array.from([1])]);
    h.send.mockResolvedValue({ Body: body, ContentRange: 'bytes 2-5/10' });
    const c = new RustFSClient(cfg);

    const result = await c.getStream('b', 'k', { start: 2, end: 5 });

    expect(result).toBe(body);
    expect(h.send.mock.calls[0][0].input).toMatchObject({ Bucket: 'b', Key: 'k', Range: 'bytes=2-5' });
  });

  it('throws when a store ignores the range and sends the whole object', async () => {
    h.send.mockResolvedValue({ Body: fakeStream([Uint8Array.from([1])]), $metadata: { httpStatusCode: 200 } });
    const c = new RustFSClient(cfg);

    await expect(c.getStream('b', 'k', { start: 2, end: 5 })).rejects.toThrow('ignored the byte range');
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

// ---------------------------------------------------------------------------
// Error classification: why the connection failed, without the keys (#368)
// ---------------------------------------------------------------------------

describe('classifyS3Error', () => {
  it('reads a 403 InvalidAccessKeyId as auth', async () => {
    const { classifyS3Error } = await import('../rustfs-client.js');
    expect(
      classifyS3Error({ name: 'InvalidAccessKeyId', $metadata: { httpStatusCode: 403 } }),
    ).toEqual({ kind: 'auth', detail: 'InvalidAccessKeyId (403)' });
  });

  it('reads any 401/403 as auth, whatever the name', async () => {
    const { classifyS3Error } = await import('../rustfs-client.js');
    expect(classifyS3Error({ name: 'UnknownError', $metadata: { httpStatusCode: 401 } }).kind).toBe('auth');
  });

  it('reads ECONNREFUSED, by name or by code, as connectivity', async () => {
    const { classifyS3Error } = await import('../rustfs-client.js');
    expect(classifyS3Error(Object.assign(new Error('x'), { code: 'ECONNREFUSED' })))
      .toEqual({ kind: 'connectivity', detail: 'Error/ECONNREFUSED' });
    expect(classifyS3Error({ name: 'TimeoutError' }).kind).toBe('connectivity');
  });

  it('reads anything else as unknown', async () => {
    const { classifyS3Error } = await import('../rustfs-client.js');
    expect(classifyS3Error(new Error('boom'))).toEqual({ kind: 'unknown', detail: 'Error' });
    expect(classifyS3Error(undefined).kind).toBe('unknown');
  });

  it('never copies the message, which a server may fill with the key id', async () => {
    const { classifyS3Error } = await import('../rustfs-client.js');
    const err = Object.assign(new Error('The access key AKSECRETID does not exist'), {
      name: 'InvalidAccessKeyId',
      $metadata: { httpStatusCode: 403 },
    });
    expect(classifyS3Error(err).detail).not.toContain('AKSECRETID');
  });
});

// ---------------------------------------------------------------------------
// Status and recovery after a failed start (#368)
// ---------------------------------------------------------------------------

describe('RustFS status and recovery', () => {
  const savedEnv = { ...process.env };
  const spies: Array<{ mockRestore: () => void }> = [];

  const authFailure = () =>
    Object.assign(new Error('The access key AK does not exist'), {
      name: 'InvalidAccessKeyId',
      $metadata: { httpStatusCode: 403 },
    });

  beforeEach(() => {
    spies.push(vi.spyOn(console, 'log').mockImplementation(() => undefined));
    spies.push(vi.spyOn(console, 'warn').mockImplementation(() => undefined));
    process.env.RUSTFS_ENDPOINT = 'http://localhost:9000';
    process.env.RUSTFS_ACCESS_KEY = 'AK';
    process.env.RUSTFS_SECRET_KEY = 'SK';
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
    process.env = { ...savedEnv };
    spies.splice(0).forEach((s) => s.mockRestore());
  });

  it('throws an auth RustFSConnectionError and reports it without the keys', async () => {
    h.send.mockRejectedValue(authFailure());
    const mod = await import('../rustfs-client.js');

    const err = await mod.initializeRustFSClient().catch((e: unknown) => e);

    expect(err).toBeInstanceOf(mod.RustFSConnectionError);
    expect((err as InstanceType<typeof mod.RustFSConnectionError>).kind).toBe('auth');
    const status = mod.getRustFSStatus();
    expect(status).toMatchObject({
      configured: true,
      state: 'unavailable',
      errorKind: 'auth',
      errorDetail: 'InvalidAccessKeyId (403)',
      attempts: 1,
    });
    expect(status.lastAttemptAt).toEqual(expect.any(String));
    expect(JSON.stringify(status)).not.toMatch(/"AK"|SK|does not exist/);
  });

  it('reports a refused connection as connectivity', async () => {
    h.send.mockRejectedValue(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }));
    const mod = await import('../rustfs-client.js');

    await expect(mod.initializeRustFSClient()).rejects.toMatchObject({ kind: 'connectivity' });
    expect(mod.getRustFSStatus()).toMatchObject({ state: 'unavailable', errorKind: 'connectivity' });
  });

  it('reports a missing environment as config, and an unconfigured server as disabled', async () => {
    delete process.env.RUSTFS_ENDPOINT;
    delete process.env.RUSTFS_ACCESS_KEY;
    delete process.env.RUSTFS_SECRET_KEY;
    const mod = await import('../rustfs-client.js');

    expect(mod.getRustFSStatus()).toMatchObject({ configured: false, state: 'disabled', attempts: 0 });
    await expect(mod.initializeRustFSClient()).rejects.toMatchObject({ kind: 'config' });
    expect(mod.getRustFSStatus()).toMatchObject({ configured: false, state: 'disabled' });
    expect(mod.getRustFSStatus().errorKind).toBeUndefined();
  });

  it('does not expose the client while the connection is still being probed', async () => {
    let release!: () => void;
    h.send.mockReturnValue(new Promise<void>((resolve) => { release = resolve; }));
    const mod = await import('../rustfs-client.js');

    const pending = mod.initializeRustFSClient();
    expect(mod.isRustFSInitialized()).toBe(false);
    expect(mod.getRustFSStatus().state).toBe('connecting');

    release();
    await pending;
    expect(mod.isRustFSInitialized()).toBe(true);
    expect(mod.getRustFSStatus()).toMatchObject({ state: 'ready' });
  });

  it('regression: down at startup, back later — the client connects without a restart', async () => {
    vi.useFakeTimers();
    h.send.mockRejectedValue(Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }));
    const mod = await import('../rustfs-client.js');

    await expect(mod.initializeRustFSClient()).rejects.toThrow();
    expect(mod.isRustFSInitialized()).toBe(false);

    const onReady = vi.fn();
    mod.startRustFSRecovery({ onReady, initialDelayMs: 1_000, maxDelayMs: 10_000 });

    // Still down at the first retry.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(mod.getRustFSStatus()).toMatchObject({ state: 'unavailable', attempts: 2 });
    expect(onReady).not.toHaveBeenCalled();

    // The backend comes back.
    h.send.mockResolvedValue({ Buckets: [] });
    await vi.advanceTimersByTimeAsync(2_000);

    expect(mod.isRustFSInitialized()).toBe(true);
    expect(mod.getRustFSStatus()).toMatchObject({ state: 'ready', attempts: 3 });
    expect(mod.getRustFSStatus().errorKind).toBeUndefined();
    expect(onReady).toHaveBeenCalledTimes(1);

    // And it stops trying.
    const calls = h.send.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.send.mock.calls.length).toBe(calls);
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it('doubles the wait after every failure, up to the cap', async () => {
    vi.useFakeTimers();
    h.send.mockRejectedValue(Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }));
    const mod = await import('../rustfs-client.js');
    const attemptsAt = () => mod.getRustFSStatus().attempts;

    mod.startRustFSRecovery({ onReady: vi.fn(), initialDelayMs: 1_000, maxDelayMs: 4_000 });

    await vi.advanceTimersByTimeAsync(999);
    expect(attemptsAt()).toBe(0);
    await vi.advanceTimersByTimeAsync(1);     // t=1s
    expect(attemptsAt()).toBe(1);
    await vi.advanceTimersByTimeAsync(1_999); // next at +2s
    expect(attemptsAt()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);     // t=3s
    expect(attemptsAt()).toBe(2);
    await vi.advanceTimersByTimeAsync(4_000); // +4s
    expect(attemptsAt()).toBe(3);
    await vi.advanceTimersByTimeAsync(4_000); // capped at +4s, not +8s
    expect(attemptsAt()).toBe(4);
  });

  it('stops retrying when the configuration itself is incomplete', async () => {
    vi.useFakeTimers();
    delete process.env.RUSTFS_SECRET_KEY;
    const mod = await import('../rustfs-client.js');

    mod.startRustFSRecovery({ onReady: vi.fn(), initialDelayMs: 1_000 });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(mod.getRustFSStatus()).toMatchObject({ configured: true, state: 'unavailable', errorKind: 'config', attempts: 1 });

    await vi.advanceTimersByTimeAsync(60_000);
    expect(mod.getRustFSStatus().attempts).toBe(1);
  });

  it('is a no-op when RustFS is not configured', async () => {
    vi.useFakeTimers();
    delete process.env.RUSTFS_ENDPOINT;
    const mod = await import('../rustfs-client.js');
    const onReady = vi.fn();

    const stop = mod.startRustFSRecovery({ onReady, initialDelayMs: 1_000 });
    await vi.advanceTimersByTimeAsync(60_000);

    expect(mod.getRustFSStatus().attempts).toBe(0);
    expect(onReady).not.toHaveBeenCalled();
    expect(() => stop()).not.toThrow();
  });

  it('shares one probe between concurrent initialize calls', async () => {
    let release!: () => void;
    h.send.mockReturnValue(new Promise<void>((resolve) => { release = resolve; }));
    const mod = await import('../rustfs-client.js');

    const a = mod.initializeRustFSClient();
    const b = mod.initializeRustFSClient();
    release();

    expect(await a).toBe(await b);
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(mod.getRustFSStatus()).toMatchObject({ state: 'ready', attempts: 1 });
  });

  it('runs one recovery loop at a time, so onReady fires once', async () => {
    vi.useFakeTimers();
    h.send.mockResolvedValue({ Buckets: [] });
    const mod = await import('../rustfs-client.js');
    const first = vi.fn();
    const second = vi.fn();

    mod.startRustFSRecovery({ onReady: first, initialDelayMs: 1_000 });
    mod.startRustFSRecovery({ onReady: second, initialDelayMs: 1_000 });
    await vi.advanceTimersByTimeAsync(1_000);

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    expect(mod.getRustFSStatus().attempts).toBe(1);
  });

  it('stop() cancels a pending retry', async () => {
    vi.useFakeTimers();
    h.send.mockResolvedValue({ Buckets: [] });
    const mod = await import('../rustfs-client.js');
    const onReady = vi.fn();

    const stop = mod.startRustFSRecovery({ onReady, initialDelayMs: 1_000 });
    stop();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(mod.isRustFSInitialized()).toBe(false);
    expect(onReady).not.toHaveBeenCalled();
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

// ---------------------------------------------------------------------------
// TASK-359: prefix delete and the live probe
// ---------------------------------------------------------------------------

describe('RustFSClient.deletePrefix', () => {
  it('lists every page under the prefix and deletes each key', async () => {
    h.send.mockImplementation(async (cmd: { __cmd: string; input: Record<string, unknown> }) => {
      if (cmd.__cmd === 'ListObjectsV2') {
        return cmd.input.ContinuationToken
          ? { Contents: [{ Key: 'u/c' }], IsTruncated: false }
          : { Contents: [{ Key: 'u/a' }, { Key: 'u/b' }], IsTruncated: true, NextContinuationToken: 't' };
      }
      return {};
    });
    const client = new RustFSClient(cfg);

    expect(await client.deletePrefix('training-datasets', 'u/', 2)).toBe(3);
    const deleted = h.send.mock.calls
      .map(([c]) => c as { __cmd: string; input: { Key?: string; Prefix?: string } })
      .filter((c) => c.__cmd === 'DeleteObject')
      .map((c) => c.input.Key);
    expect(deleted.sort()).toEqual(['u/a', 'u/b', 'u/c']);
    const prefixes = h.send.mock.calls
      .map(([c]) => c as { __cmd: string; input: { Prefix?: string } })
      .filter((c) => c.__cmd === 'ListObjectsV2')
      .map((c) => c.input.Prefix);
    expect(prefixes).toEqual(['u/', 'u/']);
  });

  it('refuses the empty prefix, which would be the whole bucket', async () => {
    const client = new RustFSClient(cfg);
    await expect(client.deletePrefix('training-datasets', '')).rejects.toThrow(/empty prefix/);
    expect(h.send).not.toHaveBeenCalled();
  });
});

describe('probeRustFS', () => {
  it('is undefined with no client, then caches a failed HeadBucket for the TTL', async () => {
    vi.resetModules();
    const mod = await import('../rustfs-client.js');
    expect(await mod.probeRustFS()).toBeUndefined();

    h.send.mockResolvedValue({}); // ListBuckets during initialize
    await mod.initializeRustFSClient(cfg);
    h.send.mockReset();
    const refused = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    h.send.mockRejectedValue(refused);

    const t0 = 1_000_000;
    const first = await mod.probeRustFS(t0);
    expect(first).toMatchObject({ ok: false, errorKind: 'connectivity' });
    expect(h.send).toHaveBeenCalledWith(
      { __cmd: 'HeadBucket', input: { Bucket: 'training-datasets' } },
      expect.objectContaining({ abortSignal: expect.any(Object) }),
    );

    // Within the TTL: the cached answer, no second request.
    expect(await mod.probeRustFS(t0 + mod.PROBE_TTL_MS - 1)).toBe(first);
    expect(h.send).toHaveBeenCalledTimes(1);

    // After it: asked again, and the store is back.
    h.send.mockResolvedValue({});
    expect(await mod.probeRustFS(t0 + mod.PROBE_TTL_MS)).toMatchObject({ ok: true });
    expect(h.send).toHaveBeenCalledTimes(2);
  });
});
