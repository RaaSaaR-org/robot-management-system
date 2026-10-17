/**
 * @file datacollectionStore.takes.test.ts
 * @description The store's side of explicit takes (TASK-410): every teleop
 *              event reducer, the guarded actions and their 409 adopt path,
 *              exactly-once cues and toasts across REST and WebSocket, the
 *              legacy progress merge, and the timer selectors with a server
 *              clock offset.
 * @feature datacollection
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  useDataCollectionStore,
  CLIENT_ID,
  selectKept,
  selectServerNowMs,
  selectTakeElapsedS,
  sessionStateSelectors,
} from '../datacollectionStore';
import { dismissToast, getToasts } from '@/shared/components/ui';
import type {
  EpisodeActor,
  LiveState,
  QuickCheck,
  TeleoperationSession,
  TeleopWsEvent,
} from '../../types/datacollection.types';

vi.mock('@/shared/utils/sessionCues', () => ({ playCue: vi.fn() }));
vi.mock('../../api/datacollectionApi', () => ({
  datacollectionApi: {
    listEpisodes: vi.fn().mockResolvedValue([]),
    getLive: vi.fn(),
    startEpisode: vi.fn(),
    stopEpisode: vi.fn(),
    nextEpisodeGuarded: vi.fn(),
    discardLast: vi.fn(),
    discardTake: vi.fn(),
  },
}));

import { playCue } from '@/shared/utils/sessionCues';
import { datacollectionApi } from '../../api/datacollectionApi';

const api = vi.mocked(datacollectionApi);
const cue = vi.mocked(playCue);

const SESSION = { id: 's1', robotId: 'g1', status: 'recording', frameCount: 0 } as TeleoperationSession;

function live(over: Partial<LiveState> = {}): LiveState {
  return {
    sessionId: 's1', status: 'recording', phase: 'between', take: null, takeStartedAt: null, takeElapsedS: null,
    takeFrames: 0, totalFrames: 0, kept: 0, discarded: 0, fpsTarget: 30, fpsActual: 30, degraded: false,
    lastDropReason: null, elapsedS: 10, autoStopS: null, lastTake: null, at: new Date().toISOString(), ...over,
  };
}

function quickCheck(over: Partial<QuickCheck> = {}): QuickCheck {
  return {
    take: 0, frames: 707, durationS: 23.4, droppedFrames: 0, fpsActual: 30,
    jointsMoved: [{ name: 'left_elbow_joint', rangeRad: 0.8 }], groupsMoved: ['left_arm'], warnings: [],
    thumbnailUrl: '/api/teleoperation/sessions/s1/episodes/0/thumbnail', stopReason: 'operator', discarded: false, ...over,
  };
}

const HEADSET: EpisodeActor = { userId: 'u1', displayName: 'Anna', source: 'vr', clientId: 'quest-tab' };
const ANNA_DESKTOP: EpisodeActor = { userId: 'u1', displayName: 'Anna', source: 'desktop', clientId: 'other-tab' };

function event(type: TeleopWsEvent['type'], data: Partial<TeleopWsEvent['data']>): TeleopWsEvent {
  return { type, data: { sessionId: 's1', ...data }, timestamp: Date.now() };
}

const store = () => useDataCollectionStore.getState();

beforeEach(() => {
  vi.clearAllMocks();
  api.listEpisodes.mockResolvedValue([]);
  dismissToast();
  store().reset();
  useDataCollectionStore.setState({ selectedSession: { ...SESSION } });
});

afterEach(() => vi.useRealTimers());

describe('teleop:session:live', () => {
  it('replaces the live state as a whole and takes the server clock offset from `at`', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-17T12:00:00.000Z'));
    store().handleTeleopEvent(event('teleop:session:live', { live: live({ take: 3, kept: 2, at: '2026-10-17T12:00:02.000Z' }) }));
    expect(store().live?.take).toBe(3);
    expect(store().live?.kept).toBe(2);
    expect(store().liveClockOffsetMs).toBe(2000);
  });

  it('ignores the live state of a session that is not on screen', () => {
    store().handleTeleopEvent(event('teleop:session:live', { sessionId: 'other', live: live({ sessionId: 'other', take: 9 }) }));
    expect(store().live).toBeNull();
  });

  it('plays the problem cue once when the link degrades', () => {
    store().handleTeleopEvent(event('teleop:session:live', { live: live() }));
    store().handleTeleopEvent(event('teleop:session:live', { live: live({ degraded: true }) }));
    store().handleTeleopEvent(event('teleop:session:live', { live: live({ degraded: true }) }));
    expect(cue.mock.calls.filter(([c]) => c === 'problem')).toHaveLength(1);
  });
});

describe('teleop:session:progress (legacy)', () => {
  it('merges a partial event instead of wiping frameCount and fpsActual', () => {
    store().handleTeleopEvent(event('teleop:session:progress', {
      recordingProgress: { frameCount: 420, fpsActual: 29.8, currentEpisode: 1, running: true, degraded: false },
    }));
    store().handleTeleopEvent(event('teleop:session:progress', { recordingProgress: { currentEpisode: 2, running: true } }));
    expect(store().recordingProgress).toEqual({ frameCount: 420, fpsActual: 29.8, currentEpisode: 2, running: true, degraded: false });
  });
});

describe('teleop:episode:* from another client', () => {
  it('started: adopts live, refetches takes, plays the cue and says it came from the headset', () => {
    store().handleTeleopEvent(event('teleop:episode:started', {
      take: 4, startedAt: '2026-10-17T12:00:00.000Z', by: HEADSET,
      live: live({ phase: 'capturing', take: 4, takeStartedAt: '2026-10-17T12:00:00.000Z' }),
    }));
    expect(store().live?.phase).toBe('capturing');
    expect(api.listEpisodes).toHaveBeenCalledWith('s1');
    expect(cue).toHaveBeenCalledWith('started');
    expect(getToasts().map((t) => t.title)).toContain('Take 5 started from the headset');
  });

  it('started without a live state (older server): patches the live state optimistically', () => {
    store().handleTeleopEvent(event('teleop:session:live', { live: live({ take: 0 }) }));
    store().handleTeleopEvent(event('teleop:episode:started', { take: 1, startedAt: '2026-10-17T12:00:00.000Z', by: HEADSET }));
    expect(store().live).toMatchObject({ phase: 'capturing', take: 1, takeStartedAt: '2026-10-17T12:00:00.000Z' });
  });

  it('stopped: shows the quick check, and an auto-stop says so', () => {
    const qc = quickCheck({ take: 2, stopReason: 'time_limit' });
    store().handleTeleopEvent(event('teleop:episode:stopped', {
      take: 2, reason: 'time_limit', quickCheck: qc, by: { userId: null, displayName: null, source: 'auto', clientId: null },
      live: live({ take: 2, lastTake: qc }),
    }));
    expect(store().lastQuickCheck).toEqual(qc);
    expect(cue).toHaveBeenCalledWith('stopped');
    const t = getToasts().find((x) => x.title === 'Take 3 stopped automatically');
    expect(t?.description).toBe('The auto-stop time was reached.');
  });

  it('discarded: removes the row and names who discarded it', () => {
    useDataCollectionStore.setState({
      episodes: [
        { episodeIndex: 2, frameCount: 1, startTime: 0, endTime: 1, durationS: 1 },
        { episodeIndex: 3, frameCount: 1, startTime: 0, endTime: 1, durationS: 1 },
      ],
      lastQuickCheck: quickCheck({ take: 3 }),
    });
    store().handleTeleopEvent(event('teleop:episode:discarded', { take: 3, by: ANNA_DESKTOP, live: live({ take: 3, discarded: 1 }) }));
    expect(store().episodes.map((e) => e.episodeIndex)).toEqual([2]);
    expect(store().lastQuickCheck).toBeNull();
    expect(cue).toHaveBeenCalledWith('discarded');
    expect(getToasts().map((t) => t.title)).toContain('Anna discarded take 4');
  });

  it('ignores episode events of a session that is not on screen', () => {
    store().handleTeleopEvent(event('teleop:episode:started', { sessionId: 'other', take: 0, by: HEADSET }));
    expect(cue).not.toHaveBeenCalled();
    expect(getToasts()).toHaveLength(0);
  });
});

describe('take actions', () => {
  it('start sends the take this tab believes is live, its client id and source', async () => {
    store().handleTeleopEvent(event('teleop:session:live', { live: live({ take: 1 }) }));
    api.startEpisode.mockResolvedValue({ ok: true, live: live({ phase: 'capturing', take: 2, takeStartedAt: '2026-10-17T12:00:00.000Z' }) });
    await expect(store().startTake('s1', 'hotkey')).resolves.toBe(true);
    expect(api.startEpisode).toHaveBeenCalledWith('s1', { expectedTake: 1, clientId: CLIENT_ID, source: 'hotkey' });
    expect(store().live?.phase).toBe('capturing');
    expect(store().takePending).toBeNull();
  });

  it('sends expectedTake null before the first take', async () => {
    store().handleTeleopEvent(event('teleop:session:live', { live: live({ take: null }) }));
    api.startEpisode.mockResolvedValue({ ok: true, live: live({ phase: 'capturing', take: 0 }) });
    await store().startTake('s1');
    expect(api.startEpisode).toHaveBeenCalledWith('s1', { expectedTake: null, clientId: CLIENT_ID, source: 'desktop' });
  });

  it('plays the start cue once when the WebSocket echo of its own action follows the REST answer', async () => {
    const started = live({ phase: 'capturing', take: 0, takeStartedAt: '2026-10-17T12:00:00.000Z' });
    api.startEpisode.mockResolvedValue({ ok: true, live: started });
    await store().startTake('s1');
    store().handleTeleopEvent(event('teleop:episode:started', {
      take: 0, startedAt: '2026-10-17T12:00:00.000Z', live: started,
      by: { userId: 'me', displayName: 'Me', source: 'desktop', clientId: CLIENT_ID },
    }));
    expect(cue.mock.calls.filter(([c]) => c === 'started')).toHaveLength(1);
    expect(getToasts()).toHaveLength(0); // its own start needs no toast
  });

  it('stop shows the quick check from the answer', async () => {
    store().handleTeleopEvent(event('teleop:session:live', { live: live({ phase: 'capturing', take: 0 }) }));
    const qc = quickCheck({ take: 0 });
    api.stopEpisode.mockResolvedValue({ ok: true, live: live({ take: 0, lastTake: qc }), quickCheck: qc });
    await store().stopTake('s1');
    expect(store().lastQuickCheck).toEqual(qc);
    expect(cue).toHaveBeenCalledWith('stopped');
  });

  it('a stale expectedTake → 409: adopts the live state and toasts who got there first, no error', async () => {
    store().handleTeleopEvent(event('teleop:session:live', { live: live({ take: 0 }) }));
    // The headset started take 1, but this tab missed the event.
    const serverLive = live({ phase: 'capturing', take: 1, takeStartedAt: '2026-10-17T12:00:00.000Z' });
    store().handleTeleopEvent(event('teleop:episode:started', { sessionId: 'elsewhere', take: 1, by: HEADSET })); // not ours: ignored
    api.startEpisode.mockResolvedValue({ ok: false, code: 'episode_conflict', error: 'stale', live: serverLive });
    await expect(store().startTake('s1')).resolves.toBe(false);
    expect(store().live).toEqual(serverLive);
    expect(store().error).toBeNull();
    expect(getToasts()[0]).toMatchObject({ tone: 'info', title: 'Take 2 was started elsewhere — showing it now' });
  });

  it('409 already_capturing names the headset when this tab saw it start', async () => {
    const capturing = live({ phase: 'capturing', take: 1, takeStartedAt: '2026-10-17T12:00:00.000Z' });
    store().handleTeleopEvent(event('teleop:episode:started', { take: 1, startedAt: capturing.takeStartedAt!, by: HEADSET, live: capturing }));
    dismissToast();
    api.startEpisode.mockResolvedValue({ ok: false, code: 'already_capturing', error: 'busy', live: capturing });
    await store().startTake('s1');
    expect(getToasts()[0]?.title).toBe('Already started from the headset — Take 2 is recording');
  });

  it('refuses a second press while one is in flight', async () => {
    let resolve!: (v: unknown) => void;
    api.startEpisode.mockReturnValue(new Promise((r) => { resolve = r; }) as never);
    const first = store().startTake('s1');
    await expect(store().startTake('s1')).resolves.toBe(false);
    resolve({ ok: true, live: live({ phase: 'capturing', take: 0 }) });
    await expect(first).resolves.toBe(true);
    expect(api.startEpisode).toHaveBeenCalledTimes(1);
  });

  it('discard-last sends the take that was asked for and says who discarded it', async () => {
    useDataCollectionStore.setState({ episodes: [{ episodeIndex: 0, frameCount: 1, startTime: 0, endTime: 1, durationS: 1 }] });
    store().handleTeleopEvent(event('teleop:session:live', { live: live({ take: 0, kept: 1 }) }));
    api.discardLast.mockResolvedValue({ ok: true, live: live({ take: 0, kept: 0, discarded: 1 }), take: 0 });
    await store().discardLastTake('s1', 'hotkey', 0);
    expect(api.discardLast).toHaveBeenCalledWith('s1', { expectedTake: 0, clientId: CLIENT_ID, source: 'hotkey' });
    expect(store().episodes).toEqual([]);
    expect(getToasts().map((t) => t.title)).toContain('You discarded take 1');
  });

  it('discarding the live take restarts it instead', async () => {
    api.discardTake.mockResolvedValue({ ok: true, live: live({ phase: 'capturing', take: 2 }), restarted: true });
    await store().discardTake('s1', 2);
    expect(cue).not.toHaveBeenCalledWith('discarded');
    expect(getToasts()[0]?.title).toBe('Take 3 restarted');
  });

  it('a failed request is an error toast, not a thrown error', async () => {
    api.stopEpisode.mockRejectedValue(new Error('Unable to connect to the server'));
    await expect(store().stopTake('s1')).resolves.toBe(false);
    expect(getToasts()[0]).toMatchObject({ tone: 'error', title: "Couldn't stop the take", description: 'Unable to connect to the server' });
  });
});

describe('session state selectors', () => {
  it('two clients with different local clocks agree on the take time', () => {
    const at = Date.parse('2026-10-17T12:00:10.000Z');
    const shared = live({ phase: 'capturing', take: 0, takeStartedAt: '2026-10-17T12:00:00.000Z', at: new Date(at).toISOString() });
    // Client A's clock is right; client B's runs 3.5 s fast. Both receive the state at server time `at`.
    const a = { live: shared, liveClockOffsetMs: at - at } as never;
    const b = { live: shared, liveClockOffsetMs: at - (at + 3500) } as never;
    const elapsedA = selectTakeElapsedS(selectServerNowMs(a, at + 2000))(a);
    const elapsedB = selectTakeElapsedS(selectServerNowMs(b, at + 3500 + 2000))(b);
    expect(elapsedA).toBeCloseTo(12, 5);
    expect(elapsedB).toBeCloseTo(12, 5);
  });

  it('has no take time between takes', () => {
    expect(selectTakeElapsedS(Date.now())({ live: live({ take: 0 }) })).toBeNull();
  });

  it('counts kept takes from the server, else the listed takes that are not discarded', () => {
    expect(selectKept({ live: live({ kept: 4 }), episodes: [] } as never)).toBe(4);
    expect(selectKept({
      live: null,
      episodes: [{ episodeIndex: 0, discarded: true }, { episodeIndex: 1 }],
    } as never)).toBe(1);
  });

  it('exports one bundle for the VR panel and the robot side', () => {
    expect(Object.keys(sessionStateSelectors).sort()).toEqual(['selectKept', 'selectLive', 'selectServerNowMs', 'selectTakeElapsedS']);
  });
});
