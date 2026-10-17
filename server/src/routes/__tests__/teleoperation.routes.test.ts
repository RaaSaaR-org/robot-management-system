/**
 * @file teleoperation.routes.test.ts
 * @description The episode-control routes (TASK-408): body validation, who is
 *              asking, the 409 with the live state to re-sync from, and the
 *              thumbnail proxy.
 * @feature datacollection
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const svc = vi.hoisted(() => {
  class EpisodeActionError extends Error {
    readonly status: number;
    constructor(
      readonly code: string,
      readonly live: unknown,
      message: string
    ) {
      super(message);
      this.status = code === 'recorder_unavailable' ? 502 : 409;
    }
  }
  return {
    EpisodeActionError,
    service: {
      getLiveState: vi.fn(),
      startEpisode: vi.fn(),
      stopEpisode: vi.fn(),
      nextEpisode: vi.fn(),
      discardLast: vi.fn(),
      discardEpisode: vi.fn(),
      listEpisodes: vi.fn(),
      episodeThumbnail: vi.fn(),
    },
  };
});

vi.mock('../../services/TeleoperationService.js', () => ({
  teleoperationService: svc.service,
  EpisodeActionError: svc.EpisodeActionError,
}));

import { teleoperationRoutes } from '../teleoperation.routes.js';

const LIVE = { sessionId: 's1', phase: 'capturing', take: 4 };

function app(user?: { id: string; name: string; email: string }) {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => {
    if (user) (req as unknown as { user: unknown }).user = { ...user, role: 'member', tenantId: null };
    next();
  });
  a.use('/api/teleoperation', teleoperationRoutes);
  return a;
}

const ANA = { id: 'user-7', name: 'Ana', email: 'ana@example.com' };

describe('episode control routes (TASK-408)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET /live answers the live state', async () => {
    svc.service.getLiveState.mockResolvedValue(LIVE);
    const res = await request(app(ANA)).get('/api/teleoperation/sessions/s1/live');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(LIVE);
  });

  it('GET /live 404s for an unknown session', async () => {
    svc.service.getLiveState.mockRejectedValue(new Error('Session nope not found'));
    const res = await request(app(ANA)).get('/api/teleoperation/sessions/nope/live');
    expect(res.status).toBe(404);
  });

  it('start passes the guard, the client and the person asking', async () => {
    svc.service.startEpisode.mockResolvedValue({ live: LIVE, take: 4 });
    const res = await request(app(ANA))
      .post('/api/teleoperation/sessions/s1/episodes/start')
      .send({ expectedTake: 3, clientId: 'quest-1', source: 'vr' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ live: LIVE });
    expect(svc.service.startEpisode).toHaveBeenCalledWith('s1', {
      expectedTake: 3,
      clientId: 'quest-1',
      source: 'vr',
      user: { userId: 'user-7', displayName: 'Ana' },
    });
  });

  it('defaults the source to desktop and keeps expectedTake null apart from absent', async () => {
    svc.service.startEpisode.mockResolvedValue({ live: LIVE, take: 0 });
    await request(app(ANA)).post('/api/teleoperation/sessions/s1/episodes/start').send({ expectedTake: null });
    expect(svc.service.startEpisode.mock.calls[0]![1]).toMatchObject({ expectedTake: null, source: 'desktop' });
    await request(app(ANA)).post('/api/teleoperation/sessions/s1/episodes/start').send({});
    expect(svc.service.startEpisode.mock.calls[1]![1]).not.toHaveProperty('expectedTake');
  });

  it.each([
    [{ expectedTake: '3' }, /expectedTake/],
    [{ expectedTake: -1 }, /expectedTake/],
    [{ expectedTake: 1.5 }, /expectedTake/],
    [{ source: 'keyboard' }, /source/],
    [{ clientId: '' }, /clientId/],
  ])('rejects a malformed body %j with 400', async (body, message) => {
    const res = await request(app(ANA)).post('/api/teleoperation/sessions/s1/episodes/stop').send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(message);
    expect(svc.service.stopEpisode).not.toHaveBeenCalled();
  });

  it('a refused action answers 409 with its code and the live state', async () => {
    svc.service.nextEpisode.mockRejectedValue(
      new svc.EpisodeActionError('episode_conflict', LIVE, 'Another client changed the take first')
    );
    const res = await request(app(ANA))
      .post('/api/teleoperation/sessions/s1/episodes/next')
      .send({ expectedTake: 3, source: 'hotkey' });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ code: 'episode_conflict', error: 'Another client changed the take first', live: LIVE });
  });

  it('fills in the live state when the refusal came without one', async () => {
    svc.service.stopEpisode.mockRejectedValue(
      new svc.EpisodeActionError('recorder_unavailable', undefined, 'The robot did not end the take')
    );
    svc.service.getLiveState.mockResolvedValue(LIVE);
    const res = await request(app(ANA)).post('/api/teleoperation/sessions/s1/episodes/stop').send({});
    expect(res.status).toBe(502);
    expect(res.body.live).toEqual(LIVE);
  });

  it('stop answers the live state and the quick check', async () => {
    const quickCheck = { take: 4, frames: 90 };
    svc.service.stopEpisode.mockResolvedValue({ live: LIVE, quickCheck });
    const res = await request(app(ANA)).post('/api/teleoperation/sessions/s1/episodes/stop').send({});
    expect(res.body).toEqual({ live: LIVE, quickCheck });
  });

  it('next keeps its old episodeIndex and adds the live state', async () => {
    svc.service.nextEpisode.mockResolvedValue({ episodeIndex: 5, live: LIVE });
    const res = await request(app(ANA)).post('/api/teleoperation/sessions/s1/episodes/next');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ episodeIndex: 5, live: LIVE });
  });

  it('discard-last and DELETE both carry who discarded', async () => {
    svc.service.discardLast.mockResolvedValue({ live: LIVE, take: 4 });
    const res = await request(app(ANA))
      .post('/api/teleoperation/sessions/s1/episodes/discard-last')
      .send({ expectedTake: 4, source: 'vr' });
    expect(res.status).toBe(200);
    expect(svc.service.discardLast.mock.calls[0]![1]).toMatchObject({ source: 'vr', expectedTake: 4 });

    svc.service.discardEpisode.mockResolvedValue({ episodeIndex: 2, deletedFrames: 0, frameCount: 0, live: LIVE });
    const del = await request(app(ANA)).delete('/api/teleoperation/sessions/s1/episodes/2');
    expect(del.status).toBe(200);
    expect(svc.service.discardEpisode).toHaveBeenCalledWith('s1', 2, expect.objectContaining({ user: { userId: 'user-7', displayName: 'Ana' } }));
  });

  it('DELETE refuses a take number parseInt would have bent', async () => {
    const res = await request(app(ANA)).delete('/api/teleoperation/sessions/s1/episodes/2.7');
    expect(res.status).toBe(400);
    expect(svc.service.discardEpisode).not.toHaveBeenCalled();
  });

  it('the list passes includeDiscarded through', async () => {
    svc.service.listEpisodes.mockResolvedValue([]);
    await request(app(ANA)).get('/api/teleoperation/sessions/s1/episodes?includeDiscarded=1');
    expect(svc.service.listEpisodes).toHaveBeenCalledWith('s1', { includeDiscarded: true });
    await request(app(ANA)).get('/api/teleoperation/sessions/s1/episodes');
    expect(svc.service.listEpisodes).toHaveBeenLastCalledWith('s1', { includeDiscarded: false });
  });

  describe('thumbnail', () => {
    it('proxies the JPEG with a private cache header', async () => {
      const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
      svc.service.episodeThumbnail.mockResolvedValue(jpeg);
      const res = await request(app(ANA)).get('/api/teleoperation/sessions/s1/episodes/3/thumbnail');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('image/jpeg');
      expect(res.headers['cache-control']).toBe('private, max-age=3600');
      expect(Buffer.compare(res.body as Buffer, jpeg)).toBe(0);
      expect(svc.service.episodeThumbnail).toHaveBeenCalledWith('s1', 3);
    });

    it('404s cleanly when there is none', async () => {
      svc.service.episodeThumbnail.mockResolvedValue(null);
      const res = await request(app(ANA)).get('/api/teleoperation/sessions/s1/episodes/3/thumbnail');
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ code: 'no_thumbnail', error: 'take 3 has no thumbnail' });
    });

    it('400s a take that is not a number', async () => {
      const res = await request(app(ANA)).get('/api/teleoperation/sessions/s1/episodes/x/thumbnail');
      expect(res.status).toBe(400);
      expect(svc.service.episodeThumbnail).not.toHaveBeenCalled();
    });
  });
});
