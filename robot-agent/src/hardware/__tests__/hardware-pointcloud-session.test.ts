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
import { HardwareClient, scanSessionHeaderValue } from '../HardwareClient.js';

/** Captured request headers, in call order. */
type Captured = Array<Record<string, string>>;

function stubSnapshot(captured: Captured): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: { headers?: Record<string, string> }) => {
      if (!String(url).endsWith('/snapshot')) throw new Error(`unexpected fetch ${url}`);
      // Run the headers through the REAL Headers constructor, which is the same
      // validation the real `fetch` applies: a value undici rejects has to fail
      // here too, or these tests would pass on a header that throws in
      // production and silently downgrades the scan to synthetic points.
      new Headers(init?.headers ?? {});
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

  // The session id is caller-supplied (POST .../pointcloud/scan/start takes any
  // string). A value `fetch` refuses throws before the request is sent, and
  // getPointCloudFrame catches that and falls through to generateSyntheticScan —
  // so one stray newline would build the entire "lidar" scan from sim points.
  it('sanitizes a session id that fetch would reject instead of throwing', async () => {
    const captured: Captured = [];
    stubSnapshot(captured);

    const frame = await new HardwareClient().snapshotPointCloud('mid360_lidar', {
      scanSessionId: `bad${String.fromCharCode(13, 10)}X-Injected: 1`,
    });

    expect(captured).toHaveLength(1);
    expect(captured[0]['X-Scan-Session']).toBe('badX-Injected:1');
    expect(Object.keys(captured[0])).toEqual(['X-Scan-Session']);
    expect(frame.source).toBe('hardware');
  });

  it('sends no header at all when nothing survives sanitizing', async () => {
    const captured: Captured = [];
    stubSnapshot(captured);

    await new HardwareClient().snapshotPointCloud('mid360_lidar', {
      scanSessionId: String.fromCharCode(10, 0, 13),
    });

    expect(captured).toHaveLength(1);
    expect(captured[0]['X-Scan-Session']).toBeUndefined();
  });
});

describe('scanSessionHeaderValue', () => {
  it('passes the ids the system actually mints through untouched', () => {
    // ScanSessionService supplies a cuid; the agent mints `sess_<base36>`.
    expect(scanSessionHeaderValue('clx9q2k7v0000108l3abcd1234')).toBe('clx9q2k7v0000108l3abcd1234');
    expect(scanSessionHeaderValue('sess_m1k2j3abc456')).toBe('sess_m1k2j3abc456');
  });

  it('returns undefined for no session', () => {
    expect(scanSessionHeaderValue(undefined)).toBeUndefined();
    expect(scanSessionHeaderValue('')).toBeUndefined();
  });

  it('caps the length so an absurd id cannot become an absurd header', () => {
    expect(scanSessionHeaderValue('a'.repeat(500))).toHaveLength(128);
  });

  it('never returns a value the real Headers constructor rejects', () => {
    // Every code point from NUL through U+00FF — control characters, the
    // Latin-1 supplement, the lot. Whatever survives sanitizing has to be
    // constructible as a header value.
    const hostile = Array.from({ length: 256 }, (_, i) => String.fromCharCode(i)).join('');
    const safe = scanSessionHeaderValue(hostile);
    expect(safe).toBeDefined();
    expect(() => new Headers({ 'X-Scan-Session': safe as string })).not.toThrow();
    expect(safe).toMatch(/^[A-Za-z0-9._:-]+$/);
  });
});
