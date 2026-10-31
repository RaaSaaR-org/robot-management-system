/**
 * @file useCameraScreen.test.ts
 * @description The stream side of a VR camera screen (TASK-443), shared by the
 *              head panel and the wrist panels: arming names the camera it is
 *              given, and the frame step uploads only changed frames, calls a
 *              frozen picture stale once, publishes it, and re-arms it.
 * @feature robots
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

vi.mock('../../../../api/cameraApi', () => ({
  fetchCameraTicket: vi.fn(async (_robotId: string, camera: string) => ({ ticket: `t-${camera}` })),
  cameraStreamUrl: (robotId: string, camera: string, ticket: string | null) =>
    `/api/robots/${robotId}/camera/${camera}?ticket=${ticket}`,
  fetchRobotCameras: vi.fn(async () => ({ cameras: ['head_camera'], source: 'sim' })),
}));

import { armCameraStream, useCameraScreen, type CameraScreenOptions } from '../useCameraScreen';
import { armStream } from '../HeadCameraPanel';
import type { ArmFn } from '../useCameraReconnect';

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });
}

describe('armCameraStream', () => {
  it('points the <img> at the camera it was made for', async () => {
    const image = document.createElement('img');
    expect(await armCameraStream('left_wrist_camera')(image, 'g1', () => true)).toBe(true);
    expect(image.getAttribute('src')).toBe('/api/robots/g1/camera/left_wrist_camera?ticket=t-left_wrist_camera');
  });

  it('keeps the head panel on head_camera', async () => {
    const image = document.createElement('img');
    await armStream(image, 'g1', () => true);
    expect(image.getAttribute('src')).toBe('/api/robots/g1/camera/head_camera?ticket=t-head_camera');
  });

  it('assigns nothing when superseded while the ticket was in flight', async () => {
    const image = document.createElement('img');
    expect(await armCameraStream('right_wrist_camera')(image, 'g1', () => false)).toBe(false);
    expect(image.getAttribute('src')).toBeNull();
  });
});

describe('useCameraScreen step', () => {
  let images: HTMLImageElement[];
  let fingerprint: number;
  const arm = vi.fn<ArmFn>(async (img, robotId, isCurrent) => {
    if (!isCurrent()) return false;
    images.push(img);
    img.setAttribute('src', `/api/robots/${robotId}/camera/x?ticket=1`);
    return true;
  });

  beforeEach(() => {
    images = [];
    fingerprint = 1;
    arm.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  async function mountUp(overrides: Partial<CameraScreenOptions> = {}) {
    const publish = vi.fn();
    const hook = renderHook(() =>
      useCameraScreen({
        robotId: 'g1',
        camera: 'left_wrist_camera',
        arm,
        textureHz: 10,
        publish,
        sampleFrame: () => fingerprint,
        ...overrides,
      }),
    );
    await flush();
    const image = images[0];
    Object.defineProperty(image, 'naturalWidth', { configurable: true, value: 640 });
    // The first decoded frame ends `connecting`.
    act(() => { hook.result.current.step(0.01); });
    expect(hook.result.current.reconnect.phase).toBe('up');
    return { hook, publish };
  }

  it('publishes connecting, then live, under the robot it shows', async () => {
    const { publish } = await mountUp();
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ robotId: 'g1', state: 'connecting' }));
    expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({ robotId: 'g1', state: 'live' }));
  });

  it('uploads at most textureHz times a second, and only a changed frame', async () => {
    const { hook } = await mountUp();
    const { texture } = hook.result.current;
    for (let t = 0.02; t < 1.0; t += 0.02) {
      fingerprint = Math.round(t * 100); // a new picture every step
      hook.result.current.step(t);
    }
    // 10 Hz over ~1 s: about ten uploads, never one per step.
    expect(texture.version).toBeGreaterThanOrEqual(8);
    expect(texture.version).toBeLessThanOrEqual(11);

    fingerprint = 999;
    hook.result.current.step(2.0); // a slot is free: this frame goes up
    const before = texture.version;
    for (let t = 2.02; t < 2.6; t += 0.02) hook.result.current.step(t); // the same picture
    expect(texture.version).toBe(before);
  });

  it('calls a frozen picture stale once, publishes it, and re-arms it', async () => {
    const { hook, publish } = await mountUp();
    const polls = [];
    for (let t = 0.6; t <= 5.6; t += 0.5) {
      const poll = hook.result.current.step(t);
      if (poll) polls.push(poll);
    }
    const became = polls.filter((p) => p.becameStale);
    expect(became).toHaveLength(1);
    expect(polls.some((p) => p.isStale)).toBe(true);
    expect(publish).toHaveBeenCalledWith({ state: 'stale' });
    await flush();
    // The first arm at mount, then the stale re-arm (rate-limited to one per 5 s).
    expect(arm).toHaveBeenCalledTimes(2);
  });

  it('reports nothing while there is no picture', async () => {
    const publish = vi.fn();
    const { result } = renderHook(() =>
      useCameraScreen({ robotId: 'g1', camera: 'right_wrist_camera', arm, textureHz: 10, publish, sampleFrame: () => 1 }),
    );
    await flush();
    for (let t = 0; t < 3; t += 0.5) expect(result.current.step(t)).toBeNull();
    expect(result.current.reconnect.phase).toBe('connecting');
  });
});
