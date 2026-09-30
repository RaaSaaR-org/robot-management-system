/**
 * @file bilateral-teleop-lease.test.ts
 * @description The bilateral teleop socket under the control lease (TASK-316):
 *              with `CONTROL_LEASE_REQUIRED` on, leader frames from an unbound
 *              socket never reach the sidecar client, a bound socket's do, and a
 *              fence stops them. Flag off: frames flow without a bind.
 * @feature teleop
 * @status test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'net';
import { WebSocket, type WebSocketServer } from 'ws';

import { createBilateralTeleopWebSocket, type BilateralSidecarClient } from '../bilateral-teleop.js';
import { ControlLeaseRegistry, hashLeaseId } from '../../control-lease/control-lease.js';
import type { FrameRecorder } from '../../teleop/FrameRecorder.js';

const SECRET = 'lease-secret';
const LEADER = { type: 'leader_state', joints: { shoulder_pan: 10, gripper: 20 }, timestamp: 1 };

type Msg = Record<string, unknown>;

/** A socket that queues every incoming message so tests can await the next one. */
async function connect(url: string): Promise<{ ws: WebSocket; next: () => Promise<Msg>; drain: () => Msg[] }> {
  const ws = new WebSocket(url);
  const queue: Msg[] = [];
  const waiters: Array<(m: Msg) => void> = [];
  ws.on('message', (data) => {
    const m = JSON.parse(String(data)) as Msg;
    const w = waiters.shift();
    if (w) w(m);
    else queue.push(m);
  });
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  return {
    ws,
    next: () =>
      new Promise<Msg>((resolve, reject) => {
        const m = queue.shift();
        if (m) return resolve(m);
        const t = setTimeout(() => reject(new Error('timed out waiting for a message')), 2000);
        waiters.push((msg) => {
          clearTimeout(t);
          resolve(msg);
        });
      }),
    drain: () => queue.splice(0),
  };
}

