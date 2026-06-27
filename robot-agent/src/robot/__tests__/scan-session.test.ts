/**
 * @file scan-session.test.ts
 * @description Regression: getPointCloudFrame is unchanged with no active scan
 *   session, and pose-stamps frames once a session is started.
 * @feature robot
 * @status test
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { RobotStateManager } from '../state.js';
import type { RobotConfig } from '../types.js';

const config: RobotConfig = {
  id: 'robot-twin-test',
  name: 'Twin Test G1',
  model: 'G1',
  robotClass: 'standard',
  robotType: 'generic', // no embodiment file dependency → MID-360 defaults
  maxPayloadKg: 10,
  description: 'scan-session test',
  initialLocation: { x: 1, y: 2, heading: 90 },
  capabilities: [],
};

describe('RobotStateManager scan sessions', () => {
  let mgr: RobotStateManager;

  beforeAll(() => {
    // Ensure the real-recording replay seam is inactive so frames are synthetic.
    delete process.env.POINTCLOUD_REPLAY_FILE;
    delete process.env.POINTCLOUD_REPLAY_DIR;
    mgr = new RobotStateManager(config);
  });

  it('returns plain sim frames with NO pose when no session is active', async () => {
    const frame = await mgr.getPointCloudFrame();
    expect(frame.source).toBe('sim');
    expect(frame.pose).toBeUndefined();
    expect(frame.scanSessionId).toBeUndefined();
    expect(mgr.getScanStatus().active).toBe(false);
  });

  it('pose-stamps frames (yaw in radians) once a session starts', async () => {
    const { sessionId } = mgr.startScanSession({ sessionId: 'sess_unit' });
    expect(sessionId).toBe('sess_unit');
    expect(mgr.getScanStatus().active).toBe(true);

    // Note: the constructor restores persisted state keyed by the configured
    // robot, so read the live heading rather than assuming initialLocation.
    const loc = mgr.getState().location;
    const frame = await mgr.getPointCloudFrame();
    expect(frame.source).toBe('sim');
    expect(frame.scanSessionId).toBe('sess_unit');
    expect(frame.pose).toBeDefined();
    // The ONLY deg→rad conversion: pose.yaw must equal heading° × π/180.
    expect(frame.pose!.yaw).toBeCloseTo(((loc.heading ?? 0) * Math.PI) / 180, 6);
    // The twin's world origin is anchored at the scan-start location, so the
    // first frame's pose is at local origin regardless of world position.
    expect(frame.pose!.x).toBeCloseTo(0, 6);
    expect(frame.pose!.y).toBeCloseTo(0, 6);
  });

  it('reverts to plain sim frames after stop', async () => {
    const stopped = mgr.stopScanSession();
    expect(stopped.sessionId).toBe('sess_unit');
    expect(stopped.frames).toBeGreaterThan(0);

    const frame = await mgr.getPointCloudFrame();
    expect(frame.pose).toBeUndefined();
    expect(frame.scanSessionId).toBeUndefined();
    expect(mgr.getScanStatus().active).toBe(false);
  });
});
