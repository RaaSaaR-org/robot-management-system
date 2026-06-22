/**
 * @file kv-stores.test.ts
 * @description Unit tests for the NATS KV store helpers — store creation (with
 *   already-exists fallback), and the kvGet/kvPut/kvDelete/kvWatch/kvKeys
 *   helpers. The NATS JetStream client and KV handles are external boundaries
 *   and are faked; all encoding/decoding/JSON logic runs for real.
 * @feature messaging
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { JetStreamClient, KV } from 'nats';

import {
  KV_STORE_NAMES,
  createKVStores,
  kvGet,
  kvPut,
  kvDelete,
  kvWatch,
  kvKeys,
} from '../kv-stores.js';

// ---------------------------------------------------------------------------
// Helpers to build fake NATS objects (the only external boundary).
// ---------------------------------------------------------------------------

const encode = (value: unknown): Uint8Array =>
  new TextEncoder().encode(JSON.stringify(value));

/** A minimal fake KV handle whose methods are vi.fn() so we can assert/return. */
function makeFakeKV(overrides: Partial<Record<keyof KV, unknown>> = {}): KV {
  const base = {
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    watch: vi.fn(),
    keys: vi.fn(),
  };
  return { ...base, ...overrides } as unknown as KV;
}

/** A fake JetStream client exposing only views.kv (what the module uses). */
function makeFakeJS(kvImpl: (...args: unknown[]) => unknown): JetStreamClient {
  return {
    views: {
      kv: vi.fn(kvImpl),
    },
  } as unknown as JetStreamClient;
}

// Async iterable from a plain array (mirrors NATS keys()/watch() iterators).
async function* arrayAsyncIterable<T>(items: T[]): AsyncGenerator<T> {
  for (const item of items) {
    yield item;
  }
}

let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// KV_STORE_NAMES
// ---------------------------------------------------------------------------

describe('KV_STORE_NAMES', () => {
  it('exposes the three store names', () => {
    expect(KV_STORE_NAMES).toEqual({
      JOB_PROGRESS: 'JOB_PROGRESS',
      MODEL_REGISTRY: 'MODEL_REGISTRY',
      FLEET_CONFIG: 'FLEET_CONFIG',
    });
  });
});

// ---------------------------------------------------------------------------
// createKVStores
// ---------------------------------------------------------------------------

describe('createKVStores', () => {
  it('creates all three KV stores with their configured options', async () => {
    const kvFn = vi.fn(
      async (_name: string, _opts?: unknown): Promise<KV> => makeFakeKV()
    );
    const js = { views: { kv: kvFn } } as unknown as JetStreamClient;

    await createKVStores(js);

    // One call per store, all with an options object on first attempt.
    expect(kvFn).toHaveBeenCalledTimes(3);

    const names = kvFn.mock.calls.map((c) => c[0]);
    expect(names).toEqual([
      KV_STORE_NAMES.JOB_PROGRESS,
      KV_STORE_NAMES.MODEL_REGISTRY,
      KV_STORE_NAMES.FLEET_CONFIG,
    ]);

    // JOB_PROGRESS carries history + ttl; the others carry their own history.
    const jobOpts = kvFn.mock.calls[0][1] as Record<string, unknown>;
    expect(jobOpts.history).toBe(10);
    expect(jobOpts.ttl).toBe(60 * 60 * 1000);

    const modelOpts = kvFn.mock.calls[1][1] as Record<string, unknown>;
    expect(modelOpts.history).toBe(50);

    const fleetOpts = kvFn.mock.calls[2][1] as Record<string, unknown>;
    expect(fleetOpts.history).toBe(20);

    expect(logSpy).toHaveBeenCalledWith('[KVStores] All KV stores created successfully');
  });

  it('falls back to retrieving an existing store when creation throws', async () => {
    const fallbackKV = makeFakeKV();
    // First (options) call rejects, second (retrieve) call resolves.
    const kvFn = vi
      .fn(async (_name: string, _opts?: unknown): Promise<KV> => makeFakeKV())
      .mockImplementationOnce(async () => {
        throw new Error('already exists');
      })
      .mockImplementationOnce(async () => fallbackKV)
      // remaining stores succeed normally
      .mockImplementation(async () => makeFakeKV());

    const js = { views: { kv: kvFn } } as unknown as JetStreamClient;

    await expect(createKVStores(js)).resolves.toBeUndefined();

    // JOB_PROGRESS: create attempt (with opts) + retrieve attempt (name only) = 2 calls.
    // MODEL_REGISTRY + FLEET_CONFIG: 1 call each => total 4.
    expect(kvFn).toHaveBeenCalledTimes(4);
    // Second call is the retrieval: name only, no options argument.
    expect(kvFn.mock.calls[1]).toEqual([KV_STORE_NAMES.JOB_PROGRESS]);
  });

  it('propagates when both creation and retrieval fail', async () => {
    const kvFn = vi.fn(async () => {
      throw new Error('nats down');
    });
    const js = { views: { kv: kvFn } } as unknown as JetStreamClient;

    await expect(createKVStores(js)).rejects.toThrow('nats down');
  });
});

