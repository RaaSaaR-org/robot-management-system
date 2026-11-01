/**
 * @file datacollectionStore.presence.test.ts
 * @description The store's side of the two-person session (TASK-414): the
 *              presence and operator reducers (the session on screen only),
 *              the 2 s staleness of the operator, and the take streak fed by
 *              episode events.
 * @feature datacollection
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  useDataCollectionStore,
  OPERATOR_STALE_MS,
  selectOperatorFor,
  selectStreakFor,
  selectViewersFor,
} from '../datacollectionStore';
import type { LiveState, OperatorState, TeleoperationSession, TeleopWsEvent } from '../../types/datacollection.types';

vi.mock('@/shared/utils/sessionCues', () => ({ playCue: vi.fn() }));
vi.mock('../../utils/takeThumbnailCache', () => ({ forgetThumbnail: vi.fn() }));
vi.mock('../../api/datacollectionApi', () => ({
  datacollectionApi: { listEpisodes: vi.fn().mockResolvedValue([]) },
}));

const SESSION = { id: 's1', robotId: 'g1', status: 'recording', frameCount: 0 } as TeleoperationSession;

export const OPERATOR_FIXTURE: OperatorState = {
  inVr: true,
  link: 'live',
  rttMs: 38,
  clutch: { left: false, right: true },
  grip: { left: 0.1, right: 0.9 },
  held: null,
  why: { code: 'following', severity: 'ok', text: 'Following.' },
  head: { p: [0, 0, 0], q: [0, 0, 0, 1] },
  targets: { left: null, right: { p: [0.3, -0.2, -0.3], q: [0, 0, 0, 1] } },
};

const send = (event: Omit<TeleopWsEvent, 'timestamp'>) =>
  useDataCollectionStore.getState().handleTeleopEvent({ ...event, timestamp: Date.now() } as TeleopWsEvent);

describe('two-person session state (TASK-414)', () => {
  beforeEach(() => {
    useDataCollectionStore.getState().reset();
    useDataCollectionStore.setState({ selectedSession: SESSION });
  });

  it('keeps the viewers of the session on screen and ignores other sessions', () => {
    const viewers = [
      { userId: 'u1', displayName: 'Anna', role: 'operator' as const, since: '2026-10-18T10:00:00Z' },
      { userId: 'u2', displayName: 'Ben', role: 'assistant' as const, since: '2026-10-18T10:00:01Z' },
    ];
    send({ type: 'teleop:session:presence', data: { sessionId: 's1', viewers } });
    send({ type: 'teleop:session:presence', data: { sessionId: 'other', viewers: [] } });
    expect(selectViewersFor('s1')(useDataCollectionStore.getState())).toEqual(viewers);
    expect(selectViewersFor('other')(useDataCollectionStore.getState())).toEqual([]);
  });

  it('keeps the operator state with its arrival time; stale after 2 s', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(10_000);
      send({ type: 'teleop:operator', data: { sessionId: 's1', robotId: 'g1', state: OPERATOR_FIXTURE, at: 'x' } });
      const state = useDataCollectionStore.getState();
      expect(state.operator).toMatchObject({ sessionId: 's1', robotId: 'g1', receivedAt: 10_000 });
      expect(selectOperatorFor('s1', 10_000 + OPERATOR_STALE_MS)(state)?.state).toEqual(OPERATOR_FIXTURE);
      expect(selectOperatorFor('s1', 10_001 + OPERATOR_STALE_MS)(state)).toBeNull();
      expect(selectOperatorFor('s2', 10_000)(state)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('drops an operator state of another session', () => {
    send({ type: 'teleop:operator', data: { sessionId: 'other', state: OPERATOR_FIXTURE } });
    expect(useDataCollectionStore.getState().operator).toBeNull();
  });

  it('counts kept takes in a row from the live state, and keeps the best run across a discard', () => {
    const live = (kept: number, discarded: number): LiveState => ({
      sessionId: 's1', status: 'recording', phase: 'between', take: kept + discarded - 1, takeStartedAt: null, takeElapsedS: null,
      takeFrames: 0, totalFrames: 0, kept, discarded, fpsTarget: 30, fpsActual: 30, degraded: false,
      lastDropReason: null, elapsedS: 10, autoStopS: null, lastTake: null, at: new Date().toISOString(),
    });
    const adopt = (kept: number, discarded: number) => send({ type: 'teleop:session:live', data: { sessionId: 's1', live: live(kept, discarded) } });
    adopt(0, 0);
    adopt(1, 0);
    adopt(2, 0);
    adopt(3, 0);
    adopt(3, 0); // the same state again (REST answer + WebSocket echo) counts once
    expect(selectStreakFor('s1')(useDataCollectionStore.getState())).toMatchObject({ current: 3, best: 3 });
    adopt(2, 1);
    expect(selectStreakFor('s1')(useDataCollectionStore.getState())).toMatchObject({ current: 0, best: 2 });
    adopt(3, 1);
    expect(selectStreakFor('s1')(useDataCollectionStore.getState())).toMatchObject({ current: 1, best: 2 });
  });
});
