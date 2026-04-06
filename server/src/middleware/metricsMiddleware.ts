/**
 * @file metricsMiddleware.ts
 * @description Express middleware to record HTTP request duration for Prometheus
 * @feature core
 */

import type { Request, Response, NextFunction } from 'express';
import { httpRequestDuration } from '../routes/metrics.routes.js';

/**
 * Records request duration in the Prometheus histogram.
 *
 * Uses `res.on('finish', ...)` so we capture the actual response time
 * without interfering with the request pipeline.
 */
export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const end = httpRequestDuration.startTimer();

  res.on('finish', () => {
    // Use the matched Express route pattern (e.g. /api/robots/:id) to avoid
    // high-cardinality labels from path parameters.
    const route = req.route?.path
      ? `${req.baseUrl}${req.route.path}`
      : req.path;

    end({
      method: req.method,
      route,
      status_code: res.statusCode.toString(),
    });
  });

  next();
}
