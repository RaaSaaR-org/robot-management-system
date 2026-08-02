/**
 * @file hardware-pose.test.ts
 * @description The pose seam (TASK-195): the planar base pose is cached on the
 *              EXISTING 2 s `/state` poll — no second timer — published to
 *              subscribers including when it is absent, dropped when the
 *              sidecar goes away, and forced to null by the dev fault switch.
 * @feature hardware
 * @status test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HardwareClient, type CachedBasePose } from '../HardwareClient.js';
import { config } from '../../config/config.js';

interface SidecarScript {
  /** `odometry` group inside the `/state` response (the real-robot ZMQ path). */
  stateOdometry?: unknown;
  /** `/loco/odom` body (the simulator path — its odometry arrives over DDS). */
  locoOdom?: unknown;
  /** Make `/state` reject, as a vanished sidecar does. */
  stateFails?: boolean;
}

function stubSidecar(script: SidecarScript): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const path = String(url);
      if (path.endsWith('/health')) {
        return { ok: true, json: async () => ({ status: 'ok', connected: true }) };
      }
      if (path.endsWith('/state')) {
        if (script.stateFails) throw new Error('sidecar gone');
        return {
          ok: true,
          json: async () => ({
            connected: true,
            joints: [],
            ...(script.stateOdometry === undefined ? {} : { odometry: script.stateOdometry }),
          }),
        };
      }
      if (path.endsWith('/loco/odom')) {
        return { ok: true, json: async () => script.locoOdom ?? { ok: false } };
      }
      throw new Error(`unexpected fetch ${path}`);
    }),
  );
}

/** Boot a client onto the stubbed sidecar and run `ticks` poll intervals. */
async function poll(client: HardwareClient, ticks = 1): Promise<void> {
  await client.init();
  for (let i = 0; i < ticks; i++) await vi.advanceTimersByTimeAsync(2000);
}

describe('HardwareClient — cached base pose', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    config.place.faultNullPose = false;
  });

  it('caches the pose from the odometry group of the /state poll, converting rad → deg', async () => {
    stubSidecar({ stateOdometry: { position: [1.5, -2.5, 0.8], rpy: [0, 0, Math.PI / 2] } });
    const client = new HardwareClient();
    await poll(client);

    const pose = client.getCachedPose();
    expect(pose?.x).toBeCloseTo(1.5, 6);
    expect(pose?.y).toBeCloseTo(-2.5, 6);
    // Degrees above this layer, always: the radians stop at the seam.
    expect(pose?.yawDeg).toBeCloseTo(90, 6);

    client.stopPolling();
  });

  it('falls back to /loco/odom when /state carries no odometry (the simulator path)', async () => {
    stubSidecar({ locoOdom: { ok: true, x: 9, y: 0.25, yaw: 0, source: 'sim' } });
    const client = new HardwareClient();
    await poll(client);

    expect(client.getCachedPose()).toMatchObject({ x: 9, y: 0.25, yawDeg: 0, source: 'sim' });
    client.stopPolling();
  });

  it('publishes the ABSENCE of a pose, not just successes', async () => {
    stubSidecar({ locoOdom: { ok: false } });
    const client = new HardwareClient();
    const samples: Array<CachedBasePose | null> = [];
    client.onPoseSample((p) => samples.push(p));
    await poll(client);

    // A subscriber that only heard about successes would keep the last place
    // forever — the exact bug the honest-null rule exists to prevent.
    expect(samples).toEqual([null]);
    expect(client.getCachedPose()).toBeNull();
    client.stopPolling();
  });

  it('drops the pose when the sidecar goes away', async () => {
    stubSidecar({ locoOdom: { ok: true, x: 3, y: 0, yaw: 0, source: 'sim' } });
    const client = new HardwareClient();
    await poll(client);
    expect(client.getCachedPose()).not.toBeNull();

    stubSidecar({ stateFails: true, locoOdom: { ok: true, x: 3, y: 0, yaw: 0, source: 'sim' } });
    await vi.advanceTimersByTimeAsync(2000);

    expect(client.getCachedPose()).toBeNull();
    client.stopPolling();
  });

  it('PLACE_FAULT_NULL_POSE makes the pose read null while everything else works', async () => {
    config.place.faultNullPose = true;
    stubSidecar({ stateOdometry: { position: [1.5, -2.5, 0.8], rpy: [0, 0, 0] } });
    const client = new HardwareClient();
    await poll(client);

    expect(client.getCachedPose()).toBeNull();
    // The rest of the poll is untouched — this injects a missing POSE, not a
    // missing sidecar, which is the whole reason the switch exists.
    expect(client.isConnected()).toBe(true);
    expect(client.getOdometry()).not.toBeNull();

    client.stopPolling();
  });

  it('adds no second timer — one poll interval, one pose sample', async () => {
    stubSidecar({ locoOdom: { ok: true, x: 1, y: 1, yaw: 0, source: 'sim' } });
    const client = new HardwareClient();
    const samples: Array<CachedBasePose | null> = [];
    client.onPoseSample((p) => samples.push(p));
    await poll(client, 3);

    expect(samples).toHaveLength(3);
    client.stopPolling();
  });
});
