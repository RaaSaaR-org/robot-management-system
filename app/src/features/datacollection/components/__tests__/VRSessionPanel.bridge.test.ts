/**
 * @file VRSessionPanel.bridge.test.ts
 * @description TASK-413: the headset's bridge over the data-collection store —
 *              every action goes out with `source: 'vr'`, a 409 is adopted and
 *              answers `refused` with an info toast (never an error), the view
 *              follows the shared live state, and a recorder without explicit
 *              takes keeps its old boundary.
 * @feature datacollection
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useDataCollectionStore } from '../../store/datacollectionStore';
import { dismissToast, getToasts } from '@/shared/components/ui';
import type { LiveState, QuickCheck, TeleoperationSession } from '../../types/datacollection.types';

vi.mock('@/shared/utils/sessionCues', () => ({ playCue: vi.fn() }));
vi.mock('../../utils/takeThumbnailCache', () => ({ forgetThumbnail: vi.fn() }));
vi.mock('../../api/datacollectionApi', () => ({
  datacollectionApi: {
    listEpisodes: vi.fn().mockResolvedValue([]),
    getLive: vi.fn(),
    startEpisode: vi.fn(),
    stopEpisode: vi.fn(),
    nextEpisodeGuarded: vi.fn(),
    nextEpisode: vi.fn(),
    discardLast: vi.fn(),
    discardTake: vi.fn(),
  },
}));
// The panel module pulls in the VR section; the bridge needs none of it.
vi.mock('../../../robots/components/tabs/vr/VRTeleopSection', () => ({ VRTeleopSection: () => null }));
vi.mock('../../../robots/components/tabs/TeleopTab', () => ({ KeyboardTeleopSection: () => null }));

import { datacollectionApi } from '../../api/datacollectionApi';
import { createVrSessionBridge } from '../VRSessionPanel';

const api = vi.mocked(datacollectionApi);
const SESSION = { id: 's1', robotId: 'g1', status: 'recording', frameCount: 0 } as TeleoperationSession;

function live(over: Partial<LiveState> = {}): LiveState {
  return {
    sessionId: 's1', status: 'recording', phase: 'between', take: null, takeStartedAt: null, takeElapsedS: null,
    takeFrames: 0, totalFrames: 0, kept: 0, discarded: 0, fpsTarget: 30, fpsActual: 30, degraded: false,
    lastDropReason: null, elapsedS: 10, autoStopS: null, lastTake: null, at: new Date().toISOString(), ...over,
  };
}

const quickCheck = (over: Partial<QuickCheck> = {}): QuickCheck => ({
  take: 0, frames: 707, durationS: 23.4, droppedFrames: 0, fpsActual: 30,
  jointsMoved: [], groupsMoved: ['left_arm', 'right_hand'], warnings: [],
  thumbnailUrl: null, stopReason: 'operator', discarded: false, ...over,
});

const store = () => useDataCollectionStore.getState();

beforeEach(() => {
  vi.clearAllMocks();
  api.listEpisodes.mockResolvedValue([]);
  dismissToast();
  store().reset();
  useDataCollectionStore.setState({ selectedSession: { ...SESSION }, live: live() });
});

describe('createVrSessionBridge', () => {
  it('starts a take as the headset and shows ● REC Take 1 from the adopted live state', async () => {
    api.startEpisode.mockResolvedValue({
      ok: true,
      live: live({ phase: 'capturing', take: 0, takeStartedAt: new Date().toISOString() }),
    });
    const bridge = createVrSessionBridge('s1');
    expect(await bridge.actions.start()).toBe('ok');
    expect(api.startEpisode).toHaveBeenCalledWith('s1', expect.objectContaining({ source: 'vr', expectedTake: null }));
    const view = bridge.getState();
    expect(view.phase).toBe('capturing');
    expect(view.take).toBe(0);
  });

  it('stops a take and carries its quick check in the operator\'s words', async () => {
    useDataCollectionStore.setState({ live: live({ phase: 'capturing', take: 0 }) });
    const qc = quickCheck();
    api.stopEpisode.mockResolvedValue({ ok: true, live: live({ take: 0, kept: 1, lastTake: qc }), quickCheck: qc });
    const bridge = createVrSessionBridge('s1');
    expect(await bridge.actions.stop()).toBe('ok');
    expect(api.stopEpisode).toHaveBeenCalledWith('s1', expect.objectContaining({ source: 'vr', expectedTake: 0 }));
    expect(bridge.getState().lastQuickCheck).toEqual({
      takeNumber: 1, durationS: 23.4, frames: 707, groups: ['L arm', 'R hand'], warnings: [],
    });
    expect(bridge.getState().kept).toBe(1);
  });

  it('a 409 from a stale press adopts the server state and answers refused — an info toast, no error', async () => {
    const serverLive = live({ phase: 'capturing', take: 3, kept: 3 });
    api.startEpisode.mockResolvedValue({ ok: false, code: 'already_capturing', error: 'busy', live: serverLive });
    const bridge = createVrSessionBridge('s1');
    expect(await bridge.actions.start()).toBe('refused');
    expect(bridge.getState()).toMatchObject({ phase: 'capturing', take: 3, kept: 3 });
    const toasts = getToasts();
    expect(toasts.some((t) => t.tone === 'error')).toBe(false);
    expect(toasts.some((t) => t.tone === 'info')).toBe(true);
  });

  it('discards the last take pinned to the take it saw', async () => {
    useDataCollectionStore.setState({ live: live({ phase: 'capturing', take: 1, kept: 1 }) });
    api.discardLast.mockResolvedValue({ ok: true, live: live({ take: 1, kept: 1, discarded: 1 }), take: 1 });
    const bridge = createVrSessionBridge('s1');
    expect(await bridge.actions.discardLast()).toBe('ok');
    expect(api.discardLast).toHaveBeenCalledWith('s1', expect.objectContaining({ source: 'vr', expectedTake: 1 }));
    expect(bridge.getState()).toMatchObject({ kept: 1, discarded: 1 });
  });

  it('refuses everything for a session that is no longer on screen', async () => {
    useDataCollectionStore.setState({ selectedSession: { ...SESSION, id: 'other' } });
    const bridge = createVrSessionBridge('s1');
    expect(await bridge.actions.start()).toBe('refused');
    expect(api.startEpisode).not.toHaveBeenCalled();
  });

  it('keeps the old boundary on a recorder without explicit takes', async () => {
    useDataCollectionStore.setState({ live: live({ phase: null, take: 2 }) });
    api.nextEpisode.mockResolvedValue(3);
    const bridge = createVrSessionBridge('s1');
    expect(await bridge.actions.start()).toBe('ok');
    expect(api.nextEpisode).toHaveBeenCalledWith('s1');
    expect(await bridge.actions.stop()).toBe('refused');
    expect(api.startEpisode).not.toHaveBeenCalled();
  });

  it('names who watches from a desktop, for the robot panel title (TASK-414)', () => {
    useDataCollectionStore.setState({ selectedSession: SESSION, presence: null });
    const bridge = createVrSessionBridge('s1');
    expect(bridge.sessionId).toBe('s1');
    expect(bridge.watching?.()).toBeNull();
    useDataCollectionStore.setState({
      presence: {
        sessionId: 's1',
        viewers: [
          { userId: 'u1', displayName: 'Anna', role: 'operator', since: '' },
          { userId: 'u2', displayName: 'Ben', role: 'assistant', since: '' },
        ],
      },
    });
    expect(bridge.watching?.()).toBe('Ben (desktop)');
  });

  it('carries the task, and names the desktop that ended it after presence empties (TASK-418)', () => {
    useDataCollectionStore.setState({
      selectedSession: { ...SESSION, languageInstr: 'pick up the red cube' },
      presence: {
        sessionId: 's1',
        viewers: [
          { userId: 'a', displayName: 'Anna', role: 'operator', since: 'x' },
          { userId: 'b', displayName: 'Ben', role: 'assistant', since: 'x' },
        ],
      },
    });
    const bridge = createVrSessionBridge('s1');
    expect(bridge.getState()).toMatchObject({ instruction: 'pick up the red cube', endedBy: null });
    // The end: presence leaves with the session, the count is final.
    useDataCollectionStore.setState({
      selectedSession: { ...SESSION, status: 'completed', frameCount: 1523, languageInstr: 'pick up the red cube' },
      live: live({ status: 'completed', phase: null, kept: 9 }),
      presence: { sessionId: 's1', viewers: [] },
    });
    const ended = bridge.getState();
    expect(ended).toMatchObject({ status: 'completed', endedBy: 'Ben', sessionFrames: 1523, kept: 9 });
  });

  it('keeps the final frame count when the last live state after the end reads 0 (TASK-418)', () => {
    useDataCollectionStore.setState({ selectedSession: { ...SESSION, status: 'completed', frameCount: 1523 } });
    store().handleTeleopEvent({
      type: 'teleop:session:progress',
      data: { sessionId: 's1', recordingProgress: { frameCount: 0 } },
    } as Parameters<ReturnType<typeof store>['handleTeleopEvent']>[0]);
    expect(store().selectedSession?.frameCount).toBe(1523);
    useDataCollectionStore.setState({ selectedSession: { ...SESSION, status: 'recording', frameCount: 10 } });
    store().handleTeleopEvent({
      type: 'teleop:session:progress',
      data: { sessionId: 's1', recordingProgress: { frameCount: 42 } },
    } as Parameters<ReturnType<typeof store>['handleTeleopEvent']>[0]);
    expect(store().selectedSession?.frameCount).toBe(42);
  });
});
