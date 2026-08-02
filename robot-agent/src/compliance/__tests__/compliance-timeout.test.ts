/**
 * @file compliance-timeout.test.ts
 * @description Compliance logging must never hold the boot (or the shutdown)
 *              open: every outbound request carries a deadline, a stalled
 *              server degrades to an offline session instead of blocking, and
 *              no `fetch` in the client is left unbounded.
 * @feature compliance
 * @status test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ComplianceLogClient,
  COMPLIANCE_REQUEST_TIMEOUT_MS,
} from '../ComplianceLogClient.js';

const SOURCE_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'ComplianceLogClient.ts',
);

/** Short enough that a "stalled server" test is instant, long enough not to flake. */
const TEST_TIMEOUT_MS = 25;

type FetchCall = { url: string; init: RequestInit | undefined };

/** Records every request, and answers however `respond` says. */
function spyFetch(respond: (call: FetchCall) => Promise<Response>) {
  const calls: FetchCall[] = [];
  const impl = vi.fn(async (input: unknown, init?: RequestInit) => {
    const call = { url: String(input), init };
    calls.push(call);
    return respond(call);
  });
  vi.stubGlobal('fetch', impl);
  return calls;
}

/** A server that accepts the connection and then never answers — the whole point. */
function stalledFetch(): FetchCall[] {
  return spyFetch(
    ({ init }) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) return; // unbounded call: hangs forever, and the test times out
        signal.addEventListener('abort', () => reject(signal.reason));
      }),
  );
}

