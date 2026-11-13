/**
 * @file rustfs-client-parts.test.ts
 * @description The S3 calls behind a direct dataset upload (TASK-480): a
 *   multipart upload driven one part per request, and a streamed single PUT.
 *   A real `S3Client` whose `send` is stubbed, so the commands and their
 *   inputs are what is pinned.
 * @feature storage
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Readable } from 'stream';
import { RustFSClient } from '../rustfs-client.js';

type Sent = { name: string; input: Record<string, unknown>; options?: { abortSignal?: AbortSignal } };

let client: RustFSClient;
let sent: Sent[];
let respond: (name: string, input: Record<string, unknown>) => unknown;

beforeEach(() => {
  client = new RustFSClient({ endpoint: 'http://rustfs.test:9000', accessKeyId: 'k', secretAccessKey: 's' });
  sent = [];
  respond = () => ({});
  vi.spyOn(client.getClient(), 'send').mockImplementation((async (
    command: { constructor: { name: string }; input: Record<string, unknown> },
    options?: { abortSignal?: AbortSignal },
  ) => {
    const name = command.constructor.name.replace(/Command$/, '');
    sent.push({ name, input: command.input, options });
    return respond(name, command.input);
  }) as never);
});

describe('RustFSClient part-by-part multipart upload (TASK-480)', () => {
  it('opens a multipart upload and returns its id', async () => {
    respond = () => ({ UploadId: 'up-1' });

    await expect(client.createMultipartUpload('b', 'p/videos/a.mp4', 'video/mp4')).resolves.toBe('up-1');
    expect(sent[0]).toMatchObject({
      name: 'CreateMultipartUpload',
      input: { Bucket: 'b', Key: 'p/videos/a.mp4', ContentType: 'video/mp4' },
    });
  });

  it('refuses a store that answers without an upload id', async () => {
    await expect(client.createMultipartUpload('b', 'k')).rejects.toThrow('no upload id');
  });

  it('streams a part with its exact length and hands the abort signal to the request', async () => {
    respond = () => ({ ETag: '"e1"' });
    const body = Readable.from([Buffer.from('abc')]);
    const controller = new AbortController();

    await expect(client.uploadPartStream('b', 'k', 'up-1', 3, body, 3, controller.signal)).resolves.toBe('"e1"');
    expect(sent[0].input).toMatchObject({ Bucket: 'b', Key: 'k', UploadId: 'up-1', PartNumber: 3, ContentLength: 3 });
    expect(sent[0].input.Body).toBe(body);
    expect(sent[0].options?.abortSignal).toBe(controller.signal);
  });

  it('lists every part across pages, in part-number order', async () => {
    respond = (_name, input) => input.PartNumberMarker === undefined
      ? { Parts: [{ PartNumber: 2, Size: 10, ETag: '"b"' }, { PartNumber: 1, Size: 10, ETag: '"a"' }], IsTruncated: true, NextPartNumberMarker: '2' }
      : { Parts: [{ PartNumber: 3, Size: 4, ETag: '"c"' }], IsTruncated: false };

    await expect(client.listParts('b', 'k', 'up-1')).resolves.toEqual([
      { partNumber: 1, size: 10, etag: '"a"' },
      { partNumber: 2, size: 10, etag: '"b"' },
      { partNumber: 3, size: 4, etag: '"c"' },
    ]);
    expect(sent.map((s) => s.input.PartNumberMarker)).toEqual([undefined, '2']);
  });

  it('completes with the part numbers and ETags it is given', async () => {
    await client.completeMultipartUpload('b', 'k', 'up-1', [
      { partNumber: 1, etag: '"a"' },
      { partNumber: 2, etag: '"b"' },
    ]);

    expect(sent[0]).toMatchObject({
      name: 'CompleteMultipartUpload',
      input: {
        Bucket: 'b', Key: 'k', UploadId: 'up-1',
        MultipartUpload: { Parts: [{ PartNumber: 1, ETag: '"a"' }, { PartNumber: 2, ETag: '"b"' }] },
      },
    });
  });

  it('asks the store for the multipart uploads under one prefix only', async () => {
    respond = () => ({ Uploads: [{ Key: 'p/a', UploadId: 'u1' }], IsTruncated: false });

    await expect(client.listMultipartUploads('b', 'p/')).resolves.toEqual([
      { key: 'p/a', uploadId: 'u1', initiated: undefined },
    ]);
    expect(sent[0].input).toMatchObject({ Bucket: 'b', Prefix: 'p/' });
  });

  it('streams a whole object in one PutObject with its length', async () => {
    const body = Readable.from([Buffer.from('{}')]);

    await client.putObjectStream('b', 'p/meta/info.json', body, 2, { contentType: 'application/json' });

    expect(sent[0]).toMatchObject({
      name: 'PutObject',
      input: { Bucket: 'b', Key: 'p/meta/info.json', ContentLength: 2, ContentType: 'application/json' },
    });
    expect(sent[0].input.Body).toBe(body);
  });
});
