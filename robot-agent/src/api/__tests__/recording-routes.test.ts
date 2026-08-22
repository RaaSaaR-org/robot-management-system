/**
 * @file recording-routes.test.ts
 * @description Contract for `/api/v1/robots/:id/recording/*` — the five verbs the
 *              operator UI drives an episode recording with. Runs the real
 *              Express router over real HTTP with a stubbed controller, because
 *              everything worth checking here is transport: which fields survive
 *              the wire, which refusals are a 409 rather than a 500, and that the
 *              paths cannot be confused with the sim's `/record/*` cine recorder.
 * @feature recording
 * @status test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import cors from 'cors';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import type { Router } from 'express';

/**
 * The controller is the seam. Its own wiring is covered by
 * `recording/__tests__/recording-controller.test.ts`; here it is a spy, so a
 * route test never has to start a recorder, a sidecar or a timer.
 */
const controller = vi.hoisted(() => ({
  start: vi.fn(),
  nextEpisode: vi.fn(),
  discardEpisode: vi.fn(),
  stop: vi.fn(),
  status: vi.fn(),
  refreshHealth: vi.fn(),
  isRecording: vi.fn(),
  stopIfRecording: vi.fn(),
}));

vi.mock('../../recording/recording-controller.js', () => ({
  recordingController: controller,
}));
vi.mock('../../hardware/HardwareClient.js', () => ({
  hardwareClient: {
    getCachedPose: () => null,
    getOdometryFrame: () => null,
  },
  getSidecarUrl: () => 'http://127.0.0.1:1',
}));
vi.mock('../../agent-mode/agent-mode-controller.js', () => ({
  agentModeController: new Proxy({}, { get: () => vi.fn() }),
}));
vi.mock('../../agent-mode/identity.js', () => ({
  getIdentityStore: () => ({ load: vi.fn() }),
}));
vi.mock('../../vla/skill-executor.js', () => ({
  SkillExecutor: class {
    run = vi.fn();
    abort(): void {}
    isAborted(): boolean {
      return false;
    }
  },
  skillExecutorRegistry: {
    register: (): void => {},
    unregister: (): void => {},
    abort: (): boolean => false,
    abortAll: (): number => 0,
  },
}));

import { RecordingError } from '../../recording/EpisodeRecorder.js';
import { createRestRoutes } from '../rest-routes.js';
import type { RobotStateManager } from '../../robot/state.js';

/** A plausible `RecordingStatus`, spread into every success body. */
const STATUS = {
  recording: true,
  sessionId: 'session-1',
  episodeIndex: 0,
  frames: 12,
  totalFrames: 12,
  dropped: 1,
  totalDropped: 1,
  fpsTarget: 30,
  fpsActual: 28.7,
  degraded: false,
  lastDropReason: null,
  cameras: [{ camera: 'head_camera', key: 'observation.images.head' }],
  scene: 'g1_dex3_house_scene.xml',
  behindS: 0.02,
  episodes: [],
};

