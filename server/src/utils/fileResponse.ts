/**
 * @file fileResponse.ts
 * @description Answering a request for one stored file as raw bytes: whole,
 *              by `Range`, or to a `HEAD` — for every route that hands a file
 *              of a known size back out of storage.
 * @feature storage
 *
 * Two routes serve stored files this way: a dataset's (TASK-496,
 * `dataset-files.routes.ts`) and an uploaded model's (TASK-498,
 * `model-uploads.routes.ts`). The rules are the same for both, so they are
 * here once: one range per request, 416 with the size for a range that cannot
 * be served, nothing opened for a `HEAD` or an empty file, and the store's
 * body piped through `sendStream`, which gives it back however the client
 * leaves (TASK-491).
 */

import type { Readable } from 'stream';
import type { Request, Response } from 'express';
import { sendStream } from './streamResponse.js';

/**
 * A single-range `Range` header against a file of `size` bytes: the inclusive
 * window, or 'unsatisfiable' (answered 416) for anything malformed or out of bounds.
 */
export function parseFileRange(header: string, size: number): { start: number; end: number } | 'unsatisfiable' {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (!m[1] && !m[2])) return 'unsatisfiable';
  let start: number;
  let end: number;
  if (!m[1]) {
    const suffix = parseInt(m[2], 10);
    if (suffix === 0) return 'unsatisfiable';
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = parseInt(m[1], 10);
    end = m[2] ? parseInt(m[2], 10) : size - 1;
  }
  end = Math.min(end, size - 1);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) return 'unsatisfiable';
  return { start, end };
}

/** The headers a file answer may set, taken back off when the stream fails before its first byte. */
export const FILE_RESPONSE_HEADERS = [
  'Content-Type', 'Accept-Ranges', 'Content-Range', 'Content-Length', 'ETag', 'X-Content-Sha256',
];

export interface StoredFile {
  size: number;
  /** The object store's ETag, unquoted, when there is one. */
  etag?: string;
  /** The whole file's SHA-256, when the server knows it; sent as `X-Content-Sha256`. */
  sha256?: string;
  /** Open the file, or only the inclusive byte `range` of it. The stream is then this module's to give back. */
  open(range: { start: number; end: number } | undefined, signal: AbortSignal): Readable | Promise<Readable>;
}

/**
 * Answer `req` with `file`: 200 with all of it, 206 with the window a `Range`
 * asks for, 416 for one that cannot be served, headers only for a `HEAD`.
 *
 * A rejection from `file.open` is rethrown for the route's own error answer.
 */
export async function sendStoredFile(
  req: Request,
  res: Response,
  file: StoredFile,
  options: { onStreamError: (error: Error) => void },
): Promise<void> {
  const header = req.headers.range;
  const range = header ? parseFileRange(header, file.size) : undefined;
  if (range === 'unsatisfiable') {
    res.status(416).setHeader('Content-Range', `bytes */${file.size}`);
    res.json({ error: `The range is outside the file (${file.size} bytes)`, code: 'RANGE_NOT_SATISFIABLE', size: file.size });
    return;
  }
  const head = (): void => {
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Accept-Ranges', 'bytes');
    if (file.etag) res.setHeader('ETag', `"${file.etag}"`);
    // The whole file's hash, whatever window is being read.
    if (file.sha256) res.setHeader('X-Content-Sha256', file.sha256);
    if (range) {
      res.status(206);
      res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${file.size}`);
      res.setHeader('Content-Length', range.end - range.start + 1);
    } else {
      res.setHeader('Content-Length', file.size);
    }
  };
  // Answered from what is known already: a HEAD, and an empty file, open nothing.
  if (req.method === 'HEAD' || file.size === 0) {
    head();
    res.end();
    return;
  }
  await sendStream(res, (signal) => file.open(range, signal), {
    head,
    headerNames: FILE_RESPONSE_HEADERS,
    failure: { status: 502, body: { error: 'The file could not be read from storage', code: 'STORE_ERROR' } },
    onError: options.onStreamError,
  });
}

/** A store call that ran out of time rather than failed. */
export function isStoreTimeout(error: unknown): boolean {
  return (error as { name?: unknown } | null)?.name === 'TimeoutError';
}

/**
 * The part of a file route's error answer that does not depend on whose file
 * it was. Returns true when it answered (or there was nobody to answer):
 *
 * - the client left — nothing went wrong and nothing is written;
 * - bytes are already out under a 200/206 — the only honest end is a broken one;
 * - the store did not answer in time — 503 `STORAGE_TIMEOUT` with `Retry-After`,
 *   so a downloader retries instead of concluding the file is gone.
 *
 * Otherwise the file headers are taken back off and the route answers its own refusal.
 */
export function answeredFileFailure(res: Response, error: unknown): boolean {
  if (res.destroyed || res.socket?.destroyed) return true;
  if (res.headersSent) {
    res.destroy(error instanceof Error ? error : undefined);
    return true;
  }
  for (const name of FILE_RESPONSE_HEADERS) res.removeHeader(name);
  if (isStoreTimeout(error)) {
    res.setHeader('Retry-After', '2');
    res.status(503).json({ error: 'Object storage did not answer in time', code: 'STORAGE_TIMEOUT' });
    return true;
  }
  return false;
}
