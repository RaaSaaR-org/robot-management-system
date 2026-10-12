/**
 * @file multipart-upload-sweep.test.ts
 * @description The sweep that aborts multipart uploads a crash left behind
 *   (TASK-379). The store is a stub; the age cut-off, bucket iteration, error
 *   handling, env parsing and schedule run for real.
 * @feature storage
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../storage/index.js', () => ({
  BUCKETS: { A: 'bucket-a', B: 'bucket-b' },
  getRustFSClient: vi.fn(() => {
    throw new Error('the real client must not be reached');
  }),
  isRustFSInitialized: vi.fn(() => false),
}));

import {
  MultipartUploadSweep,
  multipartMaxAgeMs,
  multipartSweepIntervalMs,
  type MultipartSweepStore,
} from '../multipart-upload-sweep.js';
import type { MultipartUploadInfo } from '../../storage/index.js';

const HOUR = 60 * 60 * 1000;
const NOW = Date.parse('2026-10-12T12:00:00Z');

function hoursAgo(h: number): Date {
  return new Date(NOW - h * HOUR);
}

function makeStore(uploads: Record<string, MultipartUploadInfo[] | Error>) {
  const store = {
    listMultipartUploads: vi.fn(async (bucket: string) => {
      const entry = uploads[bucket] ?? [];
      if (entry instanceof Error) throw entry;
      return entry;
    }),
    abortMultipartUpload: vi.fn(async () => undefined),
  } satisfies MultipartSweepStore;
  return store;
}

function makeSweep(store: MultipartSweepStore, overrides: { enabled?: boolean; buckets?: string[] } = {}) {
  return new MultipartUploadSweep({
    store: () => store,
    enabled: () => overrides.enabled ?? true,
    buckets: () => overrides.buckets ?? ['bucket-a', 'bucket-b'],
    maxAgeMs: () => 24 * HOUR,
    intervalMs: () => 6 * HOUR,
    now: () => NOW,
  });
}

function s3Error(name: string): Error {
  return Object.assign(new Error(name), { name });
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  delete process.env.RUSTFS_MULTIPART_MAX_AGE_HOURS;
  delete process.env.RUSTFS_MULTIPART_SWEEP_INTERVAL_HOURS;
});

describe('MultipartUploadSweep.sweep (TASK-379)', () => {
  it('aborts uploads older than the cut-off in every bucket and keeps the young ones', async () => {
    const store = makeStore({
      'bucket-a': [
        { key: 'old/one', uploadId: 'u1', initiated: hoursAgo(30) },
        { key: 'young/one', uploadId: 'u2', initiated: hoursAgo(2) },
      ],
      'bucket-b': [{ key: 'old/two', uploadId: 'u3', initiated: hoursAgo(25) }],
    });

    const result = await makeSweep(store).sweep();

    expect(result).toEqual({ aborted: 2, kept: 1, errors: [] });
    expect(store.listMultipartUploads.mock.calls.map((c) => c[0])).toEqual(['bucket-a', 'bucket-b']);
    expect(store.abortMultipartUpload.mock.calls).toEqual([
      ['bucket-a', 'old/one', 'u1'],
      ['bucket-b', 'old/two', 'u3'],
    ]);
  });

  it('never aborts an upload whose start time is unknown', async () => {
    const store = makeStore({ 'bucket-a': [{ key: 'k', uploadId: 'u' }] });

    expect(await makeSweep(store).sweep()).toEqual({ aborted: 0, kept: 1, errors: [] });
    expect(store.abortMultipartUpload).not.toHaveBeenCalled();
  });

  it('skips a bucket that does not exist and records other listing failures', async () => {
    const store = makeStore({ 'bucket-a': s3Error('NoSuchBucket'), 'bucket-b': new Error('connection refused') });

    const result = await makeSweep(store).sweep();

    expect(result.aborted).toBe(0);
    expect(result.errors).toEqual(['bucket-b: listing multipart uploads failed: connection refused']);
  });

  it('keeps going past a failed abort and counts one another replica beat it to as gone', async () => {
    const store = makeStore({
      'bucket-a': [
        { key: 'a', uploadId: 'u1', initiated: hoursAgo(48) },
        { key: 'b', uploadId: 'u2', initiated: hoursAgo(48) },
        { key: 'c', uploadId: 'u3', initiated: hoursAgo(48) },
      ],
    });
    store.abortMultipartUpload
      .mockRejectedValueOnce(s3Error('NoSuchUpload'))
      .mockRejectedValueOnce(new Error('timeout'));

    const result = await makeSweep(store, { buckets: ['bucket-a'] }).sweep();

    expect(store.abortMultipartUpload).toHaveBeenCalledTimes(3);
    expect(result).toEqual({ aborted: 1, kept: 0, errors: ['bucket-a/b (u2): abort failed: timeout'] });
  });

  it('does nothing while RustFS is not initialized', async () => {
    const store = makeStore({});

    expect(await makeSweep(store, { enabled: false }).sweep()).toEqual({ aborted: 0, kept: 0, errors: [] });
    expect(store.listMultipartUploads).not.toHaveBeenCalled();
  });

  it('never throws, even when the client cannot be had', async () => {
    const sweep = new MultipartUploadSweep({
      store: () => {
        throw new Error('RustFS client not initialized');
      },
      enabled: () => true,
    });

    await expect(sweep.sweep()).resolves.toEqual({ aborted: 0, kept: 0, errors: ['RustFS client not initialized'] });
  });

  it('does not overlap a sweep still running', async () => {
    let release!: () => void;
    const store = makeStore({});
    store.listMultipartUploads.mockImplementationOnce(() => new Promise((r) => { release = () => r([]); }));
    const sweep = makeSweep(store, { buckets: ['bucket-a'] });

    const first = sweep.sweep();
    await sweep.sweep();
    release();
    await first;

    expect(store.listMultipartUploads).toHaveBeenCalledTimes(1);
  });
});

describe('MultipartUploadSweep schedule (TASK-379)', () => {
  it('sweeps at once, then every interval, until stopped', async () => {
    vi.useFakeTimers();
    const store = makeStore({});
    const sweep = makeSweep(store, { buckets: ['bucket-a'] });

    sweep.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.listMultipartUploads).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(6 * HOUR);
    expect(store.listMultipartUploads).toHaveBeenCalledTimes(2);

    sweep.stop();
    await vi.advanceTimersByTimeAsync(12 * HOUR);
    expect(store.listMultipartUploads).toHaveBeenCalledTimes(2);
  });

  it('keeps one interval when started again after a recovery', async () => {
    vi.useFakeTimers();
    const store = makeStore({});
    const sweep = makeSweep(store, { buckets: ['bucket-a'] });

    sweep.start();
    await vi.advanceTimersByTimeAsync(0);
    sweep.start();
    await vi.advanceTimersByTimeAsync(6 * HOUR);

    // two immediate sweeps, one interval tick — not two
    expect(store.listMultipartUploads).toHaveBeenCalledTimes(3);
    sweep.stop();
  });
});

describe('multipart sweep configuration (TASK-379)', () => {
  it('defaults to 24 h of age and a 6 h interval', () => {
    expect(multipartMaxAgeMs()).toBe(24 * HOUR);
    expect(multipartSweepIntervalMs()).toBe(6 * HOUR);
  });

  it('reads both from the environment', () => {
    process.env.RUSTFS_MULTIPART_MAX_AGE_HOURS = '48';
    process.env.RUSTFS_MULTIPART_SWEEP_INTERVAL_HOURS = '0.5';

    expect(multipartMaxAgeMs()).toBe(48 * HOUR);
    expect(multipartSweepIntervalMs()).toBe(0.5 * HOUR);
  });

  it('falls back to the default on a value that is not a positive number', () => {
    process.env.RUSTFS_MULTIPART_MAX_AGE_HOURS = '0';
    process.env.RUSTFS_MULTIPART_SWEEP_INTERVAL_HOURS = 'often';

    expect(multipartMaxAgeMs()).toBe(24 * HOUR);
    expect(multipartSweepIntervalMs()).toBe(6 * HOUR);
  });
});
