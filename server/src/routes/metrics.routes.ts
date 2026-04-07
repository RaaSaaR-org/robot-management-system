/**
 * @file metrics.routes.ts
 * @description Prometheus metrics endpoint
 * @feature core
 */

import { Router, type Request, type Response } from 'express';
import client from 'prom-client';

// Collect default Node.js metrics (event loop, GC, memory, etc.)
client.collectDefaultMetrics();

// ── Custom metrics ──────────────────────────────────────────────────────────

/**
 * HTTP request duration histogram (seconds).
 * Labelled by method, route, and status code.
 */
export const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});

/**
 * Active training jobs gauge.
 */
export const activeTrainingJobs = new client.Gauge({
  name: 'neodem_active_training_jobs',
  help: 'Number of currently active training jobs',
});

/**
 * Active simulation jobs gauge.
 */
export const activeSimulationJobs = new client.Gauge({
  name: 'neodem_active_simulation_jobs',
  help: 'Number of currently active simulation jobs',
});

/**
 * Database query counter.
 */
export const dbQueryCount = new client.Counter({
  name: 'neodem_db_query_total',
  help: 'Total number of database queries',
  labelNames: ['operation'] as const,
});

/**
 * Connected robots gauge.
 */
export const connectedRobots = new client.Gauge({
  name: 'neodem_connected_robots',
  help: 'Number of currently connected robots',
});

// ── Routes ──────────────────────────────────────────────────────────────────

export const metricsRoutes = Router();

metricsRoutes.get('/', async (_req: Request, res: Response) => {
  try {
    res.set('Content-Type', client.register.contentType);
    const metrics = await client.register.metrics();
    res.end(metrics);
  } catch (error) {
    res.status(500).json({ error: 'Failed to collect metrics' });
  }
});
