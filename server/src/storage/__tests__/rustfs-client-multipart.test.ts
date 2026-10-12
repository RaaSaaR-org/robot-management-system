/**
 * @file rustfs-client-multipart.test.ts
 * @description What happens to a multipart upload `RustFSClient.upload()` does
 *   not finish (TASK-379). Unlike `rustfs-client.test.ts` nothing here mocks
 *   `@aws-sdk/lib-storage`: the real `Upload` runs against a real `S3Client`
 *   whose `send` is stubbed, so the tests pin lib-storage's own behaviour —
 *   that a failed or aborted upload sends `AbortMultipartUploadCommand` — and
 *   would catch a version that stopped doing it.
 * @feature storage
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Readable } from 'stream';
import { RustFSClient } from '../rustfs-client.js';

/** lib-storage's minimum part size; a body larger than one part goes multipart. */
const PART = 5 * 1024 * 1024;

type Sent = { name: string; input: Record<string, unknown> };

let client: RustFSClient;
let sent: Sent[];

beforeEach(() => {
  client = new RustFSClient({ endpoint: 'http://rustfs.test:9000', accessKeyId: 'k', secretAccessKey: 's' });
  sent = [];
  vi.spyOn(client.getClient(), 'send').mockImplementation((async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
    const name = command.constructor.name.replace(/Command$/, '');
    sent.push({ name, input: command.input });
    switch (name) {
      case 'CreateMultipartUpload':
        return { UploadId: 'upload-1' };
      case 'UploadPart':
        return { ETag: `"etag-${String(command.input.PartNumber)}"` };
      default:
        return {};
    }
  }) as never);
});

function names(): string[] {
  return sent.map((s) => s.name);
}

async function until(check: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out; sent: ${names().join(', ')}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

/** One part's worth plus a byte, then whatever `rest` does — so the upload is multipart. */
function multipartBody(rest: (stream: Readable) => void): Readable {
  const stream = new Readable({ read() {} });
  stream.push(Buffer.alloc(PART + 1));
  rest(stream);
  return stream;
}

describe('RustFSClient.upload multipart cleanup (TASK-379)', () => {
  it('completes a whole upload and aborts nothing', async () => {
    const body = multipartBody((s) => s.push(null));

    await client.upload('training-datasets', 'a/file.parquet', body);

    expect(names()).toEqual(['CreateMultipartUpload', 'UploadPart', 'UploadPart', 'CompleteMultipartUpload']);
  });

  it('aborts the multipart upload when the body fails (leavePartsOnError: false)', async () => {
    const body = multipartBody((s) => {
      setTimeout(() => s.destroy(new Error('hub connection reset')), 20);
    });

    await expect(client.upload('training-datasets', 'a/file.parquet', body)).rejects.toThrow('hub connection reset');

    await until(() => names().includes('AbortMultipartUpload'));
    expect(sent.find((s) => s.name === 'AbortMultipartUpload')!.input).toMatchObject({
      Bucket: 'training-datasets',
      Key: 'a/file.parquet',
      UploadId: 'upload-1',
    });
    expect(names()).not.toContain('CompleteMultipartUpload');
  });

  it('aborts the multipart upload when a part fails to store', async () => {
    const send = vi.mocked(client.getClient().send);
    const inner = send.getMockImplementation()!;
    send.mockImplementation((async (command: { constructor: { name: string } }) => {
      if (command.constructor.name === 'UploadPartCommand') throw new Error('disk full');
      return (inner as (c: unknown) => unknown)(command);
    }) as never);
    const body = multipartBody((s) => s.push(null));

    await expect(client.upload('training-datasets', 'a/file.parquet', body)).rejects.toThrow('disk full');

    await until(() => names().includes('AbortMultipartUpload'));
  });

  it('aborts the multipart upload on the store when the signal fires, even though the body stalls', async () => {
    const controller = new AbortController();
    // Never ends and never fails: a source that went quiet.
    const body = multipartBody(() => undefined);

    const done = client.upload('training-datasets', 'a/file.parquet', body, { signal: controller.signal });
    await until(() => names().includes('UploadPart'));
    controller.abort();

    await expect(done).rejects.toMatchObject({ name: 'AbortError' });
    await until(() => names().includes('AbortMultipartUpload'));
    expect(sent.find((s) => s.name === 'AbortMultipartUpload')!.input).toMatchObject({ UploadId: 'upload-1' });
    expect(names()).not.toContain('CompleteMultipartUpload');
    expect(body.destroyed).toBe(true);
  });

  it('rejects an already-aborted signal without a request to the store', async () => {
    const controller = new AbortController();
    controller.abort();
    const body = multipartBody((s) => s.push(null));

    await expect(
      client.upload('training-datasets', 'a/file.parquet', body, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(sent).toEqual([]);
  });

  it('leaves a signal that never fires without a listener once the upload is done', async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');

    await client.upload('training-datasets', 'small.json', Buffer.from('{}'), { signal: controller.signal });

    expect(names()).toEqual(['PutObject']);
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  });
});

describe('RustFSClient multipart listing and abort (TASK-379)', () => {
  it('lists every page of in-progress uploads', async () => {
    const send = vi.mocked(client.getClient().send);
    const initiated = new Date('2026-10-01T00:00:00Z');
    send
      .mockResolvedValueOnce({
        Uploads: [{ Key: 'a', UploadId: 'u1', Initiated: initiated }, { Key: 'skip-me' }],
        IsTruncated: true,
        NextKeyMarker: 'a',
        NextUploadIdMarker: 'u1',
      } as never)
      .mockResolvedValueOnce({ Uploads: [{ Key: 'b', UploadId: 'u2' }], IsTruncated: false } as never);

    const uploads = await client.listMultipartUploads('training-datasets');

    expect(uploads).toEqual([
      { key: 'a', uploadId: 'u1', initiated },
      { key: 'b', uploadId: 'u2', initiated: undefined },
    ]);
    const second = send.mock.calls[1]![0] as unknown as { input: Record<string, unknown> };
    expect(second.input).toMatchObject({ Bucket: 'training-datasets', KeyMarker: 'a', UploadIdMarker: 'u1' });
  });

  it('stops on a truncated page that names no next marker', async () => {
    vi.mocked(client.getClient().send).mockResolvedValue({ Uploads: [], IsTruncated: true } as never);

    await expect(client.listMultipartUploads('b')).resolves.toEqual([]);
    expect(client.getClient().send).toHaveBeenCalledTimes(1);
  });

  it('aborts one upload by bucket, key and id', async () => {
    await client.abortMultipartUpload('training-datasets', 'a/file', 'u9');

    expect(sent).toEqual([
      { name: 'AbortMultipartUpload', input: { Bucket: 'training-datasets', Key: 'a/file', UploadId: 'u9' } },
    ]);
  });
});
