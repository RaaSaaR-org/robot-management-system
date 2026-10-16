/**
 * @file teleopProxy.test.ts
 * @description TASK-393: the same-origin teleop socket. Real sockets on
 *              loopback: a real HTTP server with the upgrade dispatcher, a fake
 *              robot agent, and `ws` clients that behave like the browser.
 *              Covers the auth at the upgrade (token in the subprotocol, never
 *              the URL), tenant isolation, both directions of the pipe, the
 *              frames sent while the agent socket is still opening, and the
 *              teardown on either side.
 * @feature robots
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, WebSocket } from 'ws';
import {
  attachUpgradeRoutes,
  agentTeleopUrl,
  createTeleopProxy,
  tokenFromProtocols,
  TELEOP_SUBPROTOCOL,
  type TeleopProxyDeps,
} from '../teleopProxy.js';

interface Agent {
  url: string;
  wss: WebSocketServer;
  server: http.Server;
  received: string[];
  headers: http.IncomingHttpHeaders[];
  sockets: WebSocket[];
}

/** A stand-in robot agent: answers every frame with `{type:'state', echo}`. */
async function startAgent(): Promise<Agent> {
  const server = http.createServer();
  const wss = new WebSocketServer({ noServer: true });
  const agent: Agent = { url: '', wss, server, received: [], headers: [], sockets: [] };
  server.on('upgrade', (req, socket, head) => {
    if (!req.url?.startsWith('/ws/keyboard-teleop')) {
      socket.destroy();
      return;
    }
    agent.headers.push(req.headers);
    wss.handleUpgrade(req, socket, head, (ws) => {
      agent.sockets.push(ws);
      ws.send(JSON.stringify({ type: 'config', robotType: 'g1_edu' }));
      ws.on('message', (data) => {
        const text = data.toString();
        agent.received.push(text);
        ws.send(JSON.stringify({ type: 'state', echo: JSON.parse(text) }));
      });
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  agent.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return agent;
}

let agent: Agent;
let server: http.Server;
let base: string;
let authDisabled: boolean;
let robots: Map<string, { baseUrl: string; tenantId: string | null }>;
const clients: WebSocket[] = [];

const TOKENS: Record<string, { userId: string; role: string; tenantId: string | null }> = {
  'good-token': { userId: 'u1', role: 'member', tenantId: 't1' },
  'viewer-token': { userId: 'u2', role: 'viewer', tenantId: 't1' },
  'other-tenant': { userId: 'u3', role: 'owner', tenantId: 't2' },
};

beforeEach(async () => {
  agent = await startAgent();
  authDisabled = true;
  robots = new Map([['r1', { baseUrl: agent.url, tenantId: 't1' }]]);
  const deps: TeleopProxyDeps = {
    resolveRobot: async (id) => robots.get(id) ?? null,
    verifyAccessToken: (t) => TOKENS[t] ?? null,
    authDisabled: () => authDisabled,
    agentHeaders: () => ({ Authorization: 'Bearer agent-secret' }),
  };
  server = http.createServer((_req, res) => res.end('ok'));
  attachUpgradeRoutes(server, [createTeleopProxy(deps)]);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  for (const c of clients.splice(0)) c.terminate();
  for (const s of agent.sockets) s.terminate();
  await new Promise<void>((r) => server.close(() => r()));
  agent.wss.close();
  await new Promise<void>((r) => agent.server.close(() => r()));
});

function open(path: string, protocols: string[] = [TELEOP_SUBPROTOCOL]): WebSocket {
  const ws = new WebSocket(`${base}${path}`, protocols);
  clients.push(ws);
  return ws;
}

/** Resolves with the HTTP status of a refused upgrade, or 101 when it opened. */
function upgradeStatus(ws: WebSocket): Promise<number> {
  return new Promise((resolve) => {
    ws.on('open', () => resolve(101));
    ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
    ws.on('error', () => resolve(0));
  });
}

function nextMessage(ws: WebSocket, type: string): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const onMessage = (data: WebSocket.RawData, isBinary: boolean) => {
      expect(isBinary).toBe(false);
      const msg = JSON.parse(data.toString()) as Record<string, unknown>;
      if (msg.type === type) {
        ws.off('message', onMessage);
        resolve(msg);
      }
    };
    ws.on('message', onMessage);
  });
}

describe('helpers', () => {
  it('reads the token from the subprotocol list', () => {
    expect(tokenFromProtocols(['neodem.teleop', 'bearer.abc'])).toBe('abc');
    expect(tokenFromProtocols(['neodem.teleop'])).toBeNull();
    expect(tokenFromProtocols(['bearer.'])).toBeNull();
  });

  it('builds the agent socket URL from its base URL', () => {
    expect(agentTeleopUrl('http://10.0.0.2:41243/')).toBe('ws://10.0.0.2:41243/ws/keyboard-teleop');
    expect(agentTeleopUrl('https://robot.example')).toBe('wss://robot.example/ws/keyboard-teleop');
  });
});

describe('the teleop proxy', () => {
  it('pipes frames both ways as text and selects the teleop subprotocol', async () => {
    const ws = open('/api/robots/r1/teleop/ws');
    const config = nextMessage(ws, 'config');
    expect(await upgradeStatus(ws)).toBe(101);
    expect(ws.protocol).toBe(TELEOP_SUBPROTOCOL);
    expect((await config).robotType).toBe('g1_edu');
    const reply = nextMessage(ws, 'state');
    ws.send(JSON.stringify({ hb: 1 }));
    expect((await reply).echo).toEqual({ hb: 1 });
    expect(agent.headers[0].authorization).toBe('Bearer agent-secret');
  });

  it('delivers frames sent before the agent socket finished opening, in order', async () => {
    const ws = open('/api/robots/r1/teleop/ws');
    await upgradeStatus(ws);
    for (let i = 0; i < 5; i++) ws.send(JSON.stringify({ hb: i }));
    await new Promise((r) => setTimeout(r, 150));
    expect(agent.received.map((t) => JSON.parse(t).hb)).toEqual([0, 1, 2, 3, 4]);
  });

  it('refuses an unknown robot with 404 before any upgrade', async () => {
    expect(await upgradeStatus(open('/api/robots/nope/teleop/ws'))).toBe(404);
  });

  it('refuses a path nobody owns', async () => {
    expect(await upgradeStatus(open('/api/robots/r1/teleop/elsewhere'))).toBe(404);
  });

  describe('with auth on', () => {
    beforeEach(() => {
      authDisabled = false;
    });

    it('refuses a socket without a token (401) and never reaches the agent', async () => {
      expect(await upgradeStatus(open('/api/robots/r1/teleop/ws'))).toBe(401);
      expect(agent.headers).toHaveLength(0);
    });

    it('refuses a bad token', async () => {
      expect(await upgradeStatus(open('/api/robots/r1/teleop/ws', [TELEOP_SUBPROTOCOL, 'bearer.forged']))).toBe(401);
    });

    it('accepts a valid token in the subprotocol and never echoes it back', async () => {
      const ws = open('/api/robots/r1/teleop/ws', [TELEOP_SUBPROTOCOL, 'bearer.good-token']);
      expect(await upgradeStatus(ws)).toBe(101);
      expect(ws.protocol).toBe(TELEOP_SUBPROTOCOL);
    });

    it('refuses a viewer (403): watching is not driving', async () => {
      expect(await upgradeStatus(open('/api/robots/r1/teleop/ws', [TELEOP_SUBPROTOCOL, 'bearer.viewer-token']))).toBe(403);
    });

    it('answers another tenant\'s robot exactly like a missing one', async () => {
      expect(await upgradeStatus(open('/api/robots/r1/teleop/ws', [TELEOP_SUBPROTOCOL, 'bearer.other-tenant']))).toBe(404);
    });
  });

  it('closes the client with 1011 when the agent cannot be reached', async () => {
    robots.set('dead', { baseUrl: 'http://127.0.0.1:1', tenantId: 't1' });
    const ws = open('/api/robots/dead/teleop/ws');
    const code = await new Promise<number>((resolve) => ws.on('close', (c) => resolve(c)));
    expect(code).toBe(1011);
  });

  it('closes the agent socket when the browser goes away — the agent\'s cleanup is what stops the robot', async () => {
    const ws = open('/api/robots/r1/teleop/ws');
    await nextMessage(ws, 'config');
    const upstream = agent.sockets[0];
    const closed = new Promise<void>((r) => upstream.on('close', () => r()));
    ws.close();
    await closed;
  });

  it('closes the browser socket when the agent goes away', async () => {
    const ws = open('/api/robots/r1/teleop/ws');
    await nextMessage(ws, 'config');
    const closed = new Promise<number>((r) => ws.on('close', (c) => r(c)));
    agent.sockets[0].close(1001, 'agent restarting');
    expect(await closed).toBe(1001);
  });
});