// ---------------------------------------------------------------------------
// kvGet
// ---------------------------------------------------------------------------

describe('kvGet', () => {
  it('decodes and JSON-parses a stored entry', async () => {
    const payload = { progress: 42, label: 'training' };
    const kv = makeFakeKV({
      get: vi.fn(async () => ({ value: encode(payload) })),
    });

    const result = await kvGet<typeof payload>(kv, 'job-1');
    expect(result).toEqual(payload);
    expect(vi.mocked(kv.get, true)).toHaveBeenCalledWith('job-1');
  });

  it('returns null when the entry is missing', async () => {
    const kv = makeFakeKV({ get: vi.fn(async () => null) });
    expect(await kvGet(kv, 'missing')).toBeNull();
  });

  it('returns null when the entry has no value', async () => {
    const kv = makeFakeKV({ get: vi.fn(async () => ({ value: undefined })) });
    expect(await kvGet(kv, 'empty')).toBeNull();
  });

  it('returns null when get() throws', async () => {
    const kv = makeFakeKV({
      get: vi.fn(async () => {
        throw new Error('boom');
      }),
    });
    expect(await kvGet(kv, 'k')).toBeNull();
  });

  it('returns null when the stored value is not valid JSON', async () => {
    const kv = makeFakeKV({
      get: vi.fn(async () => ({ value: new TextEncoder().encode('not-json{') })),
    });
    expect(await kvGet(kv, 'k')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// kvPut
// ---------------------------------------------------------------------------

describe('kvPut', () => {
  it('JSON-encodes the value and returns the revision', async () => {
    const put = vi.fn(async (_key: string, _data: Uint8Array): Promise<number> => 7);
    const kv = makeFakeKV({ put });

    const value = { a: 1, b: ['x', 'y'] };
    const rev = await kvPut(kv, 'cfg', value);

    expect(rev).toBe(7);
    expect(put).toHaveBeenCalledTimes(1);
    const [key, data] = put.mock.calls[0];
    expect(key).toBe('cfg');
    // The encoded bytes must round-trip back to the original value.
    expect(JSON.parse(new TextDecoder().decode(data))).toEqual(value);
  });

  it('round-trips with kvGet over the same encoding', async () => {
    let stored: Uint8Array | undefined;
    const kv = makeFakeKV({
      put: vi.fn(async (_k: string, d: Uint8Array) => {
        stored = d;
        return 1;
      }),
      get: vi.fn(async () => ({ value: stored })),
    });

    const value = { nested: { ok: true }, n: 3 };
    await kvPut(kv, 'rt', value);
    const back = await kvGet<typeof value>(kv, 'rt');
    expect(back).toEqual(value);
  });
});

// ---------------------------------------------------------------------------
// kvDelete
// ---------------------------------------------------------------------------

describe('kvDelete', () => {
  it('delegates to kv.delete with the key', async () => {
    const del = vi.fn(async () => undefined);
    const kv = makeFakeKV({ delete: del });

    await kvDelete(kv, 'doomed');
    expect(del).toHaveBeenCalledWith('doomed');
  });
});

// ---------------------------------------------------------------------------
// kvKeys
// ---------------------------------------------------------------------------

describe('kvKeys', () => {
  it('collects all keys from the iterator', async () => {
    const keys = vi.fn(async () => arrayAsyncIterable(['a', 'b', 'c']));
    const kv = makeFakeKV({ keys });

    const result = await kvKeys(kv);
    expect(result).toEqual(['a', 'b', 'c']);
    expect(keys).toHaveBeenCalledWith(undefined);
  });

  it('passes the filter through to kv.keys', async () => {
    const keys = vi.fn(async () => arrayAsyncIterable(['job.1']));
    const kv = makeFakeKV({ keys });

    const result = await kvKeys(kv, 'job.*');
    expect(result).toEqual(['job.1']);
    expect(keys).toHaveBeenCalledWith('job.*');
  });

  it('returns an empty array when there are no keys', async () => {
    const keys = vi.fn(async () => arrayAsyncIterable<string>([]));
    const kv = makeFakeKV({ keys });
    expect(await kvKeys(kv)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// kvWatch
// ---------------------------------------------------------------------------

describe('kvWatch', () => {
  // Build a fake watch iterator that also exposes stop().
  function makeWatch(entries: unknown[]) {
    const stop = vi.fn();
    const iterable = arrayAsyncIterable(entries);
    return {
      stop,
      [Symbol.asyncIterator]: () => iterable[Symbol.asyncIterator](),
    };
  }

  it('invokes the callback with parsed values and revisions for updates', async () => {
    const value = { progress: 90 };
    const watch = makeWatch([
      { operation: 'PUT', value: encode(value), revision: 5 },
    ]);
    const kv = makeFakeKV({ watch: vi.fn(async () => watch) });

    const received: Array<[unknown, number]> = [];
    const stop = await kvWatch<typeof value>(kv, 'job-1', (v, r) => {
      received.push([v, r]);
    });

    // Let the background processUpdates() loop drain.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(received).toEqual([[value, 5]]);
    expect(vi.mocked(kv.watch, true)).toHaveBeenCalledWith({ key: 'job-1' });

    // The returned disposer stops the underlying watch.
    stop();
    expect(watch.stop).toHaveBeenCalledTimes(1);
  });

  it('invokes the callback with null on DEL and PURGE operations', async () => {
    const watch = makeWatch([
      { operation: 'DEL', value: undefined, revision: 2 },
      { operation: 'PURGE', value: undefined, revision: 3 },
    ]);
    const kv = makeFakeKV({ watch: vi.fn(async () => watch) });

    const received: Array<[unknown, number]> = [];
    await kvWatch(kv, 'k', (v, r) => received.push([v, r]));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(received).toEqual([
      [null, 2],
      [null, 3],
    ]);
  });

  it('skips entries with invalid JSON without throwing', async () => {
    const watch = makeWatch([
      { operation: 'PUT', value: new TextEncoder().encode('bad{'), revision: 1 },
      { operation: 'PUT', value: encode({ ok: true }), revision: 2 },
    ]);
    const kv = makeFakeKV({ watch: vi.fn(async () => watch) });

    const received: Array<[unknown, number]> = [];
    await kvWatch(kv, 'k', (v, r) => received.push([v, r]));
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Only the valid entry produces a callback; the bad one is logged + skipped.
    expect(received).toEqual([[{ ok: true }, 2]]);
    expect(errorSpy).toHaveBeenCalledWith(
      '[KVStores] Error parsing watch value:',
      expect.anything()
    );
  });
});
