/**
 * @file ReadCache.test.ts
 * @description Weight-bounded LRU with TTL and shared in-flight loads (TASK-355)
 * @feature datasets
 */

import { describe, it, expect, vi } from 'vitest';
import { ReadCache } from '../ReadCache.js';

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
});
