/**
 * @file vrCameraStatus.test.ts
 * @description The store the head-camera panel publishes its state through
 *              (TASK-401): merges, skips no-op writes, and resets on unmount.
 * @feature robots
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useVrCameraStatus } from '../vrCameraStatus';

describe('useVrCameraStatus', () => {
  beforeEach(() => useVrCameraStatus.getState().reset());

  it('starts as "no panel"', () => {
    const s = useVrCameraStatus.getState();
    expect(s.robotId).toBeNull();
    expect(s.state).toBe('connecting');
    expect(s.fps).toBeNull();
  });

  it('walks connecting → live → stale → offline → live', () => {
    const { publish } = useVrCameraStatus.getState();
    publish({ robotId: 'g1', state: 'connecting' });
    publish({ state: 'live', fps: 14 });
    expect(useVrCameraStatus.getState()).toMatchObject({ robotId: 'g1', state: 'live', fps: 14 });
    publish({ state: 'stale' });
    expect(useVrCameraStatus.getState().state).toBe('stale');
    publish({ state: 'offline', detail: 'cannot reach the hardware sidecar', retryInS: 4, fps: null });
    expect(useVrCameraStatus.getState()).toMatchObject({
      state: 'offline',
      detail: 'cannot reach the hardware sidecar',
      retryInS: 4,
      fps: null,
    });
    publish({ state: 'live', detail: null, retryInS: null });
    expect(useVrCameraStatus.getState()).toMatchObject({ state: 'live', detail: null, retryInS: null });
  });

  it('does not notify subscribers when nothing changed', () => {
    const { publish } = useVrCameraStatus.getState();
    publish({ robotId: 'g1', state: 'live', fps: 14 });
    let calls = 0;
    const unsubscribe = useVrCameraStatus.subscribe(() => {
      calls += 1;
    });
    publish({ state: 'live', fps: 14 });
    publish({ fps: undefined });
    expect(calls).toBe(0);
    publish({ fps: 13 });
    expect(calls).toBe(1);
    unsubscribe();
  });
});
