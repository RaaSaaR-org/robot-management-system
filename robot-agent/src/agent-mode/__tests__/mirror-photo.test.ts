/**
 * @file mirror-photo.test.ts
 * @description ServerMirror photo upload (TASK-212): a JSON PUT to
 *              `/api/robots/:id/patrol-runs/:runId/photos/:key`, retried on
 *              transport failure and non-2xx, never throwing.
 * @feature agentmode
 * @status test
 */

import { describe, it, expect, vi } from 'vitest';
import { ServerMirror, PHOTO_UPLOAD_ATTEMPTS } from '../server-mirror.js';

function mirror(fetchImpl: typeof fetch) {
  return new ServerMirror({
    serverUrl: 'http://server',
    robotId: 'robot-1',
    fetchImpl,
    journal: null,
    logCommandExecution: async () => {},
    retryDelayMs: 0,
  });
}

const PHOTO = {
  runId: 'run-1',
  key: 'cp-hall.jpg',
  jpeg: Buffer.from('JPEGBYTES'),
  kind: 'control' as const,
  checkpointId: 'cp-hall',
  routeId: 'house-night',
  capturedAt: '2026-08-16T22:31:00.000Z',
};

describe('ServerMirror.pushPatrolPhoto', () => {
  it('PUTs the JSON body the server contract names, once, when the server accepts', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const m = mirror((async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response('{"ok":true}', { status: 200 });
    }) as unknown as typeof fetch);
    expect(await m.pushPatrolPhoto(PHOTO)).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('http://server/api/robots/robot-1/patrol-runs/run-1/photos/cp-hall.jpg');
    expect(calls[0]!.init.method).toBe('PUT');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      imageB64: Buffer.from('JPEGBYTES').toString('base64'),
      contentType: 'image/jpeg',
      kind: 'control',
      checkpointId: 'cp-hall',
      routeId: 'house-night',
      capturedAt: '2026-08-16T22:31:00.000Z',
    });
  });

  it('retries on a transport error and on a 5xx, and succeeds when a later attempt lands', async () => {
    let n = 0;
    const m = mirror((async () => {
      n++;
      if (n === 1) throw new Error('ECONNRESET');
      if (n === 2) return new Response('busy', { status: 503 });
      return new Response('{"ok":true}', { status: 200 });
    }) as unknown as typeof fetch);
    expect(await m.pushPatrolPhoto(PHOTO)).toBe(true);
    expect(n).toBe(3);
  });

  it('gives up after the attempt budget, reports false, warns once, never throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let n = 0;
    const m = mirror((async () => {
      n++;
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch);
    expect(await m.pushPatrolPhoto(PHOTO)).toBe(false);
    expect(n).toBe(PHOTO_UPLOAD_ATTEMPTS);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toMatch(/patrol photo upload failed .*run-1\/cp-hall\.jpg.*ECONNREFUSED/);
    warn.mockRestore();
    // The fire-and-forget wrapper is safe to call without awaiting.
    expect(() => m.uploadPatrolPhoto(PHOTO)).not.toThrow();
  });
});
