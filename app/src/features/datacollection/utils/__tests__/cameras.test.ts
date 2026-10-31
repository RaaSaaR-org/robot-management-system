/**
 * @file cameras.test.ts
 * @description Wrist cameras of a robot and a session, and the camera-set
 *              label (TASK-441).
 * @feature datacollection
 */

import { describe, it, expect } from 'vitest';
import { WRIST_CAMERAS, cameraSetLabel, robotWristCameras, sessionWristCameras } from '../cameras';

const HEAD_AND_WRISTS = ['head_camera', 'left_wrist_camera', 'right_wrist_camera'];

describe('robotWristCameras', () => {
  it('finds none on a head-only robot, an empty list, or no list yet', () => {
    expect(robotWristCameras({ cameras: ['head_camera'], source: 'pc2cam' })).toEqual([]);
    expect(robotWristCameras({ cameras: [], source: null, detail: 'cannot reach the robot agent' })).toEqual([]);
    expect(robotWristCameras(undefined)).toEqual([]);
    expect(robotWristCameras(null)).toEqual([]);
  });

  it('reads the served list when the sidecar sends no configured list, left first', () => {
    expect(
      robotWristCameras({ cameras: ['right_wrist_camera', 'head_camera', 'left_wrist_camera'], source: 'sim' }),
    ).toEqual([WRIST_CAMERAS.left, WRIST_CAMERAS.right]);
  });

  it('prefers configured, so a wrist that is down right now still counts', () => {
    expect(
      robotWristCameras({
        cameras: ['head_camera', 'right_wrist_camera'],
        configured: HEAD_AND_WRISTS,
        source: 'pc2cam',
      }),
    ).toEqual(['left_wrist_camera', 'right_wrist_camera']);
    // …and a configured list without wrists wins over nothing else.
    expect(robotWristCameras({ cameras: ['head_camera'], configured: ['head_camera'], source: 'pc2cam' })).toEqual([]);
  });

  it('never takes a look-alike name for a wrist', () => {
    expect(robotWristCameras({ cameras: ['head_camera', 'wrist_camera', 'left_wrist'], source: 'sim' })).toEqual([]);
  });
});

describe('sessionWristCameras', () => {
  it('is empty for a head-only session, old or new', () => {
    expect(sessionWristCameras({ cameras: null })).toEqual([]);
    expect(sessionWristCameras({})).toEqual([]);
    expect(sessionWristCameras({ cameras: ['head_camera'] })).toEqual([]);
    expect(sessionWristCameras(null)).toEqual([]);
  });

  it('lists the wrists a session records, left first', () => {
    expect(sessionWristCameras({ cameras: HEAD_AND_WRISTS })).toEqual(['left_wrist_camera', 'right_wrist_camera']);
    expect(sessionWristCameras({ cameras: ['head_camera', 'right_wrist_camera'] })).toEqual(['right_wrist_camera']);
  });
});

describe('cameraSetLabel', () => {
  it.each([
    [null, 'Head only'],
    [undefined, 'Head only'],
    [[], 'Head only'],
    [['head_camera'], 'Head only'],
    [HEAD_AND_WRISTS, 'Head + 2 wrists'],
    [['head_camera', 'left_wrist_camera'], 'Head + left wrist'],
    [['head_camera', 'right_wrist_camera'], 'Head + right wrist'],
    [['left_wrist_camera', 'right_wrist_camera'], '2 wrists'],
    [['right_wrist_camera'], 'Right wrist'],
    [['head_camera', 'house_iso'], 'Head + 1 other camera'],
    [['house_iso', 'house_overview'], '2 other cameras'],
  ] as const)('%j reads "%s"', (cameras, label) => {
    expect(cameraSetLabel(cameras as readonly string[] | null | undefined)).toBe(label);
  });
});
