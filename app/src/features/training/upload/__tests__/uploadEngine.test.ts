/**
 * @file uploadEngine.test.ts
 * @description The rules of sending a dataset in parts: which refusals are
 *              re-sent and after how long, which bytes a part covers, never
 *              more than three requests at once, stopping at the first refusal
 *              a retry cannot fix, and a progress count that never claims a
 *              part the server did not keep.
 * @feature training
 */

import { describe, expect, it, vi } from 'vitest';
import { UploadRefusal, type PartAck, type PartRequest, type UploadStatusResponse } from '../../api/datasetUploadApi';
import {
  DEFAULT_TUNING, UploadProgress, backoffMs, classifyRefusal, partCount, partRange, planFiles,
  sendAndFinish, sendParts, withControlRetry, type PlannedFile, type Sleep,
} from '../uploadEngine';

const CHUNK = 10;
const noSleep: Sleep = () => Promise.resolve();
const noHash = () => Promise.resolve(undefined);

/** A stand-in for a File: only `size` and `slice().arrayBuffer()` are used. */
function blob(size: number): Blob {
  return {
    size,
    slice: (start: number, end: number) => ({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(end - start)) }),
  } as unknown as Blob;
}

function planned(id: number, size: number, missing?: number[]): PlannedFile {
  const count = partCount(size, CHUNK);
  return {
    id, path: `videos/file-${id}.mp4`, size, blob: blob(size), partCount: count,
    missing: missing ?? Array.from({ length: count }, (_, i) => i + 1),
  };
}

const ack = (req: PartRequest): PartAck => ({
  fileId: req.fileId, partNumber: req.partNumber, size: (req.body as ArrayBuffer).byteLength,
});

const refusal = (status: number, code: string, retryAfter: number | null = null) =>
  new UploadRefusal({ status, code, message: `${code} happened`, retryAfter });

describe('classifyRefusal', () => {
  it('re-sends exactly what the contract calls worth retrying', () => {
    expect(classifyRefusal(429, 'HTTP_429')).toBe('transient');
    expect(classifyRefusal(502, 'STORE_ERROR')).toBe('transient');
    expect(classifyRefusal(503, 'STORAGE_UNAVAILABLE')).toBe('transient');
    expect(classifyRefusal(400, 'PART_INTERRUPTED')).toBe('transient');
    expect(classifyRefusal(422, 'CHECKSUM_MISMATCH')).toBe('transient');
    expect(classifyRefusal(500, 'UPLOAD_ERROR')).toBe('transient');
    // No answer at all: the network, a timeout.
    expect(classifyRefusal(0, 'NETWORK_ERROR')).toBe('transient');
    // A proxy's own 5xx carries no code.
    expect(classifyRefusal(504, 'HTTP_504')).toBe('transient');
  });

  it('waits out a busy server without counting it as a failure', () => {
    expect(classifyRefusal(503, 'UPLOAD_BUSY')).toBe('busy');
  });

  it('stops on everything a second attempt cannot change', () => {
    expect(classifyRefusal(400, 'PART_SIZE_MISMATCH')).toBe('fatal');
    expect(classifyRefusal(400, 'INVALID_CHECKSUM')).toBe('fatal');
    expect(classifyRefusal(404, 'UNKNOWN_FILE')).toBe('fatal');
    expect(classifyRefusal(404, 'NOT_FOUND')).toBe('fatal');
    expect(classifyRefusal(409, 'UPLOAD_NOT_ACCEPTING')).toBe('fatal');
    expect(classifyRefusal(411, 'LENGTH_REQUIRED')).toBe('fatal');
    expect(classifyRefusal(413, 'PART_SIZE_MISMATCH')).toBe('fatal');
    expect(classifyRefusal(415, 'UNSUPPORTED_MEDIA_TYPE')).toBe('fatal');
    expect(classifyRefusal(401, 'HTTP_401')).toBe('fatal');
    expect(classifyRefusal(403, 'HTTP_403')).toBe('fatal');
    expect(classifyRefusal(507, 'INSUFFICIENT_STORAGE')).toBe('fatal');
    expect(classifyRefusal(0, 'ABORTED')).toBe('fatal');
  });
});

