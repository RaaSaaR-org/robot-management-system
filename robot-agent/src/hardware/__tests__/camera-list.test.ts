/**
 * @file camera-list.test.ts
 * @description TASK-405: the camera list `GET /robots/:id/cameras` and the
 *              readiness snapshot share — every answer of the sidecar, and its
 *              absence, comes back as a result, never as a throw.
 * @feature hardware
 * @status test
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'net';

let server: http.Server;
let reply: (res: http.ServerResponse) => void = () => {};

beforeAll(async () => {
  server = http.createServer((_req, res) => reply(res));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  process.env.HARDWARE_SIDECAR_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  delete process.env.HARDWARE_SIDECAR_URL;
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

// Imported lazily: the sidecar URL is memoized on first use.
const load = () => import('../camera-list.js');

describe('readCameraList', () => {
  it('passes the list, source and detail through', async () => {
    reply = (res) => res.end(JSON.stringify({ cameras: ['head_camera'], source: 'pc2', detail: 'ok' }));
    const { readCameraList } = await load();
    expect(await readCameraList()).toEqual({ kind: 'ok', cameras: ['head_camera'], source: 'pc2', detail: 'ok' });
  });

  it('reports a non-200 answer and a body that is not JSON', async () => {
    const { readCameraList } = await load();
    reply = (res) => { res.statusCode = 503; res.end('{}'); };
    expect(await readCameraList()).toEqual({ kind: 'bad_status', status: 503 });
    reply = (res) => res.end('not json');
    expect(await readCameraList()).toEqual({ kind: 'bad_body' });
  });

  it('a sidecar that does not answer in time is unreachable', async () => {
    reply = () => { /* never answers */ };
    const { readCameraList } = await load();
    expect(await readCameraList({ timeoutMs: 100 })).toEqual({ kind: 'unreachable' });
  });
});
