/**
 * @file client.rateLimit.test.ts
 * @description A 429 is backed off and retried, never a logout; concurrent 401s
 *   share one refresh; a refresh that is rate limited keeps the tokens (TASK-362).
 * @feature api
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/mocks/server';
import { createApiClient, rateLimitDelayMs, tokenStorage } from '../client';

const BASE = 'http://api.test/api';
const client = createApiClient({ baseURL: BASE, timeout: 5000, maxRetries: 3, retryDelay: 1 });

beforeEach(() => {
  localStorage.clear();
});

describe('429 handling', () => {
  it('retries a rate-limited request and resolves once the server lets it through', async () => {
    let calls = 0;
    server.use(
      http.get(`${BASE}/robots`, () => {
        calls++;
        return calls < 3
          ? HttpResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': '0' } })
          : HttpResponse.json({ robots: [] });
      })
    );

    const res = await client.get('/robots');
    expect(res.data).toEqual({ robots: [] });
    expect(calls).toBe(3);
  });

  it('gives up after maxRetries and leaves the tokens alone', async () => {
    tokenStorage.setTokens('access', 'refresh');
    let calls = 0;
    server.use(
      http.get(`${BASE}/robots`, () => {
        calls++;
        return HttpResponse.json({ error: 'Too many requests' }, { status: 429 });
      })
    );

    await expect(client.get('/robots')).rejects.toMatchObject({ statusCode: 429 });
    expect(calls).toBe(4);
    expect(tokenStorage.getAccessToken()).toBe('access');
    expect(tokenStorage.getRefreshToken()).toBe('refresh');
  });
});

describe('token refresh', () => {
  it('shares one refresh between concurrent 401s', async () => {
    tokenStorage.setTokens('stale', 'r1');
    let refreshes = 0;
    server.use(
      http.post(`${BASE}/auth/refresh`, async () => {
        refreshes++;
        return HttpResponse.json({ accessToken: 'fresh', refreshToken: 'r2' });
      }),
      http.get(`${BASE}/things/:id`, ({ request }) =>
        request.headers.get('Authorization') === 'Bearer fresh'
          ? HttpResponse.json({ ok: true })
          : HttpResponse.json({ error: 'expired' }, { status: 401 })
      )
    );

    const results = await Promise.all([client.get('/things/a'), client.get('/things/b'), client.get('/things/c')]);
    expect(results.map((r) => r.data)).toEqual([{ ok: true }, { ok: true }, { ok: true }]);
    expect(refreshes).toBe(1);
    expect(tokenStorage.getRefreshToken()).toBe('r2');
  });

  it('keeps the tokens when the refresh itself is rate limited', async () => {
    tokenStorage.setTokens('stale', 'r1');
    server.use(
      http.post(`${BASE}/auth/refresh`, () => HttpResponse.json({ error: 'slow down' }, { status: 429 })),
      http.get(`${BASE}/me`, () => HttpResponse.json({ error: 'expired' }, { status: 401 }))
    );

    await expect(client.get('/me')).rejects.toMatchObject({ statusCode: 401 });
    expect(tokenStorage.getRefreshToken()).toBe('r1');
  });

  it('drops the tokens when the server rejects the refresh token', async () => {
    tokenStorage.setTokens('stale', 'r1');
    server.use(
      http.post(`${BASE}/auth/refresh`, () => HttpResponse.json({ error: 'invalid' }, { status: 401 })),
      http.get(`${BASE}/me`, () => HttpResponse.json({ error: 'expired' }, { status: 401 }))
    );

    await expect(client.get('/me')).rejects.toMatchObject({ statusCode: 401 });
    expect(tokenStorage.getRefreshToken()).toBeNull();
  });
});

describe('rateLimitDelayMs', () => {
  it('honours Retry-After seconds, capped', () => {
    expect(rateLimitDelayMs('2', 0, 1000)).toBe(2000);
    expect(rateLimitDelayMs('600', 0, 1000)).toBe(10_000);
  });

  it('falls back to exponential back-off', () => {
    expect(rateLimitDelayMs(undefined, 0, 500)).toBe(500);
    expect(rateLimitDelayMs(undefined, 2, 500)).toBe(2000);
    expect(rateLimitDelayMs('garbage', 1, 500)).toBe(1000);
  });
});
