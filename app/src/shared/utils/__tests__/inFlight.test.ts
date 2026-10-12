/**
 * @file inFlight.test.ts
 * @description createSingleFlight joins concurrent calls and releases the key once settled.
 * @feature shared
 */

import { describe, it, expect, vi } from 'vitest';
import { createSingleFlight } from '../inFlight';

describe('createSingleFlight', () => {
  it('shares one call between concurrent callers with the same key', async () => {
    const flight = createSingleFlight();
    const fn = vi.fn(async () => 42);
    const [a, b] = await Promise.all([flight.run('k', fn), flight.run('k', fn)]);
    expect(a).toBe(42);
    expect(b).toBe(42);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('runs again after the first call settled, and keeps keys apart', async () => {
    const flight = createSingleFlight();
    const fn = vi.fn(async () => 1);
    await flight.run('k', fn);
    await flight.run('k', fn);
    await Promise.all([flight.run('a', fn), flight.run('b', fn)]);
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it('releases the key after a rejection', async () => {
    const flight = createSingleFlight();
    await expect(flight.run('k', () => Promise.reject(new Error('x')))).rejects.toThrow('x');
    await expect(flight.run('k', async () => 'ok')).resolves.toBe('ok');
  });
});