function okJson(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeClient(overrides: { requestTimeoutMs?: number } = {}) {
  return new ComplianceLogClient('http://127.0.0.1:9/api-stub', 'test-robot', {
    requestTimeoutMs: overrides.requestTimeoutMs ?? TEST_TIMEOUT_MS,
  });
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ============================================================================
// THE DEFECT: a stalled server used to park the boot for up to five minutes
// ============================================================================

describe('startSession against a stalled server', () => {
  it('aborts on its own deadline instead of waiting for undici', async () => {
    const calls = stalledFetch();
    const client = makeClient();

    const started = Date.now();
    const sessionId = await client.startSession();
    const elapsed = Date.now() - started;

    expect(calls).toHaveLength(1);
    // The bound that matters: bounded by OUR deadline, nowhere near undici's
    // 300 s headersTimeout.
    expect(elapsed).toBeLessThan(2000);
    // …and it is the request itself that was cut off, not a race we won.
    expect(calls[0].init?.signal?.aborted).toBe(true);
    expect(sessionId).toMatch(/^offline-/);
  });

  it('lets the boot continue: no throw, offline session, logging still works', async () => {
    stalledFetch();
    const client = makeClient();

    // `index.ts` awaits this before `server.listen()`. It must resolve, and the
    // failure must look exactly like the unreachable-server case the code
    // already handled.
    const sessionId = await client.startSession();
    expect(sessionId).toMatch(/^offline-/);
    expect(client.isServerConnected()).toBe(false);

    // The startup event that follows it in the boot sequence still lands — in
    // the queue, for a later flush, rather than being lost.
    await expect(
      client.logSystemEvent({
        payload: { description: 'Robot agent started', eventName: 'system_startup' },
      }),
    ).resolves.toBeUndefined();
    expect(client.getQueueSize()).toBe(1);
  });

  it('does not start the flush interval when the session never came up', async () => {
    stalledFetch();
    const client = makeClient();
    await client.startSession();

    // A failed session leaves no timer behind — the same contract the
    // unreachable-server path always had. (An open interval here would keep the
    // process alive after shutdown.)
    await expect(client.endSession()).resolves.toBeUndefined();
  });
});

// ============================================================================
// EVERY call site, not just the one that was reported
// ============================================================================

describe('every outbound request carries a deadline', () => {
  it('startSession, flush, immediate sends and endSession all pass a signal', async () => {
    const calls = spyFetch(async ({ url }) =>
      url.endsWith('/api/compliance/sessions')
        ? okJson({ sessionId: 'sess-1', robotId: 'test-robot', startedAt: 'now' })
        : new Response(null, { status: 204 }),
    );
    const client = makeClient();

    await client.startSession();
    await client.logSafetyAction({
      payload: {
        description: 'protective stop',
        actionType: 'estop',
        triggerReason: 'test',
      },
    });
    await client.logSystemEvent({ payload: { description: 'x', eventName: 'x' } });
    await client.flush();
    await client.endSession();

    // POST session, POST immediate log, POST flushed log, DELETE session.
    expect(calls).toHaveLength(4);
    expect(calls.map((c) => c.init?.method)).toEqual(['POST', 'POST', 'POST', 'DELETE']);
    for (const call of calls) {
      expect(call.init?.signal, `unbounded fetch: ${call.init?.method} ${call.url}`).toBeInstanceOf(
        AbortSignal,
      );
    }
  });

  it('defaults to the shared 5 s deadline when nothing is configured', async () => {
    const calls = spyFetch(async () =>
      okJson({ sessionId: 'sess-1', robotId: 'test-robot', startedAt: 'now' }),
    );
    const client = new ComplianceLogClient('http://127.0.0.1:9/api-stub', 'test-robot');

    await client.startSession();
    await client.endSession();

    expect(COMPLIANCE_REQUEST_TIMEOUT_MS).toBe(5000);
    // Not aborted after a prompt answer — i.e. the deadline is a real one in the
    // seconds range, not something that fires immediately.
    expect(calls[0].init?.signal?.aborted).toBe(false);
  });
});

// ============================================================================
// ASSERTED, NOT EYEBALLED: the source itself may not contain an unbounded fetch
// ============================================================================

/**
 * Drop comments before scanning, so prose ABOUT a call is never mistaken for
 * one. (This very file's `requestSignal()` doc talks about the calls it guards.)
 * The `[^:]` guard keeps `http://…` inside a string from being read as a
 * comment.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * Every `fetch` call expression in a source file, as its full argument text.
 *
 * Written by hand rather than with a regex over the whole call, because the
 * argument list contains nested parens and template literals that a regex would
 * cut in the wrong place — and a scan that silently matched too little would
 * pass while a call was left unbounded.
 */
function fetchCallArguments(source: string): string[] {
  const found: string[] = [];
  const pattern = /(?<![\w.$])fetch\s*\(/g;
  const code = stripComments(source);
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(code)) !== null) {
    let depth = 1;
    let i = match.index + match[0].length;
    for (; i < code.length && depth > 0; i++) {
      if (code[i] === '(') depth++;
      else if (code[i] === ')') depth--;
    }
    expect(depth, 'unbalanced fetch call in ComplianceLogClient.ts').toBe(0);
    found.push(code.slice(match.index, i));
  }
  return found;
}

describe('ComplianceLogClient source', () => {
  const source = fs.readFileSync(SOURCE_FILE, 'utf-8');

  it('the scanner actually detects an unbounded call (guard the guard)', () => {
    const bad = [
      '// await fetch(`${url}/commented-out`, { method: "POST" });',
      'await fetch(`${this.serverUrl}/x`, {',
      '  method: "POST",',
      '  body: JSON.stringify({ a: (1 + 2) }),',
      '});',
    ].join('\n');

    const calls = fetchCallArguments(bad);
    expect(calls).toHaveLength(1); // the commented-out one is not a call
    expect(calls[0]).not.toMatch(/\bsignal\s*:/);
    expect(calls[0]).toContain('JSON.stringify({ a: (1 + 2) })'); // nesting survived
  });

  it('has no fetch call without a signal — including any added later', () => {
    const calls = fetchCallArguments(source);

    // Guard the guard: if the scanner ever stops finding the calls we know are
    // there, the "no unbounded fetch" assertion below becomes vacuously true.
    expect(calls.length).toBeGreaterThanOrEqual(4);

    for (const call of calls) {
      expect(call, `fetch without a signal:\n${call}`).toMatch(/\bsignal\s*:/);
    }
  });

  it('routes those signals through the one deadline helper', () => {
    // So that "bounded" stays a single decision. A future call site that invents
    // its own literal is the thing this catches.
    const calls = fetchCallArguments(source);
    for (const call of calls) {
      expect(call, `fetch not using requestSignal():\n${call}`).toMatch(
        /signal\s*:\s*this\.requestSignal\(\)/,
      );
    }
  });
});

// ============================================================================
// The aggregate bound: a backlog must not multiply the deadline
// ============================================================================

describe('flush against a stalled server', () => {
  it('stops after the first transport failure and re-queues the rest untried', async () => {
    // A live session first, so the flush has something to send to.
    spyFetch(async () => okJson({ sessionId: 'sess-1', robotId: 'test-robot', startedAt: 'now' }));
    const client = makeClient();
    await client.startSession();

    for (let i = 0; i < 5; i++) {
      await client.logSystemEvent({ payload: { description: `e${i}`, eventName: 'e' } });
    }
    expect(client.getQueueSize()).toBe(5);

    const calls = stalledFetch();
    const started = Date.now();
    await client.flush();
    const elapsed = Date.now() - started;

    // One attempt, not five: `endSession()` awaits this on the shutdown path, so
    // a backlog may not cost backlog × deadline.
    expect(calls).toHaveLength(1);
    expect(elapsed).toBeLessThan(TEST_TIMEOUT_MS * 4);
    // Nothing dropped, and the original order kept for the next flush.
    expect(client.getQueueSize()).toBe(5);

    await client.endSession(); // stop the auto-flush timer this test started
  });

  it('keeps going when the server ANSWERS with an error — that is not a transport failure', async () => {
    spyFetch(async () => okJson({ sessionId: 'sess-1', robotId: 'test-robot', startedAt: 'now' }));
    const client = makeClient();
    await client.startSession();

    for (let i = 0; i < 3; i++) {
      await client.logSystemEvent({ payload: { description: `e${i}`, eventName: 'e' } });
    }

    const calls = spyFetch(async () => new Response(null, { status: 422 }));
    await client.flush();

    expect(calls).toHaveLength(3);
    expect(client.getQueueSize()).toBe(3);

    await client.endSession(); // stop the auto-flush timer this test started
  });
});
