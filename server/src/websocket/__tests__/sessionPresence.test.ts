/**
 * @file sessionPresence.test.ts
 * @description Unit tests for session presence (join, leave, timeout), the
 *   operator state's validation and the relay's 5 Hz trailing throttle (TASK-414).
 * @feature datacollection
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  OperatorRelay,
  PRESENCE_TTL_MS,
  SessionPresence,
  cleanDisplayName,
  parseOperatorState,
} from '../sessionPresence.js';

const anna = { userId: 'u1', displayName: 'Anna', role: 'operator' as const };
const ben = { userId: 'u2', displayName: 'Ben', role: 'assistant' as const };

describe('SessionPresence', () => {
  it('lists watchers oldest first, and reports a join as a change', () => {
    const p = new SessionPresence<object>();
    const a = {};
    const b = {};
    expect(p.watch(a, 's1', anna, 1_000)).toBe(true);
    expect(p.watch(b, 's1', ben, 2_000)).toBe(true);
    expect(p.viewers('s1').map((v) => `${v.displayName}:${v.role}`)).toEqual(['Anna:operator', 'Ben:assistant']);
    expect(p.viewers('s1')[0].since).toBe(new Date(1_000).toISOString());
    expect(p.isOperator(a, 's1')).toBe(true);
    expect(p.isOperator(b, 's1')).toBe(false);
    expect(p.hasOperator('s1')).toBe(true);
  });

  it('a heartbeat refreshes without a change; a role switch is a change', () => {
    const p = new SessionPresence<object>();
    const a = {};
    p.watch(a, 's1', ben, 0);
    expect(p.watch(a, 's1', ben, 10_000)).toBe(false);
    expect(p.watch(a, 's1', { ...ben, role: 'operator' }, 11_000)).toBe(true);
    expect(p.isOperator(a, 's1')).toBe(true);
  });

  it('unwatch and a closed socket leave; sessions without watchers disappear', () => {
    const p = new SessionPresence<object>();
    const a = {};
    const b = {};
    p.watch(a, 's1', anna, 0);
    p.watch(a, 's2', anna, 0);
    p.watch(b, 's1', ben, 0);
    expect(p.unwatch(b, 's1')).toBe(true);
    expect(p.unwatch(b, 's1')).toBe(false);
    expect(p.dropSocket(a).sort()).toEqual(['s1', 's2']);
    expect(p.sessionIds()).toEqual([]);
  });

  it('times out a silent watcher after the TTL only', () => {
    const p = new SessionPresence<object>();
    const a = {};
    const b = {};
    p.watch(a, 's1', anna, 0);
    p.watch(b, 's1', ben, 0);
    p.watch(b, 's1', ben, 10_000);
    expect(p.sweep(PRESENCE_TTL_MS)).toEqual([]);
    expect(p.sweep(PRESENCE_TTL_MS + 1)).toEqual(['s1']);
    expect(p.viewers('s1').map((v) => v.displayName)).toEqual(['Ben']);
    expect(PRESENCE_TTL_MS).toBeLessThan(25_000);
  });
});

describe('cleanDisplayName', () => {
  it('trims, strips control characters, caps, and falls back', () => {
    expect(cleanDisplayName('  Anna\u0007 ', 'u1')).toBe('Anna');
    expect(cleanDisplayName('x'.repeat(80), 'u1')).toHaveLength(40);
    expect(cleanDisplayName('', 'u1')).toBe('u1');
    expect(cleanDisplayName(42, 'u1')).toBe('u1');
  });
});

describe('parseOperatorState', () => {
  const state = {
    inVr: true, link: 'stale', rttMs: null,
    clutch: { left: true, right: false }, grip: { left: 1, right: 0 },
    held: { side: 'left', reason: 'arm_gate' },
    why: { code: 'arm_refused', severity: 'block', text: "Arm refused by the robot's arm gate." },
    head: null,
    targets: { left: { p: [0.3, 0.2, -0.3], q: [0, 0, 0, 1] }, right: null },
  };

  it('accepts a full state and drops unknown keys', () => {
    const check = parseOperatorState({ ...state, extra: 1, why: { ...state.why, more: 2 } });
    expect(check.ok).toBe(true);
    if (check.ok) {
      expect(check.state).toEqual(state);
    }
  });

  it('rejects over 2 KB before parsing', () => {
    expect(parseOperatorState({ ...state, pad: 'x'.repeat(2048) })).toEqual({ ok: false, error: 'too_large' });
  });

  it('rejects a wrong shape: grip out of range, a non-finite target, a missing field', () => {
    expect(parseOperatorState({ ...state, grip: { left: 2, right: 0 } }).ok).toBe(false);
    expect(parseOperatorState({ ...state, targets: { left: { p: [NaN, 0, 0], q: [0, 0, 0, 1] }, right: null } }).ok).toBe(false);
    const { why: _why, ...noWhy } = state;
    expect(parseOperatorState(noWhy).ok).toBe(false);
    expect(parseOperatorState(null).ok).toBe(false);
  });
});

describe('OperatorRelay', () => {
  afterEach(() => vi.useRealTimers());

  it('sends the first at once, then at most one per 200 ms, trailing with the latest', () => {
    vi.useFakeTimers();
    const sent: number[] = [];
    const relay = new OperatorRelay<number>((_s, v) => sent.push(v), 200, () => Date.now());
    relay.offer('s1', 1);
    relay.offer('s1', 2);
    relay.offer('s1', 3);
    expect(sent).toEqual([1]);
    vi.advanceTimersByTime(199);
    expect(sent).toEqual([1]);
    vi.advanceTimersByTime(1);
    expect(sent).toEqual([1, 3]);
    vi.advanceTimersByTime(500);
    relay.offer('s1', 4);
    expect(sent).toEqual([1, 3, 4]);
  });

  it('throttles each session on its own, and forget drops a waiting state', () => {
    vi.useFakeTimers();
    const sent: string[] = [];
    const relay = new OperatorRelay<string>((s, v) => sent.push(`${s}:${v}`), 200, () => Date.now());
    relay.offer('s1', 'a');
    relay.offer('s2', 'b');
    relay.offer('s1', 'c');
    relay.forget('s1');
    vi.advanceTimersByTime(300);
    expect(sent).toEqual(['s1:a', 's2:b']);
  });
});
