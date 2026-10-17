/**
 * @file useCameraReconnect.test.ts
 * @description The head-camera panel's way back from a failed stream (TASK-401):
 *              backoff retries with no attempt limit, the first-frame watchdog,
 *              the `/cameras` reason, and the counter resets.
 * @feature robots
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useCameraReconnect, type ArmFn } from '../useCameraReconnect';
import { NO_CAMERA_DETAIL } from '../vrCamera';
import type { RobotCameraList } from '../../../../api/cameraApi';

/** Let resolved promises run without advancing the clock. */
async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** Make the `<img>` look like it has decoded a frame. */
function decodeFrame(image: HTMLImageElement): void {
  Object.defineProperty(image, 'naturalWidth', { configurable: true, value: 640 });
}

describe('useCameraReconnect', () => {
  let image: HTMLImageElement;
  let listCameras: ReturnType<typeof vi.fn<(id: string) => Promise<RobotCameraList>>>;

  beforeEach(() => {
    vi.useFakeTimers();
    image = document.createElement('img');
    listCameras = vi.fn(async () => ({ cameras: ['head_camera'], source: 'sim' }));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** An arm that fails `failures` times, then assigns a `src`. */
  function flakyArm(failures: number) {
    let calls = 0;
    const arm = vi.fn<ArmFn>(async (img, robotId, isCurrent) => {
      calls += 1;
      if (calls <= failures) return false;
      if (!isCurrent()) return false;
      img.setAttribute('src', `/api/robots/${robotId}/camera/head_camera?ticket=t${calls}`);
      return true;
    });
    return arm;
  }

  it('recovers after the ticket fetch fails twice, backing off 1 s then 2 s', async () => {
    const arm = flakyArm(3); // initial arm + two retries fail, the third retry wins
    const { result } = renderHook(() => useCameraReconnect({ robotId: 'g1', image, arm, listCameras }));
    await flush();
    expect(arm).toHaveBeenCalledTimes(1);
    expect(result.current.phase).toBe('offline');
    expect(result.current.retryInS).toBe(1);
    const epochAfterFirst = result.current.armEpoch.current;

    await advance(1000);
    await flush();
    expect(arm).toHaveBeenCalledTimes(2);
    expect(listCameras).toHaveBeenCalledTimes(1);
    expect(result.current.armEpoch.current).toBe(epochAfterFirst + 1);
    expect(result.current.attempt).toBe(1);
    expect(result.current.retryInS).toBe(2);

    // Not yet: the second retry waits 2 s.
    await advance(1000);
    expect(arm).toHaveBeenCalledTimes(2);
    await advance(1000);
    await flush();
    expect(arm).toHaveBeenCalledTimes(3);
    expect(result.current.attempt).toBe(2);
    expect(result.current.retryInS).toBe(4);

    await advance(4000);
    await flush();
    expect(arm).toHaveBeenCalledTimes(4);
    expect(result.current.armEpoch.current).toBe(epochAfterFirst + 3);
    expect(result.current.phase).toBe('connecting');
    expect(result.current.attempt).toBe(3);

    // The first frame lands: live, and the counter is back to zero.
    decodeFrame(image);
    act(() => image.onload?.(new Event('load')));
    expect(result.current.phase).toBe('up');
    expect(result.current.attempt).toBe(0);
    expect(result.current.retryInS).toBeNull();
  });

  it('never gives up: the delay holds at 15 s', async () => {
    const arm = vi.fn<ArmFn>(async () => false);
    const { result } = renderHook(() => useCameraReconnect({ robotId: 'g1', image, arm, listCameras }));
    await flush();
    for (const delay of [1, 2, 4, 8, 15, 15, 15]) {
      expect(result.current.retryInS).toBe(delay);
      await advance(delay * 1000);
      await flush();
    }
    expect(arm).toHaveBeenCalledTimes(8);
    expect(result.current.phase).toBe('offline');
  });

  it('re-arms a stream that opens but delivers no first frame within 4 s', async () => {
    const arm = flakyArm(0);
    const { result } = renderHook(() => useCameraReconnect({ robotId: 'g1', image, arm, listCameras }));
    await flush();
    expect(result.current.phase).toBe('connecting');

    await advance(3999);
    expect(result.current.phase).toBe('connecting');
    await advance(1);
    expect(result.current.phase).toBe('offline');

    await advance(1000);
    await flush();
    expect(arm).toHaveBeenCalledTimes(2);
    expect(result.current.phase).toBe('connecting');
    expect(result.current.attempt).toBe(1);
  });

  it('a real load error schedules a retry; an empty-src error does not', async () => {
    const arm = flakyArm(0);
    const { result } = renderHook(() => useCameraReconnect({ robotId: 'g1', image, arm, listCameras }));
    await flush();
    decodeFrame(image);
    act(() => result.current.markFrame());
    expect(result.current.phase).toBe('up');

    image.setAttribute('src', '');
    act(() => image.onerror?.(new Event('error')));
    expect(result.current.phase).toBe('up');

    image.setAttribute('src', '/api/robots/g1/camera/head_camera?ticket=x');
    act(() => image.onerror?.(new Event('error')));
    expect(result.current.phase).toBe('offline');
    await advance(1000);
    await flush();
    expect(arm).toHaveBeenCalledTimes(2);
  });

  it("shows the agent's reason and holds at the cap when the robot serves no camera", async () => {
    listCameras.mockResolvedValue({ cameras: [], source: null, detail: 'cannot reach the hardware sidecar' });
    const arm = vi.fn<ArmFn>(async () => false);
    const { result } = renderHook(() => useCameraReconnect({ robotId: 'g1', image, arm, listCameras }));
    await flush();
    await advance(1000);
    await flush();
    expect(result.current.detail).toBe('cannot reach the hardware sidecar');
    expect(result.current.retryInS).toBe(15);

    listCameras.mockResolvedValue({ cameras: [], source: null });
    await advance(15_000);
    await flush();
    expect(result.current.detail).toBe(NO_CAMERA_DETAIL);
  });

  it('counts the retry down once a second', async () => {
    const arm = vi.fn<ArmFn>(async () => false);
    const { result } = renderHook(() => useCameraReconnect({ robotId: 'g1', image, arm, listCameras }));
    await flush();
    for (const delay of [1, 2, 4]) {
      await advance(delay * 1000);
      await flush();
    }
    // Now waiting the 8 s step.
    expect(result.current.retryInS).toBe(8);
    await advance(1000);
    expect(result.current.retryInS).toBe(7);
    await advance(3000);
    expect(result.current.retryInS).toBe(4);
  });

  it('resets the attempt counter when the robot changes', async () => {
    const arm = vi.fn<ArmFn>(async () => false);
    const { result, rerender } = renderHook(
      ({ robotId }) => useCameraReconnect({ robotId, image, arm, listCameras }),
      { initialProps: { robotId: 'g1-a' } },
    );
    await flush();
    await advance(1000);
    await flush();
    await advance(2000);
    await flush();
    expect(result.current.attempt).toBe(2);
    const epoch = result.current.armEpoch.current;

    rerender({ robotId: 'g1-b' });
    await flush();
    expect(result.current.attempt).toBe(0);
    expect(result.current.armEpoch.current).toBeGreaterThan(epoch);
    expect(arm).toHaveBeenLastCalledWith(image, 'g1-b', expect.any(Function));
    // Back at the start of the schedule.
    expect(result.current.retryInS).toBe(1);
  });

  it('a late ticket for the previous robot is dropped', async () => {
    let resolveFirst: (v: boolean) => void = () => {};
    const arm = vi
      .fn<ArmFn>()
      .mockImplementationOnce(
        (_img, _id, isCurrent) =>
          new Promise<boolean>((resolve) => {
            resolveFirst = (v) => resolve(v && isCurrent());
          }),
      )
      .mockImplementation(async () => true);
    const { result, rerender } = renderHook(
      ({ robotId }) => useCameraReconnect({ robotId, image, arm, listCameras }),
      { initialProps: { robotId: 'g1-a' } },
    );
    rerender({ robotId: 'g1-b' });
    await flush();
    resolveFirst(false);
    await flush();
    // The superseded failure does not put the new robot's panel offline.
    expect(result.current.phase).toBe('connecting');
  });

  it('rearm is a no-op while an arm is in flight', async () => {
    let release: () => void = () => {};
    const arm = vi.fn<ArmFn>(
      () =>
        new Promise<boolean>((resolve) => {
          release = () => resolve(true);
        }),
    );
    const { result } = renderHook(() => useCameraReconnect({ robotId: 'g1', image, arm, listCameras }));
    act(() => result.current.rearm());
    expect(arm).toHaveBeenCalledTimes(1);
    release();
    await flush();
    act(() => result.current.rearm());
    expect(arm).toHaveBeenCalledTimes(2);
  });

  it('drops the stream on unmount', async () => {
    const arm = flakyArm(0);
    const { unmount } = renderHook(() => useCameraReconnect({ robotId: 'g1', image, arm, listCameras }));
    await flush();
    expect(image.getAttribute('src')).toContain('ticket');
    unmount();
    expect(image.getAttribute('src')).toBe('');
  });
});
