/**
 * @file SupervisorClient.test.ts
 * @description The supervisor client against a fake supervisor (TASK-409):
 *              bearer token, any answer passed through, no answer → typed
 *              unreachable error, the env parser and the agent URL it derives.
 * @feature robots
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  parseSupervisorUrls,
  SupervisorClient,
  SupervisorUnreachableError,
  supervisorsFromEnv,
} from '../SupervisorClient.js';
import { deadPort, fakeHttp, fakeSupervisor, supStatus, TOKEN, type FakeHttp } from './fakes.js';

let servers: FakeHttp[] = [];
afterEach(async () => {
  await Promise.all(servers.map((s) => s.close()));
  servers = [];
});

describe('SupervisorClient', () => {
  it('sends the bearer token and returns the status', async () => {
    const sup = await fakeSupervisor({ status: supStatus('ready', 'ok') });
    servers.push(sup);
    const client = new SupervisorClient(`${sup.url}/`, TOKEN);
    const answer = await client.status();
    expect(answer.status).toBe(200);
    expect(answer.body.overall).toBe('ready');
    expect(sup.requests[0]).toMatchObject({ method: 'GET', path: '/status', auth: `Bearer ${TOKEN}` });
  });

  it('passes a refusal through with its status and body', async () => {
    const sup = await fakeSupervisor({ status: supStatus('ready', 'ok'), answer: { status: 409, body: { ok: false, code: 'busy' } } });
    servers.push(sup);
    const answer = await new SupervisorClient(sup.url, TOKEN).start('read_only');
    expect(answer).toEqual({ status: 409, body: { ok: false, code: 'busy' } });
    expect(sup.requests[0]).toMatchObject({ method: 'POST', path: '/start', body: { mode: 'read_only' } });
  });

  it('maps every write to its supervisor route', async () => {
    const sup = await fakeSupervisor({ status: supStatus('ready', 'ok') });
    servers.push(sup);
    const c = new SupervisorClient(sup.url, TOKEN);
    await c.stop();
    await c.sidecarMode('arm_sdk', true);
    await c.step('bridge', 'adopt');
    await c.step('sidecar', 'leave');
    await c.lanUp();
    await c.logs('agent', 50);
    expect(sup.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      'POST /stop',
      'POST /sidecar/mode',
      'POST /steps/bridge/adopt',
      'POST /steps/sidecar/leave',
      'POST /lan/up',
      'GET /logs/agent?tail=50',
    ]);
    expect(sup.requests[1].body).toEqual({ mode: 'arm_sdk', confirm: true });
  });

  it('throws SupervisorUnreachableError when nothing listens', async () => {
    const port = await deadPort();
    await expect(new SupervisorClient(`http://127.0.0.1:${port}`, TOKEN).status()).rejects.toBeInstanceOf(
      SupervisorUnreachableError,
    );
  });

  it('times out after its timeout', async () => {
    const slow = await fakeHttp(() => {
      /* never answers */
    });
    servers.push(slow);
    const started = Date.now();
    const err = await new SupervisorClient(slow.url, TOKEN, { timeoutMs: 150 }).status().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SupervisorUnreachableError);
    expect((err as Error).message).toBe('timed out');
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('derives the agent URL from the status agentPort on the supervisor host', () => {
    const c = new SupervisorClient('http://10.0.0.5:8766', TOKEN);
    expect(c.agentUrlFor({ agentPort: 41299 })).toBe('http://10.0.0.5:41299');
    expect(c.agentUrlFor({})).toBeNull();
    expect(c.agentUrlFor(null)).toBeNull();
  });
});

describe('ROBOT_SUPERVISORS', () => {
  it('parses robotId=url pairs and skips malformed entries', () => {
    const m = parseSupervisorUrls(' g1-edu-4=http://127.0.0.1:8766 , sim=http://127.0.0.1:18766,bad,=http://x, x=ftp://y ');
    expect([...m.entries()]).toEqual([
      ['g1-edu-4', 'http://127.0.0.1:8766'],
      ['sim', 'http://127.0.0.1:18766'],
    ]);
  });

  it('is empty when unset', () => {
    expect(parseSupervisorUrls(undefined).size).toBe(0);
    expect(supervisorsFromEnv({}).size).toBe(0);
  });

  it('builds one client per robot', () => {
    const m = supervisorsFromEnv({ ROBOT_SUPERVISORS: 'a=http://127.0.0.1:1', ROBOT_SUPERVISOR_TOKEN: TOKEN });
    expect(m.get('a')?.baseUrl).toBe('http://127.0.0.1:1');
  });
});
