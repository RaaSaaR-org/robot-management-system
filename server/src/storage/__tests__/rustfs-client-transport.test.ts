/**
 * @file rustfs-client-transport.test.ts
 * @description The store client's timeouts, pools and cancellation, against a store that misbehaves (TASK-491)
 * @feature storage
 *
 * The real AWS SDK talking to a local HTTP server that hangs, stalls and
 * streams without end — the situations that took the demo instance's storage
 * path down. What is counted is what leaked there: open sockets on the store.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'http';
import type { AddressInfo, Socket } from 'net';
import { Readable } from 'stream';
import {
  RustFSClient,
  classifyS3Error,
  rustFSTransportFromEnv,
  DEFAULT_RUSTFS_TRANSPORT,
  type RustFSTransport,
} from '../rustfs-client.js';

let server: http.Server;
let port: number;
const sockets = new Set<Socket>();
/** Requests the store received, as `METHOD key`. */
let seen: string[] = [];

/** What the fake store does with `/<bucket>/<key>`. */
function handle(req: http.IncomingMessage, res: http.ServerResponse): void {
  const key = (req.url ?? '').split('?')[0].split('/').slice(2).join('/');
  seen.push(`${req.method} ${key}`);
  if (key === 'hang') return; // accepts the request and never answers
  if (key === 'ok') {
    res.writeHead(200, { 'Content-Length': req.method === 'HEAD' ? '10' : '5', ETag: '"e"' });
    res.end(req.method === 'HEAD' ? undefined : 'hello');
    return;
  }
  if (key === 'endless') {
    // A 208 MB chunk file: more than anyone reads before moving on.
    res.writeHead(206, { 'Content-Range': 'bytes 0-208492162/208492163', 'Content-Length': '208492163' });
    const chunk = Buffer.alloc(64 * 1024, 1);
    const pump = (): void => {
      while (!res.destroyed && res.write(chunk)) {
        /* until the socket pushes back */
      }
    };
    res.on('drain', pump);
    pump();
    return;
  }
  if (key === 'stall') {
    // Starts to answer, then goes quiet with the body unfinished.
    res.writeHead(206, { 'Content-Range': 'bytes 0-99/100', 'Content-Length': '100' });
    res.write(Buffer.alloc(10, 1));
    return;
  }
  if (key === 'slow-put') {
    req.resume();
    req.on('end', () => setTimeout(() => res.writeHead(200, { ETag: '"part"' }).end(), 400));
    return;
  }
  res.writeHead(404).end();
}

beforeEach(async () => {
  seen = [];
  server = http.createServer(handle);
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  sockets.clear();
});

function client(transport: Partial<RustFSTransport> = {}): RustFSClient {
  return new RustFSClient({
    endpoint: `http://127.0.0.1:${port}`,
    accessKeyId: 'AK',
    secretAccessKey: 'SK',
    transport: { connectTimeoutMs: 1000, socketTimeoutMs: 5000, responseTimeoutMs: 300, ...transport },
  });
}

