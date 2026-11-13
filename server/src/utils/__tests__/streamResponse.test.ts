/**
 * @file streamResponse.test.ts
 * @description A stream opened for a response is given back in every order the client can leave in (TASK-491)
 * @feature storage
 *
 * Against a real HTTP server and real sockets: the defect was an ordering of
 * `close` events, and a mocked response would not have it.
 */

import { describe, it, expect, afterEach } from 'vitest';
import express, { type Request, type Response } from 'express';
import http from 'http';
import type { AddressInfo } from 'net';
import { Readable } from 'stream';
import { clientGoneSignal, sendStream, type SendStreamOptions } from '../streamResponse.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** A stream that never ends by itself, like a 208 MB object nobody reads to the end. */
function endless(): Readable {
  return new Readable({
    read() {
      this.push(Buffer.alloc(16 * 1024, 1));
    },
  });
}

async function until(condition: () => boolean, ms = 2000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > ms) throw new Error('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

let server: http.Server | undefined;

/** Serve one handler; resolves with its port. */
async function serve(handler: (req: Request, res: Response) => Promise<void> | void): Promise<number> {
  const app = express();
  app.get('/stream', (req, res) => void handler(req, res));
  server = http.createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
}

afterEach(async () => {
  server?.closeAllConnections();
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = undefined;
});

/** GET /stream; resolves with status, headers and body, or rejects on a broken response. */
function get(port: number): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/stream', agent: false }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject);
      res.on('aborted', () => reject(new Error('aborted')));
    });
    req.on('error', reject);
  });
}

