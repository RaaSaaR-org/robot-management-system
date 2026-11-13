/**
 * @file fakeObjectStore.ts
 * @description An in-memory stand-in for the part of RustFS a direct upload
 *   drives (TASK-480): objects, open multipart uploads and their parts, with
 *   the S3 behaviours the upload depends on — a re-sent part replaces the
 *   earlier one, an open upload is not an object, `NoSuchUpload` after an
 *   abort or a complete.
 * @feature datasets
 */

import { Readable } from 'stream';
import type { UploadObjectStore } from '../UploadSink.js';

interface OpenUpload {
  key: string;
  parts: Map<number, Buffer>;
}

function noSuchUpload(): Error {
  return Object.assign(new Error('The specified multipart upload does not exist.'), { name: 'NoSuchUpload' });
}

/** Read `body` to its end, or reject as the SDK does when `signal` fires. */
async function drain(body: Readable | Buffer, signal?: AbortSignal): Promise<Buffer> {
  if (Buffer.isBuffer(body)) return body;
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const onAbort = () => reject(Object.assign(new Error('Request aborted'), { name: 'AbortError' }));
    if (signal?.aborted) return onAbort();
    signal?.addEventListener('abort', onAbort, { once: true });
    body.on('data', (chunk: Buffer) => chunks.push(chunk));
    body.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

export class FakeObjectStore implements UploadObjectStore {
  readonly objects = new Map<string, Buffer>();
  readonly uploads = new Map<string, OpenUpload>();
  /** Every call, by name, for the tests that pin which S3 operations ran. */
  readonly calls: string[] = [];
  private nextId = 1;

  private objectKey(bucket: string, key: string): string {
    return `${bucket}/${key}`;
  }

  async createMultipartUpload(bucket: string, key: string): Promise<string> {
    this.calls.push('createMultipartUpload');
    const id = `upload-${this.nextId++}`;
    this.uploads.set(id, { key: this.objectKey(bucket, key), parts: new Map() });
    return id;
  }

  async uploadPartStream(
    _bucket: string, _key: string, uploadId: string, partNumber: number,
    body: Readable | Buffer, length: number, signal?: AbortSignal,
  ): Promise<string> {
    this.calls.push('uploadPart');
    const data = await drain(body, signal);
    const upload = this.uploads.get(uploadId);
    if (!upload) throw noSuchUpload();
    if (data.length !== length) throw Object.assign(new Error('IncompleteBody'), { name: 'IncompleteBody' });
    upload.parts.set(partNumber, data);
    return `"etag-${partNumber}-${data.length}"`;
  }

  async listParts(_bucket: string, _key: string, uploadId: string) {
    this.calls.push('listParts');
    const upload = this.uploads.get(uploadId);
    if (!upload) throw noSuchUpload();
    return [...upload.parts.entries()]
      .sort(([a], [b]) => a - b)
      .map(([partNumber, data]) => ({ partNumber, size: data.length, etag: `"etag-${partNumber}-${data.length}"` }));
  }

  async completeMultipartUpload(
    _bucket: string, _key: string, uploadId: string, parts: Array<{ partNumber: number; etag: string }>,
  ): Promise<void> {
    this.calls.push('completeMultipartUpload');
    const upload = this.uploads.get(uploadId);
    if (!upload) throw noSuchUpload();
    this.objects.set(upload.key, Buffer.concat(parts.map((p) => upload.parts.get(p.partNumber) ?? Buffer.alloc(0))));
    this.uploads.delete(uploadId);
  }

  async abortMultipartUpload(_bucket: string, _key: string, uploadId: string): Promise<void> {
    this.calls.push('abortMultipartUpload');
    if (!this.uploads.delete(uploadId)) throw noSuchUpload();
  }

  async listMultipartUploads(bucket: string, prefix?: string) {
    return [...this.uploads.entries()]
      .filter(([, upload]) => upload.key.startsWith(`${bucket}/${prefix ?? ''}`))
      .map(([uploadId, upload]) => ({ key: upload.key.slice(bucket.length + 1), uploadId, initiated: new Date() }));
  }

  async putObjectStream(bucket: string, key: string, body: Readable | Buffer, length: number, options?: { signal?: AbortSignal }): Promise<void> {
    this.calls.push('putObject');
    const data = await drain(body, options?.signal);
    if (data.length !== length) throw Object.assign(new Error('IncompleteBody'), { name: 'IncompleteBody' });
    this.objects.set(this.objectKey(bucket, key), data);
  }

  async *listAll(bucket: string, prefix = '') {
    for (const [key, data] of this.objects) {
      if (!key.startsWith(`${bucket}/${prefix}`)) continue;
      yield { key: key.slice(bucket.length + 1), size: data.length, lastModified: new Date() };
    }
  }

  async delete(bucket: string, key: string): Promise<void> {
    this.calls.push('delete');
    this.objects.delete(this.objectKey(bucket, key));
  }

  async deletePrefix(bucket: string, prefix: string): Promise<number> {
    this.calls.push('deletePrefix');
    let deleted = 0;
    for (const key of [...this.objects.keys()]) {
      if (key.startsWith(`${bucket}/${prefix}`)) {
        this.objects.delete(key);
        deleted++;
      }
    }
    return deleted;
  }

  async getStream(bucket: string, key: string, range?: { start: number; end: number }): Promise<Readable> {
    const data = this.objects.get(this.objectKey(bucket, key));
    if (!data) throw Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' });
    return Readable.from([range ? data.subarray(range.start, range.end + 1) : data]);
  }

  /** Keys of the objects in `bucket`, sorted. */
  keys(bucket: string): string[] {
    return [...this.objects.keys()].filter((k) => k.startsWith(`${bucket}/`)).map((k) => k.slice(bucket.length + 1)).sort();
  }
}
