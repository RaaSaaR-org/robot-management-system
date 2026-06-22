/**
 * @file metricsMiddleware.test.ts
 * @description Unit tests for the Prometheus HTTP-duration recording middleware.
 * @feature core
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { Request, Response, NextFunction } from 'express';

// ── Mock the prom-client histogram boundary ──────────────────────────────────
// `metrics.routes.js` constructs a real prom-client Histogram AND calls
// collectDefaultMetrics() at import time (global side effects / interval-like
// behavior). We mock it so the middleware's pure logic runs against a
// controllable timer whose label payload we can assert.
const { endSpy, startTimerSpy } = vi.hoisted(() => {
  const endSpy = vi.fn();
  const startTimerSpy = vi.fn(() => endSpy);
  return { endSpy, startTimerSpy };
});

vi.mock('../../routes/metrics.routes.js', () => ({
  httpRequestDuration: {
    startTimer: startTimerSpy,
  },
}));

import { metricsMiddleware } from '../metricsMiddleware.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** A fake Response that is also a real EventEmitter so `res.on('finish')` works. */
function makeRes(statusCode = 200): Response {
  const res = new EventEmitter() as unknown as Response;
  res.statusCode = statusCode;
  return res;
}

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    method: 'GET',
    path: '/api/robots/abc',
    baseUrl: '',
    ...overrides,
  } as unknown as Request;
}

describe('metricsMiddleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('starts the histogram timer and calls next() synchronously', () => {
    const req = makeReq();
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;

    metricsMiddleware(req, res, next);

    expect(startTimerSpy).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledTimes(1);
    // Timer has not ended yet — response not finished.
    expect(endSpy).not.toHaveBeenCalled();
  });

  it('records labels on response finish using the matched route pattern', () => {
    const req = makeReq({
      method: 'POST',
      baseUrl: '/api/robots',
      route: { path: '/:id' } as Request['route'],
      path: '/api/robots/abc',
    });
    const res = makeRes(201);
    const next = vi.fn() as unknown as NextFunction;

    metricsMiddleware(req, res, next);
    (res as unknown as EventEmitter).emit('finish');

    expect(endSpy).toHaveBeenCalledTimes(1);
    expect(endSpy).toHaveBeenCalledWith({
      method: 'POST',
      route: '/api/robots/:id',
      status_code: '201',
    });
  });

  it('falls back to req.path when no matched route is present', () => {
    const req = makeReq({
      method: 'GET',
      baseUrl: '/ignored',
      route: undefined,
      path: '/unmatched/path',
    });
    const res = makeRes(404);
    const next = vi.fn() as unknown as NextFunction;

    metricsMiddleware(req, res, next);
    (res as unknown as EventEmitter).emit('finish');

    expect(endSpy).toHaveBeenCalledWith({
      method: 'GET',
      route: '/unmatched/path',
      status_code: '404',
    });
  });

  it('uses an empty baseUrl with the route path when baseUrl is empty string', () => {
    const req = makeReq({
      method: 'DELETE',
      baseUrl: '',
      route: { path: '/health' } as Request['route'],
      path: '/health',
    });
    const res = makeRes(204);
    const next = vi.fn() as unknown as NextFunction;

    metricsMiddleware(req, res, next);
    (res as unknown as EventEmitter).emit('finish');

    expect(endSpy).toHaveBeenCalledWith({
      method: 'DELETE',
      route: '/health',
      status_code: '204',
    });
  });

  it('stringifies the status code via res.statusCode at finish time', () => {
    const req = makeReq({ route: undefined, path: '/x' });
    const res = makeRes(200);
    const next = vi.fn() as unknown as NextFunction;

    metricsMiddleware(req, res, next);
    // Mutate status after the middleware ran but before finish — the value
    // captured must reflect the final statusCode.
    res.statusCode = 503;
    (res as unknown as EventEmitter).emit('finish');

    expect(endSpy).toHaveBeenCalledWith(
      expect.objectContaining({ status_code: '503' }),
    );
  });

  it('does not end the timer if the response never finishes', () => {
    const req = makeReq();
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;

    metricsMiddleware(req, res, next);

    expect(endSpy).not.toHaveBeenCalled();
  });
});
