/**
 * @file backoff-poll.test.ts
 * @description The poll loop backs off on consecutive failures up to a cap,
 *              resets on success, and reports only the transitions (TASK-372).
 * @feature robot
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  backoffDelayMs,
  defaultBackoffCapMs,
  describePollTransition,
  startBackoffPoll,
  type BackoffAttempt,
  type BackoffTransition,
} from '../backoff-poll.js';

describe('backoffDelayMs', () => {
  it('doubles per consecutive failure and stops at the cap', () => {
    expect(backoffDelayMs(5_000, 60_000, 0)).toBe(5_000);
    expect(backoffDelayMs(5_000, 60_000, 1)).toBe(10_000);
    expect(backoffDelayMs(5_000, 60_000, 2)).toBe(20_000);
    expect(backoffDelayMs(5_000, 60_000, 3)).toBe(40_000);
    expect(backoffDelayMs(5_000, 60_000, 4)).toBe(60_000);
    expect(backoffDelayMs(5_000, 60_000, 10_000)).toBe(60_000);
  });

  it('never goes below the base when the cap is smaller than it', () => {
    expect(backoffDelayMs(90_000, 60_000, 3)).toBe(90_000);
    expect(defaultBackoffCapMs(5_000)).toBe(300_000);
    expect(defaultBackoffCapMs(600_000)).toBe(600_000);
  });
});

describe('startBackoffPoll', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** A run() that answers from a script, recording when each attempt happened. */
  function scripted(results: boolean[]) {
    const at: number[] = [];
    const run = vi.fn(async (): Promise<BackoffAttempt> => {
      at.push(Date.now());
      const ok = results.length ? results.shift()! : true;
      return ok ? { ok: true } : { ok: false, error: 'HTTP 404' };
    });
    return { run, at };
  }

  it('polls at the base interval while healthy', async () => {
    const { run } = scripted([]);
    const poll = startBackoffPoll({ baseMs: 1_000, run });
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(run).toHaveBeenCalledTimes(4);
    poll.stop();
  });

  it('backs off exponentially on consecutive failures, capped', async () => {
    const start = Date.now();
    const { run, at } = scripted([false, false, false, false, false, false]);
    const poll = startBackoffPoll({ baseMs: 1_000, maxMs: 8_000, run });
    await vi.advanceTimersByTimeAsync(60_000);
    const gaps = at.slice(1, 7).map((t, i) => t - at[i]);
    expect(at[0]).toBe(start);
    // 6 failures: waits of 2, 4, 8, 8, 8 s, then healthy again → 1 s.
    expect(gaps).toEqual([2_000, 4_000, 8_000, 8_000, 8_000, 8_000]);
    poll.stop();
  });

  it('resets to the base interval after a success', async () => {
    const { run, at } = scripted([false, false, true]);
    const poll = startBackoffPoll({ baseMs: 1_000, maxMs: 60_000, run });
    await vi.advanceTimersByTimeAsync(10_000);
    // fail(0) +2s fail(2s) +4s ok(6s) +1s ok(7s) +1s ...
    expect(at.slice(0, 5)).toEqual([0, 2_000, 6_000, 7_000, 8_000].map((d) => at[0] + d));
    expect(poll.failures).toBe(0);
    poll.stop();
  });

  it('reports the failing and recovered transitions once each', async () => {
    const transitions: BackoffTransition[] = [];
    const { run } = scripted([false, false, false, true, true]);
    const poll = startBackoffPoll({ baseMs: 1_000, run, onTransition: (t) => transitions.push(t) });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(transitions).toEqual([
      { kind: 'failing', error: 'HTTP 404', nextDelayMs: 2_000 },
      { kind: 'recovered', failures: 3 },
    ]);
    poll.stop();
  });

  it('treats a rejected run as a failure and keeps polling', async () => {
    const transitions: BackoffTransition[] = [];
    const run = vi.fn(async (): Promise<BackoffAttempt> => {
      throw new Error('boom');
    });
    const poll = startBackoffPoll({ baseMs: 1_000, run, onTransition: (t) => transitions.push(t) });
    await vi.advanceTimersByTimeAsync(7_000);
    expect(run).toHaveBeenCalledTimes(3); // 0, 2 s, 6 s
    expect(transitions).toEqual([{ kind: 'failing', error: 'boom', nextDelayMs: 2_000 }]);
    poll.stop();
  });

  it('stops: no attempt runs after stop()', async () => {
    const { run } = scripted([]);
    const poll = startBackoffPoll({ baseMs: 1_000, run });
    await vi.advanceTimersByTimeAsync(0);
    poll.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('can defer the first attempt by one base interval', async () => {
    const { run } = scripted([]);
    const poll = startBackoffPoll({ baseMs: 1_000, run, immediate: false });
    await vi.advanceTimersByTimeAsync(999);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(1);
    poll.stop();
  });
});

describe('describePollTransition', () => {
  it('names the target, the reason and the next delay', () => {
    expect(
      describePollTransition('FrameRegistration', 'http://s/api/x', {
        kind: 'failing',
        error: 'HTTP 404',
        nextDelayMs: 10_000,
      }),
    ).toBe('[FrameRegistration] http://s/api/x unavailable (HTTP 404) — retrying with backoff, next in 10s');
    expect(describePollTransition('FrameRegistration', 'http://s/api/x', { kind: 'recovered', failures: 4 })).toBe(
      '[FrameRegistration] http://s/api/x reachable again after 4 failed attempt(s)',
    );
  });
});
