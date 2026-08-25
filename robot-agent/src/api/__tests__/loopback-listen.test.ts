/**
 * @file loopback-listen.test.ts
 * @description Guards the `vitest.setup.ts` shim that keeps ephemeral test
 *              servers off the dual-stack wildcard (TASK-218).
 * @feature testing
 */

import { describe, it, expect } from 'vitest';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

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
  // route tests here start a real server on an ephemeral port and drive it with
  // `fetch('http://127.0.0.1:<port>/…')`, so that request would reach the OTHER
  // listener and read back a stranger's 401.
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

  it('covers the express app.listen(0) the route tests use', async () => {
    const app = express();
    app.get('/ping', (_req, res) => {
      res.json({ ok: true });
    });
    const server = await new Promise<http.Server>((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    const { port } = server.address() as AddressInfo;

    const res = await fetch(`http://127.0.0.1:${port}/ping`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});