describe('episode recording routes', () => {
  let agent: Server;
  let base: string;
  let router: Router;

  beforeEach(async () => {
    vi.clearAllMocks();
    controller.start.mockResolvedValue(STATUS);
    controller.status.mockReturnValue(STATUS);
    controller.refreshHealth.mockResolvedValue(undefined);
    controller.nextEpisode.mockReturnValue(1);
    controller.discardEpisode.mockResolvedValue(true);
    controller.stop.mockResolvedValue({ ok: true, datasetPath: '/data/ds', totalFrames: 12 });

    router = createRestRoutes({
      getRobotInterface: () => ({ id: 'robot-1', status: 'idle' }),
      updateServerHeartbeat: (): void => {},
    } as unknown as RobotStateManager);

    const app = express();
    app.use(cors());
    app.use(express.json());
    app.use('/api/v1', router);
    await new Promise<void>((resolve) => {
      agent = app.listen(0, () => resolve());
    });
    base = `http://127.0.0.1:${(agent.address() as AddressInfo).port}/api/v1`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => agent.close(() => resolve()));
  });

  const post = (path: string, body?: unknown): Promise<Response> =>
    fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  const get = (path: string): Promise<Response> => fetch(`${base}${path}`);

  // -------------------------------------------------------------------------
  // start
  // -------------------------------------------------------------------------

  it('forwards exactly the fields the caller sent, and no key it did not', async () => {
    const res = await post('/robots/robot-1/recording/start', {
      sessionId: '  session-1  ',
      fps: 20,
      task: 'fold the towel',
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, sessionId: 'session-1', fpsTarget: 30 });

    const arg = controller.start.mock.calls[0]![0] as Record<string, unknown>;
    // Not `toMatchObject`: the point is that `cameras`, `shadows` and
    // `inputMode` are ABSENT, so the recorder applies its own defaults instead
    // of being handed an explicit `undefined` that reads as "no cameras".
    expect(Object.keys(arg).sort()).toEqual(['fps', 'sessionId', 'task']);
    expect(arg).toEqual({ sessionId: 'session-1', fps: 20, task: 'fold the towel' });
  });

  it('forwards cameras, shadows and inputMode when they are given', async () => {
    await post('/robots/robot-1/recording/start', {
      sessionId: 'session-1',
      cameras: ['head_camera', 'house_iso'],
      shadows: true,
      inputMode: 'vr-hands',
      fps: 60,
    });

    expect(controller.start).toHaveBeenCalledWith({
      sessionId: 'session-1',
      fps: 60,
      cameras: ['head_camera', 'house_iso'],
      shadows: true,
      inputMode: 'vr-hands',
    });
  });

  it('forwards an empty camera list rather than treating it as absent', async () => {
    // `cameras: []` means "joints only", which is a different session from
    // "you pick" — it must not be collapsed into the default.
    await post('/robots/robot-1/recording/start', { sessionId: 'session-1', cameras: [] });
    expect(controller.start).toHaveBeenCalledWith({ sessionId: 'session-1', cameras: [] });
  });

  it('refuses a start with no sessionId', async () => {
    const res = await post('/robots/robot-1/recording/start', { fps: 30 });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'INVALID_REQUEST' });
    expect(controller.start).not.toHaveBeenCalled();
  });

  it('refuses a sessionId that is only whitespace', async () => {
    const res = await post('/robots/robot-1/recording/start', { sessionId: '   ' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'INVALID_REQUEST' });
    expect(controller.start).not.toHaveBeenCalled();
  });

  it('refuses cameras that is not an array of strings', async () => {
    // The shape a hand-written curl gets wrong first: one camera, unwrapped.
    const single = await post('/robots/robot-1/recording/start', {
      sessionId: 'session-1',
      cameras: 'head_camera',
    });
    expect(single.status).toBe(400);
    expect(await single.json()).toMatchObject({ code: 'INVALID_REQUEST', message: 'cameras must be string[]' });

    const numbers = await post('/robots/robot-1/recording/start', {
      sessionId: 'session-1',
      cameras: [0, 1],
    });
    expect(numbers.status).toBe(400);
    expect(controller.start).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // errors
  // -------------------------------------------------------------------------

  it.each([
    'already recording session session-1',
    'busy recording session session-0',
    'the sidecar does not report 14 of 43 joints (left_hand_thumb_0_joint, …) — recording them would store zeros',
  ])('turns "%s" into a 409 the operator can read', async (message) => {
    controller.start.mockRejectedValueOnce(
      new RecordingError(message, 'RECORDING_REFUSED', 409),
    );
    const res = await post('/robots/robot-1/recording/start', { sessionId: 'session-1' });
    expect(res.status).toBe(409);
    // Verbatim: the message names which joints are missing, and rewording it
    // would leave the operator with a status code and nothing to act on.
    expect(await res.json()).toEqual({ code: 'RECORDING_REFUSED', message });
  });

  it('turns "not recording" from next-episode into a 409', async () => {
    controller.nextEpisode.mockImplementationOnce(() => {
      throw new RecordingError('not recording', 'RECORDING_REFUSED', 409);
    });
    const res = await post('/robots/robot-1/recording/next-episode');
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ code: 'RECORDING_REFUSED', message: 'not recording' });
  });

  it('answers 500 for a failure that is not a refusal', async () => {
    controller.stop.mockRejectedValueOnce(new Error("ENOSPC: no space left on device, write '/data/ds'"));
    const res = await post('/robots/robot-1/recording/stop');
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ code: 'RECORDING_FAILED', message: expect.stringContaining('ENOSPC') });
  });

  it('answers 500 with a stringified throw when the recorder throws a non-Error', async () => {
    controller.status.mockImplementationOnce(() => {
      throw 'kaboom';
    });
    const res = await get('/robots/robot-1/recording/status');
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ code: 'RECORDING_FAILED', message: 'kaboom' });
  });

  it('is 404 for a robot this agent does not serve, on every recording route', async () => {
    const answers = await Promise.all([
      post('/robots/other/recording/start', { sessionId: 'session-1' }),
      post('/robots/other/recording/next-episode'),
      post('/robots/other/recording/episodes/0/discard'),
      post('/robots/other/recording/stop'),
      get('/robots/other/recording/status'),
    ]);

    for (const res of answers) {
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ code: 'ROBOT_NOT_FOUND' });
    }
    // The wrong robot must be refused BEFORE anything touches the recorder.
    expect(controller.start).not.toHaveBeenCalled();
    expect(controller.nextEpisode).not.toHaveBeenCalled();
    expect(controller.discardEpisode).not.toHaveBeenCalled();
    expect(controller.stop).not.toHaveBeenCalled();
    expect(controller.status).not.toHaveBeenCalled();
    expect(controller.refreshHealth).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // next-episode / discard / stop / status
  // -------------------------------------------------------------------------

  it('answers next-episode with the index the recorder opened', async () => {
    controller.nextEpisode.mockReturnValueOnce(4);
    const res = await post('/robots/robot-1/recording/next-episode');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, episodeIndex: 4 });
  });

  it('discards a valid episode index and echoes it back', async () => {
    const res = await post('/robots/robot-1/recording/episodes/2/discard');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, episodeIndex: 2 });
    expect(controller.discardEpisode).toHaveBeenCalledWith(2);
  });

  it('answers 404 for an episode this recording never had', async () => {
    // "There was no take 3" and "take 3 is gone" must not look the same to an
    // operator deciding whether to re-record it.
    controller.discardEpisode.mockResolvedValueOnce(false);
    const res = await post('/robots/robot-1/recording/episodes/3/discard');
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: 'EPISODE_NOT_FOUND' });
  });

  it('refuses an index parseInt would silently round or truncate', async () => {
    // parseInt reads "1e3" as 1, "2.7" as 2 and "3xyz" as 3 — a typo would
    // discard a DIFFERENT episode and answer success.
    for (const index of ['1e3', '2.7', '+3', '3xyz', ' 4']) {
      const res = await post(`/robots/robot-1/recording/episodes/${index}/discard`);
      expect(res.status, index).toBe(400);
    }
  });

  it('refuses a start whose optional field is the wrong type instead of ignoring it', async () => {
    // A client that sends fps as a string would otherwise record at the default
    // rate and never be told the number it asked for was dropped on the floor.
    for (const body of [
      { sessionId: 's1', fps: '30' },
      { sessionId: 's1', shadows: 'true' },
      { sessionId: 's1', task: 42 },
      { sessionId: 's1', inputMode: ['vr'] },
    ]) {
      const res = await post('/robots/robot-1/recording/start', body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(await res.json()).toMatchObject({ code: 'INVALID_REQUEST' });
    }
    expect(controller.start).not.toHaveBeenCalled();
  });

  it('answers 503 while the agent is still deciding it is the robot', async () => {
    // `attachController` runs only after incarnation confirmation, so a status
    // poll during boot lands here. Transient, with a right answer — ask again.
    controller.status.mockImplementationOnce(() => {
      throw new RecordingError('no RobotStateManager is attached', 'RECORDING_UNAVAILABLE', 503);
    });
    const res = await fetch(`${base}/robots/robot-1/recording/status`);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: 'RECORDING_UNAVAILABLE' });
  });

  it('refuses a discard index that is not a non-negative integer', async () => {
    for (const index of ['abc', '-1', 'NaN']) {
      const res = await post(`/robots/robot-1/recording/episodes/${index}/discard`);
      expect(res.status, index).toBe(400);
      expect(await res.json()).toMatchObject({ code: 'INVALID_REQUEST' });
    }
    // An empty segment does not match the route at all — Express 404s it
    // before the handler sees it. Still a refusal, still deletes nothing.
    expect((await post('/robots/robot-1/recording/episodes//discard')).status).toBe(404);
    expect(controller.discardEpisode).not.toHaveBeenCalled();
  });

  it('answers stop with the writer result, verbatim and unwrapped', async () => {
    controller.stop.mockResolvedValueOnce({
      ok: true,
      datasetPath: '/data/workspace-robot-1/datasets/session-1',
      robotType: 'g1_edu',
      totalEpisodes: 2,
      totalFrames: 600,
      totalDropped: 3,
      fpsActual: 29.1,
      episodes: [],
      videoFeatures: ['observation.images.head'],
      scene: 'g1_dex3_house_scene.xml',
      bootId: 'boot-1',
    });
    const res = await post('/robots/robot-1/recording/stop');
    expect(res.status).toBe(200);
    // No `{ok:true, ...}` re-wrapping here: `StopRecordingResult` already
    // carries its own `ok`, which is false when nothing was written.
    expect(await res.json()).toMatchObject({
      datasetPath: '/data/workspace-robot-1/datasets/session-1',
      totalFrames: 600,
    });
  });

  it('refreshes the sidecar health before answering status', async () => {
    const res = await get('/robots/robot-1/recording/status');
    expect(res.status).toBe(200);
    expect(controller.refreshHealth).toHaveBeenCalledTimes(1);
    expect(await res.json()).toMatchObject({ ok: true, sessionId: 'session-1', behindS: 0.02 });
  });

  it('still answers status when the health refresh fails', async () => {
    // The refresh is a courtesy — `behind_s` goes stale, the status does not
    // disappear. A sim that stopped answering is exactly when an operator
    // needs to see the frame counters.
    controller.refreshHealth.mockRejectedValueOnce(new Error('sidecar unreachable'));
    const res = await get('/robots/robot-1/recording/status');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, frames: 12 });
  });

  // -------------------------------------------------------------------------
  // the name
  // -------------------------------------------------------------------------

  it('never serves /record/* — that verb belongs to the sim cine recorder', async () => {
    const paths = (router.stack as { route?: { path: string } }[])
      .map((layer) => layer.route?.path)
      .filter((p): p is string => typeof p === 'string');

    expect(paths.length).toBeGreaterThan(0);
    expect(paths.filter((p) => p.includes('/record/'))).toEqual([]);
    expect(paths.filter((p) => p.includes('/recording/')).sort()).toEqual([
      '/robots/:id/recording/episodes/:index/discard',
      '/robots/:id/recording/next-episode',
      '/robots/:id/recording/start',
      '/robots/:id/recording/status',
      '/robots/:id/recording/stop',
    ]);

    // And the same thing from outside: the sim's MP4 verb is not routed here.
    expect((await post('/robots/robot-1/record/start')).status).toBe(404);
    expect((await post('/robots/robot-1/record/stop')).status).toBe(404);
    expect(controller.start).not.toHaveBeenCalled();
  });
});
