/**
 * @file rateLimitStatus.test.ts
 * @description The "retrying" hint is quiet for a short 429 wait and shown for
 *              a long one; reads wait out the server's window, writes do not
 *              (TASK-482).
 * @feature api
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/mocks/server';
import { createApiClient, isIdempotentRead, rateLimitWaitMs } from '../client';
import {
  RATE_LIMIT_HINT_DELAY_MS,
  beginRateLimitWait,
  isRateLimitHintVisible,
  resetRateLimitStatus,
  subscribeRateLimitHint,
} from '../rateLimitStatus';

beforeEach(() => {
  resetRateLimitStatus();
});

afterEach(() => {
  vi.useRealTimers();
  resetRateLimitStatus();
});

describe('the rate-limit hint', () => {
  it('says nothing about a wait that ends within a moment', () => {
    vi.useFakeTimers();
    const seen: boolean[] = [];
    const unsubscribe = subscribeRateLimitHint(() => seen.push(isRateLimitHintVisible()));

    const end = beginRateLimitWait();
    vi.advanceTimersByTime(RATE_LIMIT_HINT_DELAY_MS - 1);
    end();
    vi.advanceTimersByTime(10_000);

    expect(seen).toEqual([]);
    expect(isRateLimitHintVisible()).toBe(false);
    unsubscribe();
  });

  it('appears once a wait has lasted more than a moment, and leaves when it ends', () => {
    vi.useFakeTimers();
    const end = beginRateLimitWait();
    expect(isRateLimitHintVisible()).toBe(false);

    vi.advanceTimersByTime(RATE_LIMIT_HINT_DELAY_MS);
    expect(isRateLimitHintVisible()).toBe(true);

    end();
    expect(isRateLimitHintVisible()).toBe(false);
  });

  it('stays while any request is still waiting', () => {
    vi.useFakeTimers();
    const first = beginRateLimitWait();
    const second = beginRateLimitWait();
    vi.advanceTimersByTime(RATE_LIMIT_HINT_DELAY_MS);

    first();
    first(); // ending twice counts once
    expect(isRateLimitHintVisible()).toBe(true);

    second();
    expect(isRateLimitHintVisible()).toBe(false);
  });

  it('counts back-to-back waits of one request as one wait', () => {
    vi.useFakeTimers();
    // Two short waits with a retry in between must not add up to a hint each.
    const first = beginRateLimitWait();
    vi.advanceTimersByTime(1000);
    first();
    const second = beginRateLimitWait();
    vi.advanceTimersByTime(1000);
    second();
    expect(isRateLimitHintVisible()).toBe(false);
  });
});

describe('how long a 429 is waited out', () => {
  it('a read waits as long as the server asks, up to a full window', () => {
    expect(rateLimitWaitMs('get', '42', 0, 1000)).toBe(42_000);
    expect(rateLimitWaitMs('GET', '60', 0, 1000)).toBe(60_000);
    expect(rateLimitWaitMs(undefined, '60', 0, 1000)).toBe(60_000);
    expect(rateLimitWaitMs('get', '3600', 0, 1000)).toBe(65_000);
  });

  it('a write is not held for more than ten seconds', () => {
    expect(rateLimitWaitMs('post', '42', 0, 1000)).toBe(10_000);
    expect(rateLimitWaitMs('delete', '3', 0, 1000)).toBe(3000);
  });

  it('knows a read from a write', () => {
    expect(isIdempotentRead('get')).toBe(true);
    expect(isIdempotentRead('HEAD')).toBe(true);
    expect(isIdempotentRead(undefined)).toBe(true);
    expect(isIdempotentRead('post')).toBe(false);
    expect(isIdempotentRead('PATCH')).toBe(false);
  });
});

describe('the API client', () => {
  const BASE = 'http://api.test/api';
  const client = createApiClient({ baseURL: BASE, timeout: 10_000, maxRetries: 3, retryDelay: 1 });

  it('shows the hint while a throttled read waits, and recovers by itself', async () => {
    let calls = 0;
    server.use(
      http.get(`${BASE}/datasets/ds/episodes/3/frames`, () => {
        calls++;
        return calls === 1
          ? HttpResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': '2' } })
          : HttpResponse.json({ frames: [1, 2, 3] });
      })
    );
    const seen: boolean[] = [];
    const unsubscribe = subscribeRateLimitHint(() => seen.push(isRateLimitHintVisible()));

    const started = Date.now();
    const res = await client.get('/datasets/ds/episodes/3/frames');

    expect(res.data).toEqual({ frames: [1, 2, 3] });
    expect(calls).toBe(2);
    // It honoured Retry-After rather than hammering the server.
    expect(Date.now() - started).toBeGreaterThanOrEqual(1900);
    // Shown during the wait, gone once the retry was on its way.
    expect(seen).toEqual([true, false]);
    unsubscribe();
  }, 10_000);

  it('never shows the hint for a retry that goes through at once', async () => {
    let calls = 0;
    server.use(
      http.get(`${BASE}/robots`, () => {
        calls++;
        return calls === 1
          ? HttpResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': '0' } })
          : HttpResponse.json({ robots: [] });
      })
    );
    const seen: boolean[] = [];
    const unsubscribe = subscribeRateLimitHint(() => seen.push(isRateLimitHintVisible()));

    await client.get('/robots');

    expect(seen).toEqual([]);
    unsubscribe();
  });
});
