/**
 * @file cameraApi.test.ts
 * @description Camera stream URLs carry a ticket, and nothing else (TASK-214).
 * @feature robots
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/api/client', () => ({
  apiClient: { post: vi.fn() },
}));

import { apiClient } from '@/api/client';
import { cameraStreamUrl, fetchCameraTicket } from '../cameraApi';

describe('cameraStreamUrl', () => {
  it('carries the ticket in the query', () => {
    expect(cameraStreamUrl('robot-001', 'head_camera', 'tkt-123')).toBe(
      '/api/robots/robot-001/camera/head_camera?ticket=tkt-123'
    );
  });

  it('is relative by default', () => {
    // The VR panel needs same-origin: WebGL will not sample a cross-origin
    // image without CORS, and a cross-origin draw taints the scratch canvas the
    // panel reads its liveness fingerprint from — `getImageData` would throw.
    expect(cameraStreamUrl('robot-001', 'head_camera', 't').startsWith('/api/')).toBe(true);
  });

  it('accepts an absolute base for views that have no canvas readback', () => {
    expect(cameraStreamUrl('robot-001', 'top', 't', 'http://localhost:3001/api')).toBe(
      'http://localhost:3001/api/robots/robot-001/camera/top?ticket=t'
    );
    // ...and does not double the slash when the base carries one.
    expect(cameraStreamUrl('r', 'c', 't', '/api/')).toBe('/api/robots/r/camera/c?ticket=t');
  });

  it('escapes everything that goes into the URL', () => {
    const url = cameraStreamUrl('robot/../admin', 'head cam', 'a+b/c=');
    expect(url).toBe('/api/robots/robot%2F..%2Fadmin/camera/head%20cam?ticket=a%2Bb%2Fc%3D');
    // A robot id that walks out of its path segment would be a route the
    // ticket does not name.
    expect(url).not.toContain('/../');
  });

  it('omits the query when there is no ticket rather than inventing one', () => {
    expect(cameraStreamUrl('robot-001', 'head_camera', null)).toBe(
      '/api/robots/robot-001/camera/head_camera'
    );
  });
});

describe('fetchCameraTicket', () => {
  beforeEach(() => {
    vi.mocked(apiClient.post).mockReset();
  });

  it('asks the scoped endpoint and returns what it said', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ data: { ticket: 'tkt', expiresIn: 120 } });

    await expect(fetchCameraTicket('robot-001', 'head_camera')).resolves.toEqual({
      ticket: 'tkt',
      expiresIn: 120,
    });
    // Through apiClient, so it inherits bearer auth, tenant impersonation and
    // the 401-refresh-and-retry every other call gets.
    expect(apiClient.post).toHaveBeenCalledWith(
      '/robots/robot-001/camera/head_camera/ticket'
    );
  });
});

describe('no access token is left in any URL the app builds', () => {
  /**
   * The defect TASK-214 closes was a real access token in a query string. A
   * grep guard is the only thing that stops it coming back the next time
   * someone needs an `<img>` to authenticate — the browser cannot be relied on
   * to complain, and there is no runtime symptom.
   *
   * `access_token` as a localStorage KEY is legitimate and stays (api/client.ts,
   * AuthProvider). Only `?access_token=` / `&access_token=` — the URL forms —
   * are banned.
   */
  // Read through Vite rather than node:fs — the app's tsconfig carries no node
  // types, and `?raw` is how this codebase's bundler hands a file's text to a
  // module anyway.
  const SOURCES = import.meta.glob('/src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
  const URL_TOKEN = /[?&]access_token=/;

  it('builds no URL with ?access_token=', () => {
    // Sanity: a glob that matched nothing would pass this test forever.
    expect(Object.keys(SOURCES).length).toBeGreaterThan(100);

    const offenders = Object.entries(SOURCES)
      .filter(([file]) => !file.endsWith('cameraApi.test.ts'))
      .filter(([, text]) => URL_TOKEN.test(text))
      .map(([file]) => file);

    expect(offenders).toEqual([]);
  });
});
