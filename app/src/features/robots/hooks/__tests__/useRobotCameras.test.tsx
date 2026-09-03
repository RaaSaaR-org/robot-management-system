/**
 * @file useRobotCameras.test.tsx
 * @description The live camera list the cockpit builds its source chips from.
 * @feature robots
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

vi.mock('../../api/cameraApi', async () => {
  const actual = await vi.importActual<typeof import('../../api/cameraApi')>('../../api/cameraApi');
  return { ...actual, fetchRobotCameras: vi.fn() };
});

import { fetchRobotCameras } from '../../api/cameraApi';
import { useRobotCameras } from '../useRobotCameras';

const mockList = vi.mocked(fetchRobotCameras);

describe('useRobotCameras', () => {
  beforeEach(() => {
    mockList.mockReset();
  });

  it('reports the cameras the robot says it can serve', async () => {
    mockList.mockResolvedValue({ cameras: ['head_camera'], source: 'realsense' });

    const { result } = renderHook(() => useRobotCameras('g1-edu-4', 0));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.cameras).toEqual(['head_camera']);
    expect(result.current.source).toBe('realsense');
  });

  it('keeps the reason when the robot serves nothing', async () => {
    // "No cameras" without a reason is what made the cockpit look broken: the
    // operator could not tell a missing device from a missing feature.
    mockList.mockResolvedValue({
      cameras: [],
      source: null,
      detail: 'no camera source available: …no RealSense device is attached',
    });

    const { result } = renderHook(() => useRobotCameras('g1-edu-4', 0));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.cameras).toEqual([]);
    expect(result.current.detail).toContain('no RealSense device');
  });

  it('stops loading and explains itself when the request fails', async () => {
    mockList.mockRejectedValue(new Error('500'));

    const { result } = renderHook(() => useRobotCameras('g1-edu-4', 0));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.cameras).toEqual([]);
    expect(result.current.detail).toMatch(/could not reach the server/i);
  });

  it('asks nothing for a null robot', async () => {
    const { result } = renderHook(() => useRobotCameras(null, 0));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockList).not.toHaveBeenCalled();
  });

  it('re-asks on refresh, so a camera plugged in just now shows up', async () => {
    mockList.mockResolvedValueOnce({ cameras: [], source: null, detail: 'nothing attached' });
    const { result } = renderHook(() => useRobotCameras('g1-edu-4', 0));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockList.mockResolvedValueOnce({ cameras: ['head_camera'], source: 'realsense' });
    act(() => result.current.refresh());

    await waitFor(() => expect(result.current.cameras).toEqual(['head_camera']));
    expect(mockList).toHaveBeenCalledTimes(2);
  });
});
