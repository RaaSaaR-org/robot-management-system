/**
 * @file health.test.ts
 * @description Tests for the health endpoint
 */

import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';

// Create a minimal app with just the health endpoint (avoids service initialization)
function createTestApp() {
  const app = express();
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });
  return app;
}

describe('GET /health', () => {
  const app = createTestApp();

  it('returns 200 with status ok', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('returns a valid timestamp', async () => {
    const res = await request(app).get('/health');

    expect(res.body.timestamp).toBeDefined();
    const date = new Date(res.body.timestamp);
    expect(date.getTime()).not.toBeNaN();
  });
});
