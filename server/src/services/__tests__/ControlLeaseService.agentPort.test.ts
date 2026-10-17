/**
 * @file ControlLeaseService.agentPort.test.ts
 * @description The server's HTTP port to the robot agent's control-lease
 *              routes (TASK-395): the agent's renew answer reports `bound` as a
 *              socket count, and a count above zero must read as bound — else
 *              the lease is fenced with `transport_lost` after the first TTL
 *              window.
 * @feature robots
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { httpControlLeaseAgent, isBound, type ControlLeaseRobot } from '../ControlLeaseService.js';

describe('isBound', () => {
  it.each([
    [1, true],
    [2, true],
    [true, true],
    [0, false],
    [false, false],
    [undefined, false],
    [null, false],
    ['1', false],
    [Number.NaN, false],
    [Number.POSITIVE_INFINITY, false],
    [-1, false],
  ])('isBound(%s) is %s', (value, expected) => {
    expect(isBound(value)).toBe(expected);
  });
});

describe('httpControlLeaseAgent.renew', () => {
  let server: Server;
  let robot: ControlLeaseRobot;
  let status = 200;
  let answer: unknown = {};
  const requests: Array<{ url: string; body: unknown }> = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => (raw += chunk));
      req.on('end', () => {
        requests.push({ url: req.url ?? '', body: raw ? JSON.parse(raw) : null });
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(answer));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    robot = { robotId: 'robot-1', tenantId: 'tenant-a', baseUrl: `http://127.0.0.1:${port}/` };
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    status = 200;
    answer = {};
    requests.length = 0;
  });

  it('reads the agent\'s socket count `bound: 1` as bound', async () => {
    answer = { renewed: true, bound: 1 };
    await expect(httpControlLeaseAgent.renew(robot, 7, 5000)).resolves.toEqual({ ok: true, bound: true });
    expect(requests).toEqual([
      { url: '/api/v1/robots/robot-1/control-lease/renew', body: { generation: 7, ttlMs: 5000 } },
    ]);
  });

  it('reads `bound: 0` as unbound', async () => {
    answer = { renewed: true, bound: 0 };
    await expect(httpControlLeaseAgent.renew(robot, 7, 5000)).resolves.toEqual({ ok: true, bound: false });
  });

  it('still accepts a boolean `bound: true`', async () => {
    answer = { renewed: true, bound: true };
    await expect(httpControlLeaseAgent.renew(robot, 7, 5000)).resolves.toEqual({ ok: true, bound: true });
  });

  it('fails closed as unbound when `bound` is missing', async () => {
    answer = { renewed: true };
    await expect(httpControlLeaseAgent.renew(robot, 7, 5000)).resolves.toEqual({ ok: true, bound: false });
  });

  it('treats an answer without an explicit renewal as rejected', async () => {
    answer = { bound: 1 };
    await expect(httpControlLeaseAgent.renew(robot, 7, 5000)).resolves.toEqual({ ok: false, reason: 'rejected' });
  });

  it('treats the agent\'s 409 as rejected', async () => {
    status = 409;
    answer = { error: 'expired' };
    await expect(httpControlLeaseAgent.renew(robot, 7, 5000)).resolves.toEqual({ ok: false, reason: 'rejected' });
  });
});
