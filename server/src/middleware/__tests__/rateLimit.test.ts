/**
 * @file rateLimit.test.ts
 * @description The API budgets (TASK-482): browsing episodes is counted apart
 *   from the rest of the API, every 429 says when to come back, the budgets
 *   come from the environment, and the client address is the one the trusted
 *   proxies reported — never one the client wrote into a header.
 * @feature security
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import {
  RATE_LIMIT_DEFAULTS,
  apiRateLimit,
  isDatasetBrowseRequest,
  parseTrustProxy,
  readRateLimitConfig,
  type RateLimitConfig,
  type TrustProxySetting,
} from '../rateLimit.js';

const DS = '9b7c63ca-fc76-4dd1-aed2-2dada9bdcb64';

function appWith(overrides: Partial<RateLimitConfig> = {}, trustProxy: TrustProxySetting = 1) {
  const config: RateLimitConfig = {
    disabled: false,
    windowMs: 60_000,
    max: 5,
    mediaMax: 8,
    writeMax: 3,
    ...overrides,
  };
  const app = express();
  app.set('trust proxy', trustProxy);
  app.use('/api/', ...apiRateLimit(config));
  app.all(/.*/, (req, res) => {
    res.json({ ip: req.ip });
  });
  return app;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('isDatasetBrowseRequest', () => {
  it.each([
    ['GET', `/api/datasets/${DS}/episodes`],
    ['GET', `/api/datasets/${DS}/episodes/12/frames`],
    ['GET', `/api/datasets/${DS}/episodes/12/video/observation.images.ego_view`],
    ['HEAD', `/api/datasets/${DS}/episodes/12/video/observation.images.ego_view`],
    ['GET', `/api/datasets/${DS}/stats`],
    ['GET', `/api/datasets/${DS}/modality`],
    ['POST', `/api/datasets/${DS}/video-ticket`],
  ])('%s %s is dataset browsing', (method, path) => {
    expect(isDatasetBrowseRequest(method, path)).toBe(true);
  });

  it.each([
    ['GET', '/api/datasets'],
    ['GET', `/api/datasets/${DS}`],
    ['GET', '/api/datasets/hf/preview'],
    ['PATCH', `/api/datasets/${DS}/episodes/12/flag`],
    ['POST', `/api/datasets/${DS}/compute-stats`],
    ['POST', '/api/datasets/import/huggingface'],
    ['DELETE', `/api/datasets/${DS}`],
    ['GET', '/api/auth/me'],
    ['GET', `/api/social/episode/${DS}:3/comments`],
  ])('%s %s is not', (method, path) => {
    expect(isDatasetBrowseRequest(method, path)).toBe(false);
  });
});

