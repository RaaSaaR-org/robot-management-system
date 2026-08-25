/**
 * @file logger.test.ts
 * @description Unit tests for the structured logger module: the pino logger
 *   instance, requestIdMiddleware request-id handling, and the httpLogger
 *   pino-http middleware factory output.
 * @feature core
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

import {
  logger,
  requestIdMiddleware,
  httpLogger,
  REDACT_PATHS,
  scrubCameraTicket,
  ticketSafeReqSerializer,
} from '../logger.js';

// --------------------------------------------------------------------------
// Helpers to build fake express objects
// --------------------------------------------------------------------------

interface FakeReq {
  headers: Record<string, string | string[] | undefined>;
  url?: string;
  id?: unknown;
}

function makeReq(headers: Record<string, string | string[] | undefined> = {}): FakeReq {
  return { headers };
}

function makeRes() {
  const setHeader = vi.fn();
  return {
    setHeader,
  } as unknown as Response & { setHeader: ReturnType<typeof vi.fn> };
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('logger module', () => {
  // ------------------------------------------------------------------------
  // logger instance
  // ------------------------------------------------------------------------
  describe('logger', () => {
    it('exports a pino logger with the standard logging methods', () => {
      expect(logger).toBeDefined();
      expect(typeof logger.info).toBe('function');
      expect(typeof logger.warn).toBe('function');
      expect(typeof logger.error).toBe('function');
      expect(typeof logger.debug).toBe('function');
    });

    it('is silent under the test environment', () => {
      // isTest is true under vitest (VITEST === 'true'), so level is "silent".
      expect(logger.level).toBe('silent');
    });

    it('redacts sensitive fields when output is captured (behavioral)', async () => {
      // Build a sibling logger at info level with a capturing stream, because
      // the app logger is "silent" in tests and emits nothing. It uses the
      // REAL `REDACT_PATHS` — a hand-retyped list here would have tested its
      // own copy and passed no matter what the server was configured with.
      const pino = (await import('pino')).default;
      const lines: string[] = [];
      const stream = { write: (s: string) => lines.push(s) };
      const captured = pino(
        {
          level: 'info',
          redact: {
            paths: [...REDACT_PATHS],
            censor: '[REDACTED]',
          },
        },
        stream
      );

      captured.info(
        {
          password: 'hunter2',
          token: 'secret-token',
          req: { headers: { authorization: 'Bearer abc' } },
          body: { refreshToken: 'rt-123' },
          safe: 'visible',
        },
        'msg'
      );

      const out = lines.join('');
      expect(out).toContain('[REDACTED]');
      expect(out).not.toContain('hunter2');
      expect(out).not.toContain('secret-token');
      expect(out).not.toContain('Bearer abc');
      expect(out).not.toContain('rt-123');
      // Non-sensitive fields remain.
      expect(out).toContain('visible');
    });

    it('can create a child logger and log without throwing', () => {
      const child = logger.child({ component: 'test' });
      expect(typeof child.info).toBe('function');
      // Calling a log method must not throw even when silent.
      expect(() => child.info('hello')).not.toThrow();
    });
  });

  // ------------------------------------------------------------------------
  // requestIdMiddleware
  // ------------------------------------------------------------------------
  describe('requestIdMiddleware', () => {
    let next: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      next = vi.fn();
    });

    it('uses an incoming x-request-id header when present', () => {
      const req = makeReq({ 'x-request-id': 'incoming-id-123' });
      const res = makeRes();

      requestIdMiddleware(
        req as unknown as Request,
        res,
        next as unknown as NextFunction
      );

      expect(req.id).toBe('incoming-id-123');
      expect(res.setHeader).toHaveBeenCalledWith('x-request-id', 'incoming-id-123');
      expect(next).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledWith();
    });

    it('generates a UUIDv4 when no x-request-id header is present', () => {
      const req = makeReq({});
      const res = makeRes();

      requestIdMiddleware(
        req as unknown as Request,
        res,
        next as unknown as NextFunction
      );

      expect(typeof req.id).toBe('string');
      expect(req.id as string).toMatch(UUID_RE);
      expect(res.setHeader).toHaveBeenCalledWith('x-request-id', req.id);
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('generates distinct ids across separate requests without a header', () => {
      const reqA = makeReq({});
      const reqB = makeReq({});
      requestIdMiddleware(reqA as unknown as Request, makeRes(), next as unknown as NextFunction);
      requestIdMiddleware(reqB as unknown as Request, makeRes(), next as unknown as NextFunction);

      expect(reqA.id).not.toBe(reqB.id);
      expect(reqA.id as string).toMatch(UUID_RE);
      expect(reqB.id as string).toMatch(UUID_RE);
    });

    it('sets the response header to the same value stored on req.id', () => {
      const req = makeReq({});
      const res = makeRes();
      requestIdMiddleware(req as unknown as Request, res, next as unknown as NextFunction);

      const headerCall = res.setHeader.mock.calls.find((c) => c[0] === 'x-request-id');
      expect(headerCall).toBeDefined();
      expect(headerCall?.[1]).toBe(req.id);
    });
  });

  // ------------------------------------------------------------------------
  // httpLogger (pino-http middleware)
  // ------------------------------------------------------------------------
  describe('httpLogger', () => {
    it('is a callable middleware function', () => {
      expect(typeof httpLogger).toBe('function');
    });

    it('exposes the underlying pino logger instance', () => {
      // pino-http attaches the logger as a property on the middleware.
      expect(httpLogger.logger).toBeDefined();
      expect(typeof httpLogger.logger.info).toBe('function');
    });
  });

  // ------------------------------------------------------------------------
  // Camera stream ticket (TASK-214)
  //
  // The ticket rides in the query string because an `<img>` cannot send an
  // Authorization header. It is scoped and short-lived, but replayable — and
  // the whole reason it exists is that credentials in URLs end up in logs. So
  // it must not end up in ours, in EITHER of the two places pino puts a URL.
  // ------------------------------------------------------------------------
  describe('camera ticket redaction', () => {
    it('scrubs the ticket out of a URL, keeping the rest of the query', () => {
      expect(scrubCameraTicket('/api/robots/g1-01/camera/head?ticket=eyJhbGciOi.sig')).toBe(
        '/api/robots/g1-01/camera/head?ticket=[REDACTED]'
      );
      expect(scrubCameraTicket('/s?a=1&ticket=secret&b=2')).toBe('/s?a=1&ticket=[REDACTED]&b=2');
    });

    it('scrubs every copy, not just the first', () => {
      expect(scrubCameraTicket('/s?ticket=one&ticket=two')).toBe(
        '/s?ticket=[REDACTED]&ticket=[REDACTED]'
      );
    });

    it('leaves a URL with no ticket alone', () => {
      expect(scrubCameraTicket('/api/robots/g1-01/camera/head')).toBe(
        '/api/robots/g1-01/camera/head'
      );
    });

    it('the installed req serializer emits no ticket in req.url', () => {
      // Runs the serializer the server actually installs, not a copy of it.
      const serialized = ticketSafeReqSerializer({
        method: 'GET',
        url: '/api/robots/g1-01/camera/head?ticket=eyJhbGciOi.sig',
        headers: { host: 'neodem.local' },
        socket: { remoteAddress: '10.0.0.1', remotePort: 5555 },
      } as unknown as Parameters<typeof ticketSafeReqSerializer>[0]);

      expect(JSON.stringify(serialized)).not.toContain('eyJhbGciOi.sig');
      expect(serialized.url).toContain('[REDACTED]');
      // The parts that make the log line useful survive.
      expect(serialized.method).toBe('GET');
      expect(serialized.url).toContain('/api/robots/g1-01/camera/head');
    });

    it('the parsed query copy is redacted too', async () => {
      // pino's std req serializer also copies `req.query`, which the string
      // scrub above cannot reach — that copy is covered by REDACT_PATHS.
      const pino = (await import('pino')).default;
      const lines: string[] = [];
      const captured = pino(
        { level: 'info', redact: { paths: [...REDACT_PATHS], censor: '[REDACTED]' } },
        { write: (s: string) => lines.push(s) }
      );

      captured.info({ req: { query: { ticket: 'eyJhbGciOi.sig' } } }, 'stream open');

      expect(lines.join('')).not.toContain('eyJhbGciOi.sig');
      expect(lines.join('')).toContain('[REDACTED]');
    });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
