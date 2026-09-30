/**
 * @file control-lease-sweeper.test.ts
 * @description The expiry sweeper's schedule (TASK-318): ticks every renew
 *              interval, idles while the flag is off, never overlaps, and
 *              never keeps the process alive.
 * @feature robots
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { ControlLeaseSweeper } from '../control-lease-sweeper.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('ControlLeaseSweeper', () => {
  it('sweeps every interval while enabled, and not at all while disabled', async () => {
    vi.useFakeTimers();
    const sweepExpired = vi.fn(async () => 0);
    let enabled = false;
    const sweeper = new ControlLeaseSweeper(() => ({ sweepExpired }), () => enabled, () => 1000);
    sweeper.start();

    await vi.advanceTimersByTimeAsync(3000);
    expect(sweepExpired).not.toHaveBeenCalled();

    enabled = true;
    await vi.advanceTimersByTimeAsync(3000);
    expect(sweepExpired).toHaveBeenCalledTimes(3);

    sweeper.stop();
    await vi.advanceTimersByTimeAsync(3000);
    expect(sweepExpired).toHaveBeenCalledTimes(3);
  });

  it('does not start a sweep while the previous one is still running', async () => {
    let finish: (n: number) => void = () => undefined;
    const sweepExpired = vi.fn(() => new Promise<number>((resolve) => (finish = resolve)));
    const sweeper = new ControlLeaseSweeper(() => ({ sweepExpired }), () => true, () => 1000);
    const first = sweeper.tick();
    expect(await sweeper.tick()).toBe(0);
    finish(2);
    expect(await first).toBe(2);
    expect(sweepExpired).toHaveBeenCalledTimes(1);
  });

  it('survives a failing sweep and unrefs its timer', async () => {
    const sweeper = new ControlLeaseSweeper(
      () => ({ sweepExpired: async () => Promise.reject(new Error('db down')) }),
      () => true,
      () => 1000
    );
    expect(await sweeper.tick()).toBe(0);
    const unref = vi.fn();
    const spy = vi.spyOn(globalThis, 'setInterval').mockReturnValue({ unref } as unknown as NodeJS.Timeout);
    sweeper.start();
    expect(unref).toHaveBeenCalled();
    spy.mockRestore();
    sweeper.stop();
  });
});
