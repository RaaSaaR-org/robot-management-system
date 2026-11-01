/**
 * @file hardware-snapshot-raw.test.ts
 * @description `snapshotRaw` — the recorder's per-frame camera read — makes ONE
 *              request per frame against a sidecar that answers `?format=raw`
 *              (the sim facade, and g1_sidecar.py since TASK-445), and still
 *              falls back to the plain URL for one that 404s the query.
 * @feature hardware
 * @status test
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { HardwareClient } from '../HardwareClient.js';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x01, 0xaa, 0xff, 0xd9]);

function jpegResponse(): Response {
  return new Response(new Uint8Array(JPEG), { status: 200, headers: { 'Content-Type': 'image/jpeg' } });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('HardwareClient.snapshotRaw', () => {
  it('takes the image/jpeg answer to ?format=raw in one request', async () => {
    const fetchMock = vi.fn(async () => jpegResponse());
    vi.stubGlobal('fetch', fetchMock);

    const bytes = await new HardwareClient().snapshotRaw('left_wrist_camera', { shadows: false, quality: 90 });

    expect(bytes.equals(JPEG)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String((fetchMock.mock.calls[0] as unknown[])[0]);
    expect(url).toMatch(/\/cameras\/left_wrist_camera\/snapshot\?/);
    expect(new URL(url).searchParams.get('format')).toBe('raw');
  });

  it('retries the plain URL for a sidecar that 404s the query', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'not found' }, 404))
      .mockResolvedValueOnce(jsonResponse({ ok: true, jpeg_base64: JPEG.toString('base64') }));
    vi.stubGlobal('fetch', fetchMock);

    const bytes = await new HardwareClient().snapshotRaw('head_camera');

    expect(bytes.equals(JPEG)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String((fetchMock.mock.calls[1] as unknown[])[0])).toMatch(/\/cameras\/head_camera\/snapshot$/);
  });

  it('reads a raw failure out of the JSON body, without a second request', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: false, error: "wrist camera 'left_wrist_camera' does not answer" }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(new HardwareClient().snapshotRaw('left_wrist_camera')).rejects.toThrow(/does not answer/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
