/**
 * @file logger.test.ts
 * @description Unit tests for the structured logger module: the pino logger
 *   instance, requestIdMiddleware request-id handling, and the httpLogger
 *   pino-http middleware factory output.
 * @feature core
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

import { logger, requestIdMiddleware, httpLogger } from '../logger.js';

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
      // Build a sibling logger with the SAME redaction config but at info level
      // and a capturing stream, so we can assert real redaction behaviour
      // (the app logger is "silent" in tests and emits nothing).
      const pino = (await import('pino')).default;
      const lines: string[] = [];
      const stream = { write: (s: string) => lines.push(s) };
      const captured = pino(
        {
          level: 'info',
          redact: {
            paths: ['password', 'token', 'req.headers.authorization', 'body.refreshToken'],
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
});

afterEach(() => {
  vi.restoreAllMocks();
});
