/**
 * @file nats-client.test.ts
 * @description Unit tests for the NatsClient JetStream singleton. The `nats`
 *   library (the network/SDK boundary) is fully mocked: connect(), the
 *   NatsConnection, JetStream client/manager, and StringCodec are fakes.
 *   All pure logic — status state machine, payload (string vs JSON) encoding,
 *   KV caching, env-config derivation, getter guards — runs for real.
 * @feature messaging
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock the `nats` SDK before importing the module under test. StringCodec is
// invoked at class-field init time, so it must return a working codec.
// ---------------------------------------------------------------------------

const { connectMock, codecEncode, codecDecode } = vi.hoisted(() => {
  return {
    connectMock: vi.fn(),
    codecEncode: vi.fn((s: string) => new TextEncoder().encode(s)),
    codecDecode: vi.fn((b: Uint8Array) => new TextDecoder().decode(b)),
  };
});

vi.mock('nats', () => ({
  connect: connectMock,
  StringCodec: () => ({ encode: codecEncode, decode: codecDecode }),
}));

import { connect as _connect } from 'nats';
import { NatsClient, natsClient } from '../nats-client.js';

const connect = vi.mocked(_connect, true);

// ---------------------------------------------------------------------------
// Fakes for the nats connection graph.
// ---------------------------------------------------------------------------

interface FakeKV {
  name: string;
}

function makeFakeConnection(overrides: Record<string, unknown> = {}) {
  const kvView = vi.fn(async (name: string): Promise<FakeKV> => ({ name }));

  const jetstream = {
    publish: vi.fn(async () => ({ seq: 7, duplicate: false })),
    views: { kv: kvView },
  };

  const jetstreamManager = { __tag: 'jsm' };

  // status() is an async iterable that never yields (so the background
  // listener loop awaits forever without producing console noise).
  const statusAsyncIterable = {
    [Symbol.asyncIterator]() {
      return {
        next: () => new Promise<IteratorResult<unknown>>(() => {}),
      };
    },
  };

  const conn = {
    publish: vi.fn(),
    request: vi.fn(),
    jetstream: vi.fn(() => jetstream),
    jetstreamManager: vi.fn(async () => jetstreamManager),
    status: vi.fn(() => statusAsyncIterable),
    closed: vi.fn(() => new Promise<void>(() => {})), // never resolves in tests
    drain: vi.fn(async () => {}),
    ...overrides,
  };

  return { conn, jetstream, jetstreamManager, kvView };
}

// ---------------------------------------------------------------------------
// The class is a process-wide singleton. Reset its private state between tests
// via close() (when connected) plus a hard reset of the internal fields so
// each test starts from 'disconnected' with no connection.
// ---------------------------------------------------------------------------

const client = NatsClient.getInstance();

function resetClientState(): void {
  // Reach into private fields to guarantee a clean slate without relying on
  // the (network-touching) close() path.
  const anyClient = client as unknown as Record<string, unknown>;
  anyClient.connection = null;
  anyClient.jetstream = null;
  anyClient.jetstreamManager = null;
  (anyClient.kvStores as Map<string, unknown>).clear();
  (anyClient.statusCallbacks as Set<unknown>).clear();
  anyClient.status = 'disconnected';
  anyClient.config = null;
}

let savedEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  vi.clearAllMocks();
  resetClientState();
  savedEnv = { ...process.env };
  // Re-wire codec mocks (cleared above) to working implementations.
  codecEncode.mockImplementation((s: string) => new TextEncoder().encode(s));
  codecDecode.mockImplementation((b: Uint8Array) => new TextDecoder().decode(b));
});

afterEach(() => {
  process.env = savedEnv;
  resetClientState();
});

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

describe('NatsClient singleton', () => {
  it('getInstance returns the same instance every time', () => {
    expect(NatsClient.getInstance()).toBe(NatsClient.getInstance());
  });

  it('the exported natsClient is that singleton instance', () => {
    expect(natsClient).toBe(NatsClient.getInstance());
    expect(natsClient).toBeInstanceOf(NatsClient);
  });
});

// ---------------------------------------------------------------------------
// Initial state / status accessors
// ---------------------------------------------------------------------------

describe('NatsClient status accessors', () => {
  it('starts disconnected and not connected', () => {
    expect(client.getStatus()).toBe('disconnected');
    expect(client.isConnected()).toBe(false);
  });

  it('isConnected is false when status is connected but connection is null', () => {
    (client as unknown as Record<string, unknown>).status = 'connected';
    expect(client.isConnected()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Getter guards (not connected / not initialized)
// ---------------------------------------------------------------------------

describe('NatsClient getters throw when not initialized', () => {
  it('getConnection throws when not connected', () => {
    expect(() => client.getConnection()).toThrow('NATS not connected');
  });

  it('getJetStream throws when not initialized', () => {
    expect(() => client.getJetStream()).toThrow('JetStream not initialized');
  });

  it('getJetStreamManager throws when not initialized', () => {
    expect(() => client.getJetStreamManager()).toThrow('JetStream manager not initialized');
  });
});

// ---------------------------------------------------------------------------
// connect()
// ---------------------------------------------------------------------------

describe('NatsClient.connect', () => {
  it('connects with explicit config, initializes JetStream, and reaches connected', async () => {
    const { conn, jetstream, jetstreamManager } = makeFakeConnection();
    connect.mockResolvedValue(conn as never);

    await client.connect({ servers: 'nats://example:4222', name: 'my-name' });

    expect(connect).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledWith(
      expect.objectContaining({
        servers: 'nats://example:4222',
        name: 'my-name',
        reconnect: true,
        maxReconnectAttempts: -1,
        reconnectTimeWait: 2000,
      })
    );
    expect(client.getStatus()).toBe('connected');
    expect(client.isConnected()).toBe(true);
    expect(client.getConnection()).toBe(conn);
    expect(client.getJetStream()).toBe(jetstream);
    expect(client.getJetStreamManager()).toBe(jetstreamManager);
  });

  it('passes user/pass through to the connection options when both are present', async () => {
    const { conn } = makeFakeConnection();
    connect.mockResolvedValue(conn as never);

    await client.connect({ servers: 's', user: 'u', pass: 'p' });

    expect(connect).toHaveBeenCalledWith(expect.objectContaining({ user: 'u', pass: 'p' }));
  });

  it('omits user/pass when only one is provided', async () => {
    const { conn } = makeFakeConnection();
    connect.mockResolvedValue(conn as never);

    await client.connect({ servers: 's', user: 'u' });

    const opts = connect.mock.calls[0][0] as Record<string, unknown>;
    expect(opts.user).toBeUndefined();
    expect(opts.pass).toBeUndefined();
  });

  it('derives config from env when no config is passed', async () => {
    process.env.NATS_SERVERS = 'nats://env-host:4222';
    process.env.NATS_USER = 'envuser';
    process.env.NATS_PASS = 'envpass';
    const { conn } = makeFakeConnection();
    connect.mockResolvedValue(conn as never);

    await client.connect();

    expect(connect).toHaveBeenCalledWith(
      expect.objectContaining({
        servers: 'nats://env-host:4222',
        user: 'envuser',
        pass: 'envpass',
        name: 'neodem-server',
      })
    );
  });

  it('falls back to default server URL when env is unset', async () => {
    delete process.env.NATS_SERVERS;
    delete process.env.NATS_USER;
    delete process.env.NATS_PASS;
    const { conn } = makeFakeConnection();
    connect.mockResolvedValue(conn as never);

    await client.connect();

    const opts = connect.mock.calls[0][0] as Record<string, unknown>;
    expect(opts.servers).toBe('nats://localhost:4222');
    expect(opts.user).toBeUndefined();
    expect(opts.pass).toBeUndefined();
  });

  it('is a no-op when already connected', async () => {
    const { conn } = makeFakeConnection();
    connect.mockResolvedValue(conn as never);
    await client.connect({ servers: 's' });
    connect.mockClear();

    await client.connect({ servers: 'other' });

    expect(connect).not.toHaveBeenCalled();
  });

  it('on failure sets status disconnected, propagates error to status callbacks, and rethrows', async () => {
    const err = new Error('connection refused');
    connect.mockRejectedValue(err);
    const cb = vi.fn();
    client.onStatus(cb);
    cb.mockClear();

    await expect(client.connect({ servers: 's' })).rejects.toThrow('connection refused');

    expect(client.getStatus()).toBe('disconnected');
    expect(client.isConnected()).toBe(false);
    // 'connecting' then 'disconnected' with the error.
    expect(cb).toHaveBeenCalledWith('connecting', undefined);
    expect(cb).toHaveBeenCalledWith('disconnected', err);
  });
});

// ---------------------------------------------------------------------------
// onStatus / status callbacks
// ---------------------------------------------------------------------------

describe('NatsClient.onStatus', () => {
  it('immediately emits the current status to a new subscriber', () => {
    const cb = vi.fn();
    client.onStatus(cb);
    expect(cb).toHaveBeenCalledWith('disconnected');
  });

  it('returns an unsubscribe fn that stops further notifications', async () => {
    const cb = vi.fn();
    const unsubscribe = client.onStatus(cb);
    cb.mockClear();

    unsubscribe();

    const { conn } = makeFakeConnection();
    connect.mockResolvedValue(conn as never);
    await client.connect({ servers: 's' });

    expect(cb).not.toHaveBeenCalled();
  });

  it('notifies subscribers on status transitions during connect', async () => {
    const cb = vi.fn();
    client.onStatus(cb);
    cb.mockClear();

    const { conn } = makeFakeConnection();
    connect.mockResolvedValue(conn as never);
    await client.connect({ servers: 's' });

    expect(cb).toHaveBeenCalledWith('connecting', undefined);
    expect(cb).toHaveBeenCalledWith('connected', undefined);
  });

  it('a callback that throws during a status update is caught and does not break others', async () => {
    // setStatus wraps each callback invocation in try/catch. The immediate
    // emit in onStatus is NOT wrapped, so the callback must only throw on
    // subsequent (setStatus-driven) invocations.
    let firstCall = true;
    const bad = vi.fn(() => {
      if (firstCall) {
        firstCall = false;
        return;
      }
      throw new Error('callback boom');
    });
    const good = vi.fn();
    client.onStatus(bad);
    client.onStatus(good);
    good.mockClear();

    const { conn } = makeFakeConnection();
    connect.mockResolvedValue(conn as never);

    await expect(client.connect({ servers: 's' })).resolves.toBeUndefined();
    expect(good).toHaveBeenCalledWith('connected', undefined);
    expect(client.getStatus()).toBe('connected');
  });

  it('the immediate emit in onStatus is NOT wrapped in try/catch (throws synchronously)', () => {
    // Documents actual behavior: registering a callback that throws on its
    // first (immediate) invocation propagates out of onStatus. See bugsFound.
    const bad = vi.fn(() => {
      throw new Error('immediate boom');
    });
    expect(() => client.onStatus(bad)).toThrow('immediate boom');
  });
});

// ---------------------------------------------------------------------------
// publish()
// ---------------------------------------------------------------------------

describe('NatsClient.publish', () => {
  it('throws when not connected', async () => {
    await expect(client.publish('subj', { a: 1 })).rejects.toThrow('NATS not connected');
  });

  it('JSON-stringifies object payloads and encodes them', async () => {
    const { conn } = makeFakeConnection();
    connect.mockResolvedValue(conn as never);
    await client.connect({ servers: 's' });

    await client.publish('subj', { hello: 'world' });

    expect(codecEncode).toHaveBeenCalledWith('{"hello":"world"}');
    expect(conn.publish).toHaveBeenCalledWith('subj', expect.any(Uint8Array));
  });

  it('passes string payloads through unchanged', async () => {
    const { conn } = makeFakeConnection();
    connect.mockResolvedValue(conn as never);
    await client.connect({ servers: 's' });

    await client.publish('subj', 'raw-string');

    expect(codecEncode).toHaveBeenCalledWith('raw-string');
  });
});

// ---------------------------------------------------------------------------
// jetPublish()
// ---------------------------------------------------------------------------

describe('NatsClient.jetPublish', () => {
  it('throws when JetStream is not initialized', async () => {
    await expect(client.jetPublish('subj', { a: 1 })).rejects.toThrow('JetStream not initialized');
  });

  it('publishes JSON payload with msgID and returns seq + duplicate', async () => {
    const { conn, jetstream } = makeFakeConnection();
    jetstream.publish.mockResolvedValue({ seq: 42, duplicate: true });
    connect.mockResolvedValue(conn as never);
    await client.connect({ servers: 's' });

    const result = await client.jetPublish('subj', { x: 1 }, { msgID: 'id-1' });

    expect(jetstream.publish).toHaveBeenCalledWith('subj', expect.any(Uint8Array), {
      msgID: 'id-1',
    });
    expect(codecEncode).toHaveBeenCalledWith('{"x":1}');
    expect(result).toEqual({ seq: 42, duplicate: true });
  });

  it('passes undefined msgID when no options are given', async () => {
    const { conn, jetstream } = makeFakeConnection();
    connect.mockResolvedValue(conn as never);
    await client.connect({ servers: 's' });

    await client.jetPublish('subj', 'data');

    expect(jetstream.publish).toHaveBeenCalledWith('subj', expect.any(Uint8Array), {
      msgID: undefined,
    });
  });
});

// ---------------------------------------------------------------------------
// request()
// ---------------------------------------------------------------------------

describe('NatsClient.request', () => {
  it('throws when not connected', async () => {
    await expect(client.request('subj', {})).rejects.toThrow('NATS not connected');
  });

  it('sends a request with default timeout and parses a JSON reply', async () => {
    const { conn } = makeFakeConnection();
    conn.request.mockResolvedValue({
      data: new TextEncoder().encode('{"ok":true,"n":5}'),
    });
    connect.mockResolvedValue(conn as never);
    await client.connect({ servers: 's' });

    const result = await client.request<{ ok: boolean; n: number }>('subj', { q: 1 });

    expect(conn.request).toHaveBeenCalledWith('subj', expect.any(Uint8Array), { timeout: 5000 });
    expect(codecEncode).toHaveBeenCalledWith('{"q":1}');
    expect(result).toEqual({ ok: true, n: 5 });
  });

  it('honors a custom timeout', async () => {
    const { conn } = makeFakeConnection();
    conn.request.mockResolvedValue({ data: new TextEncoder().encode('{}') });
    connect.mockResolvedValue(conn as never);
    await client.connect({ servers: 's' });

    await client.request('subj', 'p', 1234);

    expect(conn.request).toHaveBeenCalledWith('subj', expect.any(Uint8Array), { timeout: 1234 });
  });

  it('returns the raw decoded string when the reply is not valid JSON', async () => {
    const { conn } = makeFakeConnection();
    conn.request.mockResolvedValue({ data: new TextEncoder().encode('not-json') });
    connect.mockResolvedValue(conn as never);
    await client.connect({ servers: 's' });

    const result = await client.request<string>('subj', {});

    expect(result).toBe('not-json');
  });
});

// ---------------------------------------------------------------------------
// getKV()
// ---------------------------------------------------------------------------

describe('NatsClient.getKV', () => {
  it('throws when JetStream is not initialized', async () => {
    await expect(client.getKV('store')).rejects.toThrow('JetStream not initialized');
  });

  it('creates the KV store via JetStream views on first call', async () => {
    const { conn, kvView } = makeFakeConnection();
    connect.mockResolvedValue(conn as never);
    await client.connect({ servers: 's' });

    const kv = await client.getKV('store-1');

    expect(kvView).toHaveBeenCalledWith('store-1');
    expect(kv).toEqual({ name: 'store-1' });
  });

  it('caches the KV store and does not recreate it on subsequent calls', async () => {
    const { conn, kvView } = makeFakeConnection();
    connect.mockResolvedValue(conn as never);
    await client.connect({ servers: 's' });

    const first = await client.getKV('store-1');
    const second = await client.getKV('store-1');

    expect(first).toBe(second);
    expect(kvView).toHaveBeenCalledTimes(1);
  });

  it('creates distinct stores for distinct names', async () => {
    const { conn, kvView } = makeFakeConnection();
    connect.mockResolvedValue(conn as never);
    await client.connect({ servers: 's' });

    await client.getKV('a');
    await client.getKV('b');

    expect(kvView).toHaveBeenCalledTimes(2);
    expect(kvView).toHaveBeenNthCalledWith(1, 'a');
    expect(kvView).toHaveBeenNthCalledWith(2, 'b');
  });
});

// ---------------------------------------------------------------------------
// close()
// ---------------------------------------------------------------------------

describe('NatsClient.close', () => {
  it('is a no-op when there is no connection', async () => {
    await expect(client.close()).resolves.toBeUndefined();
    expect(client.getStatus()).toBe('disconnected');
  });

  it('drains, resets the connection graph, clears KV cache, and sets status closed', async () => {
    const { conn } = makeFakeConnection();
    connect.mockResolvedValue(conn as never);
    await client.connect({ servers: 's' });
    await client.getKV('cached');

    await client.close();

    expect(conn.drain).toHaveBeenCalledTimes(1);
    expect(client.getStatus()).toBe('closed');
    expect(client.isConnected()).toBe(false);
    expect(() => client.getConnection()).toThrow('NATS not connected');
    expect(() => client.getJetStream()).toThrow('JetStream not initialized');
    expect(() => client.getJetStreamManager()).toThrow('JetStream manager not initialized');
    // KV cache cleared: a fresh getKV would fail because JetStream is gone.
    await expect(client.getKV('cached')).rejects.toThrow('JetStream not initialized');
  });

  it('notifies status subscribers of the closed transition', async () => {
    const { conn } = makeFakeConnection();
    connect.mockResolvedValue(conn as never);
    await client.connect({ servers: 's' });
    const cb = vi.fn();
    client.onStatus(cb);
    cb.mockClear();

    await client.close();

    expect(cb).toHaveBeenCalledWith('closed', undefined);
  });
});