describe('backoffMs', () => {
  const none = () => 0;
  it('doubles from one second and is capped at thirty', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map((n) => backoffMs(n, null, DEFAULT_TUNING, none)))
      .toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]);
  });

  it('is never shorter than the Retry-After the server sent', () => {
    expect(backoffMs(1, 5, DEFAULT_TUNING, none)).toBe(5000);
    expect(backoffMs(4, 2, DEFAULT_TUNING, none)).toBe(8000);
    expect(backoffMs(1, 600, DEFAULT_TUNING, none)).toBe(30000);
  });

  it('adds at most a quarter of jitter', () => {
    expect(backoffMs(2, null, DEFAULT_TUNING, () => 1)).toBe(2500);
  });
});

describe('parts', () => {
  it('counts parts the way the server does — an empty file still has one', () => {
    expect(partCount(0, CHUNK)).toBe(1);
    expect(partCount(1, CHUNK)).toBe(1);
    expect(partCount(10, CHUNK)).toBe(1);
    expect(partCount(11, CHUNK)).toBe(2);
    expect(partCount(208492163, 8 * 1024 * 1024)).toBe(25);
  });

  it('gives every part but the last exactly one chunk', () => {
    expect(partRange(25, CHUNK, 1)).toEqual([0, 10]);
    expect(partRange(25, CHUNK, 2)).toEqual([10, 20]);
    expect(partRange(25, CHUNK, 3)).toEqual([20, 25]);
    expect(partRange(0, CHUNK, 1)).toEqual([0, 0]);
  });
});

describe('planFiles', () => {
  const local = new Map<string, Blob>([['a.mp4', blob(25)], ['meta/info.json', blob(4)]]);

  it('plans every part after a start, and only the missing ones after a status', () => {
    const fresh = planFiles([{ id: 0, path: 'a.mp4', size: 25, partCount: 3 }], local);
    expect(fresh[0].missing).toEqual([1, 2, 3]);

    const resumed = planFiles([
      { id: 0, path: 'a.mp4', size: 25, partCount: 3, complete: false, receivedParts: [1, 3] },
      { id: 1, path: 'meta/info.json', size: 4, partCount: 1, complete: true, receivedParts: [] },
    ], local);
    expect(resumed[0].missing).toEqual([2]);
    expect(resumed[1].missing).toEqual([]);
  });

  it('refuses to continue with a file that changed or is gone', () => {
    expect(() => planFiles([{ id: 0, path: 'a.mp4', size: 26, partCount: 3 }], local))
      .toThrowError(expect.objectContaining({ code: 'LOCAL_FILE_CHANGED' }));
    expect(() => planFiles([{ id: 0, path: 'gone.mp4', size: 1, partCount: 1 }], local))
      .toThrowError(expect.objectContaining({ code: 'LOCAL_FILE_MISSING' }));
  });
});

describe('UploadProgress', () => {
  it('starts a resumed upload at what the server already holds', () => {
    const progress = new UploadProgress([planned(0, 25, [3]), planned(1, 10, [])], CHUNK);
    expect(progress.totalBytes).toBe(35);
    expect(progress.sentBytes()).toBe(30);
    expect(progress.fileDone(1)).toBe(true);
    expect(progress.filesDone()).toBe(1);
  });

  it('takes back the bytes of an attempt that failed', () => {
    const progress = new UploadProgress([planned(0, 25)], CHUNK);
    progress.partProgress(0, 1, 7);
    expect(progress.sentBytes()).toBe(7);
    progress.partFailed(0, 1);
    expect(progress.sentBytes()).toBe(0);
    progress.partProgress(0, 1, 10);
    progress.partStored(0, 1, 10);
    expect(progress.sentBytes()).toBe(10);
    expect(progress.fileDone(0)).toBe(false);
  });
});

