/**
 * @file api.test.ts
 * @description The HTTP API: bearer token on every route but /healthz, the
 * status shape, start/stop over HTTP, logs, and E-stop forwarding.
 * @feature supervisor
 */

import { afterEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApi, tokenMatches } from '../src/api.js';
import { cleanupHarness, makeHarness, waitFor } from './helpers.js';
import type { Harness } from './helpers.js';
import type { Status } from '../src/steps.js';

const TOKEN = 'test-token-0123456789abcdef';
const realKill = process.kill.bind(process);
let h: Harness | undefined;
let server: Server | undefined;

afterEach(async () => {
  if (server) await new Promise((r) => server!.close(r));
  server = undefined;
  cleanupHarness(h, realKill);
  h = undefined;
});

async function boot(): Promise<string> {
  h = await makeHarness();
  await h.sup.init();
  server = createApi(h.sup, { token: TOKEN });
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', () => r()));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const auth = { Authorization: `Bearer ${TOKEN}` };

async function getStatus(base: string): Promise<Status> {
  return (await fetch(`${base}/status`, { headers: auth })).json() as Promise<Status>;
}

describe('supervisor API', () => {
  it('refuses to be created without a real token', async () => {
    h = await makeHarness();
    expect(() => createApi(h!.sup, { token: '' })).toThrow(/ROBOT_SUPERVISOR_TOKEN/);
    expect(() => createApi(h!.sup, { token: 'short' })).toThrow(/at least 16/);
  });

  it('compares tokens exactly', () => {
    expect(tokenMatches(`Bearer ${TOKEN}`, TOKEN)).toBe(true);
    expect(tokenMatches(`Bearer ${TOKEN}x`, TOKEN)).toBe(false);
    expect(tokenMatches(TOKEN, TOKEN)).toBe(false);
    expect(tokenMatches(undefined, TOKEN)).toBe(false);
  });

  it('serves /healthz without a token and nothing else', async () => {
    const base = await boot();
    expect((await fetch(`${base}/healthz`)).status).toBe(200);
    for (const [method, path] of [['GET', '/status'], ['POST', '/start'], ['POST', '/stop'], ['POST', '/estop'],
      ['POST', '/sidecar/mode'], ['POST', '/lan/up'], ['GET', '/logs/sidecar'], ['POST', '/steps/agent/adopt']]) {
      const r = await fetch(`${base}${path}`, { method });
      expect(r.status, `${method} ${path}`).toBe(401);
      const r2 = await fetch(`${base}${path}`, { method, headers: { Authorization: 'Bearer wrong-token-0123456789' } });
      expect(r2.status, `${method} ${path} wrong token`).toBe(401);
    }
  });

  it('reports the status shape, starts with 202, streams logs, stops', async () => {
    const base = await boot();
    const st = await getStatus(base);
    expect(st).toMatchObject({ robotId: 'stub-g1', robot: 'sim', sidecarMode: null, overall: 'stopped', lastBase: null });
    expect(typeof st.agentPort).toBe('number');
    expect(st.steps.map((s) => s.id)).toEqual(['preflight', 'link', 'camera', 'bridge', 'sidecar', 'agent']);
    for (const s of st.steps) {
      expect(Object.keys(s)).toEqual(expect.arrayContaining(['id', 'state', 'owned', 'pid', 'startedAt', 'detail', 'checks']));
    }

    const bad = await fetch(`${base}/start`, { method: 'POST', headers: auth, body: '{"mode":"full"}' });
    expect(bad.status).toBe(400);

    const started = await fetch(`${base}/start`, { method: 'POST', headers: auth, body: '{}' });
    expect(started.status).toBe(202);
    expect(((await started.json()) as Status).overall).toBe('starting');
    const busy = await fetch(`${base}/start`, { method: 'POST', headers: auth });
    expect(busy.status).toBe(409);
    const ready = await waitFor(() => getStatus(base), (s) => s.overall !== 'starting', 30_000, 'ready');
    expect(ready.overall).toBe('ready');

    const logs = (await (await fetch(`${base}/logs/sidecar?tail=5`, { headers: auth })).json()) as { proc: string; lines: string[] };
    expect(logs.proc).toBe('sidecar');
    expect(Array.isArray(logs.lines)).toBe(true);
    expect((await fetch(`${base}/logs/nope`, { headers: auth })).status).toBe(404);

    // SSE: the stream opens and replays the tail
    const ctrl = new AbortController();
    const sse = await fetch(`${base}/logs/sidecar/stream`, { headers: auth, signal: ctrl.signal });
    expect(sse.headers.get('content-type')).toBe('text/event-stream');
    const reader = sse.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    expect(first).toContain('data: ');
    ctrl.abort();

    // the mode switch needs confirm:true, and refuses a no-op target with nothing to do
    const noConfirm = await fetch(`${base}/sidecar/mode`, { method: 'POST', headers: auth, body: '{"mode":"arm_sdk"}' });
    expect(noConfirm.status).toBe(400);

    // E-stop is forwarded to the sidecar's own /estop
    const est = await fetch(`${base}/estop`, { method: 'POST', headers: auth });
    expect(est.status).toBe(200);
    expect(h!.readCalls()).toContain('sidecar:estop');

    // a sim profile has no LAN to bring up
    expect((await fetch(`${base}/lan/up`, { method: 'POST', headers: auth })).status).toBe(409);

    const stopped = await fetch(`${base}/stop`, { method: 'POST', headers: auth });
    expect(stopped.status).toBe(202);
    const end = await waitFor(() => getStatus(base), (s) => s.overall === 'stopped', 30_000, 'stopped');
    expect(end.sidecarMode).toBeNull();
  });

  it('switches the sidecar mode only when confirmed and disarmed', async () => {
    const base = await boot();
    await fetch(`${base}/start`, { method: 'POST', headers: auth });
    await waitFor(() => getStatus(base), (s) => s.overall === 'ready', 30_000, 'ready');
    const sw = await fetch(`${base}/sidecar/mode`, { method: 'POST', headers: auth, body: JSON.stringify({ mode: 'arm_sdk', confirm: true }) });
    expect(sw.status).toBe(202);
    const after = await waitFor(() => getStatus(base), (s) => s.overall !== 'starting', 30_000, 'switched');
    expect(after.overall).toBe('ready');
    expect(after.sidecarMode).toBe('arm_sdk');
    const sc = after.steps.find((s) => s.id === 'sidecar');
    expect(sc?.checks).toMatchObject({ write_mode: 'arm_sdk', gate: 'fsm', armed: false, arm_weight: 0, dds_domain: 42 });
    expect(after.lastBase).toMatchObject({ mode: 'limp' });
    const calls = h!.readCalls();
    expect(calls.filter((c) => c.startsWith('sidecar:start'))).toEqual(['sidecar:start:read_only', 'sidecar:start:arm_sdk']);
    expect(calls).toContain('sidecar:SIGTERM');
  });

  it('answers 404 for an unknown route and 404 for an unknown step', async () => {
    const base = await boot();
    expect((await fetch(`${base}/nope`, { headers: auth })).status).toBe(404);
    expect((await fetch(`${base}/steps/nope/adopt`, { method: 'POST', headers: auth })).status).toBe(404);
    expect((await fetch(`${base}/steps/agent/adopt`, { method: 'POST', headers: auth })).status).toBe(409);
  });
});
