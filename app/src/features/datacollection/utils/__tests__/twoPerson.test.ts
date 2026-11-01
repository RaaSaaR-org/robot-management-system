/**
 * @file twoPerson.test.ts
 * @description The pure parts of the two-person session (TASK-414): the take
 *              streak, the session summary, presence labels and the operator
 *              cues (chime, link lost, block during a take for more than 1 s).
 * @feature datacollection
 */

import { describe, it, expect } from 'vitest';
import { nextStreak, sessionSummary, streakFromLive, streakLabel, type TakeStreak } from '../takeStreak';
import { viewerInitials, viewerLabel, watchingLabel } from '../presenceFormat';
import { INITIAL_OPERATOR_CUE_MEMORY, operatorCues } from '../operatorCues';
import type { OperatorState, PresenceViewer } from '../../types/datacollection.types';

describe('takeStreak', () => {
  it('grows on a kept take, takes back a discarded one, and starts over for another session', () => {
    let s: TakeStreak | null = null;
    for (let i = 0; i < 5; i++) s = nextStreak(s, 's1', 'kept');
    expect(s).toMatchObject({ current: 5, best: 5 });
    s = nextStreak(s, 's1', 'discarded');
    expect(s).toMatchObject({ current: 0, best: 4 });
    s = nextStreak(s, 's1', 'kept');
    expect(s).toMatchObject({ current: 1, best: 4 });
    s = nextStreak(s, 's1', 'broken');
    expect(s).toMatchObject({ current: 0, best: 4 });
    expect(nextStreak(s, 's2', 'kept')).toMatchObject({ sessionId: 's2', current: 1, best: 1 });
  });

  it('follows the live counts: a baseline first, kept rises, a discard of a kept take, stale states ignored', () => {
    const at = (kept: number, discarded: number) => ({ sessionId: 's1', kept, discarded });
    let s = streakFromLive(null, at(4, 0));
    expect(s).toMatchObject({ current: 0, best: 0 });
    s = streakFromLive(s, at(5, 0));
    s = streakFromLive(s, at(5, 0)); // the same state twice counts once
    s = streakFromLive(s, at(4, 0)); // an older state answered late is ignored
    s = streakFromLive(s, at(6, 0));
    expect(s).toMatchObject({ current: 2, best: 2 });
    s = streakFromLive(s, at(5, 1)); // discard the last kept take
    expect(s).toMatchObject({ current: 0, best: 1 });
    s = streakFromLive(s, at(6, 1)); // the next take is kept
    expect(s).toMatchObject({ current: 1, best: 1 });
    s = streakFromLive(s, at(6, 2)); // a restart: never kept, nothing taken back
    expect(s).toMatchObject({ current: 0, best: 1 });
  });

  it('labels a streak from two, and sums up a session', () => {
    expect(streakLabel(1)).toBeNull();
    expect(streakLabel(5)).toBe('5 kept in a row');
    expect(sessionSummary(4, 450, 3)).toBe('4 takes kept · 7.5 min · best streak 3');
    expect(sessionSummary(9, 750, 3)).toBe('9 takes kept · 13 min · best streak 3');
    expect(sessionSummary(1, 30, 1)).toBe('1 take kept · 0.5 min · best streak 1');
  });
});

describe('presenceFormat', () => {
  const v = (displayName: string, role: PresenceViewer['role']): PresenceViewer => ({ userId: displayName, displayName, role, since: '' });
  it('names viewers by place and the desktop watchers for the headset', () => {
    expect(viewerLabel(v('Anna', 'operator'))).toBe('Anna · headset');
    expect(viewerLabel(v('Ben', 'assistant'))).toBe('Ben · desktop');
    expect(viewerInitials('Anna Berg')).toBe('AB');
    expect(viewerInitials('ben')).toBe('B');
    expect(watchingLabel([v('Anna', 'operator')])).toBeNull();
    expect(watchingLabel([v('Anna', 'operator'), v('Ben', 'assistant')])).toBe('Ben (desktop)');
    expect(watchingLabel([v('Ben', 'assistant'), v('Cleo', 'assistant')])).toBe('Ben (desktop) +1');
  });
});

describe('operatorCues', () => {
  const op = (over: Partial<OperatorState> = {}): OperatorState => ({
    inVr: true, link: 'live', rttMs: 30, clutch: { left: false, right: false }, grip: { left: 0, right: 0 },
    held: null, why: { code: 'following', severity: 'ok', text: 'Following.' }, head: null,
    targets: { left: null, right: null }, ...over,
  });
  const block = { code: 'estop_latched', severity: 'block' as const, text: 'E-stop is latched. Reset it.' };

  it('chimes once when the operator enters VR', () => {
    let r = operatorCues(INITIAL_OPERATOR_CUE_MEMORY, op({ inVr: false }), false, 0);
    expect(r.cues).toEqual([]);
    r = operatorCues(r.memory, op(), false, 100);
    expect(r.cues).toEqual(['joined']);
    r = operatorCues(r.memory, op(), false, 200);
    expect(r.cues).toEqual([]);
  });

  it('sounds when the link turns lost, not when it starts lost', () => {
    let r = operatorCues(INITIAL_OPERATOR_CUE_MEMORY, op({ inVr: false, link: 'lost' }), false, 0);
    expect(r.cues).toEqual([]);
    r = operatorCues(r.memory, op({ inVr: false, link: 'live' }), false, 100);
    r = operatorCues(r.memory, op({ inVr: false, link: 'lost' }), false, 200);
    expect(r.cues).toEqual(['linkLost']);
  });

  it('sounds the double low tone once a block lasts past 1 s during a take only', () => {
    let r = operatorCues({ ...INITIAL_OPERATOR_CUE_MEMORY, inVr: true, link: 'live' }, op({ why: block }), true, 0);
    expect(r.cues).toEqual([]);
    r = operatorCues(r.memory, op({ why: block }), true, 900);
    expect(r.cues).toEqual([]);
    r = operatorCues(r.memory, op({ why: block }), true, 1_100);
    expect(r.cues).toEqual(['problem']);
    r = operatorCues(r.memory, op({ why: block }), true, 3_000);
    expect(r.cues).toEqual([]);
    // Between takes a block is silent.
    let idle = operatorCues({ ...INITIAL_OPERATOR_CUE_MEMORY, inVr: true, link: 'live' }, op({ why: block }), false, 0);
    idle = operatorCues(idle.memory, op({ why: block }), false, 2_000);
    expect(idle.cues).toEqual([]);
  });
});
