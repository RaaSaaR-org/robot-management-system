/**
 * @file hardware-pointcloud-session.test.ts
 * @description TASK-190: the active scan session travels with every hardware
 *              point-cloud snapshot as the `X-Scan-Session` header, so the
 *              sidecar can hold ONE MID-360 frame convention for the whole
 *              sweep. Without it a frame that sees no floor (an open doorway)
 *              is normalized differently from its neighbours and stitches into
 *              the twin mirrored.
 * @feature hardware
 * @status test
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { HardwareClient } from '../HardwareClient.js';

/** Captured request headers, in call order. */
type Captured = Array<Record<string, string>>;

function stubSnapshot(captured: Captured): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: { headers?: Record<string, string> }) => {
      if (!String(url).endsWith('/snapshot')) throw new Error(`unexpected fetch ${url}`);
      captured.push({ ...(init?.headers ?? {}) });
      return {
        ok: true,
        json: async () => ({
          positions: [1, 2, 3],
          intensities: [0.5],
          sensor_type: 'lidar',
          has_intensity: true,
        }),
      };
    }),
  );
}

describe('HardwareClient — point-cloud scan session', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the scan session id as X-Scan-Session', async () => {
    const captured: Captured = [];
    stubSnapshot(captured);

    const frame = await new HardwareClient().snapshotPointCloud('mid360_lidar', {
      scanSessionId: 'sess_walked',
    });

    expect(captured).toHaveLength(1);
    expect(captured[0]['X-Scan-Session']).toBe('sess_walked');
    // The frame contract itself is untouched by the header.
    expect(frame.pointCount).toBe(1);
    expect(frame.source).toBe('hardware');
  });

  it('sends no session header when no scan session is active', async () => {
    const captured: Captured = [];
    stubSnapshot(captured);

    await new HardwareClient().snapshotPointCloud('mid360_lidar');

    expect(captured).toHaveLength(1);
    expect(captured[0]['X-Scan-Session']).toBeUndefined();
  });

  it('keeps the same session id across every frame of one sweep', async () => {
    const captured: Captured = [];
    stubSnapshot(captured);
    const client = new HardwareClient();

    for (let i = 0; i < 4; i++) {
      await client.snapshotPointCloud('mid360_lidar', { scanSessionId: 'sess_walked' });
    }

    expect(captured.map((h) => h['X-Scan-Session'])).toEqual([
      'sess_walked',
      'sess_walked',
      'sess_walked',
      'sess_walked',
    ]);
  });
});
