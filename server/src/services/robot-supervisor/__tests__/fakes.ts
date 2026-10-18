/**
 * @file fakes.ts
 * @description A fake robot supervisor and a fake robot agent on loopback
 *              HTTP, for the readiness and bringup tests (TASK-409).
 * @feature robots
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { QuestStatus, SupervisorStatus, SupervisorStepStatus } from '../SupervisorClient.js';
import type { AgentReadiness } from '../RobotReadinessService.js';

export const TOKEN = 'test-supervisor-token-0123456789';

export interface FakeHttp {
  url: string;
  port: number;
  requests: Array<{ method: string; path: string; auth: string | undefined; body: unknown }>;
  close(): Promise<void>;
}

type Handler = (req: IncomingMessage, res: ServerResponse, body: unknown) => void;

export async function fakeHttp(handler: Handler): Promise<FakeHttp> {
  const requests: FakeHttp['requests'] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      let body: unknown = null;
      try {
        body = raw ? JSON.parse(raw) : null;
      } catch {
        body = raw;
      }
      requests.push({ method: req.method ?? 'GET', path: req.url ?? '/', auth: req.headers.authorization, body });
      handler(req, res, body);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    requests,
    close: () =>
      new Promise<void>((r) => {
        server.closeAllConnections?.();
        server.close(() => r());
      }),
  };
}

export function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

const STEP_IDS = ['preflight', 'link', 'camera', 'bridge', 'sidecar', 'agent'] as const;

export function step(id: SupervisorStepStatus['id'], state: SupervisorStepStatus['state'], extra: Partial<SupervisorStepStatus> = {}): SupervisorStepStatus {
  return { id, state, owned: state === 'ok', pid: null, startedAt: null, detail: null, checks: {}, code: null, foreign: null, actions: [], ...extra };
}

/** A supervisor status; every step `state` unless overridden. */
export function supStatus(
  overall: SupervisorStatus['overall'],
  state: SupervisorStepStatus['state'],
  overrides: Partial<Record<SupervisorStepStatus['id'], SupervisorStepStatus>> = {},
  agentPort = 41299,
): SupervisorStatus {
  return {
    robotId: 'sim-g1',
    profile: '/x/sim.yaml',
    robot: 'sim',
    sidecarMode: state === 'ok' ? 'read_only' : null,
    overall,
    steps: STEP_IDS.map((id) => overrides[id] ?? step(id, state)),
    lastBase: { mode: 'damp', fsmId: 1 },
    agentPort,
    at: new Date().toISOString(),
  };
}

export function agentReadiness(robotId: string, reason: AgentReadiness['reason'], at = new Date().toISOString()): AgentReadiness {
  return {
    robotId,
    at,
    simulated: true,
    sidecar: { reachable: true, connected: true, url: 'http://127.0.0.1:18777' },
    base: { mode: 'limp', fsmId: 1, gate: 'fsm', ageS: 0.1, error: null, stale: false },
    reason,
  };
}

/** A Quest report: one Quest 3, reversed or not. */
export function questStatus(reversed = false): QuestStatus {
  return {
    adb: '/home/op/platform-tools/adb',
    devices: [{ serial: '2G0YC5ZG8X0123', state: 'device', model: 'Quest 3' }],
    reversed: reversed ? [{ remote: 'tcp:1420', local: 'tcp:1420' }] : [],
    hint: reversed ? null : 'Headset connected. Press Connect to forward port 1420.',
  };
}

/**
 * A fake supervisor whose `/status` answers whatever `state.status` holds, and
 * `/quest` whatever `state.quest` holds (404 when unset, like an older one).
 */
export async function fakeSupervisor(state: {
  status: SupervisorStatus;
  answer?: { status: number; body: unknown };
  quest?: QuestStatus;
}): Promise<FakeHttp> {
  return fakeHttp((req, res) => {
    if (req.headers.authorization !== `Bearer ${TOKEN}`) {
      json(res, 401, { ok: false, code: 'unauthorized' });
      return;
    }
    const path = (req.url ?? '/').split('?')[0];
    if (req.method === 'GET' && path === '/status') {
      json(res, 200, state.status);
      return;
    }
    if (path === '/quest' || path.startsWith('/quest/')) {
      if (!state.quest) {
        json(res, 404, { ok: false, code: 'not_found' });
        return;
      }
      if (req.method === 'GET' && path === '/quest') {
        json(res, 200, state.quest);
        return;
      }
      if (req.method === 'POST' && path === '/quest/connect') state.quest = { ...state.quest, reversed: [{ remote: 'tcp:1420', local: 'tcp:1420' }], hint: null };
      json(res, 200, { ok: true, status: 200, code: null, error: null, serial: state.quest.devices[0]?.serial ?? null, quest: state.quest });
      return;
    }
    if (req.method === 'GET' && /^\/logs\/[a-z]+\/stream$/.test(path)) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify('line one')}\n\n`);
      res.end(`data: ${JSON.stringify('line two')}\n\n`);
      return;
    }
    if (req.method === 'GET' && path.startsWith('/logs/')) {
      json(res, 200, { proc: path.split('/')[2], lines: ['a', 'b'] });
      return;
    }
    const a = state.answer ?? { status: 202, body: state.status };
    json(res, a.status, a.body);
  });
}

/** A fake agent whose readiness route answers `state.readiness` (or `state.fail`). */
export async function fakeAgent(state: { readiness: AgentReadiness | null; fail?: number; outdated?: boolean }): Promise<FakeHttp> {
  return fakeHttp((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    if (req.method === 'GET' && path === '/api/v1/health') {
      json(res, 200, { status: 'healthy' });
      return;
    }
    // An agent from before TASK-405: healthy, but no readiness route at all.
    if (state.outdated) {
      json(res, 404, { error: 'Not found' });
      return;
    }
    const m = /^\/api\/v1\/robots\/([^/]+)\/readiness$/.exec(path);
    if (req.method === 'GET' && m) {
      if (state.fail) {
        json(res, state.fail, { code: 'ROBOT_NOT_FOUND' });
        return;
      }
      json(res, 200, state.readiness);
      return;
    }
    json(res, 404, { code: 'not_found' });
  });
}

/** A loopback port nothing listens on. */
export async function deadPort(): Promise<number> {
  const h = await fakeHttp((_q, s) => s.end());
  await h.close();
  return h.port;
}