describe('sendParts', () => {
  const base = (files: PlannedFile[], transport: (req: PartRequest) => Promise<PartAck>) => ({
    datasetId: 'ds', files, chunkSize: CHUNK, transport,
    progress: new UploadProgress(files, CHUNK), sleep: noSleep, hash: noHash,
  });

  it('sends every missing part with its exact bytes and never more than three at once', async () => {
    const files = [planned(0, 95), planned(1, 0), planned(2, 30, [2])];
    let inFlight = 0;
    let most = 0;
    const seen: string[] = [];
    const options = base(files, async (req) => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      seen.push(`${req.fileId}:${req.partNumber}:${(req.body as ArrayBuffer).byteLength}`);
      return ack(req);
    });
    await sendParts(options);

    expect(most).toBe(3);
    expect(seen.sort()).toEqual([
      '0:10:5', '0:1:10', '0:2:10', '0:3:10', '0:4:10', '0:5:10', '0:6:10', '0:7:10', '0:8:10', '0:9:10',
      '1:1:0', // the empty file's one part of zero bytes
      '2:2:10',
    ].sort());
    expect(options.progress.sentBytes()).toBe(125);
    expect(options.progress.filesDone()).toBe(3);
  });

  it('sends the hash of the bytes it sends', async () => {
    const transport = vi.fn(async (req: PartRequest) => ack(req));
    await sendParts({ ...base([planned(0, 5)], transport), hash: async (bytes) => `hash-of-${bytes.byteLength}` });
    expect(transport.mock.calls[0][0].sha256).toBe('hash-of-5');
  });

  it('re-sends a part after a transient refusal, pausing with backoff', async () => {
    const sleep = vi.fn(noSleep);
    let calls = 0;
    const options = {
      ...base([planned(0, 5)], async (req) => {
        calls += 1;
        if (calls === 1) throw refusal(502, 'STORE_ERROR');
        if (calls === 2) throw refusal(0, 'NETWORK_ERROR');
        return ack(req);
      }),
      sleep,
    };
    await sendParts(options);
    expect(calls).toBe(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    // 1 s then 2 s, each with up to a quarter of jitter.
    expect(sleep.mock.calls[0][0]).toBeGreaterThanOrEqual(1000);
    expect(sleep.mock.calls[0][0]).toBeLessThanOrEqual(1250);
    expect(sleep.mock.calls[1][0]).toBeGreaterThanOrEqual(2000);
    expect(options.progress.sentBytes()).toBe(5);
  });

  it('waits Retry-After on UPLOAD_BUSY, as often as it takes, without using up attempts', async () => {
    const sleep = vi.fn(noSleep);
    let calls = 0;
    await sendParts({
      ...base([planned(0, 5)], async (req) => {
        calls += 1;
        // Far more busy answers than a part has attempts.
        if (calls <= 20) throw refusal(503, 'UPLOAD_BUSY', 2);
        return ack(req);
      }),
      sleep,
    });
    expect(calls).toBe(21);
    expect(sleep.mock.calls.every(([ms]) => ms === 2000)).toBe(true);
  });

  it('gives up on a part after six transient failures and says which part', async () => {
    const transport = vi.fn(async () => { throw refusal(503, 'STORAGE_UNAVAILABLE'); });
    await expect(sendParts(base([planned(0, 5)], transport))).rejects.toMatchObject({
      code: 'STORAGE_UNAVAILABLE',
      context: expect.objectContaining({ path: 'videos/file-0.mp4', partNumber: 1, attempts: 6 }),
    });
    expect(transport).toHaveBeenCalledTimes(6);
  });

  it('stops at once on a refusal a retry cannot fix, and stops the parts in flight', async () => {
    const signals: AbortSignal[] = [];
    let calls = 0;
    const transport = async (req: PartRequest): Promise<PartAck> => {
      calls += 1;
      signals.push(req.signal!);
      if (req.partNumber === 1) throw refusal(409, 'UPLOAD_NOT_ACCEPTING');
      // The others hang until they are aborted.
      return new Promise<PartAck>((_resolve, reject) => {
        req.signal!.addEventListener('abort', () => reject(new UploadRefusal({ status: 0, code: 'ABORTED', message: 'stopped' })));
      });
    };
    await expect(sendParts(base([planned(0, 95)], transport))).rejects.toMatchObject({ code: 'UPLOAD_NOT_ACCEPTING' });
    // Three were started; none of the remaining seven was.
    expect(calls).toBe(3);
    expect(signals.every((s) => s.aborted)).toBe(true);
  });

  it('re-sends a part the server says it stored with other bytes', async () => {
    let calls = 0;
    await sendParts({
      ...base([planned(0, 5)], async (req) => {
        calls += 1;
        return { ...ack(req), sha256: calls === 1 ? 'ffff' : 'abcd' };
      }),
      hash: async () => 'abcd',
    });
    expect(calls).toBe(2);
  });

  it('stops when the caller aborts', async () => {
    const controller = new AbortController();
    const transport = (req: PartRequest) => new Promise<PartAck>((_resolve, reject) => {
      req.signal!.addEventListener('abort', () => reject(new UploadRefusal({ status: 0, code: 'ABORTED', message: 'stopped' })));
      controller.abort();
    });
    await expect(sendParts({ ...base([planned(0, 95)], transport), signal: controller.signal }))
      .rejects.toMatchObject({ code: 'ABORTED' });
  });
});

