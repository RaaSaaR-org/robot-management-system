/**
 * @file UploadSink.test.ts
 * @description The two places a direct upload writes to (TASK-480): what each
 *   sink stores for a part, what it reports as received, how a multi-part
 *   file becomes one file, and that discarding leaves nothing — no object, no
 *   open multipart upload, no staging file.
 * @feature datasets
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync } from 'fs';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { PassThrough } from 'stream';

const state = vi.hoisted(() => ({ root: '', rustfsUp: false, rustfsConfigured: false }));

vi.mock('../../DatasetService.js', () => ({
  datasetStorageRoot: () => state.root,
  datasetService: {},
}));

vi.mock('../../HuggingFaceImportService.js', async () => {
  const support = await import('./uploadTestSupport.js');
  return { selectRepoFiles: support.selectLeRobotFiles };
});

vi.mock('../../../storage/rustfs-client.js', () => ({
  getRustFSClient: () => { throw new Error('not used: the sink is given a store'); },
  getRustFSStatus: () => ({ state: 'unavailable', errorKind: 'connectivity' }),
  isRustFSConfigured: () => state.rustfsConfigured,
  isRustFSInitialized: () => state.rustfsUp,
}));

import {
  abortMultipartUploadsUnder,
  createUploadSink,
  LocalUploadSink,
  localStagingDir,
  openUploadSink,
  RustFsUploadSink,
  UploadAbortedError,
} from '../UploadSink.js';
import { partCountOf, type UploadFileEntry } from '../uploadManifest.js';
import { FakeObjectStore } from './fakeObjectStore.js';
import { CHUNK, MIB, TREE, VIDEO, partOf, streamOf } from './uploadTestSupport.js';

const BUCKET = 'training-datasets';

function entries(): UploadFileEntry[] {
  return Object.entries(TREE).map(([path, data], id) => ({
    id, path, size: data.length, partCount: partCountOf(data.length, CHUNK),
  }));
}

async function send(
  sink: LocalUploadSink | RustFsUploadSink,
  file: UploadFileEntry,
  partNumber: number,
  data = partOf(TREE[file.path], partNumber),
): Promise<void> {
  const pending = await sink.writePart(file, partNumber, streamOf(data), data.length, CHUNK, new AbortController().signal);
  await pending.commit();
}

beforeEach(async () => {
  state.root = await mkdtemp(join(tmpdir(), 'upload-sink-'));
  state.rustfsUp = false;
  state.rustfsConfigured = false;
});

afterEach(async () => {
  await rm(state.root, { recursive: true, force: true });
});

describe('RustFsUploadSink', () => {
  let store: FakeObjectStore;
  let sink: RustFsUploadSink;
  let files: UploadFileEntry[];
  let video: UploadFileEntry;

  beforeEach(async () => {
    store = new FakeObjectStore();
    sink = new RustFsUploadSink('prefix-1', () => store, BUCKET);
    files = await sink.prepare(entries());
    video = files.find((f) => f.path === VIDEO)!;
  });

  it('stores under the prefix with exactly one trailing slash', () => {
    expect(sink.storagePath).toBe('prefix-1/');
    expect(new RustFsUploadSink('prefix-2/', () => store).storagePath).toBe('prefix-2/');
  });

  it('opens a multipart upload for a file of several parts and none for a small one', () => {
    expect(files.filter((f) => f.uploadId).map((f) => f.path)).toEqual([VIDEO]);
    expect(store.uploads.size).toBe(1);
  });

  it('puts a one-part file as a single object at its final key', async () => {
    await send(sink, files[0], 1);

    expect(store.keys(BUCKET)).toEqual(['prefix-1/meta/info.json']);
    expect(store.objects.get(`${BUCKET}/prefix-1/meta/info.json`)).toEqual(TREE['meta/info.json']);
    expect(store.calls).toContain('putObject');
  });

  it('reports the parts the store holds, and nothing for an untouched file', async () => {
    await send(sink, files[0], 1);
    await send(sink, video, 3);
    await send(sink, video, 1);

    const received = await sink.received(files, CHUNK);

    expect(received.get(files[0].id)).toEqual({ complete: true, parts: [1] });
    expect(received.get(video.id)).toEqual({ complete: false, parts: [1, 3] });
    expect(received.get(files[1].id)).toEqual({ complete: false, parts: [] });
  });

  it('does not count a part of the wrong length, and a re-sent part replaces it', async () => {
    const rollback = await sink.writePart(video, 2, streamOf(partOf(TREE[VIDEO], 2)), CHUNK, CHUNK, new AbortController().signal);
    await rollback.rollback();
    expect((await sink.received(files, CHUNK)).get(video.id)?.parts).toEqual([]);

    await send(sink, video, 2);
    expect((await sink.received(files, CHUNK)).get(video.id)?.parts).toEqual([2]);
  });

  it('rolls a one-part file back by deleting its object', async () => {
    const pending = await sink.writePart(files[0], 1, streamOf(TREE['meta/info.json']), files[0].size, CHUNK, new AbortController().signal);
    await pending.rollback();

    expect(store.keys(BUCKET)).toEqual([]);
  });

  it('assembles the parts into one object with the original bytes and closes the upload', async () => {
    for (const n of [2, 3, 1]) await send(sink, video, n);

    await sink.assemble(video, CHUNK);

    expect(store.objects.get(`${BUCKET}/prefix-1/${VIDEO}`)?.equals(TREE[VIDEO])).toBe(true);
    expect(store.uploads.size).toBe(0);
    expect((await sink.received(files, CHUNK)).get(video.id)).toEqual({ complete: true, parts: [1, 2, 3] });
  });

  it('refuses to assemble while a part is missing', async () => {
    await send(sink, video, 1);
    await send(sink, video, 3);

    await expect(sink.assemble(video, CHUNK)).rejects.toThrow('holds 2 of 3 parts');
    expect(store.uploads.size).toBe(1);
  });

  it('rejects as aborted when the request is stopped mid-part, and keeps no part', async () => {
    const controller = new AbortController();
    const body = new PassThrough();
    body.write(Buffer.alloc(1000));
    setTimeout(() => controller.abort(), 10);

    await expect(sink.writePart(video, 1, body, CHUNK, CHUNK, controller.signal)).rejects.toBeInstanceOf(UploadAbortedError);
    expect((await sink.received(files, CHUNK)).get(video.id)?.parts).toEqual([]);
  });

  it('discards everything: open multipart uploads aborted, objects deleted', async () => {
    await send(sink, files[0], 1);
    await send(sink, video, 1);
    store.objects.set(`${BUCKET}/other-prefix/meta/info.json`, Buffer.from('{}'));

    await sink.discard(files);

    expect(store.uploads.size).toBe(0);
    expect(store.keys(BUCKET)).toEqual(['other-prefix/meta/info.json']);
  });

  it('discards after a multipart upload was already completed or aborted elsewhere', async () => {
    for (const n of [1, 2, 3]) await send(sink, video, n);
    await sink.assemble(video, CHUNK);

    await expect(sink.discard(files)).resolves.toBeUndefined();
    expect(store.keys(BUCKET)).toEqual([]);
  });

  it('answers free space only when a capacity is declared: capacity minus what the buckets hold', async () => {
    await send(sink, files[1], 1);
    expect(await sink.freeBytes(null)).toBeNull();
    expect(await sink.freeBytes(10_000)).toBe(10_000 - files[1].size);
    expect(await sink.freeBytes(10)).toBe(0);
  });

  it('aborts only the multipart uploads under the given prefix', async () => {
    const other = new RustFsUploadSink('prefix-9', () => store, BUCKET);
    await other.prepare(entries());

    await expect(abortMultipartUploadsUnder('prefix-1/', store, BUCKET)).resolves.toBe(1);
    expect([...store.uploads.values()].map((u) => u.key)).toEqual([`${BUCKET}/prefix-9/${VIDEO}`]);
    await expect(abortMultipartUploadsUnder('', store, BUCKET)).rejects.toThrow('empty prefix');
  });
});

describe('LocalUploadSink', () => {
  let sink: LocalUploadSink;
  let root: string;
  let files: UploadFileEntry[];
  let video: UploadFileEntry;

  beforeEach(async () => {
    root = join(state.root, 'storage-1');
    sink = new LocalUploadSink(root);
    files = await sink.prepare(entries());
    video = files.find((f) => f.path === VIDEO)!;
  });

  it('names the directory as its storagePath and creates it at once', () => {
    expect(sink.storagePath).toBe(`${root}/`);
    expect(existsSync(root)).toBe(true);
    expect(files.every((f) => f.uploadId === undefined)).toBe(true);
  });

  it('writes a one-part file to its final path only on commit', async () => {
    const pending = await sink.writePart(files[0], 1, streamOf(TREE['meta/info.json']), files[0].size, CHUNK, new AbortController().signal);
    expect(existsSync(join(root, 'meta/info.json'))).toBe(false);

    await pending.commit();

    expect(await readFile(join(root, 'meta/info.json'))).toEqual(TREE['meta/info.json']);
  });

  it('leaves nothing behind when a part is rolled back', async () => {
    const pending = await sink.writePart(files[0], 1, streamOf(TREE['meta/info.json']), files[0].size, CHUNK, new AbortController().signal);
    await pending.rollback();

    expect(existsSync(join(root, 'meta/info.json'))).toBe(false);
    expect(await readdir(localStagingDir(root))).toEqual([]);
  });

  it('keeps the parts of a large file outside the dataset tree until it is assembled', async () => {
    await send(sink, video, 3);
    await send(sink, video, 1);

    expect(existsSync(join(root, VIDEO))).toBe(false);
    expect(existsSync(join(root, 'videos'))).toBe(false);
    expect((await sink.received(files, CHUNK)).get(video.id)).toEqual({ complete: false, parts: [1, 3] });
  });

  it('ignores a staged part of the wrong length', async () => {
    await send(sink, video, 1);
    await writeFile(join(localStagingDir(root), String(video.id), '2'), Buffer.alloc(10));

    expect((await sink.received(files, CHUNK)).get(video.id)?.parts).toEqual([1]);
  });

  it('assembles the parts into the original file and clears their staging', async () => {
    for (const n of [3, 1, 2]) await send(sink, video, n);

    await sink.assemble(video);

    expect((await readFile(join(root, VIDEO))).equals(TREE[VIDEO])).toBe(true);
    expect(existsSync(join(localStagingDir(root), String(video.id)))).toBe(false);
    expect((await sink.received(files, CHUNK)).get(video.id)).toEqual({ complete: true, parts: [1, 2, 3] });
  });

  it('rejects as aborted when the request is stopped mid-part, and removes the partial file', async () => {
    const controller = new AbortController();
    const body = new PassThrough();
    body.write(Buffer.alloc(1000));
    setTimeout(() => controller.abort(), 10);

    await expect(sink.writePart(video, 1, body, CHUNK, CHUNK, controller.signal)).rejects.toBeInstanceOf(UploadAbortedError);
    expect(await readdir(localStagingDir(root))).toEqual([]);
  });

  it('refuses a file entry whose path would leave the dataset root', async () => {
    const escaping = { id: 9, path: '../outside.txt', size: 3, partCount: 1 };
    await expect(sink.writePart(escaping, 1, streamOf(Buffer.from('abc')), 3, CHUNK, new AbortController().signal))
      .rejects.toMatchObject({ code: 'INVALID_PATH' });
    expect(existsSync(join(state.root, 'outside.txt'))).toBe(false);
  });

  it('discards the tree and the staging directory', async () => {
    await send(sink, files[0], 1);
    await send(sink, video, 1);

    await sink.discard();

    expect(existsSync(root)).toBe(false);
    expect(existsSync(localStagingDir(root))).toBe(false);
  });

  it('reports free space on the volume', async () => {
    expect(await sink.freeBytes()).toBeGreaterThan(MIB);
  });
});

describe('choosing the sink', () => {
  it('writes to the local dataset root when no object store is configured', () => {
    const sink = createUploadSink('abc');
    expect(sink.kind).toBe('local');
    expect(sink.storagePath).toBe(`${join(state.root, 'abc')}/`);
  });

  it('writes to RustFS when it is up', () => {
    state.rustfsConfigured = true;
    state.rustfsUp = true;
    const sink = createUploadSink('abc');
    expect(sink.kind).toBe('rustfs');
    expect(sink.storagePath).toBe('abc/');
  });

  it('refuses with 503 while RustFS is configured but down — never the local disk', () => {
    state.rustfsConfigured = true;
    expect(() => createUploadSink('abc')).toThrowError(expect.objectContaining({ code: 'STORAGE_UNAVAILABLE', statusCode: 503 }));
    expect(() => openUploadSink('rustfs', 'abc/')).toThrowError(expect.objectContaining({ code: 'STORAGE_UNAVAILABLE' }));
  });

  it('reopens a local upload by the path it was started with, not by today\'s configuration', () => {
    state.rustfsConfigured = true;
    state.rustfsUp = true;
    expect(openUploadSink('local', `${join(state.root, 'abc')}/`).kind).toBe('local');
  });

  it('refuses a local path outside the dataset root that does not exist', () => {
    expect(() => openUploadSink('local', '/nonexistent-root/abc/')).toThrowError(expect.objectContaining({ code: 'STORAGE_UNAVAILABLE' }));
  });
});
