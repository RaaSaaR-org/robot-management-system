/**
 * @file liveState.test.ts
 * @description The one live state every client of a session renders (TASK-408),
 *              the guard on episode actions, and the take ledger behind the
 *              server-side recorders.
 * @feature datacollection
 */

import { describe, it, expect } from 'vitest';
import {
  guardEpisodeAction,
  idleLive,
  liveFromAgent,
  liveFromLedger,
  progressFromLive,
  quickCheckFromReport,
  thumbnailPath,
  type LiveBase,
} from '../teleoperation/liveState.js';
import { TakeLedger } from '../teleoperation/takeLedger.js';
import type { AgentRecordingStatus } from '../AgentRecordingService.js';
import type { LiveState } from '../../types/teleoperation.types.js';

const NOW = Date.parse('2026-10-17T12:00:00.000Z');

const BASE: LiveBase = {
  sessionId: 'sess-1',
  status: 'recording',
  fpsTarget: 30,
  autoStopS: null,
  nowMs: NOW,
};

function agentStatus(over: Partial<AgentRecordingStatus> = {}): AgentRecordingStatus {
  return {
    recording: true,
    sessionId: 'sess-1',
    episodeIndex: 0,
    frames: 0,
    totalFrames: 0,
    dropped: 0,
    totalDropped: 0,
    fpsTarget: 30,
    fpsActual: 0,
    degraded: false,
    lastDropReason: null,
    cameras: [],
    scene: null,
    behindS: null,
    episodes: [],
    phase: 'between',
    episodeStartedAtMs: null,
    episodeElapsedS: null,
    elapsedS: 4,
    autoStopS: null,
    lastStop: null,
    ...over,
  };
}

const REPORT = (i: number, over: Record<string, unknown> = {}) => ({
  episodeIndex: i,
  frames: 90,
  dropped: 1,
  durationS: 3,
  fpsActual: 29.7,
  jointsMoved: [{ name: 'left_shoulder_pitch_joint', rangeRad: 0.4 }],
  groupsMoved: ['left_arm'],
  warnings: [],
  thumbnail: { camera: 'cam_right_high', frame: 45 },
  discarded: false,
  ...over,
});

describe('liveFromAgent', () => {
  it('a fresh session is between takes with no take yet', () => {
    const live = liveFromAgent(BASE, agentStatus(), null);
    expect(live).toMatchObject({
      phase: 'between',
      take: null,
      takeStartedAt: null,
      takeElapsedS: null,
      kept: 0,
      discarded: 0,
      lastTake: null,
      at: '2026-10-17T12:00:00.000Z',
    });
  });

  it('while capturing: the live take, its frames, and the SERVER stamp of its start', () => {
    const stamp = NOW - 2500;
    const live = liveFromAgent(
      BASE,
      agentStatus({
        phase: 'capturing',
        episodeIndex: 1,
        frames: 75,
        totalFrames: 165,
        // The robot's clock is 40 s off; it must not leak into the timer.
        episodeStartedAtMs: NOW + 40_000,
        episodeElapsedS: 2.4,
        episodes: [REPORT(0), REPORT(1, { frames: 75 })],
        lastStop: { episodeIndex: 0, reason: 'operator', atMs: 1 },
      }),
      stamp
    );
    expect(live.phase).toBe('capturing');
    expect(live.take).toBe(1);
    expect(live.takeFrames).toBe(75);
    expect(live.totalFrames).toBe(165);
    expect(live.takeStartedAt).toBe(new Date(stamp).toISOString());
    expect(live.takeElapsedS).toBe(2.5);
    // Only finished takes count as kept; the open one is not done yet.
    expect(live.kept).toBe(1);
    expect(live.lastTake?.take).toBe(0);
    expect(live.lastTake?.stopReason).toBe('operator');
  });

  it('derives the start from the robot’s elapsed seconds when this server has no stamp', () => {
    const live = liveFromAgent(
      BASE,
      agentStatus({ phase: 'capturing', episodeIndex: 0, episodeElapsedS: 1.5, episodes: [REPORT(0)] }),
      null
    );
    expect(live.takeStartedAt).toBe(new Date(NOW - 1500).toISOString());
    expect(live.takeElapsedS).toBe(1.5);
  });

  it('between takes: the last take, its quick check with a thumbnail URL, and the counts', () => {
    const live = liveFromAgent(
      BASE,
      agentStatus({
        episodeIndex: 2,
        episodes: [REPORT(0), REPORT(1, { discarded: true, frames: 0, thumbnail: null }), REPORT(2)],
        lastStop: { episodeIndex: 2, reason: 'time_limit', atMs: 5 },
      }),
      null
    );
    expect(live.take).toBe(2);
    expect(live.kept).toBe(2);
    expect(live.discarded).toBe(1);
    expect(live.lastTake).toEqual({
      take: 2,
      frames: 90,
      durationS: 3,
      droppedFrames: 1,
      fpsActual: 29.7,
      jointsMoved: [{ name: 'left_shoulder_pitch_joint', rangeRad: 0.4 }],
      groupsMoved: ['left_arm'],
      warnings: [],
      thumbnailUrl: '/api/teleoperation/sessions/sess-1/episodes/2/thumbnail',
      stopReason: 'time_limit',
      discarded: false,
    });
  });

  it('an older agent without a phase reads as capturing while it records', () => {
    const status = agentStatus();
    delete status.phase;
    expect(liveFromAgent(BASE, status, null).phase).toBe('capturing');
  });
});

