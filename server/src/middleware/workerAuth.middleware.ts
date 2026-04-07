/**
 * @file workerAuth.middleware.ts
 * @description Authentication middleware for training worker callback endpoints
 * @feature vla
 */

import type { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger.js';

/**
 * Authenticates training worker requests via a shared bearer token.
 *
 * Workers must send `Authorization: Bearer <WORKER_API_TOKEN>`.
 * When `AUTH_DISABLED=true` (dev mode), all requests are allowed.
 * When `WORKER_API_TOKEN` is not set, falls back to the regular
 * authMiddleware behaviour (already applied at the router level).
 */
export function workerAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Dev mode — skip
  if (process.env.AUTH_DISABLED === 'true') {
    return next();
  }

  const expectedToken = process.env.WORKER_API_TOKEN;

  // If no worker token configured, rely on regular authMiddleware
  if (!expectedToken) {
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    logger.warn({ path: req.path }, 'Worker request missing authorization header');
    res.status(401).json({ error: 'Unauthorized', message: 'Worker token required' });
    return;
  }

  const token = authHeader.slice(7);
  if (token !== expectedToken) {
    logger.warn({ path: req.path }, 'Worker request with invalid token');
    res.status(403).json({ error: 'Forbidden', message: 'Invalid worker token' });
    return;
  }

  next();
}
