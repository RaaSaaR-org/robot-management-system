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
});