describe('sendStream', () => {
  it('pipes the stream under the headers it was given', async () => {
    const port = await serve(async (_req, res) => {
      await sendStream(res, () => Readable.from([Buffer.from('hello '), Buffer.from('world')]), {
        head: (r) => r.status(206).setHeader('Content-Range', 'bytes 0-10/11'),
      });
    });
    const answer = await get(port);
    expect(answer.status).toBe(206);
    expect(answer.headers['content-range']).toBe('bytes 0-10/11');
    expect(answer.body.toString()).toBe('hello world');
  });

  it('destroys a stream that opens after the client left, and tells the opener to stop', async () => {
    const opening = deferred<Readable>();
    const opened = deferred<AbortSignal>();
    const done = deferred<boolean>();
    const port = await serve(async (_req, res) => {
      done.resolve(
        await sendStream(res, (signal) => {
          opened.resolve(signal);
          return opening.promise;
        }),
      );
    });

    const req = http.get({ host: '127.0.0.1', port, path: '/stream', agent: false });
    req.on('error', () => undefined);
    const signal = await opened.promise;
    expect(signal.aborted).toBe(false);

    // The player moved on while the store was still being asked.
    req.destroy();
    await until(() => signal.aborted);

    // The store answers anyway. Nobody will read this body.
    const stream = endless();
    opening.resolve(stream);
    expect(await done.promise).toBe(false);
    expect(stream.destroyed).toBe(true);
  });

  it('opens nothing for a client that had already left', async () => {
    const release = deferred<void>();
    const arrived = deferred<void>();
    const done = deferred<boolean>();
    let opens = 0;
    const port = await serve(async (_req, res) => {
      arrived.resolve();
      // The lookups a route does before it gets to its stream.
      await release.promise;
      done.resolve(
        await sendStream(res, () => {
          opens++;
          return endless();
        }),
      );
    });

    const req = http.get({ host: '127.0.0.1', port, path: '/stream', agent: false });
    req.on('error', () => undefined);
    await arrived.promise;
    req.destroy();
    await new Promise((resolve) => setTimeout(resolve, 30));
    release.resolve();

    expect(await done.promise).toBe(false);
    expect(opens).toBe(0);
  });

  it('gives back a stream it was handed already open, for a client that had left', async () => {
    const release = deferred<void>();
    const arrived = deferred<void>();
    const done = deferred<boolean>();
    const stream = endless();
    const port = await serve(async (_req, res) => {
      arrived.resolve();
      await release.promise;
      done.resolve(await sendStream(res, stream));
    });

    const req = http.get({ host: '127.0.0.1', port, path: '/stream', agent: false });
    req.on('error', () => undefined);
    await arrived.promise;
    req.destroy();
    await new Promise((resolve) => setTimeout(resolve, 30));
    release.resolve();

    expect(await done.promise).toBe(false);
    expect(stream.destroyed).toBe(true);
  });

  it('swallows the cancellation an opener throws once the client has left', async () => {
    const opened = deferred<AbortSignal>();
    const done = deferred<boolean | Error>();
    const port = await serve(async (_req, res) => {
      try {
        done.resolve(
          await sendStream(
            res,
            (signal) =>
              new Promise<Readable>((_, reject) => {
                opened.resolve(signal);
                signal.addEventListener('abort', () =>
                  reject(Object.assign(new Error('Request aborted'), { name: 'AbortError' })),
                );
              }),
          ),
        );
      } catch (error) {
        done.resolve(error as Error);
      }
    });
    const req = http.get({ host: '127.0.0.1', port, path: '/stream', agent: false });
    req.on('error', () => undefined);
    await opened.promise;
    req.destroy();
    expect(await done.promise).toBe(false);
  });

  it('destroys the stream when the client leaves mid-way', async () => {
    const stream = endless();
    const port = await serve(async (_req, res) => {
      await sendStream(res, () => stream);
    });
    await new Promise<void>((resolve) => {
      const req = http.get({ host: '127.0.0.1', port, path: '/stream', agent: false }, (res) => {
        res.once('data', () => {
          req.destroy();
          resolve();
        });
      });
      req.on('error', () => undefined);
    });
    await until(() => stream.destroyed);
  });

  it('answers a stream that fails before its first byte with a body, not under the stream headers', async () => {
    const stream = new Readable({
      read() {
        this.destroy(new Error('store hung up'));
      },
    });
    const errors: string[] = [];
    const options: SendStreamOptions = {
      head: (r) => {
        r.status(206);
        r.setHeader('Content-Range', 'bytes 0-0/10');
        r.setHeader('Content-Length', 1);
      },
      headerNames: ['Content-Range', 'Content-Length'],
      failure: { status: 500, body: { error: 'Failed to stream video' } },
      onError: (error) => errors.push(error.message),
    };
    const port = await serve(async (_req, res) => {
      await sendStream(res, () => stream, options);
    });
    const answer = await get(port);
    expect(answer.status).toBe(500);
    expect(answer.headers['content-range']).toBeUndefined();
    expect(JSON.parse(answer.body.toString())).toEqual({ error: 'Failed to stream video' });
    expect(errors).toEqual(['store hung up']);
  });

  it('breaks the response when the stream fails after bytes went out', async () => {
    let sent = false;
    const stream = new Readable({
      read() {
        if (!sent) {
          sent = true;
          this.push(Buffer.alloc(1024, 1));
          return;
        }
        setTimeout(() => this.destroy(new Error('store hung up')), 20);
      },
    });
    const port = await serve(async (_req, res) => {
      await sendStream(res, () => stream, { head: (r) => r.setHeader('Content-Length', 4096) });
    });
    await expect(get(port)).rejects.toThrow();
    expect(stream.destroyed).toBe(true);
  });

  it('rethrows a failed open while the client is still there, with no stream headers set', async () => {
    const port = await serve(async (_req, res) => {
      try {
        await sendStream(res, () => Promise.reject(new Error('NoSuchKey')), {
          head: (r) => r.setHeader('Content-Range', 'bytes 0-0/10'),
        });
      } catch (error) {
        res.status(404).json({ error: (error as Error).message });
      }
    });
    const answer = await get(port);
    expect(answer.status).toBe(404);
    expect(answer.headers['content-range']).toBeUndefined();
  });
});

describe('clientGoneSignal', () => {
  it('does not fire for a response that finished', async () => {
    const signals: AbortSignal[] = [];
    const port = await serve((_req, res) => {
      signals.push(clientGoneSignal(res));
      res.json({ ok: true });
    });
    await get(port);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(signals[0].aborted).toBe(false);
  });
});
