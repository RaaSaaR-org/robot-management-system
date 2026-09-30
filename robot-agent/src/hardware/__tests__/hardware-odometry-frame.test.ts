/**
 * @file hardware-odometry-frame.test.ts
 * @description Which frame the sidecar's poses live in (TASK-207, TASK-342): a
 *              sim's world, or odometry keyed by boot id — including a sim run
 *              with `--odom-origin boot`, which must read as real odometry.
 * @feature hardware
 * @status test
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { HardwareClient } from '../HardwareClient.js';

function stubHealth(health: Record<string, unknown>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (String(url).endsWith('/health')) return { ok: true, json: async () => ({ status: 'ok', connected: true, ...health }) };
      throw new Error('unreachable in this test');
    }),
  );
}

async function frameFor(health: Record<string, unknown>) {
  stubHealth(health);
  const client = new HardwareClient();
  await client.init();
  client.stopPolling();
  return client.getOdometryFrame();
}

describe('HardwareClient.getOdometryFrame', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('a sim reports its MJCF world, keyed by scene', async () => {
    expect(await frameFor({ sim: true, scene: 'warehouse.xml', boot_id: 'b1' })).toEqual({
      kind: 'sim',
      id: 'warehouse.xml',
    });
    expect(await frameFor({ sim: true, scene: 'warehouse.xml', boot_id: 'b1', odom_frame: 'world' })).toEqual({
      kind: 'sim',
      id: 'warehouse.xml',
    });
  });

  it('a sim with boot-origin odometry reads as real odometry, keyed by boot id', async () => {
    expect(await frameFor({ sim: true, scene: 'warehouse.xml', boot_id: 'b1', odom_frame: 'boot' })).toEqual({
      kind: 'odom',
      id: 'b1',
    });
  });

  it('a real sidecar is odometry keyed by boot id, and nothing without one', async () => {
    expect(await frameFor({ boot_id: 'b2' })).toEqual({ kind: 'odom', id: 'b2' });
    expect(await frameFor({})).toBeNull();
  });
});
