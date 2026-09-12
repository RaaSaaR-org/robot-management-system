/**
 * @file compliance-auth.test.ts
 * @description Compliance record-keeping is a platform call like any other: it
 *              carries the service credential, and a refusal is recorded and
 *              said out loud instead of disappearing into the retry queue.
 * @feature compliance
 * @status test
 *
 * Real loopback HTTP, not a stubbed `fetch`: the thing under test is what goes
 * out on the wire (the `Authorization` header) and what comes back (a 401), and
 * a mock of `fetch` would assert only that the code calls the mock.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import {
  lastPlatformAuthRejection,
  resetPlatformAuthRejection,
} from '../../utils/platform-auth.js';
import { ComplianceLogClient } from '../ComplianceLogClient.js';

const token = 'ndsa_test-compliance-token';

let server: Server;
let baseUrl: string;
let calls: { url: string; method?: string; auth?: string }[];
/** Which paths answer 401 — `null` for "everything is accepted". */
let reject: 'all' | 'logs' | null;

const safety = {
  payload: { description: 'Protective stop', actionType: 'estop', triggerReason: 'test' },
};

beforeEach(async () => {
  vi.stubEnv('NEODEM_SERVICE_TOKEN', token);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  calls = [];
  reject = null;
  resetPlatformAuthRejection();

  server = createServer((req, res) => {
    calls.push({ url: req.url!, method: req.method, auth: req.headers.authorization });
    req.resume();
    const isLogs = req.url === '/api/compliance/logs';
    if (reject === 'all' || (reject === 'logs' && isLogs)) {
      res.writeHead(401).end('Unauthorized');
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/compliance/sessions') {
      res.end(JSON.stringify({ sessionId: 'session-1', robotId: 'robot-1', startedAt: 'now' }));
    } else {
      res.end('{}');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function client(): ComplianceLogClient {
  return new ComplianceLogClient(baseUrl, 'robot-1');
}

/** Every `console.error` line mentioning a given phrase. */
function errorsContaining(phrase: string): string[] {
  return (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls
    .map((args) => String(args[0]))
    .filter((line) => line.includes(phrase));
}

describe('compliance calls carry the platform credential', () => {
  it('sends the bearer token on session start, logs, flush and shutdown', async () => {
    const c = client();
    try {
      expect(await c.startSession()).toBe('session-1');
      await c.logSafetyAction(safety);
      await c.logSystemEvent({ payload: { description: 'up', eventName: 'system_startup' } });
      await c.flush();
      expect(c.getQueueSize()).toBe(0);
    } finally {
      await c.endSession();
    }

    expect(calls.map((call) => call.method)).toEqual(['POST', 'POST', 'POST', 'DELETE']);
    expect(calls.every((call) => call.auth === `Bearer ${token}`)).toBe(true);
    // Nothing was refused, so the health endpoint has nothing to report.
    expect(lastPlatformAuthRejection()).toBeNull();
  });
});

describe('a refused compliance call is recorded and announced', () => {
  it('reports a refused session start and still boots on an offline session', async () => {
    reject = 'all';
    const c = client();

    // The boot path awaits this — it may not throw, however the platform answers.
    expect(await c.startSession()).toMatch(/^offline-/);
    expect(c.isServerConnected()).toBe(false);

    expect(errorsContaining('Session start rejected: HTTP 401')).toHaveLength(1);
    expect(errorsContaining('Session start rejected')[0]).toContain(
      'the configured NEODEM_SERVICE_TOKEN was refused',
    );
    expect(lastPlatformAuthRejection()).toMatchObject({
      client: 'ComplianceLogClient',
      status: 401,
      url: `${baseUrl}/api/compliance/sessions`,
      tokenConfigured: true,
    });
  });

  it('reports refused immediate and queued log delivery, once per flush pass', async () => {
    const c = client();
    await c.startSession();
    try {
      reject = 'logs';

      // Safety actions go straight out, so this one is reported on its own.
      await c.logSafetyAction(safety);
      expect(c.getQueueSize()).toBe(1);
      expect(errorsContaining('Immediate log delivery rejected: HTTP 401')).toHaveLength(1);

      // Three more records, so the flush pass refuses four in a row.
      for (let i = 0; i < 3; i++) {
        await c.logSystemEvent({ payload: { description: `e${i}`, eventName: 'e' } });
      }
      await c.flush();

      // Refused, so nothing is dropped and nothing claims delivery…
      expect(c.getQueueSize()).toBe(4);
      // …and the refusal is one line, not one per record.
      const flushErrors = errorsContaining('Queued log delivery rejected: HTTP 401');
      expect(flushErrors).toHaveLength(1);
      expect(flushErrors[0]).toContain('the configured NEODEM_SERVICE_TOKEN was refused');
      expect(lastPlatformAuthRejection()).toMatchObject({
        client: 'ComplianceLogClient',
        status: 401,
        url: `${baseUrl}/api/compliance/logs`,
      });

      // Credential fixed at the platform: the backlog drains, unchanged.
      reject = null;
      await c.flush();
      expect(c.getQueueSize()).toBe(0);
    } finally {
      await c.endSession();
    }
  });

  it('reports a refused session shutdown', async () => {
    const c = client();
    await c.startSession();
    reject = 'all';
    await c.endSession();

    expect(errorsContaining('Session shutdown rejected: HTTP 401')).toHaveLength(1);
    expect(lastPlatformAuthRejection()).toMatchObject({
      client: 'ComplianceLogClient',
      status: 401,
      url: `${baseUrl}/api/compliance/sessions/session-1`,
    });
  });

  it('distinguishes "no token configured" from "the configured token was refused"', async () => {
    // The deployment that was only ever working because of AUTH_DISABLED=true.
    vi.stubEnv('NEODEM_SERVICE_TOKEN', '');
    reject = 'all';
    const c = client();

    await c.startSession();

    expect(calls[0].auth).toBeUndefined();
    expect(errorsContaining('Session start rejected')[0]).toContain(
      'no NEODEM_SERVICE_TOKEN is configured',
    );
    expect(lastPlatformAuthRejection()).toMatchObject({ tokenConfigured: false });
  });
});
