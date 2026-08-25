/**
 * @file loopback-listen.test.ts
 * @description Guards the `vitest.setup.ts` shim that keeps ephemeral test
 *              servers off the dual-stack wildcard (TASK-218).
 * @feature testing
 */

import { describe, it, expect } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import express from 'express';

async function bind(listen: (server: http.Server) => void): Promise<AddressInfo> {
  const server = http.createServer((_req, res) => res.end('ok'));
  await new Promise<void>((resolve) => {
    server.once('listening', () => resolve());
    listen(server);
  });
  const address = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address;
}

describe('ephemeral test servers bind loopback', () => {
  // Without this, `listen(0)` binds `::` and macOS picks the port from the IPv6
  // table alone — so a port another process already holds on IPv4 (tailscaled's
  // LocalAPI, a stray socket from a dead process) is handed out as free. The
  // bind succeeds, but the IPv4 request that follows reaches the OTHER
  // listener: a stranger's 401, or a connect that never completes.
  it('turns listen(0) into a loopback bind', async () => {
    const address = await bind((server) => server.listen(0));

    expect(address.address).toBe('127.0.0.1');
    expect(address.family).toBe('IPv4');
  });

  it('turns listen({ port: 0 }) into a loopback bind', async () => {
    const address = await bind((server) => server.listen({ port: 0 }));

    expect(address.address).toBe('127.0.0.1');
  });

  it('leaves an explicit host alone', async () => {
    const address = await bind((server) => server.listen(0, '0.0.0.0'));

    expect(address.address).toBe('0.0.0.0');
  });

  it('covers the listen supertest does for us', async () => {
    // supertest calls `app.listen(0)` inside `Test.serverAddress` and then
    // talks to `127.0.0.1:<port>`, which is the pairing the shim exists for —
    // there is no host argument to pass at that call site.
    const app = express();
    app.get('/ping', (_req, res) => {
      res.json({ ok: true });
    });

    const response = await request(app).get('/ping');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });
});
