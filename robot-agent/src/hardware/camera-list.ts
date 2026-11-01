/**
 * @file camera-list.ts
 * @description Which cameras the hardware sidecar can serve, read from its
 *              `GET /cameras`. Shared by `GET /robots/:id/cameras` and the
 *              readiness snapshot (TASK-405) so both say the same thing —
 *              including "cannot reach the hardware sidecar" when it is down.
 * @feature hardware
 * @status live
 */

import http from 'node:http';
import { getSidecarUrl } from './HardwareClient.js';

/** What the sidecar's camera list said, or why there is none. */
export type CameraListResult =
  | { kind: 'ok'; cameras: string[]; source: string | null; detail?: string }
  /** The sidecar answered with a non-200 status. */
  | { kind: 'bad_status'; status: number }
  /** The sidecar answered 200 with something that is not JSON. */
  | { kind: 'bad_body' }
  /** The answer broke off mid-stream. */
  | { kind: 'read_failed' }
  /** No sidecar at all, or it did not answer within the timeout. */
  | { kind: 'unreachable' };

export const SIDECAR_UNREACHABLE_DETAIL = 'cannot reach the hardware sidecar';

export interface CameraListOptions {
  /** Abort the upstream request (the caller's client went away). */
  signal?: AbortSignal;
  /** Give up after this long and answer `unreachable`. No timeout when omitted. */
  timeoutMs?: number;
}

/** Ask the sidecar for its camera list. Never throws. */
export function readCameraList(opts: CameraListOptions = {}): Promise<CameraListResult> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (r: CameraListResult): void => {
      if (settled) return;
      settled = true;
      resolve(r);
    };
    let upstream: http.ClientRequest;
    try {
      upstream = http.get(`${getSidecarUrl()}/cameras`, (stream) => {
        const chunks: Buffer[] = [];
        stream.on('data', (c: Buffer) => chunks.push(c));
        stream.on('end', () => {
          if (stream.statusCode !== 200) {
            done({ kind: 'bad_status', status: stream.statusCode ?? 0 });
            return;
          }
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            done({
              kind: 'ok',
              cameras: Array.isArray(body?.cameras) ? body.cameras : [],
              source: body?.source ?? null,
              ...(body?.detail ? { detail: String(body.detail) } : {}),
            });
          } catch {
            done({ kind: 'bad_body' });
          }
        });
        stream.on('error', () => done({ kind: 'read_failed' }));
      });
    } catch {
      done({ kind: 'unreachable' });
      return;
    }
    upstream.on('error', () => done({ kind: 'unreachable' }));
    if (opts.timeoutMs !== undefined) {
      upstream.setTimeout(opts.timeoutMs, () => {
        done({ kind: 'unreachable' });
        upstream.destroy();
      });
    }
    if (opts.signal) {
      if (opts.signal.aborted) upstream.destroy();
      else opts.signal.addEventListener('abort', () => upstream.destroy(), { once: true });
    }
  });
}
