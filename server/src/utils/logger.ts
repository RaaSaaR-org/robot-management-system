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
/**
 * Property paths pino censors before anything is written.
 *
 * Exported so the redaction tests can assert against the list the server
 * actually runs with — a test that retypes these paths tests its own copy.
 */
export const REDACT_PATHS = [
      'password',
      'newPassword',
      'currentPassword',
      'tempPassword',
      'token',
      'authorization',
      'jwt',
      'req.headers.authorization',
      'req.headers.cookie',
      'body.password',
      'body.newPassword',
      'body.currentPassword',
      'body.tempPassword',
      'body.token',
      'body.refreshToken',
      'body.plaintext',
      'plaintext',
      // The camera stream ticket rides in the query string, because an `<img>`
      // cannot send a header (TASK-214). It is short-lived and narrowly scoped,
      // but it is still a replayable credential, and "a credential in a URL ends
      // up in the logs" is the exact failure the ticket was introduced to shrink
      // — so it must not end up in ours. This censors the parsed copy; the
      // serializer below censors the one inside `req.url`.
      'req.query.ticket',
] as const;

/**
 * Strip a camera stream ticket out of a request URL.
 *
 * `redact` matches property paths, so it can censor the parsed `req.query.ticket`
 * but cannot reach inside the URL string pino also logs. This handles that copy.
 *
 * Global and case-insensitive on purpose: a duplicated `?ticket=a&ticket=b`
 * fails verification (express parses it to an array, which is not a string) but
 * both halves would still be credentials sitting in a log line.
 */
export function scrubCameraTicket(url: string): string {
  return url.replace(/([?&]ticket=)[^&]*/gi, '$1[REDACTED]');
}

export const logger = pino({
  level: isTest ? 'silent' : isDev ? 'debug' : 'info',
  redact: {
    paths: [...REDACT_PATHS],
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
  (req as unknown as Record<string, unknown>).id = id;
  res.setHeader('x-request-id', id);
  next();
}

/**
 * pino-http middleware for automatic request/response logging.
 *
 * Uses the request-id set by `requestIdMiddleware`.
 */
/**
 * The stock pino request serializer, minus the camera ticket.
 *
 * `pino.stdSerializers.req` copies `req.originalUrl` into `url`, and that is
 * where a camera stream ticket rides — an `<img>` cannot send an Authorization
 * header, so the credential has to be in the URL (TASK-214). It is short-lived
 * and scoped to one camera, but it is replayable, and "a credential in a URL
 * ends up in the logs" is the exact failure the ticket was introduced to shrink.
 *
 * Exported so a test can run the serializer this server actually installs.
 */
export function ticketSafeReqSerializer(
  req: Parameters<typeof pino.stdSerializers.req>[0],
): ReturnType<typeof pino.stdSerializers.req> {
  const serialized = pino.stdSerializers.req(req);
  if (typeof serialized.url === 'string') {
    serialized.url = scrubCameraTicket(serialized.url);
  }
  return serialized;
}

export const httpLogger = pinoHttp({
  logger,
  genReqId: (req) => (req as unknown as Record<string, unknown>).id as string || randomUUID(),
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
    req: ticketSafeReqSerializer,
    res: pino.stdSerializers.res,
  },
});
