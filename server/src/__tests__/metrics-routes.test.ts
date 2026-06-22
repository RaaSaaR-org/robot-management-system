/**
 * @file metrics-routes.test.ts
 * @description Integration tests for the Prometheus metrics route
 * @feature core
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ── Mocks ─────────────────────────────────────────────────────────────────────
// The metrics router imports `prom-client` and constructs metric instances + calls
// collectDefaultMetrics() at module load. Mock the whole module so no real metric
// collection (timers/process sampling) runs and so we control register.metrics().

const { mockRegister, mockCollectDefaultMetrics, MockHistogram, MockGauge, MockCounter } =
  vi.hoisted(() => {
    const mockRegister = {
      contentType: 'text/plain; version=0.0.4; charset=utf-8',
      metrics: vi.fn(),
    };
    return {
      mockRegister,
      mockCollectDefaultMetrics: vi.fn(),
      MockHistogram: vi.fn(function (this: any) {
        this.observe = vi.fn();
      }),
      MockGauge: vi.fn(function (this: any) {
        this.set = vi.fn();
        this.inc = vi.fn();
        this.dec = vi.fn();
      }),
      MockCounter: vi.fn(function (this: any) {
        this.inc = vi.fn();
      }),
    };
  });

vi.mock('prom-client', () => {
  const client = {
    collectDefaultMetrics: mockCollectDefaultMetrics,
    Histogram: MockHistogram,
    Gauge: MockGauge,
    Counter: MockCounter,
    register: mockRegister,
  };
  return { default: client, ...client };
});

// Mirror the canonical template: mock the auth middleware to a pass-through that
// injects a fake user. The metrics route is mounted without auth in app.ts, but we
// keep the mock to follow the established pattern and avoid any real auth import I/O.
vi.mock('../middleware/auth.middleware.js', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: 'user-123', email: 'test@example.com', name: 'Test', role: 'admin' };
    next();
  },
  AuthenticatedRequest: {},
}));

import { metricsRoutes } from '../routes/metrics.routes.js';

function createApp() {
  const app = express();
  app.use(express.json());
  // Mounted exactly as in app.ts: no auth middleware on /metrics.
  app.use('/metrics', metricsRoutes);
  return app;
}

const SAMPLE_METRICS = `# HELP neodem_connected_robots Number of currently connected robots
# TYPE neodem_connected_robots gauge
neodem_connected_robots 3
`;

describe('Metrics Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  // --------------------------------------------------------------------------
  // GET /metrics
  // --------------------------------------------------------------------------

  describe('GET /metrics', () => {
    it('returns the Prometheus metrics payload with the registry content type', async () => {
      mockRegister.metrics.mockResolvedValue(SAMPLE_METRICS);

      const response = await request(app).get('/metrics');

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('text/plain');
      expect(response.text).toContain('neodem_connected_robots 3');
      expect(mockRegister.metrics).toHaveBeenCalledTimes(1);
    });

    it('returns 500 when the registry fails to collect metrics', async () => {
      mockRegister.metrics.mockRejectedValue(new Error('collection failed'));

      const response = await request(app).get('/metrics');

      expect(response.status).toBe(500);
      // The route sets the Prometheus text/plain content type only AFTER metrics()
      // resolves, so the error path returns a proper JSON body that clients can parse.
      expect(response.headers['content-type']).toContain('application/json');
      expect(response.body.error).toBe('Failed to collect metrics');
    });
  });
});
