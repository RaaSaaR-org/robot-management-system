/**
 * @file hardware-odometry-provenance.test.ts
 * @description TASK-231: odometry provenance survives the sidecar seam. A frame
 *              whose x/y were dead reckoned from the velocity we ourselves
 *              commanded must arrive in TypeScript SAYING SO, and must stay
 *              distinguishable from a measured one — including on the `/state`
 *              group, whose `velocity` is the field that hands the command back.
 *              Provenance is a separate axis from `source`, which names the
 *              transport and keeps its old meaning.
 * @feature hardware
 * @status test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HardwareClient } from '../HardwareClient.js';

/** The markers `isaac_odom.py` stamps into `SportModeState_.error_code`. */
const ERROR_CODE_GROUND_TRUTH = 0x600d; // 24589
const ERROR_CODE_DEAD_RECKONED = 0xdead; // 57005

interface SidecarScript {
  /** `/loco/odom` body. */
  locoOdom?: unknown;
  /** `odometry` group inside the `/state` response. */
  stateOdometry?: unknown;
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

describe('HardwareClient — odometry provenance (/loco/odom)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports a measured frame as ground-truth, with the raw marker', async () => {
    stubSidecar({
      locoOdom: {
        ok: true,
        x: 0.113,
        y: 0,
        yaw: 0,
        source: 'dds',
        provenance: 'ground-truth',
        errorCode: ERROR_CODE_GROUND_TRUTH,
      },
    });

    const odom = await new HardwareClient().getLocoOdometry();
    expect(odom).toMatchObject({ x: 0.113, provenance: 'ground-truth' });
    expect(odom?.errorCode).toBe(ERROR_CODE_GROUND_TRUTH);
  });

  it('reports a dead-reckoned frame as such — the pose that reads back the command', async () => {
    // The 2026-08-30 measurement: 7.995 m "travelled" of a commanded 8.00 m,
    // while the true root pose had moved 0.113 m. Nothing downstream could tell
    // that apart from the frame above; this field is what makes it tellable.
    stubSidecar({
      locoOdom: {
        ok: true,
        x: 7.995,
        y: 0,
        yaw: 0,
        source: 'dds',
        provenance: 'dead-reckoned',
        errorCode: ERROR_CODE_DEAD_RECKONED,
      },
    });

    const odom = await new HardwareClient().getLocoOdometry();
    expect(odom?.provenance).toBe('dead-reckoned');
    expect(odom?.errorCode).toBe(ERROR_CODE_DEAD_RECKONED);
    // Provenance is NOT the transport: both frames above came over the same one.
    expect(odom?.source).toBe('dds');
  });

  it('falls back to unknown for a sidecar that stamps nothing, without losing the pose', async () => {
    // An older sidecar, or a real G1 whose error_code is a fault code rather
    // than a marker. "unknown" must never be read as "probably measured".
    stubSidecar({ locoOdom: { ok: true, x: 1, y: 2, yaw: 0.5, source: 'zmq' } });

    const odom = await new HardwareClient().getLocoOdometry();
    expect(odom).toMatchObject({ x: 1, y: 2, source: 'zmq', provenance: 'unknown' });
    expect(odom?.errorCode).toBeNull();
  });

  it('refuses to pass through a provenance value it does not recognise', async () => {
    stubSidecar({
      locoOdom: { ok: true, x: 0, y: 0, yaw: 0, source: 'dds', provenance: 'probably-fine' },
    });

    expect((await new HardwareClient().getLocoOdometry())?.provenance).toBe('unknown');
  });
});

describe('HardwareClient — odometry provenance (/state group)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function polledOdometry(stateOdometry: unknown) {
    stubSidecar({ stateOdometry });
    const client = new HardwareClient();
    await client.init();
    await vi.advanceTimersByTimeAsync(2000);
    const odom = client.getOdometry();
    client.stopPolling();
    return odom;
  }

  it('carries the marker onto the whole group, velocity included', async () => {
    // The marker is message-level, so it qualifies `velocity` too — and velocity
    // is exactly where the commanded number rides on a reckoned frame.
    const odom = await polledOdometry({
      position: [7.995, 0, 0.79],
      rpy: [0, 0, 0],
      velocity: [0.5, 0, 0],
      yawSpeed: 0,
      provenance: 'dead-reckoned',
      errorCode: ERROR_CODE_DEAD_RECKONED,
    });

    expect(odom?.provenance).toBe('dead-reckoned');
    expect(odom?.errorCode).toBe(ERROR_CODE_DEAD_RECKONED);
    expect(odom?.velocity).toEqual([0.5, 0, 0]);
  });

  it('keeps the group when no marker is present, marked unknown', async () => {
    const odom = await polledOdometry({ position: [1, 2, 0.8], rpy: [0, 0, 0] });

    expect(odom?.position).toEqual([1, 2, 0.8]);
    expect(odom?.provenance).toBe('unknown');
    expect(odom?.errorCode).toBeNull();
  });
});