describe('withControlRetry', () => {
  it('waits out a rate limit', async () => {
    const call = vi.fn()
      .mockRejectedValueOnce(refusal(429, 'HTTP_429', 1))
      .mockResolvedValueOnce('ok');
    await expect(withControlRetry(call, { retryNetwork: false, sleep: noSleep })).resolves.toBe('ok');
    expect(call).toHaveBeenCalledTimes(2);
  });

  it('never re-sends a start that died on the wire or at a proxy — it may have created the dataset', async () => {
    const network = vi.fn().mockRejectedValue(refusal(0, 'NETWORK_ERROR'));
    await expect(withControlRetry(network, { retryNetwork: false, sleep: noSleep })).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    expect(network).toHaveBeenCalledTimes(1);

    const proxy = vi.fn().mockRejectedValue(refusal(502, 'HTTP_502'));
    await expect(withControlRetry(proxy, { retryNetwork: false, sleep: noSleep })).rejects.toMatchObject({ status: 502 });
    expect(proxy).toHaveBeenCalledTimes(1);
  });

  it('re-sends a start the server itself refused as unavailable — that one created nothing', async () => {
    const call = vi.fn()
      .mockRejectedValueOnce(refusal(503, 'STORAGE_UNAVAILABLE'))
      .mockResolvedValueOnce('ok');
    await expect(withControlRetry(call, { retryNetwork: false, sleep: noSleep })).resolves.toBe('ok');
  });

  it('does not re-send a refusal that is an answer', async () => {
    const call = vi.fn().mockRejectedValue(refusal(400, 'NOT_A_LEROBOT_DATASET'));
    await expect(withControlRetry(call, { retryNetwork: true, sleep: noSleep })).rejects.toMatchObject({ code: 'NOT_A_LEROBOT_DATASET' });
    expect(call).toHaveBeenCalledTimes(1);
  });
});

describe('sendAndFinish', () => {
  it('sends what finish reports missing, then finishes again', async () => {
    const file = planned(0, 25);
    const local = new Map<string, Blob>([[file.path, file.blob]]);
    const sent: number[] = [];
    const status: UploadStatusResponse = {
      datasetId: 'ds', state: 'uploading', status: 'uploading', chunkSize: CHUNK, totalBytes: 25, receivedBytes: 20,
      totalFiles: 1, completedFiles: 0, readyToFinish: false, importError: null,
      files: [{ id: 0, path: file.path, size: 25, partCount: 3, complete: false, receivedParts: [1, 3] }],
    };
    const finish = vi.fn()
      .mockRejectedValueOnce(new UploadRefusal({ status: 409, code: 'UPLOAD_INCOMPLETE', message: '1 of 1 files are not fully uploaded' }))
      .mockResolvedValueOnce({ datasetId: 'ds', state: 'processing', status: 'uploading' });
    const onFinishing = vi.fn();

    const result = await sendAndFinish({
      api: { finish, status: vi.fn().mockResolvedValue(status) },
      datasetId: 'ds', files: [file], chunkSize: CHUNK, local,
      transport: async (req) => { sent.push(req.partNumber); return ack(req); },
      onProgress: () => {}, onFinishing, sleep: noSleep, hash: noHash,
    });

    expect(result.state).toBe('processing');
    // All three, then only the one the store had lost.
    expect(sent.sort()).toEqual([1, 2, 2, 3]);
    expect(finish).toHaveBeenCalledTimes(2);
    expect(onFinishing).toHaveBeenCalledTimes(2);
  });

  it('reports any other refusal of finish as it is', async () => {
    const file = planned(0, 5);
    await expect(sendAndFinish({
      api: {
        finish: vi.fn().mockRejectedValue(refusal(409, 'UPLOAD_NOT_ACCEPTING')),
        status: vi.fn(),
      },
      datasetId: 'ds', files: [file], chunkSize: CHUNK, local: new Map([[file.path, file.blob]]),
      transport: async (req) => ack(req), onProgress: () => {}, sleep: noSleep, hash: noHash,
    })).rejects.toMatchObject({ code: 'UPLOAD_NOT_ACCEPTING' });
  });
});
