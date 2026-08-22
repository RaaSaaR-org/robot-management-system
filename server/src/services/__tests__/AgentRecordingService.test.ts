/**
 * @file AgentRecordingService.test.ts
 * @description Talking to a robot's `/recording/*` routes: what is forwarded,
 *              and the difference between "cannot" and "will not".
 * @feature teleoperation
 */

import { describe, it, expect, vi } from 'vitest';
import {
  AgentRecordingService,
  AgentRecordingRefused,
} from '../AgentRecordingService.js';
import { HttpClientError } from '../HttpClient.js';

const STATUS = {
  ok: true,
  recording: true,
  sessionId: 's1',
  episodeIndex: 0,
  frames: 0,
  totalFrames: 0,
  dropped: 0,
  totalDropped: 0,
  fpsTarget: 30,
  fpsActual: 0,
  degraded: false,
  lastDropReason: null,
  cameras: [{ camera: 'head_camera', key: 'cam_right_high' }],
  scene: 'g1_dex3_house_scene.xml',
  behindS: 0,
  episodes: [],
};

function build(
  opts: {
    baseUrl?: string | null;
    post?: ReturnType<typeof vi.fn>;
    get?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const post = opts.post ?? vi.fn(async () => STATUS);
  const get = opts.get ?? vi.fn(async () => STATUS);
  const calls: { baseUrl: string; timeout: number }[] = [];
  const service = new AgentRecordingService({
    robots: {
      getRegisteredRobot: async () =>
        opts.baseUrl === null ? null : { baseUrl: opts.baseUrl ?? 'http://robot:41246' },
    },
    httpClient: (baseUrl, timeout) => {
      calls.push({ baseUrl, timeout });
      return { post, get } as never;
    },
  });
  return { service, post, get, calls };
}

/** What the agent answers when it understood and declined. */
function refusal(status: number, code: string, message: string): HttpClientError {
  return new HttpClientError(`HTTP ${status}`, status, '/recording/start', undefined, {
    code,
    message,
  });
}

describe('start', () => {
  it('addresses the robot by id under /api/v1', async () => {
    const { service, post } = build();
    await service.start('robot-1', { sessionId: 's1', fps: 30 });
    expect(post).toHaveBeenCalledWith(
      '/api/v1/robots/robot-1/recording/start',
      expect.objectContaining({ sessionId: 's1', fps: 30 }),
    );
  });

  it('escapes a robot id that would otherwise change the path', async () => {
    const { service, post } = build();
    await service.start('robot/../admin', { sessionId: 's1' });
    expect(post.mock.calls[0]![0]).toBe('/api/v1/robots/robot%2F..%2Fadmin/recording/start');
  });

  it('returns the status the robot reported', async () => {
    const { service } = build();
    const status = await service.start('robot-1', { sessionId: 's1' });
    expect(status?.cameras).toEqual([{ camera: 'head_camera', key: 'cam_right_high' }]);
    expect(status?.scene).toBe('g1_dex3_house_scene.xml');
  });

  it('answers null for a robot with no agent URL, without calling anything', async () => {
    const { service, post } = build({ baseUrl: null });
    expect(await service.start('robot-1', { sessionId: 's1' })).toBeNull();
    expect(post).not.toHaveBeenCalled();
  });

  it('answers null when the agent has never heard of the route', async () => {
    // A 404 is a 4xx, but it means an OLD ROBOT, not a mistake the operator can
    // fix. Falling back silently is the right answer for a fleet that is not
    // upgraded all at once.
    const post = vi.fn(async () => {
      throw refusal(404, 'NOT_FOUND', 'Cannot POST /api/v1/robots/robot-1/recording/start');
    });
    const { service } = build({ post });
    expect(await service.start('robot-1', { sessionId: 's1' })).toBeNull();
  });

  it('answers null when the robot does not answer at all', async () => {
    const post = vi.fn(async () => {
      throw new HttpClientError('Connection refused: http://robot:41246', undefined, '/x');
    });
    const { service } = build({ post });
    expect(await service.start('robot-1', { sessionId: 's1' })).toBeNull();
  });

  it('answers null on a 5xx — the robot is up but broken, and the work did not happen', async () => {
    const post = vi.fn(async () => {
      throw refusal(500, 'RECORDING_FAILED', 'boom');
    });
    const { service } = build({ post });
    expect(await service.start('robot-1', { sessionId: 's1' })).toBeNull();
  });

  it('THROWS when the robot understood and refused', async () => {
    const post = vi.fn(async () => {
      throw refusal(409, 'RECORDING_REFUSED', 'busy recording session other-1');
    });
    const { service } = build({ post });
    await expect(service.start('robot-1', { sessionId: 's1' })).rejects.toBeInstanceOf(
      AgentRecordingRefused,
    );
  });

  it('carries the robot’s own words and code through the refusal', async () => {
    const post = vi.fn(async () => {
      throw refusal(409, 'RECORDING_REFUSED', 'the sidecar does not report 14 of 28 joints');
    });
    const { service } = build({ post });
    await expect(service.start('r', { sessionId: 's1' })).rejects.toMatchObject({
      statusCode: 409,
      code: 'RECORDING_REFUSED',
      message: 'the sidecar does not report 14 of 28 joints',
    });
  });

  it('treats an answer that is not a status as no answer', async () => {
    const post = vi.fn(async () => ({ ok: false }));
    const { service } = build({ post });
    expect(await service.start('robot-1', { sessionId: 's1' })).toBeNull();
  });
});

describe('nextEpisode', () => {
  it('returns the index the robot gave', async () => {
    const post = vi.fn(async () => ({ ok: true, episodeIndex: 3 }));
    const { service } = build({ post });
    expect(await service.nextEpisode('robot-1')).toBe(3);
    expect(post).toHaveBeenCalledWith('/api/v1/robots/robot-1/recording/next-episode');
  });

  it('answers null when the robot is not the recorder', async () => {
    const { service } = build({ baseUrl: null });
    expect(await service.nextEpisode('robot-1')).toBeNull();
  });

  it('answers null when the reply carries no index', async () => {
    const post = vi.fn(async () => ({ ok: true }));
    const { service } = build({ post });
    expect(await service.nextEpisode('robot-1')).toBeNull();
  });
});

describe('discardEpisode', () => {
  it('names the episode in the path', async () => {
    const post = vi.fn(async () => ({ ok: true }));
    const { service } = build({ post });
    expect(await service.discardEpisode('robot-1', 2)).toBe(true);
    expect(post).toHaveBeenCalledWith('/api/v1/robots/robot-1/recording/episodes/2/discard');
  });

  it('reports false rather than throwing when the robot is unreachable', async () => {
    const post = vi.fn(async () => {
      throw new HttpClientError('Connection refused', undefined, '/x');
    });
    const { service } = build({ post });
    expect(await service.discardEpisode('robot-1', 0)).toBe(false);
  });
});

describe('stop', () => {
  const RESULT = {
    ok: true,
    datasetPath: '/data/datasets/s1',
    robotType: 'Unitree_G1_Dex3',
    totalEpisodes: 2,
    totalFrames: 240,
    totalDropped: 0,
    fpsActual: 29.85,
    episodes: [{ episodeIndex: 0, frames: 120, dropped: 0, durationS: 4, fpsActual: 29.9 }],
    videoFeatures: ['observation.images.cam_right_high'],
    scene: 'g1_dex3_house_scene.xml',
    bootId: 'boot-1',
  };

  it('hands back the dataset the robot wrote', async () => {
    const post = vi.fn(async () => RESULT);
    const { service } = build({ post });
    const result = await service.stop('robot-1');
    expect(result?.datasetPath).toBe('/data/datasets/s1');
    expect(result?.totalFrames).toBe(240);
  });

  it('hands back an honest failure too, with the reason', async () => {
    const post = vi.fn(async () => ({ ...RESULT, ok: false, datasetPath: null, error: 'no frames recorded — teleop is not engaged' }));
    const { service } = build({ post });
    const result = await service.stop('robot-1');
    expect(result?.ok).toBe(false);
    expect(result?.error).toMatch(/teleop is not engaged/);
  });

  it('gives the encode a long timeout — thousands of JPEGs go through ffmpeg inside this call', async () => {
    const post = vi.fn(async () => RESULT);
    const { service, calls } = build({ post });
    await service.stop('robot-1');
    // Well beyond the 30 s LONG default: a two-minute session at 30 fps with
    // two cameras is thousands of JPEGs going through ffmpeg inside this call.
    expect(calls[0]!.timeout).toBeGreaterThanOrEqual(120_000);
  });

  it('uses a short timeout for status, which only reads counters', async () => {
    const { service, calls } = build();
    await service.status('robot-1');
    expect(calls[0]!.timeout).toBeLessThanOrEqual(5000);
  });
});

describe('pause and resume', () => {
  it('parks and restarts the recorder that holds the frames', async () => {
    const post = vi.fn(async (_url: string) => ({ ok: true }));
    const { service } = build({ post });
    expect(await service.pause('robot-1')).toBe(true);
    expect(await service.resume('robot-1')).toBe(true);
    expect(post.mock.calls.map((c) => c[0])).toEqual([
      '/api/v1/robots/robot-1/recording/pause',
      '/api/v1/robots/robot-1/recording/resume',
    ]);
  });

  it('reports false rather than pretending an old agent heard it', async () => {
    const post = vi.fn(async () => {
      throw new HttpClientError('HTTP 404', 404, '/x');
    });
    const { service } = build({ post });
    expect(await service.pause('robot-1')).toBe(false);
  });
});

describe('status', () => {
  it('reads the robot’s live counters', async () => {
    const get = vi.fn(async () => ({ ...STATUS, totalFrames: 42, totalDropped: 3 }));
    const { service } = build({ get });
    const status = await service.status('robot-1');
    expect(status?.totalFrames).toBe(42);
    expect(status?.totalDropped).toBe(3);
    expect(get).toHaveBeenCalledWith('/api/v1/robots/robot-1/recording/status');
  });

  it('answers null rather than throwing when the robot goes away mid-session', async () => {
    const get = vi.fn(async () => {
      throw new HttpClientError('Request timeout', undefined, '/x');
    });
    const { service } = build({ get });
    expect(await service.status('robot-1')).toBeNull();
  });
});
