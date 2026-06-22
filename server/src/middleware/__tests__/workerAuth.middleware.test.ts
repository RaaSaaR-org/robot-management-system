/**
 * @file workerAuth.middleware.test.ts
 * @description Unit tests for workerAuthMiddleware (training worker bearer-token auth)
 * @feature vla
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

import { workerAuthMiddleware } from '../workerAuth.middleware.js';

/** Build a fake express response with chainable status/json. */
function makeRes(): Response & {
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
} {
  const res = {} as Response & {
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
  };
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

function makeReq(headers: Record<string, string> = {}, path = '/callback'): Request {
  return { headers, path } as unknown as Request;
}

describe('workerAuthMiddleware', () => {
  let originalEnv: NodeJS.ProcessEnv;
  let next: NextFunction & ReturnType<typeof vi.fn>;

  beforeEach(() => {
    originalEnv = { ...process.env };
    delete process.env.AUTH_DISABLED;
    delete process.env.WORKER_API_TOKEN;
    next = vi.fn() as unknown as NextFunction & ReturnType<typeof vi.fn>;
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  // --------------------------------------------------------------------------
  // AUTH_DISABLED bypass
  // --------------------------------------------------------------------------

  it('calls next() and skips all checks when AUTH_DISABLED=true', () => {
    process.env.AUTH_DISABLED = 'true';
    process.env.WORKER_API_TOKEN = 'secret';
    const req = makeReq(); // no auth header
    const res = makeRes();

    workerAuthMiddleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  it('does NOT bypass when AUTH_DISABLED is a non-"true" value', () => {
    process.env.AUTH_DISABLED = 'false';
    process.env.WORKER_API_TOKEN = 'secret';
    const req = makeReq(); // no auth header → should be rejected
    const res = makeRes();

    workerAuthMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  // --------------------------------------------------------------------------
  // No WORKER_API_TOKEN configured → passthrough
  // --------------------------------------------------------------------------

  it('calls next() when WORKER_API_TOKEN is not set (falls back to regular auth)', () => {
    // AUTH_DISABLED and WORKER_API_TOKEN both unset
    const req = makeReq();
    const res = makeRes();

    workerAuthMiddleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('treats an empty-string WORKER_API_TOKEN as not configured', () => {
    process.env.WORKER_API_TOKEN = '';
    const req = makeReq();
    const res = makeRes();

    workerAuthMiddleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // Missing / malformed Authorization header → 401
  // --------------------------------------------------------------------------

  it('responds 401 when Authorization header is missing', () => {
    process.env.WORKER_API_TOKEN = 'secret';
    const req = makeReq();
    const res = makeRes();

    workerAuthMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Unauthorized',
      message: 'Worker token required',
    });
  });

  it('responds 401 when Authorization header does not start with "Bearer "', () => {
    process.env.WORKER_API_TOKEN = 'secret';
    const req = makeReq({ authorization: 'Basic secret' });
    const res = makeRes();

    workerAuthMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Unauthorized',
      message: 'Worker token required',
    });
  });

  // --------------------------------------------------------------------------
  // Invalid token → 403
  // --------------------------------------------------------------------------

  it('responds 403 when the bearer token does not match', () => {
    process.env.WORKER_API_TOKEN = 'secret';
    const req = makeReq({ authorization: 'Bearer wrong-token' });
    const res = makeRes();

    workerAuthMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Forbidden',
      message: 'Invalid worker token',
    });
  });

  it('responds 403 when "Bearer " prefix present but token is empty', () => {
    process.env.WORKER_API_TOKEN = 'secret';
    const req = makeReq({ authorization: 'Bearer ' });
    const res = makeRes();

    workerAuthMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  // --------------------------------------------------------------------------
  // Valid token → next()
  // --------------------------------------------------------------------------

  it('calls next() when the bearer token matches WORKER_API_TOKEN', () => {
    process.env.WORKER_API_TOKEN = 'secret';
    const req = makeReq({ authorization: 'Bearer secret' });
    const res = makeRes();

    workerAuthMiddleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  it('matches tokens that themselves contain spaces (only first 7 chars stripped)', () => {
    process.env.WORKER_API_TOKEN = 'tok with space';
    const req = makeReq({ authorization: 'Bearer tok with space' });
    const res = makeRes();

    workerAuthMiddleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});