describe('quickCheckFromReport', () => {
  it('has no thumbnail URL when the robot has no picture', () => {
    const qc = quickCheckFromReport('s', { ...REPORT(4), thumbnail: null }, 'operator');
    expect(qc.thumbnailUrl).toBeNull();
  });

  it('escapes the session id in the URL', () => {
    expect(thumbnailPath('a/b', 1)).toBe('/api/teleoperation/sessions/a%2Fb/episodes/1/thumbnail');
  });
});

describe('progressFromLive — every progress event is complete', () => {
  it('carries all counters, even right after a next', () => {
    // Regression: a next used to emit `{currentEpisode, running}` alone, and the
    // other client replaced its counters with that and showed 0 frames.
    const live = liveFromAgent(
      BASE,
      agentStatus({ phase: 'capturing', episodeIndex: 3, totalFrames: 400, fpsActual: 29.9, episodes: [REPORT(3)] }),
      NOW
    );
    const progress = progressFromLive(live);
    expect(progress).toEqual({
      frameCount: 400,
      currentEpisode: 3,
      episodesDone: 0,
      fpsActual: 29.9,
      running: true,
      degraded: false,
      elapsedS: 4,
    });
  });

  it('is complete for an idle session too', () => {
    const progress = progressFromLive(idleLive(BASE));
    for (const key of ['frameCount', 'currentEpisode', 'fpsActual', 'running', 'degraded'] as const) {
      expect(progress[key]).not.toBeUndefined();
    }
  });
});

describe('guardEpisodeAction', () => {
  const between = (over: Partial<LiveState> = {}): LiveState => ({ ...idleLive(BASE), phase: 'between', ...over });
  const capturing = (take: number): LiveState => between({ phase: 'capturing', take });

  it('lets a first start through with expectedTake null', () => {
    expect(guardEpisodeAction('start', between(), null)).toBeNull();
  });

  it('refuses start while capturing and stop while between', () => {
    expect(guardEpisodeAction('start', capturing(0), undefined)).toBe('already_capturing');
    expect(guardEpisodeAction('stop', between({ take: 0 }), undefined)).toBe('not_capturing');
  });

  it('refuses a client whose take is stale', () => {
    expect(guardEpisodeAction('next', capturing(4), 3)).toBe('episode_conflict');
    expect(guardEpisodeAction('next', capturing(4), 4)).toBeNull();
    expect(guardEpisodeAction('next', capturing(4), undefined)).toBeNull();
  });

  it('discard-last needs a take, and never walks back past one already discarded', () => {
    expect(guardEpisodeAction('discard-last', between(), undefined)).toBe('no_take');
    const discardedLast = between({
      take: 2,
      lastTake: { ...quickCheckFromReport('s', REPORT(2), 'operator'), discarded: true },
    });
    expect(guardEpisodeAction('discard-last', discardedLast, 2)).toBe('already_discarded');
    expect(guardEpisodeAction('discard-last', capturing(3), 3)).toBeNull();
  });
});

describe('TakeLedger + liveFromLedger', () => {
  it('numbers takes from where it is told, and never reuses one', () => {
    let t = 1000;
    const ledger = new TakeLedger({ nextTake: 5, now: () => t });
    expect(ledger.phase).toBe('between');
    expect(ledger.begin()).toEqual({ ok: true, take: 5, startedAtMs: 1000 });
    expect(ledger.begin()).toEqual({ ok: false, code: 'already_capturing' });
    ledger.countFrame();
    ledger.countFrame();
    t = 3000;
    const ended = ledger.end('operator');
    expect(ended.ok && ended.record).toMatchObject({ take: 5, frames: 2, endedAtMs: 3000, stopReason: 'operator' });
    expect(ledger.end()).toEqual({ ok: false, code: 'not_capturing' });
    ledger.discard(5);
    expect(ledger.next()).toBe(6);
    expect(ledger.next()).toBe(7);
    expect(ledger.all().map((r) => [r.take, r.stopReason, r.discarded])).toEqual([
      [5, 'operator', true],
      [6, 'next', false],
      [7, null, false],
    ]);
    expect(ledger.discardedCount()).toBe(1);
  });

  it('discarding the open take restarts it instead of retiring it', () => {
    let t = 0;
    const ledger = new TakeLedger({ now: () => t });
    ledger.begin();
    ledger.countFrame();
    t = 500;
    ledger.discard(0);
    expect(ledger.current()).toMatchObject({ take: 0, frames: 0, startedAtMs: 500, discarded: false });
  });

  it('builds the same live shape as the agent path', () => {
    const ledger = new TakeLedger({ now: () => NOW - 1000 });
    ledger.begin();
    ledger.countFrame();
    const live = liveFromLedger(BASE, {
      phase: ledger.phase,
      takes: ledger.all(),
      totalFrames: 1,
      fpsActual: 30,
      degraded: false,
      elapsedS: 1,
    });
    expect(live).toMatchObject({ phase: 'capturing', take: 0, takeFrames: 1, takeElapsedS: 1, kept: 0 });
  });
});