describe('the API budgets', () => {
  it('lets a viewer step through episodes long after the general budget would be spent', async () => {
    const app = appWith({ max: 5, mediaMax: 200 });
    // 30 episodes, the requests one click makes against the dataset routes.
    for (let episode = 0; episode < 30; episode++) {
      await request(app).get(`/api/datasets/${DS}/episodes/${episode}/frames`).expect(200);
      for (let range = 0; range < 4; range++) {
        await request(app)
          .get(`/api/datasets/${DS}/episodes/${episode}/video/cam?ticket=t`)
          .set('Range', 'bytes=0-')
          .expect(200);
      }
    }
    // ...and none of it was taken from the general budget.
    for (let i = 0; i < 5; i++) await request(app).get('/api/auth/me').expect(200);
    await request(app).get('/api/auth/me').expect(429);
  });

  it('keeps videos playing when the general budget is spent', async () => {
    const app = appWith({ max: 2 });
    await request(app).get('/api/robots').expect(200);
    await request(app).get('/api/robots').expect(200);
    await request(app).get('/api/robots').expect(429);
    await request(app).get(`/api/datasets/${DS}/episodes/0/video/cam`).expect(200);
    await request(app).post(`/api/datasets/${DS}/video-ticket`).expect(200);
  });

  it('still bounds dataset browsing', async () => {
    const app = appWith({ mediaMax: 3 });
    for (let i = 0; i < 3; i++) await request(app).get(`/api/datasets/${DS}/episodes/0/frames`).expect(200);
    const refused = await request(app).get(`/api/datasets/${DS}/episodes/0/frames`).expect(429);
    expect(refused.body).toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('holds writes to their own smaller budget', async () => {
    const app = appWith({ max: 100, writeMax: 3 });
    for (let i = 0; i < 3; i++) await request(app).post('/api/datasets/import/huggingface').expect(200);
    await request(app).delete(`/api/datasets/${DS}`).expect(429);
    // Reading goes on.
    await request(app).get('/api/datasets').expect(200);
  });

  it.each([
    ['a general request', 'get', '/api/robots', { max: 1 }],
    ['a dataset read', 'get', `/api/datasets/${DS}/episodes/0/frames`, { mediaMax: 1 }],
    ['a write', 'post', '/api/robots', { max: 100, writeMax: 1 }],
  ] as const)('answers 429 with Retry-After for %s', async (_name, method, path, budget) => {
    const app = appWith({ ...budget, windowMs: 30_000 });
    await request(app)[method](path).expect(200);
    const refused = await request(app)[method](path).expect(429);
    const retryAfter = Number(refused.headers['retry-after']);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(30);
  });

  it('counts nothing when disabled', async () => {
    const app = appWith({ disabled: true, max: 1, mediaMax: 1, writeMax: 1 });
    for (let i = 0; i < 5; i++) {
      await request(app).get('/api/robots').expect(200);
      await request(app).post('/api/robots').expect(200);
      await request(app).get(`/api/datasets/${DS}/stats`).expect(200);
    }
  });
});

describe('readRateLimitConfig', () => {
  it('is sized for an interactive app in production', () => {
    expect(readRateLimitConfig({ NODE_ENV: 'production' })).toEqual({
      disabled: false,
      windowMs: 60_000,
      max: RATE_LIMIT_DEFAULTS.max,
      mediaMax: RATE_LIMIT_DEFAULTS.mediaMax,
      writeMax: RATE_LIMIT_DEFAULTS.writeMax,
    });
    // 30 episodes a minute at ~8 requests a click must fit several times over.
    expect(RATE_LIMIT_DEFAULTS.max).toBeGreaterThanOrEqual(30 * 8 * 4);
    expect(RATE_LIMIT_DEFAULTS.mediaMax).toBeGreaterThanOrEqual(30 * 8 * 4);
  });

  it('takes max and window from the environment', () => {
    const config = readRateLimitConfig({
      NODE_ENV: 'production',
      RATE_LIMIT_MAX: '250',
      RATE_LIMIT_WINDOW_MS: '10000',
      RATE_LIMIT_MEDIA_MAX: '900',
      RATE_LIMIT_WRITE_MAX: '40',
    });
    expect(config).toMatchObject({ max: 250, windowMs: 10_000, mediaMax: 900, writeMax: 40 });
  });

  it('falls back to the default on a value it cannot use, and says so', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const config = readRateLimitConfig({ NODE_ENV: 'production', RATE_LIMIT_MAX: 'lots', RATE_LIMIT_WINDOW_MS: '-5' });
    expect(config.max).toBe(RATE_LIMIT_DEFAULTS.max);
    expect(config.windowMs).toBe(RATE_LIMIT_DEFAULTS.windowMs);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('honours RATE_LIMIT_DISABLED', () => {
    expect(readRateLimitConfig({ RATE_LIMIT_DISABLED: 'true' }).disabled).toBe(true);
    expect(readRateLimitConfig({ RATE_LIMIT_DISABLED: 'false' }).disabled).toBe(false);
  });
});

describe('parseTrustProxy', () => {
  it('trusts one proxy unless told otherwise', () => {
    expect(parseTrustProxy(undefined)).toBe(1);
    expect(parseTrustProxy('  ')).toBe(1);
  });

  it('reads a hop count, an address list, and "no proxy"', () => {
    expect(parseTrustProxy('2')).toBe(2);
    expect(parseTrustProxy('loopback, 10.0.0.0/8')).toEqual(['loopback', '10.0.0.0/8']);
    expect(parseTrustProxy('false')).toBe(false);
    expect(parseTrustProxy('0')).toBe(false);
  });

  it('refuses to believe the whole header', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(parseTrustProxy('true')).toBe(1);
    expect(warn).toHaveBeenCalledOnce();
  });
});

describe('the client a request is counted against', () => {
  // What the server sees behind Cloudflare and one ingress: each proxy appends
  // the address it received the request from.
  const viaCloudflare = (client: string) => `${client}, 172.70.1.1`;

  it('with one trusted hop, everyone behind the same Cloudflare edge shares a bucket', async () => {
    const app = appWith({ max: 2 }, 1);
    await request(app).get('/api/robots').set('X-Forwarded-For', viaCloudflare('203.0.113.5')).expect(200);
    await request(app).get('/api/robots').set('X-Forwarded-For', viaCloudflare('198.51.100.9')).expect(200);
    await request(app).get('/api/robots').set('X-Forwarded-For', viaCloudflare('192.0.2.77')).expect(429);
  });

  it('with two trusted hops, each client has its own', async () => {
    const app = appWith({ max: 2 }, 2);
    for (const client of ['203.0.113.5', '198.51.100.9', '192.0.2.77']) {
      const ok = await request(app).get('/api/robots').set('X-Forwarded-For', viaCloudflare(client)).expect(200);
      expect(ok.body.ip).toBe(client);
      await request(app).get('/api/robots').set('X-Forwarded-For', viaCloudflare(client)).expect(200);
      await request(app).get('/api/robots').set('X-Forwarded-For', viaCloudflare(client)).expect(429);
    }
  });

  it('a client cannot buy a fresh bucket by writing its own X-Forwarded-For', async () => {
    const app = appWith({ max: 2 }, 2);
    // Cloudflare appends the real client after whatever the client sent.
    const spoofed = (fake: string) => `${fake}, 203.0.113.5, 172.70.1.1`;
    await request(app).get('/api/robots').set('X-Forwarded-For', spoofed('1.1.1.1')).expect(200);
    await request(app).get('/api/robots').set('X-Forwarded-For', spoofed('2.2.2.2')).expect(200);
    const refused = await request(app).get('/api/robots').set('X-Forwarded-For', spoofed('3.3.3.3')).expect(429);
    expect(refused.headers['retry-after']).toBeDefined();
  });

  it('ignores CF-Connecting-IP and X-Real-IP, which anyone can send', async () => {
    const app = appWith({ max: 1 }, 2);
    const xff = viaCloudflare('203.0.113.5');
    await request(app).get('/api/robots').set('X-Forwarded-For', xff).set('CF-Connecting-IP', '9.9.9.9').expect(200);
    await request(app)
      .get('/api/robots')
      .set('X-Forwarded-For', xff)
      .set('CF-Connecting-IP', '8.8.8.8')
      .set('X-Real-IP', '7.7.7.7')
      .expect(429);
  });
});
