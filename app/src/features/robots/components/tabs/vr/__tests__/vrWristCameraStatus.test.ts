/**
 * @file vrWristCameraStatus.test.ts
 * @description The wrist panels' keyed status store (TASK-443): one entry per
 *              camera, merges without no-op writes, drops an entry on unmount,
 *              and never touches the head camera's store.
 * @feature robots
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useVrWristCameraStatus } from '../vrWristCameraStatus';
import { useVrCameraStatus } from '../vrCameraStatus';

describe('useVrWristCameraStatus', () => {
  beforeEach(() => {
    useVrWristCameraStatus.setState({ cameras: {} });
    useVrCameraStatus.getState().reset();
  });

  it('keeps one entry per camera', () => {
    const { publish } = useVrWristCameraStatus.getState();
    publish('left_wrist_camera', { robotId: 'g1', state: 'live', fps: 10 });
    publish('right_wrist_camera', { robotId: 'g1', state: 'offline', detail: 'no frames' });
    expect(useVrWristCameraStatus.getState().cameras).toEqual({
      left_wrist_camera: { robotId: 'g1', state: 'live', detail: null, retryInS: null, fps: 10 },
      right_wrist_camera: { robotId: 'g1', state: 'offline', detail: 'no frames', retryInS: null, fps: null },
    });
  });

  it('does not notify subscribers when nothing changed', () => {
    const { publish } = useVrWristCameraStatus.getState();
    publish('left_wrist_camera', { robotId: 'g1', state: 'live' });
    let notified = 0;
    const unsubscribe = useVrWristCameraStatus.subscribe(() => { notified += 1; });
    publish('left_wrist_camera', { robotId: 'g1', state: 'live' });
    publish('left_wrist_camera', { state: 'stale' });
    unsubscribe();
    expect(notified).toBe(1);
  });

  it('drops a camera when its panel goes', () => {
    const { publish, remove } = useVrWristCameraStatus.getState();
    publish('left_wrist_camera', { robotId: 'g1' });
    publish('right_wrist_camera', { robotId: 'g1' });
    remove('left_wrist_camera');
    expect(Object.keys(useVrWristCameraStatus.getState().cameras)).toEqual(['right_wrist_camera']);
  });

  it("leaves the head camera's store alone", () => {
    useVrWristCameraStatus.getState().publish('left_wrist_camera', { robotId: 'g1', state: 'stale' });
    expect(useVrCameraStatus.getState()).toMatchObject({ robotId: null, state: 'connecting' });
  });
});
