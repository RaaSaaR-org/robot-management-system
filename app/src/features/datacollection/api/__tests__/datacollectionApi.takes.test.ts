/**
 * @file datacollectionApi.takes.test.ts
 * @description The take client (TASK-410): the routes and bodies it sends,
 *              and a 409 read as `{ ok: false, code, live }` instead of thrown.
 * @feature datacollection
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

vi.mock('@/api/client', () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

import { apiClient } from '@/api/client';
import { datacollectionApi } from '../datacollectionApi';

const client = apiClient as unknown as { get: Mock; post: Mock; delete: Mock };
const LIVE = { sessionId: 's1', phase: 'capturing', take: 2 };
const BODY = { expectedTake: 1, clientId: 'tab', source: 'desktop' as const };

beforeEach(() => vi.clearAllMocks());

describe('session client', () => {
  it('waits for the robot to save the takes when ending a session (TASK-450)', async () => {
    // The shared client aborts at 30 s; the server waits up to 300 s for the
    // robot's encode.
    client.post.mockResolvedValue({ status: 200, data: { session: { id: 's1', status: 'completed' } } });
    await expect(datacollectionApi.endSession('s1')).resolves.toEqual({ id: 's1', status: 'completed' });
    const [url, body, config] = client.post.mock.calls[0] as [string, unknown, { timeout: number }];
    expect(url).toBe('/teleoperation/sessions/s1/end');
    expect(body).toBeUndefined();
    expect(config.timeout).toBe(330_000);
  });
});

describe('take client', () => {
  it('posts start with the guard body and accepts a 409 as an answer', async () => {
    client.post.mockResolvedValue({ status: 200, data: { live: LIVE } });
    await expect(datacollectionApi.startEpisode('s1', BODY)).resolves.toEqual({ ok: true, live: LIVE });
    const [url, body, config] = client.post.mock.calls[0] as [string, unknown, { validateStatus: (s: number) => boolean }];
    expect(url).toBe('/teleoperation/sessions/s1/episodes/start');
    expect(body).toEqual(BODY);
    expect(config.validateStatus(409)).toBe(true);
    expect(config.validateStatus(500)).toBe(false);
  });

  it('turns a 409 into { ok: false, code, live }', async () => {
    client.post.mockResolvedValue({ status: 409, data: { code: 'episode_conflict', error: 'stale', live: LIVE } });
    await expect(datacollectionApi.nextEpisodeGuarded('s1', BODY)).resolves.toEqual({
      ok: false, code: 'episode_conflict', error: 'stale', live: LIVE,
    });
    expect(client.post.mock.calls[0][0]).toBe('/teleoperation/sessions/s1/episodes/next');
  });

  it('stop carries the quick check; discard-last carries the take', async () => {
    client.post.mockResolvedValueOnce({ status: 200, data: { live: LIVE, quickCheck: { take: 1 } } });
    await expect(datacollectionApi.stopEpisode('s1', BODY)).resolves.toEqual({ ok: true, live: LIVE, quickCheck: { take: 1 } });
    client.post.mockResolvedValueOnce({ status: 200, data: { live: LIVE, take: 1 } });
    await expect(datacollectionApi.discardLast('s1', BODY)).resolves.toEqual({ ok: true, live: LIVE, take: 1 });
    expect(client.post.mock.calls[1][0]).toBe('/teleoperation/sessions/s1/episodes/discard-last');
  });

  it('DELETE of a take sends the guard body and reports a restart', async () => {
    client.delete.mockResolvedValue({ status: 200, data: { episodeIndex: 2, restarted: true, live: LIVE } });
    await expect(datacollectionApi.discardTake('s1', 2, { clientId: 'tab', source: 'desktop' })).resolves.toEqual({
      ok: true, live: LIVE, take: 2, restarted: true,
    });
    const [url, config] = client.delete.mock.calls[0] as [string, { data: unknown }];
    expect(url).toBe('/teleoperation/sessions/s1/episodes/2');
    expect(config.data).toEqual({ clientId: 'tab', source: 'desktop' });
  });

  it('reads the live state and a thumbnail (null on 404)', async () => {
    client.get.mockResolvedValueOnce({ status: 200, data: LIVE });
    await expect(datacollectionApi.getLive('s1')).resolves.toEqual(LIVE);
    expect(client.get.mock.calls[0][0]).toBe('/teleoperation/sessions/s1/live');
    client.get.mockResolvedValueOnce({ status: 404, data: null });
    await expect(datacollectionApi.fetchThumbnail('s1', 3)).resolves.toBeNull();
    expect(client.get.mock.calls[1][0]).toBe('/teleoperation/sessions/s1/episodes/3/thumbnail');
    expect(datacollectionApi.thumbnailUrl('s1', 3)).toBe('/teleoperation/sessions/s1/episodes/3/thumbnail');
  });
});