const settle = (ms = 50): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('Bilateral teleop under the control lease (TASK-316)', () => {
  let server: http.Server;
  let wss: WebSocketServer;
  let url: string;
  let dir: string;
  let registry: ControlLeaseRegistry;
  let required: boolean;
  let sidecar: { sendAction: ReturnType<typeof vi.fn>; fetchFollowerState: ReturnType<typeof vi.fn> };
  const sockets: WebSocket[] = [];

  beforeEach(async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    required = true;
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bilateral-lease-'));
    registry = new ControlLeaseRegistry({
      robotId: 'robot-1',
      filePath: path.join(dir, 'hw.json'),
      enforced: () => required,
    });
    sidecar = {
      sendAction: vi.fn(async () => {}),
      fetchFollowerState: vi.fn(async () => ({ shoulder_pan: 9, gripper: 19 })),
    };
    const recorder = {
      startSession: vi.fn(),
      stopSession: vi.fn(),
      isRecording: () => false,
      recordFrame: vi.fn(),
    } as unknown as FrameRecorder;
    wss = createBilateralTeleopWebSocket(recorder, {
      leases: registry,
      sidecar: sidecar as unknown as BilateralSidecarClient,
    });
    server = http.createServer();
    server.on('upgrade', (req, socket, head) => {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/ws/bilateral-teleop`;
  });

  afterEach(async () => {
    for (const ws of sockets.splice(0)) ws.close();
    await settle(20);
    wss.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    registry.dispose();
    fs.rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  const open = async () => {
    const c = await connect(url);
    sockets.push(c.ws);
    return c;
  };

  const install = (generation: number): void => {
    const r = registry.install({
      generation,
      leaseIdHash: hashLeaseId(SECRET),
      sessionId: 's',
      userId: 'user-ada',
      displayName: 'Ada',
      tenantId: null,
      ttlMs: 60_000,
    });
    expect(r.ok).toBe(true);
  };

  it('flag on: an unbound socket is told it is unbound and its frames never reach the sidecar', async () => {
    install(1);
    const c = await open();
    expect(await c.next()).toEqual({ type: 'ready' });
    expect(await c.next()).toEqual({ type: 'lease', state: 'unbound', required: true });
    c.ws.send(JSON.stringify(LEADER));
    expect(await c.next()).toMatchObject({ type: 'error', code: 'lease_required' });
    c.ws.send(JSON.stringify(LEADER));
    await settle();
    expect(c.drain()).toEqual([]); // lease_required is sent once per socket
    expect(sidecar.sendAction).not.toHaveBeenCalled();
  });

  it('flag on: a wrong secret or stale generation gets lease_invalid and stays unbound', async () => {
    install(1);
    const c = await open();
    await c.next();
    await c.next();
    c.ws.send(JSON.stringify({ bind: { leaseId: 'wrong', generation: 1 } }));
    expect(await c.next()).toMatchObject({ type: 'error', code: 'lease_invalid' });
    c.ws.send(JSON.stringify({ bind: { leaseId: SECRET, generation: 0 } }));
    expect(await c.next()).toMatchObject({ type: 'error', code: 'lease_invalid' });
    c.ws.send(JSON.stringify(LEADER));
    expect(await c.next()).toMatchObject({ type: 'error', code: 'lease_required' });
    expect(sidecar.sendAction).not.toHaveBeenCalled();
    expect(registry.bound()).toBe(0);
  });

  it('flag on: a bound socket drives, and a fence stops it at once', async () => {
    install(1);
    const c = await open();
    await c.next();
    await c.next();
    c.ws.send(JSON.stringify({ bind: { leaseId: SECRET, generation: 1 } }));
    expect(await c.next()).toEqual({ type: 'lease', state: 'bound', generation: 1 });
    expect(registry.bound()).toBe(1);

    c.ws.send(JSON.stringify(LEADER));
    expect(await c.next()).toMatchObject({ type: 'follower_state', joints: { shoulder_pan: 9, gripper: 19 } });
    expect(sidecar.sendAction).toHaveBeenCalledTimes(1);

    install(2); // fences generation 1
    expect(await c.next()).toEqual({ type: 'lease', state: 'revoked', generation: 1 });
    c.ws.send(JSON.stringify(LEADER));
    expect(await c.next()).toMatchObject({ type: 'error', code: 'lease_required' });
    expect(sidecar.sendAction).toHaveBeenCalledTimes(1);
  });

  it('flag on: releasing the lease stops forwarding too', async () => {
    install(1);
    const c = await open();
    await c.next();
    await c.next();
    c.ws.send(JSON.stringify({ bind: { leaseId: SECRET, generation: 1 } }));
    await c.next();
    registry.release({ generation: 1 });
    expect(await c.next()).toEqual({ type: 'lease', state: 'revoked', generation: 1 });
    c.ws.send(JSON.stringify(LEADER));
    expect(await c.next()).toMatchObject({ type: 'error', code: 'lease_required' });
    expect(sidecar.sendAction).not.toHaveBeenCalled();
  });

  it('flag on: the bound count tracks two sockets and drops on close', async () => {
    install(1);
    const a = await open();
    const b = await open();
    for (const c of [a, b]) {
      await c.next();
      await c.next();
      c.ws.send(JSON.stringify({ bind: { leaseId: SECRET, generation: 1 } }));
      await c.next();
    }
    expect(registry.bound()).toBe(2);
    a.ws.close();
    await settle();
    expect(registry.bound()).toBe(1);
    b.ws.send(JSON.stringify(LEADER));
    expect(await b.next()).toMatchObject({ type: 'follower_state' });
  });

  it('flag off: frames flow without a bind, and a bind frame is ignored', async () => {
    required = false;
    const c = await open();
    expect(await c.next()).toEqual({ type: 'ready' });
    c.ws.send(JSON.stringify({ bind: { leaseId: SECRET, generation: 1 } }));
    c.ws.send(JSON.stringify(LEADER));
    expect(await c.next()).toMatchObject({ type: 'follower_state' });
    expect(sidecar.sendAction).toHaveBeenCalledWith({ shoulder_pan: 10, gripper: 20 });
  });
});
