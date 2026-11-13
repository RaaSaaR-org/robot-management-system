/**
 * @file streamResponse.ts
 * @description The one way a route pipes a readable (an object-store body, a file, a proxied fetch) to its response
 * @feature storage
 *
 * A stream that is opened for a response has to be given back in every order
 * the client can leave in (TASK-491):
 *
 * - **before it opens** — a `<video>` whose `src` changed drops its request
 *   while the store is still being asked. `close` has fired by the time the
 *   stream arrives, so a `res.on('close')` registered afterwards never runs,
 *   nothing reads or destroys the body, and its socket stays checked out of the
 *   client's pool for the life of the process. Fifty of those on the demo
 *   instance and every storage call queued for a socket that never came back;
 * - **while it opens** — the open itself is cancelled through the signal;
 * - **after it opened** — the stream is destroyed when the response closes.
 *
 * {@link sendStream} does all three, and answers a stream that fails before
 * its first byte with a status and a body instead of a half-written header.
 */

import type { Readable } from 'stream';
import type { Response } from 'express';

/**
 * A signal that fires when the response closes before it was finished: the
 * client went away. Already aborted when it has gone by the time this is asked.
 */
export function clientGoneSignal(res: Response): AbortSignal {
  const controller = new AbortController();
  if (isClosed(res)) {
    if (!res.writableFinished) controller.abort();
    return controller.signal;
  }
  res.once('close', () => {
    if (!res.writableFinished) controller.abort();
  });
  return controller.signal;
}

function isClosed(res: Response): boolean {
  return res.destroyed || res.closed === true || res.socket?.destroyed === true;
}

export interface SendStreamOptions {
  /**
   * Set status and headers. Called once the stream is in hand and the client
   * is still there, so a failed open never leaves this stream's headers on the
   * error answer.
   */
  head?: (res: Response) => void;
  /** The names `head` sets, taken back off when the stream fails before its first byte. */
  headerNames?: string[];
  /** Status and body for a stream that fails before its first byte. Default 500 `{ error }`. */
  failure?: { status: number; body: Record<string, unknown> };
  /** Told about a stream error that was not the client leaving. */
  onError?: (error: Error) => void;
}

/** Destroy a stream nobody is going to read, without its late error going unhandled. */
function discard(stream: Readable): void {
  stream.on('error', () => undefined);
  stream.destroy();
}

/**
 * Open a stream and pipe it to the response.
 *
 * `source` is a function that opens the stream — it receives the client-gone
 * signal and should pass it on to whatever it opens — or, for a route that had
 * to open it before it could decide anything else, the stream itself, which is
 * then this function's to give back. A rejection from the opener is rethrown
 * for the route's own error answer — unless the client has gone, when there is
 * nobody to answer and the rejection is the cancellation itself.
 *
 * @returns `false` when the client had gone and nothing was sent.
 */
export async function sendStream(
  res: Response,
  source: Readable | ((signal: AbortSignal) => Readable | Promise<Readable>),
  options: SendStreamOptions = {},
): Promise<boolean> {
  const signal = clientGoneSignal(res);
  if (signal.aborted) {
    if (typeof source !== 'function') discard(source);
    return false;
  }

  let stream: Readable;
  if (typeof source === 'function') {
    try {
      stream = await source(signal);
    } catch (error) {
      if (signal.aborted) return false;
      throw error;
    }
  } else {
    stream = source;
  }
  // The client left while the stream was opening. Nothing will ever read it:
  // give it back now.
  if (signal.aborted || isClosed(res)) {
    discard(stream);
    return false;
  }

  options.head?.(res);

  const release = (): void => {
    stream.destroy();
  };
  stream.on('error', (error: Error) => {
    res.removeListener('close', release);
    stream.destroy();
    if (signal.aborted) return;
    options.onError?.(error);
    if (res.headersSent) {
      // Bytes are out under a 200/206: the only honest end is a broken one.
      res.destroy(error);
      return;
    }
    for (const name of options.headerNames ?? []) res.removeHeader(name);
    const failure = options.failure ?? { status: 500, body: { error: 'Failed to read stream' } };
    res.status(failure.status).json(failure.body);
  });
  // Fires for a finished response too, where destroying an ended stream is a no-op.
  res.once('close', release);
  stream.pipe(res);
  return true;
}
