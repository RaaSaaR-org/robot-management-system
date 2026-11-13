/**
 * @file ReadCache.test.ts
 * @description Weight-bounded LRU with TTL and shared in-flight loads (TASK-355)
 * @feature datasets
 */

import { describe, it, expect, vi } from 'vitest';
import { ReadAbandoned, ReadCache } from '../ReadCache.js';

describe('ReadCache', () => {
  it('evicts least recently used entries once the weight budget is exceeded', () => {
    const cache = new ReadCache<string>({ maxWeight: 10, ttlMs: 1000 });
    cache.set('a', 'A', 4);
    cache.set('b', 'B', 4);
    cache.get('a');
    cache.set('c', 'C', 4);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe('A');
    expect(cache.get('c')).toBe('C');
  });

  it('does not store an entry heavier than the whole budget', () => {
    const cache = new ReadCache<string>({ maxWeight: 10, ttlMs: 1000 });
    cache.set('big', 'X', 11);
    expect(cache.size).toBe(0);
  });

  it('expires entries after the TTL', () => {
    let now = 0;
    const cache = new ReadCache<string>({ maxWeight: 10, ttlMs: 100, now: () => now });
    cache.set('a', 'A', 1);
    now = 99;
    expect(cache.get('a')).toBe('A');
    now = 100;
    expect(cache.get('a')).toBeUndefined();
  });

  it('shares one load between concurrent callers and does not cache a failure', async () => {
    const cache = new ReadCache<number>({ maxWeight: 10, ttlMs: 1000 });
    const load = vi.fn(async () => 42);
    const [x, y] = await Promise.all([cache.getOrLoad('k', () => 1, load), cache.getOrLoad('k', () => 1, load)]);
    expect([x, y]).toEqual([42, 42]);
    expect(load).toHaveBeenCalledTimes(1);

    const failing = vi.fn(async () => {
      throw new Error('boom');
    });
    await expect(cache.getOrLoad('f', () => 1, failing)).rejects.toThrow('boom');
    await expect(cache.getOrLoad('f', () => 1, async () => 7)).resolves.toBe(7);
  });

  it('drops every entry under a key prefix and gives their weight back', () => {
    const cache = new ReadCache<string>({ maxWeight: 10, ttlMs: 1000 });
    cache.set('ds-1@5#0', 'a', 3);
    cache.set('ds-1@5#1', 'b', 3);
    cache.set('ds-10@5#0', 'c', 3);
    expect(cache.deletePrefix('ds-1@')).toBe(2);
    expect(cache.size).toBe(1);
    expect(cache.totalWeight).toBe(3);
    expect(cache.get('ds-10@5#0')).toBe('c');
  });

  it('answers the callers of a load that was invalidated midway, but does not keep its result', async () => {
    const cache = new ReadCache<number>({ maxWeight: 10, ttlMs: 1000 });
    let finish!: (value: number) => void;
    const stale = cache.getOrLoad('ds@1#0', () => 1, () => new Promise<number>((resolve) => (finish = resolve)));
    cache.deletePrefix('ds@');
    // A caller arriving after the invalidation starts a load of its own.
    const fresh = cache.getOrLoad('ds@1#0', () => 1, async () => 2);
    finish(1);
    expect(await stale).toBe(1);
    expect(await fresh).toBe(2);
    expect(cache.get('ds@1#0')).toBe(2);
  });
});

describe('ReadCache — a load is work for whoever waits for it (TASK-492)', () => {
  const weigh = () => 1;
  /** A load the test finishes by hand, that records whether it was told to stop. */
  function heldLoad() {
    let finish!: (value: string) => void;
    let stop: AbortSignal | undefined;
    const load = vi.fn((signal: AbortSignal) => {
      stop = signal;
      return new Promise<string>((resolve, reject) => {
        finish = resolve;
        signal.addEventListener('abort', () => reject(new ReadAbandoned()));
      });
    });
    return { load, finish: (value: string) => finish(value), stopped: () => stop?.aborted ?? false };
  }

  it('rejects a caller that leaves and tells the load to stop when it was the only one', async () => {
    const cache = new ReadCache<string>({ maxWeight: 10, ttlMs: 1000 });
    const held = heldLoad();
    const viewer = new AbortController();
    const answer = cache.getOrLoad('ep', weigh, held.load, viewer.signal);
    expect(held.stopped()).toBe(false);

    viewer.abort();
    await expect(answer).rejects.toBeInstanceOf(ReadAbandoned);
    expect(held.stopped()).toBe(true);
    expect(cache.get('ep')).toBeUndefined();
  });

  it('keeps the load running for a second caller that is still waiting', async () => {
    const cache = new ReadCache<string>({ maxWeight: 10, ttlMs: 1000 });
    const held = heldLoad();
    const first = new AbortController();
    const second = new AbortController();
    const left = cache.getOrLoad('ep', weigh, held.load, first.signal);
    const stays = cache.getOrLoad('ep', weigh, held.load, second.signal);

    first.abort();
    await expect(left).rejects.toBeInstanceOf(ReadAbandoned);
    expect(held.stopped()).toBe(false);

    held.finish('frames');
    expect(await stays).toBe('frames');
    expect(held.load).toHaveBeenCalledTimes(1);
    expect(cache.get('ep')).toBe('frames');
  });

  it('never stops a load a caller without a signal is waiting for', async () => {
    const cache = new ReadCache<string>({ maxWeight: 10, ttlMs: 1000 });
    const held = heldLoad();
    const viewer = new AbortController();
    const patient = cache.getOrLoad('ep', weigh, held.load);
    const impatient = cache.getOrLoad('ep', weigh, held.load, viewer.signal);
    viewer.abort();
    await expect(impatient).rejects.toBeInstanceOf(ReadAbandoned);
    expect(held.stopped()).toBe(false);
    held.finish('frames');
    expect(await patient).toBe('frames');
  });

  it('starts a new load for the next caller instead of joining one that was stopped', async () => {
    const cache = new ReadCache<string>({ maxWeight: 10, ttlMs: 1000 });
    const abandoned = heldLoad();
    const viewer = new AbortController();
    const gone = cache.getOrLoad('ep', weigh, abandoned.load, viewer.signal);
    viewer.abort();
    await expect(gone).rejects.toBeInstanceOf(ReadAbandoned);

    const again = heldLoad();
    const back = cache.getOrLoad('ep', weigh, again.load, new AbortController().signal);
    expect(again.load).toHaveBeenCalledTimes(1);
    again.finish('frames');
    expect(await back).toBe('frames');
    expect(cache.get('ep')).toBe('frames');
  });

  it('does not start a load for a caller that has already left, and still answers it from the cache', async () => {
    const cache = new ReadCache<string>({ maxWeight: 10, ttlMs: 1000 });
    const viewer = new AbortController();
    viewer.abort();
    const load = vi.fn(async () => 'frames');
    await expect(cache.getOrLoad('ep', weigh, load, viewer.signal)).rejects.toBeInstanceOf(ReadAbandoned);
    expect(load).not.toHaveBeenCalled();
    cache.set('ep', 'kept', 1);
    expect(await cache.getOrLoad('ep', weigh, load, viewer.signal)).toBe('kept');
  });
});
