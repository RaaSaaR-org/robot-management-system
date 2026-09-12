/**
 * @file routeErrors.ts
 * @description Shared last-resort failure responder for route handlers (TASK-298)
 * @feature core
 */

import type { Response } from 'express';
import { isOperationalError, prismaErrorToAppError } from './errors.js';
import { logger } from './logger.js';

/**
 * Answer a caught error without echoing it.
 *
 * Route handlers used to put `error instanceof Error ? error.message : ...`
 * straight into the response body. A `PrismaClientKnownRequestError` is an
 * `Error`, and it stringifies to the query that failed plus the absolute path
 * of the file that ran it — a database dump in the browser. The three steps,
 * in order:
 *
 * 1. A Prisma failure is mapped to a curated sentence and status.
 * 2. An `AppError` a service threw deliberately already carries a curated
 *    message and status, so those are used as-is.
 * 3. Anything else — a driver fault, a library bug, a plain `Error` — is
 *    logged in full and answered with the caller's `fallbackMessage`. The
 *    caught text never reaches the response. This step closes the leak.
 *
 * @param res - The express response to write to
 * @param error - The caught error, of unknown type
 * @param fallbackMessage - Operator-facing sentence for the unmapped case
 * @param fallbackStatus - Status for the unmapped case (default 500)
 * @param extra - Extra body fields this route's clients already rely on
 */
export function sendFailure(
  res: Response,
  error: unknown,
  fallbackMessage: string,
  fallbackStatus = 500,
  extra?: Record<string, unknown>
): void {
  const prismaError = prismaErrorToAppError(error);
  if (prismaError) {
    res.status(prismaError.statusCode).json({ ...extra, error: prismaError.message });
    return;
  }

  if (isOperationalError(error)) {
    res.status(error.statusCode).json({ ...extra, error: error.message });
    return;
  }

  logger.error({ err: error }, fallbackMessage);
  res.status(fallbackStatus).json({ ...extra, error: fallbackMessage });
}
