/**
 * @file useCameraStreamUrl.test.tsx
 * @description The ticket a plain `<img>` camera view opens its stream with.
 * @feature robots
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

vi.mock('../../api/cameraApi', async () => {
  const actual = await vi.importActual<typeof import('../../api/cameraApi')>('../../api/cameraApi');
  return { ...actual, fetchCameraTicket: vi.fn() };
});

import { fetchCameraTicket } from '../../api/cameraApi';
import { useCameraStreamUrl } from '../useCameraStreamUrl';

const mockFetch = vi.mocked(fetchCameraTicket);

describe('useCameraStreamUrl', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('builds the stream URL from the ticket it was given', async () => {
    mockFetch.mockResolvedValue({ ticket: 'tkt-1', expiresIn: 120 });

    const { result } = renderHook(() => useCameraStreamUrl('robot-001', 'top'));

    await waitFor(() => expect(result.current.url).not.toBeNull());
    expect(result.current.url).toBe('/api/robots/robot-001/camera/top?ticket=tkt-1');
    expect(result.current.denied).toBe(false);
    expect(mockFetch).toHaveBeenCalledWith('robot-001', 'top');
  });

  it('reports a refused ticket rather than staying blank', async () => {
    // An <img> whose src is never assigned fires no onerror, so a view that
    // only watched for image errors would show nothing and claim nothing.
    mockFetch.mockRejectedValue(new Error('401'));

    const { result } = renderHook(() => useCameraStreamUrl('robot-001', 'top'));

    await waitFor(() => expect(result.current.denied).toBe(true));
    expect(result.current.url).toBeNull();
  });

  it('asks for nothing when no camera is selected', () => {
    const { result } = renderHook(() => useCameraStreamUrl('robot-001', null));

    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.current).toEqual({ url: null, denied: false });
  });

  it('re-tickets when the camera changes, and drops the old URL first', async () => {
    mockFetch.mockResolvedValue({ ticket: 'tkt-top', expiresIn: 120 });
    const { result, rerender } = renderHook(
      ({ camera }: { camera: string }) => useCameraStreamUrl('robot-001', camera),
      { initialProps: { camera: 'top' } }
    );
    await waitFor(() => expect(result.current.url).toContain('tkt-top'));

    mockFetch.mockResolvedValue({ ticket: 'tkt-wrist', expiresIn: 120 });
    rerender({ camera: 'wrist' });

    // A ticket names ONE camera, so the previous URL is not merely stale — it
    // would be refused. It must not stay on screen while the new one loads.
    expect(result.current.url).toBeNull();
    await waitFor(() => expect(result.current.url).toBe(
      '/api/robots/robot-001/camera/wrist?ticket=tkt-wrist'
    ));
  });

  it('re-tickets on a nonce bump, because tickets expire', async () => {
    mockFetch.mockResolvedValue({ ticket: 'tkt-1', expiresIn: 120 });
    const { result, rerender } = renderHook(
      ({ nonce }: { nonce: number }) => useCameraStreamUrl('robot-001', 'top', undefined, nonce),
      { initialProps: { nonce: 0 } }
    );
    await waitFor(() => expect(result.current.url).toContain('tkt-1'));

    mockFetch.mockResolvedValue({ ticket: 'tkt-2', expiresIn: 120 });
    rerender({ nonce: 1 });

    await waitFor(() => expect(result.current.url).toContain('tkt-2'));
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('ignores a ticket that arrives after the camera moved on', async () => {
    // The request outlives its camera: the operator switches source mid-fetch.
    // Assigning the late answer would show a stream nobody asked for.
    let resolveFirst: (v: { ticket: string; expiresIn: number }) => void = () => {};
    mockFetch.mockImplementationOnce(
      () => new Promise((resolve) => { resolveFirst = resolve; })
    );

    const { result, rerender } = renderHook(
      ({ camera }: { camera: string }) => useCameraStreamUrl('robot-001', camera),
      { initialProps: { camera: 'top' } }
    );

    mockFetch.mockResolvedValue({ ticket: 'tkt-wrist', expiresIn: 120 });
    rerender({ camera: 'wrist' });
    resolveFirst({ ticket: 'tkt-top', expiresIn: 120 });

    await waitFor(() => expect(result.current.url).toContain('tkt-wrist'));
    expect(result.current.url).not.toContain('tkt-top');
  });
});