async function until(condition: () => boolean, ms = 3000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > ms) throw new Error(`condition not met in ${ms} ms`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('a store that does not answer', () => {
  it('fails the call at the response deadline instead of hanging, and gives the socket up', async () => {
    const started = Date.now();
    const error = await client().getMetadata('b', 'hang').catch((e: unknown) => e);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(error).toMatchObject({ name: 'TimeoutError' });
    expect((error as Error).message).toContain('did not answer HeadObject b/hang within 300 ms');
    // Read as "the store is not reachable right now", which is what /health reports.
    expect(classifyS3Error(error).kind).toBe('connectivity');
    await until(() => sockets.size === 0);
  });

  it('answers again without a restart once the store does', async () => {
    const store = client({ maxSockets: 2 });
    // More stuck calls than the pool has sockets: before, the pool was gone for good.
    const stuck = await Promise.all(
      Array.from({ length: 6 }, () => store.getMetadata('b', 'hang').catch((e: unknown) => e)),
    );
    expect(stuck.every((e) => (e as Error).name === 'TimeoutError')).toBe(true);
    await expect(store.getMetadata('b', 'ok')).resolves.toMatchObject({ contentLength: 10 });
  });
});

describe('getStream', () => {
  it('leaves no socket checked out when the reader gives up before, while and after the store answers', async () => {
    const store = client({ maxStreamSockets: 4, responseTimeoutMs: 2000 });
    const outcomes = { before: 0, during: 0, after: 0 };

    for (let i = 0; i < 60; i++) {
      const controller = new AbortController();
      if (i % 3 === 0) {
        // Gone before the store was asked.
        controller.abort();
        await expect(store.getStream('b', 'endless', { start: 0, end: 208492162 }, { signal: controller.signal }))
          .rejects.toMatchObject({ name: 'AbortError' });
        outcomes.before++;
      } else if (i % 3 === 1) {
        // Gone while the store was being asked — or, on a fast loopback, a
        // moment after it answered. Either way nothing may stay open.
        const opening = store
          .getStream('b', 'endless', { start: 0, end: 208492162 }, { signal: controller.signal })
          .catch((e: unknown) => e as Error);
        await sleep(i % 5);
        controller.abort();
        const outcome = await opening;
        if (outcome instanceof Error) {
          expect(outcome.name).toBe('AbortError');
        } else {
          outcome.on('error', () => undefined);
          expect(outcome.destroyed).toBe(true);
        }
        outcomes.during++;
      } else {
        // Gone with the stream in hand and unread.
        const stream = await store.getStream('b', 'endless', { start: 0, end: 208492162 }, { signal: controller.signal });
        stream.on('error', () => undefined);
        controller.abort();
        expect(stream.destroyed).toBe(true);
        outcomes.after++;
      }
    }
    expect(outcomes).toEqual({ before: 20, during: 20, after: 20 });
    // A request that was never sent is not one the store saw.
    expect(seen.filter((s) => s === 'GET endless').length).toBeLessThanOrEqual(40);

    // Forty abandoned streams through a pool of four, and it is all still there.
    await until(() => sockets.size === 0);
    const stream = await store.getStream('b', 'ok');
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    expect(Buffer.concat(chunks).toString()).toBe('hello');
  });

  it('asks the store nothing for a signal that has already fired', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(client().getStream('b', 'ok', undefined, { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(seen).toEqual([]);
  });

  it('ends a body that stalls after the idle timeout, and gives the socket up', async () => {
    const stream = await client({ socketTimeoutMs: 300 }).getStream('b', 'stall', { start: 0, end: 99 });
    const ended = new Promise<Error | null>((resolve) => {
      stream.on('error', resolve);
      stream.on('end', () => resolve(null));
    });
    stream.resume();
    expect(await ended).toBeInstanceOf(Error);
    await until(() => sockets.size === 0);
  });

  it('ends a body nobody reads after the idle timeout — a paused player does not keep a socket for ever', async () => {
    const stream = await client({ socketTimeoutMs: 300 }).getStream('b', 'endless', { start: 0, end: 208492162 });
    stream.on('error', () => undefined);
    await until(() => stream.destroyed || stream.errored !== null);
    await until(() => sockets.size === 0);
  });

  it('does not cut a body that keeps moving, however long it takes', async () => {
    // Slower than the idle timeout in total, never idle for that long.
    const stream = await client({ socketTimeoutMs: 300 }).getStream('b', 'endless', { start: 0, end: 208492162 });
    let bytes = 0;
    const started = Date.now();
    for await (const chunk of stream) {
      bytes += (chunk as Buffer).length;
      await sleep(20);
      if (Date.now() - started > 900) break;
    }
    expect(bytes).toBeGreaterThan(64 * 1024);
  });

  it('cannot starve short calls: with every stream socket taken, a HEAD still answers and the next stream fails at the deadline', async () => {
    const store = client({ maxStreamSockets: 2, maxSockets: 2, responseTimeoutMs: 400, socketTimeoutMs: 5000 });
    const held = await Promise.all([
      store.getStream('b', 'endless', { start: 0, end: 208492162 }),
      store.getStream('b', 'endless', { start: 0, end: 208492162 }),
    ]);
    held.forEach((s) => s.on('error', () => undefined));

    await expect(store.getMetadata('b', 'ok')).resolves.toMatchObject({ contentLength: 10 });
    await expect(store.exists('b', 'ok')).resolves.toBe(true);
    // The third stream has no socket to go out on. It is told so; it does not wait for ever.
    await expect(store.getStream('b', 'endless', { start: 0, end: 208492162 })).rejects.toMatchObject({
      name: 'TimeoutError',
    });

    // Giving one back is enough for the next.
    held[0].destroy();
    const next = await store.getStream('b', 'endless', { start: 0, end: 208492162 });
    next.destroy();
    held[1].destroy();
    // Only the short pool's idle keep-alive sockets are left.
    await until(() => sockets.size <= 2);
  });
});

describe('uploads', () => {
  it('are not held to the response deadline: a part the store takes its time over still lands', async () => {
    // The store answers 400 ms after the body; the deadline for calls without a body is 150 ms.
    const store = client({ responseTimeoutMs: 150 });
    const body = Buffer.alloc(256 * 1024, 7);
    await expect(store.putObjectStream('b', 'slow-put', Readable.from([body]), body.length)).resolves.toBeUndefined();
    await expect(store.uploadPartStream('b', 'slow-put', 'upload-1', 1, Readable.from([body]), body.length))
      .resolves.toBe('"part"');
  });
});

describe('rustFSTransportFromEnv', () => {
  it('has a bound for everything by default', () => {
    expect(rustFSTransportFromEnv({})).toEqual(DEFAULT_RUSTFS_TRANSPORT);
    expect(DEFAULT_RUSTFS_TRANSPORT).toEqual({
      connectTimeoutMs: 5_000,
      socketTimeoutMs: 120_000,
      responseTimeoutMs: 15_000,
      maxSockets: 64,
      maxStreamSockets: 128,
    });
  });

  it('reads each setting from the environment and ignores what is not a positive number', () => {
    expect(
      rustFSTransportFromEnv({
        RUSTFS_CONNECT_TIMEOUT_MS: '2000',
        RUSTFS_SOCKET_TIMEOUT_MS: '30000',
        RUSTFS_RESPONSE_TIMEOUT_MS: 'soon',
        RUSTFS_MAX_SOCKETS: '0',
        RUSTFS_MAX_STREAM_SOCKETS: '256',
      }),
    ).toEqual({
      connectTimeoutMs: 2000,
      socketTimeoutMs: 30000,
      responseTimeoutMs: 15_000,
      maxSockets: 64,
      maxStreamSockets: 256,
    });
  });

  it('is what a client is built with, and the constructor can override it', () => {
    expect(client().transport).toMatchObject({ responseTimeoutMs: 300, maxSockets: 64, maxStreamSockets: 128 });
  });
});
