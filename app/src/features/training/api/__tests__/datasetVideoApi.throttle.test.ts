/**
 * @file datasetVideoApi.throttle.test.ts
 * @description Asking why a video did not load: a 429 answers with how long to
 *              wait, anything else with null (TASK-482).
 * @feature training
 */

import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/mocks/server';
import { probeVideoThrottle } from '../datasetVideoApi';

const URL = 'http://api.test/api/datasets/ds-1/episodes/4/video/observation.images.ego_view';

describe('probeVideoThrottle', () => {
  it('returns the wait the server asked for on a 429', async () => {
    let asked: Request | null = null;
    server.use(
      http.get(URL, ({ request }) => {
        asked = request;
        return HttpResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': '17' } });
      })
    );

    await expect(probeVideoThrottle(`${URL}?chunk=0&file=2&ticket=abc#t=12.5,31`)).resolves.toBe(17_000);

    // The same video, one byte of it, and no media fragment sent to the server.
    const request = asked as Request | null;
    expect(request?.url).toBe(`${URL}?chunk=0&file=2&ticket=abc`);
    expect(request?.headers.get('Range')).toBe('bytes=0-0');
  });

  it('waits a few seconds when a 429 does not say how long', async () => {
    server.use(http.get(URL, () => HttpResponse.json({ error: 'Too many requests' }, { status: 429 })));
    await expect(probeVideoThrottle(URL)).resolves.toBe(5000);
  });

  it('never waits longer than one window', async () => {
    server.use(
      http.get(URL, () => HttpResponse.json({}, { status: 429, headers: { 'Retry-After': '86400' } }))
    );
    await expect(probeVideoThrottle(URL)).resolves.toBe(65_000);
  });

  it.each([206, 401, 404, 500])('is null for a %i: not a rate limit', async (status) => {
    server.use(http.get(URL, () => new HttpResponse(status === 206 ? 'x' : null, { status })));
    await expect(probeVideoThrottle(URL)).resolves.toBeNull();
  });

  it('is null when the server cannot be reached', async () => {
    server.use(http.get(URL, () => HttpResponse.error()));
    await expect(probeVideoThrottle(URL)).resolves.toBeNull();
  });
});
