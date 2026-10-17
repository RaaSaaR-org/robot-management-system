/**
 * @file hardware-reachability.test.ts
 * @description TASK-405: the HardwareClient tells "the sidecar answers" apart
 *              from "its lowstate is fresh", survives ONE slow poll without
 *              tearing anything down, notices a dead sidecar within two poll
 *              periods, reconnects within 5 s of it coming back (backoff
 *              1 → 2 → 4 → 5 s), and keeps the last IMU/base values flagged
 *              stale in between. The sidecar is a fetch test double that can be
 *              killed and revived; time is fake.
 * @feature hardware
 * @status test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  HardwareClient,
  POLL_INTERVAL_MS,
  RECONNECT_MAX_MS,
  reconnectDelayMs,
} from '../HardwareClient.js';

const IMU = { rpy: [0.01, 0.02, 0.03], gyro: [0, 0, 0], accel: [0, 0, 9.8] };

/** A sidecar double: `alive=false` refuses every connection, `slowState` fails only `/state`. */
const sidecar = {
  alive: true,
  slowStateOnce: false,
  stateCalls: 0,
  healthCalls: 0,
};

function installSidecar(): void {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const path = new URL(String(url)).pathname;
    if (!sidecar.alive) throw new TypeError('fetch failed: ECONNREFUSED');
    if (path === '/health') {
      sidecar.healthCalls += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: 'ok', connected: true, boot_id: 'boot-1', lowstate_age_s: 0.01,
          loco: { gate: 'fsm' }, base: { mode: 'balance', fsm_id: 801, age_s: 0.1 },
        }),
      };
    }
    if (path === '/state') {
      sidecar.stateCalls += 1;
      if (sidecar.slowStateOnce) {
        sidecar.slowStateOnce = false;
        throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          connected: true, joints: [], imu: IMU,
          base: { mode: 'balance', fsm_id: 801, age_s: 0.1 },
          odometry: { position: [1, 2, 0], rpy: [0, 0, 0.5] },
        }),
      };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  }));
}

/** Advance fake time in small steps until `cond` holds; returns the ms it took (or Infinity). */
async function msUntil(cond: () => boolean, limitMs: number, stepMs = 50): Promise<number> {
  for (let t = 0; t <= limitMs; t += stepMs) {
    if (cond()) return t;
    await vi.advanceTimersByTimeAsync(stepMs);
  }
  return cond() ? limitMs : Infinity;
}

let client: HardwareClient;

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  sidecar.alive = true;
  sidecar.slowStateOnce = false;
  sidecar.stateCalls = 0;
  sidecar.healthCalls = 0;
  installSidecar();
  client = new HardwareClient();
});

afterEach(() => {
  client.stopPolling();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('HardwareClient reachability (TASK-405)', () => {
  it('reads /health into lastHealth and splits reachable from connected', async () => {
    expect(await client.init()).toBe(true);
    expect(client.isSidecarReachable()).toBe(true);
    expect(client.isConnected()).toBe(true);
    expect(client.lastHealth()).toMatchObject({ ok: true, connected: true, bootId: 'boot-1', lowstateAgeS: 0.01 });
    expect(typeof client.lastHealthAt).toBe('number');
  });

  it('one failed poll tears nothing down', async () => {
    await client.init();
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(client.getImu()).toEqual(IMU);

    sidecar.slowStateOnce = true;
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS + 500);

    expect(client.isSidecarReachable()).toBe(true);
    expect(client.getImu()).toEqual(IMU);
    expect(client.getBaseState()?.mode).toBe('balance');
    expect(client.getCachedPose()).not.toBeNull();
    expect(client.getLastKnownSensors().stale).toBe(false);
  });

  it('a killed sidecar is unreachable within two poll periods, keeps its last values stale, and is back within 5 s of reviving', async () => {
    await client.init();
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(client.getImu()).toEqual(IMU);

    // Kill it.
    sidecar.alive = false;
    const lostAfter = await msUntil(() => !client.isSidecarReachable(), 3 * POLL_INTERVAL_MS);
    expect(lostAfter).toBeLessThanOrEqual(2 * POLL_INTERVAL_MS);
    expect(client.isConnected()).toBe(false);

    // In between: the last values are kept and flagged stale; the live getters
    // do not hand them to telemetry or safety.
    const last = client.getLastKnownSensors();
    expect(last.stale).toBe(true);
    expect(last.imu).toEqual(IMU);
    expect(last.base?.mode).toBe('balance');
    expect(last.atMs).not.toBeNull();
    expect(client.getImu()).toBeNull();
    expect(client.getBaseState()).toBeNull();
    expect(client.getMeasuredFsmId()).toBeNull();
    expect(client.getCachedPose()).toBeNull();

    // Stay dead long enough for the backoff to reach its cap.
    await vi.advanceTimersByTimeAsync(20_000);
    expect(client.isSidecarReachable()).toBe(false);
    expect(client.getLastKnownSensors().stale).toBe(true);

    // Revive it.
    sidecar.alive = true;
    const backAfter = await msUntil(() => client.isSidecarReachable(), 10_000);
    expect(backAfter).toBeLessThanOrEqual(RECONNECT_MAX_MS);

    // The next poll refreshes the values and clears the flag.
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS + 100);
    expect(client.getLastKnownSensors().stale).toBe(false);
    expect(client.getImu()).toEqual(IMU);
  });

  it('/state failing while /health answers goes stale without losing the sidecar', async () => {
    await client.init();
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const path = new URL(String(url)).pathname;
      if (path === '/health') return { ok: true, status: 200, json: async () => ({ status: 'ok', connected: true }) };
      throw new TypeError('fetch failed');
    }));
    await vi.advanceTimersByTimeAsync(2 * POLL_INTERVAL_MS + 500);
    expect(client.isSidecarReachable()).toBe(true);
    expect(client.isConnected()).toBe(false);
    expect(client.getLastKnownSensors().stale).toBe(true);
    expect(client.getImu()).toBeNull();
  });

  it('backs off 1 → 2 → 4 s and then retries every 5 s', () => {
    expect([0, 1, 2, 3, 4, 10].map(reconnectDelayMs)).toEqual([1000, 2000, 4000, 5000, 5000, 5000]);
  });

  it('retries an absent sidecar at startup on the same backoff, not every 10 s', async () => {
    sidecar.alive = false;
    expect(await client.init()).toBe(false);
    await vi.advanceTimersByTimeAsync(3000);
    sidecar.alive = true;
    const backAfter = await msUntil(() => client.isSidecarReachable(), 10_000);
    expect(backAfter).toBeLessThanOrEqual(RECONNECT_MAX_MS);
  });
});
