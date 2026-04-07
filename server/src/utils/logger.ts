/**
 * @file logger.ts
 * @description Structured logging with pino + request-id middleware
 * @feature core
 */

import pino from 'pino';
import pinoHttp from 'pino-http';
import { randomUUID } from 'crypto';
import type { Request, Response, NextFunction } from 'express';

const isDev = process.env.NODE_ENV !== 'production';
const isTest = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';

/**
 * Build pino transport config.
 * - test  → no transport (silent JSON, avoids pino-pretty worker issues)
 * - dev   → pino-pretty for human-readable output
 * - prod  → plain JSON lines
 */
function getTransport(): pino.TransportSingleOptions | undefined {
  if (isTest || !isDev) return undefined;
  return { target: 'pino-pretty', options: { colorize: true, ignore: 'pid,hostname' } };
}

/**
 * Application-wide pino logger.
 *
 * - dev  → level "debug", pretty-printed via pino-pretty
 * - test → level "silent" (no noise in test output)
 * - prod → level "info", JSON lines
 *
 * Sensitive fields are automatically redacted in log output.
 */
export const logger = pino({
  level: isTest ? 'silent' : isDev ? 'debug' : 'info',
  redact: {
    paths: [
      'password',
      'token',
      'authorization',
      'jwt',
      'req.headers.authorization',
      'req.headers.cookie',
      'body.password',
      'body.token',
      'body.refreshToken',
    ],
    censor: '[REDACTED]',
  },
  transport: getTransport(),
});

/**
 * Express middleware that attaches a unique request ID to every request.
 *
 * - Reads an incoming `x-request-id` header (e.g. from a reverse proxy)
 * - Falls back to a new UUIDv4
 * - Sets the `x-request-id` response header for correlation
 * - Stores the id on `req.id` for downstream use
 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const id = (req.headers['x-request-id'] as string) || randomUUID();
  (req as Record<string, unknown>).id = id;
  res.setHeader('x-request-id', id);
  next();
}

/**
 * pino-http middleware for automatic request/response logging.
 *
 * Uses the request-id set by `requestIdMiddleware`.
 */
export const httpLogger = pinoHttp({
  logger,
  genReqId: (req) => (req as Record<string, unknown>).id as string || randomUUID(),
  autoLogging: {
    // Skip noisy health-check logs
    ignore: (req) => req.url === '/health' || req.url === '/metrics',
  },
  customLogLevel: (_req, res, err) => {
    if (res.statusCode >= 500 || err) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  serializers: {
    req: pino.stdSerializers.req,
    res: pino.stdSerializers.res,
  },
});
