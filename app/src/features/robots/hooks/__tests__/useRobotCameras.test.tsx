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

  it('does not show the previous robot\'s cameras while asking about the next one', async () => {
    // The New-session form names the wrist cameras it records from this list; a
    // stale answer would send one robot's cameras for another (TASK-447).
    mockList.mockResolvedValueOnce({ cameras: ['head_camera', 'left_wrist_camera'], source: 'sidecar' });
    const { result, rerender } = renderHook(({ id }) => useRobotCameras(id, 0), { initialProps: { id: 'g1-a' } });
    await waitFor(() => expect(result.current.cameras).toEqual(['head_camera', 'left_wrist_camera']));

    let answer!: (list: { cameras: string[]; source: null }) => void;
    mockList.mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
    rerender({ id: 'g1-b' });

    expect(result.current.loading).toBe(true);
    expect(result.current.cameras).toEqual([]);
    act(() => answer({ cameras: ['head_camera'], source: null }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.cameras).toEqual(['head_camera']);
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
