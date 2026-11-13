/**
 * @file api-rate-limit-wiring.test.ts
 * @description The budgets as `createApp()` mounts them (TASK-482): which of
 *   the three a real route is counted against, that a 429 leaves the server
 *   with `Retry-After` readable across origins, and that the parts of a
 *   dataset upload (TASK-480) are counted by none. `rateLimit.test.ts` covers
 *   the limiters themselves; this covers the wiring in `app.ts`.
 * @feature security
 */

// The budgets are read when `app.ts` is imported, so the environment has to be
// set in a hoisted block — the only thing that runs before the imports.
import { vi } from 'vitest';

vi.hoisted(() => {
  process.env.RATE_LIMIT_DISABLED = 'false';
  process.env.RATE_LIMIT_MAX = '6';
  process.env.RATE_LIMIT_MEDIA_MAX = '9';
  process.env.RATE_LIMIT_WRITE_MAX = '3';
  process.env.RATE_LIMIT_WINDOW_MS = '60000';
  delete process.env.TRUST_PROXY;
});

import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';

const DS = '9b7c63ca-fc76-4dd1-aed2-2dada9bdcb64';
const ORIGIN = 'http://localhost:1420';

// One app per client address, so each test starts on a full budget.
let client = 0;
function freshClient() {
  const app = createApp();
  const address = `203.0.113.${++client}`;
  return {
    get: (path: string) => request(app).get(path).set('X-Forwarded-For', address).set('Origin', ORIGIN),
    post: (path: string) => request(app).post(path).set('X-Forwarded-For', address).set('Origin', ORIGIN),
    put: (path: string) => request(app).put(path).set('X-Forwarded-For', address).set('Origin', ORIGIN),
  };
}

describe('the API budgets as the app mounts them', () => {
  it('counts an episode read against the browsing budget and anything else against the general one', async () => {
    const c = freshClient();
    const browse = await c.get(`/api/datasets/${DS}/episodes/0/frames`);
    expect(browse.headers['ratelimit-limit']).toBe('9');
    const general = await c.get('/api/config/features');
    expect(general.headers['ratelimit-limit']).toBe('6');
    expect(general.headers['ratelimit-remaining']).toBe('5');
  });

  it('refuses with 429, Retry-After and a CORS grant to read it', async () => {
    const c = freshClient();
    for (let i = 0; i < 6; i++) expect((await c.get('/api/config/features')).status).not.toBe(429);
    const refused = await c.get('/api/config/features');
    expect(refused.status).toBe(429);
    expect(refused.body).toMatchObject({ code: 'RATE_LIMITED' });
    expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
    expect(refused.headers['access-control-expose-headers']).toContain('Retry-After');
    expect(refused.headers['access-control-allow-origin']).toBe(ORIGIN);
    // Videos go on: browsing has its own budget.
    expect((await c.get(`/api/datasets/${DS}/episodes/0/frames`)).status).not.toBe(429);
  });

  it('holds writes to the write budget', async () => {
    const c = freshClient();
    for (let i = 0; i < 3; i++) expect((await c.post('/api/datasets/uploads')).status).not.toBe(429);
    const refused = await c.post('/api/datasets/uploads');
    expect(refused.status).toBe(429);
    expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('counts the parts of a dataset upload against nothing', async () => {
    const c = freshClient();
    for (let part = 1; part <= 12; part++) {
      const answer = await c.put(`/api/datasets/${DS}/upload/files/0/parts/${part}`);
      expect(answer.status).not.toBe(429);
      expect(answer.headers['ratelimit-remaining']).toBeUndefined();
    }
    // …and they took nothing from the budgets the rest of the app uses.
    expect((await c.get('/api/config/features')).headers['ratelimit-remaining']).toBe('5');
  });
});
